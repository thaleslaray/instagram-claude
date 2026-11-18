// Tipos mínimos para o teste (test/lancamento.test.ts) importar a conferência, que é JavaScript.
export const NOME_DA_SKILL: string;
export const CAMINHO_PACOTE: string;
export const REGRAS: [string, (raiz: string, opcoes: { exigirPacote?: boolean }) => string[]][];
export function versaoDoPacote(raiz: string): string | null;
export function sha256Arquivo(caminho: string): string;
export function hashDoInstall(raiz: string): string | null;
export function conferirArvore(raiz: string, opcoes?: { exigirPacote?: boolean }): string[];
