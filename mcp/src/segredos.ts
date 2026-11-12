// Limpeza de segredos (spec 5.2). Troca por marcas:
// - todo valor registrado (o token) e a forma dele codificada em URL;
// - qualquer coisa com cara de token da Meta (`EAA` + 20 ou mais letras/números);
// Passa por aqui tudo que sai do processo: erro devolvido à ferramenta, linha de log no stderr
// e registro de ações.

export const MARCA_SEGREDO = "‹segredo›";

const PADRAO_TOKEN_META = /EAA[A-Za-z0-9]{20,}/g;
const conhecidos = new Set<string>();

/** Registra um valor secreto carregado na memória do processo, para que `limpar` o apague. */
export function registrar(valor: string | null | undefined): void {
  if (valor && valor.length >= 8) conhecidos.add(valor);
}

/** Só para testes: esquece os segredos registrados. */
export function esquecerSegredos(): void {
  conhecidos.clear();
}

export function limpar(texto: string): string {
  let saida = texto;
  // Os mais longos primeiro: um segredo que contém outro não deixa sobra.
  const formas = new Set<string>();
  for (const valor of conhecidos) {
    formas.add(valor);
    formas.add(encodeURIComponent(valor));
  }
  for (const valor of [...formas].sort((a, b) => b.length - a.length)) saida = saida.split(valor).join(MARCA_SEGREDO);
  return saida.replace(PADRAO_TOKEN_META, MARCA_SEGREDO);
}

/** Limpa todo texto dentro de objetos, listas e textos soltos (para o registro de ações). */
export function limparProfundo<T>(valor: T): T {
  if (typeof valor === "string") return limpar(valor) as T;
  if (Array.isArray(valor)) return valor.map((item) => limparProfundo(item)) as T;
  if (typeof valor === "object" && valor !== null) {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [limpar(chave), limparProfundo(item)])) as T;
  }
  return valor;
}

/** Linha JSON de um evento, já limpa. É o que o registro de ações das fichas seguintes deve gravar. */
export function linhaDeRegistro(evento: Record<string, unknown>): string {
  return JSON.stringify(limparProfundo(evento));
}
