// Espaçador de chamadas: a Conversations API aceita até 2 chamadas por segundo,
// então o servidor espera 500 ms entre uma chamada de conversa e a seguinte.
// O relógio e a espera são trocáveis para os testes usarem um relógio falso.

export const INTERVALO_CONVERSAS_MS = 500;

export interface OpcoesEspacador {
  /** Intervalo mínimo entre o início de duas chamadas. Padrão 500 ms. */
  intervaloMs?: number;
  /** Relógio em ms. Padrão `Date.now`. */
  agora?: () => number;
  /** Espera `ms`. Padrão: `setTimeout`, que respeita o `signal`. */
  dormir?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface Espacador {
  /** Resolve quando já passou o intervalo desde a chamada anterior. As chamadas entram em fila. */
  esperar(signal?: AbortSignal): Promise<void>;
}

function dormirDeVerdade(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    if (signal?.aborted) return rejeitar(signal.reason);
    const fim = () => {
      signal?.removeEventListener("abort", aoAbortar);
      resolver();
    };
    const tempo = setTimeout(fim, ms);
    const aoAbortar = () => {
      clearTimeout(tempo);
      rejeitar(signal!.reason);
    };
    signal?.addEventListener("abort", aoAbortar, { once: true });
  });
}

export function criarEspacador(opcoes: OpcoesEspacador = {}): Espacador {
  const intervalo = opcoes.intervaloMs ?? INTERVALO_CONVERSAS_MS;
  const agora = opcoes.agora ?? Date.now;
  const dormir = opcoes.dormir ?? dormirDeVerdade;
  let fila: Promise<void> = Promise.resolve();
  let liberaEm = Number.NEGATIVE_INFINITY;
  return {
    esperar(signal) {
      const vez = fila.then(async () => {
        const falta = liberaEm - agora();
        if (falta > 0) await dormir(falta, signal);
        liberaEm = agora() + intervalo;
      });
      fila = vez.catch(() => undefined);
      return vez;
    },
  };
}
