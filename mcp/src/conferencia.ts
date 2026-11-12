// Conferência real SÓ DE LEITURA (`npm run conferir`, ficha 12).
// Roda a lista de leituras da ficha em cada versão da Graph (v27.0 e v26.0) e compara.
// Os passos passam pelas ferramentas de verdade (cliente MCP em memória, perfil `leitura`,
// que nem registra escrita) e a saída só tem contagens: nada de texto de DM, nome ou legenda.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { Cofre } from "./cofre.ts";
import type { Config } from "./config.ts";
import { criarContexto, type Contexto } from "./contexto.ts";
import { criarEspacador } from "./espacador.ts";
import { ClienteGraph } from "./graph.ts";
import { criarPolitica } from "./perfis.ts";
import { limpar } from "./segredos.ts";
import { fabricaDeServidor } from "./servidor.ts";

export type Estado = "ok" | "erro" | "pulado";

export interface ResultadoDoPasso {
  estado: Estado;
  /** Só contagens ou a frase traduzida do erro. */
  detalhe: string;
  /** Chaves da resposta (sem valores), para achar diferença de formato entre versões. */
  forma: string;
}

export interface LinhaDaConferencia {
  ferramenta: string;
  resultados: Record<string, ResultadoDoPasso>;
  igual: boolean;
}

export interface Conferencia {
  versoes: string[];
  linhas: LinhaDaConferencia[];
  diferencas: number;
  erros: number;
  /** true quando nada deu erro e as versões responderam igual. */
  ok: boolean;
}

export interface OpcoesConferencia {
  config: Config;
  cofre: Cofre;
  versoes?: string[];
  /** @ de uma conta comercial conhecida, para o Business Discovery. */
  perfilPublico?: string;
  /** Intervalo entre chamadas de DM (padrão 500 ms; os testes passam 0). */
  intervaloMs?: number;
}

export const VERSOES_PADRAO = ["v27.0", "v26.0"];
export const PERFIL_PUBLICO_PADRAO = "bluebottle";

type Saida = { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> };

/** Caminhos das chaves (sem valores): "itens[].id". */
export function formaDe(valor: unknown, prefixo = ""): string[] {
  if (Array.isArray(valor)) return [...new Set(valor.flatMap((v) => formaDe(v, `${prefixo}[]`)))].sort();
  if (valor !== null && typeof valor === "object") {
    return Object.entries(valor as Record<string, unknown>)
      .flatMap(([k, v]) => {
        const caminho = prefixo ? `${prefixo}.${k}` : k;
        const filhos = formaDe(v, caminho);
        return filhos.length > 0 ? filhos : [caminho];
      })
      .sort();
  }
  return [];
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Primeira linha (a frase traduzida) mais os códigos da Meta; o resto do texto fica de fora. */
function resumoDoErro(textoBruto: string): string {
  const texto = limpar(textoBruto);
  const frase = (texto.split("\n")[0] ?? "").slice(0, 200);
  const codigos = /\((code[^)]*)\)\.?\s*$/.exec(texto)?.[1];
  return codigos ? `${frase} [${codigos}]` : frase;
}

interface Passo {
  ferramenta: string;
  executar(): Promise<{ detalhe: string; dados?: unknown } | "pular">;
}

async function conferirVersao(opcoes: OpcoesConferencia, versao: string, pasta: string): Promise<Map<string, ResultadoDoPasso>> {
  const config: Config = { ...opcoes.config, graphVersao: versao };
  const graph = new ClienteGraph({ config, cofre: opcoes.cofre, tempoLimiteMs: 30_000 });
  const ctx: Contexto = criarContexto(config, graph, opcoes.cofre, null, criarEspacador({ intervaloMs: opcoes.intervaloMs ?? 500 }), {
    caminhoRegistro: join(pasta, "acoes.jsonl"),
    caminhoPrivados: join(pasta, "privados.json"),
  });
  // Perfil `leitura`: nenhuma ferramenta de escrita chega a ser registrada.
  const server = fabricaDeServidor(ctx, [], { politica: criarPolitica("leitura"), pastaDoPerfil: join(pasta, "sem-perfil") })();
  const [doCliente, doServidor] = InMemoryTransport.createLinkedPair();
  await server.connect(doServidor);
  const cliente = new Client({ name: "conferir", version: "0.0.0" });
  await cliente.connect(doCliente);

  const resultados = new Map<string, ResultadoDoPasso>();
  let conversaId: string | null = null;
  let pessoaId: string | null = null;

  const chamar = async (nome: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const saida = (await cliente.callTool({ name: nome, arguments: args })) as Saida;
    if (saida.isError) throw new Error(`@@${resumoDoErro(saida.content?.find((b) => b.type === "text")?.text ?? "erro sem texto")}`);
    return saida.structuredContent ?? {};
  };

  const passos: Passo[] = [
    {
      ferramenta: "ig_conta",
      executar: async () => ({ detalhe: "conta lida", dados: await chamar("ig_conta", {}) }),
    },
    {
      ferramenta: "ig_listar_midias (com caption)",
      executar: async () => {
        const d = await chamar("ig_listar_midias", { limite: 5 });
        return { detalhe: `${plural(lista(d.itens).length, "item", "itens")}${d.aviso ? ", com aviso (a Meta recusou algum campo)" : ""}`, dados: d };
      },
    },
    {
      ferramenta: "ig_listar_midias (sem caption)",
      executar: async () => {
        const r = await graph.get<{ data?: unknown[] }>(`${config.contaId}/media`, { fields: "id,media_type,permalink,timestamp", limit: 5 });
        return { detalhe: plural(lista(r.data).length, "item", "itens"), dados: r };
      },
    },
    {
      ferramenta: "ig_listar_stories",
      executar: async () => {
        const d = await chamar("ig_listar_stories", {});
        return { detalhe: plural(lista(d.itens).length, "story", "stories"), dados: d };
      },
    },
    {
      ferramenta: "ig_listar_conversas",
      executar: async () => {
        const d = await chamar("ig_listar_conversas", { limite: 5 });
        const conversas = lista(d.conversas) as Array<{ id?: string; participantes?: Array<{ id?: string }> }>;
        const primeira = conversas[0];
        conversaId = primeira?.id ?? null;
        pessoaId = primeira?.participantes?.find((p) => p.id && p.id !== config.contaId)?.id ?? null;
        return { detalhe: plural(conversas.length, "conversa", "conversas"), dados: d };
      },
    },
    {
      ferramenta: "ig_ler_conversa",
      executar: async () => {
        if (!conversaId) return "pular";
        const d = await chamar("ig_ler_conversa", { conversa_id: conversaId });
        const aberta = (d.janela as { aberta?: boolean } | undefined)?.aberta === true;
        return { detalhe: `${plural(lista(d.mensagens).length, "mensagem", "mensagens")}, janela ${aberta ? "aberta" : "fechada"}`, dados: d };
      },
    },
    {
      ferramenta: "ig_perfil_contato",
      executar: async () => {
        if (!pessoaId) return "pular";
        const d = await chamar("ig_perfil_contato", { usuario_id: pessoaId });
        return { detalhe: plural(Object.keys(d).length, "campo", "campos"), dados: d };
      },
    },
    {
      ferramenta: "ig_listar_marcacoes",
      executar: async () => {
        const d = await chamar("ig_listar_marcacoes", { limite: 5 });
        return { detalhe: plural(lista(d.itens).length, "marcação", "marcações"), dados: d };
      },
    },
    {
      ferramenta: "ig_perfil_publico",
      executar: async () => {
        const d = await chamar("ig_perfil_publico", { usuario: opcoes.perfilPublico ?? PERFIL_PUBLICO_PADRAO, midias: 3 });
        return { detalhe: plural(lista(d.midias).length, "mídia", "mídias"), dados: d };
      },
    },
    {
      ferramenta: "ig_insights_conta (reach)",
      executar: async () => {
        const d = await chamar("ig_insights_conta", { metricas: ["reach"] });
        return { detalhe: plural(lista(d.metricas).length, "métrica", "métricas"), dados: d };
      },
    },
    {
      ferramenta: "ig_limite_publicacao",
      executar: async () => {
        const d = await chamar("ig_limite_publicacao", {});
        return { detalhe: `${d.usadas}/${d.total} usadas`, dados: d };
      },
    },
  ];

  try {
    for (const passo of passos) {
      try {
        const r = await passo.executar();
        resultados.set(
          passo.ferramenta,
          r === "pular"
            ? { estado: "pulado", detalhe: "sem conversa para usar", forma: "" }
            : { estado: "ok", detalhe: r.detalhe, forma: formaDe(r.dados).join(",") },
        );
      } catch (erro) {
        const mensagem = erro instanceof Error && erro.message.startsWith("@@") ? erro.message.slice(2) : resumoDoErro(erro instanceof Error ? erro.message : String(erro));
        resultados.set(passo.ferramenta, { estado: "erro", detalhe: mensagem, forma: "" });
      }
    }
  } finally {
    await cliente.close();
    await server.close();
  }
  return resultados;
}

export async function conferir(opcoes: OpcoesConferencia): Promise<Conferencia> {
  const versoes = opcoes.versoes ?? VERSOES_PADRAO;
  const pasta = mkdtempSync(join(tmpdir(), "ig-mcp-conferir-"));
  try {
    const porVersao = new Map<string, Map<string, ResultadoDoPasso>>();
    for (const v of versoes) porVersao.set(v, await conferirVersao(opcoes, v, pasta));

    const nomes = [...(porVersao.get(versoes[0]!)?.keys() ?? [])];
    const linhas: LinhaDaConferencia[] = nomes.map((ferramenta) => {
      const resultados = Object.fromEntries(versoes.map((v) => [v, porVersao.get(v)!.get(ferramenta)!]));
      const assinaturas = new Set(Object.values(resultados).map((r) => `${r.estado}|${r.detalhe}|${r.forma}`));
      return { ferramenta, resultados, igual: assinaturas.size === 1 };
    });
    const diferencas = linhas.filter((l) => !l.igual).length;
    const erros = linhas.reduce((n, l) => n + Object.values(l.resultados).filter((r) => r.estado === "erro").length, 0);
    return { versoes, linhas, diferencas, erros, ok: diferencas === 0 && erros === 0 };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** Tabela "ferramenta → resultado em cada versão", com o veredito no fim. */
export function formatarTabela(c: Conferencia, versoes: string[] = c.versoes): string {
  const celula = (r: ResultadoDoPasso | undefined) => (r ? (r.estado === "ok" ? `ok: ${r.detalhe}` : r.estado === "pulado" ? `pulado: ${r.detalhe}` : `ERRO: ${r.detalhe}`) : "-");
  const largura = (f: (l: LinhaDaConferencia) => string, cab: string) => Math.max(cab.length, ...c.linhas.map((l) => f(l).length));
  const wF = largura((l) => l.ferramenta, "ferramenta");
  const wV = versoes.map((v) => largura((l) => celula(l.resultados[v]), v));
  const linha = (cols: string[]) => cols.map((t, i) => t.padEnd(i === 0 ? wF : (wV[i - 1] ?? 0))).join("  ").trimEnd();
  const saida = [linha(["ferramenta", ...versoes]), linha(["-".repeat(wF), ...wV.map((w) => "-".repeat(w))])];
  for (const l of c.linhas) {
    const cols = [l.ferramenta, ...versoes.map((v) => celula(l.resultados[v]))];
    saida.push(`${linha(cols)}${l.igual ? "" : "   <- DIFERENTE entre as versões"}`);
  }
  saida.push("");
  saida.push(
    c.ok
      ? `Tudo funcionou e as versões responderam igual (${versoes.join(" e ")}).`
      : `${plural(c.erros, "erro", "erros")}; ${plural(c.diferencas, "diferença", "diferenças")} entre as versões. Cole esta tabela no diário.`,
  );
  return saida.join("\n");
}
