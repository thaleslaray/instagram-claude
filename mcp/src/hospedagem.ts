// Hospedagem de foto do computador no Uploadcare. A Meta só baixa foto de um endereço público: a foto sobe para o
// Uploadcare (sem guardar; some sozinha em 24 h) e a Meta recebe o endereço do CDN. Vale só para foto: vídeo e mídia
// de DM sobem direto para a Meta (graph.ts). A chave pública do Uploadcare não é segredo.
//
// Fatos provados na API (ficha 18): `POST https://upload.uploadcare.com/base/` em multipart com UPLOADCARE_PUB_KEY,
// UPLOADCARE_STORE=0 e file devolve `{ file: <uuid> }`. O endereço público é `https://<prefixo>.ucarecd.net/<uuid>/<nome>`,
// com <prefixo> = 10 primeiros caracteres do SHA-256 da chave pública, escrito em base 36.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ehExtensao, ErroConfig, lerCampo } from "./config.ts";
import { limpar } from "./segredos.ts";
import { ehJpeg, LIMITES } from "./validacao-midia.ts";

export const BASE_DO_UPLOAD_PADRAO = "https://upload.uploadcare.com";

const FRASE_BASE =
  "Vídeo do computador e mídia por endereço https funcionam sem ela.";
const FRASE_DA_CAPA = " Para a capa do Reels, `capa_ms` (um instante do vídeo) dispensa a chave.";

export const MENSAGEM_SEM_UPLOADCARE = `Para publicar foto do computador, defina IG_UPLOADCARE_PUBLIC_KEY (a chave pública do Uploadcare) na configuração do MCP. ${FRASE_BASE}`;
export const MENSAGEM_SEM_UPLOADCARE_NA_EXTENSAO = `Para publicar foto do computador, abra as configurações da extensão Instagram no Claude Desktop e cole a chave pública do Uploadcare (etapa 10). ${FRASE_BASE}`;

/** A frase de "sem a chave do Uploadcare" que serve à instalação (extensão ou terminal). `capaDeReels` lembra do `capa_ms`. */
export const mensagemSemUploadcare = (capaDeReels = false): string =>
  (ehExtensao() ? MENSAGEM_SEM_UPLOADCARE_NA_EXTENSAO : MENSAGEM_SEM_UPLOADCARE) + (capaDeReels ? FRASE_DA_CAPA : "");

export class ErroUploadcareNaoConfigurado extends Error {
  override name = "ErroUploadcareNaoConfigurado";
  constructor(mensagem = mensagemSemUploadcare()) {
    super(mensagem);
  }
}

export class ErroUploadcare extends Error {
  override name = "ErroUploadcare";
}

export interface Hospedagem {
  /** Sobe a foto JPEG local e devolve o endereço público que a Meta vai baixar. */
  enviar(caminho: string): Promise<{ url: string }>;
}

/** Prefixo do CDN da conta: 10 primeiros caracteres do SHA-256 da chave pública, em base 36. */
export function prefixoDoCdn(chavePublica: string): string {
  const hex = createHash("sha256").update(chavePublica).digest("hex");
  return BigInt(`0x${hex}`).toString(36).slice(0, 10);
}

export interface OpcoesUploadcare {
  /** Chave pública do Uploadcare. */
  chave: string;
  /** Base do upload. Só os testes trocam, e só por 127.0.0.1 ou localhost. */
  uploadBase?: string;
  /** Base do CDN. Só os testes trocam, e só por 127.0.0.1 ou localhost. */
  cdnBase?: string;
  /** Troca o fetch (padrão: o global, lido a cada uso). */
  fetch?: typeof fetch;
}

const TEMPO_LIMITE_MS = 120_000;

function baseTrocada(nome: string, valor: string): string {
  const base = valor.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new ErroConfig(`${nome} inválida: use http://127.0.0.1:<porta> (só nos testes).`);
  }
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new ErroConfig(`${nome} só vale nos testes, com http://127.0.0.1:<porta> ou http://localhost:<porta>.`);
  }
  return base;
}

export function criarHospedagemUploadcare(opcoes: OpcoesUploadcare): Hospedagem {
  const { chave } = opcoes;
  const uploadBase = opcoes.uploadBase === undefined ? BASE_DO_UPLOAD_PADRAO : baseTrocada("Base do upload", opcoes.uploadBase);
  const cdnBase = opcoes.cdnBase === undefined ? `https://${prefixoDoCdn(chave)}.ucarecd.net` : baseTrocada("Base do CDN", opcoes.cdnBase);

  async function enviar(caminho: string): Promise<{ url: string }> {
    const bytes = await readFile(caminho);
    if (!ehJpeg(bytes)) throw new ErroUploadcare("Só foto JPEG sobe para o Uploadcare. Nada foi enviado.");
    if (bytes.length > LIMITES.imagemBytes) throw new ErroUploadcare("A foto passa de 8 MB. Nada foi enviado.");

    const form = new FormData();
    form.set("UPLOADCARE_PUB_KEY", chave);
    form.set("UPLOADCARE_STORE", "0");
    form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "foto.jpg");

    const usarFetch = opcoes.fetch ?? globalThis.fetch;
    let resposta: Response;
    try {
      resposta = await usarFetch(`${uploadBase}/base/`, { method: "POST", body: form, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    } catch (erro) {
      throw new ErroUploadcare(limpar(`Não consegui falar com o Uploadcare: ${erro instanceof Error ? erro.message : String(erro)}. Nada foi publicado.`));
    }
    let uuid: unknown;
    try {
      uuid = ((await resposta.json()) as { file?: unknown }).file;
    } catch {
      uuid = undefined;
    }
    if (!resposta.ok) {
      throw new ErroUploadcare(`O Uploadcare recusou a foto (HTTP ${resposta.status}). Nada foi publicado; tente de novo e confira a chave pública.`);
    }
    if (typeof uuid !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(uuid)) {
      throw new ErroUploadcare("O Uploadcare respondeu sem o identificador da foto. Nada foi publicado; tente de novo.");
    }
    return { url: `${cdnBase}/${uuid}/foto.jpg` };
  }

  return { enviar };
}

/** A hospedagem da instalação: null quando a chave pública do Uploadcare não foi configurada (ela é opcional). */
export function criarHospedagemDoAmbiente(env: Record<string, string | undefined> = process.env): Hospedagem | null {
  const chave = lerCampo(env, "IG_UPLOADCARE_PUBLIC_KEY");
  return chave === "" ? null : criarHospedagemUploadcare({ chave });
}

/**
 * Recusa, com a frase da instalação, quando não dá para hospedar foto do computador porque falta a chave do Uploadcare.
 * Uma função só, para as quatro publicações recusarem igual e ANTES da prévia.
 */
export function exigirHospedagem(hospedagem: Hospedagem | null, capaDeReels = false): asserts hospedagem is Hospedagem {
  if (!hospedagem) throw new ErroUploadcareNaoConfigurado(mensagemSemUploadcare(capaDeReels));
}
