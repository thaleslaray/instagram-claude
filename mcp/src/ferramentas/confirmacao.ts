// Confirmação pela tela no chat (spec 5.3): a tela (resource ui://) e as ferramentas que a servem.
// - ig_confirmar: visível ao modelo; só funciona com o código que chegou numa mensagem do dono da conta.
// - ig_confirmar_tela, ig_cancelar_pedido e ig_estado_pedido_tela: visibility ["app"], chamadas direto pela tela (quando o app do Claude tem serverTools).
// - ig_cancelar: o cancelamento por mensagem ("Cancelo o pedido <id>.").

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";
import type { CaminhoDeConfirmacao } from "../confirmacao.ts";
import type { Contexto } from "../contexto.ts";
import { fraseDePronto, URI_TELA, URI_TELA_ANTIGA } from "../escrita.ts";
import { ANOTACOES_LEITURA, registrarApoioDeConfirmacao } from "../respostas.ts";
import { limparProfundo } from "../segredos.ts";
import { HTML_CONFIRMAR } from "../ui-gerada.ts";

// Argumentos estritos: nada além de id, código e, quando o dono da conta editou o texto no cartão, o `texto` dele.
// O servidor só aceita um `texto` cujo código seja SHA-256(código do pedido + "\n" + texto): o modelo nunca vê o
// código do pedido, então não consegue aprovar um texto que o dono da conta não viu.
const EntradaConfirmar = z.strictObject({
  id: z.string().min(1).max(64).describe("Id do pedido, o mesmo da prévia"),
  codigo: z.string().min(1).max(128).describe("Código que chegou numa mensagem do dono da conta depois do clique dele. Nunca peça nem adivinhe."),
  texto: z
    .string()
    .max(20_000)
    .optional()
    .describe("Só passe `texto` quando a mensagem do dono da conta trouxer o texto editado; copie exatamente, sem mudar nada"),
});
const EntradaCancelar = z.strictObject({ id: z.string().min(1).max(64).describe("Id do pedido a cancelar") });

const ESCRITA_SEM_VOLTA = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;
const CANCELAR = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export function registrarConfirmacao(server: McpServer, ctx: Contexto): void {
  // O mesmo cartão em dois endereços: o com versão (anunciado) e o antigo (que o Claude Desktop guardou e continua pedindo).
  for (const [nome, uri] of [
    ["Confirmar ação no Instagram", URI_TELA],
    ["Confirmar ação no Instagram (endereço antigo)", URI_TELA_ANTIGA],
  ] as const) {
    registerAppResource(
      server,
      nome,
      uri,
      { description: "Cartão com a prévia (conta, alvo, texto inteiro, miniaturas, cota) e os botões Cancelar e de ação." },
      async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: HTML_CONFIRMAR, _meta: { ui: { prefersBorder: true } } }] }),
    );
  }

  async function confirmar(id: string, codigo: string, caminho: CaminhoDeConfirmacao, texto?: string): Promise<CallToolResult> {
    const decisao = await ctx.pedidos.confirmar(id, codigo, caminho, texto);
    if (!decisao.ok) return { isError: true, content: [{ type: "text", text: decisao.motivo }] };
    const dados = limparProfundo({ pedido: id, estado: "enviado", resultado: decisao.resultado });
    return { content: [{ type: "text", text: fraseDePronto(id, decisao.resumo, decisao.resultado) }], structuredContent: dados };
  }

  async function cancelar(id: string, origem: string): Promise<CallToolResult> {
    const r = await ctx.pedidos.cancelar(id, origem);
    return { ...(r.ok ? {} : { isError: true }), content: [{ type: "text", text: r.mensagem }] };
  }

  registrarApoioDeConfirmacao(
    server,
    "ig_confirmar",
    ESCRITA_SEM_VOLTA,
    undefined,
    {
      title: "Confirmar pedido do Instagram",
      description:
        "Envia de verdade um pedido que já mostrou a prévia. SÓ chame depois que o dono da conta clicar no botão da prévia e uma mensagem dele trouxer o id e o código " +
        '("Confirmo o pedido <id>, código <codigo>."). Nunca peça o código a ele nem tente adivinhar. Envia exatamente o conteúdo da prévia. ' +
        "Se o dono da conta corrigiu o texto no cartão, a mensagem dele traz o código e o texto editado (\"Confirmo o pedido <id>, código <codigo>, com este texto:\" e o texto numa linha nova): " +
        "só passe `texto` quando a mensagem do dono da conta trouxer o texto editado; copie exatamente, sem mudar nada. Não aceita nenhum outro parâmetro.",
      inputSchema: EntradaConfirmar,
    },
    async ({ id, codigo, texto }) => confirmar(id, codigo, "ig_confirmar", texto),
  );

  registrarApoioDeConfirmacao(
    server,
    "ig_confirmar_tela",
    ESCRITA_SEM_VOLTA,
    ["app"],
    {
      title: "Confirmar pedido (chamada da tela)",
      description: "Chamada só pela tela de confirmação, quando o app do Claude deixa a tela chamar ferramentas. Não é para o modelo.",
      inputSchema: EntradaConfirmar,
    },
    async ({ id, codigo, texto }) => confirmar(id, codigo, "ig_confirmar_tela", texto),
  );

  registrarApoioDeConfirmacao(
    server,
    "ig_cancelar_pedido",
    CANCELAR,
    ["app"],
    {
      title: "Cancelar pedido (chamada da tela)",
      description: "Chamada só pela tela de confirmação, no botão Cancelar. Não é para o modelo.",
      inputSchema: EntradaCancelar,
    },
    async ({ id }) => cancelar(id, "ig_cancelar_pedido (clique na tela)"),
  );

  // Leitura: o cartão que o Claude Desktop recriou pergunta como está o pedido (já enviado? venceu?) e se ajusta.
  registrarApoioDeConfirmacao(
    server,
    "ig_estado_pedido_tela",
    ANOTACOES_LEITURA,
    ["app"],
    {
      title: "Estado do pedido (chamada da tela)",
      description: "Chamada só pela tela de confirmação, ao abrir, para saber se o pedido já foi enviado. Não é para o modelo.",
      inputSchema: EntradaCancelar,
    },
    async ({ id }) => {
      const situacao = ctx.pedidos.situacao(id);
      const frases: Record<typeof situacao.estado, string> = {
        pendente: `Pedido ${id} aguardando o clique. Nada foi enviado.`,
        enviando: `Pedido ${id} confirmado; o envio ainda não voltou.`,
        usado: `Pedido ${id} já foi enviado.`,
        falhou: `O envio do pedido ${id} falhou. Nada foi publicado.`,
        cancelado: `Pedido ${id} foi cancelado. Nada foi enviado.`,
        expirado: `Pedido ${id} venceu. Nada foi enviado.`,
        inexistente: `Pedido ${id} não existe (pode ter expirado ou o servidor reiniciou). Nada foi enviado.`,
      };
      const dados = limparProfundo({ pedido: id, estado: situacao.estado, ...(situacao.resultado ? { resultado: situacao.resultado } : {}) });
      return { content: [{ type: "text", text: frases[situacao.estado] }], structuredContent: dados };
    },
  );

  registrarApoioDeConfirmacao(
    server,
    "ig_cancelar",
    CANCELAR,
    undefined,
    {
      title: "Cancelar pedido do Instagram",
      description: 'Cancela um pedido pendente quando o dono da conta disser "Cancelo o pedido <id>.". Nada é enviado.',
      inputSchema: EntradaCancelar,
    },
    async ({ id }) => cancelar(id, "ig_cancelar (chamada pelo modelo)"),
  );
}
