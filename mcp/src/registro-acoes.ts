// Registro local de ações (spec decisão 11): uma linha JSON por evento em
// ~/Library/Logs/instagram-mcp/acoes.jsonl. Tudo passa por `linhaDeRegistro` (limpeza de segredos).
// O código de confirmação NUNCA entra: só os 4 primeiros caracteres (`codigo4`).
// Se o registro falhar, a escrita já autorizada não falha: o aviso vai para o stderr.

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { log } from "./log.ts";
import { linhaDeRegistro } from "./segredos.ts";

export const CAMINHO_REGISTRO_PADRAO = join(homedir(), "Library", "Logs", "instagram-mcp", "acoes.jsonl");

export class RegistroAcoes {
  readonly caminho: string;
  readonly #avisar: (linha: string) => void;

  constructor(caminho: string = CAMINHO_REGISTRO_PADRAO, avisar: (linha: string) => void = log) {
    this.caminho = caminho;
    this.#avisar = avisar;
  }

  async gravar(evento: Record<string, unknown>): Promise<void> {
    try {
      await mkdir(dirname(this.caminho), { recursive: true, mode: 0o700 });
      await appendFile(this.caminho, `${linhaDeRegistro({ quando: new Date().toISOString(), ...evento })}\n`, { mode: 0o600 });
    } catch (erro) {
      this.#avisar(`[instagram-mcp] não consegui gravar o registro de ações: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
}
