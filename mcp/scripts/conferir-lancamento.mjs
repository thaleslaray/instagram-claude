// Confere se a árvore está pronta para virar uma versão: versão única, INSTALL e README sem
// versão e baixando da última release, skill certa, etapas coerentes e pacote da release
// (.mcpb, .sha256 e .skill).
//
// Rodar: npm run conferir-lancamento [-- --raiz <pasta>] [--exigir-pacote]
// Sai com 1 se achar qualquer problema.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REGRAS } from "./lancamento/conferencia.mjs";

const RAIZ_DO_REPO = resolve(join(dirname(fileURLToPath(import.meta.url)), "../.."));

function lerOpcoes(argv) {
  const opcoes = { raiz: RAIZ_DO_REPO, exigirPacote: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--exigir-pacote") opcoes.exigirPacote = true;
    else if (argv[i] === "--raiz") {
      if (!argv[i + 1]) throw new Error("--raiz precisa de uma pasta");
      opcoes.raiz = resolve(argv[++i]);
    } else throw new Error(`opção desconhecida: ${argv[i]}`);
  }
  return opcoes;
}

let opcoes;
try {
  opcoes = lerOpcoes(process.argv.slice(2));
} catch (erro) {
  console.error(`Conferência: ${erro.message}`);
  console.error("Uso: npm run conferir-lancamento [-- --raiz <pasta>] [--exigir-pacote]");
  process.exit(2);
}

let total = 0;
for (const [nome, regra] of REGRAS) {
  const problemas = regra(opcoes.raiz, { exigirPacote: opcoes.exigirPacote });
  if (problemas.length === 0) console.log(`ok  ${nome}`);
  else {
    console.log(`ERRO  ${nome}`);
    for (const problema of problemas) console.log(`  - ${problema}`);
  }
  total += problemas.length;
}
if (total > 0) {
  console.error(`\nConferência: ${total} problema(s). Corrija antes de lançar.`);
  process.exit(1);
}
console.log("\nConferência: tudo certo.");
