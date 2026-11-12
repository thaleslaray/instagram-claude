// Perfis de ferramentas (spec 3.12, ideia do IvanBBaev/instagram-mcp: "Package profiles").
// O perfil é lido na partida (IG_PERFIL) e decide QUAIS ferramentas existem. Funciona de forma genérica:
// o filtro olha o grupo da ferramenta (tabela abaixo) e a anotação `readOnlyHint` dela, então uma
// ferramenta de escrita que entrar depois já nasce obedecendo ao perfil.

import type { McpServer, RegisteredTool, ToolAnnotations } from "@modelcontextprotocol/server";
import { ErroConfig, lerCampo } from "./config.ts";

export const GRUPOS = ["conta", "midias", "dms", "comentarios", "publicacao", "insights", "descoberta", "confirmacao", "sistema"] as const;
export type Grupo = (typeof GRUPOS)[number];

export const PERFIS = ["completo", "leitura", "publicar", "atendimento"] as const;
export type Perfil = (typeof PERFIS)[number];

/**
 * Grupo de cada ferramenta. Toda ferramenta do servidor está aqui, e toda entrada daqui existe no servidor
 * (os dois lados são conferidos em test/perfis.test.ts).
 * Ferramenta fora desta tabela só existe no perfil `completo` (ou no `leitura`, se for de leitura).
 * `ig_estado_do_token` está no grupo `sistema`, que nenhum perfil remove.
 */
export const GRUPO_DA_FERRAMENTA: Readonly<Record<string, Grupo>> = {
  ig_estado_do_token: "sistema",
  ig_conta: "conta",
  ig_listar_midias: "midias",
  ig_ver_midia: "midias",
  ig_listar_stories: "midias",
  ig_listar_marcacoes: "midias",
  ig_perfil_publico: "descoberta",
  ig_insights_conta: "insights",
  ig_insights_midia: "insights",
  ig_listar_conversas: "dms",
  ig_ler_conversa: "dms",
  ig_ver_mensagem: "dms",
  ig_perfil_contato: "dms",
  ig_confirmar: "confirmacao",
  ig_confirmar_tela: "confirmacao",
  ig_cancelar_pedido: "confirmacao",
  ig_estado_pedido_tela: "confirmacao",
  ig_cancelar: "confirmacao",
  ig_responder_dm: "dms",
  ig_enviar_midia_dm: "dms",
  ig_reagir_dm: "dms",
  ig_listar_comentarios: "comentarios",
  ig_ver_comentario: "comentarios",
  ig_listar_respostas: "comentarios",
  ig_responder_comentario: "comentarios",
  ig_responder_no_privado: "comentarios",
  ig_comentar_midia: "comentarios",
  ig_esconder_comentario: "comentarios",
  ig_apagar_comentario: "comentarios",
  ig_ligar_comentarios: "comentarios",
  ig_publicar_post: "publicacao",
  ig_publicar_carrossel: "publicacao",
  ig_publicar_reels: "publicacao",
  ig_publicar_story: "publicacao",
  ig_status_publicacao: "publicacao",
  ig_limite_publicacao: "publicacao",
};

/**
 * Grupos a mais de uma ferramenta, além do principal da tabela acima. `ig_responder_no_privado` é um comentário
 * que manda DM: `IG_GRUPOS_SO_LEITURA=dms` também a tira. (Quem está no perfil só precisa do grupo principal.)
 */
const GRUPOS_EXTRAS: Readonly<Record<string, readonly Grupo[]>> = {
  ig_responder_no_privado: ["dms"],
};

const GRUPOS_DO_PERFIL: Record<Perfil, readonly Grupo[]> = {
  completo: GRUPOS,
  leitura: GRUPOS,
  publicar: ["conta", "midias", "publicacao", "comentarios", "confirmacao", "sistema"],
  atendimento: ["conta", "dms", "comentarios", "confirmacao", "sistema"],
};

export interface Politica {
  perfil: Perfil;
  grupos: ReadonlySet<Grupo>;
  /** Grupos em que só as ferramentas de leitura valem (IG_GRUPOS_SO_LEITURA). No perfil `leitura`, são todos. */
  soLeitura: ReadonlySet<Grupo>;
}

const ALIAS_DE_GRUPO: Record<string, Grupo> = { conversas: "dms", dm: "dms", comentario: "comentarios", midia: "midias" };

export function criarPolitica(perfil: Perfil = "completo", soLeitura: readonly Grupo[] = []): Politica {
  return {
    perfil,
    grupos: new Set(GRUPOS_DO_PERFIL[perfil]),
    soLeitura: new Set(perfil === "leitura" ? GRUPOS : soLeitura),
  };
}

type Ambiente = Record<string, string | undefined>;

export function lerPolitica(env: Ambiente = process.env): Politica {
  const bruto = lerCampo(env, "IG_PERFIL").toLowerCase() || "completo";
  if (!(PERFIS as readonly string[]).includes(bruto)) {
    throw new ErroConfig(`IG_PERFIL inválido (${bruto}): use ${PERFIS.join(", ")}.`);
  }
  const soLeitura: Grupo[] = [];
  for (const parte of (env.IG_GRUPOS_SO_LEITURA ?? "").split(",")) {
    const nome = parte.trim().toLowerCase();
    if (nome === "") continue;
    const grupo = ALIAS_DE_GRUPO[nome] ?? (GRUPOS as readonly string[]).find((g) => g === nome);
    if (!grupo) throw new ErroConfig(`IG_GRUPOS_SO_LEITURA inválido (${nome}): use ${GRUPOS.join(", ")}.`);
    soLeitura.push(grupo as Grupo);
  }
  return criarPolitica(bruto as Perfil, soLeitura);
}

/** Decide se a ferramenta existe no perfil. Lê o grupo da tabela e a anotação `readOnlyHint`. */
export function permite(politica: Politica, nome: string, anotacoes: ToolAnnotations | undefined): boolean {
  const leitura = anotacoes?.readOnlyHint === true;
  const grupo = GRUPO_DA_FERRAMENTA[nome];
  if (grupo === undefined) return politica.perfil === "completo" || (politica.perfil === "leitura" && leitura);
  if (!politica.grupos.has(grupo)) return false;
  // Sem escrita não há cartão: ig_estado_pedido_tela (leitura, mas só da tela) não faz sentido no perfil `leitura`.
  if (grupo === "confirmacao" && politica.perfil === "leitura") return false;
  return leitura || ![grupo, ...(GRUPOS_EXTRAS[nome] ?? [])].some((g) => politica.soLeitura.has(g));
}

export interface FerramentasRegistradas {
  /** Nomes que passaram pelo filtro e foram registradas. */
  readonly registradas: ReadonlySet<string>;
  /** Nomes que o perfil barrou. */
  readonly barradas: ReadonlySet<string>;
}

/**
 * Faz `server.registerTool` respeitar a política: quem não passa nem chega a ser registrado.
 * Troca o método NA instância (o servidor continua o mesmo objeto, o que o resto do código espera).
 */
export function aplicarPolitica(server: McpServer, politica: Politica): FerramentasRegistradas {
  const registradas = new Set<string>();
  const barradas = new Set<string>();
  const original = server.registerTool.bind(server) as (nome: string, config: { annotations?: ToolAnnotations }, cb: unknown) => RegisteredTool;
  const barrada = { enable() {}, disable() {}, remove() {}, update() {} } as unknown as RegisteredTool;
  (server as unknown as { registerTool: typeof original }).registerTool = (nome, config, cb) => {
    if (!permite(politica, nome, config.annotations)) {
      barradas.add(nome);
      return barrada;
    }
    registradas.add(nome);
    return original(nome, config, cb);
  };
  return { registradas, barradas };
}
