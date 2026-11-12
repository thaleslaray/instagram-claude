// Sistema falso: faz o papel de `security`, `pbpaste` e `pbcopy` na memória.
// Registra cada chamada (comando, argumentos e entrada padrão) para os testes conferirem
// que o valor de um segredo NUNCA vai em argumento.

import type { Executor, ResultadoComando } from "../src/sistema.ts";

export interface Chamada {
  comando: string;
  args: readonly string[];
  entrada: string | undefined;
}

export class SistemaFalso {
  /** O que há na área de transferência. */
  area = "";
  /** Itens do Keychain falso, chave "servico/conta". */
  readonly keychain = new Map<string, string>();
  readonly chamadas: Chamada[] = [];
  /** Faz o `security -i` falhar, com esta saída de erro (que pode ecoar o comando). */
  falhaAoGravar: { codigo: number; stderr: string } | null = null;
  /** Faz a leitura de volta devolver outro valor. */
  leituraDiferente: string | null = null;
  /** Faz o pbcopy falhar. */
  pbcopyFalha = false;

  readonly executar: Executor = async (comando, args, entrada) => {
    this.chamadas.push({ comando, args: [...args], entrada });
    const vazio = (codigo = 0, stderr = ""): ResultadoComando => ({ codigo, stdout: "", stderr });
    if (comando === "pbpaste") return { codigo: 0, stdout: `${this.area}\n`, stderr: "" };
    if (comando === "pbcopy") {
      if (this.pbcopyFalha) return vazio(1);
      this.area = entrada ?? "";
      return vazio();
    }
    if (comando === "security" && args[0] === "-i") {
      if (this.falhaAoGravar) return vazio(this.falhaAoGravar.codigo, this.falhaAoGravar.stderr);
      const m = /^add-generic-password -U -s (\S+) -a (\S+) -w "([^"]*)"\n$/.exec(entrada ?? "");
      if (!m) return vazio(1, "comando desconhecido");
      this.keychain.set(`${m[1]}/${m[2]}`, m[3]!);
      return vazio();
    }
    if (comando === "security" && args[0] === "find-generic-password") {
      const servico = args[args.indexOf("-s") + 1];
      const conta = args[args.indexOf("-a") + 1];
      const valor = this.keychain.get(`${servico}/${conta}`);
      if (valor === undefined) return vazio(44, "The specified item could not be found in the keychain.");
      return { codigo: 0, stdout: `${this.leituraDiferente ?? valor}\n`, stderr: "" };
    }
    return vazio(127, `comando inesperado: ${comando}`);
  };

  /** Todo texto que apareceu em argumentos de comando (para provar que o segredo não está lá). */
  get todosOsArgumentos(): string {
    return this.chamadas.map((c) => [c.comando, ...c.args].join(" ")).join("\n");
  }
}
