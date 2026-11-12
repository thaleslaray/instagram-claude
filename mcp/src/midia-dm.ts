// Mídia de DM (spec 4.2): quais formatos e tamanhos a Meta aceita em cada `tipo` de anexo.
// O tipo é reconhecido pelos primeiros bytes do arquivo (o nome e a extensão não contam).

import { open, stat } from "node:fs/promises";

export type TipoDeAnexo = "image" | "video" | "audio" | "file";

export interface Formato {
  /** Tipo MIME do anexo. */
  tipo: string;
  ext: string;
  /** Em quais `tipo` de anexo a Meta aceita este formato. */
  serve: readonly TipoDeAnexo[];
}

/** Limite em bytes por tipo de anexo (messaging-api.md:157-160). MB decimal, para recusar antes e nunca depois do upload. */
export const LIMITE_DE_TAMANHO: Record<TipoDeAnexo, number> = {
  image: 8_000_000,
  video: 25_000_000,
  audio: 25_000_000,
  file: 25_000_000,
};

export const FORMATOS_ACEITOS: Record<TipoDeAnexo, string> = {
  image: "png ou jpeg, até 8 MB",
  video: "mp4, ogg, avi, mov ou webm, até 25 MB",
  audio: "aac, m4a, wav ou mp4, até 25 MB",
  file: "só pdf, até 25 MB",
};

/** Extensões (sem o ponto) que a Meta aceita em cada tipo de anexo. Valem para a URL, onde só dá para olhar o nome. */
const EXTENSOES_POR_TIPO: Record<TipoDeAnexo, readonly string[]> = {
  image: ["png", "jpg", "jpeg"],
  video: ["mp4", "ogg", "avi", "mov", "webm"],
  audio: ["aac", "m4a", "wav", "mp4"],
  file: ["pdf"],
};

/**
 * Confere a extensão no caminho de uma URL (a query não conta). Com extensão conhecida que não combina com o `tipo`,
 * lança o erro em português; sem extensão não dá para saber, e passa. Lança Error com a frase para o dono da conta.
 */
export function conferirExtensaoDaUrl(tipo: TipoDeAnexo, url: URL): void {
  const ultimo = url.pathname.split("/").pop() ?? "";
  const ponto = ultimo.lastIndexOf(".");
  if (ponto < 0) return;
  const extensao = decodeURIComponent(ultimo.slice(ponto + 1)).toLowerCase();
  if (extensao === "" || EXTENSOES_POR_TIPO[tipo].includes(extensao)) return;
  throw new Error(`Formato não aceito em ${tipo}: a URL termina em .${extensao}, e a Meta aceita ${FORMATOS_ACEITOS[tipo]}. Nada foi enviado.`);
}

/** Reconhece o formato pelos primeiros bytes. Devolve null para o que a Meta não aceita em nenhum tipo. */
export function detectarFormatoDeDm(b: Buffer): Formato | null {
  const inicia = (...bytes: number[]) => bytes.every((v, i) => b[i] === v);
  const texto = (de: number, s: string) => b.length >= de + s.length && b.subarray(de, de + s.length).toString("latin1") === s;
  if (inicia(0xff, 0xd8, 0xff)) return { tipo: "image/jpeg", ext: "jpg", serve: ["image"] };
  if (inicia(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { tipo: "image/png", ext: "png", serve: ["image"] };
  if (texto(0, "%PDF-")) return { tipo: "application/pdf", ext: "pdf", serve: ["file"] };
  if (texto(0, "OggS")) return { tipo: "video/ogg", ext: "ogg", serve: ["video"] };
  if (inicia(0x1a, 0x45, 0xdf, 0xa3)) return { tipo: "video/webm", ext: "webm", serve: ["video"] };
  if (texto(0, "RIFF") && texto(8, "AVI ")) return { tipo: "video/x-msvideo", ext: "avi", serve: ["video"] };
  if (texto(0, "RIFF") && texto(8, "WAVE")) return { tipo: "audio/wav", ext: "wav", serve: ["audio"] };
  if (texto(4, "ftyp")) {
    const marca = b.subarray(8, 12).toString("latin1");
    if (marca === "qt  ") return { tipo: "video/quicktime", ext: "mov", serve: ["video"] };
    if (marca === "M4A ") return { tipo: "audio/mp4", ext: "m4a", serve: ["audio"] };
    return { tipo: "video/mp4", ext: "mp4", serve: ["video", "audio"] };
  }
  // AAC em ADTS: sincronismo 0xFFF, camada 00.
  if (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xf6) === 0xf0) return { tipo: "audio/aac", ext: "aac", serve: ["audio"] };
  return null;
}

export interface ArquivoValidado {
  tamanho: number;
  formato: Formato;
}

/** Confere tamanho e formato do arquivo local ANTES da prévia. Lança Error com a frase para o dono da conta. */
export async function validarArquivoDeDm(tipo: TipoDeAnexo, caminho: string): Promise<ArquivoValidado> {
  let tamanho: number;
  try {
    const info = await stat(caminho);
    if (!info.isFile()) throw new Error("não é um arquivo");
    tamanho = info.size;
  } catch {
    throw new Error(`Não achei o arquivo (${caminho}). Confira o caminho.`);
  }
  if (tamanho === 0) throw new Error("O arquivo está vazio.");
  if (tamanho > LIMITE_DE_TAMANHO[tipo]) {
    throw new Error(`Arquivo grande demais para ${tipo}: ${tamanho} bytes (a Meta aceita ${FORMATOS_ACEITOS[tipo]}). Nada foi enviado.`);
  }
  const cabeca = Buffer.alloc(16);
  const arquivo = await open(caminho, "r");
  try {
    const { bytesRead } = await arquivo.read(cabeca, 0, cabeca.length, 0);
    const formato = detectarFormatoDeDm(cabeca.subarray(0, bytesRead));
    if (!formato || !formato.serve.includes(tipo)) {
      throw new Error(`Formato não aceito em ${tipo}: a Meta aceita ${FORMATOS_ACEITOS[tipo]}. Nada foi enviado.`);
    }
    return { tamanho, formato };
  } finally {
    await arquivo.close();
  }
}
