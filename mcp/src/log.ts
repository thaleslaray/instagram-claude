// Logger único do servidor. stdout é do protocolo MCP: tudo vai para stderr, sempre limpo de segredos.

import { limpar } from "./segredos.ts";

type Saida = (linha: string) => void;

let saida: Saida = (linha) => {
  process.stderr.write(`${linha}\n`);
};

export function log(linha: string): void {
  saida(limpar(linha));
}

/** Só para testes: captura as linhas. Devolve a função que restaura a saída original. */
export function trocarSaidaDoLog(nova: Saida): () => void {
  const anterior = saida;
  saida = nova;
  return () => {
    saida = anterior;
  };
}
