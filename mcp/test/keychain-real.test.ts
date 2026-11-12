// Integração com o `security` de verdade, SÓ num serviço descartável (nunca `instagram-mcp`).
// Prova a lição do diário (P7): um valor de 252 caracteres volta inteiro pela entrada do `security -i`.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, it } from "node:test";
import { gravarNoKeychain } from "../src/cadastro.ts";
import { CofreKeychain } from "../src/cofre.ts";
import { esquecerSegredos } from "../src/segredos.ts";
import { executarReal } from "../src/sistema.ts";

const SERVICO = `instagram-mcp-teste-${randomBytes(6).toString("hex")}`;
const CONTA = "token-suat";

describe("Keychain real, serviço descartável", { skip: process.platform !== "darwin" ? "só no macOS" : false }, () => {
  after(async () => {
    // Apaga só o que este teste criou.
    assert.ok(SERVICO.startsWith("instagram-mcp-teste-"));
    await executarReal("security", ["delete-generic-password", "-s", SERVICO, "-a", CONTA]);
    esquecerSegredos();
  });

  it("conta ausente devolve null", async () => {
    assert.equal(await new CofreKeychain({ servico: SERVICO }).ler(CONTA), null);
  });

  it("grava 252 caracteres pela entrada padrão e lê tudo de volta; regravar atualiza", async () => {
    const longo = `EAA${randomBytes(200).toString("base64url").replace(/[^A-Za-z0-9]/g, "a").slice(0, 249)}`;
    assert.equal(longo.length, 252);
    await gravarNoKeychain(CONTA, longo, { servico: SERVICO });
    assert.equal(await new CofreKeychain({ servico: SERVICO }).ler(CONTA), longo);

    const novo = `EAA${"b".repeat(60)}`;
    await gravarNoKeychain(CONTA, novo, { servico: SERVICO });
    assert.equal(await new CofreKeychain({ servico: SERVICO }).ler(CONTA), novo);
  });
});
