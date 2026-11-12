import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { MENSAGEM_SEM_TOKEN } from "../src/cofre.ts";
import { partida } from "../src/contexto.ts";
import { FRASES } from "../src/erros.ts";
import { INSTRUCOES } from "../src/servidor.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, erroMeta, TOKEN_TESTE } from "./graph-falsa.ts";

const CAMINHO_CONTA = `/${CONTA_TESTE.id}`;

describe("ig_conta contra a Graph falsa", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
  });
  afterEach(async () => {
    await m.fechar();
  });

  it("devolve structuredContent e o mesmo JSON em texto", async () => {
    m.graphFalsa.rota("GET", CAMINHO_CONTA, { corpo: CONTA_TESTE });
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const resultado = await cliente.callTool({ name: "ig_conta", arguments: {} });
      assert.ok(!resultado.isError, JSON.stringify(resultado.content));
      assert.deepEqual(resultado.structuredContent, CONTA_TESTE);
      const [bloco] = resultado.content as Array<{ type: string; text: string }>;
      assert.equal(bloco?.type, "text");
      assert.deepEqual(JSON.parse(bloco!.text), resultado.structuredContent);
      assert.equal(m.ctx.conta.arroba, "conta_de_teste");
    } finally {
      await fechar();
    }
  });

  it("pede os campos certos, na v27.0, com o token só no cabeçalho", async () => {
    m.graphFalsa.rota("GET", CAMINHO_CONTA, { corpo: CONTA_TESTE });
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      await cliente.callTool({ name: "ig_conta", arguments: {} });
    } finally {
      await fechar();
    }
    const [pedido] = m.graphFalsa.pedidos;
    assert.ok(pedido);
    assert.equal(pedido.metodo, "GET");
    assert.equal(pedido.versao, "v27.0");
    assert.equal(pedido.caminho, CAMINHO_CONTA);
    assert.equal(
      pedido.query.fields,
      "id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website",
    );
    assert.equal(pedido.cabecalhos.authorization, `Bearer ${TOKEN_TESTE}`);
    assert.ok(!pedido.urlBruta.includes(TOKEN_TESTE));
    assert.ok(!("access_token" in pedido.query));
  });

  it("campo omitido pela Meta (bio e site vazios) não é erro", async () => {
    // CONTA_TESTE já vem sem biography e website, como a conta real na prova 1.
    m.graphFalsa.rota("GET", CAMINHO_CONTA, { corpo: { id: CONTA_TESTE.id, username: CONTA_TESTE.username } });
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const resultado = await cliente.callTool({ name: "ig_conta", arguments: {} });
      assert.ok(!resultado.isError, JSON.stringify(resultado.content));
      assert.deepEqual(resultado.structuredContent, { id: CONTA_TESTE.id, username: CONTA_TESTE.username });
    } finally {
      await fechar();
    }
  });

  it("anota a ferramenta como leitura, com outputSchema, e manda as instruções", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const { tools } = await cliente.listTools();
      assert.ok(tools.some((t) => t.name === "ig_conta"));
      const conta = tools.find((t) => t.name === "ig_conta")!;
      assert.equal(conta.annotations?.readOnlyHint, true);
      assert.equal(conta.annotations?.destructiveHint, false);
      assert.equal(conta.annotations?.idempotentHint, true);
      assert.equal(conta.annotations?.openWorldHint, true);
      assert.equal(conta.outputSchema?.type, "object");
      assert.deepEqual(conta.outputSchema?.required, ["id", "username"]);
      assert.equal(cliente.getInstructions(), INSTRUCOES);
    } finally {
      await fechar();
    }
  });

  it("recusa argumento desconhecido", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const resultado = await cliente.callTool({ name: "ig_conta", arguments: { conta: "outra" } });
      assert.equal(resultado.isError, true);
      assert.equal(m.graphFalsa.pedidos.length, 0);
    } finally {
      await fechar();
    }
  });

  it("erro da Meta chega traduzido ao Claude, sem o token", async () => {
    m.graphFalsa.rota("GET", CAMINHO_CONTA, erroMeta(190, `Error validating access token ${TOKEN_TESTE} EAAB1234567890abcdefghijklmnop`));
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const resultado = await cliente.callTool({ name: "ig_conta", arguments: {} });
      assert.equal(resultado.isError, true);
      const texto = (resultado.content as Array<{ text: string }>)[0]!.text;
      assert.ok(texto.startsWith(FRASES.token), texto);
      assert.ok(texto.includes("code 190"));
      assert.ok(texto.includes("fbtrace_id Afalso190"));
      assert.ok(!texto.includes(TOKEN_TESTE), texto);
      assert.ok(!texto.includes("EAAB1234567890"), texto);
    } finally {
      await fechar();
    }
  });

  it("repete sem name e profile_picture_url quando a Meta recusa esses campos, com aviso", async () => {
    m.graphFalsa.roteiro("GET", CAMINHO_CONTA, [
      erroMeta(100, "(#100) Tried accessing nonexisting field (profile_picture_url)", undefined, "IGApiException"),
      { corpo: { id: CONTA_TESTE.id, username: CONTA_TESTE.username, followers_count: 2 } },
    ]);
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const resultado = await cliente.callTool({ name: "ig_conta", arguments: {} });
      assert.ok(!resultado.isError, JSON.stringify(resultado.content));
      const dados = resultado.structuredContent as Record<string, unknown>;
      assert.equal(dados.username, CONTA_TESTE.username);
      assert.match(String(dados.aviso), /name, profile_picture_url/);
      assert.equal(m.graphFalsa.pedidos[1]?.query.fields, "id,username,biography,followers_count,follows_count,media_count,website");
    } finally {
      await fechar();
    }
  });
});

describe("sem token cadastrado", () => {
  it("ig_conta responde 'Token não cadastrado' e não chama a Meta", async () => {
    const m = await montar({ token: null });
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const resultado = await cliente.callTool({ name: "ig_conta", arguments: {} });
      assert.equal(resultado.isError, true);
      assert.equal((resultado.content as Array<{ text: string }>)[0]!.text, MENSAGEM_SEM_TOKEN);
      assert.equal(m.graphFalsa.pedidos.length, 0);
    } finally {
      await fechar();
      await m.fechar();
    }
  });
});

describe("partida", () => {
  it("confere a conta com fields=id,username e guarda o @", async () => {
    const m = await montar();
    try {
      m.graphFalsa.rota("GET", CAMINHO_CONTA, { corpo: { id: CONTA_TESTE.id, username: CONTA_TESTE.username } });
      const linhas: string[] = [];
      const resultado = await partida(m.ctx, (l) => linhas.push(l));
      assert.deepEqual(resultado, { estado: "ok", arroba: "conta_de_teste" });
      assert.equal(m.ctx.conta.arroba, "conta_de_teste");
      assert.equal(m.graphFalsa.pedidos[0]?.query.fields, "id,username");
    } finally {
      await m.fechar();
    }
  });

  it("sem token não derruba nada e não chama a Meta", async () => {
    const m = await montar({ token: null });
    try {
      const linhas: string[] = [];
      assert.deepEqual(await partida(m.ctx, (l) => linhas.push(l)), { estado: "sem_token" });
      assert.equal(m.graphFalsa.pedidos.length, 0);
      assert.match(linhas.join("\n"), /Token não cadastrado/);
    } finally {
      await m.fechar();
    }
  });

  it("avisa quando a Meta devolve outro ID", async () => {
    const m = await montar();
    try {
      m.graphFalsa.rota("GET", CAMINHO_CONTA, { corpo: { id: "999", username: "outra" } });
      const resultado = await partida(m.ctx, () => {});
      assert.equal(resultado.estado, "erro");
      assert.equal(m.ctx.conta.arroba, null);
    } finally {
      await m.fechar();
    }
  });
});
