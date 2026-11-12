// ig_insights_conta e ig_insights_midia (spec 4.5, ficha 11).
// - a lista de métricas fecha no zod, com os tipos e detalhamentos permitidos de cada uma;
// - a combinação é validada ANTES de chamar a Meta;
// - a resposta sai achatada: {metrica, valor | serie[], detalhamento?}, sem o aninhamento da Graph;
// - em mídia, o servidor calcula métricas derivadas mostrando a conta feita.

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Contexto } from "../contexto.ts";
import { ErroGraph } from "../erros.ts";
import type { Parametros } from "../graph.ts";
import { registrarLeitura, respostaJson } from "../respostas.ts";

type TipoSerie = "total_value" | "time_series";

interface RegraMetricaConta {
  tipos: readonly TipoSerie[];
  detalhes: readonly string[];
}

const TOTAL: readonly TipoSerie[] = ["total_value"];
const POR_PRODUTO = ["media_product_type"] as const;

/** Métricas da conta com o `tipo` e o `detalhar_por` que a Meta aceita para cada uma. */
export const METRICAS_CONTA = {
  reach: { tipos: ["time_series", "total_value"], detalhes: ["media_product_type", "follow_type"] },
  views: { tipos: TOTAL, detalhes: ["follower_type", "media_product_type"] },
  accounts_engaged: { tipos: TOTAL, detalhes: [] },
  replies: { tipos: TOTAL, detalhes: [] },
  reposts: { tipos: TOTAL, detalhes: [] },
  total_interactions: { tipos: TOTAL, detalhes: POR_PRODUTO },
  likes: { tipos: TOTAL, detalhes: POR_PRODUTO },
  comments: { tipos: TOTAL, detalhes: POR_PRODUTO },
  shares: { tipos: TOTAL, detalhes: POR_PRODUTO },
  saves: { tipos: TOTAL, detalhes: POR_PRODUTO },
  follows_and_unfollows: { tipos: TOTAL, detalhes: ["follow_type"] },
  profile_links_taps: { tipos: TOTAL, detalhes: ["contact_button_type"] },
} as const satisfies Record<string, RegraMetricaConta>;

/** Demografia: `period=lifetime` com janela (`timeframe` na Graph). Só 45 itens e exige 100 seguidores/engajamentos. */
export const METRICAS_DEMOGRAFIA = ["follower_demographics", "engaged_audience_demographics"] as const;
export const DETALHES_DEMOGRAFIA = ["age", "city", "country", "gender"] as const;
export const JANELAS_DEMOGRAFIA = ["this_week", "this_month", "last_90_days"] as const;

export const METRICAS_FEED = [
  "reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "reposts", "follows", "profile_visits", "profile_activity",
] as const;
export const METRICAS_REELS = [
  "reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "reposts",
  "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate",
] as const;
export const METRICAS_STORY = [
  "reach", "views", "shares", "total_interactions", "reposts", "replies", "follows", "profile_visits", "navigation", "link_clicks",
] as const;

export const CONJUNTO_POR_TIPO: Record<string, readonly string[]> = { FEED: METRICAS_FEED, REELS: METRICAS_REELS, STORY: METRICAS_STORY };

const METRICAS_MIDIA = [...new Set([...METRICAS_FEED, ...METRICAS_REELS, ...METRICAS_STORY])] as unknown as [string, ...string[]];

const DESCONTINUADAS = new Set([
  "impressions", "profile_views", "website_clicks", "plays", "video_views",
  "email_contacts", "phone_call_clicks", "text_message_clicks", "get_directions_clicks",
]);

const NOMES_CONTA = [...Object.keys(METRICAS_CONTA), ...METRICAS_DEMOGRAFIA] as unknown as [string, ...string[]];
const TODOS_DETALHES = [...new Set([...Object.values(METRICAS_CONTA).flatMap((r) => r.detalhes), ...DETALHES_DEMOGRAFIA])] as unknown as [string, ...string[]];

const DIA_MS = 86_400_000;
const MAXIMO_DIAS = 90;

/** Enum fechado; métrica descontinuada ganha uma frase própria, as demais listam o que vale. */
function enumDeMetricas(valores: readonly string[]) {
  return z.enum(valores as [string, ...string[]], {
    error: (problema) => {
      const entrada = String(problema.input);
      if (DESCONTINUADAS.has(entrada)) return `A métrica ${entrada} foi descontinuada pela Meta.`;
      return `Métrica ${String(entrada)} não aceita. Use uma destas: ${valores.join(", ")}.`;
    },
  });
}

// ---------- ig_insights_conta ----------

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export const EntradaInsightsConta = z
  .strictObject({
    metricas: z.array(enumDeMetricas(NOMES_CONTA)).min(1).max(12).describe("Métricas da conta. Demografia (follower_demographics, engaged_audience_demographics) não mistura com as outras."),
    tipo: z.enum(["total_value", "time_series"]).optional().describe("total_value (padrão: um número no período) ou time_series (um valor por dia; só a métrica reach)."),
    detalhar_por: z.enum(TODOS_DETALHES).optional().describe("Quebra o total por categoria. Só com total_value, e a métrica precisa aceitar. Em demografia: age, city, country ou gender."),
    desde: z.string().optional().describe("Início do intervalo, ISO (2026-11-01 ou 2026-11-01T00:00:00Z). Sem data, vale o intervalo padrão da Meta (últimas 24 h)."),
    ate: z.string().optional().describe("Fim do intervalo, ISO. Para incluir um dia inteiro, use o dia seguinte. No máximo 90 dias entre desde e ate."),
    janela: z.enum(JANELAS_DEMOGRAFIA).optional().describe("Só para demografia: this_week, this_month ou last_90_days (a doc diz que last_90_days caiu, mas a Meta ainda aceitou)."),
  })
  .superRefine((args, ctx) => {
    for (const mensagem of planejarConta(args).erros) ctx.addIssue({ code: "custom", message: mensagem });
  });

export type ArgsInsightsConta = z.infer<typeof EntradaInsightsConta>;

export interface PlanoConta {
  erros: string[];
  params: Parametros;
}

function paraTimestamp(texto: string, campo: string, erros: string[]): number | null {
  if (!ISO.test(texto) || Number.isNaN(Date.parse(texto))) {
    erros.push(`${campo} precisa ser uma data ISO, como 2026-11-01 ou 2026-11-01T00:00:00Z.`);
    return null;
  }
  return Math.floor(Date.parse(texto) / 1000);
}

/** Valida a combinação de argumentos e monta os parâmetros da Graph. Não chama a Meta. */
export function planejarConta(args: ArgsInsightsConta | z.input<typeof EntradaInsightsConta>, agora: () => number = Date.now): PlanoConta {
  const erros: string[] = [];
  const metricas = args.metricas ?? [];
  const demografia = metricas.filter((m) => (METRICAS_DEMOGRAFIA as readonly string[]).includes(m));
  const comuns = metricas.filter((m) => !demografia.includes(m));
  const params: Parametros = { metric: metricas.join(",") };

  if (demografia.length > 0) {
    if (comuns.length > 0) erros.push("Demografia não pode ser pedida junto com as outras métricas: faça uma chamada para cada grupo.");
    if (!args.janela) erros.push("Demografia exige `janela` (this_week, this_month ou last_90_days), com period=lifetime.");
    if (!args.detalhar_por) erros.push("Demografia exige `detalhar_por`: age, city, country ou gender.");
    else if (!(DETALHES_DEMOGRAFIA as readonly string[]).includes(args.detalhar_por)) erros.push(`Em demografia, detalhar_por só aceita ${DETALHES_DEMOGRAFIA.join(", ")}.`);
    if (args.tipo === "time_series") erros.push("Demografia só existe como total_value, não como time_series.");
    if (args.desde || args.ate) erros.push("Demografia não usa desde/ate: escolha a `janela`.");
    if (erros.length === 0) {
      Object.assign(params, { period: "lifetime", metric_type: "total_value", timeframe: args.janela, breakdown: args.detalhar_por });
    }
    return { erros, params };
  }

  if (args.janela) erros.push("`janela` só vale para demografia (follower_demographics, engaged_audience_demographics).");
  const tipo: TipoSerie = args.tipo ?? "total_value";

  for (const metrica of comuns) {
    const regra: RegraMetricaConta | undefined = (METRICAS_CONTA as Record<string, RegraMetricaConta>)[metrica];
    if (regra && !regra.tipos.includes(tipo)) erros.push(`${metrica} não aceita tipo=${tipo}: só ${regra.tipos.join(" ou ")}.`);
  }
  if (args.detalhar_por) {
    if (tipo !== "total_value") erros.push("`detalhar_por` só funciona com tipo=total_value, nunca com time_series.");
    for (const metrica of comuns) {
      const regra: RegraMetricaConta | undefined = (METRICAS_CONTA as Record<string, RegraMetricaConta>)[metrica];
      if (regra && !regra.detalhes.includes(args.detalhar_por)) {
        erros.push(
          `${metrica} não detalha por ${args.detalhar_por}` +
            (regra.detalhes.length > 0 ? `: use ${regra.detalhes.join(" ou ")}.` : ": essa métrica não tem detalhamento."),
        );
      }
    }
  }

  let desde = args.desde !== undefined ? paraTimestamp(args.desde, "desde", erros) : null;
  let ate = args.ate !== undefined ? paraTimestamp(args.ate, "ate", erros) : null;
  if (args.desde !== undefined && args.ate === undefined && desde !== null) ate = Math.floor(agora() / 1000);
  if (args.ate !== undefined && args.desde === undefined && ate !== null) desde = ate - DIA_MS / 1000;
  if (desde !== null && ate !== null) {
    if (ate <= desde) erros.push("`ate` precisa ser depois de `desde`.");
    else if ((ate - desde) * 1000 > MAXIMO_DIAS * DIA_MS) {
      erros.push(`O intervalo passa de ${MAXIMO_DIAS} dias (${Math.ceil(((ate - desde) * 1000) / DIA_MS)} dias): a Meta guarda só ${MAXIMO_DIAS} dias de dados da conta.`);
    }
  }

  if (erros.length === 0) {
    Object.assign(params, { period: "day", metric_type: tipo, breakdown: args.detalhar_por });
    if (desde !== null) params.since = desde;
    if (ate !== null) params.until = ate;
  }
  return { erros, params };
}

// ---------- saída achatada ----------

const SerieSchema = z.object({ fim: z.string().describe("Fim do período (ISO)"), valor: z.number() });
const DetalheSchema = z.object({ categoria: z.string().describe("Categoria do detalhamento (ex.: REELS, 25-34 / F)"), valor: z.number() });

const MetricaSchema = z.object({
  metrica: z.string(),
  titulo: z.string().optional().describe("Nome da métrica na Meta"),
  valor: z.number().optional().describe("Valor total da métrica"),
  serie: z.array(SerieSchema).optional().describe("Um valor por dia (time_series)"),
  detalhamento: z.array(DetalheSchema).optional().describe("Total por categoria (detalhar_por)"),
});
export type MetricaAchatada = z.infer<typeof MetricaSchema>;

interface ItemInsightBruto {
  name?: string;
  title?: string;
  values?: Array<{ value?: unknown; end_time?: string }>;
  total_value?: { value?: unknown; breakdowns?: Array<{ results?: Array<{ dimension_values?: unknown[]; value?: unknown }> }> };
}

const ehNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function detalhesDeObjeto(valor: unknown): Array<{ categoria: string; valor: number }> {
  if (typeof valor !== "object" || valor === null) return [];
  return Object.entries(valor).flatMap(([categoria, v]) => (ehNumero(v) ? [{ categoria, valor: v }] : []));
}

/** Tira o aninhamento da Graph (`data[].values[]`, `total_value.breakdowns[].results[]`). */
export function achatarInsights(corpo: unknown): MetricaAchatada[] {
  const itens = (corpo as { data?: ItemInsightBruto[] } | null)?.data;
  if (!Array.isArray(itens)) return [];
  const saida: MetricaAchatada[] = [];
  for (const item of itens) {
    if (typeof item?.name !== "string") continue;
    const metrica: MetricaAchatada = { metrica: item.name, ...(item.title ? { titulo: item.title } : {}) };
    if (item.total_value && typeof item.total_value === "object") {
      if (ehNumero(item.total_value.value)) metrica.valor = item.total_value.value;
      const detalhes = (item.total_value.breakdowns ?? []).flatMap((b) =>
        (b.results ?? []).flatMap((r) => (ehNumero(r.value) ? [{ categoria: (r.dimension_values ?? []).map(String).join(" / "), valor: r.value }] : [])),
      );
      if (detalhes.length > 0) metrica.detalhamento = detalhes;
    } else if (Array.isArray(item.values)) {
      const comData = item.values.filter((v) => typeof v.end_time === "string");
      if (comData.length > 0) {
        metrica.serie = comData.flatMap((v) => (ehNumero(v.value) ? [{ fim: v.end_time!, valor: v.value }] : []));
      } else {
        const primeiro = item.values[0]?.value;
        if (ehNumero(primeiro)) metrica.valor = primeiro;
        else {
          const detalhes = detalhesDeObjeto(primeiro);
          if (detalhes.length > 0) metrica.detalhamento = detalhes;
        }
      }
    }
    saida.push(metrica);
  }
  return saida;
}

const SaidaConta = z.object({
  tipo: z.string().describe("total_value, time_series ou demografia"),
  periodo: z.object({ desde: z.string().optional(), ate: z.string().optional() }).describe("Intervalo pedido (vazio = padrão da Meta, últimas 24 h)"),
  metricas: z.array(MetricaSchema),
  aviso: z.string().optional(),
});

const AVISO_VAZIO =
  "A Meta devolveu a consulta sem dados. Causas comuns: conta com poucos seguidores (demografia exige 100 seguidores ou 100 engajamentos), período sem atividade, ou dados ainda não processados (chegam com até 48 h de atraso).";

// ---------- ig_insights_midia ----------

const SaidaMidia = z.object({
  midia_id: z.string(),
  tipo_de_midia: z.string().optional().describe("FEED, REELS ou STORY"),
  metricas: z.array(MetricaSchema),
  derivadas: z
    .array(z.object({ nome: z.string(), valor: z.number(), calculo: z.string().describe("A conta feita, com os números usados") }))
    .optional()
    .describe("Métricas calculadas pelo servidor a partir dos números acima"),
  aviso: z.string().optional(),
});

function formatar(numero: number): string {
  const redondo = Math.round(numero * 10_000) / 10_000;
  return String(redondo).replace(".", ",");
}

function mediana(numeros: number[]): number {
  const ordenados = [...numeros].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[meio]! : (ordenados[meio - 1]! + ordenados[meio]!) / 2;
}

const AMOSTRA_MINIMA = 3;
const POSTS_NA_MEDIANA = 12;

export interface Derivada {
  nome: string;
  valor: number;
  calculo: string;
}

/** Razões simples sobre o alcance, com a conta mostrada. Só sai quando os dois números existem e o alcance é maior que zero. */
export function derivadasPorAlcance(metricas: MetricaAchatada[]): Derivada[] {
  const valor = (nome: string) => metricas.find((m) => m.metrica === nome)?.valor;
  const alcance = valor("reach");
  if (alcance === undefined || alcance <= 0) return [];
  const pares: Array<[string, string, string]> = [
    ["compartilhamentos_por_alcance", "shares", "compartilhamentos"],
    ["salvamentos_por_alcance", "saved", "salvamentos"],
    ["seguidores_por_alcance", "follows", "seguidores novos (follows)"],
  ];
  const saida: Derivada[] = [];
  for (const [nome, metrica, rotulo] of pares) {
    const parte = valor(metrica);
    if (parte === undefined) continue;
    const razao = parte / alcance;
    saida.push({ nome, valor: Math.round(razao * 10_000) / 10_000, calculo: `${rotulo} ${formatar(parte)} ÷ alcance ${formatar(alcance)} = ${formatar(razao)} (${formatar(razao * 100)}%)` });
  }
  return saida;
}

export const EntradaInsightsMidia = z.strictObject({
  midia_id: z.string().regex(/^\d+$/, "midia_id é só números (o ID da mídia).").describe("ID da mídia (post, reel ou story)"),
  metricas: z
    .array(enumDeMetricas(METRICAS_MIDIA))
    .min(1)
    .max(14)
    .optional()
    .describe("Métricas da mídia. Sem isso, o servidor lê o tipo (FEED, REELS ou STORY) e usa o conjunto certo dele."),
});

function textoErro10EmStory(erro: unknown): boolean {
  return erro instanceof ErroGraph && erro.code === 10 && !/\b(instagram_|pages_)[a-z_]+/.test(erro.detalhe.mensagem_meta);
}

export function registrarInsights(server: McpServer, ctx: Contexto): void {
  registrarLeitura(
    server,
    "ig_insights_conta",
    {
      title: "Insights da conta",
      description:
        "Números de desempenho da conta (alcance, visualizações, interações, seguidores novos, cliques no perfil e demografia da audiência). " +
        "Escolha `metricas` (lista fechada); `tipo` total_value dá um número no período e time_series dá um valor por dia (só reach); `detalhar_por` quebra o total por categoria (só com total_value). " +
        "Demografia (follower_demographics, engaged_audience_demographics) exige `janela` e `detalhar_por`, mostra só os 45 maiores e a Meta só libera com 100 seguidores. " +
        "Sem desde/ate, a Meta usa as últimas 24 h; o intervalo máximo é de 90 dias e os dados podem atrasar até 48 h. " +
        'Exemplos: "qual meu alcance nos últimos 7 dias, dia a dia?", "de onde são meus seguidores?".',
      inputSchema: EntradaInsightsConta,
      outputSchema: SaidaConta,
    },
    async (args, mcp) => {
      const plano = planejarConta(args);
      if (plano.erros.length > 0) throw new Error(plano.erros.join(" "));
      const corpo = await ctx.graph.get<unknown>(`${ctx.config.contaId}/insights`, plano.params, { signal: mcp.mcpReq.signal });
      const metricas = achatarInsights(corpo);
      const demografia = plano.params.period === "lifetime";
      const periodo: { desde?: string; ate?: string } = {};
      if (typeof plano.params.since === "number") periodo.desde = new Date(plano.params.since * 1000).toISOString();
      if (typeof plano.params.until === "number") periodo.ate = new Date(plano.params.until * 1000).toISOString();
      return respostaJson({
        tipo: demografia ? "demografia" : String(plano.params.metric_type),
        periodo,
        metricas,
        ...(metricas.length === 0 ? { aviso: AVISO_VAZIO } : {}),
      });
    },
  );

  registrarLeitura(
    server,
    "ig_insights_midia",
    {
      title: "Insights de uma mídia",
      description:
        "Desempenho de um post, reel ou story: alcance, visualizações, curtidas, comentários, salvamentos, compartilhamentos, tempo médio assistido (reels) e mais. " +
        "Sem `metricas`, o servidor descobre o tipo da mídia e usa o conjunto certo. Quando há dados, calcula também métricas derivadas com a conta mostrada: " +
        "quantas vezes as views passam da mediana dos últimos posts do mesmo tipo, e compartilhamentos, salvamentos e seguidores novos por alcance. " +
        "Story só tem métricas nas primeiras 24 h e some com menos de 5 pessoas. Não existe insight por item de carrossel. " +
        'Exemplos: "como foi esse reel?", "esse post performou acima do normal?".',
      inputSchema: EntradaInsightsMidia,
      outputSchema: SaidaMidia,
    },
    async (args, mcp) => {
      const opcoes = { signal: mcp.mcpReq.signal };
      const info = await ctx.graph.get<{ media_product_type?: string }>(args.midia_id, { fields: "media_product_type" }, opcoes);
      const tipo = typeof info.media_product_type === "string" ? info.media_product_type : undefined;
      const conjunto = tipo ? CONJUNTO_POR_TIPO[tipo] : undefined;

      let pedidas: readonly string[];
      if (args.metricas) {
        pedidas = args.metricas;
        if (conjunto) {
          const fora = pedidas.filter((m) => !conjunto.includes(m));
          if (fora.length > 0) throw new Error(`Para mídia do tipo ${tipo}, ${fora.join(", ")} não existe. Use: ${conjunto.join(", ")}.`);
        }
      } else {
        if (!conjunto) {
          throw new Error(`Não consegui saber o tipo da mídia (media_product_type ${tipo ?? "vazio"}). Informe \`metricas\` na chamada.`);
        }
        pedidas = conjunto;
      }

      let corpo: unknown;
      try {
        corpo = await ctx.graph.get<unknown>(`${args.midia_id}/insights`, { metric: pedidas.join(",") }, opcoes);
      } catch (erro) {
        if (tipo === "STORY" && textoErro10EmStory(erro)) {
          throw new Error("Poucos dados: a Meta só libera insights de story com 5 ou mais pessoas alcançadas (erro #10), e só nas primeiras 24 h.", { cause: erro });
        }
        throw erro;
      }
      const metricas = achatarInsights(corpo);

      const derivadas = derivadasPorAlcance(metricas);
      let aviso: string | undefined;
      if (tipo === "FEED" || tipo === "REELS") {
        const views = metricas.find((m) => m.metrica === "views")?.valor;
        if (views !== undefined) {
          const resultado = await multiploSobreMediana(ctx, args.midia_id, tipo, views, opcoes);
          if (resultado.derivada) derivadas.unshift(resultado.derivada);
          else aviso = resultado.motivo;
        }
      }
      if (metricas.length === 0) aviso = "A Meta devolveu a mídia sem dados de insights.";

      return respostaJson({
        midia_id: args.midia_id,
        ...(tipo ? { tipo_de_midia: tipo } : {}),
        metricas,
        ...(derivadas.length > 0 ? { derivadas } : {}),
        ...(aviso ? { aviso } : {}),
      });
    },
  );
}

async function multiploSobreMediana(
  ctx: Contexto,
  midiaId: string,
  tipo: string,
  views: number,
  opcoes: { signal: AbortSignal },
): Promise<{ derivada: Derivada } | { derivada: null; motivo: string }> {
  try {
    const pagina = await ctx.graph.pagina<{ id?: string; media_product_type?: string }>(
      `${ctx.config.contaId}/media`,
      { fields: "id,media_product_type" },
      50,
      null,
      opcoes,
    );
    const outras = pagina.itens.filter((m) => m.id && m.id !== midiaId && m.media_product_type === tipo).slice(0, POSTS_NA_MEDIANA);
    const leituras = await Promise.allSettled(
      outras.map(async (m) => achatarInsights(await ctx.graph.get<unknown>(`${m.id}/insights`, { metric: "views" }, opcoes)).find((x) => x.metrica === "views")?.valor),
    );
    const amostra = leituras.flatMap((l) => (l.status === "fulfilled" && ehNumero(l.value) ? [l.value] : []));
    if (amostra.length < AMOSTRA_MINIMA) {
      return { derivada: null, motivo: `Sem múltiplo sobre a mediana: só ${amostra.length} post(s) ${tipo} com views para comparar (preciso de ${AMOSTRA_MINIMA} ou mais).` };
    }
    const medianaViews = mediana(amostra);
    if (medianaViews <= 0) return { derivada: null, motivo: "Sem múltiplo sobre a mediana: a mediana de views dos posts anteriores é zero." };
    const razao = views / medianaViews;
    return {
      derivada: {
        nome: "multiplo_sobre_mediana",
        valor: Math.round(razao * 100) / 100,
        calculo: `views ${formatar(views)} ÷ mediana de views dos ${amostra.length} últimos ${tipo} (${formatar(medianaViews)}) = ${formatar(razao)}x`,
      },
    };
  } catch (erro) {
    if (erro instanceof ErroGraph) return { derivada: null, motivo: "Sem múltiplo sobre a mediana: não consegui ler os posts anteriores." };
    throw erro;
  }
}
