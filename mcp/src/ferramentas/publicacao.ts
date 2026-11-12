// Publicação de post, carrossel, reels e story, e acompanhamento (spec 4.4, 4.4.1 e 5.3; fichas 09 e 10).
// ig_publicar_post e ig_publicar_carrossel validam tudo no Mac, leem a cota, mostram a prévia e só publicam
// depois do clique (o corpo guardado no pedido é o que o servidor executa, em publicacao.ts).
// ig_limite_publicacao e ig_status_publicacao são leituras.

import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { expandirCaminho, nomeDaConta } from "./comum.ts";
import type { EdicaoDeTexto, Previa } from "../confirmacao.ts";
import type { Contexto } from "../contexto.ts";
import { ErroUploadcareNaoConfigurado, exigirHospedagem } from "../hospedagem.ts";
import { TETO_MINIATURAS_CARACTERES } from "../escrita.ts";
import {
  estadoDePublicacao,
  lerCota,
  publicarConfirmado,
  sha256DoArquivo,
  textoDaCota,
  type Cota,
  type CorpoDePublicacao,
  type ItemDePublicacao,
  type MarcacaoDePessoa,
} from "../publicacao.ts";
import { registrarEscrita, registrarLeitura, respostaJson } from "../respostas.ts";
import { limpar } from "../segredos.ts";
import {
  analisarLegenda,
  descreverFormato,
  ehJpeg,
  LIMITES,
  linhaDaJanelaDoFeed,
  normalizarUsuario,
  REGRAS_DE_VIDEO,
  tipoDeVideo,
  validarImagem,
  validarImagemSimples,
  validarVideo,
  type AnaliseDaLegenda,
  type UsoDeVideo,
} from "../validacao-midia.ts";

export const MAX_ITENS_DO_CARROSSEL = 20;
export const MIN_ITENS_DO_CARROSSEL = 2;

// ---------------------------------------------------------------- entradas

const Marcacao = z.strictObject({
  usuario: z.string().min(1).max(40).describe("@ do usuário marcado (com ou sem @)"),
  x: z.number().min(0).max(1).describe("Posição horizontal na foto, de 0 (esquerda) a 1 (direita)"),
  y: z.number().min(0).max(1).describe("Posição vertical na foto, de 0 (topo) a 1 (base)"),
});

const EntradaPost = z.strictObject({
  imagem: z.string().min(1).max(2048).describe("Caminho de um JPEG neste Mac (ex.: ~/Fotos/post.jpg) ou URL https de um JPEG"),
  legenda: z.string().max(20_000).optional().describe("Legenda do post (até 2.200 caracteres, 30 hashtags e 20 menções)"),
  texto_alternativo: z.string().max(1000).optional().describe("Texto alternativo da imagem, para acessibilidade (até 1.000 caracteres)"),
  marcacoes: z.array(Marcacao).max(20).optional().describe("Pessoas marcadas na foto, com a posição de cada uma"),
  local_id: z.string().optional().describe("ID numérico do local (Páginas do Facebook)"),
  colaboradores: z.array(z.string().min(1).max(40)).max(3).optional().describe("Até 3 contas convidadas como colaboradoras"),
  feito_com_ia: z.boolean().optional().describe("true marca o post como feito com IA"),
});

const ItemDoCarrossel = z.strictObject({
  arquivo: z.string().min(1).max(2048).describe("Caminho de um JPEG ou vídeo MP4/MOV neste Mac, ou URL https"),
  tipo: z.enum(["imagem", "video"]).optional().describe("Só para URL: o tipo do arquivo (arquivo local é reconhecido pelos bytes). Padrão: imagem, ou vídeo se a URL termina em .mp4 ou .mov"),
  texto_alternativo: z.string().max(1000).optional().describe("Texto alternativo deste item (até 1.000 caracteres)"),
});

const EntradaCarrossel = z.strictObject({
  itens: z.array(ItemDoCarrossel).min(1).max(100).describe("De 2 a 20 itens, na ordem do carrossel. O corte segue o do primeiro item"),
  legenda: z.string().max(20_000).optional().describe("Legenda do carrossel (até 2.200 caracteres, 30 hashtags e 20 menções)"),
  local_id: z.string().optional().describe("ID numérico do local"),
  colaboradores: z.array(z.string().min(1).max(40)).max(3).optional().describe("Até 3 contas convidadas como colaboradoras"),
});

const MarcacaoDeVideo = z.strictObject({
  usuario: z.string().min(1).max(40).describe("@ do usuário marcado (com ou sem @)"),
  x: z.number().min(0).max(1).optional().describe("Só para foto: posição horizontal, de 0 (esquerda) a 1 (direita)"),
  y: z.number().min(0).max(1).optional().describe("Só para foto: posição vertical, de 0 (topo) a 1 (base)"),
});

const EntradaReels = z.strictObject({
  video: z.string().min(1).max(2048).describe("Caminho de um vídeo MP4 ou MOV neste Mac (ex.: ~/Videos/reels.mp4) ou URL https. De 3 s a 15 min, até 300 MB"),
  legenda: z.string().max(20_000).optional().describe("Legenda do Reels (até 2.200 caracteres, 30 hashtags e 20 menções)"),
  capa: z.string().min(1).max(2048).optional().describe("Capa: caminho de um JPEG neste Mac ou URL https de um JPEG (até 8 MB). Use capa OU capa_ms"),
  capa_ms: z.number().int().min(0).max(900_000).optional().describe("Instante do vídeo, em milissegundos, para usar como capa (padrão da Meta: o começo)"),
  mostrar_no_feed: z.boolean().optional().describe("Também aparece na grade do perfil e no feed (padrão true)"),
  nome_do_audio: z.string().min(1).max(100).optional().describe("Nome do áudio original do Reels"),
  marcacoes: z.array(MarcacaoDeVideo).max(20).optional().describe("Pessoas marcadas"),
  local_id: z.string().optional().describe("ID numérico do local (Páginas do Facebook)"),
  colaboradores: z.array(z.string().min(1).max(40)).max(3).optional().describe("Até 3 contas convidadas como colaboradoras"),
});

const EntradaStory = z.strictObject({
  midia: z.string().min(1).max(2048).describe("Caminho de um JPEG (até 8 MB) ou vídeo MP4/MOV (3 a 60 s, até 100 MB) neste Mac, ou URL https"),
  tipo: z.enum(["imagem", "video"]).optional().describe("Só para URL: o tipo do arquivo (arquivo local é reconhecido pelos bytes). Padrão: imagem, ou vídeo se a URL termina em .mp4 ou .mov"),
  marcacoes: z.array(MarcacaoDeVideo).max(20).optional().describe("Pessoas marcadas (em foto, informe x e y)"),
  // Aceitos só para devolver uma explicação em vez do erro genérico de campo desconhecido.
  texto_alternativo: z.unknown().optional().describe("Não é aceito no story: a Meta não tem texto alternativo para story"),
  colaboradores: z.unknown().optional().describe("Não é aceito no story: a Meta não aceita colaboradores em story"),
});

const EntradaStatus = z.strictObject({ trabalho_id: z.string().min(1).max(64).describe("O trabalho_id que a publicação devolveu") });

// ---------------------------------------------------------------- preparo de um item

interface ItemPreparado {
  item: ItemDePublicacao;
  erros: string[];
  avisos: string[];
  /** Caminho local, para a miniatura. */
  paraMiniatura?: string;
  detalhe: string;
}

const formatarKB = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

async function duracaoDoVideo(ctx: Contexto, caminho: string): Promise<number | null> {
  try {
    const r = await ctx.executar("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", caminho]);
    if (r.codigo !== 0) return null;
    const segundos = Number(r.stdout.trim());
    return Number.isFinite(segundos) ? segundos : null;
  } catch {
    return null;
  }
}

async function prepararItem(
  ctx: Contexto,
  entrada: string,
  nome: string,
  opcoes: {
    permiteVideo: boolean;
    /** Padrão true. Reels só aceita vídeo. */
    permiteImagem?: boolean;
    tipoDaUrl?: "imagem" | "video" | undefined;
    alt?: string | undefined;
    /** Onde o vídeo será usado (padrão: carrossel). */
    usoDoVideo?: UsoDeVideo;
    /** "feed" confere proporção e largura; "simples" (capa e story) só JPEG e 8 MB. Padrão: feed. */
    imagem?: "feed" | "simples";
    /** Proporção esperada da imagem "simples" (9:16 no story), só para avisar. */
    proporcaoEsperada?: number;
  },
): Promise<ItemPreparado> {
  const permiteImagem = opcoes.permiteImagem !== false;
  const usoDoVideo = opcoes.usoDoVideo ?? "carrossel";
  const regra = REGRAS_DE_VIDEO[usoDoVideo];
  const alt = opcoes.alt?.trim() ? opcoes.alt : undefined;
  const vazio = (tipo: "IMAGE" | "VIDEO", extra: Partial<ItemDePublicacao>, erros: string[], avisos: string[], detalhe: string): ItemPreparado => ({
    item: { origem: "local", tipo, nome, ...(alt ? { alt } : {}), ...extra },
    erros,
    avisos,
    detalhe,
  });

  // URL https: usada como está, sem hospedar e sem baixar nada aqui.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entrada)) {
    let url: URL;
    try {
      url = new URL(entrada);
    } catch {
      return vazio("IMAGE", {}, [`${nome}: a URL não é válida.`], [], nome);
    }
    if (url.protocol !== "https:") return vazio("IMAGE", {}, [`${nome}: só aceito URL https (recebi ${url.protocol.replace(":", "")}).`], [], nome);
    const video = opcoes.tipoDaUrl ? opcoes.tipoDaUrl === "video" : /\.(mp4|mov)$/i.test(url.pathname);
    const tipo = video ? "VIDEO" : "IMAGE";
    const erros =
      video && !opcoes.permiteVideo ? [`${nome}: este tipo de publicação aceita só foto.`] : !video && !permiteImagem ? [`${nome}: este tipo de publicação aceita só vídeo.`] : [];
    return {
      item: { origem: "url", url: url.toString(), tipo, nome: url.host, ...(alt ? { alt } : {}) },
      erros,
      avisos: [`${nome} é uma URL (${url.host}): não conferi o formato, o tamanho nem a proporção, e a Meta vai baixá-la direto.`],
      detalhe: `${nome}: ${tipo === "VIDEO" ? "vídeo" : "foto"} por URL em ${url.host} (não conferida)`,
    };
  }

  const caminho = expandirCaminho(entrada);
  let tamanho: number;
  try {
    const s = await stat(caminho);
    if (!s.isFile()) return vazio("IMAGE", {}, [`${nome}: ${basename(caminho)} não é um arquivo.`], [], nome);
    tamanho = s.size;
  } catch {
    return vazio("IMAGE", {}, [`${nome}: não achei o arquivo ${caminho}.`], [], nome);
  }
  const base = basename(caminho);
  const arquivo = await open(caminho, "r");
  const cabeca = Buffer.alloc(32);
  try {
    await arquivo.read(cabeca, 0, 32, 0);
  } finally {
    await arquivo.close();
  }

  if (ehJpeg(cabeca) && !permiteImagem) {
    return vazio("IMAGE", { caminho }, [`${nome} (${base}): é uma foto; ${regra.rotulo} aceita só vídeo.`], [], nome);
  }
  if (ehJpeg(cabeca)) {
    if (tamanho > LIMITES.imagemBytes) {
      return vazio("IMAGE", { caminho, bytes: tamanho }, [`${nome} (${base}): ${formatarKB(tamanho)}; o limite é 8 MB.`], [], `${nome}: ${base}`);
    }
    const bytes = await readFile(caminho);
    const r =
      opcoes.imagem === "simples"
        ? validarImagemSimples(bytes, `${nome} (${base})`, opcoes.proporcaoEsperada !== undefined ? { proporcaoEsperada: opcoes.proporcaoEsperada } : {})
        : validarImagem(bytes, `${nome} (${base})`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      item: { origem: "local", caminho, tipo: "IMAGE", nome: base, bytes: bytes.length, ...(r.largura ? { largura: r.largura, altura: r.altura! } : {}), sha256, ...(alt ? { alt } : {}) },
      erros: r.erros,
      avisos: r.avisos,
      paraMiniatura: caminho,
      detalhe: `${nome}: ${base} · JPEG · ${r.largura ?? "?"}×${r.altura ?? "?"} · ${formatarKB(bytes.length)}`,
    };
  }

  const video = tipoDeVideo(cabeca);
  if (video) {
    if (!opcoes.permiteVideo) {
      return vazio("VIDEO", { caminho }, [`${nome} (${base}): é um vídeo; aqui só aceito foto (JPEG). Para vídeo, use um carrossel, o Reels ou o story.`], [], nome);
    }
    const segundos = await duracaoDoVideo(ctx, caminho);
    const { erros, avisos } = validarVideo(usoDoVideo, `${nome} (${base})`, tamanho, segundos);
    return {
      item: { origem: "local", caminho, tipo: "VIDEO", nome: base, bytes: tamanho, sha256: await sha256DoArquivo(caminho), ...(alt ? { alt } : {}) },
      erros,
      avisos,
      detalhe: `${nome}: ${base} · vídeo ${video} · ${formatarKB(tamanho)}${segundos === null ? "" : ` · ${Math.round(segundos)} s`}`,
    };
  }

  const formato = descreverFormato(cabeca);
  const r = validarImagem(cabeca, `${nome} (${base})`); // gera a mensagem padrão de recusa (PNG, HEIC...)
  return vazio("IMAGE", { caminho }, r.erros.length > 0 ? r.erros : [`${nome} (${base}): formato não aceito (${formato}).`], [], `${nome}: ${base}`);
}

// ---------------------------------------------------------------- miniaturas (sips)

/** JPEG pequeno em data URL, gerado com `sips`. Se o `sips` não existir ou falhar, sem miniatura. */
async function miniaturaDe(ctx: Contexto, caminho: string): Promise<string | null> {
  let pasta: string | null = null;
  try {
    pasta = await mkdtemp(join(tmpdir(), "ig-miniatura-"));
    const saida = join(pasta, "m.jpg");
    const r = await ctx.executar("sips", ["-Z", "160", "-s", "format", "jpeg", "-s", "formatOptions", "45", caminho, "--out", saida]);
    if (r.codigo !== 0) return null;
    const bytes = await readFile(saida);
    if (!ehJpeg(bytes)) return null;
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  } finally {
    if (pasta) await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function miniaturasDe(ctx: Contexto, itens: ItemPreparado[]): Promise<{ miniaturas: string[]; omitidas: number }> {
  const miniaturas: string[] = [];
  let total = 0;
  let omitidas = 0;
  for (const i of itens) {
    if (!i.paraMiniatura) continue;
    const m = await miniaturaDe(ctx, i.paraMiniatura);
    if (m === null) continue;
    if (total + m.length > TETO_MINIATURAS_CARACTERES) {
      omitidas++;
      continue;
    }
    total += m.length;
    miniaturas.push(m);
  }
  return { miniaturas, omitidas };
}

// ---------------------------------------------------------------- campos comuns

interface CamposComuns {
  erros: string[];
  local_id?: string;
  colaboradores?: string[];
}

function conferirComuns(local_id: string | undefined, colaboradores: string[] | undefined): CamposComuns {
  const erros: string[] = [];
  let local: string | undefined;
  if (local_id !== undefined && local_id.trim() !== "") {
    if (/^\d{1,30}$/.test(local_id.trim())) local = local_id.trim();
    else erros.push("local_id precisa ser o ID numérico do local.");
  }
  let colabs: string[] | undefined;
  if (colaboradores?.length) {
    colabs = [];
    for (const c of colaboradores) {
      const u = normalizarUsuario(c);
      if (u === null) erros.push(`Colaborador inválido: ${c}`);
      else if (!colabs.includes(u)) colabs.push(u);
    }
  }
  return { erros, ...(local ? { local_id: local } : {}), ...(colabs?.length ? { colaboradores: colabs } : {}) };
}

/** Confere os @ das marcações (reels e story): x e y são opcionais, porque em vídeo a Meta não usa. */
function conferirMarcacoes(
  entrada: Array<{ usuario: string; x?: number | undefined; y?: number | undefined }> | undefined,
  erros: string[],
): MarcacaoDePessoa[] {
  const saida: MarcacaoDePessoa[] = [];
  for (const m of entrada ?? []) {
    const usuario = normalizarUsuario(m.usuario);
    if (usuario === null) erros.push(`Marcação inválida: ${m.usuario}`);
    else saida.push({ usuario, ...(m.x !== undefined ? { x: m.x } : {}), ...(m.y !== undefined ? { y: m.y } : {}) });
  }
  return saida;
}

function recusar(erros: string[]): never {
  throw new Error(`Não publiquei nada e não pedi confirmação:\n- ${erros.join("\n- ")}`);
}

function exigirCotaLivre(cota: Cota): void {
  if (cota.usadas >= cota.total) {
    throw new Error(
      `Cota de publicação cheia: ${textoDaCota(cota)}. A Meta libera conforme as publicações saem da janela de 24 h. Nada foi enviado nem confirmado.`,
    );
  }
}

/**
 * Sem a chave do Uploadcare não dá para publicar foto do computador: recusa antes de pedir confirmação, no mesmo bloco
 * das outras recusas. Vale para foto local de post, carrossel e story e para a capa local do Reels. Vídeo local sobe
 * direto para a Meta e URL https passa como está: nada disso precisa da chave.
 */
function exigirHospedagemParaFotosLocais(ctx: Contexto, itens: ReadonlyArray<ItemPreparado | undefined>, capa?: ItemPreparado): void {
  const ehFotoLocal = (p: ItemPreparado | undefined) => p?.item.origem === "local" && p.item.tipo === "IMAGE";
  if (!itens.some(ehFotoLocal) && !ehFotoLocal(capa)) return;
  try {
    exigirHospedagem(ctx.hospedagem, ehFotoLocal(capa));
  } catch (erro) {
    if (erro instanceof ErroUploadcareNaoConfigurado) recusar([erro.message]);
    throw erro;
  }
}

/** Lê a cota e recusa se estiver cheia. */
async function lerCotaLivre(ctx: Contexto, signal: AbortSignal): Promise<Cota> {
  const cota = await lerCota(ctx, estadoDePublicacao(ctx), signal);
  exigirCotaLivre(cota);
  return cota;
}

/** Linhas da prévia sobre a cota: `depoisDe` é o começo da frase "… N de TOTAL". */
function linhasDaCota(cota: Cota, depoisDe: string): string[] {
  return [`Cota: ${textoDaCota(cota)}. ${depoisDe}: ${cota.usadas + 1} de ${cota.total}.`, ...(cota.aviso ? [`Aviso: ${cota.aviso}`] : [])];
}

/** Local e colaboradores, quando o corpo os tem (post, carrossel e Reels). */
function linhasDeLocalEColaboradores(c: CorpoDePublicacao): string[] {
  return [
    ...(c.local_id ? [`Local: ${c.local_id}`] : []),
    ...(c.colaboradores?.length ? [`Colaboradores: ${c.colaboradores.map((u) => `@${u}`).join(", ")}`] : []),
  ];
}

/** Legenda editável no cartão (ficha 16): as mesmas regras da ferramenta (tamanho, hashtags, menções) e legenda não vazia. Sem legenda, sem edição. */
function edicaoDaLegenda(corpo: CorpoDePublicacao): EdicaoDeTexto<CorpoDePublicacao> | undefined {
  if (!corpo.legenda) return undefined;
  return {
    limite: LIMITES.legendaCaracteres,
    unidade: "caracteres",
    comTexto: (novo) => {
      if (novo.trim() === "") throw new Error("A legenda está vazia. Para publicar sem legenda, peça uma prévia nova.");
      const analise = analisarLegenda(novo);
      if (analise.erros.length > 0) throw new Error(`${analise.erros.join(" ")} Nada foi enviado.`);
      return { ...corpo, legenda: novo };
    },
  };
}

const linhasDeAviso = (avisos: readonly string[]): string[] => avisos.map((aviso) => `Aviso: ${aviso}`);

function detalhesDaLegenda(a: AnaliseDaLegenda, legenda: string | undefined): string[] {
  if (!legenda) return ["Sem legenda"];
  return [linhaDaJanelaDoFeed(a), ...a.avisos.map((aviso) => `Aviso: ${aviso}`)];
}

// ---------------------------------------------------------------- registro das ferramentas

export function registrarPublicacao(server: McpServer, ctx: Contexto): void {
  registrarEscrita(
    server,
    "ig_publicar_post",
    { destrutiva: false, idempotente: false },
    {
      title: "Publicar foto no feed",
      description:
        "Publica UMA foto (JPEG) no feed da conta, com legenda, texto alternativo, marcações, local e colaboradores. A foto pode ser um arquivo do computador (exige a chave pública do Uploadcare, opcional na instalação; sem ela a ferramenta recusa antes da prévia) ou uma URL https. Valida a foto e a legenda no Mac, lê a cota de 24 h, mostra a prévia (foto, legenda inteira, janela do feed e cota) e espera o dono da conta clicar; só então envia e publica. " +
        "Se a resposta trouxer estado \"processando\", a Meta ainda está processando: o servidor publica sozinho quando ela terminar, e ig_status_publicacao mostra como está (use o trabalho_id).",
      inputSchema: EntradaPost,
    },
    async (a, mcp, escrever) => {
      // Passo 1: validar no Mac (sem Graph, sem cota, sem clique).
      const erros: string[] = [];
      const preparado = await prepararItem(ctx, a.imagem, "Imagem", { permiteVideo: false, alt: a.texto_alternativo });
      erros.push(...preparado.erros);
      const legenda = analisarLegenda(a.legenda);
      erros.push(...legenda.erros);
      const comuns = conferirComuns(a.local_id, a.colaboradores);
      erros.push(...comuns.erros);
      const marcacoes = conferirMarcacoes(a.marcacoes, erros);
      if (erros.length > 0) recusar(erros);
      exigirHospedagemParaFotosLocais(ctx, [preparado]);

      // Passo 2: ler a cota e recusar se estiver cheia.
      const cota = await lerCotaLivre(ctx, mcp.mcpReq.signal);

      const corpo: CorpoDePublicacao = {
        tipo: "post",
        itens: [preparado.item],
        ...(a.legenda ? { legenda: a.legenda } : {}),
        ...(comuns.local_id ? { local_id: comuns.local_id } : {}),
        ...(comuns.colaboradores ? { colaboradores: comuns.colaboradores } : {}),
        ...(marcacoes.length > 0 ? { marcacoes } : {}),
        ...(a.feito_com_ia ? { feito_com_ia: true } : {}),
      };
      const { miniaturas } = await miniaturasDe(ctx, [preparado]);

      // Passo 3: confirmar uma vez. O texto da prévia sai do mesmo corpo que será publicado.
      const montarPrevia = (c: CorpoDePublicacao): Previa => ({
        titulo: `Publicar foto no feed de ${nomeDaConta(ctx)}`,
        conta: nomeDaConta(ctx),
        alvo: `feed de ${nomeDaConta(ctx)}`,
        ...(c.legenda ? { texto: c.legenda } : {}),
        detalhes: [
          ...linhasDaCota(cota, "Depois deste post"),
          preparado.detalhe,
          ...(c.itens[0]?.alt ? [`Texto alternativo: ${c.itens[0].alt}`] : []),
          ...detalhesDaLegenda(legenda, c.legenda),
          ...(c.marcacoes?.length ? [`Marcações: ${c.marcacoes.map((m) => `@${m.usuario} (${m.x}, ${m.y})`).join(", ")}`] : []),
          ...linhasDeLocalEColaboradores(c),
          ...(c.feito_com_ia ? ["Marcado como feito com IA"] : []),
          ...linhasDeAviso(preparado.avisos),
        ],
        botao: "Publicar",
        ...(miniaturas.length > 0 ? { miniaturas } : {}),
      });
      return escrever("ig_publicar_post", corpo, montarPrevia, (c) => publicarConfirmado(ctx, "ig_publicar_post", c), edicaoDaLegenda(corpo));
    },
  );

  registrarEscrita(
    server,
    "ig_publicar_carrossel",
    { destrutiva: false, idempotente: false },
    {
      title: "Publicar carrossel no feed",
      description:
        "Publica um carrossel de 2 a 20 itens (foto JPEG ou vídeo MP4/MOV, arquivo do computador ou URL https) no feed. Vídeo do computador sobe direto para a Meta; foto do computador exige a chave pública do Uploadcare (opcional na instalação). Valida tudo no Mac, lê a cota, mostra a prévia (miniaturas, legenda inteira, janela do feed e cota) e espera o dono da conta clicar. " +
        "O carrossel espera todos os itens ficarem prontos na Meta; com vídeo isso leva alguns minutos: a resposta traz estado \"processando\" e o trabalho_id, o servidor publica sozinho no fim, e ig_status_publicacao mostra como está.",
      inputSchema: EntradaCarrossel,
    },
    async (a, mcp, escrever) => {
      const erros: string[] = [];
      if (a.itens.length < MIN_ITENS_DO_CARROSSEL || a.itens.length > MAX_ITENS_DO_CARROSSEL) {
        erros.push(`Carrossel aceita de ${MIN_ITENS_DO_CARROSSEL} a ${MAX_ITENS_DO_CARROSSEL} itens (recebi ${a.itens.length}).`);
      }
      const legenda = analisarLegenda(a.legenda);
      erros.push(...legenda.erros);
      const comuns = conferirComuns(a.local_id, a.colaboradores);
      erros.push(...comuns.erros);
      if (a.itens.length > MAX_ITENS_DO_CARROSSEL) recusar(erros); // não vale gastar tempo lendo 50 arquivos

      const preparados: ItemPreparado[] = [];
      for (const [i, entrada] of a.itens.entries()) {
        preparados.push(await prepararItem(ctx, entrada.arquivo, `Item ${i + 1}`, { permiteVideo: true, tipoDaUrl: entrada.tipo, alt: entrada.texto_alternativo }));
      }
      for (const p of preparados) erros.push(...p.erros);
      if (erros.length > 0) recusar(erros);
      exigirHospedagemParaFotosLocais(ctx, preparados);

      const cota = await lerCotaLivre(ctx, mcp.mcpReq.signal);

      const corpo: CorpoDePublicacao = {
        tipo: "carrossel",
        itens: preparados.map((p) => p.item),
        ...(a.legenda ? { legenda: a.legenda } : {}),
        ...(comuns.local_id ? { local_id: comuns.local_id } : {}),
        ...(comuns.colaboradores ? { colaboradores: comuns.colaboradores } : {}),
      };
      const { miniaturas, omitidas } = await miniaturasDe(ctx, preparados);
      const temVideo = preparados.some((p) => p.item.tipo === "VIDEO");

      const montarPrevia = (c: CorpoDePublicacao): Previa => ({
        titulo: `Publicar carrossel de ${c.itens.length} itens no feed de ${nomeDaConta(ctx)}`,
        conta: nomeDaConta(ctx),
        alvo: `feed de ${nomeDaConta(ctx)}`,
        ...(c.legenda ? { texto: c.legenda } : {}),
        detalhes: [
          ...linhasDaCota(cota, "Um carrossel conta como um post; depois dele"),
          ...preparados.map((p, i) => `${p.detalhe}${c.itens[i]?.alt ? ` · texto alternativo: ${c.itens[i]!.alt}` : ""}`),
          ...(omitidas > 0 ? [`Miniaturas: só as primeiras couberam na prévia (${omitidas} ficaram de fora).`] : []),
          ...detalhesDaLegenda(legenda, c.legenda),
          ...linhasDeLocalEColaboradores(c),
          ...(temVideo ? ["Tem vídeo: a Meta leva alguns minutos para processar; o servidor publica sozinho quando ela terminar."] : []),
          ...preparados.flatMap((p) => linhasDeAviso(p.avisos)),
        ],
        botao: "Publicar",
        ...(miniaturas.length > 0 ? { miniaturas } : {}),
      });
      return escrever("ig_publicar_carrossel", corpo, montarPrevia, (c) => publicarConfirmado(ctx, "ig_publicar_carrossel", c), edicaoDaLegenda(corpo));
    },
  );

  registrarEscrita(
    server,
    "ig_publicar_reels",
    { destrutiva: false, idempotente: false },
    {
      title: "Publicar Reels",
      description:
        "Publica um Reels (vídeo MP4 ou MOV de 3 s a 15 min, até 300 MB) com legenda, capa (JPEG ou instante do vídeo), áudio, marcações, local e colaboradores. O vídeo do computador sobe direto para a Meta, sem configurar nada; capa JPEG do computador exige a chave pública do Uploadcare (`capa_ms` dispensa). Valida o vídeo e a legenda no Mac (a duração, com o ffprobe, quando ele existe), lê a cota, mostra a prévia e espera o dono da conta clicar. " +
        "Vídeo sempre responde na hora com estado \"processando\" e o trabalho_id: o servidor segue sozinho, publica quando a Meta terminar (de 30 s a alguns minutos) e ig_status_publicacao mostra o andamento e, no fim, o ID e o link do Reels.",
      inputSchema: EntradaReels,
    },
    async (a, mcp, escrever) => {
      const erros: string[] = [];
      if (a.capa !== undefined && a.capa_ms !== undefined) erros.push("Use capa OU capa_ms, não os dois.");
      const video = await prepararItem(ctx, a.video, "Vídeo", { permiteVideo: true, permiteImagem: false, tipoDaUrl: "video", usoDoVideo: "reels" });
      erros.push(...video.erros);
      const capa = a.capa !== undefined ? await prepararItem(ctx, a.capa, "Capa", { permiteVideo: false, tipoDaUrl: "imagem", imagem: "simples" }) : undefined;
      if (capa) erros.push(...capa.erros);
      const legenda = analisarLegenda(a.legenda);
      erros.push(...legenda.erros);
      const comuns = conferirComuns(a.local_id, a.colaboradores);
      erros.push(...comuns.erros);
      const marcacoes = conferirMarcacoes(a.marcacoes, erros);
      if (erros.length > 0) recusar(erros);
      exigirHospedagemParaFotosLocais(ctx, [video], capa);

      const cota = await lerCotaLivre(ctx, mcp.mcpReq.signal);

      const corpo: CorpoDePublicacao = {
        tipo: "reels",
        itens: [video.item],
        ...(capa ? { capa: capa.item } : {}),
        ...(a.capa_ms !== undefined ? { capa_ms: a.capa_ms } : {}),
        mostrar_no_feed: a.mostrar_no_feed !== false,
        ...(a.nome_do_audio ? { nome_do_audio: a.nome_do_audio } : {}),
        ...(a.legenda ? { legenda: a.legenda } : {}),
        ...(comuns.local_id ? { local_id: comuns.local_id } : {}),
        ...(comuns.colaboradores ? { colaboradores: comuns.colaboradores } : {}),
        ...(marcacoes.length > 0 ? { marcacoes } : {}),
      };
      const { miniaturas } = await miniaturasDe(ctx, capa ? [capa] : []);

      const montarPrevia = (c: CorpoDePublicacao): Previa => ({
        titulo: `Publicar Reels em ${nomeDaConta(ctx)}`,
        conta: nomeDaConta(ctx),
        alvo: `Reels de ${nomeDaConta(ctx)}`,
        ...(c.legenda ? { texto: c.legenda } : {}),
        detalhes: [
          ...linhasDaCota(cota, "Depois deste Reels"),
          video.detalhe,
          ...(capa ? [capa.detalhe] : c.capa_ms !== undefined ? [`Capa: o vídeo aos ${(c.capa_ms / 1000).toLocaleString("pt-BR")} s`] : ["Capa: a que a Meta escolher (o começo do vídeo)"]),
          c.mostrar_no_feed === false ? "Não aparece no feed nem na grade: só na aba de Reels" : "Aparece também no feed e na grade do perfil",
          ...(c.nome_do_audio ? [`Nome do áudio: ${c.nome_do_audio}`] : []),
          ...detalhesDaLegenda(legenda, c.legenda),
          ...(c.marcacoes?.length ? [`Marcações: ${c.marcacoes.map((m) => `@${m.usuario}`).join(", ")}`] : []),
          ...linhasDeLocalEColaboradores(c),
          "A Meta leva de 30 s a alguns minutos para processar o vídeo; o servidor publica sozinho quando ela terminar.",
          ...linhasDeAviso(video.avisos),
          ...linhasDeAviso(capa?.avisos ?? []),
        ],
        botao: "Publicar",
        ...(miniaturas.length > 0 ? { miniaturas } : {}),
      });
      return escrever("ig_publicar_reels", corpo, montarPrevia, (c) => publicarConfirmado(ctx, "ig_publicar_reels", c), edicaoDaLegenda(corpo));
    },
  );

  registrarEscrita(
    server,
    "ig_publicar_story",
    { destrutiva: false, idempotente: false },
    {
      title: "Publicar story",
      description:
        "Publica um story (foto JPEG de até 8 MB, ou vídeo MP4/MOV de 3 a 60 s e até 100 MB), com marcações opcionais. Vídeo do computador sobe direto para a Meta; foto do computador exige a chave pública do Uploadcare (opcional na instalação). O story some depois de 24 h. Sem legenda, texto alternativo, colaboradores, figurinhas ou link: a API não tem. Valida no Mac, lê a cota, mostra a prévia e espera o dono da conta clicar. " +
        "Foto sai na hora; vídeo responde com estado \"processando\" e o trabalho_id, o servidor publica sozinho no fim e ig_status_publicacao mostra o andamento.",
      inputSchema: EntradaStory,
    },
    async (a, mcp, escrever) => {
      const erros: string[] = [];
      if (a.texto_alternativo !== undefined) erros.push("Story não aceita texto_alternativo: a API do Instagram só tem texto alternativo para foto de feed e carrossel.");
      if (a.colaboradores !== undefined) erros.push("Story não aceita colaboradores: a API do Instagram só convida colaboradores em post, carrossel e Reels.");
      const midia = await prepararItem(ctx, a.midia, "Mídia", {
        permiteVideo: true,
        tipoDaUrl: a.tipo,
        usoDoVideo: "story",
        imagem: "simples",
        proporcaoEsperada: 9 / 16,
      });
      erros.push(...midia.erros);
      const marcacoes = conferirMarcacoes(a.marcacoes, erros);
      if (erros.length > 0) recusar(erros);
      exigirHospedagemParaFotosLocais(ctx, [midia]);

      const cota = await lerCotaLivre(ctx, mcp.mcpReq.signal);

      const corpo: CorpoDePublicacao = { tipo: "story", itens: [midia.item], ...(marcacoes.length > 0 ? { marcacoes } : {}) };
      const { miniaturas } = await miniaturasDe(ctx, [midia]);
      const ehVideo = midia.item.tipo === "VIDEO";

      const montarPrevia = (c: CorpoDePublicacao): Previa => ({
        titulo: `Publicar story em ${nomeDaConta(ctx)}`,
        conta: nomeDaConta(ctx),
        alvo: `story de ${nomeDaConta(ctx)}`,
        detalhes: [
          ...linhasDaCota(cota, "Depois deste story"),
          midia.detalhe,
          "O story fica no ar por 24 h",
          ...(c.marcacoes?.length ? [`Marcações: ${c.marcacoes.map((m) => `@${m.usuario}`).join(", ")}`] : []),
          ...(ehVideo ? ["A Meta leva alguns segundos para processar o vídeo; o servidor publica sozinho quando ela terminar."] : []),
          ...linhasDeAviso(midia.avisos),
        ],
        botao: "Publicar",
        ...(miniaturas.length > 0 ? { miniaturas } : {}),
      });
      return escrever("ig_publicar_story", corpo, montarPrevia, (c) => publicarConfirmado(ctx, "ig_publicar_story", c));
    },
  );

  registrarLeitura(
    server,
    "ig_limite_publicacao",
    {
      title: "Ver a cota de publicação",
      description:
        "Mostra quantas publicações a conta já fez nas últimas 24 h e quantas ainda pode fazer. A cota da Meta demora para subir depois de publicar, então o servidor também conta as publicações dele e usa o maior dos dois números.",
      inputSchema: z.strictObject({}),
    },
    async (_args, mcp) => {
      const cota = await lerCota(ctx, estadoDePublicacao(ctx), mcp.mcpReq.signal);
      return respostaJson({
        usadas: cota.usadas,
        total: cota.total,
        restantes: cota.restantes,
        usadas_segundo_a_meta: cota.usadasNaMeta,
        usadas_contadas_pelo_servidor: cota.usadasLocalmente,
        janela_horas: 24,
        ...(cota.aviso ? { aviso: cota.aviso } : {}),
      });
    },
  );

  registrarLeitura(
    server,
    "ig_status_publicacao",
    {
      title: "Ver o andamento de uma publicação",
      description:
        "Mostra em que passo está uma publicação (hospedando, criando_containers, processando na Meta, publicando, publicado ou falhou), com o status de cada container e, quando publicada, o link. Use o trabalho_id que ig_publicar_post, ig_publicar_carrossel, ig_publicar_reels ou ig_publicar_story devolveu.",
      inputSchema: EntradaStatus,
    },
    async ({ trabalho_id }, mcp) => {
      const estado = estadoDePublicacao(ctx);
      const t = estado.trabalhos.obter(trabalho_id);
      if (!t) throw new Error(`Não conheço o trabalho ${trabalho_id}: ele pode ter terminado há mais de um dia ou o servidor reiniciou (os trabalhos ficam só na memória).`);
      // Em processamento, pergunta à Meta como cada container está agora.
      const containers = [];
      for (const c of t.containers) {
        let status_code = c.status_code;
        let status: string | undefined;
        if (t.estado === "processando") {
          try {
            const lido = await ctx.graph.get<{ status_code?: string; status?: unknown }>(c.id, { fields: "status_code,status" }, { signal: mcp.mcpReq.signal });
            status_code = lido.status_code ?? status_code;
            if (typeof lido.status === "string") status = limpar(lido.status).slice(0, 300);
          } catch {
            // o estado guardado basta
          }
        }
        containers.push({ id: c.id, tipo: c.tipo, status_code, ...(status ? { status } : {}) });
      }
      return respostaJson({
        trabalho_id: t.id,
        tipo: t.tipo,
        estado: t.estado,
        containers,
        ...(t.midiaId ? { midia_id: t.midiaId } : {}),
        ...(t.permalink ? { permalink: t.permalink } : {}),
        ...(t.erro ? { erro: t.erro } : {}),
        ...(t.avisos.length > 0 ? { avisos: t.avisos } : {}),
        iniciado_em: new Date(t.criadoEm).toISOString(),
        atualizado_em: new Date(t.atualizadoEm).toISOString(),
      });
    },
  );
}
