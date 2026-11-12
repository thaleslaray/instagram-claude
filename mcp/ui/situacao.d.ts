export const INTERVALO_ENVIANDO_MS: number;
export const LIMITE_ENVIANDO_MS: number;
export const MAX_FALHAS_SEGUIDAS_ENVIANDO: number;
export function linkDoResultado(r: unknown): string;
export function estadoDoPedido(r: unknown): string | null;
export interface PlanoDaSituacao {
  acao: "nada" | "travar" | "enviando" | "enviado";
  mensagem: string;
  tipo: "" | "ok" | "erro";
  link: string;
  trabalhoId: string;
}
export function planoDaSituacao(r: unknown): PlanoDaSituacao;
export interface OpcoesDeEspera {
  consultar: () => Promise<unknown>;
  esperar: (ms: number) => Promise<void>;
  agora: () => number;
  cancelado?: () => boolean;
}
export function aguardarEnvio(o: OpcoesDeEspera): Promise<unknown | null>;
