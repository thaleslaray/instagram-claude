import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { log, trocarSaidaDoLog } from "../src/log.ts";
import { esquecerSegredos, limpar, limparProfundo, linhaDeRegistro, MARCA_SEGREDO, registrar } from "../src/segredos.ts";

describe("segredos", () => {
  afterEach(() => esquecerSegredos());

  it("troca valores registrados, inclusive o que contém outro, e a forma codificada em URL", () => {
    registrar("chave-secreta-1");
    registrar("chave-secreta-1-com-sufixo");
    registrar("valor com espaço&sinal");
    assert.equal(limpar("a chave-secreta-1-com-sufixo b"), `a ${MARCA_SEGREDO} b`);
    assert.equal(limpar("x chave-secreta-1 y"), `x ${MARCA_SEGREDO} y`);
    assert.equal(limpar(`?q=${encodeURIComponent("valor com espaço&sinal")}`), `?q=${MARCA_SEGREDO}`);
  });

  it("ignora valores curtos demais (não vira coringa) e valores vazios", () => {
    registrar("abc");
    registrar("");
    registrar(null);
    registrar(undefined);
    assert.equal(limpar("abc abc"), "abc abc");
  });

  it("troca o padrão de token da Meta mesmo sem registro", () => {
    assert.equal(limpar("token EAAJZBf9xYz1234567890abcdEF fim"), `token ${MARCA_SEGREDO} fim`);
    assert.equal(limpar("EAA curto EAA123"), "EAA curto EAA123");
  });

  it("limparProfundo limpa textos e chaves dentro de objetos e listas; linhaDeRegistro devolve JSON limpo", () => {
    registrar("segredo-do-registro");
    const limpo = limparProfundo({ ok: 1, nested: { texto: "um segredo-do-registro aqui", lista: ["segredo-do-registro", 2, null] } });
    assert.deepEqual(limpo, { ok: 1, nested: { texto: `um ${MARCA_SEGREDO} aqui`, lista: [MARCA_SEGREDO, 2, null] } });
    const linha = linhaDeRegistro({ acao: "esconder", detalhe: "usou segredo-do-registro" });
    assert.ok(!linha.includes("segredo-do-registro"));
    assert.deepEqual(JSON.parse(linha), { acao: "esconder", detalhe: `usou ${MARCA_SEGREDO}` });
  });

  it("o logger limpa a linha antes de escrever", () => {
    registrar("segredo-no-log-123");
    const linhas: string[] = [];
    const restaurar = trocarSaidaDoLog((l) => linhas.push(l));
    try {
      log("[instagram-mcp] erro com segredo-no-log-123 e EAAabcdefghijklmnopqrstuvwxyz0123");
    } finally {
      restaurar();
    }
    assert.deepEqual(linhas, [`[instagram-mcp] erro com ${MARCA_SEGREDO} e ${MARCA_SEGREDO}`]);
  });
});
