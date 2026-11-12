// Estado do token e da conta (ig_estado_do_token e `npm run doctor`). Nunca devolve o token.

import { CONTA_TOKEN, mensagemSemToken } from "./cofre.ts";
import type { Contexto } from "./contexto.ts";
import { ErroGraph } from "./erros.ts";
import { TokenAusente } from "./graph.ts";
import type { Politica } from "./perfis.ts";
import { limpar } from "./segredos.ts";

export interface EstadoDoToken {
  /** true quando o token está cadastrado, a conta conferiu e as permissões foram lidas. */
  saudavel: boolean;
  keychain: { token_cadastrado: boolean };
  conta: { id: string; username: string } | { erro: string } | null;
  permissoes: { concedidas: string[] } | { erro: string } | null;
  graph_versao: string;
  perfil: string;
  grupos_so_leitura: string[];
  problemas: string[];
}

function texto(erro: unknown): string {
  return limpar(erro instanceof ErroGraph || erro instanceof Error ? erro.message : String(erro));
}

/** Só o que a checagem usa do Contexto (o doctor monta isto sem criar o resto). */
export type ContextoDoEstado = Pick<Contexto, "config" | "graph" | "cofre" | "conta">;

export async function verificarEstado(ctx: ContextoDoEstado, politica: Politica, signal?: AbortSignal): Promise<EstadoDoToken> {
  const opcoes = signal ? { signal } : {};
  const problemas: string[] = [];
  let tokenCadastrado = false;
  try {
    tokenCadastrado = (await ctx.cofre.ler(CONTA_TOKEN)) !== null;
  } catch (erro) {
    problemas.push(`Keychain: ${texto(erro)}`);
  }
  let conta: EstadoDoToken["conta"] = null;
  let permissoes: EstadoDoToken["permissoes"] = null;
  if (!tokenCadastrado) {
    problemas.push(mensagemSemToken());
  } else {
    try {
      const c = await ctx.graph.get<{ id?: string; username?: string }>(ctx.config.contaId, { fields: "id,username" }, opcoes);
      if (c.id !== ctx.config.contaId || !c.username) {
        conta = { erro: `A Meta devolveu o ID ${c.id ?? "(vazio)"} para IG_ACCOUNT_ID=${ctx.config.contaId}.` };
        problemas.push("A conta devolvida pela Meta não é a configurada.");
      } else {
        conta = { id: c.id, username: c.username };
        ctx.conta.arroba = c.username;
      }
    } catch (erro) {
      if (!(erro instanceof TokenAusente)) conta = { erro: texto(erro) };
      problemas.push(`Conta: ${texto(erro)}`);
    }
    try {
      const corpo = await ctx.graph.get<{ data?: Array<{ permission?: string; status?: string }> }>("me/permissions", {}, opcoes);
      const concedidas = (corpo.data ?? [])
        .filter((p) => p.status === "granted" && typeof p.permission === "string")
        .map((p) => p.permission as string)
        .sort();
      permissoes = { concedidas };
    } catch (erro) {
      permissoes = { erro: texto(erro) };
      problemas.push(`Permissões: ${texto(erro)}`);
    }
  }
  return {
    saudavel: problemas.length === 0,
    keychain: { token_cadastrado: tokenCadastrado },
    conta,
    permissoes,
    graph_versao: ctx.config.graphVersao,
    perfil: politica.perfil,
    grupos_so_leitura: [...politica.soLeitura].sort(),
    problemas,
  };
}
