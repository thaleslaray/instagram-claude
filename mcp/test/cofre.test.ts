import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CofreEmMemoria, CofreKeychain, CONTA_TOKEN } from "../src/cofre.ts";
import { trocarSaidaDoLog } from "../src/log.ts";
import { esquecerSegredos, limpar, MARCA_SEGREDO } from "../src/segredos.ts";
import type { Executor } from "../src/sistema.ts";

const VALOR = "EAATESTE-NAO-REAL-VALOR-LONGO-9f3a1c7b2d4e6f80";

describe("CofreKeychain com execFile falso", () => {
  afterEach(() => esquecerSegredos());

  function falso(resposta: { codigo: number; stdout?: string; stderr?: string }) {
    const chamadas: Array<{ comando: string; args: readonly string[]; entrada: string | undefined }> = [];
    const executar: Executor = async (comando, args, entrada) => {
      chamadas.push({ comando, args, entrada });
      return { codigo: resposta.codigo, stdout: resposta.stdout ?? "", stderr: resposta.stderr ?? "" };
    };
    return { chamadas, executar };
  }

  it("chama `security find-generic-password -s instagram-mcp -a <conta> -w`, sem shell e sem entrada", async () => {
    const { chamadas, executar } = falso({ codigo: 0, stdout: `${VALOR}\n` });
    const valor = await new CofreKeychain({ executar }).ler(CONTA_TOKEN);
    assert.equal(valor, VALOR);
    assert.deepEqual(chamadas, [
      { comando: "security", args: ["find-generic-password", "-s", "instagram-mcp", "-a", "token-suat", "-w"], entrada: undefined },
    ]);
  });

  it("registra o valor lido: depois disso limpar() o apaga", async () => {
    const { executar } = falso({ codigo: 0, stdout: `${VALOR}\n` });
    await new CofreKeychain({ executar }).ler(CONTA_TOKEN);
    assert.equal(limpar(`erro com ${VALOR}`), `erro com ${MARCA_SEGREDO}`);
  });

  it("não escreve nada no log nem no stderr ao ler", async () => {
    const linhas: string[] = [];
    const restaurar = trocarSaidaDoLog((l) => linhas.push(l));
    const escritos: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((trecho: string | Uint8Array) => {
      escritos.push(String(trecho));
      return true;
    }) as typeof process.stderr.write;
    try {
      const { executar } = falso({ codigo: 0, stdout: `${VALOR}\n` });
      await new CofreKeychain({ executar }).ler(CONTA_TOKEN);
    } finally {
      process.stderr.write = original;
      restaurar();
    }
    assert.deepEqual(linhas, []);
    assert.ok(!escritos.join("").includes(VALOR));
  });

  it("item ausente (código 44) devolve null", async () => {
    const { executar } = falso({ codigo: 44, stderr: "The specified item could not be found in the keychain." });
    assert.equal(await new CofreKeychain({ executar }).ler(CONTA_TOKEN), null);
  });

  it("saída vazia devolve null", async () => {
    const { executar } = falso({ codigo: 0, stdout: "\n" });
    assert.equal(await new CofreKeychain({ executar }).ler(CONTA_TOKEN), null);
  });

  it("outro erro do security vira exceção sem a saída dele", async () => {
    const { executar } = falso({ codigo: 36, stdout: VALOR, stderr: `user interaction is not allowed ${VALOR}` });
    await assert.rejects(
      () => new CofreKeychain({ executar }).ler(CONTA_TOKEN),
      (erro: Error) => /código 36/.test(erro.message) && !erro.message.includes(VALOR),
    );
  });

  it("recusa nome de conta ou serviço que pareça opção do comando", async () => {
    const { chamadas, executar } = falso({ codigo: 44 });
    await assert.rejects(() => new CofreKeychain({ executar }).ler("-w"), /Nome inválido/);
    await assert.rejects(() => new CofreKeychain({ executar }).ler("a b"), /Nome inválido/);
    assert.throws(() => new CofreKeychain({ executar, servico: "-s" }), /Nome inválido/);
    assert.equal(chamadas.length, 0);
  });
});

describe("CofreEmMemoria", () => {
  afterEach(() => esquecerSegredos());
  it("devolve o token e as outras contas; o resto é null", async () => {
    const cofre = new CofreEmMemoria("token-de-teste-123", { "outra-conta": "id-de-teste-12345" });
    assert.equal(await cofre.ler(CONTA_TOKEN), "token-de-teste-123");
    assert.equal(await cofre.ler("outra-conta"), "id-de-teste-12345");
    assert.equal(await cofre.ler("outra"), null);
    assert.equal(limpar("id-de-teste-12345"), MARCA_SEGREDO);
  });
});
