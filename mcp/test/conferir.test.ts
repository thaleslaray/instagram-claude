import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CofreEmMemoria } from "../src/cofre.ts";
import { lerConfig } from "../src/config.ts";
import { conferir, formatarTabela } from "../src/conferencia.ts";
import { CONTA_TESTE, erroMeta, GraphFalsa, TOKEN_TESTE } from "./graph-falsa.ts";

const IG = CONTA_TESTE.id;
const PESSOA = "17841400000000001";
const SEGREDO_DE_DM = "SEGREDO-DE-DM-NAO-PODE-APARECER";

function montarRotas(g: GraphFalsa): void {
  g.rota("GET", `/${IG}`, (p) =>
    p.query.fields?.startsWith("business_discovery")
      ? { corpo: { id: IG, business_discovery: { id: "9", username: "bluebottle", followers_count: 10, media: { data: [{ id: "m1", like_count: 3 }, { id: "m2", like_count: 4 }] } } } }
      : { corpo: CONTA_TESTE },
  );
  g.rota("GET", `/${IG}/media`, (p) => ({ corpo: { data: [{ id: "m1", media_type: "IMAGE", ...(p.query.fields?.includes("caption") ? { caption: "legenda" } : {}) }] } }));
  g.rota("GET", `/${IG}/stories`, { corpo: { data: [] } });
  g.rota("GET", `/${IG}/tags`, { corpo: { data: [{ id: "t1", username: "alguem", caption: SEGREDO_DE_DM }] } });
  g.rota("GET", `/${IG}/conversations`, {
    corpo: { data: [{ id: "c1", updated_time: "2026-11-07T10:00:00+0000", participants: { data: [{ id: PESSOA, username: "fulano" }, { id: IG, username: CONTA_TESTE.username }] } }] },
  });
  g.rota("GET", "/c1", {
    corpo: { id: "c1", messages: { data: [{ id: "x1", created_time: "2026-11-07T10:00:00+0000", from: { id: PESSOA, username: "fulano" }, to: { data: [{ id: IG }] }, message: SEGREDO_DE_DM }] } },
  });
  g.rota("GET", `/${PESSOA}`, { corpo: { id: PESSOA, username: "fulano", name: SEGREDO_DE_DM, follower_count: 4 } });
  g.rota("GET", `/${IG}/insights`, { corpo: { data: [{ name: "reach", period: "day", values: [{ value: 12, end_time: "2026-11-07T08:00:00+0000" }], title: "r", description: "d", id: "i" }] } });
  g.rota("GET", `/${IG}/content_publishing_limit`, { corpo: { data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: 86400 } }] } });
}

describe("conferir (só leitura) contra a Graph falsa", () => {
  let g: GraphFalsa;
  let base: string;
  beforeEach(async () => {
    g = new GraphFalsa();
    base = await g.iniciar();
    montarRotas(g);
  });
  afterEach(async () => {
    await g.parar();
  });

  const rodar = (extra: Partial<Parameters<typeof conferir>[0]> = {}) =>
    conferir({
      config: lerConfig({ IG_ACCOUNT_ID: IG, IG_GRAPH_BASE: base }),
      cofre: new CofreEmMemoria(TOKEN_TESTE),
      versoes: ["v27.0", "v26.0"],
      perfilPublico: "bluebottle",
      intervaloMs: 0,
      ...extra,
    });

  it("roda a lista inteira nas duas versões e tudo funciona, igual nas duas", async () => {
    const r = await rodar();
    const nomes = r.linhas.map((l) => l.ferramenta);
    assert.deepEqual(nomes, [
      "ig_conta",
      "ig_listar_midias (com caption)",
      "ig_listar_midias (sem caption)",
      "ig_listar_stories",
      "ig_listar_conversas",
      "ig_ler_conversa",
      "ig_perfil_contato",
      "ig_listar_marcacoes",
      "ig_perfil_publico",
      "ig_insights_conta (reach)",
      "ig_limite_publicacao",
    ]);
    for (const l of r.linhas) {
      assert.equal(l.resultados["v27.0"]?.estado, "ok", l.ferramenta);
      assert.equal(l.resultados["v26.0"]?.estado, "ok", l.ferramenta);
    }
    assert.equal(r.diferencas, 0);
    assert.equal(r.erros, 0);
    assert.ok(r.ok);
    // pedidos nas duas versões, só GET, token só no cabeçalho
    assert.ok(g.pedidos.some((p) => p.versao === "v27.0") && g.pedidos.some((p) => p.versao === "v26.0"));
    assert.ok(g.pedidos.every((p) => p.metodo === "GET"));
    assert.ok(g.pedidos.every((p) => !p.urlBruta.includes(TOKEN_TESTE) && p.cabecalhos.authorization === `Bearer ${TOKEN_TESTE}`));
  });

  it("a tabela traz só contagens: nada de conteúdo de DM, nome ou legenda", async () => {
    const tabela = formatarTabela(await rodar(), ["v27.0", "v26.0"]);
    assert.ok(!tabela.includes(SEGREDO_DE_DM));
    assert.ok(!tabela.includes("fulano"));
    assert.match(tabela, /ig_ler_conversa/);
    assert.match(tabela, /1 mensagem/);
  });

  it("aponta diferença de resposta entre v27.0 e v26.0", async () => {
    g.rota("GET", `/${IG}/stories`, (p) => ({ corpo: { data: p.versao === "v26.0" ? [{ id: "s1", media_type: "IMAGE" }] : [] } }));
    const r = await rodar();
    assert.equal(r.diferencas, 1);
    assert.equal(r.linhas.find((l) => l.ferramenta === "ig_listar_stories")?.igual, false);
    assert.ok(!r.ok);
    assert.match(formatarTabela(r, ["v27.0", "v26.0"]), /DIFERENTE/);
  });

  it("erro da Meta vira frase traduzida e a conferência continua", async () => {
    g.rota("GET", `/${IG}/tags`, erroMeta(10, "Permissão negada", 2108006));
    const r = await rodar();
    const l = r.linhas.find((x) => x.ferramenta === "ig_listar_marcacoes")!;
    assert.equal(l.resultados["v27.0"]?.estado, "erro");
    assert.match(l.resultados["v27.0"]!.detalhe, /code 10/);
    assert.equal(r.erros, 2);
    assert.equal(r.linhas.find((x) => x.ferramenta === "ig_limite_publicacao")?.resultados["v27.0"]?.estado, "ok");
  });

  it("sem conversas, os passos que dependem delas ficam pulados", async () => {
    g.rota("GET", `/${IG}/conversations`, { corpo: { data: [] } });
    const r = await rodar();
    for (const nome of ["ig_ler_conversa", "ig_perfil_contato"]) {
      assert.equal(r.linhas.find((l) => l.ferramenta === nome)?.resultados["v27.0"]?.estado, "pulado");
    }
    assert.ok(r.ok);
  });
});
