// Execução de comandos do sistema (security, pbpaste, pbcopy), sempre por `execFile`:
// sem shell, argumentos em lista. O que deve ficar fora da lista de processos
// (o valor de um segredo) segue pela ENTRADA PADRÃO, no parâmetro `entrada`.
// Todo código que roda comando recebe um `Executor`, para os testes trocarem por um falso.

import { execFile } from "node:child_process";

export interface ResultadoComando {
  /** Código de saída do comando. */
  codigo: number;
  stdout: string;
  stderr: string;
}

/** `tempoLimiteMs` troca o limite padrão (a janela de confirmação espera até 120 s). */
export type Executor = (comando: string, args: readonly string[], entrada?: string, tempoLimiteMs?: number) => Promise<ResultadoComando>;

/** Tempo máximo de um comando do sistema (o Keychain pode abrir um pedido de senha). */
const TEMPO_LIMITE_MS = 30_000;

/**
 * Executor de verdade. Código de saída diferente de zero NÃO é exceção (o chamador decide);
 * comando que não existe ou estoura o tempo é exceção, com mensagem sem argumentos.
 */
export const executarReal: Executor = (comando, args, entrada, tempoLimiteMs = TEMPO_LIMITE_MS) =>
  new Promise((resolver, rejeitar) => {
    const filho = execFile(comando, [...args], { encoding: "utf8", timeout: tempoLimiteMs, maxBuffer: 1024 * 1024 }, (erro, stdout, stderr) => {
      if (erro === null) return resolver({ codigo: 0, stdout, stderr });
      const codigo = (erro as NodeJS.ErrnoException).code;
      if (typeof codigo === "number") return resolver({ codigo, stdout, stderr });
      if (filho.killed) return rejeitar(new Error(`O comando ${comando} não terminou em ${tempoLimiteMs / 1000} s.`));
      rejeitar(new Error(`Não consegui rodar o comando ${comando} (${String(codigo ?? "erro desconhecido")}).`));
    });
    // Um comando que fecha a entrada antes de ler (EPIPE) não pode derrubar o processo.
    filho.stdin?.on("error", () => {});
    filho.stdin?.end(entrada ?? "");
  });
