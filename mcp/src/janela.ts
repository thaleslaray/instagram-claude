// Janela de 24 h para responder DM (spec 4.2).
// A Meta só deixa responder até 24 h depois da última mensagem DA PESSOA.
// O filtro `conversations?user_id=` é IGNORADO pela Meta no login unificado (diário P8),
// então a conversa é achada pelo campo `participants`, varrendo até 100 conversas (diário P20).

import type { Contexto } from "./contexto.ts";
import type { OpcoesPedido } from "./graph.ts";

export const JANELA_MS = 24 * 60 * 60 * 1000;
export const CONVERSAS_POR_PAGINA = 25;
export const MAXIMO_DE_CONVERSAS_VARRIDAS = 100;
export const CAMPOS_CONVERSA = "id,updated_time,participants";
export const CAMPOS_MENSAGENS = "messages{id,created_time,from,to,message}";

export interface ParticipanteCru {
  id?: string;
  username?: string;
}

export interface MensagemCrua {
  id?: string;
  created_time?: string;
  from?: ParticipanteCru;
  to?: { data?: ParticipanteCru[] };
  message?: string;
  [outro: string]: unknown;
}

export interface ConversaCrua {
  id: string;
  updated_time?: string;
  participants?: { data?: ParticipanteCru[] };
}

export interface Janela {
  aberta: boolean;
  /** Fim da janela (última mensagem da pessoa + 24 h), em ISO UTC; null se a pessoa nunca escreveu. */
  ate: string | null;
  /** Hora da última mensagem da pessoa, em ISO UTC; null se não houve. */
  ultima_da_pessoa: string | null;
}

/** A Meta manda `+0000` (sem dois-pontos); o Date do Node aceita, mas normalizamos por garantia. */
function milissegundos(data: unknown): number | null {
  if (typeof data !== "string") return null;
  const normal = data.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normal);
  return Number.isNaN(ms) ? null : ms;
}

/** Pega a mensagem mais recente com `from.id ≠ igId` e diz se ainda dá para responder. */
export function calcularJanela(mensagens: readonly MensagemCrua[], igId: string, agora: number | Date): Janela {
  const agoraMs = typeof agora === "number" ? agora : agora.getTime();
  let ultima: number | null = null;
  for (const mensagem of mensagens) {
    const autor = mensagem.from?.id;
    if (!autor || autor === igId) continue;
    const ms = milissegundos(mensagem.created_time);
    if (ms !== null && (ultima === null || ms > ultima)) ultima = ms;
  }
  if (ultima === null) return { aberta: false, ate: null, ultima_da_pessoa: null };
  const ate = ultima + JANELA_MS;
  return { aberta: agoraMs < ate, ate: new Date(ate).toISOString(), ultima_da_pessoa: new Date(ultima).toISOString() };
}

/** Lê as mensagens de uma conversa (a Meta devolve as mais recentes primeiro). */
export async function lerMensagens(ctx: Contexto, conversaId: string, opcoes: OpcoesPedido = {}, campos: string = CAMPOS_MENSAGENS): Promise<MensagemCrua[]> {
  await ctx.espacador.esperar(opcoes.signal);
  const corpo = await ctx.graph.get<{ messages?: { data?: MensagemCrua[] } }>(conversaId, { fields: campos }, opcoes);
  return Array.isArray(corpo.messages?.data) ? corpo.messages.data : [];
}

export interface ConversaAchada {
  conversa: ConversaCrua;
  participante: { id: string; username: string | null };
  /** Quantas conversas foram olhadas até achar. */
  varridas: number;
}

function normalizarAlvo(usuario: string): string {
  return usuario.trim().replace(/^@/, "").toLowerCase();
}

/** Varre até 100 conversas e devolve a que tem a pessoa (IGSID ou @) em `participants`. */
export async function acharConversa(ctx: Contexto, usuario: string, opcoes: OpcoesPedido = {}): Promise<ConversaAchada | null> {
  const alvo = normalizarAlvo(usuario);
  if (alvo === "") return null;
  let depois: string | null = null;
  let varridas = 0;
  while (varridas < MAXIMO_DE_CONVERSAS_VARRIDAS) {
    await ctx.espacador.esperar(opcoes.signal);
    const pagina: { itens: ConversaCrua[]; proximo: string | null } = await ctx.graph.pagina<ConversaCrua>(
      `${ctx.config.contaId}/conversations`,
      { platform: "instagram", fields: CAMPOS_CONVERSA },
      Math.min(CONVERSAS_POR_PAGINA, MAXIMO_DE_CONVERSAS_VARRIDAS - varridas),
      depois,
      opcoes,
    );
    for (const conversa of pagina.itens) {
      varridas++;
      for (const participante of conversa.participants?.data ?? []) {
        if (!participante.id || participante.id === ctx.config.contaId) continue;
        if (participante.id === alvo || (participante.username ?? "").toLowerCase() === alvo) {
          return { conversa, participante: { id: participante.id, username: participante.username ?? null }, varridas };
        }
      }
    }
    depois = pagina.proximo;
    if (depois === null || pagina.itens.length === 0) return null;
  }
  return null;
}

export type JanelaDoUsuario =
  | { encontrada: false }
  | { encontrada: true; conversa_id: string; usuario_id: string; username: string | null; janela: Janela };

/** Acha a conversa da pessoa, lê as mensagens e calcula a janela. A ficha 06 usa isto antes de responder. */
export async function janelaDoUsuario(ctx: Contexto, usuario: string, opcoes: OpcoesPedido = {}): Promise<JanelaDoUsuario> {
  const achada = await acharConversa(ctx, usuario, opcoes);
  if (!achada) return { encontrada: false };
  const mensagens = await lerMensagens(ctx, achada.conversa.id, opcoes, "messages{id,created_time,from}");
  return {
    encontrada: true,
    conversa_id: achada.conversa.id,
    usuario_id: achada.participante.id,
    username: achada.participante.username,
    janela: calcularJanela(mensagens, ctx.config.contaId, Date.now()),
  };
}
