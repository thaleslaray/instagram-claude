// Ficha 16: texto editável no cartão de confirmação. O ponto central é a regra de segurança: quem não tem o código
// original do pedido não consegue aprovar outro texto. O cartão calcula codigo_editado = SHA-256(codigo + "\n" + texto)
// (32 primeiros caracteres) e o servidor confere em tempo constante.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { MAX_ERROS_DE_CODIGO } from "../src/confirmacao.ts";
import { INSTRUCOES } from "../src/servidor.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { frasesDeTeste, NOME_ESCRITA_TESTE, registrarEscritaDeTeste, type OpcoesEscritaTeste } from "./escrita-falsa.ts";
import { CONTA_TESTE } from "./graph-falsa.ts";

const ROTA_ESCRITA = `/${CONTA_TESTE.id}/mensagem_de_teste`;
const ORIGINAL = "Oi, Fulano! Segue o material.";
const NOVO = "Oi, Fulano! Segue o material novo, com acento e emoji 😀.";

type Bloco = { text?: string };
type Resultado = { isError?: boolean; content: Bloco[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };
const textoDe = (r: Resultado): string => r.content.map((b) => b.text ?? "").join("\n");
/** O cálculo da ficha, feito aqui de forma independente do código do servidor. */
const codigoEditado = (codigo: string, texto: string): string => createHash("sha256").update(`${codigo}\n${texto}`, "utf8").digest("hex").slice(0, 32);

async function ambiente(escrita: OpcoesEscritaTeste) {
  const m = await montar();
  m.graphFalsa.rota("POST", ROTA_ESCRITA, { corpo: { id: "msg_1" } });
  const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: true, extras: [registrarEscritaDeTeste(escrita)] });
  const chamar = async (nome: string, argumentos: Record<string, unknown>): Promise<Resultado> => (await cliente.callTool({ name: nome, arguments: argumentos })) as unknown as Resultado;
  const escritas = (): Array<{ corpo: string }> => m.graphFalsa.pedidos.filter((p) => p.metodo === "POST");
  const registro = (): Array<Record<string, unknown>> => {
    try {
      return readFileSync(m.caminhoRegistro, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    } catch {
      return [];
    }
  };
  const previa = async (): Promise<{ id: string; codigo: string; r: Resultado }> => {
    const r = await chamar(NOME_ESCRITA_TESTE, { texto: ORIGINAL, para: "@fulano" });
    assert.ok(!r.isError, textoDe(r));
    return { id: String(r.structuredContent?.pedido), codigo: String(r._meta?.codigo), r };
  };
  return { m, chamar, escritas, registro, previa, fechar: async () => { await fechar(); await m.fechar(); } };
}

describe("texto editável: servidor", () => {
  let a: Awaited<ReturnType<typeof ambiente>>;
  beforeEach(async () => {
    a = await ambiente({ editavel: { limite: 60 } });
  });
  afterEach(async () => {
    await a.fechar();
  });

  it("a prévia de uma ferramenta com texto traz texto_editavel com limite e unidade", async () => {
    const { r } = await a.previa();
    assert.deepEqual((r._meta?.previa as Record<string, any>)?.texto_editavel, { limite: 60, unidade: "bytes" });
  });

  it("a prévia de ferramenta sem edição não traz texto_editavel", async () => {
    const outro = await ambiente({});
    try {
      outro.m.graphFalsa.rota("POST", ROTA_ESCRITA, { corpo: { id: "x" } });
      const r = await outro.chamar(NOME_ESCRITA_TESTE, { texto: ORIGINAL });
      assert.equal("texto_editavel" in (r.structuredContent ?? {}), false);
    } finally {
      await outro.fechar();
    }
  });

  it("texto editado com o código editado certo envia o texto novo (ig_confirmar)", async () => {
    const { id, codigo } = await a.previa();
    const r = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, NOVO), texto: NOVO });
    assert.ok(!r.isError, textoDe(r));
    assert.equal(a.escritas().length, 1);
    assert.equal(a.escritas()[0]?.corpo, JSON.stringify({ texto: NOVO, para: "@fulano" }));
  });

  it("o mesmo pelo caminho da tela (ig_confirmar_tela)", async () => {
    const { id, codigo } = await a.previa();
    const r = await a.chamar("ig_confirmar_tela", { id, codigo: codigoEditado(codigo, NOVO), texto: NOVO });
    assert.ok(!r.isError, textoDe(r));
    assert.equal(JSON.parse(a.escritas()[0]!.corpo).texto, NOVO);
    assert.equal(a.registro().find((l) => l.evento === "enviado")?.confirmacao, "ig_confirmar_tela");
  });

  it("texto novo com o código ORIGINAL é recusado e conta tentativa", async () => {
    const { id, codigo } = await a.previa();
    const r = await a.chamar("ig_confirmar", { id, codigo, texto: NOVO });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /Código errado \(1 de 3\)/);
    assert.equal(a.escritas().length, 0);
  });

  it("código editado calculado para OUTRO texto é recusado e conta tentativa", async () => {
    const { id, codigo } = await a.previa();
    const r = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, "Texto que o dono da conta viu"), texto: NOVO });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /Código errado \(1 de 3\)/);
    assert.equal(a.escritas().length, 0);
  });

  it("quem só conhece o código editado não consegue aprovar outro texto, nem o original com ele", async () => {
    const { id, codigo } = await a.previa();
    const editado = codigoEditado(codigo, NOVO);
    const outroTexto = await a.chamar("ig_confirmar", { id, codigo: editado, texto: "Outro texto, trocado pelo modelo" });
    assert.equal(outroTexto.isError, true);
    const semTexto = await a.chamar("ig_confirmar", { id, codigo: editado });
    assert.equal(semTexto.isError, true);
    assert.equal(a.escritas().length, 0);
  });

  it("três erros (misturando texto e código) cancelam o pedido, mesmo com o código certo depois", async () => {
    const { id, codigo } = await a.previa();
    await a.chamar("ig_confirmar", { id, codigo, texto: NOVO });
    await a.chamar("ig_confirmar", { id, codigo: "0".repeat(32), texto: NOVO });
    const terceiro = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, "x"), texto: NOVO });
    assert.match(textoDe(terceiro), /foi cancelado/);
    assert.equal(MAX_ERROS_DE_CODIGO, 3);
    const certo = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, NOVO), texto: NOVO });
    assert.equal(certo.isError, true);
    assert.equal(a.escritas().length, 0);
  });

  it("texto novo acima do limite é recusado com a frase da ferramenta, nada é enviado e o pedido segue pendente", async () => {
    const { id, codigo } = await a.previa();
    const longo = "á".repeat(40); // 80 bytes
    const r = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, longo), texto: longo });
    assert.equal(r.isError, true);
    assert.ok(textoDe(r).startsWith(frasesDeTeste.grande(80, 60)), textoDe(r));
    assert.equal(a.escritas().length, 0);
    const ok = await a.chamar("ig_confirmar", { id, codigo });
    assert.ok(!ok.isError, "o pedido continuava pendente: o texto original ainda confirma");
    assert.equal(JSON.parse(a.escritas()[0]!.corpo).texto, ORIGINAL);
  });

  it("texto novo vazio é recusado com a frase da ferramenta e o erro conta tentativa", async () => {
    const { id, codigo } = await a.previa();
    const r = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, "   "), texto: "   " });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), new RegExp(frasesDeTeste.vazio));
    assert.equal(a.escritas().length, 0);
    for (let i = 0; i < MAX_ERROS_DE_CODIGO - 1; i++) {
      const rr = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, "  "), texto: "  " });
      assert.equal(rr.isError, true);
    }
    assert.match(textoDe(await a.chamar("ig_confirmar", { id, codigo })), /cancelado/);
  });

  it("o registro grava o texto que foi de fato enviado e editado: true; sem edição, não marca", async () => {
    const { id, codigo } = await a.previa();
    await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, NOVO), texto: NOVO });
    const enviado = a.registro().find((l) => l.evento === "enviado");
    assert.equal(enviado?.texto, NOVO);
    assert.equal(enviado?.editado, true);

    const outra = await a.previa();
    await a.chamar("ig_confirmar", { id: outra.id, codigo: outra.codigo });
    const semEdicao = a.registro().filter((l) => l.evento === "enviado")[1];
    assert.equal(semEdicao?.texto, ORIGINAL);
    assert.equal("editado" in (semEdicao ?? {}), false);
  });

  it("um pedido confirmado com texto editado não pode ser reenviado", async () => {
    const { id, codigo } = await a.previa();
    await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, NOVO), texto: NOVO });
    const denovo = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, NOVO), texto: NOVO });
    assert.equal(denovo.isError, true);
    assert.equal(a.escritas().length, 1);
  });

  it("as instruções do servidor e a descrição do ig_confirmar dizem para só passar `texto` quando a mensagem trouxer o texto editado", async () => {
    assert.match(INSTRUCOES, /texto editado/);
    const { cliente, fechar } = await conectarCliente(a.m.ctx, { comTela: true });
    try {
      const f = (await cliente.listTools()).tools.find((t) => t.name === "ig_confirmar");
      assert.match(f?.description ?? "", /só passe `texto` quando a mensagem do dono da conta trouxer o texto editado; copie exatamente, sem mudar nada/);
    } finally {
      await fechar();
    }
  });
});

describe("texto editável: ferramenta sem texto", () => {
  it("recusa `texto` e conta tentativa", async () => {
    const a = await ambiente({}); // sem edição
    try {
      const { id, codigo } = await a.previa();
      const r = await a.chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, NOVO), texto: NOVO });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /não aceita texto novo/);
      assert.equal(a.escritas().length, 0);
      const ok = await a.chamar("ig_confirmar", { id, codigo });
      assert.ok(!ok.isError, "sem `texto`, vale a regra de sempre");
    } finally {
      await a.fechar();
    }
  });
});
