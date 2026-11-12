// Teste anti-vazamento (spec 5.2). Com um token marcado no cofre, roda TODAS as ferramentas
// registradas no servidor, no sucesso e nos erros (190, 4, 500, rede caída), e confere que o
// token não aparece em saída de ferramenta, mensagem de erro, stderr, nem em URL, consulta ou
// corpo recebidos pela Graph falsa (o cabeçalho Authorization é o único lugar permitido).
//
// Genérico: percorre `listTools()`. Quando uma ficha nova criar ferramenta com argumentos
// obrigatórios, acrescente os argumentos de exemplo em ARGUMENTOS_DE_EXEMPLO.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CofreKeychain, CONTA_TOKEN } from "../src/cofre.ts";
import { partida } from "../src/contexto.ts";
import { trocarSaidaDoLog } from "../src/log.ts";
import { esquecerSegredos } from "../src/segredos.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { configurarPublicacao, estadoDePublicacao } from "../src/publicacao.ts";
import { CONTA_TESTE, erroMeta, rotasDeContainer, type RespostaFalsa } from "./graph-falsa.ts";
import { jpeg } from "./jpeg.ts";
import { hospedagemDeTeste, UploadcareFalso } from "./uploadcare-falso.ts";
import { SistemaFalso } from "./sistema-falso.ts";

/**
 * Tem hífens de propósito: o padrão `EAA[A-Za-z0-9]{20,}` NÃO o pega inteiro, então o que o
 * protege é o registro do valor lido do cofre (o caminho que vale no uso real).
 */
const TOKEN_VAZOU = "EAATESTE-NAO-REAL-VAZOU-9f3a1c7b2d4e6f80";

/** Argumentos de exemplo por ferramenta. Quem não está aqui roda com `{}`. */
const ARGUMENTOS_DE_EXEMPLO: Record<string, Record<string, unknown>> = {
  ig_confirmar: { id: "naoexiste", codigo: "codigo-de-exemplo", texto: "texto editado de exemplo" },
  ig_confirmar_tela: { id: "naoexiste", codigo: "codigo-de-exemplo", texto: "texto editado de exemplo" },
  ig_cancelar_pedido: { id: "naoexiste" },
  ig_estado_pedido_tela: { id: "naoexiste" },
  ig_cancelar: { id: "naoexiste" },
  ig_ver_midia: { midia_id: "17900000000000001" },
  ig_perfil_publico: { usuario: "bluebottle" },
  ig_insights_conta: { metricas: ["reach"] },
  ig_insights_midia: { midia_id: "17900000000000001" },
  ig_ler_conversa: { conversa_id: "aWdfY29udmVyc2E" },
  ig_ver_mensagem: { mensagem_id: "aWdfbWVuc2FnZW0" },
  ig_listar_comentarios: { midia_id: "17900000000000001" },
  ig_ver_comentario: { comentario_id: "17900000000000002" },
  ig_listar_respostas: { comentario_id: "17900000000000002" },
  ig_responder_comentario: { comentario_id: "17900000000000002", texto: "Obrigado!" },
  ig_comentar_midia: { midia_id: "17900000000000001", texto: "Oi" },
  ig_responder_no_privado: { comentario_id: "17900000000000002", texto: "Oi" },
  ig_apagar_comentario: { comentario_id: "17900000000000002" },
  ig_esconder_comentario: { comentario_id: "17900000000000002", esconder: true },
  ig_ligar_comentarios: { midia_id: "17900000000000001", ligado: false },
  ig_perfil_contato: { usuario_id: "17841400000000001" },
  ig_publicar_post: { imagem: "https://exemplo.com/foto.jpg", legenda: "Oi" },
  ig_publicar_carrossel: { itens: [{ arquivo: "https://exemplo.com/a.jpg" }, { arquivo: "https://exemplo.com/b.jpg" }] },
  ig_publicar_reels: { video: "https://exemplo.com/video.mp4", legenda: "Oi" },
  ig_publicar_story: { midia: "https://exemplo.com/foto.jpg" },
  ig_status_publicacao: { trabalho_id: "t_naoexiste" },
  ig_responder_dm: { usuario_id: "17841400000000001", texto: "Oi, tudo bem?" },
  ig_enviar_midia_dm: { usuario_id: "17841400000000001", tipo: "image", url: "https://exemplo.com/foto.jpg" },
  ig_reagir_dm: { usuario_id: "17841400000000001", mensagem_id: "aWdfbWVuc2FnZW0", reacao: "love" },
};

type Cenario = {
  nome: string;
  /** Resposta da Graph falsa para qualquer rota; ausente = rede caída (a Graph falsa é parada). */
  resposta?: RespostaFalsa;
  /** Fetch que lança erro (rede caída com a mensagem ecoando o token). */
  fetchComErro?: boolean;
  esperaSucessoNaConta?: boolean;
};

const CENARIOS: Cenario[] = [
  { nome: "sucesso", resposta: { corpo: CONTA_TESTE }, esperaSucessoNaConta: true },
  { nome: "erro 190 com a Meta ecoando o token", resposta: erroMeta(190, `Invalid OAuth access token - Cannot parse access token ${TOKEN_VAZOU}`) },
  { nome: "erro 4 (limite) com o token na mensagem", resposta: erroMeta(4, `Application request limit reached for ${TOKEN_VAZOU}`) },
  { nome: "erro 500 com o token na mensagem", resposta: { status: 500, corpo: { error: { message: `Internal error ${TOKEN_VAZOU}`, code: 2, fbtrace_id: "Af500" } } } },
  { nome: "erro 10 pedindo permissão, com o token", resposta: erroMeta(10, `Permissão instagram_manage_comments negada para ${TOKEN_VAZOU}`) },
  { nome: "rede caída (conexão recusada)" },
  { nome: "rede caída com a mensagem do fetch ecoando o token", fetchComErro: true },
];

/** Cofre real (CofreKeychain) com `security` falso, para provar que o valor LIDO é registrado. */
function cofreDoKeychainFalso(): CofreKeychain {
  const sistema = new SistemaFalso();
  sistema.keychain.set(`instagram-mcp/${CONTA_TOKEN}`, TOKEN_VAZOU);
  return new CofreKeychain({ executar: sistema.executar });
}

describe("anti-vazamento: o token marcado não sai em lugar nenhum", () => {
  for (const origem of ["cofre em memória", "CofreKeychain com security falso"] as const) {
    for (const cenario of CENARIOS) {
      describe(`${origem}, ${cenario.nome}`, () => {
        let m: Montagem;
        let linhasDeLog: string[];
        let escritosNoStderr: string[];
        let restaurarLog: () => void;
        let stderrOriginal: typeof process.stderr.write;

        beforeEach(async () => {
          esquecerSegredos();
          m = await montar({
            token: TOKEN_VAZOU,
            ...(origem === "CofreKeychain com security falso" ? { cofre: cofreDoKeychainFalso() } : {}),
            ...(cenario.fetchComErro
              ? { fetch: async () => { throw new Error(`falha de rede em http://127.0.0.1:1/x?access_token=${TOKEN_VAZOU}`); } }
              : {}),
          });
          if (cenario.resposta) m.graphFalsa.padrao(cenario.resposta);
          if (!cenario.resposta && !cenario.fetchComErro) await m.graphFalsa.parar();
          linhasDeLog = [];
          escritosNoStderr = [];
          restaurarLog = trocarSaidaDoLog((l) => linhasDeLog.push(l));
          stderrOriginal = process.stderr.write;
          process.stderr.write = ((trecho: string | Uint8Array) => {
            escritosNoStderr.push(String(trecho));
            return true;
          }) as typeof process.stderr.write;
        });
        afterEach(async () => {
          process.stderr.write = stderrOriginal;
          restaurarLog();
          await m.fechar();
          esquecerSegredos();
        });

        it("nenhuma ferramenta, log ou pedido à Graph deixa o token passar", async () => {
          const { cliente, fechar } = await conectarCliente(m.ctx);
          const saidas: string[] = [];
          let chamadas = 0;
          try {
            const { tools } = await cliente.listTools();
            assert.ok(tools.length >= 1, "nenhuma ferramenta registrada");
            for (const ferramenta of tools) {
              const resultado = await cliente.callTool({ name: ferramenta.name, arguments: ARGUMENTOS_DE_EXEMPLO[ferramenta.name] ?? {} });
              chamadas++;
              saidas.push(JSON.stringify(resultado));
              if (cenario.esperaSucessoNaConta && ferramenta.name === "ig_conta") {
                assert.ok(!resultado.isError, `ig_conta deveria funcionar: ${JSON.stringify(resultado.content)}`);
              }
              if (!cenario.esperaSucessoNaConta && ferramenta.name === "ig_conta") {
                assert.equal(resultado.isError, true, "o erro deveria chegar como isError");
              }
            }
          } finally {
            await fechar();
          }
          assert.ok(chamadas >= 1);

          // Partida (também escreve log, com o logger padrão e com o capturado).
          const resultadoPartida = await partida(m.ctx);
          saidas.push(JSON.stringify(resultadoPartida));
          const direto: string[] = [];
          saidas.push(JSON.stringify(await partida(m.ctx, (l) => direto.push(l))));
          saidas.push(...direto);

          // Outro cliente MCP em memória: a lista de ferramentas e as instruções também são saída.
          const outro = await conectarCliente(m.ctx);
          try {
            saidas.push(JSON.stringify(await outro.cliente.listTools()), outro.cliente.getInstructions() ?? "");
          } finally {
            await outro.fechar();
          }

          for (const texto of saidas) assert.ok(!texto.includes(TOKEN_VAZOU), `token numa saída: ${texto.slice(0, 200)}`);
          for (const linha of linhasDeLog) assert.ok(!linha.includes(TOKEN_VAZOU), `token no log: ${linha}`);
          assert.ok(!escritosNoStderr.join("").includes(TOKEN_VAZOU), "token no stderr");

          // A Graph falsa: o token só pode estar no cabeçalho Authorization.
          for (const pedido of m.graphFalsa.pedidos) {
            const { authorization, ...outrosCabecalhos } = pedido.cabecalhos;
            assert.equal(authorization, `Bearer ${TOKEN_VAZOU}`);
            for (const parte of [pedido.urlBruta, pedido.corpo, JSON.stringify(pedido.query), JSON.stringify(outrosCabecalhos)]) {
              assert.ok(!parte.includes(TOKEN_VAZOU), `token em URL/corpo/cabeçalho do pedido: ${parte.slice(0, 120)}`);
            }
          }
        });
      });
    }
  }
});

describe("o token só entra por onde deve", () => {
  const raizSrc = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const arquivos = (pasta: string): string[] =>
    readdirSync(pasta).flatMap((nome) => {
      const caminho = join(pasta, nome);
      return statSync(caminho).isDirectory() ? arquivos(caminho) : caminho.endsWith(".ts") ? [caminho] : [];
    });
  const fontes = arquivos(raizSrc).map((caminho) => ({ caminho, texto: readFileSync(caminho, "utf8") }));

  it("nenhuma ferramenta aceita token, chave ou senha como parâmetro", async () => {
    const m = await montar();
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const { tools } = await cliente.listTools();
      for (const ferramenta of tools) {
        const propriedades = Object.keys((ferramenta.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
        for (const nome of propriedades) assert.ok(!/token|secret|segredo|senha|password|api_?key|access_?key|credential|authorization/i.test(nome), `${ferramenta.name} aceita "${nome}"`);
      }
    } finally {
      await fechar();
      await m.fechar();
    }
  });

  it("o código só lê estas variáveis de ambiente (o token só pelo campo seguro do .mcpb; nada de ACCESS_TOKEN ou .env)", () => {
    const permitidas = new Set(["IG_PROTOCOLO", "IG_TOKEN", "IG_ACCOUNT_ID", "IG_GRAPH_VERSION", "IG_GRAPH_BASE", "IG_TESTE_TOKEN", "IG_KEYCHAIN_SERVICO", "IG_PERFIL", "IG_GRUPOS_SO_LEITURA"]);
    for (const { caminho, texto } of fontes) {
      for (const m of texto.matchAll(/\benv\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        assert.ok(permitidas.has(m[1]!), `${caminho} lê a variável ${m[1]}`);
      }
      // process.env só aparece como valor padrão de quem recebe o ambiente por parâmetro.
      if (/process\.env\b/.test(texto)) assert.ok(/(config|cofre|cadastro|hospedagem|perfis)\.ts$/.test(caminho), `${caminho} usa process.env`);
      assert.ok(!/dotenv|["'`]\.env/.test(texto), `${caminho} menciona .env`);
    }
  });

  it("nenhum comando do sistema passa por shell", () => {
    for (const { caminho, texto } of fontes) {
      assert.ok(!/\bshell\s*:/.test(texto), `${caminho} usa a opção shell`);
      assert.ok(!/\b(execSync|spawnSync|execFileSync)\b|(?<![.\w])exec\(/.test(texto), `${caminho} usa exec/sync`);
      if (!caminho.endsWith("sistema.ts")) assert.ok(!/child_process/.test(texto), `${caminho} importa child_process fora de sistema.ts`);
    }
  });
});

describe("anti-vazamento: os caminhos de upload (vídeo direto, anexo de DM, foto no Uploadcare)", () => {
  const IG = CONTA_TESTE.id;
  const PESSOA = "17841400000000001";
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
  const eco = (texto: string) => `${texto} (OAuth ${TOKEN_VAZOU})`;

  type Falha = "nenhuma" | "rupload" | "anexo" | "uploadcare";
  let m: Montagem;
  let uc: UploadcareFalso;
  let pasta: string;
  let linhasDeLog: string[];
  let restaurarLog: () => void;
  let saidas: string[];

  async function preparar(falha: Falha): Promise<void> {
    esquecerSegredos();
    m = await montar({
      token: TOKEN_VAZOU,
      executar: async (comando) => (comando === "ffprobe" ? { codigo: 0, stdout: "20\n", stderr: "" } : { codigo: 127, stdout: "", stderr: "" }),
    });
    m.ctx.conta.arroba = CONTA_TESTE.username;
    uc = new UploadcareFalso();
    await uc.iniciar();
    if (falha === "uploadcare") uc.falha = { status: 400, corpo: { error: eco("recusado") } };
    m.ctx.hospedagem = hospedagemDeTeste(uc);
    pasta = mkdtempSync(join(tmpdir(), "anti-upload-"));
    configurarPublicacao(m.ctx, { esperar: async () => undefined });
    const g = m.graphFalsa;
    g.rota("GET", `/${IG}/content_publishing_limit`, { corpo: { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } });
    rotasDeContainer(g, IG, falha === "rupload" ? { rupload: { status: 500, corpo: { debug_info: { message: eco("falhou"), type: "ProcessingFailedError" } } } } : {});
    g.rota("POST", `/${IG}/media_publish`, { corpo: { id: "midia1" } });
    g.rota("GET", "/midia1", { corpo: { id: "midia1", permalink: "https://www.instagram.com/p/ABC/" } });
    for (const id of ["c1", "c2", "c3"]) g.rota("GET", `/${id}`, { corpo: { id, status_code: "FINISHED" } });
    g.rota("GET", `/${IG}/conversations`, {
      corpo: { data: [{ id: "conv1", updated_time: new Date().toISOString(), participants: { data: [{ id: PESSOA, username: "fulano" }, { id: IG, username: CONTA_TESTE.username }] } }] },
    });
    g.rota("GET", "/conv1", { corpo: { messages: { data: [{ id: "mid.dela", created_time: new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "+0000"), from: { id: PESSOA, username: "fulano" } }] } } });
    g.rota("POST", `/${IG}/messages`, { corpo: { recipient_id: PESSOA, message_id: "mid.enviada" } });
    g.rota("POST", `/${IG}/message_attachments`, falha === "anexo" ? erroMeta(190, eco("Invalid OAuth access token")) : { corpo: { attachment_id: "anexo-1" } });
    linhasDeLog = [];
    saidas = [];
    restaurarLog = trocarSaidaDoLog((l) => linhasDeLog.push(l));
  }

  afterEach(async () => {
    restaurarLog();
    await uc.parar();
    await m.fechar();
    rmSync(pasta, { recursive: true, force: true });
    esquecerSegredos();
  });

  /** Pede a prévia, clica e guarda tudo o que o modelo veria. */
  async function percorrer(ferramenta: string, args: Record<string, unknown>): Promise<void> {
    const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: true });
    try {
      const previa = await cliente.callTool({ name: ferramenta, arguments: args });
      saidas.push(JSON.stringify(previa));
      const meta = previa._meta as { codigo?: string } | undefined;
      const pedido = (previa.structuredContent as { pedido?: string } | undefined)?.pedido;
      if (!pedido || !meta?.codigo) return;
      const r = await cliente.callTool({ name: "ig_confirmar", arguments: { id: pedido, codigo: meta.codigo } });
      saidas.push(JSON.stringify(r));
      const trabalho = (r.structuredContent as { resultado?: { trabalho_id?: string } } | undefined)?.resultado?.trabalho_id;
      if (trabalho) {
        const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(trabalho);
        saidas.push(JSON.stringify(t));
      }
    } finally {
      await fechar();
    }
  }

  const arquivo = (nome: string, bytes: Buffer): string => {
    const caminho = join(pasta, nome);
    writeFileSync(caminho, bytes);
    return caminho;
  };

  function conferirTudo(): void {
    for (const texto of saidas) assert.ok(!texto.includes(TOKEN_VAZOU), `token numa saída: ${texto.slice(0, 200)}`);
    for (const linha of linhasDeLog) assert.ok(!linha.includes(TOKEN_VAZOU), `token no log: ${linha}`);
    assert.ok(!readFileSync(m.caminhoRegistro, "utf8").includes(TOKEN_VAZOU), "token no registro de ações");
    // A Graph falsa (inclusive o rupload): o token só no cabeçalho Authorization, bearer na Graph e OAuth no rupload.
    for (const pedido of m.graphFalsa.pedidos) {
      const { authorization, ...outros } = pedido.cabecalhos;
      const rupload = pedido.caminho.startsWith("/rupload/");
      assert.equal(authorization, `${rupload ? "OAuth" : "Bearer"} ${TOKEN_VAZOU}`);
      for (const parte of [pedido.urlBruta, pedido.corpoBruto.toString("latin1"), JSON.stringify(pedido.query), JSON.stringify(outros)]) {
        assert.ok(!parte.includes(TOKEN_VAZOU), `token em URL/corpo/cabeçalho do pedido: ${parte.slice(0, 120)}`);
      }
    }
    // O Uploadcare nunca recebe nada do token.
    for (const pedido of uc.pedidos) {
      for (const parte of [pedido.urlBruta, pedido.corpoBruto.toString("latin1"), JSON.stringify(pedido.cabecalhos)]) {
        assert.ok(!parte.includes(TOKEN_VAZOU), "token chegou ao Uploadcare");
      }
    }
  }

  for (const falha of ["nenhuma", "rupload", "anexo", "uploadcare"] as const) {
    it(`vídeo local, anexo de DM e foto local (${falha === "nenhuma" ? "tudo certo" : `falha em ${falha}`}): o token não vaza`, async () => {
      await preparar(falha);
      await percorrer("ig_publicar_reels", { video: arquivo("r.mp4", MP4) });
      await percorrer("ig_publicar_story", { midia: arquivo("s.mp4", MP4) });
      await percorrer("ig_publicar_carrossel", { itens: [{ arquivo: arquivo("a.jpg", jpeg(1080, 1350)) }, { arquivo: arquivo("b.mp4", MP4) }] });
      await percorrer("ig_publicar_post", { imagem: arquivo("p.jpg", jpeg(1080, 1350)) });
      await percorrer("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: arquivo("d.jpg", jpeg(100, 100)) });
      conferirTudo();
      if (falha === "rupload") assert.ok(saidas.some((t) => t.includes("A Meta não aceitou o envio do vídeo")), "a frase em português chegou");
      if (falha === "nenhuma") assert.ok(m.graphFalsa.pedidos.some((p) => p.caminho.startsWith("/rupload/")), "o rupload foi exercitado");
      if (falha === "anexo") assert.ok(m.graphFalsa.pedidos.some((p) => p.caminho === `/${IG}/message_attachments`), "o anexo foi exercitado");
      if (falha === "uploadcare") assert.ok(uc.pedidos.length > 0, "o Uploadcare foi exercitado");
    });
  }
});
