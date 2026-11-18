// Conferência de lançamento: função pura que olha uma árvore (o repositório ou um tarball
// extraído da tag) e devolve a lista de problemas. Não toca rede nem git.
//
// A tag é o que o instalador baixa e ela não se move. Por isso tudo o que dá para errar
// (versão torta, skill errada, contagem de etapas, hash do .mcpb) é conferido ANTES dela.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const NOME_DA_SKILL = "instagram-app-meta";
export const CAMINHO_PACOTE = "mcp/instagram-mcp.mcpb";
const SEMVER = /^\d+\.\d+\.\d+$/;
// x.y.z solto no texto. O `@` na frente é fixação de pacote (mcpb@2.1.2), não versão do projeto.
const VERSAO_NO_TEXTO = /(?<![\w.@])v?(\d+\.\d+\.\d+)(?!\w|\.\d)/g;

const ler = (raiz, caminho) => readFileSync(join(raiz, caminho), "utf8");
const existe = (raiz, caminho) => existsSync(join(raiz, caminho));

function linhaDe(texto, indice) {
  return texto.slice(0, indice).split("\n").length;
}

/** Lê um JSON; devolve [objeto, null] ou [null, problema]. */
function lerJson(raiz, caminho) {
  if (!existe(raiz, caminho)) return [null, `${caminho}: arquivo não existe`];
  try {
    return [JSON.parse(ler(raiz, caminho)), null];
  } catch (erro) {
    return [null, `${caminho}: JSON inválido (${erro.message})`];
  }
}

/** Lê todos os arquivos de texto de uma pasta, recursivamente. Devolve caminhos relativos à raiz. */
function arquivosDe(raiz, pasta) {
  const saida = [];
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const completo = join(dir, nome);
      if (statSync(completo).isDirectory()) andar(completo);
      else saida.push(relative(raiz, completo));
    }
  };
  if (existe(raiz, pasta)) andar(join(raiz, pasta));
  return saida;
}

// ---------------------------------------------------------------------------------------------
// Versão

/** A versão de referência: a do mcp/package.json (ou null se não der para ler). */
export function versaoDoPacote(raiz) {
  const [pacote] = lerJson(raiz, "mcp/package.json");
  return pacote?.version ?? null;
}

/** Cada item: onde a versão mora e como ler. Devolve a versão achada (ou null) e um problema opcional. */
function leitoresDeVersao(raiz) {
  const json = (caminho, pegar) => () => {
    const [obj, problema] = lerJson(raiz, caminho);
    return problema ? { problema } : { versao: pegar(obj) };
  };
  const regex = (caminho, re, rotulo) => () => {
    if (!existe(raiz, caminho)) return { problema: `${caminho}: arquivo não existe` };
    const achou = ler(raiz, caminho).match(re);
    return achou ? { versao: achou[1] } : { problema: `${caminho}: não achei ${rotulo}` };
  };
  return [
    ["mcp/package.json", json("mcp/package.json", (o) => o.version)],
    ["mcp/package-lock.json (versão do arquivo)", json("mcp/package-lock.json", (o) => o.version)],
    ["mcp/package-lock.json (packages[\"\"])", json("mcp/package-lock.json", (o) => o.packages?.[""]?.version)],
    ["mcp/mcpb/manifest.json", json("mcp/mcpb/manifest.json", (o) => o.version)],
    ["mcp/src/versao.ts (VERSAO_SERVIDOR)", regex("mcp/src/versao.ts", /VERSAO_SERVIDOR\s*=\s*"([^"]+)"/, "VERSAO_SERVIDOR")],
    ["mcp/test/manifest.test.ts", regex("mcp/test/manifest.test.ts", /manifesto\.version,\s*"([^"]+)"/, 'assert.equal(manifesto.version, "X.Y.Z")')],
  ];
}

export function conferirVersaoUnica(raiz) {
  const problemas = [];
  const achadas = [];
  for (const [rotulo, ler1] of leitoresDeVersao(raiz)) {
    const { versao, problema } = ler1();
    if (problema) problemas.push(problema);
    else if (typeof versao !== "string" || !SEMVER.test(versao)) problemas.push(`${rotulo}: versão ilegível (${JSON.stringify(versao)}), esperava X.Y.Z`);
    else achadas.push([rotulo, versao]);
  }
  const referencia = achadas.find(([rotulo]) => rotulo === "mcp/package.json")?.[1] ?? achadas[0]?.[1];
  for (const [rotulo, versao] of achadas) {
    if (versao !== referencia) problemas.push(`${rotulo}: versão ${versao}, esperava ${referencia} (a do mcp/package.json)`);
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------
// INSTALL e README presos à versão

export function conferirTextosPresosAVersao(raiz) {
  const problemas = [];
  const versao = versaoDoPacote(raiz);
  if (!versao || !SEMVER.test(versao)) return ["mcp/package.json: sem versão válida; não dá para conferir INSTALL e README"];

  for (const arquivo of ["INSTALL.md", "README.md"]) {
    if (!existe(raiz, arquivo)) {
      problemas.push(`${arquivo}: arquivo não existe`);
      continue;
    }
    const texto = ler(raiz, arquivo);
    for (const achou of texto.matchAll(VERSAO_NO_TEXTO)) {
      if (achou[1] !== versao) {
        problemas.push(`${arquivo}, linha ${linhaDe(texto, achou.index)}: versão ${achou[0]}, esperava v${versao}`);
      }
    }
  }

  // Cada lugar onde a versão tem de aparecer, com a forma exata (com ou sem "v").
  const exigidos = {
    "INSTALL.md": [
      [`texto "vale para a versão"`, new RegExp(`vale para a versão \\*\\*v${esc(versao)}\\*\\*`)],
      ["URL blob/", new RegExp(`/blob/v${esc(versao)}/`)],
      ["URL archive/refs/tags/", new RegExp(`/archive/refs/tags/v${esc(versao)}\\.tar\\.gz`)],
      ["URL releases/download/", new RegExp(`/releases/download/v${esc(versao)}/instagram-mcp\\.mcpb`)],
      ["pasta instagram-claude-X.Y.Z/skill", new RegExp(`instagram-claude-${esc(versao)}/skill`)],
    ],
    "README.md": [["URL do INSTALL.md", new RegExp(`instagram-claude/v${esc(versao)}/INSTALL\\.md`)]],
  };
  for (const [arquivo, regras] of Object.entries(exigidos)) {
    if (!existe(raiz, arquivo)) continue;
    const texto = ler(raiz, arquivo);
    for (const [rotulo, re] of regras) {
      if (!re.test(texto)) problemas.push(`${arquivo}: não achei ${rotulo} com a versão v${versao}`);
    }
  }
  return problemas;
}

const esc = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------------------------
// Skill certa

export function conferirSkillCerta(raiz) {
  const problemas = [];
  if (!existe(raiz, "skill/SKILL.md")) return ["skill/SKILL.md: arquivo não existe"];
  const skill = ler(raiz, "skill/SKILL.md");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  const nome = frontmatter?.[1].match(/^name:\s*(.+?)\s*$/m)?.[1];
  if (nome !== NOME_DA_SKILL) {
    problemas.push(`skill/SKILL.md: frontmatter com name: ${nome ?? "(ausente)"}, esperava name: ${NOME_DA_SKILL}`);
  }
  const alvos = [...arquivosDe(raiz, "skill"), "README.md", "INSTALL.md"].filter((c) => existe(raiz, c));
  for (const caminho of alvos) {
    const achou = ler(raiz, caminho).match(/manycraft/i);
    if (achou) problemas.push(`${caminho}: contém "${achou[0]}", esperava nenhuma menção ao ManyCraft (a skill dele mora no repositório do ManyCraft)`);
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------
// Etapas da skill

/** Lê os arquivos de etapa: [{ arquivo, numero, titulo, numeroDoTitulo, opcional }]. */
function lerEtapas(raiz) {
  const pasta = "skill/references";
  return arquivosDe(raiz, pasta)
    .map((caminho) => caminho.split("/").pop())
    .filter((nome) => /^etapa-\d+-.*\.md$/.test(nome))
    .sort()
    .map((arquivo) => {
      const texto = ler(raiz, `${pasta}/${arquivo}`);
      const titulo = texto.match(/^# Etapa (\d+)(.*)$/m);
      return {
        arquivo,
        numero: Number(arquivo.match(/^etapa-(\d+)-/)[1]),
        numeroDoTitulo: titulo ? Number(titulo[1]) : null,
        opcional: titulo ? /\(opcional\)/i.test(titulo[2]) : false,
      };
    });
}

export function conferirEtapasDaSkill(raiz) {
  const problemas = [];
  const etapas = lerEtapas(raiz);
  if (etapas.length === 0) problemas.push("skill/references: nenhum arquivo etapa-NN-*.md");

  const vistos = new Set();
  etapas.forEach((e) => {
    if (vistos.has(e.numero)) problemas.push(`skill/references/${e.arquivo}: número ${e.numero} repetido, esperava um arquivo por etapa`);
    vistos.add(e.numero);
    if (e.numeroDoTitulo === null) problemas.push(`skill/references/${e.arquivo}: sem título "# Etapa N", esperava "# Etapa ${e.numero}"`);
    else if (e.numeroDoTitulo !== e.numero) problemas.push(`skill/references/${e.arquivo}: título "# Etapa ${e.numeroDoTitulo}", esperava "# Etapa ${e.numero}" (o número do arquivo)`);
  });
  const numeros = [...vistos].sort((a, b) => a - b);
  for (let i = 0; i < numeros.length; i++) {
    if (numeros[i] !== i) {
      problemas.push(`skill/references: faltou a etapa ${i} (achei ${numeros.map((n) => String(n).padStart(2, "0")).join(", ")}), esperava números contíguos a partir de 00`);
      break;
    }
  }

  if (!existe(raiz, "skill/SKILL.md")) return problemas;
  const skill = ler(raiz, "skill/SKILL.md");

  // Tabela de etapas do SKILL.md: "| N | Nome | `references/etapa-NN-x.md` | Onde |"
  const naTabela = [...skill.matchAll(/^\|\s*(\d+)\s*\|[^\n]*?`references\/(etapa-[^`\s]+\.md)`/gm)].map((m) => ({ numero: Number(m[1]), arquivo: m[2] }));
  const reais = new Map(etapas.map((e) => [e.arquivo, e.numero]));
  for (const t of naTabela) {
    if (!reais.has(t.arquivo)) problemas.push(`skill/SKILL.md: a tabela lista ${t.arquivo}, que não existe em skill/references`);
    else if (reais.get(t.arquivo) !== t.numero) problemas.push(`skill/SKILL.md: a tabela lista ${t.arquivo} como etapa ${t.numero}, esperava ${reais.get(t.arquivo)}`);
  }
  const listados = new Set(naTabela.map((t) => t.arquivo));
  for (const e of etapas) {
    if (!listados.has(e.arquivo)) problemas.push(`skill/SKILL.md: a tabela de etapas não lista ${e.arquivo}`);
  }
  if (new Set(naTabela.map((t) => t.arquivo)).size !== naTabela.length) problemas.push("skill/SKILL.md: a tabela de etapas lista o mesmo arquivo mais de uma vez");

  // Todo caminho references/... citado existe.
  for (const achou of skill.matchAll(/references\/[A-Za-z0-9_.-]*[A-Za-z0-9_]/g)) {
    if (!existe(raiz, `skill/${achou[0]}`)) problemas.push(`skill/SKILL.md, linha ${linhaDe(skill, achou.index)}: cita ${achou[0]}, que não existe`);
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------
// Contagem de etapas igual em todo lugar

/** O que os arquivos reais dizem: { maxObrigatoria, obrigatorias, opcionais }. */
function contagemReal(raiz) {
  const etapas = lerEtapas(raiz);
  const opcionais = etapas.filter((e) => e.opcional).map((e) => e.numero);
  const obrigatorias = etapas.filter((e) => !e.opcional).map((e) => e.numero);
  return { etapas, opcionais, obrigatorias, maxObrigatoria: Math.max(...obrigatorias, -1), maxGeral: Math.max(...etapas.map((e) => e.numero), -1) };
}

export function conferirContagemDeEtapas(raiz) {
  const problemas = [];
  const real = contagemReal(raiz);
  if (real.etapas.length === 0) return problemas; // já acusado na regra 4
  if (real.opcionais.length !== 1) {
    // Sem saber qual é a etapa opcional não há frase esperada para comparar: para aqui.
    const quais = real.opcionais.length ? ` (etapas ${real.opcionais.join(", ")})` : "";
    problemas.push(`skill/references: ${real.opcionais.length} etapas com "(opcional)" no título${quais}, esperava exatamente 1; as frases de contagem não foram conferidas`);
    return problemas;
  }
  const [opcional] = real.opcionais;
  const qtd = real.obrigatorias.length;

  // O que cada arquivo promete. [arquivo, [rótulo, regex que captura os números]]
  const frases = {
    "skill/SKILL.md": [
      ["título", /^## As etapas \((\d+) a (\d+), e a (\d+) opcional\)/m, "range"],
      ["contagem", /\b(\d+) etapas, mais uma opcional/g, "qtd"],
    ],
    "INSTALL.md": [
      ["intervalo", /etapas (\d+) a (\d+), e a (\d+) opcional/g, "range"],
      ["contagem", /\b(\d+) etapas, mais uma opcional/g, "qtd"],
    ],
    "README.md": [["contagem", /\b(\d+) etapas e uma opcional/g, "qtd"]],
  };
  for (const [arquivo, regras] of Object.entries(frases)) {
    if (!existe(raiz, arquivo)) continue;
    const texto = ler(raiz, arquivo);
    for (const [rotulo, re, tipo] of regras) {
      const achados = [...texto.matchAll(re.global ? re : new RegExp(re.source, `${re.flags}g`))];
      if (achados.length === 0) {
        const artigo = rotulo === "contagem" ? "da" : "do";
        const esperada = tipo === "range" ? `"0 a ${real.maxObrigatoria}, e a ${opcional} opcional"` : `"${qtd} etapas" e uma opcional`;
        problemas.push(`${arquivo}: não achei a frase ${artigo} ${rotulo} das etapas (esperava ${esperada})`);
        continue;
      }
      for (const m of achados) {
        const linha = linhaDe(texto, m.index);
        if (tipo === "range") {
          const [de, ate, op] = [Number(m[1]), Number(m[2]), Number(m[3])];
          if (de !== 0 || ate !== real.maxObrigatoria || op !== opcional) {
            problemas.push(`${arquivo}, linha ${linha}: diz "${m[0]}", esperava "${arquivo === "skill/SKILL.md" ? "## As etapas (" : "etapas "}0 a ${real.maxObrigatoria}, e a ${opcional} opcional" pelos arquivos de skill/references`);
          }
        } else if (Number(m[1]) !== qtd) {
          problemas.push(`${arquivo}, linha ${linha}: diz "${m[0]}", esperava ${qtd} etapas pelos arquivos de skill/references`);
        }
      }
    }
  }

  // Toda menção "etapa N" / "etapas N a M" em INSTALL e README cai dentro do intervalo real.
  for (const arquivo of ["INSTALL.md", "README.md"]) {
    if (!existe(raiz, arquivo)) continue;
    const texto = ler(raiz, arquivo);
    for (const m of texto.matchAll(/\b[Ee]tapas? (\d+)(?: a (\d+))?/g)) {
      for (const n of [m[1], m[2]].filter(Boolean).map(Number)) {
        if (n < 0 || n > real.maxGeral) problemas.push(`${arquivo}, linha ${linhaDe(texto, m.index)}: cita a etapa ${n} ("${m[0]}"), mas as etapas reais vão de 0 a ${real.maxGeral}`);
      }
    }
    // Links para a skill apontam para arquivo que existe.
    for (const m of texto.matchAll(/\]\((skill\/[^)\s#]*)/g)) {
      if (!existe(raiz, m[1])) problemas.push(`${arquivo}, linha ${linhaDe(texto, m.index)}: link para ${m[1]}, que não existe`);
    }
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------
// Pacote (.mcpb)

export function sha256Arquivo(caminho) {
  return createHash("sha256").update(readFileSync(caminho)).digest("hex");
}

/** O SHA-256 escrito no INSTALL.md (linha do `shasum -a 256 -c`), ou null. */
export function hashDoInstall(raiz) {
  if (!existe(raiz, "INSTALL.md")) return null;
  return ler(raiz, "INSTALL.md").match(/echo "([0-9a-f]{64})  [^"]*" \| shasum -a 256 -c/)?.[1] ?? null;
}

export function conferirPacote(raiz, { exigirPacote = false } = {}) {
  const problemas = [];
  const hashInstall = hashDoInstall(raiz);
  if (!hashInstall) problemas.push('INSTALL.md: não achei a linha do `shasum -a 256 -c` com um SHA-256 de 64 caracteres hexadecimais');
  const pacote = join(raiz, CAMINHO_PACOTE);
  if (!existsSync(pacote)) {
    if (exigirPacote) problemas.push(`${CAMINHO_PACOTE}: arquivo não existe, esperava o pacote gerado por npm run pack`);
    return problemas;
  }
  const hashReal = sha256Arquivo(pacote);
  if (hashInstall && hashReal !== hashInstall) {
    problemas.push(`${CAMINHO_PACOTE}: SHA-256 ${hashReal}, esperava ${hashInstall} (o que está no INSTALL.md)`);
  }
  const versao = versaoDoPacote(raiz);
  try {
    const manifesto = JSON.parse(execFileSync("unzip", ["-p", pacote, "manifest.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    if (manifesto.version !== versao) problemas.push(`${CAMINHO_PACOTE}: manifest.json de dentro tem versão ${manifesto.version}, esperava ${versao}`);
  } catch (erro) {
    problemas.push(`${CAMINHO_PACOTE}: não consegui ler manifest.json de dentro do zip (${String(erro.message).split("\n")[0]})`);
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------

/** As regras, na ordem em que aparecem no relatório. */
export const REGRAS = [
  ["1. versão única nos arquivos do pacote", (raiz) => conferirVersaoUnica(raiz)],
  ["2. INSTALL e README presos à versão", (raiz) => conferirTextosPresosAVersao(raiz)],
  ["3. skill certa (instagram-app-meta, sem ManyCraft)", (raiz) => conferirSkillCerta(raiz)],
  ["4. etapas da skill coerentes", (raiz) => conferirEtapasDaSkill(raiz)],
  ["5. contagem de etapas igual em todo lugar", (raiz) => conferirContagemDeEtapas(raiz)],
  ["6. pacote .mcpb", (raiz, opcoes) => conferirPacote(raiz, opcoes)],
];

/** Roda todas as regras e devolve a lista de problemas (vazia = tudo certo). */
export function conferirArvore(raiz, { exigirPacote = false } = {}) {
  return REGRAS.flatMap(([, regra]) => regra(raiz, { exigirPacote }));
}
