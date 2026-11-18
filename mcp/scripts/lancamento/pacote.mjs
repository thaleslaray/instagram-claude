// Gera os arquivos da release que não saem do `npm run pack`: o .sha256 do .mcpb e o .skill.
// O .skill é um zip cuja raiz é a pasta instagram-app-meta/ com o conteúdo de skill/ (SKILL.md e
// references/), sem .DS_Store nem .gitignore. Usa o `zip` do sistema; sem dependência nova.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { arquivosDaSkill, CAMINHO_PACOTE, CAMINHO_SHA256, CAMINHO_SKILL_ZIP, NOME_DA_SKILL, NOME_PACOTE, sha256Arquivo } from "./conferencia.mjs";

/** Grava mcp/instagram-mcp.mcpb.sha256 com uma linha: "<sha256>  instagram-mcp.mcpb". */
export function gerarSha256(raiz) {
  const pacote = join(raiz, CAMINHO_PACOTE);
  if (!existsSync(pacote)) throw new Error(`${CAMINHO_PACOTE} não existe; rode npm run pack antes`);
  const hash = sha256Arquivo(pacote);
  writeFileSync(join(raiz, CAMINHO_SHA256), `${hash}  ${NOME_PACOTE}\n`);
  return hash;
}

/** Grava mcp/instagram-app-meta.skill a partir de skill/. Devolve a lista de arquivos empacotados. */
export function gerarSkill(raiz) {
  const origem = join(raiz, "skill");
  const arquivos = arquivosDaSkill(origem);
  if (!arquivos.includes("SKILL.md")) throw new Error("skill/SKILL.md não existe");
  const destino = join(raiz, CAMINHO_SKILL_ZIP);
  const area = mkdtempSync(join(tmpdir(), "skill-pacote-"));
  try {
    for (const arq of arquivos) {
      const para = join(area, NOME_DA_SKILL, arq);
      mkdirSync(dirname(para), { recursive: true });
      cpSync(join(origem, arq), para);
    }
    rmSync(destino, { force: true }); // o zip atualiza um arquivo existente em vez de recriar
    execFileSync("zip", ["-q", "-X", "-D", destino, ...arquivos.map((a) => `${NOME_DA_SKILL}/${a}`)], { cwd: area, stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    rmSync(area, { recursive: true, force: true });
  }
  return arquivos;
}

/** O .sha256 e o .skill, a partir do .mcpb já empacotado. */
export function gerarArquivosDaRelease(raiz) {
  const hash = gerarSha256(raiz);
  const arquivos = gerarSkill(raiz);
  return { hash, arquivos };
}
