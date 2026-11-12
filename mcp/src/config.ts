// Configuração do servidor, lida das variáveis de ambiente.
// Nenhum segredo mora aqui: o token vem do Cofre (cofre.ts).

export const BASE_PADRAO = "https://graph.facebook.com";
export const VERSAO_PADRAO = "v27.0";

export interface Config {
  /** IG ID da conta profissional (com SUAT, `/me` é o usuário do sistema, nunca a conta). */
  contaId: string;
  /** Versão da Graph usada em todo caminho, por exemplo `v27.0`. */
  graphVersao: string;
  /** Host da Graph, sem barra no fim. Só os testes trocam. */
  graphBase: string;
}

export class ErroConfig extends Error {
  override name = "ErroConfig";
}

type Ambiente = Record<string, string | undefined>;

/** Diz se a base aponta para a máquina local (127.0.0.1), o único destino aceito além da Meta. */
export function ehBaseLocal(base: string): boolean {
  try {
    const url = new URL(base);
    return url.protocol === "http:" && url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function lerBase(valor: string | undefined): string {
  if (valor === undefined || valor.trim() === "") return BASE_PADRAO;
  const base = valor.trim().replace(/\/+$/, "");
  if (base === BASE_PADRAO || ehBaseLocal(base)) return base;
  // Qualquer outro host receberia o token no cabeçalho: recusa.
  throw new ErroConfig(
    `IG_GRAPH_BASE inválido (${base}). Use ${BASE_PADRAO} (padrão) ou, só em testes, http://127.0.0.1:<porta>.`,
  );
}

/**
 * Lê uma variável de ambiente já sem espaços. Campo opcional do `.mcpb` que o usuário deixou em
 * branco pode chegar como o marcador cru (`${user_config.X}`): conta como vazio.
 */
export function lerCampo(env: Record<string, string | undefined>, nome: string): string {
  const valor = env[nome]?.trim() ?? "";
  return valor.startsWith("${") ? "" : valor;
}

export function lerConfig(env: Ambiente = process.env): Config {
  const contaId = lerCampo(env, "IG_ACCOUNT_ID");
  if (contaId === "") {
    throw new ErroConfig(
      "IG_ACCOUNT_ID não configurado: informe o IG ID da conta profissional (só números) na configuração do MCP.",
    );
  }
  if (!/^\d+$/.test(contaId)) {
    throw new ErroConfig(`IG_ACCOUNT_ID inválido (${contaId}): deve ter só números, como 17841400000000000.`);
  }

  const graphVersao = lerCampo(env, "IG_GRAPH_VERSION") || VERSAO_PADRAO;
  if (!/^v\d+\.\d+$/.test(graphVersao)) {
    throw new ErroConfig(`IG_GRAPH_VERSION inválido (${graphVersao}): use o formato v27.0.`);
  }

  return { contaId, graphVersao, graphBase: lerBase(env.IG_GRAPH_BASE) };
}

/**
 * A instalação é a extensão do Claude Desktop (`.mcpb`)? O manifest define `IG_INSTALACAO=extensao`.
 * Muda só as frases: na extensão o token se cadastra no campo dela, não pelo terminal.
 */
export function ehExtensao(env: Record<string, string | undefined> = process.env): boolean {
  return lerCampo(env, "IG_INSTALACAO").toLowerCase() === "extensao";
}

/**
 * Qual era do protocolo MCP o servidor fala por stdio.
 * Padrão: a de 2025 (com `initialize`), igual às outras extensões do Claude Desktop. Motivo (10/11/2026):
 * falando a de 2026-07-28, o cartão de confirmação aparecia no chat do Desktop mas NÃO na aba Code,
 * enquanto extensões na era de 2025 (Hotmart) apareciam nos dois. `IG_PROTOCOLO=moderno` volta a servir as duas eras.
 */
export function protocoloModerno(env: Record<string, string | undefined> = process.env): boolean {
  return lerCampo(env, "IG_PROTOCOLO").toLowerCase() === "moderno";
}
