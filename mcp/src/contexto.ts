// Estado compartilhado por todas as instâncias do servidor (fica no escopo do módulo,
// fora do createServer): configuração, cliente da Graph e o @ da conta.

import type { Cofre } from "./cofre.ts";
import type { Config } from "./config.ts";
import { Pedidos } from "./confirmacao.ts";
import { criarEspacador, type Espacador } from "./espacador.ts";
import { ErroGraph } from "./erros.ts";
import { TokenAusente, type ClienteGraph } from "./graph.ts";
import type { Hospedagem } from "./hospedagem.ts";
import { log as logar } from "./log.ts";
import { CAMINHO_PUBLICACOES_PADRAO } from "./contagem-publicacoes.ts";
import { CAMINHO_PRIVADOS_PADRAO } from "./privados.ts";
import { RegistroAcoes } from "./registro-acoes.ts";
import { limpar } from "./segredos.ts";
import { executarReal, type Executor } from "./sistema.ts";

export interface Contexto {
  config: Config;
  graph: ClienteGraph;
  /** O cofre do token. Só o estado o lê, para saber se há token cadastrado; o valor nunca sai dele. */
  cofre: Cofre;
  conta: {
    /** @ da conta, conferido na partida ou no primeiro ig_conta. */
    arroba: string | null;
  };
  /** Hospedagem de foto do computador no Uploadcare; null quando falta a chave pública (opcional). */
  hospedagem: Hospedagem | null;
  /** Espaça em 500 ms as chamadas da Conversations API (limite de 2 por segundo). */
  espacador: Espacador;
  /** Pedidos pendentes de confirmação (ficha 03), compartilhados entre as instâncias do servidor. */
  pedidos: Pedidos;
  /** Registro local de ações (acoes.jsonl). */
  registro: RegistroAcoes;
  /** Comentários já respondidos no privado (privados.json, ficha 07). */
  caminhoPrivados: string;
  /** Contagem local das publicações das últimas 24 h (publicacoes.json). */
  caminhoPublicacoes: string;
  /** Roda comandos do sistema (a janela do Mac de reserva). Os testes trocam por um falso. */
  executar: Executor;
}

export interface OpcoesContexto {
  /** Caminho do acoes.jsonl (padrão: ~/Library/Logs/instagram-mcp/acoes.jsonl). */
  caminhoRegistro?: string;
  executar?: Executor;
  /** Caminho do privados.json (padrão: ~/Library/Application Support/instagram-mcp/privados.json). */
  caminhoPrivados?: string;
  /** Caminho do publicacoes.json (padrão: ~/Library/Application Support/instagram-mcp/publicacoes.json). */
  caminhoPublicacoes?: string;
  /** Relógio dos pedidos (testes de validade). */
  agora?: () => number;
}

export function criarContexto(
  config: Config,
  graph: ClienteGraph,
  cofre: Cofre,
  hospedagem: Hospedagem | null = null,
  espacador: Espacador = criarEspacador(),
  opcoes: OpcoesContexto = {},
): Contexto {
  const registro = new RegistroAcoes(opcoes.caminhoRegistro);
  return {
    config,
    graph,
    cofre,
    conta: { arroba: null },
    hospedagem,
    espacador,
    pedidos: new Pedidos(registro, opcoes.agora),
    registro,
    caminhoPrivados: opcoes.caminhoPrivados ?? CAMINHO_PRIVADOS_PADRAO,
    caminhoPublicacoes: opcoes.caminhoPublicacoes ?? CAMINHO_PUBLICACOES_PADRAO,
    executar: opcoes.executar ?? executarReal,
  };
}

export type ResultadoPartida =
  | { estado: "ok"; arroba: string }
  | { estado: "sem_token" }
  | { estado: "erro"; mensagem: string };

/**
 * Partida: `GET /{ig}?fields=id,username` para conferir o IG ID e guardar o @.
 * Nunca derruba o servidor: sem token ou com erro, as ferramentas explicam o problema na hora.
 */
export async function partida(ctx: Contexto, log: (linha: string) => void = logar): Promise<ResultadoPartida> {
  try {
    const conta = await ctx.graph.get<{ id?: string; username?: string }>(ctx.config.contaId, { fields: "id,username" });
    if (conta.id !== ctx.config.contaId) {
      const mensagem = `A Meta devolveu o ID ${conta.id ?? "(vazio)"} para IG_ACCOUNT_ID=${ctx.config.contaId}. Confira a configuração.`;
      log(`[instagram-mcp] ${mensagem}`);
      return { estado: "erro", mensagem };
    }
    ctx.conta.arroba = conta.username ?? null;
    log(`[instagram-mcp] conta conferida: @${conta.username ?? "?"} (Graph ${ctx.config.graphVersao})`);
    return conta.username ? { estado: "ok", arroba: conta.username } : { estado: "erro", mensagem: "A Meta não devolveu o username." };
  } catch (erro) {
    if (erro instanceof TokenAusente) {
      log(`[instagram-mcp] ${erro.message}`);
      return { estado: "sem_token" };
    }
    const mensagem = limpar(erro instanceof ErroGraph || erro instanceof Error ? erro.message : String(erro));
    log(`[instagram-mcp] partida sem conferir a conta: ${mensagem}`);
    return { estado: "erro", mensagem };
  }
}
