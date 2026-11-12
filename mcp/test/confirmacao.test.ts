// Ficha 03: confirmação pela tela no chat, janela do Mac de reserva e registro de ações.
// Tudo contra a Graph falsa, um executor falso (nada de osascript de verdade) e um registro em pasta temporária.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { MAX_ERROS_DE_CODIGO, VALIDADE_MS } from "../src/confirmacao.ts";
import { VERSAO_SERVIDOR } from "../src/versao.ts";
import { AVISO_PARA_QUEM_USA, textoDaJanela, textoParaOClaude, TETO_MINIATURAS_CARACTERES, URI_TELA, URI_TELA_ANTIGA } from "../src/escrita.ts";
import { INSTRUCOES } from "../src/servidor.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { NOME_ESCRITA_TESTE, registrarEscritaDeTeste, type OpcoesEscritaTeste } from "./escrita-falsa.ts";
import { CONTA_TESTE, erroMeta } from "./graph-falsa.ts";
import { JanelaFalsa } from "./janela-falsa.ts";

const ROTA_ESCRITA = `/${CONTA_TESTE.id}/mensagem_de_teste`;
const TEXTO = 'Oi, Fulano! Aqui vai o material, com "aspas", barra \\ e um emoji 😀.';

type Bloco = { type: string; text?: string };
type Resultado = { isError?: boolean; content: Bloco[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };

const textoDe = (r: Resultado): string => r.content.map((b) => b.text ?? "").join("\n");
const escritas = (m: Montagem): number => m.graphFalsa.pedidos.filter((p) => p.metodo === "POST").length;
const linhasDoRegistro = (m: Montagem): Array<Record<string, unknown>> => {
  try {
    return readFileSync(m.caminhoRegistro, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
};

interface Ambiente {
  m: Montagem;
  chamar(nome: string, argumentos: Record<string, unknown>): Promise<Resultado>;
  listar(): Promise<Array<{ name: string; _meta?: Record<string, unknown>; annotations?: Record<string, unknown> }>>;
  cliente: Awaited<ReturnType<typeof conectarCliente>>["cliente"];
  fechar(): Promise<void>;
}

async function ambiente(opcoes: { comTela: boolean; escrita?: OpcoesEscritaTeste; janela?: JanelaFalsa; agora?: () => number }): Promise<Ambiente> {
  const m = await montar({ ...(opcoes.janela ? { executar: opcoes.janela.executar } : {}), ...(opcoes.agora ? { agora: opcoes.agora } : {}) });
  m.graphFalsa.rota("POST", ROTA_ESCRITA, { corpo: { id: "msg_1" } });
  const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: opcoes.comTela, extras: [registrarEscritaDeTeste(opcoes.escrita)] });
  return {
    m,
    cliente,
    chamar: async (nome, argumentos) => (await cliente.callTool({ name: nome, arguments: argumentos })) as unknown as Resultado,
    listar: async () => (await cliente.listTools()).tools as never,
    fechar: async () => {
      await fechar();
      await m.fechar();
    },
  };
}

describe("tela de confirmação (cliente com MCP Apps)", () => {
  let a: Ambiente;
  let agora = 1_000_000;
  beforeEach(async () => {
    agora = 1_000_000;
    a = await ambiente({ comTela: true, agora: () => agora });
  });
  afterEach(async () => {
    await a.fechar();
  });

  /** Pede a prévia e devolve id e código (o código só existe no _meta). */
  async function pedirPrevia(texto = TEXTO): Promise<{ id: string; codigo: string; resultado: Resultado }> {
    const resultado = await a.chamar(NOME_ESCRITA_TESTE, { texto, para: "@fulano" });
    assert.ok(!resultado.isError, textoDe(resultado));
    return { id: String(resultado.structuredContent?.pedido), codigo: String(resultado._meta?.codigo), resultado };
  }

  it("o modelo não vê ig_confirmar_tela, ig_cancelar_pedido nem ig_estado_pedido_tela; as outras ferramentas ficam visíveis", async () => {
    const ferramentas = await a.listar();
    // Regra do MCP Apps: o app do Claude esconde do modelo a ferramenta cuja visibility não inclui "model".
    const visiveis = ferramentas.filter((f) => ((f._meta?.ui as { visibility?: string[] } | undefined)?.visibility ?? ["model", "app"]).includes("model")).map((f) => f.name);
    assert.ok(!visiveis.includes("ig_confirmar_tela"));
    assert.ok(!visiveis.includes("ig_cancelar_pedido"));
    assert.ok(!visiveis.includes("ig_estado_pedido_tela"));
    for (const nome of ["ig_confirmar", "ig_cancelar", "ig_conta", NOME_ESCRITA_TESTE]) assert.ok(visiveis.includes(nome), `${nome} deveria estar visível`);
    for (const nome of ["ig_confirmar_tela", "ig_cancelar_pedido", "ig_estado_pedido_tela"]) {
      const f = ferramentas.find((x) => x.name === nome);
      assert.deepEqual((f?._meta?.ui as { visibility?: string[] }).visibility, ["app"]);
    }
  });

  it("o caminho do endereço da tela só tem letras, números, hífen e um único .html no fim (o Claude Desktop não desenha com pontos)", () => {
    assert.ok(URI_TELA.startsWith("ui://instagram/"));
    assert.match(URI_TELA.slice("ui://instagram/".length), /^confirmar-v[0-9-]+\.html$/);
  });

  it("toda ferramenta de escrita aponta para a tela de confirmação, e a tela é servida como MCP App", async () => {
    const ferramentas = await a.listar();
    assert.ok(URI_TELA.includes(VERSAO_SERVIDOR.replaceAll(".", "-")), "o endereço da tela leva a versão do servidor");
    assert.equal(URI_TELA, `ui://instagram/confirmar-v${VERSAO_SERVIDOR.replaceAll(".", "-")}.html`);

    const comTela = ferramentas.filter((f) => f._meta?.ui && (f._meta.ui as { resourceUri?: string }).resourceUri !== undefined);
    assert.ok(comTela.length > 1, "há ferramentas com tela");
    for (const f of comTela) {
      assert.equal((f._meta?.ui as { resourceUri?: string }).resourceUri, URI_TELA, `${f.name}: _meta.ui.resourceUri`);
      assert.equal(f._meta?.["ui/resourceUri"], URI_TELA, `${f.name}: chave plana`);
    }
    const recursos = await a.cliente.listResources();
    assert.ok(recursos.resources.some((r) => r.uri === URI_TELA), "o resource registrado usa o mesmo endereço");
    const escrita = ferramentas.find((f) => f.name === NOME_ESCRITA_TESTE);
    assert.equal((escrita?._meta?.ui as { resourceUri?: string }).resourceUri, URI_TELA);
    assert.equal(escrita?._meta?.["ui/resourceUri"], URI_TELA, "chave antiga também, para clientes mais velhos");
    const lido = await a.cliente.readResource({ uri: URI_TELA });
    const [conteudo] = lido.contents as Array<{ mimeType?: string; text?: string }>;
    assert.equal(conteudo?.mimeType, RESOURCE_MIME_TYPE);
    const html = conteudo?.text ?? "";
    assert.ok(html.includes(`v${VERSAO_SERVIDOR}`), "o cartão mostra a versão");
    for (const trecho of ["ig_confirmar_tela", "ig_cancelar_pedido", "ig_estado_pedido_tela", "serverTools", "Confirmo o pedido ", "Cancelo o pedido ", "NÃO TEM VOLTA", "clique uma vez e espere", "prefers-color-scheme: dark", "--color-background-primary"]) {
      assert.ok(html.includes(trecho), `a tela não contém "${trecho}"`);
    }
  });

  it("o cartão também é servido no endereço antigo (o Claude Desktop guardou ui://instagram/confirmar.html), igual ao novo", async () => {
    assert.equal(URI_TELA_ANTIGA, "ui://instagram/confirmar.html");
    const recursos = await a.cliente.listResources();
    const uris = recursos.resources.map((r) => r.uri);
    assert.ok(uris.includes(URI_TELA) && uris.includes(URI_TELA_ANTIGA), "resources/list traz os dois endereços");
    const novo = (await a.cliente.readResource({ uri: URI_TELA })).contents as Array<{ mimeType?: string; text?: string; _meta?: unknown }>;
    const antigo = (await a.cliente.readResource({ uri: URI_TELA_ANTIGA })).contents as Array<{ mimeType?: string; text?: string; _meta?: unknown }>;
    assert.equal(antigo[0]?.text, novo[0]?.text);
    assert.equal(antigo[0]?.mimeType, novo[0]?.mimeType);
    assert.deepEqual(antigo[0]?._meta, novo[0]?._meta);
    assert.ok((antigo[0]?.text ?? "").includes(`v${VERSAO_SERVIDOR}`), "o cartão antigo mostra a versão no rodapé");
    for (const f of await a.listar()) {
      if ((f._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri !== undefined) {
        assert.equal((f._meta?.ui as { resourceUri?: string }).resourceUri, URI_TELA);
        assert.equal(f._meta?.["ui/resourceUri"], URI_TELA);
      }
    }
  });

  it("a prévia não envia nada e o código fica só no _meta (nunca no content nem no structuredContent)", async () => {
    const { id, codigo, resultado } = await pedirPrevia();
    assert.match(codigo, /^[0-9a-f]{32}$/, "128 bits em hexadecimal");
    assert.equal(escritas(a.m), 0);
    assert.ok(!JSON.stringify(resultado.content).includes(codigo));
    assert.ok(!JSON.stringify(resultado.structuredContent).includes(codigo));
    assert.ok(!JSON.stringify(resultado._meta?.previa).includes(codigo));
    assert.match(textoDe(resultado), new RegExp(`Prévia ${id} enviada ao cartão.*Nada foi enviado`, "s"));
    assert.deepEqual(
      { titulo: (resultado._meta?.previa as Record<string, any>)?.titulo, alvo: (resultado._meta?.previa as Record<string, any>)?.alvo, texto: (resultado._meta?.previa as Record<string, any>)?.texto, botao: (resultado._meta?.previa as Record<string, any>)?.botao },
      { titulo: "Responder DM em nome de @conta_de_teste", alvo: "@fulano", texto: TEXTO, botao: "Enviar" },
    );
  });

  it("o structuredContent da prévia tem pedido, para_o_claude e se_o_cartao_nao_apareceu, nessa ordem; a prévia inteira vai em _meta.previa", async () => {
    const { id, codigo, resultado } = await pedirPrevia();
    assert.deepEqual(Object.keys(resultado.structuredContent ?? {}), ["pedido", "para_o_claude", "se_o_cartao_nao_apareceu"]);
    const sc = resultado.structuredContent as Record<string, string>;
    assert.equal(sc.pedido, id);
    // Aba Code: o modelo só recebe o structuredContent. A orientação a ele tem de estar aqui e ser igual ao content.
    assert.equal(sc.para_o_claude, textoDe(resultado));
    assert.equal(sc.para_o_claude, textoParaOClaude(id, "Responder DM em nome de @conta_de_teste (para: @fulano)"));
    for (const trecho of [
      `Prévia ${id} enviada ao cartão de confirmação: Responder DM em nome de @conta_de_teste (para: @fulano)`,
      "Nada foi enviado ainda.",
      "o envio sai direto do cartão, sem passar por você",
      "Pare aqui",
      "não chame esta ferramenta de novo",
      "Só chame ig_confirmar com um código que chegar numa mensagem dele; nunca peça nem adivinhe o código.",
      "Se ele disser que viu texto em vez do cartão, nada foi enviado: chame a mesma ferramenta de novo; se repetir, peça Cmd+Q no Claude Desktop.",
    ]) assert.ok(sc.para_o_claude.includes(trecho), trecho);
    // O aviso a quem usa o app é endereçado a essa pessoa, para o modelo não o ler como fato sobre o cartão.
    assert.equal(sc.se_o_cartao_nao_apareceu, AVISO_PARA_QUEM_USA);
    assert.ok(AVISO_PARA_QUEM_USA.startsWith("Para quem usa o Claude Desktop: se este texto apareceu no lugar do cartão"));
    assert.ok(!sc.para_o_claude.includes("Se você está vendo"));
    assert.ok(!JSON.stringify(resultado.structuredContent).includes(codigo));
    const previa = resultado._meta?.previa as Record<string, any>;
    assert.equal(previa.titulo, "Responder DM em nome de @conta_de_teste");
    assert.equal(previa.alvo, "@fulano");
    assert.equal(previa.texto, TEXTO);
    assert.equal(previa.botao, "Enviar");
    assert.equal(previa.valido_por_minutos, 10);
    assert.match(previa.valido_ate, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(previa.miniaturas, 0);
    assert.equal(resultado._meta?.codigo, codigo);
    assert.ok(!JSON.stringify(resultado._meta?.previa).includes(codigo), "o código fica ao lado da prévia, não dentro dela");
  });

  it("o content diz ao Claude o id, o que vai ser feito e para quem, sem o código; igual ao para_o_claude", async () => {
    const { id, codigo, resultado } = await pedirPrevia();
    const t = textoDe(resultado);
    assert.ok(t.includes(`Prévia ${id}`));
    assert.ok(t.includes("Responder DM em nome de @conta_de_teste"));
    assert.ok(t.includes("@fulano"));
    assert.ok(!t.includes(codigo));
    assert.ok(t.includes("Pare aqui"));
    assert.ok(t.includes("Se ele disser que viu texto em vez do cartão, nada foi enviado: chame a mesma ferramenta de novo"));
  });

  it("código errado, vencido ou já usado: recusa e zero escritas na Graph falsa", async () => {
    const { id, codigo } = await pedirPrevia();
    const errado = await a.chamar("ig_confirmar", { id, codigo: "0".repeat(32) });
    assert.equal(errado.isError, true);
    assert.match(textoDe(errado), /Código errado \(1 de 3\)/);
    const idErrado = await a.chamar("ig_confirmar", { id: "naoexiste", codigo });
    assert.equal(idErrado.isError, true);
    assert.equal(escritas(a.m), 0);

    agora += VALIDADE_MS + 1;
    const vencido = await a.chamar("ig_confirmar", { id, codigo });
    assert.equal(vencido.isError, true);
    assert.match(textoDe(vencido), /venceu/);
    assert.equal(escritas(a.m), 0);
  });

  it("código certo envia o corpo guardado byte a byte, uma vez só", async () => {
    const { id, codigo } = await pedirPrevia();
    const ok = await a.chamar("ig_confirmar", { id, codigo });
    assert.ok(!ok.isError, textoDe(ok));
    assert.deepEqual(ok.structuredContent, { pedido: id, estado: "enviado", resultado: { id: "msg_1" } });
    // O texto é uma frase para gente: sem a resposta crua da Meta (ela fica só no structuredContent).
    assert.match(textoDe(ok), new RegExp(`^Pronto \\(pedido ${id}\\): .+ → @fulano\\.$`));
    assert.doesNotMatch(textoDe(ok), /[{}]|msg_1/);
    assert.equal(escritas(a.m), 1);
    const [envio] = a.m.graphFalsa.pedidos.filter((p) => p.metodo === "POST");
    assert.equal(envio?.corpo, JSON.stringify({ texto: TEXTO, para: "@fulano" }), "o corpo enviado é o da prévia, byte a byte");
    assert.equal(envio?.caminho, ROTA_ESCRITA);

    const denovo = await a.chamar("ig_confirmar", { id, codigo });
    assert.equal(denovo.isError, true);
    assert.match(textoDe(denovo), /já foi usado/);
    assert.equal(escritas(a.m), 1);
  });

  it("duas confirmações ao mesmo tempo (duplo clique) enviam uma vez só", async () => {
    const { id, codigo } = await pedirPrevia();
    const [x, y] = await Promise.all([a.chamar("ig_confirmar", { id, codigo }), a.chamar("ig_confirmar", { id, codigo })]);
    assert.equal([x, y].filter((r) => !r.isError).length, 1);
    assert.equal(escritas(a.m), 1);
  });

  it("três códigos errados cancelam o pedido, mesmo que o quarto seja o certo", async () => {
    const { id, codigo } = await pedirPrevia();
    let ultimo: Resultado = { content: [] };
    for (let i = 0; i < MAX_ERROS_DE_CODIGO; i++) ultimo = await a.chamar("ig_confirmar", { id, codigo: `errado${i}` });
    assert.match(textoDe(ultimo), /foi cancelado/);
    const certo = await a.chamar("ig_confirmar", { id, codigo });
    assert.equal(certo.isError, true);
    assert.match(textoDe(certo), /cancelado/);
    assert.equal(escritas(a.m), 0);
  });

  it("ig_confirmar recusa qualquer outro parâmetro além de id, código e texto (nada de corpo novo)", async () => {
    const { id, codigo } = await pedirPrevia();
    for (const extra of [{ corpo: { texto: "outro" } }, { apply: true }]) {
      const r = await a.cliente.callTool({ name: "ig_confirmar", arguments: { id, codigo, ...extra } }).then(
        (x) => x as unknown as Resultado,
        () => ({ isError: true, content: [] }) as Resultado,
      );
      assert.equal(r.isError, true, `aceitou ${JSON.stringify(extra)}`);
    }
    assert.equal(escritas(a.m), 0);
    assert.ok(!(await a.chamar("ig_confirmar", { id, codigo })).isError, "o pedido continua valendo depois das tentativas inválidas");
  });

  it("ig_confirmar_tela faz o mesmo, pelo caminho da tela com serverTools", async () => {
    const { id, codigo } = await pedirPrevia();
    const errada = await a.chamar("ig_confirmar_tela", { id, codigo: "x" });
    assert.equal(errada.isError, true);
    const ok = await a.chamar("ig_confirmar_tela", { id, codigo });
    assert.ok(!ok.isError, textoDe(ok));
    assert.equal(escritas(a.m), 1);
    assert.deepEqual(linhasDoRegistro(a.m).find((l) => l.evento === "enviado")?.confirmacao, "ig_confirmar_tela");
  });

  it("ig_estado_pedido_tela: leitura da tela; diz como está o pedido, sem código e sem gravar no registro", async () => {
    const f = (await a.listar()).find((x) => x.name === "ig_estado_pedido_tela");
    assert.equal(f?.annotations?.readOnlyHint, true);
    assert.match(String((f as { description?: string }).description), /só pela tela de confirmação, ao abrir/);
    const estado = async (id: string) => a.chamar("ig_estado_pedido_tela", { id });
    const { id, codigo } = await pedirPrevia();
    const registroAntes = linhasDoRegistro(a.m).length;

    const pendente = await estado(id);
    assert.deepEqual(pendente.structuredContent, { pedido: id, estado: "pendente" });
    assert.equal((await estado("naoexiste")).structuredContent?.estado, "inexistente");

    const ok = await a.chamar("ig_confirmar_tela", { id, codigo });
    assert.ok(!ok.isError, textoDe(ok));
    const usado = await estado(id);
    assert.equal(usado.structuredContent?.estado, "usado");
    assert.deepEqual((usado.structuredContent?.resultado as Record<string, unknown>), { id: "msg_1" });
    assert.ok(!JSON.stringify(usado).includes(codigo), "nunca devolve o código do pedido");

    const outro = await pedirPrevia();
    agora += VALIDADE_MS + 1;
    const antesDoVencido = linhasDoRegistro(a.m).length;
    assert.equal((await estado(outro.id)).structuredContent?.estado, "expirado");
    assert.equal(linhasDoRegistro(a.m).length, antesDoVencido, "ler o estado de pedido vencido não grava nada no registro");
    assert.ok(registroAntes <= antesDoVencido);

    agora = 1_000_000;
    const terceiro = await pedirPrevia();
    await a.chamar("ig_cancelar_pedido", { id: terceiro.id });
    assert.equal((await estado(terceiro.id)).structuredContent?.estado, "cancelado");
  });

  it("cancelar (ig_cancelar e ig_cancelar_pedido) não envia nada, invalida o código e o registro diz só por qual ferramenta chegou", async () => {
    const origens = { ig_cancelar: "ig_cancelar (chamada pelo modelo)", ig_cancelar_pedido: "ig_cancelar_pedido (clique na tela)" } as const;
    for (const ferramenta of ["ig_cancelar", "ig_cancelar_pedido"] as const) {
      const { id, codigo } = await pedirPrevia();
      const c = await a.chamar(ferramenta, { id });
      assert.ok(!c.isError, textoDe(c));
      assert.match(textoDe(c), /cancelado\. Nada foi enviado/);
      assert.equal((await a.chamar("ig_confirmar", { id, codigo })).isError, true);
      assert.equal(linhasDoRegistro(a.m).find((l) => l.evento === "cancelado" && l.pedido === id)?.origem, origens[ferramenta]);
    }
    assert.equal(escritas(a.m), 0);
    assert.equal((await a.chamar("ig_cancelar", { id: "naoexiste" })).isError, true);
  });

  it("depois de enviado, não dá para cancelar", async () => {
    const { id, codigo } = await pedirPrevia();
    await a.chamar("ig_confirmar", { id, codigo });
    const c = await a.chamar("ig_cancelar", { id });
    assert.equal(c.isError, true);
    assert.match(textoDe(c), /já foi enviado/);
  });

  it("falha da Meta no envio: erro traduzido, pedido gasto (nada de segunda tentativa às cegas), erro no registro", async () => {
    a.m.graphFalsa.rota("POST", ROTA_ESCRITA, erroMeta(10, "sem permissão", 2018108));
    const { id, codigo } = await pedirPrevia();
    const r = await a.chamar("ig_confirmar", { id, codigo });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /code 10/);
    const de = await a.chamar("ig_confirmar", { id, codigo });
    assert.match(textoDe(de), /já foi usado/);
    assert.equal(escritas(a.m), 1);
    assert.equal(linhasDoRegistro(a.m).find((l) => l.evento === "erro")?.pedido, id);
  });

  it("o registro de ações guarda caminho, alvo, texto e resultado, e só os 4 primeiros caracteres do código", async () => {
    const { id, codigo } = await pedirPrevia();
    await a.chamar("ig_confirmar", { id, codigo: "ffff0000" });
    await a.chamar("ig_confirmar", { id, codigo });
    const bruto = readFileSync(a.m.caminhoRegistro, "utf8");
    assert.ok(!bruto.includes(codigo), "o código inteiro nunca entra no registro");
    const linhas = linhasDoRegistro(a.m);
    const enviado = linhas.find((l) => l.evento === "enviado");
    assert.ok(enviado);
    assert.equal(enviado.ferramenta, NOME_ESCRITA_TESTE);
    assert.equal(enviado.alvo, "@fulano");
    assert.equal(enviado.texto, TEXTO);
    assert.equal(enviado.confirmacao, "ig_confirmar");
    assert.equal(enviado.codigo4, codigo.slice(0, 4));
    assert.deepEqual(enviado.resultado, { id: "msg_1" });
    assert.ok(typeof enviado.quando === "string" && !Number.isNaN(Date.parse(enviado.quando)));
    const recusa = linhas.find((l) => l.evento === "recusado");
    assert.equal(recusa?.codigo4, "ffff");
  });

  it("se o registro não puder ser gravado, a escrita já autorizada acontece mesmo assim, com aviso no stderr", async () => {
    const { RegistroAcoes } = await import("../src/registro-acoes.ts");
    const { Pedidos } = await import("../src/confirmacao.ts");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const pasta = mkdtempSync(join(tmpdir(), "ig-mcp-registro-"));
    writeFileSync(join(pasta, "arquivo"), "não é pasta");
    const avisos: string[] = [];
    const pedidos = new Pedidos(new RegistroAcoes(join(pasta, "arquivo", "acoes.jsonl"), (l) => avisos.push(l)));
    let enviados = 0;
    const { id, codigo } = pedidos.criar("ig_x", { a: 1 }, { titulo: "t", conta: "@c", alvo: "@a", botao: "Enviar" }, async () => {
      enviados++;
      return { id: "ok" };
    });
    const decisao = await pedidos.confirmar(id, codigo, "ig_confirmar");
    assert.equal(decisao.ok, true);
    assert.equal(enviados, 1);
    assert.match(avisos[0] ?? "", /não consegui gravar o registro de ações/);
  });

  it("texto com cara de segredo não vira prévia e não cria pedido", async () => {
    const r = await a.chamar(NOME_ESCRITA_TESTE, { texto: "meu token é EAAJmcZCdG8wQBA1234567890abcdefghij ok", para: "@fulano" });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /parece conter um segredo/);
    assert.equal(r._meta?.codigo, undefined);
    assert.equal(escritas(a.m), 0);
  });

  it("pedidos se perdem quando o processo reinicia: nada é enviado", async () => {
    const { id, codigo } = await pedirPrevia();
    const outro = await ambiente({ comTela: true });
    try {
      const r = await outro.chamar("ig_confirmar", { id, codigo });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /não existe/);
      assert.equal(escritas(outro.m), 0);
    } finally {
      await outro.fechar();
    }
  });
});

describe("tela com miniaturas e ação sem volta", () => {
  const foto = (n: number) => `data:image/jpeg;base64,${"A".repeat(n)}`;

  it("miniaturas vão só no _meta; a contagem vai em _meta.previa; apagar começa com NÃO TEM VOLTA", async () => {
    const miniaturas = [foto(500), foto(500), foto(500)];
    const a = await ambiente({ comTela: true, escrita: { miniaturas, irreversivel: true } });
    try {
      const r = await a.chamar(NOME_ESCRITA_TESTE, { texto: "apagar isto" });
      assert.deepEqual(r._meta?.miniaturas, miniaturas);
      assert.equal((r._meta?.previa as Record<string, any>)?.miniaturas, 3);
      assert.ok(!JSON.stringify(r._meta?.previa).includes("base64"));
      assert.ok(!JSON.stringify(r.structuredContent).includes("base64"));
      assert.ok(!JSON.stringify(r.content).includes("base64"));
      assert.equal((r._meta?.previa as Record<string, any>)?.irreversivel, true);
      assert.equal((r._meta?.previa as Record<string, any>)?.botao, "Apagar");
    } finally {
      await a.fechar();
    }
  });

  it("miniaturas acima do teto são recusadas, com a mensagem pedindo menores", async () => {
    const a = await ambiente({ comTela: true, escrita: { miniaturas: [foto(TETO_MINIATURAS_CARACTERES)] } });
    try {
      const r = await a.chamar(NOME_ESCRITA_TESTE, { texto: "oi" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /Miniaturas grandes demais/);
    } finally {
      await a.fechar();
    }
  });
});

describe("reserva: janela do macOS (cliente sem MCP Apps)", () => {
  let janela: JanelaFalsa;
  let a: Ambiente;
  beforeEach(async () => {
    janela = new JanelaFalsa();
    a = await ambiente({ comTela: false, janela });
  });
  afterEach(async () => {
    await a.fechar();
  });

  it("aceitar: envia o corpo guardado, uma vez, e registra o caminho janela-mac", async () => {
    janela.comportamento = "aceita";
    const r = await a.chamar(NOME_ESCRITA_TESTE, { texto: TEXTO, para: "@fulano" });
    assert.ok(!r.isError, textoDe(r));
    assert.equal(escritas(a.m), 1);
    assert.equal(r._meta, undefined, "sem tela, nada de código no resultado");
    assert.deepEqual(r.structuredContent, { pedido: r.structuredContent?.pedido, estado: "enviado", confirmacao: "janela-mac", resultado: { id: "msg_1" } });
    assert.match(textoDe(r), /^Pronto \(pedido \w+\), depois do clique do dono da conta na janela do Mac: .+ → @fulano\.$/);
    assert.doesNotMatch(textoDe(r), /[{}]|msg_1/);
    const enviado = linhasDoRegistro(a.m).find((l) => l.evento === "enviado");
    assert.equal(enviado?.confirmacao, "janela-mac");
    assert.equal(enviado?.codigo4, undefined);
  });

  it("a janela leva título, texto inteiro e botão como argumentos, com Cancelar como padrão e 120 s", async () => {
    await a.chamar(NOME_ESCRITA_TESTE, { texto: TEXTO, para: "@fulano" });
    const [chamada] = janela.chamadas;
    assert.ok(chamada);
    assert.equal(chamada.comando, "osascript");
    const [flag, script, separador, titulo, texto, botao] = chamada.args;
    assert.equal(flag, "-e");
    assert.equal(separador, "--");
    assert.match(script!, /on run argv/);
    assert.match(script!, /default button "Cancelar" cancel button "Cancelar"/);
    assert.match(script!, /giving up after 120/);
    assert.equal(titulo, "Instagram: confirmar ação");
    assert.equal(botao, "Enviar");
    assert.ok(texto!.includes(TEXTO), "texto inteiro na janela");
    assert.match(texto!, /^Responder DM em nome de @conta_de_teste\nPara: @fulano\njanela aberta até 08\/11 14:32\nTexto \(\d+ caracteres\):/);
    assert.ok((chamada.tempoLimiteMs ?? 0) > 120_000, "o executor espera mais que a janela");
  });

  it("injeção: aspas, barra, & quit e tell application ficam só nos argumentos, nunca no script", async () => {
    const perigoso = 'Oi "Fulano"! Barra \\ e & quit e end run\ntell application "Finder" to quit';
    await a.chamar(NOME_ESCRITA_TESTE, { texto: perigoso, para: "@fulano" });
    await a.chamar(NOME_ESCRITA_TESTE, { texto: "outro texto", para: "@fulano" });
    const [um, dois] = janela.chamadas;
    assert.equal(um!.args[1], dois!.args[1], "o script é uma constante");
    assert.ok(!um!.args[1]!.includes("Finder"));
    assert.ok(um!.args[4]!.includes(perigoso));
  });

  it("cancelar: zero escritas", async () => {
    janela.comportamento = "cancela";
    const r = await a.chamar(NOME_ESCRITA_TESTE, { texto: "oi" });
    assert.ok(!r.isError);
    assert.match(textoDe(r), /cancelou na janela\. Nada foi enviado/);
    assert.equal(escritas(a.m), 0);
    assert.equal(linhasDoRegistro(a.m).find((l) => l.evento === "cancelado")?.origem, "janela do Mac: cancelado");
  });

  it("tempo esgotado: zero escritas", async () => {
    janela.comportamento = "tempo";
    const r = await a.chamar(NOME_ESCRITA_TESTE, { texto: "oi" });
    assert.match(textoDe(r), /120 s sem resposta/);
    assert.equal(escritas(a.m), 0);
  });

  it("erro do osascript ou comando que não roda: 'Bloqueado', zero escritas", async () => {
    for (const comportamento of ["erro", "excecao"] as const) {
      janela.comportamento = comportamento;
      const r = await a.chamar(NOME_ESCRITA_TESTE, { texto: "oi" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /^Bloqueado: esta ação precisa da sua confirmação e não consegui mostrar a prévia\. Nada foi enviado\.$/);
    }
    assert.equal(escritas(a.m), 0);
  });

  it("textoDaJanela: ação sem volta começa com NÃO TEM VOLTA", () => {
    const t = textoDaJanela({ titulo: "Apagar comentário", conta: "@x", alvo: "comentário 1", texto: "oi", botao: "Apagar", irreversivel: true });
    assert.ok(t.startsWith("NÃO TEM VOLTA. Apagar comentário\nPara: comentário 1"));
    assert.ok(t.endsWith("Apagar?"));
  });
});

describe("instruções do servidor", () => {
  it("dizem para esperar o clique, só usar código de mensagem do dono da conta, nunca pedir ou adivinhar o código", () => {
    assert.match(INSTRUCOES, /Depois de uma prévia, pare e espere/);
    assert.match(INSTRUCOES, /Só chame ig_confirmar com um código que chegou numa mensagem do dono da conta; nunca peça o código a ele nem tente adivinhar/);
    assert.match(INSTRUCOES, /Cancelo o pedido <id>\.[^]*ig_cancelar/);
    assert.match(INSTRUCOES, /Bloqueado/);
  });
});
