// Conferência de lançamento (scripts/lancamento/conferencia.mjs): a árvore real passa e,
// para cada regra, uma mutação mínima numa cópia faz a conferência acusar o problema certo.
// Não toca rede nem git: tudo roda em pasta temporária.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { crc32 } from "node:zlib";
import { ARQUIVOS_DA_RELEASE, arquivosDaSkill, conferirArvore, conferirContagemDeEtapas, REGRAS } from "../scripts/lancamento/conferencia.mjs";
import { gerarSha256, gerarSkill } from "../scripts/lancamento/pacote.mjs";

const REPO = join(import.meta.dirname, "../..");
const LIDOS = ["mcp/package.json", "mcp/package-lock.json", "mcp/mcpb/manifest.json", "mcp/src/versao.ts", "mcp/test/manifest.test.ts", "INSTALL.md", "README.md", "skill"];

/** Zip mínimo, sem compressão, com um único arquivo (o suficiente para `unzip -p`). */
function zipDeUmArquivo(nome: string, conteudo: string): Buffer {
  const n = Buffer.from(nome);
  const dados = Buffer.from(conteudo);
  const crc = crc32(dados);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(dados.length, 18);
  local.writeUInt32LE(dados.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(dados.length, 20);
  central.writeUInt32LE(dados.length, 24);
  central.writeUInt16LE(n.length, 28);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(1, 8);
  fim.writeUInt16LE(1, 10);
  const tamanhoCentral = central.length + n.length;
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(local.length + n.length + dados.length, 16);
  return Buffer.concat([local, n, dados, central, n, fim]);
}

let base: string;
let n = 0;

/** Árvore mínima válida: cópia dos arquivos que a conferência lê, mais um .mcpb de mentira, o .sha256 e o .skill gerados. */
function montar(): string {
  const raiz = join(base, `arvore-${n++}`);
  for (const caminho of LIDOS) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    cpSync(join(REPO, caminho), join(raiz, caminho), { recursive: true });
  }
  const versao = JSON.parse(readFileSync(join(raiz, "mcp/package.json"), "utf8")).version;
  const pacote = zipDeUmArquivo("manifest.json", JSON.stringify({ version: versao }));
  writeFileSync(join(raiz, "mcp/instagram-mcp.mcpb"), pacote);
  gerarSha256(raiz);
  gerarSkill(raiz);
  return raiz;
}

function trocar(raiz: string, arquivo: string, de: string | RegExp, para: string) {
  const caminho = join(raiz, arquivo);
  const antes = readFileSync(caminho, "utf8");
  const depois = antes.replace(de, para);
  assert.notEqual(depois, antes, `a mutação não mudou nada em ${arquivo} (${de})`);
  writeFileSync(caminho, depois);
}

/** Os problemas devem conter um que case com `esperado`. */
function acusa(problemas: string[], esperado: RegExp) {
  assert.ok(problemas.some((p) => esperado.test(p)), `esperava um problema com ${esperado}, veio:\n${problemas.join("\n") || "(nenhum)"}`);
}

const conferir = (raiz: string, exigirPacote = true) => conferirArvore(raiz, { exigirPacote });
const versaoReal = (): string => JSON.parse(readFileSync(join(REPO, "mcp/package.json"), "utf8")).version;

before(() => {
  base = mkdtempSync(join(tmpdir(), "lancamento-teste-"));
});
after(() => rmSync(base, { recursive: true, force: true }));

describe("conferência de lançamento", () => {
  it("a árvore real passa nas regras que não dependem do pacote da release", () => {
    // Os três arquivos da release são ignorados pelo git e podem ser de outra versão (o `lancar
    // preparar` roda os testes com a versão já trocada e o pacote antigo ainda em disco). Quem
    // confere o pacote de verdade é o `conferir-lancamento --exigir-pacote`, depois do
    // `npm run pacote-da-release`.
    const semPacote = REGRAS.filter(([nome]) => !/pacote da release/.test(nome));
    assert.equal(semPacote.length, REGRAS.length - 1);
    assert.deepEqual(semPacote.flatMap(([, regra]) => regra(REPO, { exigirPacote: false })), []);
  });

  it("a árvore mínima montada pelo teste passa, com o pacote exigido", () => {
    assert.deepEqual(conferir(montar()), []);
  });

  describe("regra 1: versão única", () => {
    const casos: [string, string, string | RegExp, string, RegExp][] = [
      ["package.json", "mcp/package.json", /"version": "[^"]+"/, '"version": "9.9.9"', /package\.json|versão 9\.9\.9/],
      ["package-lock.json (arquivo)", "mcp/package-lock.json", /"version": "[^"]+"/, '"version": "9.9.9"', /package-lock\.json \(versão do arquivo\): versão 9\.9\.9/],
      ["manifest.json", "mcp/mcpb/manifest.json", /"version": "[^"]+"/, '"version": "9.9.9"', /manifest\.json: versão 9\.9\.9/],
      ["versao.ts", "mcp/src/versao.ts", /VERSAO_SERVIDOR = "[^"]+"/, 'VERSAO_SERVIDOR = "9.9.9"', /versao\.ts \(VERSAO_SERVIDOR\): versão 9\.9\.9/],
      ["manifest.test.ts", "mcp/test/manifest.test.ts", /manifesto\.version, "[^"]+"/, 'manifesto.version, "9.9.9"', /manifest\.test\.ts: versão 9\.9\.9/],
    ];
    for (const [nome, arquivo, de, para, esperado] of casos) {
      it(`acusa versão diferente em ${nome}`, () => {
        const raiz = montar();
        trocar(raiz, arquivo, de, para);
        acusa(conferir(raiz), esperado);
      });
    }

    it("acusa a segunda ocorrência do pacote no package-lock", () => {
      const raiz = montar();
      const caminho = join(raiz, "mcp/package-lock.json");
      const lock = JSON.parse(readFileSync(caminho, "utf8"));
      lock.packages[""].version = "9.9.9";
      writeFileSync(caminho, JSON.stringify(lock, null, 2));
      acusa(conferir(raiz), /package-lock\.json \(packages\[""\]\): versão 9\.9\.9/);
    });
  });

  describe("regra 2: INSTALL e README sem versão, baixando da última release", () => {
    const versao = versaoReal();
    it("o INSTALL e o README reais não têm a versão do projeto", () => {
      for (const arquivo of ["INSTALL.md", "README.md"]) assert.equal(readFileSync(join(REPO, arquivo), "utf8").includes(versao), false, arquivo);
    });
    it("acusa releases/download/vX.Y.Z no INSTALL (e a falta do endereço latest)", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", 'BASE="https://github.com/thaleslaray/instagram-claude/releases/latest/download"', `BASE="https://github.com/thaleslaray/instagram-claude/releases/download/v${versao}"`);
      const problemas = conferir(raiz);
      acusa(problemas, /INSTALL\.md, linha \d+: versão v\d+\.\d+\.\d+/);
      acusa(problemas, /INSTALL\.md, linha \d+: releases\/download\/v/);
      acusa(problemas, /INSTALL\.md: não achei o endereço releases\/latest\/download\/instagram-mcp\.mcpb/);
    });
    it("acusa tarball de uma tag no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "releases/latest/download/instagram-app-meta.skill", "archive/refs/tags/v0.0.1.tar.gz");
      const problemas = conferir(raiz);
      acusa(problemas, /INSTALL\.md, linha \d+: archive\/refs\/tags/);
      acusa(problemas, /INSTALL\.md: não achei o endereço releases\/latest\/download\/instagram-app-meta\.skill/);
    });
    it("acusa link blob/vX.Y.Z no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "/blob/main/", "/blob/v0.0.1/");
      acusa(conferir(raiz), /INSTALL\.md, linha \d+: blob\/v/);
    });
    it("acusa o endereço do .sha256 ou do .skill que falta no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", '"$BASE/instagram-mcp.mcpb.sha256"', '"$BASE/outro.sha256"');
      acusa(conferir(raiz), /INSTALL\.md: não achei o endereço releases\/latest\/download\/instagram-mcp\.mcpb\.sha256/);
    });
    it("acusa SHA-256 escrito no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "## Passo 1", `${"a".repeat(64)}\n\n## Passo 1`);
      acusa(conferir(raiz), /INSTALL\.md: tem um SHA-256 escrito/);
    });
    it("acusa o README apontando para o INSTALL de uma tag", () => {
      const raiz = montar();
      trocar(raiz, "README.md", "instagram-claude/main/INSTALL.md", `instagram-claude/v${versao}/INSTALL.md`);
      const problemas = conferir(raiz);
      acusa(problemas, /README\.md, linha \d+: versão v\d+\.\d+\.\d+/);
      acusa(problemas, /README\.md, linha \d+: raw\.githubusercontent\.com\/\.\.\.\/v/);
      acusa(problemas, /README\.md: não achei a URL do INSTALL\.md na main/);
    });
    it("acusa a versão do projeto, sem v, solta no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "## Passo 1", `Pasta instagram-claude-${versao}.\n\n## Passo 1`);
      acusa(conferir(raiz), /INSTALL\.md, linha \d+: versão /);
    });
    it("acusa outra versão do projeto solta no texto, mas não a de pacote fixado nem a da Graph", () => {
      const raiz = montar();
      trocar(raiz, "README.md", "## Licença e aviso", "Usa mcpb@2.1.2 e a Graph v27.0.\n\n## Licença e aviso");
      assert.deepEqual(conferir(raiz), []);
      trocar(raiz, "README.md", "Usa mcpb@2.1.2", "Veja a v0.3.0 e usa mcpb@2.1.2");
      acusa(conferir(raiz), /README\.md, linha \d+: versão v0\.3\.0/);
    });
  });

  describe("regra 3: skill certa", () => {
    it("acusa name: instagram-manycraft no frontmatter", () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", "name: instagram-app-meta", "name: instagram-manycraft");
      const problemas = conferir(raiz);
      acusa(problemas, /name: instagram-manycraft, esperava name: instagram-app-meta/);
      acusa(problemas, /skill\/SKILL\.md: contém "manycraft"/);
    });
    it("acusa ManyCraft (qualquer caixa) numa referência da skill, no README e no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "skill/references/etapa-00-antes-de-comecar.md", /^# Etapa 0: antes de começar/, "# Etapa 0: antes de começar\n\nRoteiro do ManyCraft.");
      trocar(raiz, "README.md", "## Licença e aviso", "MANYCRAFT\n\n## Licença e aviso");
      trocar(raiz, "INSTALL.md", "## Passo 1", "manyCraft\n\n## Passo 1");
      const problemas = conferir(raiz);
      acusa(problemas, /skill\/references\/etapa-00-antes-de-comecar\.md: contém/);
      acusa(problemas, /README\.md: contém/);
      acusa(problemas, /INSTALL\.md: contém/);
    });
  });

  describe("regra 4: etapas da skill coerentes", () => {
    it("acusa arquivo de etapa faltando (buraco na numeração e tabela que cita arquivo sumido)", () => {
      const raiz = montar();
      rmSync(join(raiz, "skill/references/etapa-05-configuracao-e-permissoes.md"));
      const problemas = conferir(raiz);
      acusa(problemas, /faltou a etapa 5/);
      acusa(problemas, /a tabela lista etapa-05-configuracao-e-permissoes\.md, que não existe/);
    });
    it("acusa número repetido", () => {
      const raiz = montar();
      cpSync(join(raiz, "skill/references/etapa-03-ligar-ao-portfolio.md"), join(raiz, "skill/references/etapa-03-outra.md"));
      const problemas = conferir(raiz);
      acusa(problemas, /número 3 repetido/);
      acusa(problemas, /a tabela de etapas não lista etapa-03-outra\.md/);
    });
    it("acusa título de etapa com número errado", () => {
      const raiz = montar();
      trocar(raiz, "skill/references/etapa-04-caso-de-uso.md", "# Etapa 4:", "# Etapa 7:");
      acusa(conferir(raiz), /etapa-04-caso-de-uso\.md: título "# Etapa 7", esperava "# Etapa 4"/);
    });
    it("acusa tabela do SKILL.md com número diferente do arquivo", () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", /\| 6 \| Pôr a conta/, "| 7 | Pôr a conta");
      acusa(conferir(raiz), /a tabela lista etapa-06-conta-no-portfolio\.md como etapa 7, esperava 6/);
    });
    it("acusa arquivo de etapa que a tabela não lista", () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", /^\| 10 \|.*\n/m, "");
      acusa(conferir(raiz), /a tabela de etapas não lista etapa-10-foto-do-computador\.md/);
    });
    it("acusa caminho references/ citado no SKILL.md que não existe", () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", "## Se algo sair do roteiro", "Veja references/etapa-99-nao-existe.md.\n\n## Se algo sair do roteiro");
      acusa(conferir(raiz), /cita references\/etapa-99-nao-existe\.md, que não existe/);
    });
  });

  describe("regra 5: contagem de etapas igual em todo lugar", () => {
    it('acusa INSTALL dizendo "etapas 0 a 10"', () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "etapas 0 a 9, e as opcionais 10 e 11", "etapas 0 a 10");
      acusa(conferir(raiz), /INSTALL\.md: não achei a frase do intervalo das etapas \(esperava "0 a 9, e as opcionais 10 e 11"\)/);
    });
    it("sem etapa opcional, acusa isso e não monta frase com undefined", () => {
      const raiz = montar();
      trocar(raiz, "skill/references/etapa-10-foto-do-computador.md", /\s*\(opcional\)/i, "");
      trocar(raiz, "skill/references/etapa-11-responder-dms.md", /\s*\(opcional\)/i, "");
      const problemas = conferir(raiz);
      acusa(problemas, /skill\/references: 0 etapas com "\(opcional\)" no título, esperava 1 ou 2/);
      assert.equal(problemas.some((p) => /undefined/.test(p)), false);
    });
    it("acusa intervalo errado no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "etapas 0 a 9, e as opcionais 10 e 11", "etapas 0 a 8, e as opcionais 10 e 11");
      acusa(conferir(raiz), /INSTALL\.md, linha \d+: diz "etapas 0 a 8, e as opcionais 10 e 11", esperava "etapas 0 a 9, e as opcionais 10 e 11"/);
    });
    it("acusa o título do SKILL.md com intervalo errado", () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", "## As etapas (0 a 9, e as opcionais 10 e 11)", "## As etapas (0 a 10, e as opcionais 11 e 12)");
      acusa(conferir(raiz), /skill\/SKILL\.md, linha \d+: diz "## As etapas \(0 a 10, e as opcionais 11 e 12\)"/);
    });
    it('acusa contagem errada no SKILL.md, no INSTALL e no README', () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", /\b10 etapas, mais duas opcionais/, "9 etapas, mais duas opcionais");
      trocar(raiz, "INSTALL.md", "10 etapas, mais duas opcionais", "11 etapas, mais duas opcionais");
      trocar(raiz, "README.md", "10 etapas e duas opcionais", "12 etapas e duas opcionais");
      const problemas = conferir(raiz);
      acusa(problemas, /skill\/SKILL\.md, linha \d+: diz "9 etapas, mais duas opcionais", esperava 10/);
      acusa(problemas, /INSTALL\.md, linha \d+: diz "11 etapas, mais duas opcionais", esperava 10/);
      acusa(problemas, /README\.md, linha \d+: diz "12 etapas e duas opcionais", esperava 10/);
    });
    it("com 2 opcionais, as frases certas passam", () => {
      const raiz = montar();
      assert.deepEqual(conferirContagemDeEtapas(raiz), []);
    });
    it('com 2 opcionais, a frase antiga "mais uma opcional" é acusada', () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", /\b10 etapas, mais duas opcionais/g, "10 etapas, mais uma opcional");
      trocar(raiz, "INSTALL.md", "etapas 0 a 9, e as opcionais 10 e 11", "etapas 0 a 9, e a 10 opcional");
      trocar(raiz, "README.md", "10 etapas e duas opcionais", "10 etapas e uma opcional");
      const problemas = conferirContagemDeEtapas(raiz);
      acusa(problemas, /skill\/SKILL\.md: não achei a frase da contagem das etapas \(esperava "10 etapas, mais duas opcionais"\)/);
      acusa(problemas, /INSTALL\.md: não achei a frase do intervalo das etapas \(esperava "0 a 9, e as opcionais 10 e 11"\)/);
      acusa(problemas, /README\.md: não achei a frase da contagem das etapas \(esperava "10 etapas e duas opcionais"\)/);
    });
    it("com 2 opcionais, acusa o par de opcionais errado no intervalo do INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "e as opcionais 10 e 11", "e as opcionais 10 e 12");
      acusa(conferirContagemDeEtapas(raiz), /INSTALL\.md, linha \d+: diz "etapas 0 a 9, e as opcionais 10 e 12", esperava "etapas 0 a 9, e as opcionais 10 e 11"/);
    });
    it("com 1 opcional, as frases de uma opcional continuam valendo", () => {
      const raiz = montar();
      rmSync(join(raiz, "skill/references/etapa-11-responder-dms.md"));
      trocar(raiz, "skill/SKILL.md", /^\| 11 \|.*\n/m, "");
      trocar(raiz, "skill/SKILL.md", "## As etapas (0 a 9, e as opcionais 10 e 11)", "## As etapas (0 a 9, e a 10 opcional)");
      trocar(raiz, "skill/SKILL.md", /\b10 etapas, mais duas opcionais/g, "10 etapas, mais uma opcional");
      trocar(raiz, "INSTALL.md", "etapas 0 a 9, e as opcionais 10 e 11", "etapas 0 a 9, e a 10 opcional");
      trocar(raiz, "INSTALL.md", "10 etapas, mais duas opcionais", "10 etapas, mais uma opcional");
      trocar(raiz, "README.md", "10 etapas e duas opcionais", "10 etapas e uma opcional");
      trocar(raiz, "README.md", /precisa da etapa 11/, "precisa da etapa 10");
      trocar(raiz, "README.md", /A etapa 11 cria/, "A etapa 10 cria");
      assert.deepEqual(conferirContagemDeEtapas(raiz), []);
      // E a frase de duas opcionais passa a ser a errada.
      trocar(raiz, "README.md", "10 etapas e uma opcional", "10 etapas e duas opcionais");
      acusa(conferirContagemDeEtapas(raiz), /README\.md: não achei a frase da contagem das etapas \(esperava "10 etapas e uma opcional"\)/);
    });
    it("com 3 opcionais, acusa que não é suportado", () => {
      const raiz = montar();
      trocar(raiz, "skill/references/etapa-09-instalar-e-testar.md", /^(# Etapa 9.*)$/m, "$1 (opcional)");
      const problemas = conferirContagemDeEtapas(raiz);
      acusa(problemas, /skill\/references: 3 etapas com "\(opcional\)" no título \(etapas 9, 10, 11\), só 1 ou 2 são suportadas/);
    });
    it("acusa menção a uma etapa que não existe no INSTALL e no README", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "A etapa 0 confere os dois.", "A etapa 12 confere os dois.");
      trocar(raiz, "README.md", "que a etapa 10 da skill configura", "que a etapa 12 da skill configura");
      const problemas = conferir(raiz);
      acusa(problemas, /INSTALL\.md, linha \d+: cita a etapa 12/);
      acusa(problemas, /README\.md, linha \d+: cita a etapa 12/);
    });
    it("acusa o README com link para etapa que não existe", () => {
      const raiz = montar();
      trocar(raiz, "README.md", "skill/references/etapa-09-instalar-e-testar.md", "skill/references/etapa-19-fantasma.md");
      acusa(conferir(raiz), /README\.md, linha \d+: link para skill\/references\/etapa-19-fantasma\.md, que não existe/);
    });
  });

  describe("regra 6: pacote da release", () => {
    const sha = "mcp/instagram-mcp.mcpb.sha256";
    const zipSkill = (raiz: string) => join(raiz, "mcp/instagram-app-meta.skill");
    it("a lista de arquivos da release tem os três nomes fixos", () => {
      assert.deepEqual(ARQUIVOS_DA_RELEASE, ["mcp/instagram-mcp.mcpb", "mcp/instagram-mcp.mcpb.sha256", "mcp/instagram-app-meta.skill"]);
    });
    it("o .sha256 gerado tem uma linha <sha256>  instagram-mcp.mcpb", () => {
      const raiz = montar();
      const hash = createHash("sha256").update(readFileSync(join(raiz, "mcp/instagram-mcp.mcpb"))).digest("hex");
      assert.equal(readFileSync(join(raiz, sha), "utf8"), `${hash}  instagram-mcp.mcpb\n`);
    });
    it("o .skill gerado tem a raiz instagram-app-meta/ e não leva .DS_Store nem .gitignore", () => {
      const raiz = montar();
      const lista = execFileSync("unzip", ["-Z1", zipSkill(raiz)], { encoding: "utf8" }).split("\n").filter(Boolean);
      assert.ok(lista.includes("instagram-app-meta/SKILL.md"));
      assert.ok(lista.some((e) => e.startsWith("instagram-app-meta/references/etapa-00")));
      assert.ok(lista.every((e) => e.startsWith("instagram-app-meta/")));
      assert.equal(lista.some((e) => /\.DS_Store|\.gitignore/.test(e)), false);
      assert.equal(lista.length, arquivosDaSkill(join(REPO, "skill")).length);
    });
    it("acusa .sha256 com hash errado", () => {
      const raiz = montar();
      writeFileSync(join(raiz, sha), `${"0".repeat(64)}  instagram-mcp.mcpb\n`);
      acusa(conferir(raiz), /instagram-mcp\.mcpb: SHA-256 [0-9a-f]{64}, esperava 0{64}/);
    });
    it("acusa .sha256 fora do formato (nome errado, sem hash, linha a mais)", () => {
      const raiz = montar();
      const hash = readFileSync(join(raiz, sha), "utf8").slice(0, 64);
      for (const ruim of [`${hash}  outro.mcpb\n`, "abc123\n", `${hash}  instagram-mcp.mcpb\n${hash}  instagram-mcp.mcpb\n`]) {
        writeFileSync(join(raiz, sha), ruim);
        acusa(conferir(raiz), /instagram-mcp\.mcpb\.sha256: esperava uma linha/);
      }
    });
    it("acusa pacote ausente só quando exigido; sem exigir, confere o que existir", () => {
      const raiz = montar();
      for (const arquivo of ARQUIVOS_DA_RELEASE) rmSync(join(raiz, arquivo));
      const problemas = conferir(raiz, true);
      for (const arquivo of ARQUIVOS_DA_RELEASE) acusa(problemas, new RegExp(`${arquivo.replace(/\./g, "\\.")}: arquivo não existe`));
      assert.deepEqual(conferir(raiz, false), []);
      // Só o .sha256, ruim, sem exigir: ainda é conferido.
      writeFileSync(join(raiz, sha), "abc123\n");
      acusa(conferir(raiz, false), /instagram-mcp\.mcpb\.sha256: esperava uma linha/);
    });
    it("acusa manifest.json de dentro do pacote com versão diferente (mesmo com o hash certo)", () => {
      const raiz = montar();
      writeFileSync(join(raiz, "mcp/instagram-mcp.mcpb"), zipDeUmArquivo("manifest.json", JSON.stringify({ version: "9.9.9" })));
      gerarSha256(raiz);
      acusa(conferir(raiz), /manifest\.json de dentro tem versão 9\.9\.9, esperava/);
    });
    it("acusa .skill sem um arquivo de skill/", () => {
      const raiz = montar();
      execFileSync("zip", ["-q", "-d", zipSkill(raiz), "instagram-app-meta/references/etapa-03-ligar-ao-portfolio.md"]);
      acusa(conferir(raiz), /instagram-app-meta\.skill: falta instagram-app-meta\/references\/etapa-03-ligar-ao-portfolio\.md/);
    });
    it("acusa .skill com conteúdo diferente de skill/ (skill mudou depois de empacotar)", () => {
      const raiz = montar();
      trocar(raiz, "skill/references/etapa-04-caso-de-uso.md", "# Etapa 4:", "# Etapa 4 (editada):");
      acusa(conferir(raiz), /instagram-app-meta\.skill: instagram-app-meta\/references\/etapa-04-caso-de-uso\.md tem conteúdo diferente/);
    });
    it("acusa .skill com arquivo a mais (.DS_Store) e com arquivo fora da pasta instagram-app-meta/", () => {
      const raiz = montar();
      const area = mkdtempSync(join(base, "extra-"));
      mkdirSync(join(area, "instagram-app-meta"));
      writeFileSync(join(area, "instagram-app-meta/.DS_Store"), "lixo");
      writeFileSync(join(area, "solto.md"), "fora");
      execFileSync("zip", ["-q", zipSkill(raiz), "instagram-app-meta/.DS_Store", "solto.md"], { cwd: area });
      const problemas = conferir(raiz);
      acusa(problemas, /tem instagram-app-meta\/\.DS_Store, que não está em skill\//);
      acusa(problemas, /solto\.md fora da pasta instagram-app-meta\//);
    });
    it("acusa .skill que não é um zip", () => {
      const raiz = montar();
      writeFileSync(zipSkill(raiz), "isto não é um zip");
      acusa(conferir(raiz), /instagram-app-meta\.skill: não consegui abrir o zip/);
    });
  });
});
