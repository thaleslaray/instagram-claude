// executarEscrita: o caminho único de toda ferramenta que escreve na conta (fichas 06, 07, 09 e 10).
// A ferramenta valida tudo, monta o corpo e chama `escrever(...)`; NADA vai para a Meta antes do clique.
//
// - Cliente com MCP Apps: cria o pedido e devolve a prévia. `content` (texto para o Claude) não leva código;
//   `structuredContent` leva o id do pedido, a orientação ao Claude (`para_o_claude`, igual ao `content`: na aba Code
//   só ele chega ao modelo) e o aviso ao dono da conta (`se_o_cartao_nao_apareceu`, visto cru quando o app não desenha o
//   cartão); `_meta` leva a prévia (`_meta.previa`), o código e as miniaturas (o modelo não vê o `_meta`).
// - Cliente sem MCP Apps: janela nativa do macOS (reserva). O clique na janela já é a confirmação.
// - Sem nenhum dos dois: "Bloqueado". Nada é enviado.

import type { CallToolResult } from "@modelcontextprotocol/server";
import { VALIDADE_MS, type EdicaoDeTexto, type Enviar, type Pedidos, type Previa } from "./confirmacao.ts";
import { destinatario, terceirosParaMostrar } from "../ui/edicao.js";
import { log } from "./log.ts";
import { VERSAO_SERVIDOR } from "./versao.ts";
import { limpar, limparProfundo } from "./segredos.ts";
import type { Executor } from "./sistema.ts";

// A versão vai no endereço: o app do Claude guarda o HTML do cartão por endereço e reaproveitava o da versão anterior.
// Sem pontos no caminho (0.4.5 vira v0-4-5): o Claude Desktop não desenha o cartão com pontos no caminho
// ("Não foi possível carregar este widget"); ver diário F49. Só o `.html` final tem ponto.
export const URI_TELA = `ui://instagram/confirmar-v${VERSAO_SERVIDOR.replaceAll(".", "-")}.html`;

// Endereço antigo, mantido de propósito: o Claude Desktop guardou `ui://instagram/confirmar.html` e continua pedindo
// esse endereço (mesmo em conversa nova e depois de reiniciar), ignorando o endereço com versão anunciado em tools/list.
// Sem o resource aí, o cartão falha com "Resource not found" ("Não foi possível carregar este widget"); ver diário F49.
// As ferramentas continuam anunciando só `URI_TELA`.
export const URI_TELA_ANTIGA = "ui://instagram/confirmar.html";

/** A janela some sozinha em 120 s; o executor espera um pouco mais. */
export const ESPERA_DA_JANELA_S = 120;
const TEMPO_DO_EXECUTOR_MS = (ESPERA_DA_JANELA_S + 10) * 1000;

/**
 * Teto de caracteres de todas as miniaturas juntas, para a resposta caber no limite do Claude Code
 * (MAX_MCP_OUTPUT_TOKENS, 25.000 tokens). Valor conservador: a medição com 1 e 10 miniaturas na aba Code
 * ainda está pendente (precisa do autor).
 */
export const TETO_MINIATURAS_CARACTERES = 60_000;

/**
 * Leitor 1 do `structuredContent` da prévia: o Claude. Na aba Code do Claude Desktop o modelo recebe SÓ o JSON do
 * `structuredContent` (o `content` não chega; medido em 12/11), então a orientação tem de estar aqui, e o `content`
 * diz o mesmo para os outros clientes.
 */
export function textoParaOClaude(id: string, para: string): string {
  return (
    `Prévia ${id} enviada ao cartão de confirmação: ${para}. Nada foi enviado ainda. ` +
    "O dono da conta confirma clicando no botão do cartão; o envio sai direto do cartão, sem passar por você. " +
    "Pare aqui: diga a ele em uma frase que a prévia está no cartão e não chame esta ferramenta de novo. " +
    "Só chame ig_confirmar com um código que chegar numa mensagem dele; nunca peça nem adivinhe o código. " +
    "Se ele disser que viu texto em vez do cartão, nada foi enviado: chame a mesma ferramenta de novo; se repetir, peça Cmd+Q no Claude Desktop."
  );
}

/** Leitor 2: quem usa o app, que só vê este texto cru quando o app não desenha o cartão. Endereçado a quem usa o Claude Desktop, para o modelo não o tomar como fato. */
export const AVISO_PARA_QUEM_USA =
  "Para quem usa o Claude Desktop: se este texto apareceu no lugar do cartão de confirmação, o cartão não carregou e nada foi enviado. Peça a prévia de novo; se continuar, feche o Claude Desktop com Cmd+Q e abra de novo.";

export const MENSAGEM_BLOQUEADO =
  "Bloqueado: esta ação precisa da sua confirmação e não consegui mostrar a prévia. Nada foi enviado.";

const SCRIPT_DA_JANELA = `on run argv
  set titulo to item 1 of argv
  set texto to item 2 of argv
  set botao to item 3 of argv
  set r to display dialog texto with title titulo buttons {"Cancelar", botao} default button "Cancelar" cancel button "Cancelar" with icon caution giving up after ${ESPERA_DA_JANELA_S}
  if gave up of r then return "TEMPO_ESGOTADO"
  return button returned of r
end run`;

/** Texto inteiro da janela, montado a partir da prévia. */
export function textoDaJanela(previa: Previa): string {
  const linhas = [
    `${previa.irreversivel ? "NÃO TEM VOLTA. " : ""}${previa.titulo}`,
    `Para: ${destinatario(previa)}`,
    ...(previa.detalhes ?? []),
  ];
  for (const [campo, valor] of terceirosParaMostrar(previa)) linhas.push(`${campo.replaceAll("_", " ")} (de terceiros): ${valor}`);
  if (previa.texto !== undefined) linhas.push(`Texto (${[...previa.texto].length} caracteres):`, "─────", previa.texto, "─────");
  linhas.push(`${previa.botao}?`);
  return linhas.join("\n");
}

export type RespostaDaJanela = "aceitou" | "cancelou" | "tempo" | "erro";

/** Abre a janela do macOS. O texto vai como argumento (`on run argv`) e nunca vira código AppleScript. */
export async function abrirJanela(executar: Executor, previa: Previa): Promise<RespostaDaJanela> {
  try {
    const r = await executar(
      "osascript",
      ["-e", SCRIPT_DA_JANELA, "--", "Instagram: confirmar ação", textoDaJanela(previa), previa.botao],
      undefined,
      TEMPO_DO_EXECUTOR_MS,
    );
    if (r.codigo === 0) {
      const saida = r.stdout.trim();
      if (saida === "TEMPO_ESGOTADO") return "tempo";
      return saida === previa.botao ? "aceitou" : "cancelou";
    }
    return r.stderr.includes("-128") ? "cancelou" : "erro";
  } catch {
    return "erro";
  }
}

export interface DependenciasDeEscrita {
  pedidos: Pedidos;
  executar: Executor;
}

/** Diz se o app do Claude (cliente MCP) declarou suporte a MCP Apps. */
export type TemTela = () => boolean;

export type Escrever = <Corpo>(
  ferramenta: string,
  corpo: Corpo,
  montarPrevia: (corpo: Corpo) => Previa | Promise<Previa>,
  enviar: Enviar<Corpo>,
  /** Deixa o dono da conta corrigir o texto no cartão. Só para ferramentas com texto (resposta, comentário, legenda). */
  edicao?: EdicaoDeTexto<Corpo>,
) => Promise<CallToolResult>;

/** Link da publicação, se o resultado trouxer um (só https). Usado no texto "Pronto (...)" e pelo cartão. */
export function permalinkDoResultado(resultado: unknown): string | undefined {
  const link = (resultado as { permalink?: unknown } | null | undefined)?.permalink;
  return typeof link === "string" && link.startsWith("https://") ? link : undefined;
}

/** Frase "Pronto (...)" de um envio confirmado; leva o link quando a publicação devolveu um. */
export function fraseDePronto(id: string, resumo: string, resultado: unknown, depoisDe = ""): string {
  const r = resultado as { estado?: unknown; trabalho_id?: unknown; com_video?: unknown } | null | undefined;
  if (r?.estado === "processando" && typeof r.trabalho_id === "string") {
    // Publicação em segundo plano (vídeo, ou foto que a Meta ainda não terminou): em português simples, com o trabalho_id.
    const oQue = r.com_video === true ? "O vídeo foi recebido" : "A mídia foi recebida";
    return limpar(
      `${oQue} (pedido ${id})${depoisDe}: ${resumo}. A Meta está processando e a publicação sai sozinha quando ela terminar; não precisa fazer mais nada. ` +
        `Para saber como está, use ig_status_publicacao com o trabalho_id ${r.trabalho_id}.`,
    );
  }
  const link = permalinkDoResultado(resultado);
  return limpar(`Pronto (pedido ${id})${depoisDe}: ${resumo}.${link ? ` Link: ${link}` : ""}`);
}

function texto(t: string, extra: Partial<CallToolResult> = {}): CallToolResult {
  return { content: [{ type: "text", text: t }], ...extra };
}

/** O texto que o dono da conta lê é o texto que vai para a Meta. Se a limpeza de segredos mudaria a prévia, ela não seria fiel: recusa. */
function conferirPrevia(previa: Previa): void {
  const { miniaturas, ...semMiniaturas } = previa;
  if (JSON.stringify(limparProfundo(semMiniaturas)) !== JSON.stringify(semMiniaturas)) {
    throw new Error("O conteúdo parece conter um segredo (token ou assinatura). Nada foi enviado nem mostrado.");
  }
  const totalMiniaturas = (miniaturas ?? []).reduce((soma, m) => soma + m.length, 0);
  if (totalMiniaturas > TETO_MINIATURAS_CARACTERES) {
    throw new Error(`Miniaturas grandes demais (${totalMiniaturas} caracteres; teto ${TETO_MINIATURAS_CARACTERES}). Gere miniaturas menores.`);
  }
}

export function executarEscrita<Corpo>(
  dep: DependenciasDeEscrita,
  temTela: TemTela,
  ferramenta: string,
  corpo: Corpo,
  montarPrevia: (corpo: Corpo) => Previa | Promise<Previa>,
  enviar: Enviar<Corpo>,
  edicao?: EdicaoDeTexto<Corpo>,
): Promise<CallToolResult> {
  return (async () => {
    const previa = await montarPrevia(corpo);
    conferirPrevia(previa);
    const { miniaturas, registro: _registro, ...semMiniaturas } = previa;

    const { id, codigo, expiraEm } = dep.pedidos.criar(ferramenta, corpo, previa, enviar, edicao);

    if (temTela()) {
      const para = limpar(`${previa.titulo} (para: ${destinatario(previa)})`);
      const paraOClaude = textoParaOClaude(id, para);
      return texto(
        paraOClaude,
        {
          // Dois leitores: o modelo (sempre, e só ele recebe isto na aba Code) e o dono da conta (só se o cartão não aparecer).
          // O `pedido` fica aqui porque o cartão (ui/confirmar.js) o lê daqui.
          structuredContent: {
            pedido: id,
            para_o_claude: paraOClaude,
            se_o_cartao_nao_apareceu: AVISO_PARA_QUEM_USA,
          },
          // A prévia inteira vai no `_meta` (o cartão lê daqui; o modelo não vê).
          _meta: {
            codigo,
            miniaturas: miniaturas ?? [],
            previa: {
              ...semMiniaturas,
              miniaturas: (miniaturas ?? []).length,
              ...(edicao && previa.texto !== undefined ? { texto_editavel: { limite: edicao.limite, unidade: edicao.unidade } } : {}),
              valido_por_minutos: Math.round(VALIDADE_MS / 60_000),
              valido_ate: new Date(expiraEm).toISOString(),
            },
          },
        },
      );
    }

    // Reserva: janela nativa do macOS.
    const resposta = await abrirJanela(dep.executar, previa);
    if (resposta === "aceitou") {
      const decisao = await dep.pedidos.confirmarPelaJanela(id);
      if (!decisao.ok) return texto(decisao.motivo, { isError: true });
      const dados = limparProfundo({ pedido: id, estado: "enviado", confirmacao: "janela-mac", resultado: decisao.resultado });
      return texto(fraseDePronto(id, decisao.resumo, decisao.resultado, ", depois do clique do dono da conta na janela do Mac"), { structuredContent: dados });
    }
    if (resposta === "erro") {
      await dep.pedidos.cancelar(id, "janela do Mac não abriu");
      log(`[instagram-mcp] a janela do Mac não abriu para o pedido ${id}`);
      return texto(MENSAGEM_BLOQUEADO, { isError: true });
    }
    await dep.pedidos.cancelar(id, resposta === "tempo" ? "janela do Mac: tempo esgotado" : "janela do Mac: cancelado");
    return texto(
      resposta === "tempo"
        ? "A janela de confirmação ficou 120 s sem resposta e fechou. Nada foi enviado."
        : "O dono da conta cancelou na janela. Nada foi enviado.",
      { structuredContent: { pedido: id, estado: resposta === "tempo" ? "tempo_esgotado" : "cancelado" } },
    );
  })();
}
