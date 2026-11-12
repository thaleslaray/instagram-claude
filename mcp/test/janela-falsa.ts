// Executor falso da janela do macOS: registra o que seria passado ao osascript e responde o que o teste mandar.

import type { Executor, ResultadoComando } from "../src/sistema.ts";

export type ComportamentoDaJanela = "aceita" | "cancela" | "tempo" | "erro" | "excecao";

export class JanelaFalsa {
  comportamento: ComportamentoDaJanela = "aceita";
  readonly chamadas: Array<{ comando: string; args: readonly string[]; entrada: string | undefined; tempoLimiteMs: number | undefined }> = [];

  readonly executar: Executor = async (comando, args, entrada, tempoLimiteMs) => {
    this.chamadas.push({ comando, args: [...args], entrada, tempoLimiteMs });
    if (this.comportamento === "excecao") throw new Error("Não consegui rodar o comando osascript (ENOENT).");
    const botao = args[args.length - 1] ?? "";
    const r = (codigo: number, stdout = "", stderr = ""): ResultadoComando => ({ codigo, stdout, stderr });
    switch (this.comportamento) {
      case "aceita": return r(0, `${botao}\n`);
      case "cancela": return r(1, "", "execution error: User canceled. (-128)");
      case "tempo": return r(0, "TEMPO_ESGOTADO\n");
      default: return r(1, "", "execution error: Application isn't running. (-600)");
    }
  };
}
