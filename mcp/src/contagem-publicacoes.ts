// Contagem local das publicações das últimas 24 h (spec 4.4, passo 2; diário P19).
// A cota da Meta (`quota_usage`) NÃO sobe logo depois de publicar, então ela sozinha não impede o 101º post.
// O servidor guarda o horário de cada publicação num arquivo e usa o MAIOR dos dois números.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { log } from "./log.ts";

export const CAMINHO_PUBLICACOES_PADRAO = join(homedir(), "Library", "Application Support", "instagram-mcp", "publicacoes.json");
export const JANELA_DA_COTA_MS = 24 * 3_600_000;

export class ContagemPublicacoes {
  readonly caminho: string;
  readonly #agora: () => number;
  #fila: Promise<unknown> = Promise.resolve();

  constructor(caminho: string = CAMINHO_PUBLICACOES_PADRAO, agora: () => number = Date.now) {
    this.caminho = caminho;
    this.#agora = agora;
  }

  async #ler(): Promise<number[]> {
    let texto: string;
    try {
      texto = await readFile(this.caminho, "utf8");
    } catch {
      return []; // ainda não existe
    }
    try {
      const dados = JSON.parse(texto) as { publicacoes?: unknown };
      return Array.isArray(dados.publicacoes) ? dados.publicacoes.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
    } catch {
      log(`[instagram-mcp] ${this.caminho} está corrompido; contei zero publicações locais.`);
      return [];
    }
  }

  /** Quantas publicações nas últimas 24 h. */
  async contar(): Promise<number> {
    const limite = this.#agora() - JANELA_DA_COTA_MS;
    return (await this.#ler()).filter((quando) => quando > limite).length;
  }

  /** Anota uma publicação feita agora. Falha de gravação vira só aviso: o post já saiu. */
  registrar(): Promise<void> {
    const gravar = async (): Promise<void> => {
      try {
        const limite = this.#agora() - JANELA_DA_COTA_MS;
        const atuais = (await this.#ler()).filter((quando) => quando > limite);
        atuais.push(this.#agora());
        await mkdir(dirname(this.caminho), { recursive: true, mode: 0o700 });
        const provisorio = `${this.caminho}.tmp`;
        await writeFile(provisorio, JSON.stringify({ publicacoes: atuais }), { mode: 0o600 });
        await rename(provisorio, this.caminho);
      } catch (erro) {
        log(`[instagram-mcp] não consegui gravar a contagem local de publicações: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    };
    // Duas publicações ao mesmo tempo não pisam uma na outra.
    const proxima = this.#fila.then(gravar, gravar);
    this.#fila = proxima;
    return proxima;
  }
}
