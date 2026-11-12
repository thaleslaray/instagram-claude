// Publicação de post e carrossel (spec 4.4). Este módulo roda do passo 4 em diante, DEPOIS do clique:
// subir a mídia local, criar os containers, esperar `FINISHED`, publicar e registrar.
// Foto local sobe pelo Uploadcare (a Meta baixa de um endereço público); vídeo local sobe direto para a Meta
// (container com upload_type=resumable e os bytes para o `uri` do rupload). URL https passa direto, como veio.
// Os passos 1 a 3 (validar, ler a cota, confirmar) ficam em ferramentas/publicacao.ts.
//
// Esperas (spec 4.4, passo 6): imagem consulta aos 1, 2, 3, 4, 5, 7, 9, 11, 13 e 15 s; se ainda não terminou, a
// ferramenta devolve na hora `{estado:"processando", trabalho_id}` e o trabalho segue sozinho, consultando a cada 10 s
// até 5 minutos. Com vídeo (reels, story de vídeo, carrossel com vídeo) a resposta "processando" sai logo no começo,
// ANTES de hospedar fotos e criar containers: o envio do vídeo à Meta pode levar dezenas de segundos e o cartão não
// pode ficar parado esperando; o cartão acompanha pelo `ig_status_publicacao`. `ERROR` e `EXPIRED` falham o trabalho; nada é publicado.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Contexto } from "./contexto.ts";
import { ContagemPublicacoes } from "./contagem-publicacoes.ts";
import { ErroUploadcareNaoConfigurado } from "./hospedagem.ts";
import { log } from "./log.ts";
import { limpar } from "./segredos.ts";
import { Trabalhos, type Trabalho } from "./trabalhos.ts";

// ---------------------------------------------------------------- estado compartilhado

export interface EstadoDePublicacao {
  trabalhos: Trabalhos;
  contagem: ContagemPublicacoes;
  /** Espera `ms` milissegundos. Os testes trocam por um relógio falso. */
  esperar(ms: number): Promise<void>;
  agora(): number;
}

const esperarDeVerdade = (ms: number): Promise<void> =>
  new Promise((pronto) => {
    // unref: uma espera em segundo plano não segura o processo aberto.
    setTimeout(pronto, ms).unref();
  });

const estados = new WeakMap<Contexto, EstadoDePublicacao>();

export function estadoDePublicacao(ctx: Contexto): EstadoDePublicacao {
  let estado = estados.get(ctx);
  if (!estado) {
    estado = { trabalhos: new Trabalhos(), contagem: new ContagemPublicacoes(ctx.caminhoPublicacoes), esperar: esperarDeVerdade, agora: Date.now };
    estados.set(ctx, estado);
  }
  return estado;
}

/** Troca partes do estado (os testes usam para apontar a contagem para uma pasta temporária e acelerar o relógio). */
export function configurarPublicacao(ctx: Contexto, partes: Partial<EstadoDePublicacao>): EstadoDePublicacao {
  const novo = { ...estadoDePublicacao(ctx), ...partes };
  estados.set(ctx, novo);
  return novo;
}

// ---------------------------------------------------------------- cota

export interface Cota {
  usadasNaMeta: number;
  usadasLocalmente: number;
  /** O maior dos dois números. */
  usadas: number;
  total: number;
  restantes: number;
  aviso: string | null;
}

export const COTA_TOTAL_PADRAO = 100;

interface RespostaDeLimite {
  data?: Array<{ quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }>;
}

/** `GET /{ig}/content_publishing_limit` + contagem local das últimas 24 h (a cota da Meta tem atraso: P19). */
export async function lerCota(ctx: Contexto, estado: EstadoDePublicacao, signal?: AbortSignal): Promise<Cota> {
  const resposta = await ctx.graph.get<RespostaDeLimite>(
    `${ctx.config.contaId}/content_publishing_limit`,
    { fields: "config,quota_usage" },
    signal ? { signal } : {},
  );
  const linha = resposta.data?.[0];
  const total = typeof linha?.config?.quota_total === "number" && linha.config.quota_total > 0 ? linha.config.quota_total : COTA_TOTAL_PADRAO;
  const usadasNaMeta = typeof linha?.quota_usage === "number" ? linha.quota_usage : 0;
  const usadasLocalmente = await estado.contagem.contar();
  const usadas = Math.max(usadasNaMeta, usadasLocalmente);
  const avisos: string[] = [];
  if (typeof linha?.config?.quota_total !== "number") avisos.push(`A Meta não informou o total da cota; usei ${COTA_TOTAL_PADRAO}.`);
  if (usadasLocalmente > usadasNaMeta) avisos.push("A Meta ainda não contou as publicações recentes (a cota dela tem atraso); usei a contagem local.");
  return { usadasNaMeta, usadasLocalmente, usadas, total, restantes: Math.max(0, total - usadas), aviso: avisos.length > 0 ? avisos.join(" ") : null };
}

export function textoDaCota(c: Cota): string {
  return `${c.usadas} de ${c.total} usadas nas últimas 24 h (Meta: ${c.usadasNaMeta}; contagem local: ${c.usadasLocalmente})`;
}

// ---------------------------------------------------------------- corpo do pedido

export interface ItemDePublicacao {
  origem: "local" | "url";
  /** Caminho absoluto, quando `origem` é "local". */
  caminho?: string;
  /** URL https, quando `origem` é "url". */
  url?: string;
  tipo: "IMAGE" | "VIDEO";
  /** Nome para a prévia (arquivo ou host). */
  nome: string;
  bytes?: number;
  largura?: number;
  altura?: number;
  /** SHA-256 do arquivo no momento da prévia: se mudar até o clique, nada é publicado. */
  sha256?: string;
  alt?: string;
}

export interface MarcacaoDePessoa {
  usuario: string;
  /** Posição na foto (0 a 1). Em vídeo, a Meta não usa. */
  x?: number;
  y?: number;
}

/** Marcação no formato da Meta: `{username, x, y}`, com x e y só quando existirem. */
function marcacaoParaMeta(m: MarcacaoDePessoa): Record<string, unknown> {
  return { username: m.usuario, ...(m.x !== undefined ? { x: m.x } : {}), ...(m.y !== undefined ? { y: m.y } : {}) };
}

/** O corpo exato guardado no pedido de confirmação (e coberto pelo hash dele). */
export interface CorpoDePublicacao {
  tipo: "post" | "carrossel" | "reels" | "story";
  itens: ItemDePublicacao[];
  legenda?: string;
  /** Só reels: capa em JPEG (arquivo local ou URL). Com arquivo local, sobe pelo Uploadcare. */
  capa?: ItemDePublicacao;
  /** Só reels: instante do vídeo (em ms) usado como capa, quando não há `capa`. */
  capa_ms?: number;
  /** Só reels: também aparece no feed (padrão true). */
  mostrar_no_feed?: boolean;
  /** Só reels: nome do áudio original. */
  nome_do_audio?: string;
  local_id?: string;
  colaboradores?: string[];
  feito_com_ia?: boolean;
  marcacoes?: MarcacaoDePessoa[];
}

export async function sha256DoArquivo(caminho: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const pedaco of createReadStream(caminho)) hash.update(pedaco as Buffer);
  return hash.digest("hex");
}

// ---------------------------------------------------------------- erros do container

/**
 * Subcódigos de processamento do container, pela tabela oficial de erros do Instagram (error-codes.md).
 * Traduzidos pelo número, nunca pelo texto (a Meta responde no idioma do usuário).
 */
const FRASES_DE_PROCESSAMENTO: Record<number, string> = {
  2207003: "a Meta demorou demais para baixar a mídia",
  2207004: "a imagem é grande demais (máximo 8 MB)",
  2207005: "o formato da mídia não é aceito",
  2207006: "a Meta não achou a mídia; provável falta de permissão ou token vencido, crie um container novo",
  2207009: "a proporção da imagem não é aceita (entre 4:5 e 1,91:1)",
  2207010: "a legenda é longa demais (máximo 2.200 caracteres, 30 hashtags e 20 marcações @)",
  2207020: "o container expirou; crie um novo",
  2207026: "o formato do vídeo não é aceito (use MOV ou MP4)",
  2207032: "a Meta falhou ao criar a mídia; tente de novo",
  2207040: "mais de 20 marcações @ na mídia",
  2207042: "limite de publicação atingido",
  2207050: "a conta do Instagram está restrita ou inativa; entre no app do Instagram e conclua o que ele pedir",
  2207051: "a Meta suspeitou de spam e restringiu a ação",
  2207052: "a Meta não conseguiu baixar a mídia da URL; confira se ela é pública e válida",
  2207053: "erro desconhecido no upload (só afeta vídeo); crie um container novo",
  2207057: "o instante da capa (offset) está fora da duração do vídeo",
};

/** O subcódigo vem como número (2207052), como texto numérico ou dentro de uma frase da Meta. */
function subcodigoDoStatus(status: unknown): number | undefined {
  if (typeof status === "number" && Number.isInteger(status)) return status;
  const texto = typeof status === "string" ? status : status !== null && typeof status === "object" ? JSON.stringify(status) : "";
  const achado = /\b(22070\d\d)\b/.exec(texto)?.[1];
  return achado === undefined ? undefined : Number(achado);
}

export class ErroDeContainer extends Error {
  override name = "ErroDeContainer";
}

/** Traduz `status_code` e `status` de um container que falhou. */
export function traduzirStatusDoContainer(statusCode: string, status: unknown): string {
  const original = typeof status === "string" ? limpar(status).slice(0, 300) : typeof status === "number" ? String(status) : "";
  if (statusCode === "EXPIRED") {
    return "O container expirou (a Meta só o guarda por 24 h) antes de ser publicado. Nada foi publicado; peça a publicação de novo.";
  }
  const subcodigo = subcodigoDoStatus(status);
  const motivo = subcodigo === undefined ? undefined : FRASES_DE_PROCESSAMENTO[subcodigo];
  return (
    `A Meta não conseguiu processar a mídia (${statusCode}${motivo ? `: ${motivo}` : ""}). Nada foi publicado.` +
    (original ? ` Detalhe da Meta: ${original}` : "")
  );
}

// ---------------------------------------------------------------- cronograma de espera

/**
 * Esperas entre as consultas de imagem: aos 1, 2, 3, 4, 5, 7, 9, 11, 13 e 15 s depois de criar o container
 * (consulta cedo, porque a Meta costuma terminar em poucos segundos; os 15 s totais antes do segundo plano não mudam).
 */
export const ESPERAS_DE_IMAGEM_MS = [1_000, 1_000, 1_000, 1_000, 1_000, 2_000, 2_000, 2_000, 2_000, 2_000] as const;
/** Vídeo leva dezenas de segundos: a primeira consulta é aos 10 s. */
export const ESPERAS_DE_VIDEO_MS = [10_000] as const;
export const INTERVALO_EM_SEGUNDO_PLANO_MS = 10_000;
export const LIMITE_DE_ESPERA_MS = 5 * 60_000;

// ---------------------------------------------------------------- execução

export type Resultado = Record<string, unknown>;

type Final = { ok: true; resultado: Resultado } | { ok: false; erro: unknown };

function adiado(): { promessa: Promise<void>; resolver: () => void } {
  let resolver!: () => void;
  const promessa = new Promise<void>((r) => (resolver = r));
  return { promessa, resolver };
}

/**
 * Roda a publicação confirmada. Devolve o resultado final ou, se a Meta ainda estiver processando,
 * `{estado:"processando", trabalho_id}` enquanto o trabalho segue em segundo plano.
 * Falha enquanto o chamador ainda espera: lança (o `ig_confirmar` mostra o erro). Falha depois (com vídeo, qualquer
 * falha depois da conferência dos arquivos): só no trabalho, com a mesma frase, e no registro (`publicacao_falhou`).
 */
export async function publicarConfirmado(ctx: Contexto, ferramenta: string, corpo: CorpoDePublicacao): Promise<Resultado> {
  const estado = estadoDePublicacao(ctx);
  const trabalho = estado.trabalhos.criar(corpo.tipo);
  const fundo = adiado();
  const execucao = rodar(ctx, estado, trabalho, ferramenta, corpo, fundo.resolver);
  const comVideo = corpo.itens.some((i) => i.tipo === "VIDEO");
  estado.trabalhos.acompanhar(trabalho.id, execucao.then(() => undefined));

  const primeiro = await Promise.race([execucao.then((final) => ({ final })), fundo.promessa.then(() => ({ final: null }))]);
  if (primeiro.final === null) {
    return {
      estado: "processando",
      trabalho_id: trabalho.id,
      ...(comVideo ? { com_video: true } : {}),
      aviso: "A Meta ainda está processando a mídia. O servidor continua sozinho e publica quando ela terminar; confira com ig_status_publicacao.",
    };
  }
  if (!primeiro.final.ok) throw primeiro.final.erro;
  return primeiro.final.resultado;
}

async function rodar(
  ctx: Contexto,
  estado: EstadoDePublicacao,
  trabalho: Trabalho,
  ferramenta: string,
  corpo: CorpoDePublicacao,
  irParaSegundoPlano: () => void,
): Promise<Final> {
  try {
    const resultado = await etapas(ctx, estado, trabalho, ferramenta, corpo, irParaSegundoPlano);
    return { ok: true, resultado };
  } catch (erro) {
    trabalho.erro = limpar(erro instanceof Error ? erro.message : String(erro));
    estado.trabalhos.mudar(trabalho, "falhou");
    log(`[instagram-mcp] publicação ${trabalho.id} falhou: ${trabalho.erro}`);
    await ctx.registro.gravar({ evento: "publicacao_falhou", ferramenta, trabalho_id: trabalho.id, erro: trabalho.erro });
    return { ok: false, erro };
  }
}

async function etapas(
  ctx: Contexto,
  estado: EstadoDePublicacao,
  trabalho: Trabalho,
  ferramenta: string,
  corpo: CorpoDePublicacao,
  irParaSegundoPlano: () => void,
): Promise<Resultado> {
  const conta = ctx.config.contaId;
  const t0 = estado.agora();
  let esperaTotal = 0;
  const temVideo = corpo.itens.some((i) => i.tipo === "VIDEO");

  const mudou = (item: ItemDePublicacao) =>
    new Error(`O arquivo ${item.nome} mudou depois da prévia. Nada foi enviado nem publicado; peça a prévia de novo.`);

  // Vídeo local: lê e confere o arquivo AQUI, antes de responder "processando". Se mudou desde a prévia, o erro ainda
  // chega a quem clicou. Os bytes lidos são reaproveitados no envio (o arquivo não é lido duas vezes).
  const bytesDosVideos = new Map<ItemDePublicacao, Buffer>();
  for (const item of corpo.itens) {
    if (item.tipo !== "VIDEO" || item.origem !== "local") continue;
    const bytes = await readFile(item.caminho!);
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw mudou(item);
    bytesDosVideos.set(item, bytes);
  }
  // Com vídeo, a ferramenta responde na hora; o resto (hospedagem, containers, rupload, espera, publicação) segue sozinho.
  // Chamar de novo depois (em `aguardarContainers`) não faz nada: resolver uma promessa já resolvida é inofensivo.
  if (temVideo) irParaSegundoPlano();

  // Passo 4: foto local sobe pelo Uploadcare (também a capa do Reels); URL https passa direto; vídeo local sobe no passo 5.
  const hospedarFoto = async (item: ItemDePublicacao): Promise<string> => {
    if (item.origem === "url") return item.url!;
    if (!ctx.hospedagem) throw new ErroUploadcareNaoConfigurado();
    if ((await sha256DoArquivo(item.caminho!)) !== item.sha256) throw mudou(item);
    return (await ctx.hospedagem.enviar(item.caminho!)).url;
  };
  const urls: Array<string | undefined> = [];
  for (const item of corpo.itens) urls.push(item.tipo === "VIDEO" && item.origem === "local" ? undefined : await hospedarFoto(item));
  const urlDaCapa = corpo.capa ? await hospedarFoto(corpo.capa) : undefined;
  const t1 = estado.agora(); // fim da hospedagem

  /** Espera o processamento e soma o tempo gasto aqui (inclusive o que passa em segundo plano) em `esperaTotal`. */
  const aguardar = async (ids: string[], comVideo: boolean): Promise<void> => {
    const inicio = estado.agora();
    try {
      await aguardarContainers(ctx, estado, trabalho, ids, comVideo, irParaSegundoPlano);
    } finally {
      esperaTotal += estado.agora() - inicio;
    }
  };

  /**
   * Cria o container. Vídeo local vai com `upload_type=resumable` (sem `video_url`) e os bytes sobem direto para a Meta
   * no `uri` que ela devolve; o arquivo foi lido e conferido ANTES de responder "processando" (ver acima).
   * O tempo do `POST` e o do envio dos bytes são medidos à parte.
   */
  let criarContainerMs = 0; // `POST .../media` de vídeo local (soma, se houver vários vídeos)
  let enviarVideoMs = 0; // bytes do vídeo local para o rupload (idem)
  const criarContainer = async (pedido: Record<string, unknown>, item: ItemDePublicacao, deQue: string): Promise<string> => {
    if (!(item.tipo === "VIDEO" && item.origem === "local")) {
      return exigirId(await ctx.graph.post<{ id?: string }>(`${conta}/media`, pedido), deQue);
    }
    const bytes = bytesDosVideos.get(item)!; // lido e conferido antes de responder "processando"
    const antesDoPost = estado.agora();
    const criado = await ctx.graph.post<{ id?: string; uri?: string }>(`${conta}/media`, { ...pedido, upload_type: "resumable" });
    criarContainerMs += estado.agora() - antesDoPost;
    const id = exigirId(criado, deQue);
    if (typeof criado.uri !== "string" || criado.uri === "") {
      throw new Error("A Meta não devolveu o endereço para enviar o vídeo. Nada foi publicado; tente de novo (isso cria um container novo).");
    }
    const antesDoEnvio = estado.agora();
    try {
      await ctx.graph.enviarParaRupload(criado.uri, bytes);
    } finally {
      enviarVideoMs += estado.agora() - antesDoEnvio;
    }
    return id;
  };

  // Passo 5: criar os containers.
  estado.trabalhos.mudar(trabalho, "criando_containers");
  let creationId: string;
  if (corpo.tipo === "post") {
    const item = corpo.itens[0]!;
    creationId = await criarContainer(
      {
        image_url: urls[0],
        ...(corpo.legenda ? { caption: corpo.legenda } : {}),
        ...(item.alt ? { alt_text: item.alt } : {}),
        ...(corpo.marcacoes?.length ? { user_tags: corpo.marcacoes.map(marcacaoParaMeta) } : {}),
        ...(corpo.local_id ? { location_id: corpo.local_id } : {}),
        ...(corpo.colaboradores?.length ? { collaborators: corpo.colaboradores } : {}),
        ...(corpo.feito_com_ia ? { is_ai_generated: true } : {}),
      },
      item,
      "do container",
    );
    trabalho.containers.push({ id: creationId, tipo: "IMAGE", status_code: null });
  } else if (corpo.tipo === "reels" || corpo.tipo === "story") {
    const item = corpo.itens[0]!;
    const ehVideo = item.tipo === "VIDEO";
    creationId = await criarContainer(
      {
        media_type: corpo.tipo === "reels" ? "REELS" : "STORIES",
        ...(!ehVideo ? { image_url: urls[0] } : urls[0] !== undefined ? { video_url: urls[0] } : {}),
        ...(corpo.tipo === "reels" ? { share_to_feed: corpo.mostrar_no_feed !== false } : {}),
        ...(corpo.legenda ? { caption: corpo.legenda } : {}),
        ...(urlDaCapa ? { cover_url: urlDaCapa } : corpo.capa_ms !== undefined ? { thumb_offset: corpo.capa_ms } : {}),
        ...(corpo.nome_do_audio ? { audio_name: corpo.nome_do_audio } : {}),
        ...(corpo.marcacoes?.length ? { user_tags: corpo.marcacoes.map(marcacaoParaMeta) } : {}),
        ...(corpo.local_id ? { location_id: corpo.local_id } : {}),
        ...(corpo.colaboradores?.length ? { collaborators: corpo.colaboradores } : {}),
      },
      item,
      "do container",
    );
    trabalho.containers.push({ id: creationId, tipo: ehVideo ? "VIDEO" : "IMAGE", status_code: null });
  } else {
    const filhos: string[] = [];
    for (const [i, item] of corpo.itens.entries()) {
      const id = await criarContainer(
        {
          ...(item.tipo === "VIDEO" ? { media_type: "VIDEO", ...(urls[i] !== undefined ? { video_url: urls[i] } : {}) } : { image_url: urls[i] }),
          is_carousel_item: true,
          ...(item.alt ? { alt_text: item.alt } : {}),
        },
        item,
        `do container do item ${i + 1}`,
      );
      filhos.push(id);
      trabalho.containers.push({ id, tipo: item.tipo, status_code: null });
    }
    // O carrossel espera todos os filhos ficarem FINISHED antes de criar o pai.
    await aguardar(filhos, temVideo);
    const pai = await ctx.graph.post<{ id?: string }>(`${conta}/media`, {
      media_type: "CAROUSEL",
      children: filhos,
      ...(corpo.legenda ? { caption: corpo.legenda } : {}),
      ...(corpo.local_id ? { location_id: corpo.local_id } : {}),
      ...(corpo.colaboradores?.length ? { collaborators: corpo.colaboradores } : {}),
    });
    creationId = exigirId(pai, "do container do carrossel");
    trabalho.containers.push({ id: creationId, tipo: "CAROUSEL", status_code: null });
  }

  // Passo 6: esperar o processamento do container que vai ser publicado.
  const t2 = estado.agora();
  await aguardar([creationId], corpo.tipo !== "carrossel" && temVideo);
  const t3 = estado.agora();

  // Passo 7: publicar.
  estado.trabalhos.mudar(trabalho, "publicando");
  const publicado = await ctx.graph.post<{ id?: string; config_issue?: unknown }>(`${conta}/media_publish`, { creation_id: creationId });
  const midiaId = exigirId(publicado, "da mídia publicada");
  trabalho.midiaId = midiaId;
  if (publicado.config_issue !== undefined && publicado.config_issue !== null && publicado.config_issue !== "") {
    const detalhe = typeof publicado.config_issue === "string" ? publicado.config_issue : JSON.stringify(publicado.config_issue);
    trabalho.avisos.push(`A Meta publicou, mas avisou de um problema de configuração: ${limpar(detalhe)} (por exemplo, legenda ou marcações que não foram aplicadas).`);
  }
  await estado.contagem.registrar();
  // O link vem ANTES de marcar "publicado": o cartão consulta o estado e, ao ver "publicado", já espera achar o link.
  const permalink = await buscarPermalink(ctx, midiaId);
  trabalho.permalink = permalink;
  estado.trabalhos.mudar(trabalho, "publicado");
  // Duração de cada etapa em ms (só números: nada de caminho, URL ou ID). `containers` é a criação, sem a espera
  // do carrossel por seus filhos, que conta em `espera`; o upload direto de vídeo local entra em `containers`.
  const etapasMs = {
    hospedagem: t1 - t0,
    containers: Math.max(0, t2 - t1 - (esperaTotal - (t3 - t2))),
    espera: esperaTotal,
    publicacao: estado.agora() - t3,
    // Só com vídeo local: o `POST .../media` e o envio dos bytes à Meta, separados (ambos já estão dentro de `containers`).
    ...(bytesDosVideos.size > 0 ? { criar_container: criarContainerMs, enviar_video: enviarVideoMs } : {}),
  };

  // Passo 8: registrar.
  await ctx.registro.gravar({
    evento: "publicado",
    ferramenta,
    trabalho_id: trabalho.id,
    midia_id: midiaId,
    ...(permalink ? { permalink } : {}),
    itens: corpo.itens.length,
    etapas_ms: etapasMs,
    ...(trabalho.avisos.length > 0 ? { avisos: trabalho.avisos } : {}),
  });

  return {
    estado: "publicado",
    trabalho_id: trabalho.id,
    midia_id: midiaId,
    ...(permalink ? { permalink } : {}),
    etapas_ms: etapasMs,
    ...(trabalho.avisos.length > 0 ? { avisos: trabalho.avisos } : {}),
    publicacoes_nas_ultimas_24h_no_servidor: await estado.contagem.contar(),
  };
}

function exigirId(resposta: { id?: string }, de_que: string): string {
  if (typeof resposta.id !== "string" || resposta.id === "") throw new Error(`A Meta não devolveu o ID ${de_que}.`);
  return resposta.id;
}

async function buscarPermalink(ctx: Contexto, midiaId: string): Promise<string | null> {
  try {
    const r = await ctx.graph.get<{ permalink?: string }>(midiaId, { fields: "permalink" });
    return typeof r.permalink === "string" ? r.permalink : null;
  } catch {
    return null; // o post já saiu; o link é só conforto
  }
}

/** Consulta o status dos containers (imagem: 1 a 15 s; vídeo: 10 s; depois a cada 10 s até 5 min) até todos ficarem FINISHED. */
async function aguardarContainers(
  ctx: Contexto,
  estado: EstadoDePublicacao,
  trabalho: Trabalho,
  ids: string[],
  comVideo: boolean,
  irParaSegundoPlano: () => void,
): Promise<void> {
  estado.trabalhos.mudar(trabalho, "processando");
  const pendentes = new Set(ids);
  const cronograma = comVideo ? ESPERAS_DE_VIDEO_MS : ESPERAS_DE_IMAGEM_MS;
  // Vídeo: a ferramenta já respondeu no começo do trabalho (a chamada é idempotente); aqui só garante.
  if (comVideo) irParaSegundoPlano();
  let decorrido = 0;
  for (let rodada = 0; ; rodada++) {
    const emFundo = rodada >= cronograma.length;
    const espera = emFundo ? Math.min(INTERVALO_EM_SEGUNDO_PLANO_MS, LIMITE_DE_ESPERA_MS - decorrido) : cronograma[rodada]!;
    if (espera <= 0) break;
    // Antes da primeira espera longa, a ferramenta devolve na hora e o trabalho continua sozinho.
    if (emFundo) irParaSegundoPlano();
    await estado.esperar(espera);
    decorrido += espera;

    for (const id of [...pendentes]) {
      const lido = await ctx.graph.get<{ status_code?: string; status?: unknown }>(id, { fields: "status_code,status" });
      const codigo = lido.status_code ?? "IN_PROGRESS";
      const container = trabalho.containers.find((c) => c.id === id);
      if (container) container.status_code = codigo;
      if (codigo === "FINISHED" || codigo === "PUBLISHED") pendentes.delete(id);
      else if (codigo === "ERROR" || codigo === "EXPIRED") throw new ErroDeContainer(traduzirStatusDoContainer(codigo, lido.status));
    }
    if (pendentes.size === 0) return;
    if (decorrido >= LIMITE_DE_ESPERA_MS) break;
  }
  throw new ErroDeContainer(
    "A Meta não terminou de processar a mídia em 5 minutos. Nada foi publicado; o container expira sozinho em 24 h. Tente de novo mais tarde.",
  );
}
