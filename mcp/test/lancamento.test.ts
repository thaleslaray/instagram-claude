// Conferência de lançamento (scripts/lancamento/conferencia.mjs): a árvore real passa e,
// para cada regra, uma mutação mínima numa cópia faz a conferência acusar o problema certo.
// Não toca rede nem git: tudo roda em pasta temporária.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { crc32 } from "node:zlib";
import { conferirArvore, hashDoInstall, REGRAS } from "../scripts/lancamento/conferencia.mjs";

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

/** Árvore mínima válida: cópia dos arquivos que a conferência lê, mais um .mcpb de mentira com o hash certo no INSTALL. */
function montar(): string {
  const raiz = join(base, `arvore-${n++}`);
  for (const caminho of LIDOS) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    cpSync(join(REPO, caminho), join(raiz, caminho), { recursive: true });
  }
  const versao = JSON.parse(readFileSync(join(raiz, "mcp/package.json"), "utf8")).version;
  const pacote = zipDeUmArquivo("manifest.json", JSON.stringify({ version: versao }));
  writeFileSync(join(raiz, "mcp/instagram-mcp.mcpb"), pacote);
  trocar(raiz, "INSTALL.md", /[0-9a-f]{64}(?=  \$PARCIAL)/, createHash("sha256").update(pacote).digest("hex"));
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

before(() => {
  base = mkdtempSync(join(tmpdir(), "lancamento-teste-"));
});
after(() => rmSync(base, { recursive: true, force: true }));

describe("conferência de lançamento", () => {
  it("a árvore real passa nas regras que não dependem do pacote", () => {
    // O .mcpb é ignorado pelo git e pode ser de outra versão (o `lancar preparar` roda os testes
    // com a versão já trocada e o pacote antigo ainda em disco). Quem confere o pacote de verdade
    // é o `conferir-lancamento --exigir-pacote`, depois do `npm run pack`.
    const semPacote = REGRAS.filter(([nome]) => !/pacote \.mcpb/.test(nome));
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

  describe("regra 2: INSTALL e README presos à versão", () => {
    const versao = JSON.parse(readFileSync(join(REPO, "mcp/package.json"), "utf8")).version;
    it("acusa versão antiga numa URL archive do INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", `refs/tags/v${versao}.tar.gz`, "refs/tags/v0.0.1.tar.gz");
      const problemas = conferir(raiz);
      acusa(problemas, /INSTALL\.md, linha \d+: versão v0\.0\.1/);
      acusa(problemas, /INSTALL\.md: não achei URL archive\/refs\/tags\//);
    });
    it("acusa versão antiga na URL blob do INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", `/blob/v${versao}/`, "/blob/v0.0.1/");
      acusa(conferir(raiz), /INSTALL\.md, linha \d+: versão v0\.0\.1/);
    });
    it("acusa a pasta instagram-claude-X.Y.Z/skill com versão antiga", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", `instagram-claude-${versao}/skill`, "instagram-claude-0.0.1/skill");
      acusa(conferir(raiz), /INSTALL\.md, linha \d+: versão v?0\.0\.1/);
    });
    it('acusa o texto "vale para a versão" com versão antiga', () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", `vale para a versão **v${versao}**`, "vale para a versão **v0.0.1**");
      acusa(conferir(raiz), /INSTALL\.md: não achei texto "vale para a versão"/);
    });
    it("acusa a URL do INSTALL no README com versão antiga", () => {
      const raiz = montar();
      trocar(raiz, "README.md", `instagram-claude/v${versao}/INSTALL.md`, "instagram-claude/v0.0.1/INSTALL.md");
      const problemas = conferir(raiz);
      acusa(problemas, /README\.md, linha \d+: versão v0\.0\.1/);
      acusa(problemas, /README\.md: não achei URL do INSTALL\.md/);
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
      trocar(raiz, "INSTALL.md", "etapas 0 a 9, e a 10 opcional", "etapas 0 a 10");
      acusa(conferir(raiz), /INSTALL\.md: não achei a frase da intervalo das etapas/);
    });
    it("acusa intervalo errado no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "etapas 0 a 9, e a 10 opcional", "etapas 0 a 8, e a 10 opcional");
      acusa(conferir(raiz), /INSTALL\.md, linha \d+: diz "etapas 0 a 8, e a 10 opcional", esperava "etapas 0 a 9, e a 10 opcional"/);
    });
    it("acusa o título do SKILL.md com intervalo errado", () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", "## As etapas (0 a 9, e a 10 opcional)", "## As etapas (0 a 10, e a 11 opcional)");
      acusa(conferir(raiz), /skill\/SKILL\.md, linha \d+: diz "## As etapas \(0 a 10, e a 11 opcional\)"/);
    });
    it('acusa contagem errada no SKILL.md, no INSTALL e no README', () => {
      const raiz = montar();
      trocar(raiz, "skill/SKILL.md", /\b10 etapas, mais uma opcional/, "9 etapas, mais uma opcional");
      trocar(raiz, "INSTALL.md", "10 etapas, mais uma opcional", "11 etapas, mais uma opcional");
      trocar(raiz, "README.md", "10 etapas e uma opcional", "12 etapas e uma opcional");
      const problemas = conferir(raiz);
      acusa(problemas, /skill\/SKILL\.md, linha \d+: diz "9 etapas, mais uma opcional", esperava 10/);
      acusa(problemas, /INSTALL\.md, linha \d+: diz "11 etapas, mais uma opcional", esperava 10/);
      acusa(problemas, /README\.md, linha \d+: diz "12 etapas e uma opcional", esperava 10/);
    });
    it("acusa menção a uma etapa que não existe no INSTALL e no README", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", "A etapa 0 confere os dois.", "A etapa 12 confere os dois.");
      trocar(raiz, "README.md", "que a etapa 10 da skill configura", "que a etapa 11 da skill configura");
      const problemas = conferir(raiz);
      acusa(problemas, /INSTALL\.md, linha \d+: cita a etapa 12/);
      acusa(problemas, /README\.md, linha \d+: cita a etapa 11/);
    });
    it("acusa o README com link para etapa que não existe", () => {
      const raiz = montar();
      trocar(raiz, "README.md", "skill/references/etapa-09-instalar-e-testar.md", "skill/references/etapa-19-fantasma.md");
      acusa(conferir(raiz), /README\.md, linha \d+: link para skill\/references\/etapa-19-fantasma\.md, que não existe/);
    });
  });

  describe("regra 6: pacote", () => {
    it("acusa hash trocado no INSTALL", () => {
      const raiz = montar();
      trocar(raiz, "INSTALL.md", /[0-9a-f]{64}(?=  \$PARCIAL)/, "0".repeat(64));
      acusa(conferir(raiz), /instagram-mcp\.mcpb: SHA-256 [0-9a-f]{64}, esperava 0{64}/);
    });
    it("acusa pacote ausente só quando exigido; sem ele, basta o INSTALL ter um hash de 64 hex", () => {
      const raiz = montar();
      rmSync(join(raiz, "mcp/instagram-mcp.mcpb"));
      acusa(conferir(raiz, true), /instagram-mcp\.mcpb: arquivo não existe/);
      assert.deepEqual(conferir(raiz, false), []);
      trocar(raiz, "INSTALL.md", /[0-9a-f]{64}(?=  \$PARCIAL)/, "abc123");
      acusa(conferir(raiz, false), /INSTALL\.md: não achei a linha do `shasum -a 256 -c`/);
    });
    it("acusa manifest.json de dentro do pacote com versão diferente (mesmo com o hash certo)", () => {
      const raiz = montar();
      const pacote = zipDeUmArquivo("manifest.json", JSON.stringify({ version: "9.9.9" }));
      writeFileSync(join(raiz, "mcp/instagram-mcp.mcpb"), pacote);
      trocar(raiz, "INSTALL.md", /[0-9a-f]{64}(?=  \$PARCIAL)/, createHash("sha256").update(pacote).digest("hex"));
      acusa(conferir(raiz), /manifest\.json de dentro tem versão 9\.9\.9, esperava/);
    });
    it("hashDoInstall devolve o hash escrito no INSTALL", () => {
      assert.match(hashDoInstall(REPO) ?? "", /^[0-9a-f]{64}$/);
    });
  });
});
