// Carregado antes de todo teste (`node --import ./test/setup.ts --test`).
// Troca o fetch global por um que FALHA para qualquer host que não seja 127.0.0.1:
// nenhum teste pode chamar a Meta (nem o R2) de verdade.

const fetchOriginal = globalThis.fetch;

export class RedeBloqueada extends Error {
  override name = "RedeBloqueada";
}

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
  if (url.hostname !== "127.0.0.1") {
    throw new RedeBloqueada(`Teste tentou sair para ${url.host}: só 127.0.0.1 é permitido.`);
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;
