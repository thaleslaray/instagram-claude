// Autoteste do build (modelo "Verify your server" do guia do SDK v2).
// Sobe mcpb/server/index.mjs por stdio como um cliente MCP faria, lista as ferramentas,
// confere as anotações e chama ig_conta contra a Graph falsa. Sai com erro se algo falhar.
//
// Token: o servidor recebe um token FALSO por IG_TESTE_TOKEN, que ele só aceita quando
// IG_GRAPH_BASE aponta para 127.0.0.1. Nada aqui fala com a Meta.
//
// Rodar: npm run build && npm run autoteste

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CONTA_TESTE, GraphFalsa } from "../test/graph-falsa.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(RAIZ, "mcpb/server/index.mjs");
const TOKEN = "token-do-autoteste-NAO-E-REAL";
// Serviço do Keychain que NÃO existe: o autoteste nunca lê o `instagram-mcp` de verdade.
// (IG_KEYCHAIN_SERVICO só vale com a Graph falsa em 127.0.0.1.)
const SERVICO_INEXISTENTE = `instagram-mcp-autoteste-inexistente-${randomBytes(6).toString("hex")}`;

if (!existsSync(BUILD)) {
  console.error(`Autoteste: ${BUILD} não existe. Rode npm run build antes.`);
  process.exit(1);
}

const graphFalsa = new GraphFalsa();
const base = await graphFalsa.iniciar();
graphFalsa.rota("GET", `/${CONTA_TESTE.id}`, { corpo: CONTA_TESTE });

/** Conecta ao build por stdio. `stderr` junta tudo o que o servidor escreve no stderr. */
async function conectar(envExtra) {
  const cliente = new Client({ name: "autoteste-instagram-mcp", version: "1.0.0" });
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [BUILD],
    env: { ...getDefaultEnvironment(), IG_ACCOUNT_ID: CONTA_TESTE.id, IG_GRAPH_BASE: base, IG_KEYCHAIN_SERVICO: SERVICO_INEXISTENTE, ...envExtra },
    stderr: "pipe",
  });
  cliente.stderrTexto = "";
  await cliente.connect(transporte);
  transporte.stderr?.on("data", (parte) => (cliente.stderrTexto += parte));
  return cliente;
}

/** Sobe o build e espera ele sair sozinho; devolve o código de saída e o stderr. */
function rodarAteSair(env) {
  return new Promise((pronto) => {
    const filho = spawn(process.execPath, [BUILD], { env: { ...getDefaultEnvironment(), ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let erro = "";
    filho.stderr.on("data", (parte) => (erro += parte));
    const relogio = setTimeout(() => filho.kill(), 5_000);
    filho.on("exit", (codigo) => {
      clearTimeout(relogio);
      pronto({ codigo, erro });
    });
  });
}

const passos = [];
const passo = (nome) => passos.push(nome);

try {
  // 1. Servidor com token de teste: lista, anotações e ig_conta.
  const cliente = await conectar({ IG_TESTE_TOKEN: TOKEN });
  try {
    assert.match(cliente.getInstructions() ?? "", /conteúdo de terceiros/i, "instruções do servidor ausentes");
    passo("instruções do servidor presentes");

    const { tools } = await cliente.listTools();
    for (const nome of ["ig_conta", "ig_listar_midias", "ig_ver_midia", "ig_listar_stories", "ig_listar_marcacoes", "ig_perfil_publico", "ig_insights_conta", "ig_insights_midia", "ig_listar_conversas", "ig_ler_conversa", "ig_ver_mensagem", "ig_perfil_contato", "ig_listar_comentarios", "ig_ver_comentario", "ig_listar_respostas", "ig_responder_comentario", "ig_responder_no_privado", "ig_esconder_comentario", "ig_apagar_comentario", "ig_ligar_comentarios", "ig_comentar_midia", "ig_estado_do_token", "ig_responder_dm", "ig_enviar_midia_dm", "ig_reagir_dm", "ig_publicar_post", "ig_publicar_carrossel", "ig_publicar_reels", "ig_publicar_story", "ig_limite_publicacao", "ig_status_publicacao"]) assert.ok(tools.some((t) => t.name === nome), `falta ${nome}`);
    for (const nome of ["ig_confirmar", "ig_confirmar_tela", "ig_cancelar", "ig_cancelar_pedido"]) assert.ok(tools.some((t) => t.name === nome), `falta ${nome}`);
    for (const ferramenta of tools) {
      assert.ok(ferramenta.name.startsWith("ig_"), `${ferramenta.name} sem prefixo ig_`);
      assert.ok(ferramenta.title || ferramenta.annotations?.title, `${ferramenta.name} sem título`);
      assert.ok(ferramenta.description, `${ferramenta.name} sem descrição`);
      const a = ferramenta.annotations ?? {};
      for (const chave of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        assert.equal(typeof a[chave], "boolean", `${ferramenta.name}: anotação ${chave} ausente`);
      }
      assert.equal(a.openWorldHint, true, `${ferramenta.name}: openWorldHint deve ser true`);
    }
    const conta = tools.find((t) => t.name === "ig_conta");
    assert.equal(conta.annotations.readOnlyHint, true);
    assert.equal(conta.annotations.destructiveHint, false);
    assert.equal(conta.outputSchema?.type, "object", "ig_conta sem outputSchema");
    passo("ferramentas listadas com anotações e outputSchema");

    const { prompts } = await cliente.listPrompts();
    for (const nome of ["ig_relatorio_semanal", "ig_caixa_de_dms", "ig_pesquisa_concorrentes"]) assert.ok(prompts.some((p) => p.name === nome), `falta o roteiro ${nome}`);
    passo("roteiros prontos listados");

    // Confirmação (ficha 03): só a tela chama ig_confirmar_tela, ig_cancelar_pedido e ig_estado_pedido_tela; a tela é servida pelo build.
    for (const nome of ["ig_confirmar_tela", "ig_cancelar_pedido", "ig_estado_pedido_tela"]) {
      assert.deepEqual(tools.find((t) => t.name === nome)._meta?.ui?.visibility, ["app"], `${nome} deveria ser só da tela`);
    }
    const tela = await cliente.readResource({ uri: `ui://instagram/confirmar-v${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version.replaceAll(".", "-")}.html` });
    assert.equal(tela.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(tela.contents[0].text, /ig_confirmar_tela/);
    const recusa = await cliente.callTool({ name: "ig_confirmar", arguments: { id: "naoexiste", codigo: "x" } });
    assert.equal(recusa.isError, true, "ig_confirmar sem pedido deveria recusar");
    passo("tela de confirmação servida; ferramentas da tela escondidas do modelo; ig_confirmar recusa pedido inexistente");

    // Espera a partida (GET id,username) para não misturar com o pedido do ig_conta.
    for (let i = 0; i < 50 && graphFalsa.pedidos.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(graphFalsa.pedidos[0]?.query.fields, "id,username", "partida não conferiu a conta");
    passo("partida conferiu a conta (fields=id,username)");
    graphFalsa.limparPedidos();

    const resultado = await cliente.callTool({ name: "ig_conta", arguments: {} });
    assert.ok(!resultado.isError, `ig_conta falhou: ${JSON.stringify(resultado.content)}`);
    assert.deepEqual(resultado.structuredContent, CONTA_TESTE);
    assert.deepEqual(JSON.parse(resultado.content[0].text), resultado.structuredContent, "texto diferente do structuredContent");
    passo("ig_conta devolveu structuredContent + mesmo JSON em texto");

    const [pedido] = graphFalsa.pedidos;
    assert.equal(pedido.versao, "v27.0");
    assert.equal(pedido.cabecalhos.authorization, `Bearer ${TOKEN}`);
    assert.ok(!pedido.urlBruta.includes(TOKEN), "token na URL");
    passo("pedido em v27.0 com o token só no cabeçalho");

    const invalido = await cliente.callTool({ name: "ig_conta", arguments: { extra: 1 } });
    assert.equal(invalido.isError, true, "argumento desconhecido deveria ser recusado");
    passo("argumento inválido recusado");

    assert.ok(!cliente.stderrTexto.includes(TOKEN), "token apareceu no stderr");
    assert.match(cliente.stderrTexto, /conta conferida: @conta_de_teste/);
    passo("stderr do servidor sem o token");
  } finally {
    await cliente.close();
  }

  // 2. Sem token: o servidor sobe e a ferramenta explica o que fazer.
  const semToken = await conectar({});
  try {
    const resultado = await semToken.callTool({ name: "ig_conta", arguments: {} });
    assert.equal(resultado.isError, true);
    assert.match(resultado.content[0].text, /Token não cadastrado: rode `npm run guardar-token`/);
    passo("sem token (Keychain real, serviço inexistente): 'Token não cadastrado'");
  } finally {
    await semToken.close();
  }

  // 3. IG_TESTE_TOKEN com a Graph de verdade: o servidor recusa subir.
  const recusa = await rodarAteSair({ IG_ACCOUNT_ID: CONTA_TESTE.id, IG_TESTE_TOKEN: TOKEN });
  assert.equal(recusa.codigo, 1, "deveria sair com código 1");
  assert.match(recusa.erro, /IG_TESTE_TOKEN só vale nos testes/);
  assert.ok(!recusa.erro.includes(TOKEN), "token apareceu no stderr");
  passo("IG_TESTE_TOKEN recusado sem IG_GRAPH_BASE local");

  // 4. Sem IG_ACCOUNT_ID: não sobe.
  const semConta = await rodarAteSair({});
  assert.equal(semConta.codigo, 1);
  assert.match(semConta.erro, /IG_ACCOUNT_ID não configurado/);
  passo("sem IG_ACCOUNT_ID: não sobe");

  for (const nome of passos) console.error(`  ok  ${nome}`);
  console.error(`Autoteste passou (${passos.length} verificações).`);
} catch (erro) {
  for (const nome of passos) console.error(`  ok  ${nome}`);
  console.error(`Autoteste FALHOU: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exitCode = 1;
} finally {
  await graphFalsa.parar();
}
