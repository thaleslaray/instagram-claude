// Montagem comum dos testes: Graph falsa + cliente da Graph + cliente MCP em memória.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { CofreEmMemoria, type Cofre } from "../src/cofre.ts";
import { lerConfig, type Config } from "../src/config.ts";
import { criarContexto, type Contexto } from "../src/contexto.ts";
import { criarEspacador } from "../src/espacador.ts";
import { ClienteGraph } from "../src/graph.ts";
import { fabricaDeServidor, type OpcoesServidor, type RegistroExtra } from "../src/servidor.ts";
import type { Executor } from "../src/sistema.ts";
import { CONTA_TESTE, GraphFalsa, TOKEN_TESTE } from "./graph-falsa.ts";

export interface Montagem {
  graphFalsa: GraphFalsa;
  config: Config;
  graph: ClienteGraph;
  ctx: Contexto;
  /** Caminho do acoes.jsonl da montagem (numa pasta temporária, nunca o registro real). */
  caminhoRegistro: string;
  /** Caminho do privados.json da montagem (pasta temporária). */
  caminhoPrivados: string;
  /** Caminho do publicacoes.json da montagem (pasta temporária, nunca a cota real). */
  caminhoPublicacoes: string;
  fechar(): Promise<void>;
}

export interface OpcoesMontagem {
  token?: string | null;
  versao?: string;
  /** Troca o cofre (padrão: em memória com o token). */
  cofre?: Cofre;
  /** Troca o fetch do cliente da Graph. */
  fetch?: ConstructorParameters<typeof ClienteGraph>[0]["fetch"];
  /** Executor de comandos do sistema (a janela do Mac). Padrão: um que sempre falha, para o teste nunca abrir janela de verdade. */
  executar?: Executor;
  /** Relógio dos pedidos de confirmação. */
  agora?: () => number;
}

const executorQueFalha: Executor = async (comando) => ({ codigo: 127, stdout: "", stderr: `teste: ${comando} não deve rodar de verdade` });

export async function montar(opcoes: OpcoesMontagem = {}): Promise<Montagem> {
  const graphFalsa = new GraphFalsa();
  const base = await graphFalsa.iniciar();
  const config = lerConfig({ IG_ACCOUNT_ID: CONTA_TESTE.id, IG_GRAPH_BASE: base, IG_GRAPH_VERSION: opcoes.versao });
  const token = opcoes.token === undefined ? TOKEN_TESTE : opcoes.token;
  const cofre = opcoes.cofre ?? new CofreEmMemoria(token);
  const graph = new ClienteGraph({ config, cofre, tempoLimiteMs: 5_000, ...(opcoes.fetch ? { fetch: opcoes.fetch } : {}) });
  const pasta = mkdtempSync(join(tmpdir(), "ig-mcp-teste-"));
  const caminhoRegistro = join(pasta, "acoes.jsonl");
  const caminhoPrivados = join(pasta, "privados.json");
  const caminhoPublicacoes = join(pasta, "publicacoes.json");
  // Sem espera real entre chamadas de conversa; o teste do espaçamento usa relógio falso.
  const ctx = criarContexto(config, graph, cofre, null, criarEspacador({ intervaloMs: 0 }), {
    caminhoRegistro,
    caminhoPrivados,
    caminhoPublicacoes,
    executar: opcoes.executar ?? executorQueFalha,
    ...(opcoes.agora ? { agora: opcoes.agora } : {}),
  });
  return {
    graphFalsa,
    config,
    graph,
    ctx,
    caminhoRegistro,
    caminhoPrivados,
    caminhoPublicacoes,
    fechar: async () => {
      await graphFalsa.parar();
      rmSync(pasta, { recursive: true, force: true });
    },
  };
}

export interface OpcoesCliente {
  /** Ferramentas só dos testes (ex.: uma escrita falsa). */
  extras?: readonly RegistroExtra[];
  /** O cliente declara MCP Apps (como o app do Claude), com ou sem serverTools. */
  comTela?: boolean;
  /** Perfil de ferramentas e pasta do perfil do Thales (padrão: completo, pasta vazia). */
  servidor?: OpcoesServidor;
}

/** Conecta um cliente MCP de verdade ao servidor, em memória. */
export async function conectarCliente(ctx: Contexto, opcoes: OpcoesCliente = {}): Promise<{ cliente: Client; fechar(): Promise<void> }> {
  const server = fabricaDeServidor(ctx, opcoes.extras, { pastaDoPerfil: join(tmpdir(), "ig-mcp-sem-perfil"), ...opcoes.servidor })();
  const [doCliente, doServidor] = InMemoryTransport.createLinkedPair();
  await server.connect(doServidor);
  const cliente = new Client(
    { name: "teste", version: "0.0.0" },
    opcoes.comTela ? { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } } : {},
  );
  await cliente.connect(doCliente);
  return {
    cliente,
    fechar: async () => {
      await cliente.close();
      await server.close();
    },
  };
}
