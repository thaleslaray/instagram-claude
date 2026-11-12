// Graph falsa: servidor node:http em porta aleatória de 127.0.0.1.
// - rotas por método e caminho (o caminho é registrado SEM a versão: "/17841…/media");
// - modo roteiro: uma lista de respostas devolvidas em sequência (estados, erros);
// - registro de cada pedido: método, versão, caminho, query, cabeçalhos e corpo.

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface PedidoRegistrado {
  metodo: string;
  /** Versão da Graph tirada do caminho (ex.: "v27.0"), ou null se não veio. */
  versao: string | null;
  /** Caminho sem a versão (ex.: "/17841400000000123"). */
  caminho: string;
  /** Caminho e query exatamente como chegaram. */
  urlBruta: string;
  query: Record<string, string>;
  cabecalhos: IncomingHttpHeaders;
  corpo: string;
  /** O corpo como chegou, em bytes (upload de vídeo e multipart). */
  corpoBruto: Buffer;
}

/** Uma parte de um corpo multipart/form-data. */
export interface ParteMultipart {
  nome: string;
  nomeDoArquivo: string | null;
  tipo: string | null;
  conteudo: Buffer;
}

/** Lê um corpo multipart/form-data (o que `FormData` do Node envia). Devolve [] se o pedido não for multipart. */
export function partesMultipart(pedido: PedidoRegistrado): ParteMultipart[] {
  const tipo = String(pedido.cabecalhos["content-type"] ?? "");
  const limite = /^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(tipo);
  const marca = limite?.[1] ?? limite?.[2];
  if (!marca) return [];
  const separador = Buffer.from(`--${marca}`);
  const bruto = pedido.corpoBruto;
  const partes: ParteMultipart[] = [];
  let inicio = bruto.indexOf(separador);
  while (inicio !== -1) {
    const depois = inicio + separador.length;
    if (bruto.subarray(depois, depois + 2).toString() === "--") break;
    const proximo = bruto.indexOf(separador, depois);
    if (proximo === -1) break;
    const bloco = bruto.subarray(depois + 2, proximo - 2); // tira o CRLF antes e depois
    const fim = bloco.indexOf("\r\n\r\n");
    const cabecalho = bloco.subarray(0, fim).toString("utf8");
    const disposicao = /name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(cabecalho);
    partes.push({
      nome: disposicao?.[1] ?? "",
      nomeDoArquivo: disposicao?.[2] ?? null,
      tipo: /content-type:\s*([^\r\n]+)/i.exec(cabecalho)?.[1] ?? null,
      conteudo: bloco.subarray(fim + 4),
    });
    inicio = proximo;
  }
  return partes;
}

export interface RespostaFalsa {
  status?: number;
  corpo: unknown;
}

export type Gerador = (pedido: PedidoRegistrado) => RespostaFalsa;
type Rota = { tipo: "fixa"; resposta: RespostaFalsa | Gerador } | { tipo: "roteiro"; fila: Array<RespostaFalsa | Gerador> };

/** Corpo de erro no formato da Graph. */
export function erroMeta(code: number, mensagem: string, subcode?: number, tipo = "OAuthException"): RespostaFalsa {
  return {
    status: code === 190 ? 401 : 400,
    corpo: {
      error: {
        message: mensagem,
        type: tipo,
        code,
        ...(subcode !== undefined ? { error_subcode: subcode } : {}),
        fbtrace_id: `Afalso${code}${subcode ?? ""}`,
      },
    },
  };
}

export class GraphFalsa {
  readonly pedidos: PedidoRegistrado[] = [];
  #rotas = new Map<string, Rota>();
  #padrao: RespostaFalsa | Gerador | null = null;
  #http: Server | null = null;
  #base = "";

  get base(): string {
    if (!this.#base) throw new Error("Graph falsa ainda não iniciou.");
    return this.#base;
  }

  /** Resposta fixa (ou gerada a cada pedido) para método + caminho. */
  rota(metodo: string, caminho: string, resposta: RespostaFalsa | Gerador): this {
    this.#rotas.set(`${metodo.toUpperCase()} ${caminho}`, { tipo: "fixa", resposta });
    return this;
  }

  /** Respostas devolvidas em sequência; quando acabam, a Graph falsa responde 500. */
  roteiro(metodo: string, caminho: string, respostas: Array<RespostaFalsa | Gerador>): this {
    this.#rotas.set(`${metodo.toUpperCase()} ${caminho}`, { tipo: "roteiro", fila: [...respostas] });
    return this;
  }

  /** Resposta para qualquer método + caminho sem rota própria (testes que percorrem todas as ferramentas). */
  padrao(resposta: RespostaFalsa | Gerador | null): this {
    this.#padrao = resposta;
    return this;
  }

  limparPedidos(): void {
    this.pedidos.length = 0;
  }

  async iniciar(): Promise<string> {
    this.#http = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on("data", (parte: Buffer) => partes.push(parte));
      req.on("end", () => {
        const corpoBruto = Buffer.concat(partes);
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const casamento = /^\/(v\d+\.\d+)(\/.*)$/.exec(url.pathname);
        const pedido: PedidoRegistrado = {
          metodo: req.method ?? "GET",
          versao: casamento?.[1] ?? null,
          caminho: casamento?.[2] ?? url.pathname,
          urlBruta: req.url ?? "/",
          query: Object.fromEntries(url.searchParams),
          cabecalhos: req.headers,
          corpo: corpoBruto.toString("utf8"),
          corpoBruto,
        };
        this.pedidos.push(pedido);
        const resposta = this.#responder(pedido);
        res.writeHead(resposta.status ?? 200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(resposta.corpo));
      });
    });
    await new Promise<void>((pronto) => this.#http!.listen(0, "127.0.0.1", pronto));
    const { port } = this.#http.address() as AddressInfo;
    this.#base = `http://127.0.0.1:${port}`;
    return this.#base;
  }

  async parar(): Promise<void> {
    const http = this.#http;
    if (!http) return;
    http.closeAllConnections();
    await new Promise<void>((pronto) => http.close(() => pronto()));
    this.#http = null;
  }

  #responder(pedido: PedidoRegistrado): RespostaFalsa {
    const rota = this.#rotas.get(`${pedido.metodo} ${pedido.caminho}`);
    if (!rota && this.#padrao) return typeof this.#padrao === "function" ? this.#padrao(pedido) : this.#padrao;
    if (!rota) {
      return { status: 500, corpo: { error: { message: `Graph falsa: sem rota para ${pedido.metodo} ${pedido.caminho}`, code: -999 } } };
    }
    const item = rota.tipo === "fixa" ? rota.resposta : rota.fila.shift();
    if (item === undefined) {
      return { status: 500, corpo: { error: { message: `Graph falsa: roteiro de ${pedido.metodo} ${pedido.caminho} acabou`, code: -998 } } };
    }
    return typeof item === "function" ? item(pedido) : item;
  }
}

/**
 * Rotas do upload direto de vídeo: `POST /{ig}/media` devolve `{ id, uri }` quando o pedido é `upload_type=resumable`
 * (sem `uri` nos outros), e o `uri` aponta para o rupload da própria Graph falsa, que responde como a Meta
 * (`{"success":true,"message":"Upload Successful."}`). Os containers se chamam c1, c2...
 */
export function rotasDeContainer(graphFalsa: GraphFalsa, contaId: string, opcoes: { rupload?: RespostaFalsa | Gerador } = {}): void {
  let n = 0;
  graphFalsa.rota("POST", `/${contaId}/media`, (pedido) => {
    const id = `c${++n}`;
    const resumivel = (JSON.parse(pedido.corpo) as Record<string, unknown>).upload_type === "resumable";
    return { corpo: { id, ...(resumivel ? { uri: `${graphFalsa.base}/rupload/ig-api-upload/v27.0/${id}` } : {}) } };
  });
  for (const id of ["c1", "c2", "c3", "c4"]) {
    graphFalsa.rota("POST", `/rupload/ig-api-upload/v27.0/${id}`, opcoes.rupload ?? { corpo: { success: true, message: "Upload Successful." } });
  }
}

/** Dados de uma conta de teste no formato da Meta. */
export const CONTA_TESTE = {
  id: "17841400000000123",
  username: "conta_de_teste",
  name: "Autobot",
  followers_count: 2,
  follows_count: 5,
  media_count: 7,
  profile_picture_url: "https://scontent.cdninstagram.com/v/foto.jpg",
};

/** Token marcado só para testes (não tem formato de token real). */
export const TOKEN_TESTE = "token-de-teste-MARCADO-9f3a1c";
