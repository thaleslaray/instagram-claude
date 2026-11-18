// Gera os três arquivos de uma release em mcp/: o .mcpb (npm run pack, feito antes por quem
// chama), o .sha256 e o .skill.
//
// Rodar: npm run pacote-da-release   (roda o npm run pack e depois este script)

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVOS_DA_RELEASE } from "./lancamento/conferencia.mjs";
import { gerarArquivosDaRelease } from "./lancamento/pacote.mjs";

const RAIZ = resolve(join(dirname(fileURLToPath(import.meta.url)), "../.."));
const { hash, arquivos } = gerarArquivosDaRelease(RAIZ);
console.log(`SHA-256 do .mcpb: ${hash}`);
console.log(`Skill empacotada: ${arquivos.length} arquivos`);
console.log(`Arquivos da release:\n${ARQUIVOS_DA_RELEASE.map((a) => `  ${a}`).join("\n")}`);
