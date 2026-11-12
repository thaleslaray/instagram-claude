export const INTERVALO_MS: number;
export const LIMITE_MS: number;
export const MAX_FALHAS_SEGUIDAS: number;
export function fraseDoPasso(estado: string): string;
export function extrairTrabalho(r: unknown): { trabalhoId: string } | null;
export function diagnosticarSemTrabalho(r: unknown): { trabalhoId: string; motivo: string } | null;
export interface OpcoesDeAcompanhamento {
  trabalhoId: string;
  pedidoId: string;
  consultar: () => Promise<unknown>;
  mostrar: (texto: string, tipo: "" | "ok" | "erro") => void;
  esperar: (ms: number) => Promise<void>;
  agora: () => number;
}
export function acompanhar(o: OpcoesDeAcompanhamento): Promise<{ fim: "publicado" | "falhou" | "tempo" | "sem_consulta"; permalink: string }>;
