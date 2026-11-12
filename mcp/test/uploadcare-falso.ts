// Uploadcare falso: servidor node:http em porta aleatória de 127.0.0.1.
// Entende `POST /base/` (multipart com UPLOADCARE_PUB_KEY, UPLOADCARE_STORE e file) e responde `{ file: <uuid> }`.
// Guarda cada envio (campos e bytes do arquivo) para os testes conferirem. Faz o papel da base do upload e do CDN.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { criarHospedagemUploadcare, type Hospedagem } from "../src/hospedagem.ts";
import { partesMultipart, type PedidoRegistrado } from "./graph-falsa.ts";

/** Chave pública de demonstração do Uploadcare: não é segredo, e o prefixo do CDN dela é conhecido (1s4oyld5dc). */
export const CHAVE_UPLOADCARE_TESTE = "demopublickey";
export const PREFIXO_DA_CHAVE_TESTE = "1s4oyld5dc";

export interface EnvioRegistrado {
  campos: Record<string, string>;
  arquivo: Buffer;
  nomeDoArquivo: string | null;
}

export class UploadcareFalso {
  readonly pedidos: PedidoRegistrado[] = [];
  readonly envios: EnvioRegistrado[] = [];
  /** Status forçado (ex.: 400 para chave inválida). */
  falha: { status: number; corpo: unknown } | null = null;
  #http: Server | null = null;
  #base = "";

  get base(): string {
    if (!this.#base) throw new Error("Uploadcare falso ainda não iniciou.");
    return this.#base;
  }

  async iniciar(): Promise<string> {
    this.#http = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on("data", (p: Buffer) => partes.push(p));
      req.on("end", () => {
        const corpoBruto = Buffer.concat(partes);
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const pedido: PedidoRegistrado = {
          metodo: req.method ?? "GET",
          versao: null,
          caminho: url.pathname,
          urlBruta: req.url ?? "/",
          query: Object.fromEntries(url.searchParams),
          cabecalhos: req.headers,
          corpo: corpoBruto.toString("utf8"),
          corpoBruto,
        };
        this.pedidos.push(pedido);
        const responder = (status: number, corpo: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(corpo));
        };
        if (this.falha) return responder(this.falha.status, this.falha.corpo);
        if (pedido.metodo !== "POST" || pedido.caminho !== "/base/") return responder(404, { error: "sem rota" });
        const campos: Record<string, string> = {};
        let arquivo: Buffer | null = null;
        let nomeDoArquivo: string | null = null;
        for (const parte of partesMultipart(pedido)) {
          if (parte.nome === "file") {
            arquivo = parte.conteudo;
            nomeDoArquivo = parte.nomeDoArquivo;
          } else campos[parte.nome] = parte.conteudo.toString("utf8");
        }
        if (!campos.UPLOADCARE_PUB_KEY || !arquivo) return responder(400, { error: "UPLOADCARE_PUB_KEY ou file ausente" });
        this.envios.push({ campos, arquivo, nomeDoArquivo });
        responder(200, { file: `uuid-falso-${this.envios.length}` });
      });
    });
    await new Promise<void>((ok) => this.#http!.listen(0, "127.0.0.1", ok));
    this.#base = `http://127.0.0.1:${(this.#http.address() as AddressInfo).port}`;
    return this.#base;
  }

  async parar(): Promise<void> {
    const http = this.#http;
    this.#http = null;
    if (!http) return;
    http.closeAllConnections();
    await new Promise<void>((ok) => http.close(() => ok()));
  }
}

/** Hospedagem do Uploadcare apontada para o falso (upload e CDN no mesmo servidor local). */
export function hospedagemDeTeste(falso: UploadcareFalso, chave: string = CHAVE_UPLOADCARE_TESTE): Hospedagem {
  return criarHospedagemUploadcare({ chave, uploadBase: falso.base, cdnBase: falso.base });
}
