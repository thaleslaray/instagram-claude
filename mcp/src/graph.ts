// Cliente da Graph API da Meta.
// - Token SEMPRE no cabeçalho `Authorization: Bearer`, nunca na URL nem no corpo.
// - Todo caminho leva a versão configurada (padrão v27.0).
// - Paginação: lê só o cursor `after` e remonta a URL na versão do servidor;
//   o `paging.next` da Meta é ignorado (vem sempre em v27.0 e às vezes com parâmetros a mais).
// - Erros da Meta viram ErroGraph com frase em português (erros.ts).

import { ehBaseLocal, type Config } from "./config.ts";
import { CONTA_TOKEN, mensagemSemToken, type Cofre } from "./cofre.ts";
import { ErroGraph, traduzirErroMeta } from "./erros.ts";
import { limpar } from "./segredos.ts";

export type Parametros = Record<string, string | number | boolean | undefined>;
type FetchLike = (entrada: URL, init: RequestInit) => Promise<Response>;

export interface OpcoesGraph {
  config: Config;
  cofre: Cofre;
  /** Troca o fetch (testes). Padrão: o `fetch` global, lido na hora de cada pedido. */
  fetch?: FetchLike;
  /** Tempo máximo de cada pedido, em ms. Padrão 30 s. */
  tempoLimiteMs?: number;
}

export interface OpcoesPedido {
  signal?: AbortSignal;
}

export class TokenAusente extends Error {
  override name = "TokenAusente";
  constructor() {
    super(mensagemSemToken());
  }
}

/** Campos que a Meta já recusou em algumas configurações: o pedido é repetido sem eles. */
export const CAMPOS_OPCIONAIS = ["caption", "media_product_type", "name", "profile_picture_url"] as const;

export interface Pagina<T> {
  itens: T[];
  /** Cursor `after` da próxima página, ou null quando acabou. */
  proximo: string | null;
}

export interface ComAviso<T> {
  dados: T;
  /** Preenchido quando o pedido foi repetido sem algum campo opcional. */
  aviso: string | null;
  camposRemovidos: string[];
}

interface CorpoPaginado<T> {
  data?: T[];
  paging?: { cursors?: { after?: string; before?: string }; next?: string; previous?: string };
}

/** Lê só o cursor `after` da paginação da Meta, sem usar o `next`. */
export function cursorDepois(paging: CorpoPaginado<unknown>["paging"]): string | null {
  if (!paging?.next) return null;
  const doCursor = paging.cursors?.after;
  if (typeof doCursor === "string" && doCursor !== "") return doCursor;
  // Algumas bordas só mandam o `after` dentro do `next`: aproveita só esse parâmetro.
  try {
    return new URL(paging.next).searchParams.get("after");
  } catch {
    return null;
  }
}

/** Um vídeo de até 300 MB sobe em uma só chamada: o prazo é bem maior que o das outras. */
const TEMPO_DO_RUPLOAD_MS = 15 * 60_000;
/** Um anexo de DM tem até 25 MB: precisa de mais que os 30 s dos pedidos comuns. */
const TEMPO_DO_ANEXO_MS = 5 * 60_000;

export class ClienteGraph {
  readonly config: Config;
  #cofre: Cofre;
  #fetch: FetchLike;
  #tempoLimiteMs: number;

  constructor(opcoes: OpcoesGraph) {
    this.config = opcoes.config;
    this.#cofre = opcoes.cofre;
    this.#fetch = opcoes.fetch ?? ((entrada, init) => globalThis.fetch(entrada, init));
    this.#tempoLimiteMs = opcoes.tempoLimiteMs ?? 30_000;
  }

  /** URL completa de um caminho da Graph, sempre na versão configurada. Nunca leva o token. */
  url(caminho: string, params: Parametros = {}): URL {
    const limpo = caminho.replace(/^\/+/, "");
    const url = new URL(`${this.config.graphBase}/${this.config.graphVersao}/${limpo}`);
    for (const [chave, valor] of Object.entries(params)) {
      if (valor !== undefined) url.searchParams.set(chave, String(valor));
    }
    return url;
  }

  async get<T>(caminho: string, params: Parametros = {}, opcoes: OpcoesPedido = {}): Promise<T> {
    return this.#pedido<T>("GET", caminho, params, undefined, opcoes);
  }

  async post<T>(caminho: string, corpo?: Record<string, unknown>, params: Parametros = {}, opcoes: OpcoesPedido = {}): Promise<T> {
    return this.#pedido<T>("POST", caminho, params, corpo, opcoes);
  }

  /** POST multipart/form-data (anexo de DM). O `fetch` escolhe o Content-Type e o limite do formulário. */
  async postMultipart<T>(caminho: string, formulario: FormData, params: Parametros = {}, opcoes: OpcoesPedido = {}): Promise<T> {
    return this.#pedido<T>("POST", caminho, params, formulario, opcoes);
  }

  /**
   * Envia os bytes de um vídeo para o `uri` do rupload que a Meta devolveu ao criar o container (upload_type=resumable).
   * O token vai no cabeçalho `Authorization: OAuth` (o rupload não aceita Bearer), então o endereço é conferido ANTES:
   * em produção só https://rupload.facebook.com; nos testes (Graph em 127.0.0.1), a máquina local.
   */
  async enviarParaRupload(uri: string, bytes: Buffer, opcoes: OpcoesPedido = {}): Promise<void> {
    const alvo = this.#conferirRupload(uri);
    const token = await this.#cofre.ler(CONTA_TOKEN);
    if (!token) throw new TokenAusente();
    const tempo = AbortSignal.timeout(TEMPO_DO_RUPLOAD_MS);
    const init: RequestInit = {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(bytes.length), Accept: "application/json" },
      body: new Uint8Array(bytes),
      // O token nunca segue um redirecionamento para outro endereço.
      redirect: "error",
      signal: opcoes.signal ? AbortSignal.any([opcoes.signal, tempo]) : tempo,
    };
    let resposta: Response;
    try {
      resposta = await this.#fetch(alvo, init);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new Error(limpar(`Não consegui enviar o vídeo para a Meta (${alvo.host}): ${motivo}. Nada foi publicado; tente de novo (isso cria um container novo).`));
    }
    let sucesso = false;
    try {
      sucesso = resposta.ok && ((await resposta.json()) as { success?: unknown }).success === true;
    } catch {
      sucesso = false;
    }
    // O corpo de erro do rupload não é o da Graph (traz `debug_info`): não é repassado.
    if (!sucesso) {
      throw new Error(`A Meta não aceitou o envio do vídeo (HTTP ${resposta.status}). Nada foi publicado; tente de novo (isso cria um container novo).`);
    }
  }

  #conferirRupload(uri: string): URL {
    const recusa = () => new Error("A Meta devolveu um endereço de envio que não é dela. Não mandei o vídeo nem o token. Nada foi publicado.");
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw recusa();
    }
    if (url.username !== "" || url.password !== "") throw recusa();
    const daMeta = url.protocol === "https:" && url.hostname === "rupload.facebook.com" && url.port === "";
    const local = ehBaseLocal(this.config.graphBase) && url.protocol === "http:" && url.hostname === "127.0.0.1";
    if (!daMeta && !local) throw recusa();
    return url;
  }

  async delete<T>(caminho: string, params: Parametros = {}, opcoes: OpcoesPedido = {}): Promise<T> {
    return this.#pedido<T>("DELETE", caminho, params, undefined, opcoes);
  }

  /**
   * GET com rede de segurança: se a Meta recusar o pedido (código 100) e ele tiver
   * algum dos CAMPOS_OPCIONAIS em `fields`, repete uma vez sem eles e devolve um aviso.
   */
  async getComReserva<T>(caminho: string, campos: readonly string[], params: Parametros = {}, opcoes: OpcoesPedido = {}): Promise<ComAviso<T>> {
    try {
      const dados = await this.get<T>(caminho, { ...params, fields: campos.join(",") }, opcoes);
      return { dados, aviso: null, camposRemovidos: [] };
    } catch (erro) {
      const removiveis = campos.filter((campo) => (CAMPOS_OPCIONAIS as readonly string[]).includes(campo));
      const recusaDeCampo = erro instanceof ErroGraph && erro.code === 100 && erro.error_subcode !== 33;
      if (!recusaDeCampo || removiveis.length === 0) throw erro;
      const restantes = campos.filter((campo) => !removiveis.includes(campo));
      const dados = await this.get<T>(caminho, { ...params, fields: restantes.join(",") }, opcoes);
      return {
        dados,
        aviso: `A Meta recusou o pedido com os campos ${removiveis.join(", ")}; repeti sem eles. Esses dados ficaram de fora.`,
        camposRemovidos: removiveis,
      };
    }
  }

  /** Uma página de uma borda paginada (`data` + `paging`). O próximo cursor sai de `paging.cursors.after`. */
  async pagina<T>(caminho: string, params: Parametros, limite: number, depois: string | null = null, opcoes: OpcoesPedido = {}): Promise<Pagina<T>> {
    const corpo = await this.get<CorpoPaginado<T>>(caminho, { ...params, limit: limite, after: depois ?? undefined }, opcoes);
    return { itens: Array.isArray(corpo.data) ? corpo.data : [], proximo: cursorDepois(corpo.paging) };
  }

  /** Percorre páginas seguindo só o cursor `after`, até `maximo` itens. */
  async todas<T>(caminho: string, params: Parametros, porPagina: number, maximo: number, opcoes: OpcoesPedido = {}): Promise<Pagina<T>> {
    const itens: T[] = [];
    let depois: string | null = null;
    do {
      const pagina: Pagina<T> = await this.pagina<T>(caminho, params, Math.min(porPagina, maximo - itens.length), depois, opcoes);
      itens.push(...pagina.itens);
      depois = pagina.proximo;
      if (pagina.itens.length === 0) break;
    } while (depois !== null && itens.length < maximo);
    return { itens, proximo: depois };
  }

  async #pedido<T>(metodo: "GET" | "POST" | "DELETE", caminho: string, params: Parametros, corpo: Record<string, unknown> | FormData | undefined, opcoes: OpcoesPedido): Promise<T> {
    const token = await this.#cofre.ler(CONTA_TOKEN);
    if (!token) throw new TokenAusente();

    const url = this.url(caminho, params);
    const cabecalhos: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const init: RequestInit = { method: metodo, headers: cabecalhos };
    if (corpo instanceof FormData) {
      init.body = corpo;
    } else if (corpo !== undefined) {
      cabecalhos["Content-Type"] = "application/json";
      init.body = JSON.stringify(corpo);
    }
    const tempo = AbortSignal.timeout(corpo instanceof FormData ? Math.max(this.#tempoLimiteMs, TEMPO_DO_ANEXO_MS) : this.#tempoLimiteMs);
    init.signal = opcoes.signal ? AbortSignal.any([opcoes.signal, tempo]) : tempo;

    let resposta: Response;
    try {
      resposta = await this.#fetch(url, init);
    } catch (erro) {
      if (erro instanceof DOMException && erro.name === "TimeoutError") {
        throw new Error(`A Meta não respondeu em ${Math.round(this.#tempoLimiteMs / 1000)} s. Tente de novo em instantes.`);
      }
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new Error(limpar(`Não consegui falar com a Meta (${url.host}): ${motivo}`));
    }

    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = texto === "" ? {} : JSON.parse(texto);
    } catch {
      if (!resposta.ok) throw traduzirErroMeta(resposta.status, null);
      throw new Error(`A Meta devolveu uma resposta que não é JSON (HTTP ${resposta.status}).`);
    }
    if (!resposta.ok || (typeof json === "object" && json !== null && "error" in json)) {
      throw traduzirErroMeta(resposta.status, json);
    }
    return json as T;
  }
}
