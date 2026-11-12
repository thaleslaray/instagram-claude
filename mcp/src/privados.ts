// IDs de comentários que já receberam resposta no privado (a Meta só permite UMA por comentário, spec 4.3).
// Fica em ~/Library/Application Support/instagram-mcp/privados.json. O ID só é gravado depois do sucesso.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CAMINHO_PRIVADOS_PADRAO = join(homedir(), "Library", "Application Support", "instagram-mcp", "privados.json");

async function ler(caminho: string): Promise<Record<string, string>> {
  let texto: string;
  try {
    texto = await readFile(caminho, "utf8");
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Não consegui ler ${caminho}: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
  try {
    const json: unknown = JSON.parse(texto);
    if (typeof json === "object" && json !== null && !Array.isArray(json)) return json as Record<string, string>;
  } catch {
    // cai no erro abaixo
  }
  // Ignorar um arquivo estragado deixaria repetir uma resposta privada: melhor parar e avisar.
  throw new Error(`O arquivo ${caminho} está ilegível. Conserte ou apague-o antes de responder no privado.`);
}

export async function jaRespondidoNoPrivado(caminho: string, comentarioId: string): Promise<boolean> {
  return Object.hasOwn(await ler(caminho), comentarioId);
}

export async function gravarRespondidoNoPrivado(caminho: string, comentarioId: string, quando: Date = new Date()): Promise<void> {
  const atuais = await ler(caminho);
  atuais[comentarioId] = quando.toISOString();
  await mkdir(dirname(caminho), { recursive: true, mode: 0o700 });
  const temporario = `${caminho}.tmp`;
  await writeFile(temporario, `${JSON.stringify(atuais, null, 2)}\n`, { mode: 0o600 });
  await rename(temporario, caminho);
}
