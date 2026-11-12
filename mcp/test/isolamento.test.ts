// Nenhum teste pode gravar nos arquivos reais do Thales (cota de publicação, registro de ações, privados.json).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { estadoDePublicacao } from "../src/publicacao.ts";
import { montar } from "./ajuda.ts";

const PASTA_DOS_TESTES = new URL(".", import.meta.url).pathname;

describe("isolamento dos testes", () => {
  it("a montagem comum aponta todo arquivo de estado para a pasta temporária", async () => {
    const m = await montar();
    try {
      const caminhos = [m.ctx.registro.caminho, m.ctx.caminhoPrivados, estadoDePublicacao(m.ctx).contagem.caminho];
      for (const c of caminhos) {
        assert.ok(resolve(c).startsWith(resolve(tmpdir())), `${c} não está em ${tmpdir()}`);
        assert.ok(!resolve(c).startsWith(join(homedir(), "Library")), `${c} está em ~/Library`);
      }
    } finally {
      await m.fechar();
    }
  });

  it("só test/ajuda.ts monta o Contexto e ninguém usa contagem ou registro sem caminho", () => {
    for (const nome of readdirSync(PASTA_DOS_TESTES).filter((n) => n.endsWith(".ts") && n !== "isolamento.test.ts" && n !== "ajuda.ts")) {
      const texto = readFileSync(join(PASTA_DOS_TESTES, nome), "utf8");
      assert.doesNotMatch(texto, /criarContexto\(/, `${nome} monta o Contexto à mão: use montar() de ajuda.ts`);
      assert.doesNotMatch(texto, /new ContagemPublicacoes\(\s*\)/, `${nome} cria a contagem sem caminho`);
      assert.doesNotMatch(texto, /new RegistroAcoes\(\s*\)/, `${nome} cria o registro sem caminho`);
    }
  });
});
