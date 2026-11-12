// O MCP é distribuído a outras pessoas: nenhum texto que chega ao modelo ou à tela pode citar o autor pelo nome.
// Percorre tools/list, as instruções (extensão e terminal), os roteiros (prompts), o HTML do cartão, a prévia de uma escrita
// (com e sem tela) e o resultado depois do clique na janela do Mac, tudo contra as falsificações de test/.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { URI_TELA } from "../src/escrita.ts";
import { instrucoes } from "../src/servidor.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { NOME_ESCRITA_TESTE, registrarEscritaDeTeste } from "./escrita-falsa.ts";
import { CONTA_TESTE } from "./graph-falsa.ts";
import { JanelaFalsa } from "./janela-falsa.ts";

const AUTOR = /Thales|Laray/i;

describe("nenhum texto para o modelo ou para a tela cita o autor", () => {
  let m: Montagem;
  let janela: JanelaFalsa;
  beforeEach(async () => {
    janela = new JanelaFalsa();
    m = await montar({ executar: janela.executar });
    m.graphFalsa.rota("POST", `/${CONTA_TESTE.id}/mensagem_de_teste`, { corpo: { id: "msg_1" } });
  });
  afterEach(async () => {
    await m.fechar();
  });

  it("instruções do servidor (extensão e terminal)", () => {
    assert.doesNotMatch(instrucoes(true), AUTOR);
    assert.doesNotMatch(instrucoes(false), AUTOR);
  });

  it("tools/list: nome, título e descrição de cada ferramenta, e as descrições dos parâmetros", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: true });
    try {
      const { tools } = await cliente.listTools();
      assert.ok(tools.length > 20);
      for (const f of tools) assert.doesNotMatch(JSON.stringify(f), AUTOR, f.name);
      assert.doesNotMatch(cliente.getInstructions() ?? "", AUTOR);
    } finally {
      await fechar();
    }
  });

  it("roteiros (prompts): lista e texto de cada um", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: true });
    try {
      const { prompts } = await cliente.listPrompts();
      assert.ok(prompts.length > 0);
      for (const p of prompts) {
        assert.doesNotMatch(JSON.stringify(p), AUTOR, p.name);
        const args = Object.fromEntries((p.arguments ?? []).filter((a) => a.required).map((a) => [a.name, "x"]));
        const r = await cliente.getPrompt({ name: p.name, arguments: args });
        assert.doesNotMatch(JSON.stringify(r), AUTOR, p.name);
      }
    } finally {
      await fechar();
    }
  });

  it("HTML do cartão de confirmação", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: true, extras: [registrarEscritaDeTeste()] });
    try {
      const { contents } = await cliente.readResource({ uri: URI_TELA });
      assert.ok(contents.length > 0);
      for (const c of contents) {
        assert.ok("text" in c && c.text.length > 1000);
        assert.doesNotMatch(c.text, AUTOR);
      }
    } finally {
      await fechar();
    }
  });

  it("prévia com cartão: content, structuredContent (para_o_claude e se_o_cartao_nao_apareceu) e _meta.previa", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: true, extras: [registrarEscritaDeTeste()] });
    try {
      const r = await cliente.callTool({ name: NOME_ESCRITA_TESTE, arguments: { texto: "Oi, Fulano!", para: "@fulano" } });
      assert.ok(!r.isError, JSON.stringify(r.content));
      const sc = r.structuredContent as Record<string, unknown>;
      assert.equal(typeof sc.para_o_claude, "string");
      assert.equal(typeof sc.se_o_cartao_nao_apareceu, "string");
      // `_meta.codigo` é segredo da prévia (não chega ao modelo); o resto é conferido por inteiro.
      assert.doesNotMatch(JSON.stringify({ content: r.content, structuredContent: r.structuredContent, previa: r._meta?.previa }), AUTOR);
    } finally {
      await fechar();
    }
  });

  it("sem cartão: a janela do Mac (título e texto) e o resultado depois do clique ou do cancelamento", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: false, extras: [registrarEscritaDeTeste()] });
    try {
      for (const comportamento of ["aceita", "cancela", "tempo"] as const) {
        janela.comportamento = comportamento;
        const r = await cliente.callTool({ name: NOME_ESCRITA_TESTE, arguments: { texto: "Oi, Fulano!", para: "@fulano" } });
        assert.doesNotMatch(JSON.stringify(r), AUTOR, comportamento);
      }
      assert.ok(janela.chamadas.length >= 3);
      for (const c of janela.chamadas) assert.doesNotMatch(JSON.stringify(c.args), AUTOR);
    } finally {
      await fechar();
    }
  });
});
