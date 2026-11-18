// Lançamento de uma versão, em duas fases.
//
//   npm run lancar -- preparar 0.4.16
//   npm run lancar -- publicar 0.4.16 --notas "texto" [--simular]
//
// preparar: confere o ponto de partida, troca a versão nos 5 arquivos do pacote, roda o check,
//           gera os três arquivos da release UMA vez (.mcpb, .sha256 e .skill) e roda a
//           conferência. Não faz commit. INSTALL e README não mudam: não têm versão.
// publicar: confere que a árvore está como o preparar deixou, roda a conferência de novo
//           (sem empacotar), faz commit, tag, push e release com os três arquivos, e confere o
//           que foi publicado: o tarball da tag e o que o instalador baixa de releases/latest.
//
// O instalador baixa da ÚLTIMA release e a tag não se move: qualquer erro achado depois dela só
// se corrige com versão nova. Por isso a conferência vem antes, e a final olha o publicado.
//
// Todo comando externo passa por `externo()`: é o único ponto que o --simular intercepta.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ARQUIVOS_DA_RELEASE, conferirArvore, NOME_PACOTE, NOME_SHA256, NOME_SKILL_ZIP, sha256Arquivo, versaoDoPacote } from "./lancamento/conferencia.mjs";

const RAIZ = resolve(join(dirname(fileURLToPath(import.meta.url)), "../.."));
const MCP = join(RAIZ, "mcp");
const REPO_PADRAO = "thaleslaray/instagram-claude";

// Os arquivos que o aumento de versão muda. INSTALL e README não entram: não carregam versão.
export const ARQUIVOS_DA_VERSAO = [
  "mcp/mcpb/manifest.json",
  "mcp/package-lock.json",
  "mcp/package.json",
  "mcp/src/versao.ts",
  "mcp/test/manifest.test.ts",
];

/** Falha esperada: a mensagem já diz o que houve. `desfazer` diz como voltar. */
class Falha extends Error {
  constructor(mensagem, desfazer) {
    super(mensagem);
    this.desfazer = desfazer;
  }
}

let simular = false;

// ---------------------------------------------------------------------------------------------
// Ponto único dos comandos externos

/**
 * Roda um comando. `escreve` marca o que muda git, GitHub ou disco de forma que o --simular
 * não deve fazer: com --simular, só imprime. `herdar` mostra a saída na tela.
 */
function externo(comando, args, { cwd = RAIZ, escreve = false, herdar = false, aparar = true } = {}) {
  if (escreve && simular) {
    console.log(`  [simulado] ${[comando, ...args].map(citar).join(" ")}`);
    return "";
  }
  try {
    const saida = execFileSync(comando, args, { cwd, encoding: "utf8", stdio: herdar ? "inherit" : ["ignore", "pipe", "pipe"] });
    return herdar ? "" : aparar ? saida.trim() : saida;
  } catch (erro) {
    const detalhe = herdar ? "" : `\n${String(erro.stderr || erro.stdout || erro.message).trim()}`;
    throw new Falha(`comando falhou: ${[comando, ...args].map(citar).join(" ")}${detalhe}`);
  }
}

const citar = (texto) => (/^[\w@%+=:,./-]+$/.test(texto) ? texto : JSON.stringify(texto));
const git = (...args) => externo("git", args);
// `git status --porcelain` começa com espaço em " M arquivo": não pode aparar.
const statusPorcelain = () => externo("git", ["status", "--porcelain"], { aparar: false }).split("\n").filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Versões

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function ehSemver(texto) {
  return SEMVER.test(texto);
}

/** -1, 0 ou 1. */
export function compararVersoes(a, b) {
  const [pa, pb] = [a, b].map((v) => v.match(SEMVER).slice(1).map(Number));
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

function exigirVersaoNova(versao) {
  if (!ehSemver(versao)) throw new Falha(`versão "${versao}" inválida, esperava X.Y.Z (por exemplo 0.4.16)`);
}

// ---------------------------------------------------------------------------------------------
// Verificações de ponto de partida

function exigirMainLimpaEAtualizada({ exigirArvoreLimpa }) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") throw new Falha(`está na branch "${branch}", esperava main`);
  if (exigirArvoreLimpa) {
    const sujeira = statusPorcelain();
    if (sujeira.length) throw new Falha(`a árvore não está limpa:\n${sujeira.join("\n")}\nFaça commit ou descarte antes de preparar.`);
  }
  git("fetch", "origin");
  const local = git("rev-parse", "HEAD");
  const remoto = git("rev-parse", "origin/main");
  if (local !== remoto) throw new Falha(`main (${local.slice(0, 7)}) é diferente de origin/main (${remoto.slice(0, 7)}). Faça pull ou push antes.`);
}

function exigirTagLivre(versao) {
  const tag = `v${versao}`;
  if (git("tag", "-l", tag)) throw new Falha(`a tag ${tag} já existe aqui`);
  if (git("ls-remote", "--tags", "origin", `refs/tags/${tag}`)) throw new Falha(`a tag ${tag} já existe no remoto`);
}

// ---------------------------------------------------------------------------------------------
// Fase 1: preparar

/** Troca `de` por `para` num arquivo; `quantas` limita as primeiras ocorrências (0 = todas). */
function trocarNoArquivo(arquivo, de, para, { quantas = 0, exato = null } = {}) {
  const caminho = join(RAIZ, arquivo);
  const texto = readFileSync(caminho, "utf8");
  let feitas = 0;
  const depois = texto.split(de).reduce((acc, parte, i) => {
    if (i === 0) return parte;
    const trocar = quantas === 0 || feitas < quantas;
    if (trocar) feitas++;
    return acc + (trocar ? para : de) + parte;
  }, "");
  if (feitas === 0) throw new Falha(`${arquivo}: não achei "${de}" para trocar`, "git checkout -- .");
  if (exato !== null && feitas !== exato) throw new Falha(`${arquivo}: troquei ${feitas} ocorrência(s) de "${de}", esperava ${exato}`, "git checkout -- .");
  writeFileSync(caminho, depois);
}

function trocarVersaoNosArquivos(antiga, nova) {
  trocarNoArquivo("mcp/mcpb/manifest.json", `"version": "${antiga}"`, `"version": "${nova}"`, { exato: 1 });
  trocarNoArquivo("mcp/package.json", `"version": "${antiga}"`, `"version": "${nova}"`, { exato: 1 });
  trocarNoArquivo("mcp/package-lock.json", `"version": "${antiga}"`, `"version": "${nova}"`, { quantas: 2, exato: 2 });
  trocarNoArquivo("mcp/src/versao.ts", `"${antiga}"`, `"${nova}"`, { exato: 1 });
  trocarNoArquivo("mcp/test/manifest.test.ts", `manifesto.version, "${antiga}"`, `manifesto.version, "${nova}"`, { exato: 1 });
}

function passo(texto) {
  console.log(`\n==> ${texto}`);
}

function preparar(versao) {
  exigirVersaoNova(versao);
  passo("Conferindo o ponto de partida");
  exigirMainLimpaEAtualizada({ exigirArvoreLimpa: true });
  const atual = versaoDoPacote(RAIZ);
  if (!atual || !ehSemver(atual)) throw new Falha("mcp/package.json sem versão X.Y.Z válida");
  if (compararVersoes(versao, atual) <= 0) throw new Falha(`${versao} não é maior que a versão atual (${atual})`);
  exigirTagLivre(versao);
  console.log(`  ${atual} -> ${versao}, main limpa e igual a origin/main, tag v${versao} livre`);

  const desfazer = `git checkout -- .   (os três arquivos da release são ignorados pelo git; pode apagar ${ARQUIVOS_DA_RELEASE.join(", ")})`;
  try {
    passo(`Trocando a versão em ${ARQUIVOS_DA_VERSAO.length} arquivos`);
    trocarVersaoNosArquivos(atual, versao);

    passo("npm run check");
    externo("npm", ["run", "check"], { cwd: MCP, herdar: true });

    passo("npm run pacote-da-release (único empacotamento: .mcpb, .sha256 e .skill)");
    externo("npm", ["run", "pacote-da-release"], { cwd: MCP, herdar: true });
    for (const arquivo of ARQUIVOS_DA_RELEASE) if (!existsSync(join(RAIZ, arquivo))) throw new Falha(`${arquivo} não foi gerado`);
    const hash = sha256Arquivo(join(RAIZ, ARQUIVOS_DA_RELEASE[0]));

    passo("Conferência de lançamento (com o pacote)");
    const problemas = conferirArvore(RAIZ, { exigirPacote: true });
    if (problemas.length) throw new Falha(`a conferência achou ${problemas.length} problema(s):\n${problemas.map((p) => `  - ${p}`).join("\n")}`);
    console.log("  tudo certo");

    passo("Resultado");
    console.log(git("diff", "--stat"));
    console.log(`\nSHA-256 do pacote: ${hash}`);
    console.log(`\nPróximo passo: revise o diff (git diff) e, estando de acordo, rode:\n  npm run lancar -- publicar ${versao} --notas "o que mudou"\n(Nada foi commitado.)`);
  } catch (erro) {
    if (erro instanceof Falha && !erro.desfazer) erro.desfazer = desfazer;
    throw erro;
  }
}

// ---------------------------------------------------------------------------------------------
// Fase 2: publicar

function exigirEstadoDoPreparar(versao) {
  const atual = versaoDoPacote(RAIZ);
  if (atual !== versao) throw new Falha(`os arquivos estão na versão ${atual}, esperava ${versao}. Rode preparar ${versao} antes.`);
  const noCommit = JSON.parse(git("show", "HEAD:mcp/package.json")).version;
  if (compararVersoes(versao, noCommit) <= 0) throw new Falha(`${versao} não é maior que a versão do último commit (${noCommit})`);

  const linhas = statusPorcelain();
  const modificados = new Set();
  const estranhos = [];
  for (const linha of linhas) {
    const caminho = linha.slice(3);
    if (linha.slice(0, 2).trim() === "M" && ARQUIVOS_DA_VERSAO.includes(caminho)) modificados.add(caminho);
    else estranhos.push(linha);
  }
  if (estranhos.length) throw new Falha(`há mudanças fora do que o preparar deixa:\n${estranhos.map((l) => `  ${l}`).join("\n")}`);
  const faltando = ARQUIVOS_DA_VERSAO.filter((a) => !modificados.has(a));
  if (faltando.length) throw new Falha(`o preparar deixaria modificados também: ${faltando.join(", ")}`);
  const ausentes = ARQUIVOS_DA_RELEASE.filter((a) => !existsSync(join(RAIZ, a)));
  if (ausentes.length) throw new Falha(`faltam ${ausentes.join(", ")}. Rode preparar ${versao} (publicar não empacota).`);
}

function repoDoGitHub() {
  try {
    const url = git("remote", "get-url", "origin");
    return url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? REPO_PADRAO;
  } catch {
    return REPO_PADRAO;
  }
}

async function baixar(url, destino) {
  let ultimo = "";
  // Logo depois da release, o GitHub pode demorar um pouco para servir o tarball e o anexo.
  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    try {
      const resposta = await fetch(url, { redirect: "follow" });
      if (resposta.ok) {
        writeFileSync(destino, Buffer.from(await resposta.arrayBuffer()));
        return;
      }
      ultimo = `HTTP ${resposta.status}`;
    } catch (erro) {
      ultimo = erro.message;
    }
    await new Promise((pronto) => setTimeout(pronto, 5000));
  }
  throw new Falha(`não consegui baixar ${url} (${ultimo})`);
}

/** Espera o endereço releases/latest redirecionar para a tag (até 5 minutos). Devolve se apontou. */
async function esperarUltimaApontar(url, tag) {
  for (let tentativa = 1; tentativa <= 30; tentativa++) {
    try {
      const resposta = await fetch(url, { method: "HEAD", redirect: "manual" });
      const destino = resposta.headers.get("location") ?? "";
      if (destino.includes(`/releases/download/${tag}/`)) return true;
    } catch {
      // rede instável: tenta de novo
    }
    if (tentativa === 1) console.log(`  esperando releases/latest apontar para ${tag}...`);
    await new Promise((pronto) => setTimeout(pronto, 10000));
  }
  return false;
}

/**
 * Confere o que foi publicado, de dois jeitos. (a) O tarball da tag: as regras de texto, versão e
 * skill valem nele. (b) O que o instalador baixa, de releases/latest/download: a última release
 * tem de ser esta tag, o .mcpb tem de bater com o .sha256 e o .skill tem de ser igual à skill/
 * do tarball. Devolve os problemas.
 */
async function conferirPublicado(versao) {
  const repo = repoDoGitHub();
  const tag = `v${versao}`;
  const pasta = mkdtempSync(join(tmpdir(), "lancamento-publicado-"));
  try {
    const tarball = join(pasta, "fonte.tar.gz");
    const extraido = join(pasta, "fonte");
    mkdirSync(extraido);
    await baixar(`https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz`, tarball);
    externo("tar", ["-xzf", tarball, "-C", extraido]);
    // O GitHub nomeia a pasta do tarball como <nome do repositório>-<versão sem o v>.
    const pastaDoTarball = `${repo.split("/")[1]}-${versao}`;
    const raizExtraida = join(extraido, pastaDoTarball);
    if (!existsSync(raizExtraida)) return [`o tarball da tag ${tag} não tem a pasta ${pastaDoTarball}`];

    console.log(`  (a) tarball da tag ${tag}: regras de texto, versão e skill`);
    const problemas = conferirArvore(raizExtraida, { exigirPacote: false }).map((p) => `tarball da tag: ${p}`);

    const ultima = externo("gh", ["release", "view", "--repo", repo, "--json", "tagName", "--jq", ".tagName"]);
    console.log(`  (b) última release do GitHub: ${ultima}`);
    if (ultima !== tag) problemas.push(`a última release do GitHub é ${ultima}, esperava ${tag} (o instalador baixa da última)`);

    // Os três arquivos, pelo mesmo endereço que o INSTALL usa, no lugar em que a conferência os lê.
    const base = `https://github.com/${repo}/releases/latest/download`;
    // A API já mostra a release nova, mas o endereço releases/latest leva um ou dois minutos para
    // apontar para ela. Espera o redirecionamento chegar na tag antes de baixar.
    const apontou = await esperarUltimaApontar(`${base}/${NOME_PACOTE}`, tag);
    if (!apontou) problemas.push(`releases/latest ainda não aponta para ${tag} depois de 5 minutos (o instalador baixa por esse endereço). Confira de novo com: npm run lancar -- conferir-publicado ${versao}`);
    mkdirSync(join(raizExtraida, "mcp"), { recursive: true });
    for (const arquivo of ARQUIVOS_DA_RELEASE) {
      await baixar(`${base}/${arquivo.split("/").pop()}`, join(raizExtraida, arquivo));
    }
    const hashBaixado = sha256Arquivo(join(raizExtraida, ARQUIVOS_DA_RELEASE[0]));
    console.log(`  SHA-256 do ${NOME_PACOTE} baixado de releases/latest: ${hashBaixado}`);
    console.log(`  ${NOME_SHA256} baixado: ${readFileSync(join(raizExtraida, ARQUIVOS_DA_RELEASE[1]), "utf8").trim()}`);
    console.log(`  (b) ${NOME_SKILL_ZIP} comparado com a skill/ do tarball`);
    problemas.push(...conferirArvore(raizExtraida, { exigirPacote: true }).filter((p) => !problemas.includes(`tarball da tag: ${p}`)).map((p) => `release baixada: ${p}`));
    return problemas;
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

async function publicar(versao, notas) {
  exigirVersaoNova(versao);
  if (!notas || !notas.trim()) throw new Falha('--notas é obrigatório: npm run lancar -- publicar X.Y.Z --notas "o que mudou"');
  const tag = `v${versao}`;
  if (simular) console.log("MODO SIMULAR: as checagens rodam de verdade; comandos que escrevem só são impressos.");

  passo("Conferindo que a árvore está como o preparar deixou");
  exigirMainLimpaEAtualizada({ exigirArvoreLimpa: false });
  exigirEstadoDoPreparar(versao);
  exigirTagLivre(versao);
  console.log(`  versão ${versao} nos arquivos, só os ${ARQUIVOS_DA_VERSAO.length} arquivos esperados modificados, os três arquivos da release presentes`);

  passo("Conferência de lançamento (com o pacote, sem empacotar de novo)");
  const problemas = conferirArvore(RAIZ, { exigirPacote: true });
  if (problemas.length) throw new Falha(`a conferência achou ${problemas.length} problema(s):\n${problemas.map((p) => `  - ${p}`).join("\n")}\nNada foi commitado nem publicado.`);
  console.log("  tudo certo");

  const primeiraLinha = notas.trim().split("\n")[0];
  const mensagem = `${tag}: ${primeiraLinha}`;
  let desfazer = "nada foi alterado";
  try {
    passo("Commit, tag, push e release");
    externo("git", ["add", ...ARQUIVOS_DA_VERSAO], { escreve: true });
    externo("git", ["commit", "-m", mensagem], { escreve: true });
    desfazer = `git reset --soft HEAD~1   (o commit ainda não foi enviado)`;
    externo("git", ["tag", "-a", tag, "-m", tag], { escreve: true });
    desfazer = `git tag -d ${tag} && git reset --soft HEAD~1   (nada foi enviado ainda)`;
    externo("git", ["push", "origin", "main", tag], { escreve: true });
    desfazer = `o commit e a tag ${tag} JÁ ESTÃO no remoto; a tag não se move: corrija com uma versão nova`;
    externo("gh", ["release", "create", tag, ...ARQUIVOS_DA_RELEASE.map((a) => join(RAIZ, a)), "--title", tag, "--notes", notas, "--verify-tag"], { escreve: true });
  } catch (erro) {
    if (erro instanceof Falha) erro.desfazer = desfazer;
    throw erro;
  }

  if (simular) {
    console.log("\nSimulação terminada: nenhum comando que escreve foi rodado.");
    console.log(`Depois do release, a fase real baixaria archive/refs/tags/${tag}.tar.gz e os três arquivos de releases/latest/download, confirmaria que a última release é ${tag} e conferiria tudo.`);
    return;
  }

  await relatarPublicado(versao);
}

/** Roda a conferência do que está no GitHub e diz o resultado. Também é a fase `conferir-publicado`. */
async function relatarPublicado(versao) {
  const tag = `v${versao}`;
  passo("Conferindo pelo que foi publicado");
  const publicados = await conferirPublicado(versao);
  if (publicados.length) {
    console.error(`\nA VERSÃO PUBLICADA ${tag} ESTÁ COM DEFEITO:`);
    for (const p of publicados) console.error(`  - ${p}`);
    console.error("A tag não se move e o instalador baixa da última release: corrija e lance uma versão nova.");
    process.exitCode = 1;
    return;
  }
  console.log(`\n${tag} publicada e conferida pelo que está no GitHub: tudo certo.`);
}

// ---------------------------------------------------------------------------------------------

function lerArgumentos(argv) {
  const [fase, versao, ...resto] = argv;
  const opcoes = { fase, versao, notas: null, simular: false };
  for (let i = 0; i < resto.length; i++) {
    if (resto[i] === "--simular") opcoes.simular = true;
    else if (resto[i] === "--notas") {
      if (resto[i + 1] === undefined) throw new Falha("--notas precisa de um texto");
      opcoes.notas = resto[++i];
    } else throw new Falha(`opção desconhecida: ${resto[i]}`);
  }
  return opcoes;
}

async function main() {
  const uso = 'Uso:\n  npm run lancar -- preparar X.Y.Z\n  npm run lancar -- publicar X.Y.Z --notas "texto" [--simular]\n  npm run lancar -- conferir-publicado X.Y.Z';
  try {
    const opcoes = lerArgumentos(process.argv.slice(2));
    if (opcoes.fase === "preparar" && opcoes.versao) {
      if (opcoes.simular || opcoes.notas) throw new Falha("--simular e --notas são da fase publicar");
      preparar(opcoes.versao);
    } else if (opcoes.fase === "publicar" && opcoes.versao) {
      simular = opcoes.simular;
      await publicar(opcoes.versao, opcoes.notas);
    } else if (opcoes.fase === "conferir-publicado" && opcoes.versao) {
      if (opcoes.simular || opcoes.notas) throw new Falha("--simular e --notas são da fase publicar");
      await relatarPublicado(opcoes.versao);
    } else {
      console.error(uso);
      process.exit(2);
    }
  } catch (erro) {
    if (!(erro instanceof Falha)) throw erro;
    console.error(`\nFALHOU: ${erro.message}`);
    if (erro.desfazer) console.error(`Para desfazer: ${erro.desfazer}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
