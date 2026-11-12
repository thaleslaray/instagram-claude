// Validação local da mídia e da legenda (spec 4.4.1), feita no Mac ANTES de pedir confirmação:
// erro aqui não gasta cota nem clique. Sem dependência nativa: o JPEG é lido pelos bytes.

export const LIMITES = {
  imagemBytes: 8 * 1024 * 1024,
  larguraMin: 320,
  larguraMax: 1440,
  /** 4:5 (retrato) a 1,91:1 (paisagem), em largura / altura. */
  proporcaoMin: 4 / 5,
  proporcaoMax: 1.91,
  videoDeCarrosselBytes: 100 * 1024 * 1024,
  videoDeCarrosselMinS: 3,
  videoDeCarrosselMaxS: 60,
  reelsBytes: 300 * 1024 * 1024,
  reelsMinS: 3,
  reelsMaxS: 15 * 60,
  storyVideoBytes: 100 * 1024 * 1024,
  storyVideoMinS: 3,
  storyVideoMaxS: 60,
  capaBytes: 8 * 1024 * 1024,
  legendaCaracteres: 2200,
  /** Limite da API: acima disso a legenda é recusada. */
  hashtagsMaximo: 30,
  /** Limite do app (dez/2025): acima disso só avisa, porque a API aceitou 7 na prova 4b. */
  hashtagsDoApp: 5,
  mencoes: 20,
  janelaDoFeed: 125,
} as const;

export interface DimensoesJpeg {
  largura: number;
  altura: number;
}

/** JPEG pelos bytes iniciais (`FF D8 FF`). */
export function ehJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Largura e altura pelo marcador SOF (start of frame). Devolve null se o arquivo estiver truncado ou estranho. */
export function lerDimensoesJpeg(b: Buffer): DimensoesJpeg | null {
  if (!ehJpeg(b)) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i + 1 < b.length) i++; // bytes de enchimento
    const marcador = b[i]!;
    i++;
    // Marcadores sem tamanho: TEM, RSTn, SOI.
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd8)) continue;
    if (marcador === 0xd9 || marcador === 0xda) return null; // fim ou dados da imagem, sem SOF antes
    if (i + 1 >= b.length) return null;
    const tamanho = b.readUInt16BE(i);
    if (tamanho < 2) return null;
    const ehSof = marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
    if (ehSof) {
      if (i + 6 >= b.length) return null;
      const altura = b.readUInt16BE(i + 3);
      const largura = b.readUInt16BE(i + 5);
      return largura > 0 && altura > 0 ? { largura, altura } : null;
    }
    i += tamanho;
  }
  return null;
}

/** Nome do formato por bytes, só para a mensagem de recusa ser clara. */
export function descreverFormato(b: Buffer): string {
  const texto = (de: number, s: string) => b.length >= de + s.length && b.subarray(de, de + s.length).toString("latin1") === s;
  if (ehJpeg(b)) return "JPEG";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "PNG";
  if (texto(0, "GIF8")) return "GIF";
  if (texto(0, "RIFF") && texto(8, "WEBP")) return "WebP";
  if (texto(4, "ftyp")) {
    const marca = b.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(marca)) return "HEIC";
    if (marca === "avif") return "AVIF";
    if (marca === "qt  ") return "vídeo MOV";
    return "vídeo MP4";
  }
  return "formato desconhecido";
}

export function tipoDeVideo(b: Buffer): "MP4" | "MOV" | null {
  if (b.length < 12 || b.subarray(4, 8).toString("latin1") !== "ftyp") return null;
  const marca = b.subarray(8, 12).toString("latin1");
  if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "M4A "].includes(marca)) return null;
  return marca === "qt  " ? "MOV" : "MP4";
}

/** Onde o vídeo vai ser usado: cada lugar tem o seu limite de tamanho e de duração (spec 4.4.1). */
export type UsoDeVideo = "carrossel" | "reels" | "story";

export interface RegraDeVideo {
  rotulo: string;
  bytes: number;
  minS: number;
  maxS: number;
}

export const REGRAS_DE_VIDEO: Readonly<Record<UsoDeVideo, RegraDeVideo>> = {
  carrossel: { rotulo: "vídeo de carrossel", bytes: LIMITES.videoDeCarrosselBytes, minS: LIMITES.videoDeCarrosselMinS, maxS: LIMITES.videoDeCarrosselMaxS },
  reels: { rotulo: "Reels", bytes: LIMITES.reelsBytes, minS: LIMITES.reelsMinS, maxS: LIMITES.reelsMaxS },
  story: { rotulo: "vídeo de story", bytes: LIMITES.storyVideoBytes, minS: LIMITES.storyVideoMinS, maxS: LIMITES.storyVideoMaxS },
};

/** "3 a 60 s" ou "3 s a 15 min". */
export function textoDaDuracao(r: RegraDeVideo): string {
  const t = (s: number) => (s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
  return `de ${t(r.minS)} a ${t(r.maxS)}`;
}

/** Tamanho e duração de um vídeo. `segundos` é null quando o `ffprobe` não existe ou não leu. */
export function validarVideo(uso: UsoDeVideo, nome: string, bytes: number, segundos: number | null): ResultadoMidia {
  const regra = REGRAS_DE_VIDEO[uso];
  const r: ResultadoMidia = { erros: [], avisos: [] };
  if (bytes > regra.bytes) r.erros.push(`${nome}: ${formatarMB(bytes)}; o limite de ${regra.rotulo} é ${formatarMB(regra.bytes)}.`);
  if (segundos === null) {
    r.avisos.push(`${nome}: não consegui ler a duração (ffprobe ausente), então só conferi o tamanho. ${regra.rotulo[0]!.toUpperCase()}${regra.rotulo.slice(1)} precisa ter ${textoDaDuracao(regra)}.`);
  } else if (segundos < regra.minS || segundos > regra.maxS) {
    r.erros.push(`${nome}: ${Math.round(segundos)} s; ${regra.rotulo} precisa ter ${textoDaDuracao(regra)}.`);
  }
  return r;
}

/** Capa do reels e imagem de story: JPEG pelos bytes e até 8 MB; a proporção só gera aviso (o Instagram corta ou põe barras). */
export function validarImagemSimples(b: Buffer, nome: string, opcoes: { proporcaoEsperada?: number } = {}): ResultadoMidia {
  const r: ResultadoMidia = { erros: [], avisos: [] };
  if (!ehJpeg(b)) {
    r.erros.push(
      `${nome}: o arquivo é ${descreverFormato(b)}, e a API do Instagram só aceita JPEG (conferi pelos bytes, não pela extensão). ` +
        "Converta antes, por exemplo: sips -s format jpeg entrada.png --out saida.jpg. Eu não converto sozinho, para não publicar algo diferente do que você viu.",
    );
    return r;
  }
  if (b.length > LIMITES.capaBytes) r.erros.push(`${nome}: ${formatarMB(b.length)}; o limite é ${formatarMB(LIMITES.capaBytes)}.`);
  const d = lerDimensoesJpeg(b);
  if (!d) {
    r.erros.push(`${nome}: não consegui ler as dimensões do JPEG (arquivo corrompido ou truncado).`);
    return r;
  }
  r.largura = d.largura;
  r.altura = d.altura;
  const esperada = opcoes.proporcaoEsperada;
  if (esperada !== undefined && Math.abs(d.largura / d.altura - esperada) / esperada > 0.05) {
    r.avisos.push(`${nome}: ${d.largura}×${d.altura} não é 9:16; o Instagram vai cortar ou colocar barras.`);
  }
  return r;
}

export interface ResultadoMidia {
  erros: string[];
  avisos: string[];
  largura?: number;
  altura?: number;
}

const formatarMB = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/** Imagem de post ou de item de carrossel: só JPEG, até 8 MB, proporção 4:5 a 1,91:1, largura 320 a 1.440 px. */
export function validarImagem(b: Buffer, nome: string): ResultadoMidia {
  const r: ResultadoMidia = { erros: [], avisos: [] };
  if (!ehJpeg(b)) {
    const formato = descreverFormato(b);
    r.erros.push(
      `${nome}: o arquivo é ${formato}, e a API do Instagram só aceita JPEG (conferi pelos bytes, não pela extensão). ` +
        "Converta antes, por exemplo: sips -s format jpeg entrada.png --out saida.jpg. Eu não converto sozinho, para não publicar algo diferente do que você viu.",
    );
    return r;
  }
  if (b.length > LIMITES.imagemBytes) r.erros.push(`${nome}: ${formatarMB(b.length)}; o limite é ${formatarMB(LIMITES.imagemBytes)}.`);
  const d = lerDimensoesJpeg(b);
  if (!d) {
    r.erros.push(`${nome}: não consegui ler as dimensões do JPEG (arquivo corrompido ou truncado).`);
    return r;
  }
  r.largura = d.largura;
  r.altura = d.altura;
  if (d.largura < LIMITES.larguraMin || d.largura > LIMITES.larguraMax) {
    r.erros.push(`${nome}: largura de ${d.largura} px; o Instagram aceita de ${LIMITES.larguraMin} a ${LIMITES.larguraMax.toLocaleString("pt-BR")} px.`);
  }
  const proporcao = d.largura / d.altura;
  if (proporcao < LIMITES.proporcaoMin - 1e-9 || proporcao > LIMITES.proporcaoMax + 1e-9) {
    r.erros.push(`${nome}: proporção ${d.largura}×${d.altura} (${proporcao.toFixed(2).replace(".", ",")}:1); o Instagram aceita de 4:5 (0,80) a 1,91:1.`);
  }
  return r;
}

export interface AnaliseDaLegenda {
  caracteres: number;
  hashtags: number;
  mencoes: number;
  /** Os primeiros ~125 caracteres, como o feed mostra antes do "… mais". */
  janela: string;
  cortada: boolean;
  erros: string[];
  avisos: string[];
}

const PADRAO_HASHTAG = /(?<![\p{L}\p{N}_&#])#[\p{L}\p{N}_]+/gu;
const PADRAO_MENCAO = /(?<![\p{L}\p{N}_.@])@[A-Za-z0-9._]{1,30}/gu;
const PADRAO_LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|ly|me|gl|tv|br|dev|link)\b(?:\/\S*)?/i;
const PEDIDOS_DE_ACAO: Array<[string, RegExp]> = [
  ["comentar", /\b(comente|comenta|comentem|comment)\b/i],
  ["curtir", /\b(curta|curte|curtam|like)\b/i],
  ["salvar", /\b(salve|salva|salvem|save)\b/i],
  ["compartilhar", /\b(compartilhe|compartilha|compartilhem|share|mande para|manda pra|envie para)\b/i],
  ["seguir", /\b(siga|segue|sigam|follow)\b/i],
  ["clicar", /\b(clique|clica|acesse|acessa|link na bio|link in bio|baixe|baixa)\b/i],
  ["marcar", /\b(marque|marca|marcar|tag a friend)\b/i],
  ["responder", /\b(responda|responde|me conta|conta pra mim|me diz)\b/i],
];

/** Confere a legenda (limites da API) e monta os avisos do cartão de prévia. */
export function analisarLegenda(legenda: string | undefined): AnaliseDaLegenda {
  const texto = legenda ?? "";
  const letras = [...texto];
  const hashtags = texto.match(PADRAO_HASHTAG)?.length ?? 0;
  const mencoes = texto.match(PADRAO_MENCAO)?.length ?? 0;
  const erros: string[] = [];
  const avisos: string[] = [];

  if (letras.length > LIMITES.legendaCaracteres) {
    erros.push(`Legenda com ${letras.length} caracteres; o limite é ${LIMITES.legendaCaracteres.toLocaleString("pt-BR")}.`);
  }
  if (hashtags > LIMITES.hashtagsMaximo) {
    erros.push(`Legenda com ${hashtags} hashtags; o limite da API é ${LIMITES.hashtagsMaximo}.`);
  }
  if (mencoes > LIMITES.mencoes) {
    erros.push(`Legenda com ${mencoes} menções; o limite é ${LIMITES.mencoes}.`);
  }
  if (hashtags > LIMITES.hashtagsDoApp && hashtags <= LIMITES.hashtagsMaximo) {
    avisos.push(
      `A legenda tem ${hashtags} hashtags. O Instagram limitou o app a ${LIMITES.hashtagsDoApp} por post em dezembro de 2025; a API aceitou 7 na nossa prova, mas o post pode alcançar menos ou ser tratado como excesso.`,
    );
  }
  if (PADRAO_LINK.test(texto)) avisos.push("A legenda tem link, e link na legenda não é clicável no Instagram (use o link da bio).");
  const pedidos = PEDIDOS_DE_ACAO.filter(([, padrao]) => padrao.test(texto)).map(([nome]) => nome);
  if (pedidos.length > 1) avisos.push(`A legenda faz mais de um pedido de ação (${pedidos.join(", ")}); um só costuma render mais.`);
  if (/^\s*\p{Extended_Pictographic}/u.test(texto)) avisos.push("A legenda começa com emoji: o primeiro caractere é o que o feed mostra primeiro; prefira abrir com texto.");

  const cortada = letras.length > LIMITES.janelaDoFeed;
  return {
    caracteres: letras.length,
    hashtags,
    mencoes,
    janela: cortada ? letras.slice(0, LIMITES.janelaDoFeed).join("") : texto,
    cortada,
    erros,
    avisos,
  };
}

/** Linha da prévia com a janela do feed. */
export function linhaDaJanelaDoFeed(a: AnaliseDaLegenda): string {
  const visivel = a.janela.replace(/\s*\n\s*/g, " ⏎ ");
  return `Janela do feed (~${LIMITES.janelaDoFeed} caracteres, antes do "… mais"): ${visivel}${a.cortada ? "… mais" : ""}`;
}

/** Nome de usuário sem o @ inicial; devolve null se não parecer um usuário do Instagram. */
export function normalizarUsuario(usuario: string): string | null {
  const limpo = usuario.trim().replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(limpo) ? limpo : null;
}
