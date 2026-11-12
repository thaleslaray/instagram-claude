export type Unidade = "bytes" | "caracteres";
export function medir(texto: string, unidade: Unidade): number;
export function rotuloDoContador(texto: string, limite: number, unidade: Unidade): string;
export function podeEnviar(texto: string, limite: number, unidade: Unidade): boolean;
export function codigoEditado(codigo: string, texto: string): string;
export function mensagemDeConfirmacao(id: string, codigo: string, texto: string | null): string;
export interface AlvoETerceiros {
  alvo?: string;
  conteudo_de_terceiros?: Record<string, unknown>;
}
export function destinatario(sc: AlvoETerceiros): string;
export function terceirosParaMostrar(sc: AlvoETerceiros): Array<[string, unknown]>;
export function detalhesDoCartao(sc: { detalhes?: unknown; [campo: string]: unknown }): string[];
export function separarDetalhes(linhas: string[]): { aVista: string[]; recolhidas: string[] };
