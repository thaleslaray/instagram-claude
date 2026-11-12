import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ANOTACOES_LEITURA, anotacoesEscrita, LIMITE_CARACTERES, paginaNoTeto, registrarEscrita, registrarLeitura, respostaJson } from "../src/respostas.ts";
import { montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, type PedidoRegistrado } from "./graph-falsa.ts";

describe("anotações", () => {
  it("leitura e escrita", () => {
    assert.deepEqual(ANOTACOES_LEITURA, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    assert.deepEqual(anotacoesEscrita({ destrutiva: true, idempotente: false }), {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("registrarLeitura/registrarEscrita exigem o prefixo ig_", () => {
    const server = new McpServer({ name: "t", version: "0" });
    const def = { title: "T", description: "d", inputSchema: z.strictObject({}) };
    assert.throws(() => registrarLeitura(server, "conta", def, async () => respostaJson({})), /prefixo ig_/);
    assert.throws(() => registrarEscrita(server, "apagar", { destrutiva: true, idempotente: false }, def, async () => respostaJson({})), /prefixo ig_/);
  });
});

describe("respostaJson", () => {
  it("structuredContent e o mesmo JSON em texto", () => {
    const r = respostaJson({ a: 1, b: ["x"] });
    assert.deepEqual(r.structuredContent, { a: 1, b: ["x"] });
    const bloco = r.content[0];
    assert.ok(bloco && bloco.type === "text");
    assert.deepEqual(JSON.parse(bloco.text), r.structuredContent);
  });
});

describe("teto de 25.000 caracteres", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
  });
  afterEach(async () => {
    await m.fechar();
  });

  it("devolve menos itens e o cursor do próximo, pedindo de novo à Meta com limite menor", async () => {
    const caminho = `/${CONTA_TESTE.id}/media`;
    // Cada item tem ~2.000 caracteres: 25 itens passam do teto.
    const grande = "x".repeat(2_000);
    m.graphFalsa.rota("GET", caminho, (p: PedidoRegistrado) => {
      const limite = Number(p.query.limit);
      const data = Array.from({ length: limite }, (_, i) => ({ id: `m${i}`, caption: grande }));
      return { corpo: { data, paging: { cursors: { after: `DEPOIS_DE_${limite}` }, next: "https://graph.facebook.com/v27.0/x" } } };
    });

    const resultado = await paginaNoTeto(
      25,
      (limite) => m.graph.pagina<{ id: string; caption: string }>(`${CONTA_TESTE.id}/media`, { fields: "id,caption" }, limite),
      (pagina) => ({ midias: pagina.itens, proximo: pagina.proximo }),
    );

    assert.ok(resultado.texto.length <= LIMITE_CARACTERES, `texto com ${resultado.texto.length}`);
    assert.equal(resultado.reduzida, true);
    assert.ok(resultado.quantidade < 25 && resultado.quantidade > 0);
    assert.equal((resultado.dados.midias as unknown[]).length, resultado.quantidade);
    // O cursor é o da página menor, então aponta para o primeiro item que ficou de fora.
    assert.equal(resultado.dados.proximo, `DEPOIS_DE_${resultado.quantidade}`);
    assert.deepEqual(
      m.graphFalsa.pedidos.map((p) => p.query.limit),
      ["25", "13", "7"],
    );
    // Nada de texto cortado: cada legenda continua inteira.
    for (const item of resultado.dados.midias as Array<{ caption: string }>) assert.equal(item.caption.length, 2_000);
  });

  it("página pequena passa direto, sem pedido extra", async () => {
    const resultado = await paginaNoTeto(
      3,
      async (limite) => ({ itens: Array.from({ length: limite }, (_, i) => i), proximo: null }),
      (pagina) => ({ itens: pagina.itens }),
    );
    assert.equal(resultado.quantidade, 3);
    assert.equal(resultado.reduzida, false);
  });
});
