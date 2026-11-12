import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, erroMeta } from "./graph-falsa.ts";

const IG = `/${CONTA_TESTE.id}`;

function texto(resultado: unknown): string {
  return ((resultado as { content: Array<{ text: string }> }).content[0]?.text) ?? "";
}

describe("ig_insights_conta: validação antes de chamar a Meta", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
  });
  afterEach(async () => {
    await m.fechar();
  });

  async function chamar(args: Record<string, unknown>) {
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      return await cliente.callTool({ name: "ig_insights_conta", arguments: args });
    } finally {
      await fechar();
    }
  }

  const recusas: Array<[string, Record<string, unknown>, RegExp]> = [
    ["detalhar_por com time_series", { metricas: ["reach"], tipo: "time_series", detalhar_por: "media_product_type" }, /só funciona com tipo=total_value/],
    ["time_series em métrica que não aceita", { metricas: ["views"], tipo: "time_series" }, /views não aceita tipo=time_series/],
    ["impressions (descontinuada)", { metricas: ["impressions"] }, /descontinuada pela Meta/],
    ["profile_views (descontinuada)", { metricas: ["profile_views"] }, /descontinuada pela Meta/],
    ["métrica inventada", { metricas: ["magia"] }, /não aceita/],
    ["91 dias", { metricas: ["reach"], desde: "2026-08-01", ate: "2026-11-01" }, /passa de 90 dias/],
    ["demografia sem janela", { metricas: ["follower_demographics"], detalhar_por: "country" }, /exige `janela`/],
    ["demografia sem detalhar_por", { metricas: ["follower_demographics"], janela: "this_month" }, /exige `detalhar_por`/],
    ["demografia misturada", { metricas: ["follower_demographics", "reach"], janela: "this_month", detalhar_por: "country" }, /não pode ser pedida junto/],
    ["janela fora de demografia", { metricas: ["reach"], janela: "this_month" }, /só vale para demografia/],
    ["detalhe que a métrica não tem", { metricas: ["accounts_engaged"], detalhar_por: "follow_type" }, /não detalha por follow_type/],
    ["data que não é ISO", { metricas: ["reach"], desde: "ontem" }, /data ISO/],
    ["ate antes de desde", { metricas: ["reach"], desde: "2026-11-05", ate: "2026-11-01" }, /depois de `desde`/],
  ];
  for (const [nome, args, esperado] of recusas) {
    it(`recusa ${nome}`, async () => {
      const resultado = await chamar(args);
      assert.equal(resultado.isError, true);
      assert.match(texto(resultado), esperado);
      assert.equal(m.graphFalsa.pedidos.length, 0, "não pode chamar a Meta");
    });
  }

  it("90 dias exatos passa", async () => {
    m.graphFalsa.rota("GET", `${IG}/insights`, { corpo: { data: [] } });
    const resultado = await chamar({ metricas: ["reach"], desde: "2026-08-01", ate: "2026-10-30" });
    assert.ok(!resultado.isError, texto(resultado));
  });
});

describe("ig_insights_conta contra a Graph falsa", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
  });
  afterEach(async () => {
    await m.fechar();
  });

  async function chamar(args: Record<string, unknown>) {
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      return await cliente.callTool({ name: "ig_insights_conta", arguments: args });
    } finally {
      await fechar();
    }
  }

  it("time_series: manda timestamps e devolve a série achatada", async () => {
    m.graphFalsa.rota("GET", `${IG}/insights`, {
      corpo: {
        data: [
          {
            name: "reach",
            period: "day",
            title: "Alcance",
            id: `${CONTA_TESTE.id}/insights/reach/day`,
            values: [
              { value: 3, end_time: "2026-11-02T08:00:00+0000" },
              { value: 5, end_time: "2026-11-03T08:00:00+0000" },
            ],
          },
        ],
        paging: { next: "https://graph.facebook.com/v27.0/x" },
      },
    });
    const resultado = await chamar({ metricas: ["reach"], tipo: "time_series", desde: "2026-11-01", ate: "2026-11-03T00:00:00Z" });
    assert.ok(!resultado.isError, texto(resultado));
    const [pedido] = m.graphFalsa.pedidos;
    assert.equal(pedido?.versao, "v27.0");
    assert.equal(pedido?.query.metric, "reach");
    assert.equal(pedido?.query.period, "day");
    assert.equal(pedido?.query.metric_type, "time_series");
    assert.equal(pedido?.query.since, String(Date.parse("2026-11-01T00:00:00Z") / 1000));
    assert.equal(pedido?.query.until, String(Date.parse("2026-11-03T00:00:00Z") / 1000));
    assert.ok(!("breakdown" in (pedido?.query ?? {})));
    assert.deepEqual(resultado.structuredContent, {
      tipo: "time_series",
      periodo: { desde: "2026-11-01T00:00:00.000Z", ate: "2026-11-03T00:00:00.000Z" },
      metricas: [
        {
          metrica: "reach",
          titulo: "Alcance",
          serie: [
            { fim: "2026-11-02T08:00:00+0000", valor: 3 },
            { fim: "2026-11-03T08:00:00+0000", valor: 5 },
          ],
        },
      ],
    });
  });

  it("total_value com detalhamento por media_product_type", async () => {
    m.graphFalsa.rota("GET", `${IG}/insights`, {
      corpo: {
        data: [
          {
            name: "reach",
            period: "day",
            title: "Alcance",
            total_value: {
              value: 12,
              breakdowns: [{ dimension_keys: ["media_product_type"], results: [{ dimension_values: ["REELS"], value: 9 }, { dimension_values: ["POST"], value: 3 }] }],
            },
          },
        ],
      },
    });
    const resultado = await chamar({ metricas: ["reach"], detalhar_por: "media_product_type" });
    assert.ok(!resultado.isError, texto(resultado));
    const [pedido] = m.graphFalsa.pedidos;
    assert.equal(pedido?.query.metric_type, "total_value");
    assert.equal(pedido?.query.breakdown, "media_product_type");
    assert.ok(!("since" in (pedido?.query ?? {})), "sem datas, vale o padrão da Meta");
    const dados = resultado.structuredContent as { metricas: Array<Record<string, unknown>> };
    assert.deepEqual(dados.metricas[0], {
      metrica: "reach",
      titulo: "Alcance",
      valor: 12,
      detalhamento: [
        { categoria: "REELS", valor: 9 },
        { categoria: "POST", valor: 3 },
      ],
    });
  });

  it("várias métricas em total_value (as 7 da prova)", async () => {
    const nomes = ["views", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves"];
    m.graphFalsa.rota("GET", `${IG}/insights`, {
      corpo: { data: nomes.map((name, i) => ({ name, period: "day", title: name, total_value: { value: i } })) },
    });
    const resultado = await chamar({ metricas: nomes });
    assert.ok(!resultado.isError, texto(resultado));
    assert.equal(m.graphFalsa.pedidos[0]?.query.metric, nomes.join(","));
    const dados = resultado.structuredContent as { metricas: Array<{ metrica: string; valor: number }> };
    assert.deepEqual(dados.metricas.map((x) => [x.metrica, x.valor]), nomes.map((n, i) => [n, i]));
  });

  it("demografia: lifetime, timeframe e breakdown; vazio vira aviso", async () => {
    m.graphFalsa.rota("GET", `${IG}/insights`, { corpo: { data: [] } });
    const resultado = await chamar({ metricas: ["follower_demographics"], janela: "last_90_days", detalhar_por: "country" });
    assert.ok(!resultado.isError, texto(resultado));
    const [pedido] = m.graphFalsa.pedidos;
    assert.equal(pedido?.query.period, "lifetime");
    assert.equal(pedido?.query.metric_type, "total_value");
    assert.equal(pedido?.query.timeframe, "last_90_days");
    assert.equal(pedido?.query.breakdown, "country");
    assert.ok(!("since" in (pedido?.query ?? {})));
    const dados = resultado.structuredContent as { tipo: string; metricas: unknown[]; aviso?: string };
    assert.equal(dados.tipo, "demografia");
    assert.deepEqual(dados.metricas, []);
    assert.match(dados.aviso ?? "", /100 seguidores/);
  });

  it("demografia com dados", async () => {
    m.graphFalsa.rota("GET", `${IG}/insights`, {
      corpo: {
        data: [
          {
            name: "follower_demographics",
            period: "lifetime",
            title: "Demografia",
            total_value: { breakdowns: [{ dimension_keys: ["country"], results: [{ dimension_values: ["BR"], value: 80 }, { dimension_values: ["PT"], value: 20 }] }] },
          },
        ],
      },
    });
    const resultado = await chamar({ metricas: ["follower_demographics"], janela: "this_month", detalhar_por: "country" });
    const dados = resultado.structuredContent as { metricas: Array<Record<string, unknown>> };
    assert.deepEqual(dados.metricas[0]?.detalhamento, [
      { categoria: "BR", valor: 80 },
      { categoria: "PT", valor: 20 },
    ]);
  });

  it("erro da Meta chega traduzido", async () => {
    m.graphFalsa.rota("GET", `${IG}/insights`, erroMeta(190, "Token ruim"));
    const resultado = await chamar({ metricas: ["reach"] });
    assert.equal(resultado.isError, true);
    assert.match(texto(resultado), /code 190/);
  });

  it("é anotada como leitura e tem outputSchema", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const { tools } = await cliente.listTools();
      for (const nome of ["ig_insights_conta", "ig_insights_midia"]) {
        const ferramenta = tools.find((t) => t.name === nome)!;
        assert.equal(ferramenta.annotations?.readOnlyHint, true, nome);
        assert.equal(ferramenta.outputSchema?.type, "object", nome);
      }
    } finally {
      await fechar();
    }
  });
});

describe("ig_insights_midia contra a Graph falsa", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
  });
  afterEach(async () => {
    await m.fechar();
  });

  async function chamar(args: Record<string, unknown>) {
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      return await cliente.callTool({ name: "ig_insights_midia", arguments: args });
    } finally {
      await fechar();
    }
  }

  const valores = (pares: Record<string, number>) => ({
    data: Object.entries(pares).map(([name, value]) => ({ name, period: "lifetime", title: name, values: [{ value }] })),
  });

  it("recusa metricas descontinuadas", async () => {
    const resultado = await chamar({ midia_id: "111", metricas: ["impressions"] });
    assert.equal(resultado.isError, true);
    assert.match(texto(resultado), /descontinuada pela Meta/);
    assert.equal(m.graphFalsa.pedidos.length, 0);
  });

  it("REELS: escolhe o conjunto do tipo e calcula as derivadas com a conta", async () => {
    m.graphFalsa.rota("GET", "/111", { corpo: { id: "111", media_product_type: "REELS" } });
    m.graphFalsa.rota("GET", "/111/insights", {
      corpo: valores({ reach: 200, views: 300, likes: 10, comments: 1, saved: 8, shares: 10, total_interactions: 29, reposts: 0, ig_reels_avg_watch_time: 4100, ig_reels_video_view_total_time: 90000, reels_skip_rate: 30 }),
    });
    // 15 mídias: 1 é a própria, 3 são FEED, 11 REELS (só 11 entram, de 12 possíveis).
    const lista = [{ id: "111", media_product_type: "REELS" }];
    for (let i = 0; i < 3; i++) lista.push({ id: `f${i}`, media_product_type: "FEED" });
    for (let i = 1; i <= 11; i++) lista.push({ id: `r${i}`, media_product_type: "REELS" });
    m.graphFalsa.rota("GET", IG + "/media", { corpo: { data: lista } });
    for (let i = 1; i <= 11; i++) m.graphFalsa.rota("GET", `/r${i}/insights`, { corpo: valores({ views: i * 10 }) }); // mediana 60
    const resultado = await chamar({ midia_id: "111" });
    assert.ok(!resultado.isError, texto(resultado));

    const insights = m.graphFalsa.pedidos.find((p) => p.caminho === "/111/insights")!;
    assert.equal(insights.query.metric, "reach,views,likes,comments,saved,shares,total_interactions,reposts,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate");

    const dados = resultado.structuredContent as { tipo_de_midia: string; metricas: unknown[]; derivadas: Array<{ nome: string; valor: number; calculo: string }>; aviso?: string };
    assert.equal(dados.tipo_de_midia, "REELS");
    assert.equal(dados.metricas.length, 11);
    const porNome = Object.fromEntries(dados.derivadas.map((d) => [d.nome, d]));
    assert.equal(porNome.multiplo_sobre_mediana?.valor, 5);
    assert.match(porNome.multiplo_sobre_mediana!.calculo, /views 300 ÷ mediana de views dos 11 últimos REELS \(60\) = 5x/);
    assert.equal(porNome.compartilhamentos_por_alcance?.valor, 0.05);
    assert.match(porNome.compartilhamentos_por_alcance!.calculo, /compartilhamentos 10 ÷ alcance 200 = 0,05 \(5%\)/);
    assert.equal(porNome.salvamentos_por_alcance?.valor, 0.04);
    assert.equal(porNome.seguidores_por_alcance, undefined, "REELS não tem follows");
    assert.equal(dados.aviso, undefined);
  });

  it("FEED: calcula seguidores_por_alcance e avisa quando faltam posts para a mediana", async () => {
    m.graphFalsa.rota("GET", "/222", { corpo: { id: "222", media_product_type: "FEED" } });
    m.graphFalsa.rota("GET", "/222/insights", { corpo: valores({ reach: 400, views: 500, follows: 4, saved: 2, shares: 1 }) });
    m.graphFalsa.rota("GET", IG + "/media", { corpo: { data: [{ id: "222", media_product_type: "FEED" }, { id: "x1", media_product_type: "FEED" }] } });
    m.graphFalsa.rota("GET", "/x1/insights", { corpo: valores({ views: 10 }) });
    const resultado = await chamar({ midia_id: "222" });
    assert.ok(!resultado.isError, texto(resultado));
    const dados = resultado.structuredContent as { derivadas: Array<{ nome: string; valor: number; calculo: string }>; aviso?: string };
    const seguidores = dados.derivadas.find((d) => d.nome === "seguidores_por_alcance")!;
    assert.equal(seguidores.valor, 0.01);
    assert.match(seguidores.calculo, /4 ÷ alcance 400 = 0,01 \(1%\)/);
    assert.ok(!dados.derivadas.some((d) => d.nome === "multiplo_sobre_mediana"));
    assert.match(dados.aviso ?? "", /só 1 post/);
  });

  it("STORY: conjunto de story, sem mediana", async () => {
    m.graphFalsa.rota("GET", "/333", { corpo: { id: "333", media_product_type: "STORY" } });
    m.graphFalsa.rota("GET", "/333/insights", { corpo: valores({ reach: 50, views: 60, shares: 1, follows: 2 }) });
    const resultado = await chamar({ midia_id: "333" });
    assert.ok(!resultado.isError, texto(resultado));
    assert.equal(m.graphFalsa.pedidos.find((p) => p.caminho === "/333/insights")!.query.metric, "reach,views,shares,total_interactions,reposts,replies,follows,profile_visits,navigation,link_clicks");
    assert.ok(!m.graphFalsa.pedidos.some((p) => p.caminho === IG + "/media"));
    const dados = resultado.structuredContent as { derivadas: Array<{ nome: string }> };
    assert.deepEqual(dados.derivadas.map((d) => d.nome), ["compartilhamentos_por_alcance", "seguidores_por_alcance"]);
  });

  it("STORY: erro #10 vira 'poucos dados'", async () => {
    m.graphFalsa.rota("GET", "/333", { corpo: { id: "333", media_product_type: "STORY" } });
    m.graphFalsa.rota("GET", "/333/insights", erroMeta(10, "(#10) Not enough viewers for the media to show insights", 2108006));
    const resultado = await chamar({ midia_id: "333" });
    assert.equal(resultado.isError, true);
    assert.match(texto(resultado), /Poucos dados.*5 ou mais/);
  });

  it("erro #10 de permissão em story continua sendo de permissão", async () => {
    m.graphFalsa.rota("GET", "/333", { corpo: { id: "333", media_product_type: "STORY" } });
    m.graphFalsa.rota("GET", "/333/insights", erroMeta(10, "(#10) Application does not have permission: instagram_manage_insights"));
    const resultado = await chamar({ midia_id: "333" });
    assert.equal(resultado.isError, true);
    assert.match(texto(resultado), /instagram_manage_insights/);
    assert.doesNotMatch(texto(resultado), /Poucos dados/);
  });

  it("métrica de outro tipo de mídia é recusada antes de chamar insights", async () => {
    m.graphFalsa.rota("GET", "/222", { corpo: { id: "222", media_product_type: "FEED" } });
    const resultado = await chamar({ midia_id: "222", metricas: ["reels_skip_rate"] });
    assert.equal(resultado.isError, true);
    assert.match(texto(resultado), /tipo FEED, reels_skip_rate não existe/);
    assert.ok(!m.graphFalsa.pedidos.some((p) => p.caminho === "/222/insights"));
  });

  it("sem media_product_type e sem metricas pede as métricas", async () => {
    m.graphFalsa.rota("GET", "/444", { corpo: { id: "444" } });
    const resultado = await chamar({ midia_id: "444" });
    assert.equal(resultado.isError, true);
    assert.match(texto(resultado), /Informe `metricas`/);
  });

  it("métricas escolhidas valem; alcance zero não gera razão", async () => {
    m.graphFalsa.rota("GET", "/222", { corpo: { id: "222", media_product_type: "FEED" } });
    m.graphFalsa.rota("GET", "/222/insights", { corpo: valores({ reach: 0, shares: 3 }) });
    const resultado = await chamar({ midia_id: "222", metricas: ["reach", "shares"] });
    assert.ok(!resultado.isError, texto(resultado));
    assert.equal(m.graphFalsa.pedidos.find((p) => p.caminho === "/222/insights")!.query.metric, "reach,shares");
    const dados = resultado.structuredContent as { derivadas?: unknown[] };
    assert.equal(dados.derivadas, undefined);
  });
});
