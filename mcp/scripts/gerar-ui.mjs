// Gera src/ui-gerada.ts: a tela de confirmação (ui/confirmar.template.html + ui/confirmar.js com a
// biblioteca ext-apps embutida) como UMA string HTML, para o servidor entregá-la como resource ui://
// sem ler arquivos do disco (o build é um arquivo só). Roda antes de typecheck, test e build.

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAIDA = join(RAIZ, "src", "ui-gerada.ts");

const resultado = await build({
  entryPoints: [join(RAIZ, "ui", "confirmar.js")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  charset: "utf8",
});
const js = resultado.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const modelo = readFileSync(join(RAIZ, "ui", "confirmar.template.html"), "utf8");
if (!modelo.includes("__BIBLIOTECA_E_LOGICA__")) throw new Error("O modelo da tela perdeu o marcador __BIBLIOTECA_E_LOGICA__.");
if (!modelo.includes("__VERSAO__")) throw new Error("O modelo da tela perdeu o marcador __VERSAO__.");
// A versão (de package.json) aparece no rodapé do cartão: por um print dá para saber qual cartão o app carregou.
const versao = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).version;
const html = modelo.replace("__VERSAO__", () => versao).replace("__BIBLIOTECA_E_LOGICA__", () => js);
const conteudo = `// GERADO por scripts/gerar-ui.mjs (npm run gerar-ui). Não edite nem versione.\nexport const HTML_CONFIRMAR: string = ${JSON.stringify(html)};\n`;
mkdirSync(dirname(SAIDA), { recursive: true });
if (!existsSync(SAIDA) || readFileSync(SAIDA, "utf8") !== conteudo) writeFileSync(SAIDA, conteudo);
console.error(`gerar-ui: ${html.length} caracteres de HTML`);
