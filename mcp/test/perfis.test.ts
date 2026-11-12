// Perfis de ferramentas (IG_PERFIL, IG_GRUPOS_SO_LEITURA) e roteiros prontos.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ErroConfig } from "../src/config.ts";
import type { Contexto } from "../src/contexto.ts";
import { GRUPO_DA_FERRAMENTA, GRUPOS, lerPolitica } from "../src/perfis.ts";
import { registrarEscrita, registrarLeitura, respostaJson } from "../src/respostas.ts";
import { ROTEIROS } from "../src/roteiros.ts";
import type { RegistroExtra } from "../src/servidor.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";

/** Ferramentas falsas com os nomes das que as fichas 06, 07, 09 virão trazer. */
function falsa(nome: string, escrita: boolean): RegistroExtra {
  return (server: McpServer, _ctx: Contexto) => {
    const definicao = { title: nome, description: `falsa ${nome}`, inputSchema: z.strictObject({}) };
    try {
      if (escrita) registrarEscrita(server, nome, { destrutiva: false, idempotente: false }, definicao, async () => respostaJson({}));
      else registrarLeitura(server, nome, definicao, async () => respostaJson({}));
    } catch {
      // a ferramenta de verdade desta ficha já entrou na integração: vale a de verdade
    }
  };
}

const FUTURAS_DE_ESCRITA = ["ig_responder_dm", "ig_enviar_midia_dm", "ig_reagir_dm", "ig_responder_comentario", "ig_esconder_comentario", "ig_apagar_comentario", "ig_publicar_post", "ig_publicar_reels"];
const FUTURAS_DE_LEITURA = ["ig_listar_comentarios", "ig_limite_publicacao", "ig_status_publicacao"];
const TODAS_FALSAS = [...FUTURAS_DE_ESCRITA.map((n) => falsa(n, true)), ...FUTURAS_DE_LEITURA.map((n) => falsa(n, false))];

describe("perfis de ferramentas", () => {
  let m: Montagem;
  let pasta: string;
  beforeEach(async () => {
    m = await montar();
    pasta = mkdtempSync(join(tmpdir(), "ig-perfil-"));
  });
  afterEach(async () => {
    await m.fechar();
    rmSync(pasta, { recursive: true, force: true });
  });

  async function ferramentas(env: Record<string, string>, extras: readonly RegistroExtra[] = TODAS_FALSAS) {
    const { cliente, fechar } = await conectarCliente(m.ctx, { extras, servidor: { politica: lerPolitica(env), pastaDoPerfil: pasta } });
    try {
      const { tools } = await cliente.listTools();
      const { prompts } = await cliente.listPrompts();
      return { tools, prompts: prompts.map((p) => p.name), nomes: tools.map((t) => t.name) };
    } finally {
      await fechar();
    }
  }

  it("completo (padrão) registra leituras e escritas", async () => {
    const { nomes } = await ferramentas({});
    for (const n of ["ig_conta", "ig_responder_dm", "ig_publicar_post", "ig_confirmar", "ig_estado_do_token"]) assert.ok(nomes.includes(n), n);
  });

  it("leitura: nenhuma ferramenta de escrita (confere com readOnlyHint), nem a confirmação", async () => {
    const { tools, nomes } = await ferramentas({ IG_PERFIL: "leitura" });
    assert.ok(tools.length > 5);
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} não é de leitura`);
    for (const n of [...FUTURAS_DE_ESCRITA, "ig_confirmar", "ig_cancelar", "ig_confirmar_tela", "ig_cancelar_pedido", "ig_estado_pedido_tela"]) assert.ok(!nomes.includes(n), n);
    for (const n of FUTURAS_DE_LEITURA) assert.ok(nomes.includes(n), n);
    assert.ok(nomes.includes("ig_estado_do_token"));
  });

  it("publicar: conta, mídias, publicação e comentários (com a confirmação); sem DMs, insights e descoberta", async () => {
    const { nomes } = await ferramentas({ IG_PERFIL: "publicar" });
    for (const n of ["ig_conta", "ig_listar_midias", "ig_publicar_post", "ig_listar_comentarios", "ig_responder_comentario", "ig_confirmar", "ig_estado_do_token"]) assert.ok(nomes.includes(n), n);
    for (const n of ["ig_listar_conversas", "ig_responder_dm", "ig_insights_conta", "ig_perfil_publico"]) assert.ok(!nomes.includes(n), n);
  });

  it("atendimento: conta, DMs e comentários; sem publicação e mídias", async () => {
    const { nomes } = await ferramentas({ IG_PERFIL: "atendimento" });
    for (const n of ["ig_conta", "ig_listar_conversas", "ig_responder_dm", "ig_listar_comentarios", "ig_confirmar", "ig_estado_do_token"]) assert.ok(nomes.includes(n), n);
    for (const n of ["ig_publicar_post", "ig_listar_midias", "ig_insights_midia"]) assert.ok(!nomes.includes(n), n);
  });

  it("IG_GRUPOS_SO_LEITURA=dms remove ig_responder_dm e mantém ig_listar_conversas", async () => {
    const { nomes } = await ferramentas({ IG_GRUPOS_SO_LEITURA: "dms" });
    assert.ok(!nomes.includes("ig_responder_dm"));
    assert.ok(!nomes.includes("ig_reagir_dm"));
    assert.ok(nomes.includes("ig_listar_conversas"));
    assert.ok(nomes.includes("ig_publicar_post"), "os outros grupos continuam com escrita");
  });

  it("ig_responder_no_privado manda DM: pertence aos grupos comentarios e dms, e some se qualquer um for só leitura", async () => {
    assert.ok((await ferramentas({})).nomes.includes("ig_responder_no_privado"));
    assert.ok(!(await ferramentas({ IG_GRUPOS_SO_LEITURA: "dms" })).nomes.includes("ig_responder_no_privado"));
    assert.ok(!(await ferramentas({ IG_GRUPOS_SO_LEITURA: "comentarios" })).nomes.includes("ig_responder_no_privado"));
    assert.ok(!(await ferramentas({ IG_PERFIL: "leitura" })).nomes.includes("ig_responder_no_privado"));
    assert.ok((await ferramentas({ IG_GRUPOS_SO_LEITURA: "insights" })).nomes.includes("ig_responder_no_privado"));
  });

  it("aceita o apelido conversas e vários grupos", async () => {
    const { nomes } = await ferramentas({ IG_GRUPOS_SO_LEITURA: "conversas, comentarios" });
    for (const n of ["ig_responder_dm", "ig_esconder_comentario"]) assert.ok(!nomes.includes(n), n);
    assert.ok(nomes.includes("ig_listar_comentarios"));
  });

  it("valor inválido na partida vira erro de configuração", () => {
    assert.throws(() => lerPolitica({ IG_PERFIL: "tudo" }), ErroConfig);
    assert.throws(() => lerPolitica({ IG_GRUPOS_SO_LEITURA: "dms,foguete" }), ErroConfig);
  });

  it("ig_estado_do_token fica registrada em todos os perfis", async () => {
    for (const IG_PERFIL of ["completo", "leitura", "publicar", "atendimento"]) {
      assert.ok((await ferramentas({ IG_PERFIL }, [])).nomes.includes("ig_estado_do_token"), IG_PERFIL);
    }
  });

  it("toda ferramenta do servidor de verdade tem grupo na tabela (a ficha que esquecer falha aqui)", async () => {
    const { nomes } = await ferramentas({}, []);
    for (const n of nomes) assert.ok(GRUPO_DA_FERRAMENTA[n], `${n} sem grupo em GRUPO_DA_FERRAMENTA (src/perfis.ts)`);
    for (const g of Object.values(GRUPO_DA_FERRAMENTA)) assert.ok(GRUPOS.includes(g));
  });

  it("toda entrada de GRUPO_DA_FERRAMENTA é uma ferramenta que existe (sem nome sobrando na tabela)", async () => {
    const { nomes } = await ferramentas({}, []);
    for (const n of Object.keys(GRUPO_DA_FERRAMENTA)) assert.ok(nomes.includes(n), `${n} está na tabela de grupos mas o servidor não a registra`);
  });

  describe("roteiros", () => {
    const PERFIS_TESTADOS: Array<Record<string, string>> = [{}, { IG_PERFIL: "leitura" }, { IG_PERFIL: "publicar" }, { IG_PERFIL: "atendimento" }, { IG_GRUPOS_SO_LEITURA: "dms,comentarios" }];

    it("um roteiro só aparece se TODAS as ferramentas que o texto cita estão registradas (sem ferramentas 'opcionais')", async () => {
      for (const env of PERFIS_TESTADOS) {
        const { cliente, fechar } = await conectarCliente(m.ctx, { servidor: { politica: lerPolitica(env), pastaDoPerfil: join(pasta, "nao-existe") } });
        try {
          const { tools } = await cliente.listTools();
          const nomes = new Set(tools.map((t) => t.name));
          const { prompts } = await cliente.listPrompts();
          for (const p of prompts) {
            const argumentos = Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "x"]));
            const r = await cliente.getPrompt({ name: p.name, arguments: argumentos });
            const texto = (r.messages[0]!.content as { text: string }).text;
            const citadas = [...new Set(texto.match(/\big_[a-z_]+/g) ?? [])];
            for (const n of citadas) assert.ok(nomes.has(n), `${p.name} (${JSON.stringify(env)}) cita ${n}, que o perfil não registrou`);
          }
        } finally {
          await fechar();
        }
      }
    });

    it("roteiros não têm mais a lista de ferramentas opcionais", () => {
      for (const r of ROTEIROS) assert.equal("opcionais" in r, false, r.nome);
    });

    it("cada perfil mostra os roteiros úteis, com o texto dividido pelo que o perfil permite", async () => {
      assert.deepEqual((await ferramentas({})).prompts.sort(), ["ig_caixa_de_dms", "ig_legenda_e_publicacao", "ig_pesquisa_concorrentes", "ig_relatorio_semanal", "ig_triagem_de_comentarios"]);
      assert.deepEqual((await ferramentas({ IG_PERFIL: "leitura" })).prompts.sort(), ["ig_caixa_de_dms", "ig_pesquisa_concorrentes", "ig_relatorio_semanal", "ig_triagem_de_comentarios"]);
      assert.ok((await ferramentas({ IG_PERFIL: "atendimento" })).prompts.includes("ig_triagem_de_comentarios"));
      assert.ok((await ferramentas({ IG_PERFIL: "publicar" })).prompts.includes("ig_legenda_e_publicacao"));
    });

    it("esconder comentário e reagir a DM não passam pelo cartão de confirmação (decisão 3.6) e os roteiros dizem isso", async () => {
      const { cliente, fechar } = await conectarCliente(m.ctx, { servidor: { pastaDoPerfil: pasta } });
      try {
        for (const [nome, args] of [["ig_triagem_de_comentarios", {}], ["ig_caixa_de_dms", {}]] as const) {
          const texto = ((await cliente.getPrompt({ name: nome, arguments: args })).messages[0]!.content as { text: string }).text;
          assert.match(texto, /(esconder|reagir)[^.\n]*(sem|não)[^.\n]*(cartão|clique|confirmação)/i, nome);
          assert.doesNotMatch(texto, /esconder pode ser desfeito, mas ainda assim/);
          assert.doesNotMatch(texto, /ig_reagir_dm[^.\n]*passa pelo cartão|Cada uma passa pelo cartão de confirmação \(esconder/);
        }
      } finally {
        await fechar();
      }
    });

    it("ig_caixa_de_dms some no perfil publicar; ig_relatorio_semanal some sem os insights", async () => {
      const publicar = await ferramentas({ IG_PERFIL: "publicar" });
      assert.ok(!publicar.prompts.includes("ig_caixa_de_dms"));
      assert.ok(publicar.prompts.includes("ig_legenda_e_publicacao"));
      assert.ok(!publicar.prompts.includes("ig_relatorio_semanal"));
      const atendimento = await ferramentas({ IG_PERFIL: "atendimento" });
      assert.ok(atendimento.prompts.includes("ig_caixa_de_dms"));
      assert.ok(atendimento.prompts.includes("ig_triagem_de_comentarios"));
      assert.ok(!atendimento.prompts.includes("ig_legenda_e_publicacao"));
    });

    it("no perfil leitura, os roteiros que escrevem somem e os de leitura ficam sem mencionar escrita", async () => {
      const { prompts } = await ferramentas({ IG_PERFIL: "leitura" });
      assert.ok(!prompts.includes("ig_legenda_e_publicacao"));
      assert.ok(prompts.includes("ig_caixa_de_dms"));
      const { cliente, fechar } = await conectarCliente(m.ctx, { extras: TODAS_FALSAS, servidor: { politica: lerPolitica({ IG_PERFIL: "leitura" }), pastaDoPerfil: pasta } });
      try {
        const r = await cliente.getPrompt({ name: "ig_caixa_de_dms", arguments: {} });
        const texto = (r.messages[0]!.content as { text: string }).text;
        assert.doesNotMatch(texto, /ig_responder_dm/);
        assert.match(texto, /só lê e rascunha/);
      } finally {
        await fechar();
      }
    });

    it("o texto traz o perfil do dono da conta, as regras e o que cada roteiro prometeu", async () => {
      writeFileSync(join(pasta, "VOICE.md"), "VOZ-DO-THALES-XYZ");
      const { cliente, fechar } = await conectarCliente(m.ctx, { extras: TODAS_FALSAS, servidor: { pastaDoPerfil: pasta } });
      const texto = async (name: string, args: Record<string, string> = {}) => {
        const r = await cliente.getPrompt({ name, arguments: args });
        return (r.messages[0]!.content as { text: string }).text;
      };
      try {
        const relatorio = await texto("ig_relatorio_semanal", { dias: "14" });
        assert.match(relatorio, /últimos 14 dias/);
        assert.match(relatorio, /mediana/);
        assert.match(relatorio, /compartilhamentos/);
        assert.match(relatorio, /VOZ-DO-THALES-XYZ/);
        assert.match(relatorio, /conteúdo de terceiros/);
        assert.doesNotMatch(relatorio, /cartão de confirmação|ig_confirmar/, "relatório só lê: não cita confirmação");
        assert.match(relatorio, /\{\{seu número\}\}/);
        assert.match(await texto("ig_relatorio_semanal"), /últimos 7 dias/);

        const triagem = await texto("ig_triagem_de_comentarios");
        for (const g of ["palavra-chave", "lead", "conteúdo", "pergunta", "apoio", "ruído"]) assert.match(triagem, new RegExp(g));
        assert.match(triagem, /ig_esconder_comentario/);

        const dms = await texto("ig_caixa_de_dms");
        assert.match(dms, /palavra-chave recebe a coisa na primeira mensagem/);
        assert.match(dms, /24 h/);

        const pesquisa = await texto("ig_pesquisa_concorrentes", { usuarios: "@bluebottle, outra" });
        assert.match(pesquisa, /@bluebottle, @outra/);
        assert.match(pesquisa, /3 vezes a mediana/);

        const legenda = await texto("ig_legenda_e_publicacao", { briefing: "lançamento", arquivo: "/tmp/a.jpg" });
        assert.match(legenda, /lançamento/);
        assert.match(legenda, /ig_limite_publicacao/);
        assert.match(legenda, /cartão de confirmação/);
      } finally {
        await fechar();
      }
    });

    it("sem a pasta do perfil, o roteiro avisa em vez de falhar", async () => {
      const { cliente, fechar } = await conectarCliente(m.ctx, { servidor: { pastaDoPerfil: join(pasta, "nao-existe") } });
      try {
        const r = await cliente.getPrompt({ name: "ig_relatorio_semanal", arguments: {} });
        assert.match((r.messages[0]!.content as { text: string }).text, /não foi encontrado/);
      } finally {
        await fechar();
      }
    });
  });
});

describe("IG_PERFIL vindo do .mcpb sem substituir", () => {
  it("${user_config.IG_PERFIL} vira o perfil completo", () => {
    assert.equal(lerPolitica({ IG_PERFIL: "${user_config.IG_PERFIL}" }).perfil, "completo");
  });
});
