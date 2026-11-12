import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { cadastrarToken, gravarNoKeychain } from "../src/cadastro.ts";
import { esquecerSegredos } from "../src/segredos.ts";
import { CONTA_TESTE, erroMeta, GraphFalsa } from "./graph-falsa.ts";
import { SistemaFalso } from "./sistema-falso.ts";

/** Token do tamanho de um de verdade (252 caracteres): o pedido de senha do `security` cortaria em 128. */
const TOKEN = `${`EAATESTE${"x9Z".repeat(81)}`.slice(0, 246)}VAZOU1`;
const SERVICO = "instagram-mcp";

describe("guardar-token com security, pbpaste e pbcopy falsos", () => {
  let sistema: SistemaFalso;
  let saida: string[];
  beforeEach(() => {
    sistema = new SistemaFalso();
    saida = [];
  });
  afterEach(() => esquecerSegredos());

  const rodar = (env: Record<string, string | undefined> = {}) =>
    cadastrarToken({ executar: sistema.executar, escrever: (l) => saida.push(l), env });

  it("o token tem mesmo 252 caracteres (como o da Meta)", () => {
    assert.equal(TOKEN.length, 252);
  });

  it("grava pela entrada padrão do `security -i`, nunca em argumento, e confere de volta", async () => {
    sistema.area = TOKEN;
    assert.equal(await rodar(), 0);
    assert.equal(sistema.keychain.get(`${SERVICO}/token-suat`), TOKEN, "valor inteiro gravado (sem corte em 128)");
    const gravacao = sistema.chamadas.find((c) => c.comando === "security" && c.args[0] === "-i");
    assert.deepEqual(gravacao?.args, ["-i"]);
    assert.equal(gravacao?.entrada, `add-generic-password -U -s instagram-mcp -a token-suat -w "${TOKEN}"\n`);
    assert.ok(!sistema.todosOsArgumentos.includes(TOKEN), "token na lista de argumentos");
    assert.ok(!sistema.todosOsArgumentos.includes("-w \""), "pedido de senha / valor em argv");
    // Nunca usa `add-generic-password` fora do `-i`.
    assert.ok(!sistema.chamadas.some((c) => c.args[0] === "add-generic-password"));
    // A leitura de volta existe, e só leu.
    assert.ok(sistema.chamadas.some((c) => c.args[0] === "find-generic-password" && c.args.includes("token-suat")));
  });

  it("limpa a área de transferência e não imprime o token", async () => {
    sistema.area = TOKEN;
    await rodar();
    assert.equal(sistema.area, "");
    const ultimo = sistema.chamadas.filter((c) => c.comando === "pbcopy").at(-1);
    assert.equal(ultimo?.entrada, "");
    assert.ok(!saida.join("\n").includes(TOKEN));
    assert.match(saida.join("\n"), /Token guardado e conferido no Keychain \(252 caracteres\)/);
  });

  it("valor fora do padrão é recusado sem gravar e sem limpar a área de transferência", async () => {
    for (const ruim of ["", "abc", "EAA com espaço 1234567890", "EAAabc-def", `XAA${"a".repeat(30)}`, `EAA${"a".repeat(30)}"; rm`, "EAA"]) {
      sistema.area = ruim;
      sistema.chamadas.length = 0;
      saida.length = 0;
      assert.equal(await rodar(), 1, `deveria recusar ${JSON.stringify(ruim)}`);
      assert.ok(!sistema.chamadas.some((c) => c.comando === "security"), "chamou o security com valor ruim");
      assert.equal(sistema.area, ruim, "mexeu na área de transferência de quem não tinha token");
      assert.match(saida.join("\n"), /não tem um token da Meta/);
    }
    assert.equal(sistema.keychain.size, 0);
  });

  it("o security recusar gravar vira erro, sem repetir a mensagem dele (que pode ecoar o token)", async () => {
    sistema.area = TOKEN;
    sistema.falhaAoGravar = { codigo: 1, stderr: `security: erro em add-generic-password ... -w "${TOKEN}"` };
    assert.equal(await rodar(), 1);
    assert.match(saida.join("\n"), /recusou gravar/);
    assert.ok(!saida.join("\n").includes(TOKEN));
    assert.equal(sistema.area, "", "a área de transferência é limpa também na falha");
  });

  it("stderr do security com código 0 também conta como falha", async () => {
    sistema.area = TOKEN;
    sistema.falhaAoGravar = { codigo: 0, stderr: "alguma coisa deu errado" };
    assert.equal(await rodar(), 1);
    assert.equal(sistema.keychain.size, 0);
  });

  it("leitura de volta diferente é erro e não diz que deu certo", async () => {
    sistema.area = TOKEN;
    sistema.leituraDiferente = TOKEN.slice(0, 128);
    assert.equal(await rodar(), 1);
    const texto = saida.join("\n");
    assert.match(texto, /valor lido de volta é diferente/);
    assert.ok(!/Token guardado e conferido/.test(texto));
    assert.ok(!texto.includes(TOKEN));
  });

  it("aviso quando não consegue limpar a área de transferência", async () => {
    sistema.area = TOKEN;
    sistema.pbcopyFalha = true;
    assert.equal(await rodar(), 0);
    assert.match(saida.join("\n"), /não consegui limpar a área de transferência/);
  });

  describe("com IG_ACCOUNT_ID, testa na Meta pelo cliente da Graph", () => {
    let graphFalsa: GraphFalsa;
    let env: Record<string, string>;
    beforeEach(async () => {
      graphFalsa = new GraphFalsa();
      env = { IG_ACCOUNT_ID: CONTA_TESTE.id, IG_GRAPH_BASE: await graphFalsa.iniciar() };
    });
    afterEach(() => graphFalsa.parar());

    it("mostra 'Token guardado e funcionando para @…'", async () => {
      graphFalsa.rota("GET", `/${CONTA_TESTE.id}`, { corpo: { username: CONTA_TESTE.username, id: CONTA_TESTE.id } });
      sistema.area = TOKEN;
      assert.equal(await rodar(env), 0);
      assert.match(saida.join("\n"), /Token guardado e funcionando para @conta_de_teste\./);
      const [pedido] = graphFalsa.pedidos;
      assert.equal(pedido?.query.fields, "username");
      assert.equal(pedido?.cabecalhos.authorization, `Bearer ${TOKEN}`);
      assert.ok(!pedido?.urlBruta.includes(TOKEN));
      assert.ok(!saida.join("\n").includes(TOKEN));
    });

    it("token recusado pela Meta (190): avisa, sem o token, e sai com 1", async () => {
      graphFalsa.rota("GET", `/${CONTA_TESTE.id}`, erroMeta(190, `Invalid OAuth access token ${TOKEN}`));
      sistema.area = TOKEN;
      assert.equal(await rodar(env), 1);
      const texto = saida.join("\n");
      assert.match(texto, /Token guardado, mas a Meta não o aceitou/);
      assert.match(texto, /190/);
      assert.ok(!texto.includes(TOKEN));
      assert.equal(sistema.keychain.get(`${SERVICO}/token-suat`), TOKEN, "o token continua guardado");
    });
  });

  it("sem IG_ACCOUNT_ID guarda e avisa que não testou na Meta", async () => {
    sistema.area = TOKEN;
    assert.equal(await rodar({}), 0);
    assert.match(saida.join("\n"), /Não testei o token na Meta/);
  });
});

describe("gravarNoKeychain", () => {
  afterEach(() => esquecerSegredos());
  it("recusa valor com aspas, barra, espaço ou quebra de linha (injeção no comando do security -i)", async () => {
    const sistema = new SistemaFalso();
    for (const ruim of ['abc"def', "abc\\def", "abc def", "abc\ndef", "abc'def", ""]) {
      await assert.rejects(() => gravarNoKeychain("token-suat", ruim, { executar: sistema.executar }), /caracteres que não posso gravar/);
    }
    assert.equal(sistema.chamadas.length, 0);
  });
});
