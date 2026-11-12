// Ajudantes comuns a todas as ferramentas:
// - registrarLeitura / registrarEscrita, que já põem as anotações;
// - respostaJson: structuredContent + o mesmo JSON em texto;
// - paginaNoTeto: teto de 25.000 caracteres, devolvendo menos itens e o cursor do próximo;
// - todo erro vira resultado `isError` com texto limpo de segredos.

import { CLIENT_CAPABILITIES_META_KEY, type CallToolResult, type ClientCapabilities, type McpServer, type RegisteredTool, type ServerContext, type StandardSchemaWithJSON, type ToolAnnotations, type ToolCallback } from "@modelcontextprotocol/server";
import { getUiCapability } from "@modelcontextprotocol/ext-apps/server";
import type { Contexto } from "./contexto.ts";
import { executarEscrita, URI_TELA, type Escrever } from "./escrita.ts";
import { limpar } from "./segredos.ts";
import type { Pagina } from "./graph.ts";

/** Teto de caracteres do texto de cada resposta. */
export const LIMITE_CARACTERES = 25_000;

export const ANOTACOES_LEITURA: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export interface TipoEscrita {
  /** Apaga ou sobrescreve algo (ex.: apagar comentário). */
  destrutiva: boolean;
  /** Repetir com os mesmos argumentos não tem efeito extra (ex.: esconder comentário). */
  idempotente: boolean;
}

export function anotacoesEscrita(tipo: TipoEscrita): ToolAnnotations {
  return { readOnlyHint: false, destructiveHint: tipo.destrutiva, idempotentHint: tipo.idempotente, openWorldHint: true };
}

export interface DefinicaoFerramenta<Entrada extends StandardSchemaWithJSON, Saida extends StandardSchemaWithJSON> {
  title: string;
  description: string;
  inputSchema: Entrada;
  /** Só nas ferramentas que sempre devolvem JSON. */
  outputSchema?: Saida;
}

type Manipulador<Entrada extends StandardSchemaWithJSON> = (
  args: StandardSchemaWithJSON.InferOutput<Entrada>,
  ctx: ServerContext,
) => Promise<CallToolResult>;

export function textoDoErro(erro: unknown): string {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return limpar(mensagem);
}

export function respostaErro(erro: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: textoDoErro(erro) }] };
}

/** structuredContent + o mesmo JSON em texto (a spec do MCP pede os dois). */
export function respostaJson(dados: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(dados, null, 2) }], structuredContent: dados };
}

/** Visibilidade de uma ferramenta para o app do Claude (MCP Apps). */
export interface MetaDeTela {
  /** `["app"]` esconde a ferramenta do modelo; o padrão da spec é modelo e app. */
  visibility?: Array<"model" | "app">;
}

function metaDaTela(visibilidade?: MetaDeTela["visibility"]): Record<string, unknown> {
  // A chave plana `ui/resourceUri` é a forma antiga, para clientes mais velhos.
  return { ui: { resourceUri: URI_TELA, ...(visibilidade ? { visibility: visibilidade } : {}) }, "ui/resourceUri": URI_TELA };
}

// O servidor é criado de novo a cada chamada, mas o Contexto é um só: fabricaDeServidor liga um ao outro
// aqui, para registrarEscrita achar os pedidos pendentes sem mudar a assinatura que as outras fichas usam.
const contextos = new WeakMap<McpServer, Contexto>();

export function vincularContexto(server: McpServer, ctx: Contexto): void {
  contextos.set(server, ctx);
}

function contextoDe(server: McpServer): Contexto {
  const ctx = contextos.get(server);
  if (!ctx) throw new Error("Servidor sem Contexto: chame vincularContexto(server, ctx) em fabricaDeServidor.");
  return ctx;
}

/** O app do Claude declarou MCP Apps? (clientes de 2025: capacidades da conexão; de 2026-07-28: no pedido.) */
export function clienteTemTela(server: McpServer, mcp: ServerContext): boolean {
  const doPedido = (mcp.mcpReq.envelope as Record<string, unknown> | undefined)?.[CLIENT_CAPABILITIES_META_KEY];
  const capacidades = (doPedido as ClientCapabilities | undefined) ?? server.server.getClientCapabilities();
  const ui = getUiCapability(capacidades);
  return ui !== undefined && (ui.mimeTypes === undefined || ui.mimeTypes.includes("text/html;profile=mcp-app"));
}

function registrar<Entrada extends StandardSchemaWithJSON, Saida extends StandardSchemaWithJSON>(
  server: McpServer,
  nome: string,
  definicao: DefinicaoFerramenta<Entrada, Saida>,
  annotations: ToolAnnotations,
  manipulador: Manipulador<Entrada>,
  meta?: Record<string, unknown>,
): RegisteredTool {
  if (!nome.startsWith("ig_")) throw new Error(`Ferramenta ${nome} sem o prefixo ig_.`);
  const envolvido: Manipulador<Entrada> = async (args, ctx) => {
    try {
      return await manipulador(args, ctx);
    } catch (erro) {
      return respostaErro(erro);
    }
  };
  return server.registerTool<Saida, Entrada>(
    nome,
    { ...definicao, annotations: { title: definicao.title, ...annotations }, ...(meta ? { _meta: meta } : {}) },
    // O tipo condicional do SDK não se resolve com Entrada genérica; o formato é o mesmo.
    envolvido as ToolCallback<Entrada>,
  );
}

/** Ferramenta de leitura: livre, sem confirmação. */
export function registrarLeitura<Entrada extends StandardSchemaWithJSON, Saida extends StandardSchemaWithJSON>(
  server: McpServer,
  nome: string,
  definicao: DefinicaoFerramenta<Entrada, Saida>,
  manipulador: Manipulador<Entrada>,
): RegisteredTool {
  return registrar(server, nome, definicao, ANOTACOES_LEITURA, manipulador);
}

/**
 * Ferramenta de escrita. O manipulador recebe, como 3º argumento, `escrever(ferramenta, corpo, montarPrevia, enviar)`:
 * ele cria o pedido, mostra a prévia (tela ou janela do Mac) e só envia depois do clique (ficha 03).
 * Toda ferramenta de escrita aponta para a tela de confirmação (`_meta.ui.resourceUri`).
 */
export function registrarEscrita<Entrada extends StandardSchemaWithJSON, Saida extends StandardSchemaWithJSON>(
  server: McpServer,
  nome: string,
  tipo: TipoEscrita,
  definicao: DefinicaoFerramenta<Entrada, Saida>,
  manipulador: (args: StandardSchemaWithJSON.InferOutput<Entrada>, ctx: ServerContext, escrever: Escrever) => Promise<CallToolResult>,
): RegisteredTool {
  return registrar(
    server,
    nome,
    definicao,
    anotacoesEscrita(tipo),
    (args, mcp) => {
      const ctx = contextoDe(server);
      const escrever: Escrever = (ferramenta, corpo, montarPrevia, enviar, edicao) =>
        executarEscrita(ctx, () => clienteTemTela(server, mcp), ferramenta, corpo, montarPrevia, enviar, edicao);
      return manipulador(args, mcp, escrever);
    },
    metaDaTela(),
  );
}

/**
 * Escrita que dá para desfazer (spec 3.6: reagir a DM, esconder comentário...): vai direto, sem prévia nem tela,
 * mas com as anotações de escrita. Quem a usa grava a ação no registro (`ctx.registro`).
 */
export function registrarEscritaDireta<Entrada extends StandardSchemaWithJSON, Saida extends StandardSchemaWithJSON>(
  server: McpServer,
  nome: string,
  tipo: TipoEscrita,
  definicao: DefinicaoFerramenta<Entrada, Saida>,
  manipulador: Manipulador<Entrada>,
): RegisteredTool {
  return registrar(server, nome, definicao, anotacoesEscrita(tipo), manipulador);
}

/** Ferramenta que apoia a confirmação (ig_confirmar, cancelar): não é leitura, mas também não abre tela de prévia. */
export function registrarApoioDeConfirmacao<Entrada extends StandardSchemaWithJSON, Saida extends StandardSchemaWithJSON>(
  server: McpServer,
  nome: string,
  anotacoes: ToolAnnotations,
  visibilidade: MetaDeTela["visibility"] | undefined,
  definicao: DefinicaoFerramenta<Entrada, Saida>,
  manipulador: Manipulador<Entrada>,
): RegisteredTool {
  return registrar(server, nome, definicao, anotacoes, manipulador, visibilidade ? metaDaTela(visibilidade) : undefined);
}

export interface PaginaNoTeto<R> {
  dados: R;
  texto: string;
  /** Quantos itens foram devolvidos (pode ser menos que o limite pedido, por causa do teto). */
  quantidade: number;
  /** true quando o teto obrigou a devolver menos itens. */
  reduzida: boolean;
}

/**
 * Busca uma página e respeita o teto de caracteres devolvendo MENOS itens (nunca cortando texto).
 * Quando a página passa do teto, pede de novo à Meta com um limite menor, para que o
 * cursor `proximo` aponte exatamente para o primeiro item que ficou de fora.
 */
export async function paginaNoTeto<T, R extends Record<string, unknown>>(
  limite: number,
  buscar: (limite: number) => Promise<Pagina<T>>,
  montar: (pagina: Pagina<T>) => R,
  teto: number = LIMITE_CARACTERES,
): Promise<PaginaNoTeto<R>> {
  let atual = limite;
  let reduzida = false;
  for (;;) {
    const pagina = await buscar(atual);
    const dados = montar(pagina);
    const texto = JSON.stringify(dados, null, 2);
    if (texto.length <= teto || pagina.itens.length <= 1) {
      return { dados, texto, quantidade: pagina.itens.length, reduzida };
    }
    atual = Math.max(1, Math.ceil(pagina.itens.length / 2));
    reduzida = true;
  }
}
