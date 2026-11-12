// Tradução dos erros da Graph (spec 4.7) para frases em português.
// A Meta responde no idioma da conta (às vezes em português), então a tradução
// é decidida por `code` e `error_subcode`, nunca pelo texto. O texto original
// vai junto, depois de passar pela limpeza de segredos.

import { ehExtensao } from "./config.ts";
import { limpar } from "./segredos.ts";

/** Formato do campo `error` que a Graph devolve. */
export interface ErroMetaBruto {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
}

export interface DetalheErroGraph {
  status: number;
  code: number | null;
  error_subcode: number | null;
  fbtrace_id: string | null;
  /** Mensagem original da Meta, já limpa de segredos. */
  mensagem_meta: string;
  /** Frase em português que explica o que fazer. */
  frase: string;
}

export class ErroGraph extends Error {
  override name = "ErroGraph";
  readonly detalhe: DetalheErroGraph;
  constructor(detalhe: DetalheErroGraph) {
    const codigos = [
      detalhe.code !== null ? `code ${detalhe.code}` : null,
      detalhe.error_subcode !== null ? `subcode ${detalhe.error_subcode}` : null,
      detalhe.fbtrace_id !== null ? `fbtrace_id ${detalhe.fbtrace_id}` : null,
      `HTTP ${detalhe.status}`,
    ].filter((parte) => parte !== null);
    const original = detalhe.mensagem_meta ? `Detalhe da Meta: ${detalhe.mensagem_meta} ` : "Detalhe da Meta: ";
    super(`${detalhe.frase}\n${original}(${codigos.join(", ")}).`);
    this.detalhe = detalhe;
  }
  get code(): number | null {
    return this.detalhe.code;
  }
  get error_subcode(): number | null {
    return this.detalhe.error_subcode;
  }
  get fbtrace_id(): string | null {
    return this.detalhe.fbtrace_id;
  }
}

const FRASE_TOKEN_NA_EXTENSAO =
  "Token inválido ou revogado (190): gere outro no painel da Meta (usuário do sistema do login unificado) e cole-o no campo do token, nas configurações da extensão Instagram no Claude Desktop.";

const LIMITE_DE_CHAMADAS = new Set([4, 17, 32, 613]);

/**
 * Subcódigos da Meta para "mensagem fora da janela permitida" (código 10).
 * SEM FONTE: 2534022 e 2018278 foram escritos de memória; não estão na doc do Instagram nem apareceram nas provas.
 * Por isso a frase correspondente (FRASES.foraDaJanela) diz "provável" e manda conferir o detalhe original.
 */
const SUBCODES_DE_JANELA = new Set([2534022, 2018278]);

export const FRASES = {
  token:
    "Token inválido ou revogado (190): gere outro no painel da Meta (usuário do sistema do login unificado) e rode `npm run guardar-token` no terminal.",
  permissao:
    "A Meta recusou por permissão (#10): falta uma permissão na configuração do app ou a conta não é profissional (comercial ou de criador).",
  contaNaoProfissional:
    "A conta não é profissional (#10): essa função só vale para conta comercial ou de criador.",
  dmDesligada:
    "Acesso às mensagens desligado (#200): no app do Instagram da conta, ligue Configurações > Mensagens e respostas > Ferramentas conectadas > \"Permitir acesso às mensagens\".",
  limitePublicacao:
    "Limite de publicação atingido: a conta já publicou o máximo permitido nas últimas 24 h. Espere a janela andar antes de publicar de novo.",
  limiteChamadas:
    "Limite de chamadas da Meta atingido: espere alguns minutos e tente de novo. O servidor não repete sozinho.",
  naoExiste:
    "Esse objeto não existe (ou foi apagado), ou esta conta não tem acesso a ele. Confira o ID.",
  comentariosDesligados:
    "Os comentários deste post estão desligados (a Meta responde \"Media ID is not found\", que engana). Ligue os comentários ou confira o ID da mídia.",
  foraDaJanela:
    "Fora da janela (provável): a Meta só deixa responder até 24 h depois da última mensagem da pessoa. O código dessa recusa ainda não foi confirmado; confira o detalhe original abaixo.",
  privadoRepetido:
    "Esse comentário já recebeu uma resposta no privado: a Meta só permite uma por comentário.",
  foraDoAr: "A Meta está fora do ar ou instável agora. Tente de novo em alguns minutos.",
  desconhecido: "A Meta recusou o pedido.",
} as const;

function fraseParaCodigo10(mensagem: string): string {
  // Código 10 cobre duas causas. A permissão pedida aparece pelo nome técnico
  // (igual em qualquer idioma); sem ela, a frase cobre os dois casos.
  const permissao = /\b(instagram_[a-z_]+|pages_[a-z_]+)\b/.exec(mensagem)?.[1];
  if (permissao) {
    return `Falta a permissão \`${permissao}\` na configuração do app (#10): adicione-a no painel da Meta e gere o token de novo.`;
  }
  if (/business|creator/i.test(mensagem)) return FRASES.contaNaoProfissional;
  return FRASES.permissao;
}

/** Escolhe a frase em português pelo par code/subcode. */
export function frasePara(code: number | null, subcode: number | null, mensagem: string, status: number): string {
  if (code === 190) return ehExtensao() ? FRASE_TOKEN_NA_EXTENSAO : FRASES.token;
  if (code === 9 || subcode === 2207042) return FRASES.limitePublicacao;
  if (code !== null && LIMITE_DE_CHAMADAS.has(code)) return FRASES.limiteChamadas;
  if (code === 10 && subcode !== null && SUBCODES_DE_JANELA.has(subcode)) return FRASES.foraDaJanela;
  if (code === 10) return fraseParaCodigo10(mensagem);
  if (code === 200) return FRASES.dmDesligada;
  if (code === 9008 || subcode === 4928001) return FRASES.comentariosDesligados;
  if (subcode === 33 || code === 33) return FRASES.naoExiste;
  if (subcode === 2534023) return FRASES.privadoRepetido;
  if (status >= 500) return FRASES.foraDoAr;
  return FRASES.desconhecido;
}

function numeroOuNull(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/** Monta um ErroGraph a partir do corpo de erro da Meta (ou de uma resposta sem corpo útil). */
export function traduzirErroMeta(status: number, corpo: unknown): ErroGraph {
  const bruto: ErroMetaBruto =
    typeof corpo === "object" && corpo !== null && "error" in corpo && typeof corpo.error === "object" && corpo.error !== null
      ? (corpo.error as ErroMetaBruto)
      : {};
  const code = numeroOuNull(bruto.code);
  const subcode = numeroOuNull(bruto.error_subcode);
  const mensagem = limpar([bruto.message, bruto.error_user_msg].filter((m) => typeof m === "string" && m !== "").join(" | "));
  return new ErroGraph({
    status,
    code,
    error_subcode: subcode,
    fbtrace_id: typeof bruto.fbtrace_id === "string" ? bruto.fbtrace_id : null,
    mensagem_meta: mensagem,
    frase: frasePara(code, subcode, mensagem, status),
  });
}
