import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CofreEmMemoria } from "../src/cofre.ts";
import { BASE_PADRAO, lerConfig } from "../src/config.ts";
import { ErroGraph } from "../src/erros.ts";
import { ClienteGraph, cursorDepois, TokenAusente } from "../src/graph.ts";
import { montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, TOKEN_TESTE } from "./graph-falsa.ts";
import { RedeBloqueada } from "./setup.ts";

const IG = CONTA_TESTE.id;

describe("cliente da Graph: versão e token", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
    m.graphFalsa.rota("GET", `/${IG}`, { corpo: { id: IG } });
    m.graphFalsa.rota("POST", `/${IG}/messages`, { corpo: { recipient_id: "1", message_id: "m1" } });
    m.graphFalsa.rota("DELETE", "/1789", { corpo: { success: true } });
  });
  afterEach(async () => {
    await m.fechar();
  });

  it("usa v27.0 no caminho por padrão", async () => {
    await m.graph.get(IG, { fields: "id" });
    assert.equal(m.graphFalsa.pedidos[0]?.versao, "v27.0");
    assert.equal(m.graphFalsa.pedidos[0]?.urlBruta, `/v27.0/${IG}?fields=id`);
  });

  it("IG_GRAPH_VERSION troca a versão", async () => {
    const outro = await montar({ versao: "v26.0" });
    try {
      outro.graphFalsa.rota("GET", `/${IG}`, { corpo: { id: IG } });
      await outro.graph.get(IG);
      assert.equal(outro.graphFalsa.pedidos[0]?.versao, "v26.0");
    } finally {
      await outro.fechar();
    }
  });

  it("token só no cabeçalho Authorization em GET, POST e DELETE (nunca na URL nem no corpo)", async () => {
    await m.graph.get(IG, { fields: "id" });
    await m.graph.post(`${IG}/messages`, { recipient: { id: "1" }, message: { text: "oi" } });
    await m.graph.delete("1789");
    assert.equal(m.graphFalsa.pedidos.length, 3);
    for (const pedido of m.graphFalsa.pedidos) {
      assert.equal(pedido.cabecalhos.authorization, `Bearer ${TOKEN_TESTE}`, pedido.metodo);
      assert.ok(!pedido.urlBruta.includes(TOKEN_TESTE), `${pedido.metodo}: token na URL`);
      assert.ok(!decodeURIComponent(pedido.urlBruta).includes("access_token"), `${pedido.metodo}: access_token na URL`);
      assert.ok(!pedido.corpo.includes(TOKEN_TESTE), `${pedido.metodo}: token no corpo`);
      assert.equal(pedido.versao, "v27.0");
    }
    const post = m.graphFalsa.pedidos[1]!;
    assert.equal(post.cabecalhos["content-type"], "application/json");
    assert.deepEqual(JSON.parse(post.corpo), { recipient: { id: "1" }, message: { text: "oi" } });
    assert.equal(m.graphFalsa.pedidos[2]?.metodo, "DELETE");
  });

  it("sem token: TokenAusente e nenhum pedido sai", async () => {
    const semToken = await montar({ token: null });
    try {
      await assert.rejects(semToken.graph.get(IG), (erro: unknown) => erro instanceof TokenAusente && /npm run guardar-token/.test(erro.message));
      assert.equal(semToken.graphFalsa.pedidos.length, 0);
    } finally {
      await semToken.fechar();
    }
  });
});

describe("paginação: ignora o paging.next e remonta pelo cursor after", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
  });
  afterEach(async () => {
    await m.fechar();
  });

  for (const versaoNoNext of ["v26.0", "v27.0"]) {
    it(`next em ${versaoNoNext} com host e parâmetros a mais é ignorado`, async () => {
      const next = `https://graph.facebook.com/${versaoNoNext}/${IG}/media?access_token=VAZOU&fields=id,caption&limit=2&extra=1&pretty=0&after=CURSOR2`;
      m.graphFalsa.roteiro("GET", `/${IG}/media`, [
        { corpo: { data: [{ id: "a" }, { id: "b" }], paging: { cursors: { before: "CURSOR0", after: "CURSOR2" }, next } } },
        { corpo: { data: [{ id: "c" }], paging: { cursors: { before: "CURSOR2", after: "CURSOR3" } } } },
      ]);

      const primeira = await m.graph.pagina<{ id: string }>(`${IG}/media`, { fields: "id" }, 2);
      assert.deepEqual(primeira.itens.map((i) => i.id), ["a", "b"]);
      assert.equal(primeira.proximo, "CURSOR2");

      const segunda = await m.graph.pagina<{ id: string }>(`${IG}/media`, { fields: "id" }, 2, primeira.proximo);
      assert.deepEqual(segunda.itens.map((i) => i.id), ["c"]);
      assert.equal(segunda.proximo, null, "sem next = última página");

      const pedido = m.graphFalsa.pedidos[1]!;
      assert.equal(pedido.versao, "v27.0");
      assert.equal(pedido.caminho, `/${IG}/media`);
      assert.deepEqual(pedido.query, { fields: "id", limit: "2", after: "CURSOR2" });
      assert.equal(pedido.cabecalhos.authorization, `Bearer ${TOKEN_TESTE}`);
    });
  }

  it("todas() segue só o cursor até o máximo", async () => {
    m.graphFalsa.roteiro("GET", `/${IG}/conversations`, [
      { corpo: { data: [{ id: "1" }, { id: "2" }], paging: { cursors: { after: "A" }, next: "https://graph.facebook.com/v26.0/x?after=A&outro=1" } } },
      { corpo: { data: [{ id: "3" }, { id: "4" }], paging: { cursors: { after: "B" }, next: "https://graph.facebook.com/v27.0/x?after=B" } } },
    ]);
    const tudo = await m.graph.todas<{ id: string }>(`${IG}/conversations`, { platform: "instagram" }, 2, 4);
    assert.deepEqual(tudo.itens.map((i) => i.id), ["1", "2", "3", "4"]);
    assert.equal(tudo.proximo, "B");
    assert.deepEqual(m.graphFalsa.pedidos[1]?.query, { platform: "instagram", limit: "2", after: "A" });
  });

  it("cursorDepois usa só o after do next quando não há cursors", () => {
    assert.equal(cursorDepois({ next: "https://graph.facebook.com/v27.0/x?limit=5&after=XYZ&extra=1" }), "XYZ");
    assert.equal(cursorDepois({ cursors: { after: "ABC" } }), null, "sem next é a última página");
    assert.equal(cursorDepois(undefined), null);
  });
});

describe("hosts padrão da Meta sem IG_GRAPH_BASE", () => {
  it("a URL vai para https://graph.facebook.com/v27.0", async () => {
    const config = lerConfig({ IG_ACCOUNT_ID: IG });
    assert.equal(config.graphBase, BASE_PADRAO);
    const vistos: Array<{ url: string; auth: string | null }> = [];
    const graph = new ClienteGraph({
      config,
      cofre: new CofreEmMemoria(TOKEN_TESTE),
      fetch: async (url, init) => {
        vistos.push({ url: url.href, auth: new Headers(init.headers).get("authorization") });
        return new Response(JSON.stringify({ id: IG }), { status: 200 });
      },
    });
    await graph.get(IG, { fields: "id,username" });
    assert.deepEqual(vistos, [{ url: `https://graph.facebook.com/v27.0/${IG}?fields=id%2Cusername`, auth: `Bearer ${TOKEN_TESTE}` }]);
  });

  it("o fetch global dos testes recusa sair para a Meta", async () => {
    const config = lerConfig({ IG_ACCOUNT_ID: IG });
    const graph = new ClienteGraph({ config, cofre: new CofreEmMemoria(TOKEN_TESTE) });
    await assert.rejects(graph.get(IG), (erro: unknown) => erro instanceof Error && /só 127\.0\.0\.1/.test(erro.message));
    await assert.rejects(fetch("https://graph.facebook.com/v27.0/me"), RedeBloqueada);
  });

  it("falha de rede não vaza o token", async () => {
    const config = lerConfig({ IG_ACCOUNT_ID: IG });
    const graph = new ClienteGraph({
      config,
      cofre: new CofreEmMemoria(TOKEN_TESTE),
      fetch: async () => {
        throw new Error(`conexão recusada (Authorization: Bearer ${TOKEN_TESTE})`);
      },
    });
    await assert.rejects(graph.get(IG), (erro: unknown) => erro instanceof Error && !erro.message.includes(TOKEN_TESTE) && /Não consegui falar com a Meta/.test(erro.message));
  });

  it("HTTP 500 sem corpo JSON vira ErroGraph de Meta fora do ar", async () => {
    const config = lerConfig({ IG_ACCOUNT_ID: IG });
    const graph = new ClienteGraph({
      config,
      cofre: new CofreEmMemoria(TOKEN_TESTE),
      fetch: async () => new Response("<html>erro</html>", { status: 502 }),
    });
    await assert.rejects(graph.get(IG), (erro: unknown) => erro instanceof ErroGraph && erro.detalhe.status === 502 && /fora do ar/.test(erro.message));
  });
});
