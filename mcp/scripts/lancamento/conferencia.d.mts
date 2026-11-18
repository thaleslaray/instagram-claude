// Tipos mínimos para o teste (test/lancamento.test.ts) importar a conferência, que é JavaScript.
export const NOME_DA_SKILL: string;
export const NOME_PACOTE: string;
export const NOME_SHA256: string;
export const NOME_SKILL_ZIP: string;
export const CAMINHO_PACOTE: string;
export const CAMINHO_SHA256: string;
export const CAMINHO_SKILL_ZIP: string;
export const ARQUIVOS_DA_RELEASE: string[];
export const IGNORADOS_NA_SKILL: string[];
export const REGRAS: [string, (raiz: string, opcoes: { exigirPacote?: boolean }) => string[]][];
export function versaoDoPacote(raiz: string): string | null;
export function sha256Arquivo(caminho: string): string;
export function arquivosDaSkill(pasta: string): string[];
export function conferirSkillEmpacotada(zip: string, pastaSkill: string, rotulo?: string): string[];
export function conferirArvore(raiz: string, opcoes?: { exigirPacote?: boolean }): string[];
