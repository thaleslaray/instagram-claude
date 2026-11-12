import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CofreEmMemoria, CofreKeychain, CONTA_TOKEN, escolherCofre } from "../src/cofre.ts";
import { BASE_PADRAO, ErroConfig, lerConfig, protocoloModerno, VERSAO_PADRAO } from "../src/config.ts";
import { esquecerSegredos, limpar, MARCA_SEGREDO, registrar } from "../src/segredos.ts";
import type { Executor } from "../src/sistema.ts";

const IG = "17841400000000123";

describe("config", () => {
  it("sem IG_GRAPH_BASE e IG_GRAPH_VERSION usa a Meta em v27.0", () => {
    assert.deepEqual(lerConfig({ IG_ACCOUNT_ID: IG }), { contaId: IG, graphVersao: "v27.0", graphBase: "https://graph.facebook.com" });
    assert.equal(BASE_PADRAO, "https://graph.facebook.com");
    assert.equal(VERSAO_PADRAO, "v27.0");
  });

  it("IG_ACCOUNT_ID é obrigatório e só números", () => {
    assert.throws(() => lerConfig({}), ErroConfig);
    assert.throws(() => lerConfig({ IG_ACCOUNT_ID: "  " }), /IG_ACCOUNT_ID não configurado/);
    assert.throws(() => lerConfig({ IG_ACCOUNT_ID: "me" }), /só números/);
  });

  it("IG_GRAPH_VERSION precisa ter o formato vNN.N", () => {
    assert.equal(lerConfig({ IG_ACCOUNT_ID: IG, IG_GRAPH_VERSION: "v26.0" }).graphVersao, "v26.0");
    assert.throws(() => lerConfig({ IG_ACCOUNT_ID: IG, IG_GRAPH_VERSION: "27" }), ErroConfig);
  });

  it("IG_GRAPH_BASE só aceita a Meta ou 127.0.0.1", () => {
    assert.equal(lerConfig({ IG_ACCOUNT_ID: IG, IG_GRAPH_BASE: "http://127.0.0.1:4321/" }).graphBase, "http://127.0.0.1:4321");
    assert.equal(lerConfig({ IG_ACCOUNT_ID: IG, IG_GRAPH_BASE: "https://graph.facebook.com" }).graphBase, BASE_PADRAO);
    for (const ruim of ["https://exemplo.com", "http://localhost:4321", "https://graph.instagram.com", "http://graph.facebook.com", "lixo"]) {
      assert.throws(() => lerConfig({ IG_ACCOUNT_ID: IG, IG_GRAPH_BASE: ruim }), ErroConfig, ruim);
    }
  });
});

describe("cofre", () => {
  // Executor falso: estes testes nunca podem tocar o Keychain de verdade.
  const keychainVazio: Executor = async () => ({ codigo: 44, stdout: "", stderr: "" });

  it("sem IG_TESTE_TOKEN usa o Keychain; item ausente devolve null", async () => {
    const cofre = escolherCofre(lerConfig({ IG_ACCOUNT_ID: IG }), {}, keychainVazio);
    assert.ok(cofre instanceof CofreKeychain);
    assert.equal(await cofre.ler(CONTA_TOKEN), null);
  });

  it("IG_KEYCHAIN_SERVICO troca o serviço só com a Graph falsa em 127.0.0.1", async () => {
    const chamadas: string[][] = [];
    const executar: Executor = async (_cmd, args) => {
      chamadas.push([...args]);
      return { codigo: 44, stdout: "", stderr: "" };
    };
    const local = lerConfig({ IG_ACCOUNT_ID: IG, IG_GRAPH_BASE: "http://127.0.0.1:9999" });
    await escolherCofre(local, { IG_KEYCHAIN_SERVICO: "instagram-mcp-teste-x" }, executar).ler(CONTA_TOKEN);
    assert.deepEqual(chamadas[0], ["find-generic-password", "-s", "instagram-mcp-teste-x", "-a", "token-suat", "-w"]);
    assert.throws(() => escolherCofre(lerConfig({ IG_ACCOUNT_ID: IG }), { IG_KEYCHAIN_SERVICO: "outro" }, executar), /IG_KEYCHAIN_SERVICO só vale nos testes/);
    assert.throws(() => escolherCofre(local, { IG_KEYCHAIN_SERVICO: "-ruim" }, executar), /IG_KEYCHAIN_SERVICO inválido/);
  });

  it("IG_TESTE_TOKEN é aceito com IG_GRAPH_BASE em 127.0.0.1", async () => {
    const config = lerConfig({ IG_ACCOUNT_ID: IG, IG_GRAPH_BASE: "http://127.0.0.1:9999" });
    const cofre = escolherCofre(config, { IG_TESTE_TOKEN: "token-falso-123456" });
    assert.ok(cofre instanceof CofreEmMemoria);
    assert.equal(await cofre.ler(CONTA_TOKEN), "token-falso-123456");
  });

  it("IG_TESTE_TOKEN é recusado quando IG_GRAPH_BASE não é local", () => {
    const config = lerConfig({ IG_ACCOUNT_ID: IG });
    assert.throws(() => escolherCofre(config, { IG_TESTE_TOKEN: "token-falso-123456" }), /IG_TESTE_TOKEN só vale nos testes/);
  });
});

describe("token do campo seguro do Desktop (.mcpb): IG_TOKEN", () => {
  const TOKEN = "EAAfalsoDoCampoDoDesktop123456";
  const naoChamar: Executor = async () => {
    throw new Error("não devia chamar o security");
  };

  it("IG_TOKEN vale com a Graph de verdade e dispensa o Keychain para o token", async () => {
    const cofre = escolherCofre(lerConfig({ IG_ACCOUNT_ID: IG }), { IG_TOKEN: TOKEN }, naoChamar);
    assert.equal(await cofre.ler(CONTA_TOKEN), TOKEN);
  });

  it("o campo seguro só entrega o token; qualquer outra conta é null e o Keychain não é chamado", async () => {
    const cofre = escolherCofre(lerConfig({ IG_ACCOUNT_ID: IG }), { IG_TOKEN: TOKEN }, naoChamar);
    assert.equal(await cofre.ler("outra-conta"), null);
  });

  it("recusa valor que não parece token da Meta (não começa com EAA)", () => {
    assert.throws(() => escolherCofre(lerConfig({ IG_ACCOUNT_ID: IG }), { IG_TOKEN: "colei-outra-coisa" }), /não parece um token da Meta/);
  });

  it("campo vazio ou não substituído pelo Desktop (${user_config...}) conta como ausente: cai no Keychain", async () => {
    for (const vazio of ["", "   ", "${user_config.IG_TOKEN}"]) {
      const cofre = escolherCofre(lerConfig({ IG_ACCOUNT_ID: IG }), { IG_TOKEN: vazio }, async () => ({ codigo: 44, stdout: "", stderr: "" }));
      assert.ok(cofre instanceof CofreKeychain, JSON.stringify(vazio));
    }
  });

  it("o token do campo entra na limpeza de segredos", async () => {
    esquecerSegredos();
    escolherCofre(lerConfig({ IG_ACCOUNT_ID: IG }), { IG_TOKEN: TOKEN }, naoChamar);
    assert.ok(!limpar(`erro com ${TOKEN}`).includes(TOKEN));
  });
});

describe("protocolo por stdio", () => {
  it("o padrão é a era de 2025; IG_PROTOCOLO=moderno liga as duas", () => {
    assert.equal(protocoloModerno({}), false);
    assert.equal(protocoloModerno({ IG_PROTOCOLO: "${user_config.IG_PROTOCOLO}" }), false);
    assert.equal(protocoloModerno({ IG_PROTOCOLO: "Moderno" }), true);
  });
});

describe("limpar()", () => {
  it("troca os segredos registrados e o padrão EAA… por ‹segredo›", () => {
    esquecerSegredos();
    registrar("segredo-registrado-42");
    assert.equal(limpar("a segredo-registrado-42 b"), `a ${MARCA_SEGREDO} b`);
    assert.equal(limpar("token EAAJZBf9xYz1234567890abcdEF fim"), `token ${MARCA_SEGREDO} fim`);
    assert.equal(limpar("EAA curto EAA123"), "EAA curto EAA123");
    esquecerSegredos();
  });
});
