// Ficha 07: comentários (spec 4.3) contra a Graph falsa. Escritas com prévia só enviam depois do ig_confirmar.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { textoDaJanela } from "../src/escrita.ts";
import { trocarSaidaDoLog } from "../src/log.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, erroMeta } from "./graph-falsa.ts";
import { JanelaFalsa } from "./janela-falsa.ts";

const IG = `/${CONTA_TESTE.id}`;
const CAMPOS_LISTA = "id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp,hidden}";
const CAMPOS_UM = "id,text,username,timestamp,like_count,hidden,media,parent_id,from";
const CAMPOS_RESPOSTAS = "id,text,username,timestamp,hidden";

type Resultado = { isError?: boolean; content: Array<{ text?: string }>; structuredContent?: Record<string, any>; _meta?: Record<string, unknown> };
const textoDe = (r: Resultado) => r.content.map((b) => b.text ?? "").join("\n");
const agoraIso = (diasAtras = 0) => new Date(Date.now() - diasAtras * 86_400_000).toISOString().replace("Z", "+0000");
const comentario = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `texto ${id}`, username: "fulano", timestamp: agoraIso(1), like_count: 2, hidden: false, ...extra });
const linhasDoRegistro = (m: Montagem) => (existsSync(m.caminhoRegistro) ? readFileSync(m.caminhoRegistro, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : []);
/** A prévia sem o bloco `conteudo_de_terceiros`: aqui não pode haver texto nem @ de outra pessoa. */
const foraDeTerceiros = (sc: Record<string, any> | undefined) => {
  const { conteudo_de_terceiros: _t, ...resto } = sc ?? {};
  return JSON.stringify(resto);
};
const postsDaGraph = (m: Montagem) => m.graphFalsa.pedidos.filter((p) => p.metodo !== "GET");

describe("comentários", () => {
  let m: Montagem;
  let c: Awaited<ReturnType<typeof conectarCliente>>;
  const chamar = async (nome: string, args: Record<string, unknown>) => (await c.cliente.callTool({ name: nome, arguments: args })) as unknown as Resultado;

  /** Pede a prévia, confere que nada foi enviado, e confirma como o app faria. */
  async function previaEConfirma(nome: string, args: Record<string, unknown>) {
    const antes = postsDaGraph(m).length;
    const previa = await chamar(nome, args);
    assert.ok(!previa.isError, textoDe(previa));
    assert.equal(postsDaGraph(m).length, antes, "a prévia não pode enviar nada");
    const id = String(previa.structuredContent?.pedido);
    const codigo = String(previa._meta?.codigo);
    const confirmado = await chamar("ig_confirmar", { id, codigo });
    return { previa, confirmado };
  }

  beforeEach(async () => {
    m = await montar();
    c = await conectarCliente(m.ctx, { comTela: true });
  });
  afterEach(async () => {
    await c.fechar();
    await m.fechar();
  });

  describe("leitura", () => {
    it("ig_listar_comentarios: campos, limite padrão 25, texto em conteudo_de_terceiros", async () => {
      m.graphFalsa.rota("GET", "/M1/comments", {
        corpo: { data: [comentario("c1", { replies: { data: [comentario("r1")] } })], paging: { cursors: { after: "XYZ" }, next: "u" } },
      });
      const r = await chamar("ig_listar_comentarios", { midia_id: "M1" });
      assert.ok(!r.isError, textoDe(r));
      const [p] = m.graphFalsa.pedidos;
      assert.equal(p!.query.fields, CAMPOS_LISTA);
      assert.equal(p!.query.limit, "25");
      const d = r.structuredContent!;
      assert.equal(d.proximo, "XYZ");
      assert.equal(d.comentarios[0].id, "c1");
      assert.equal(d.comentarios[0].conteudo_de_terceiros.texto, "texto c1");
      assert.equal(d.comentarios[0].conteudo_de_terceiros.username, "fulano");
      assert.equal(d.comentarios[0].respostas[0].conteudo_de_terceiros.texto, "texto r1");
      assert.equal(d.comentarios[0].texto, undefined);
    });

    it("ig_listar_comentarios: limite acima de 50 é recusado e depois vira after", async () => {
      m.graphFalsa.rota("GET", "/M1/comments", { corpo: { data: [] } });
      assert.equal((await chamar("ig_listar_comentarios", { midia_id: "M1", limite: 51 })).isError, true);
      await chamar("ig_listar_comentarios", { midia_id: "M1", limite: 50, depois: "AAA" });
      const p = m.graphFalsa.pedidos.at(-1)!;
      assert.equal(p.query.limit, "50");
      assert.equal(p.query.after, "AAA");
    });

    it("ig_ver_comentario: campos e conteúdo de terceiros", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1", { media: { id: "M1" }, parent_id: "c0", from: { id: "99", username: "fulano" } }) });
      const r = await chamar("ig_ver_comentario", { comentario_id: "c1" });
      assert.ok(!r.isError, textoDe(r));
      assert.equal(m.graphFalsa.pedidos[0]!.query.fields, CAMPOS_UM);
      assert.equal(r.structuredContent!.media_id, "M1");
      assert.equal(r.structuredContent!.parent_id, "c0");
      assert.equal(r.structuredContent!.conteudo_de_terceiros.texto, "texto c1");
    });

    it("ig_ver_comentario: comentário apagado (100/33) vira frase em português", async () => {
      m.graphFalsa.rota("GET", "/c1", erroMeta(100, "Object does not exist", 33));
      const r = await chamar("ig_ver_comentario", { comentario_id: "c1" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /não existe/);
    });

    it("ig_listar_respostas: caminho e campos", async () => {
      m.graphFalsa.rota("GET", "/c1/replies", { corpo: { data: [comentario("r1"), comentario("r2")] } });
      const r = await chamar("ig_listar_respostas", { comentario_id: "c1" });
      assert.ok(!r.isError, textoDe(r));
      assert.equal(m.graphFalsa.pedidos[0]!.query.fields, CAMPOS_RESPOSTAS);
      assert.equal(r.structuredContent!.respostas.length, 2);
      assert.equal(r.structuredContent!.respostas[1].conteudo_de_terceiros.texto, "texto r2");
    });

    it("ID com barra ou interrogação é recusado", async () => {
      assert.equal((await chamar("ig_ver_comentario", { comentario_id: "c1/replies" })).isError, true);
      assert.equal(m.graphFalsa.pedidos.length, 0);
    });
  });

  describe("ig_responder_comentario", () => {
    it("texto só com espaços: recusa antes de qualquer chamada", async () => {
      const r = await chamar("ig_responder_comentario", { comentario_id: "c1", texto: "   " });
      assert.equal(r.isError, true);
      assert.equal(textoDe(r), "O texto está vazio.");
      assert.equal(m.graphFalsa.pedidos.length, 0);
    });

    it("comentário que não existe: erro traduzido e nenhum pedido aberto (apagar também)", async () => {
      m.graphFalsa.rota("GET", "/c1", erroMeta(100, "Object does not exist", 33));
      for (const [nome, args] of [["ig_responder_comentario", { comentario_id: "c1", texto: "Oi" }], ["ig_apagar_comentario", { comentario_id: "c1" }]] as const) {
        const r = await chamar(nome, args);
        assert.equal(r.isError, true, nome);
        assert.match(textoDe(r), /não existe/, nome);
        assert.equal(r.structuredContent?.pedido, undefined, nome);
      }
    });

    it("mostra a prévia com o comentário original, não envia, e só depois do ig_confirmar faz POST /{c}/replies com message", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1", { text: "Que post lindo!" }) });
      m.graphFalsa.rota("POST", "/c1/replies", { corpo: { id: "r9" } });
      const { previa, confirmado } = await previaEConfirma("ig_responder_comentario", { comentario_id: "c1", texto: "Obrigado!" });
      assert.equal((previa._meta?.previa as Record<string, any>)?.texto, "Obrigado!");
      assert.match(JSON.stringify((previa._meta?.previa as Record<string, any>)?.conteudo_de_terceiros), /@fulano/);
      assert.match(JSON.stringify((previa._meta?.previa as Record<string, any>)?.conteudo_de_terceiros), /Que post lindo!/);
      assert.doesNotMatch(foraDeTerceiros(previa._meta?.previa as Record<string, any>), /fulano|Que post lindo/, "terceiros só dentro de conteudo_de_terceiros");
      assert.ok(!confirmado.isError, textoDe(confirmado));
      const [post] = postsDaGraph(m);
      assert.equal(post!.metodo, "POST");
      assert.equal(post!.caminho, "/c1/replies");
      assert.deepEqual(JSON.parse(post!.corpo), { message: "Obrigado!" });
      assert.equal(confirmado.structuredContent!.resultado.id, "r9");
    });

    it("recusa comentário oculto, sem pedido nem POST", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1", { hidden: true }) });
      const r = await chamar("ig_responder_comentario", { comentario_id: "c1", texto: "Oi" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /oculto/);
      assert.equal(postsDaGraph(m).length, 0);
      assert.equal(r.structuredContent?.pedido, undefined);
    });

    it("responder a uma RESPOSTA (parent_id) é aceito, com aviso na prévia (diário P19)", async () => {
      m.graphFalsa.rota("GET", "/r1", { corpo: comentario("r1", { parent_id: "c0" }) });
      m.graphFalsa.rota("POST", "/r1/replies", { corpo: { id: "r2" } });
      const { confirmado } = await previaEConfirma("ig_responder_comentario", { comentario_id: "r1", texto: "Oi" });
      assert.ok(!confirmado.isError, textoDe(confirmado));
      assert.equal(postsDaGraph(m)[0]!.caminho, "/r1/replies");
    });

    it("no registro de ações a linha traz ferramenta, alvo e texto", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      m.graphFalsa.rota("POST", "/c1/replies", { corpo: { id: "r9" } });
      await previaEConfirma("ig_responder_comentario", { comentario_id: "c1", texto: "Valeu" });
      const linha = linhasDoRegistro(m).find((l) => l.evento === "enviado")!;
      assert.equal(linha.ferramenta, "ig_responder_comentario");
      assert.equal(linha.texto, "Valeu");
    });
  });

  describe("ig_comentar_midia", () => {
    beforeEach(() => {
      m.graphFalsa.rota("GET", "/M1", { corpo: { id: "M1" } });
    });

    it("texto só com espaços: recusa antes de qualquer chamada, com a frase da DM", async () => {
      const r = await chamar("ig_comentar_midia", { midia_id: "M1", texto: "   " });
      assert.equal(r.isError, true);
      assert.equal(textoDe(r), "O texto está vazio.");
      assert.equal(m.graphFalsa.pedidos.length, 0);
    });

    it("mídia que não existe: o erro traduzido da Meta e nenhum pedido aberto", async () => {
      m.graphFalsa.rota("GET", "/M1", erroMeta(100, "Object does not exist", 33));
      const r = await chamar("ig_comentar_midia", { midia_id: "M1", texto: "Oi" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /não existe/);
      assert.equal(r.structuredContent?.pedido, undefined);
      assert.equal(postsDaGraph(m).length, 0);
    });

    it("POST /{midia}/comments com message, só depois do ig_confirmar", async () => {
      m.graphFalsa.rota("POST", "/M1/comments", { corpo: { id: "c9" } });
      const { confirmado } = await previaEConfirma("ig_comentar_midia", { midia_id: "M1", texto: "Primeiro!" });
      assert.ok(!confirmado.isError, textoDe(confirmado));
      const [post] = postsDaGraph(m);
      assert.equal(post!.caminho, "/M1/comments");
      assert.deepEqual(JSON.parse(post!.corpo), { message: "Primeiro!" });
    });

    it("comentários desligados (9008/4928001) viram 'comentários deste post estão desligados'", async () => {
      m.graphFalsa.rota("POST", "/M1/comments", erroMeta(9008, "Media ID is not found", 4928001));
      const { confirmado } = await previaEConfirma("ig_comentar_midia", { midia_id: "M1", texto: "Oi" });
      assert.equal(confirmado.isError, true);
      assert.match(textoDe(confirmado), /comentários deste post estão desligados/);
    });
  });

  describe("ig_responder_no_privado", () => {
    it("POST /{ig}/messages com recipient.comment_id e message.text, e grava o ID só depois do sucesso", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1", { timestamp: agoraIso(2) }) });
      m.graphFalsa.rota("POST", `${IG}/messages`, { corpo: { recipient_id: "99", message_id: "m1" } });
      const antes = await chamar("ig_responder_no_privado", { comentario_id: "c1", texto: "Aqui vai o link" });
      assert.ok(!antes.isError, textoDe(antes));
      assert.equal(existsSync(m.caminhoPrivados), false, "nada gravado antes do envio");
      const confirmado = await chamar("ig_confirmar", { id: String(antes.structuredContent!.pedido), codigo: String(antes._meta!.codigo) });
      assert.ok(!confirmado.isError, textoDe(confirmado));
      const [post] = postsDaGraph(m);
      assert.equal(post!.caminho, `${IG}/messages`);
      assert.deepEqual(JSON.parse(post!.corpo), { recipient: { comment_id: "c1" }, message: { text: "Aqui vai o link" } });
      assert.ok(Object.hasOwn(JSON.parse(readFileSync(m.caminhoPrivados, "utf8")), "c1"));
    });

    it("recusa comentário com 8 dias, sem pedido", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1", { timestamp: agoraIso(8) }) });
      const r = await chamar("ig_responder_no_privado", { comentario_id: "c1", texto: "Oi" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /7 dias/);
      assert.equal(postsDaGraph(m).length, 0);
    });

    it("aceita comentário com 6 dias", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1", { timestamp: agoraIso(6) }) });
      assert.ok(!(await chamar("ig_responder_no_privado", { comentario_id: "c1", texto: "Oi" })).isError);
    });

    it("a prévia não leva @ nem texto do comentário fora de conteudo_de_terceiros", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1", { text: "me chama no privado" }) });
      const previa = await chamar("ig_responder_no_privado", { comentario_id: "c1", texto: "Oi" });
      assert.ok(!previa.isError, textoDe(previa));
      assert.doesNotMatch(foraDeTerceiros(previa._meta?.previa as Record<string, any>), /fulano|me chama no privado/);
      assert.match(JSON.stringify((previa._meta?.previa as Record<string, any>)?.conteudo_de_terceiros), /@fulano/);
    });

    it("recusa ID já respondido (privados.json), sem pedido", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      m.graphFalsa.rota("POST", `${IG}/messages`, { corpo: { recipient_id: "99", message_id: "m1" } });
      await previaEConfirma("ig_responder_no_privado", { comentario_id: "c1", texto: "Oi" });
      m.graphFalsa.limparPedidos();
      const r = await chamar("ig_responder_no_privado", { comentario_id: "c1", texto: "De novo" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /já recebeu uma resposta no privado/);
      assert.equal(postsDaGraph(m).length, 0);
    });

    it("2534023 (já respondido, por exemplo pelo app do Instagram) é traduzido e GRAVA o ID no privados.json", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      m.graphFalsa.rota("POST", `${IG}/messages`, erroMeta(-1, "O comentário ... já tem uma resposta.", 2534023));
      const { confirmado } = await previaEConfirma("ig_responder_no_privado", { comentario_id: "c1", texto: "Oi" });
      assert.equal(confirmado.isError, true);
      assert.match(textoDe(confirmado), /só permite uma por comentário/);
      assert.ok(Object.hasOwn(JSON.parse(readFileSync(m.caminhoPrivados, "utf8")), "c1"), "o ID entra no privados.json");
      m.graphFalsa.limparPedidos();
      const de_novo = await chamar("ig_responder_no_privado", { comentario_id: "c1", texto: "De novo" });
      assert.match(textoDe(de_novo), /já recebeu uma resposta no privado/, "da próxima vez recusa antes da prévia");
      assert.equal(postsDaGraph(m).length, 0);
    });

    it("se não conseguir gravar o privados.json, o aviso sai por log() (limpo de segredo)", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      m.graphFalsa.rota("POST", `${IG}/messages`, { corpo: { recipient_id: "99", message_id: "m1" } });
      // Pasta só de leitura: a leitura dá "não existe", a gravação falha, mas o envio já foi feito.
      const { chmodSync, mkdirSync } = await import("node:fs");
      const { dirname, join } = await import("node:path");
      const somenteLeitura = join(dirname(m.caminhoPrivados), "so-leitura");
      mkdirSync(somenteLeitura);
      chmodSync(somenteLeitura, 0o500);
      (m.ctx as { caminhoPrivados: string }).caminhoPrivados = join(somenteLeitura, "privados.json");
      const linhas: string[] = [];
      const restaurar = trocarSaidaDoLog((l) => linhas.push(l));
      try {
        const { confirmado } = await previaEConfirma("ig_responder_no_privado", { comentario_id: "c1", texto: "Oi" });
        assert.ok(!confirmado.isError, textoDe(confirmado));
      } finally {
        restaurar();
        chmodSync(somenteLeitura, 0o700);
      }
      assert.ok(linhas.some((l) => /não consegui gravar privados\.json/.test(l)), linhas.join("\n"));
    });

    it("outra falha da Meta (ex.: 190) não grava o ID", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      m.graphFalsa.rota("POST", `${IG}/messages`, erroMeta(190, "token"));
      const { confirmado } = await previaEConfirma("ig_responder_no_privado", { comentario_id: "c1", texto: "Oi" });
      assert.equal(confirmado.isError, true);
      assert.equal(existsSync(m.caminhoPrivados), false);
    });

    it("texto com mais de 1000 bytes é recusado", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      const r = await chamar("ig_responder_no_privado", { comentario_id: "c1", texto: "é".repeat(501) });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /1000 bytes/);
    });
  });

  describe("ig_apagar_comentario", () => {
    it("a prévia é irreversível (NÃO TEM VOLTA) e mostra autor e texto; DELETE só depois do ig_confirmar", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1", { text: "comentário chato" }) });
      m.graphFalsa.rota("DELETE", "/c1", { corpo: { success: true } });
      const { previa, confirmado } = await previaEConfirma("ig_apagar_comentario", { comentario_id: "c1" });
      assert.equal((previa._meta?.previa as Record<string, any>)?.irreversivel, true);
      assert.equal((previa._meta?.previa as Record<string, any>)?.botao, "Apagar");
      assert.match(JSON.stringify((previa._meta?.previa as Record<string, any>)?.conteudo_de_terceiros), /comentário chato/);
      assert.doesNotMatch(foraDeTerceiros(previa._meta?.previa as Record<string, any>), /fulano|comentário chato/, "terceiros só dentro de conteudo_de_terceiros");
      assert.equal((previa._meta?.previa as Record<string, any>)?.texto, undefined, "o texto alheio não é texto enviado");
      assert.match(textoDaJanela(previa._meta?.previa as never), /comentário chato/, "a janela do Mac ainda mostra o comentário");
      assert.ok(textoDaJanela(previa._meta?.previa as never).startsWith("NÃO TEM VOLTA"));
      assert.ok(!confirmado.isError, textoDe(confirmado));
      assert.equal(postsDaGraph(m)[0]!.metodo, "DELETE");
      assert.equal(postsDaGraph(m)[0]!.caminho, "/c1");
      const enviado = linhasDoRegistro(m).find((l) => l.evento === "enviado");
      assert.equal(enviado!.texto, undefined, "o registro não chama o comentário alheio de texto enviado");
      assert.match(String(enviado!.descricao), /apagou o comentário c1 de @fulano/);
    });

    it("o resultado de sucesso do ig_confirmar sai limpo de token", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      m.graphFalsa.rota("DELETE", "/c1", { corpo: { success: true, eco: "EAAabcdefghijklmnopqrstuvwxyz" } });
      const { confirmado } = await previaEConfirma("ig_apagar_comentario", { comentario_id: "c1" });
      assert.ok(!confirmado.isError, textoDe(confirmado));
      assert.doesNotMatch(JSON.stringify(confirmado), /EAAabcdefgh/);
    });

    it("o resultado de sucesso da janela do Mac sai limpo de token", async () => {
      const janela = new JanelaFalsa();
      janela.comportamento = "aceita";
      const m2 = await montar({ executar: janela.executar });
      const c2 = await conectarCliente(m2.ctx);
      try {
        m2.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
        m2.graphFalsa.rota("DELETE", "/c1", { corpo: { success: true, eco: "EAAabcdefghijklmnopqrstuvwxyz" } });
        const r = await c2.cliente.callTool({ name: "ig_apagar_comentario", arguments: { comentario_id: "c1" } });
        assert.match(JSON.stringify(r), /depois do clique do dono da conta na janela do Mac/);
        assert.doesNotMatch(JSON.stringify(r), /EAAabcdefgh/);
      } finally {
        await c2.fechar();
        await m2.fechar();
      }
    });

    it("com a janela do Mac (cliente sem tela), a janela começa com NÃO TEM VOLTA", async () => {
      const janela = new JanelaFalsa();
      const m2 = await montar({ executar: janela.executar });
      const c2 = await conectarCliente(m2.ctx);
      try {
        m2.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
        m2.graphFalsa.rota("DELETE", "/c1", { corpo: { success: true } });
        await c2.cliente.callTool({ name: "ig_apagar_comentario", arguments: { comentario_id: "c1" } });
        assert.match(JSON.stringify(janela.chamadas), /NÃO TEM VOLTA/);
      } finally {
        await c2.fechar();
        await m2.fechar();
      }
    });
  });

  describe("sem janela de confirmação", () => {
    it("ig_esconder_comentario lê o estado, faz POST /{c}?hide=true direto e registra anterior e novo", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: { id: "c1", hidden: false, username: "fulano" } });
      m.graphFalsa.rota("POST", "/c1", { corpo: { success: true } });
      const r = await chamar("ig_esconder_comentario", { comentario_id: "c1", esconder: true });
      assert.ok(!r.isError, textoDe(r));
      assert.equal(r.structuredContent?.pedido, undefined, "não cria pedido de confirmação");
      const [post] = postsDaGraph(m);
      assert.equal(post!.metodo, "POST");
      assert.equal(post!.caminho, "/c1");
      assert.equal(post!.query.hide, "true");
      const linha = linhasDoRegistro(m).find((l) => l.ferramenta === "ig_esconder_comentario")!;
      assert.equal(linha.evento, "enviado");
      assert.deepEqual(linha.estado_anterior, { hidden: false });
      assert.deepEqual(linha.estado_novo, { hidden: true });
      assert.deepEqual(r.structuredContent!.estado_anterior, { hidden: false });
      // Mesmo formato do registro de ig_reagir_dm (escrita direta): confirmação não exigida e como desfazer.
      assert.equal(linha.confirmacao, "nao-exigida");
      assert.equal(linha.desfazer, "ig_esconder_comentario com esconder: false");
    });

    it("mostrar de novo manda hide=false", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: { id: "c1", hidden: true } });
      m.graphFalsa.rota("POST", "/c1", { corpo: { success: true } });
      await chamar("ig_esconder_comentario", { comentario_id: "c1", esconder: false });
      assert.equal(postsDaGraph(m)[0]!.query.hide, "false");
    });

    it("se já está no estado pedido, não faz POST", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: { id: "c1", hidden: true } });
      const r = await chamar("ig_esconder_comentario", { comentario_id: "c1", esconder: true });
      assert.ok(!r.isError, textoDe(r));
      assert.equal(postsDaGraph(m).length, 0);
    });

    it("erro da Meta ao esconder vira isError e entra no registro", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: { id: "c1", hidden: false } });
      m.graphFalsa.rota("POST", "/c1", erroMeta(100, "x", 33));
      const r = await chamar("ig_esconder_comentario", { comentario_id: "c1", esconder: true });
      assert.equal(r.isError, true);
      assert.ok(linhasDoRegistro(m).some((l) => l.evento === "erro" && l.ferramenta === "ig_esconder_comentario"));
    });

    it("ig_ligar_comentarios lê is_comment_enabled, faz POST /{midia}?comment_enabled=false direto e registra", async () => {
      m.graphFalsa.rota("GET", "/M1", { corpo: { id: "M1", is_comment_enabled: true } });
      m.graphFalsa.rota("POST", "/M1", { corpo: { success: true } });
      const r = await chamar("ig_ligar_comentarios", { midia_id: "M1", ligado: false });
      assert.ok(!r.isError, textoDe(r));
      assert.equal(r.structuredContent?.pedido, undefined);
      assert.equal(m.graphFalsa.pedidos[0]!.query.fields, "id,is_comment_enabled");
      const [post] = postsDaGraph(m);
      assert.equal(post!.caminho, "/M1");
      assert.equal(post!.query.comment_enabled, "false");
      const linha = linhasDoRegistro(m).find((l) => l.ferramenta === "ig_ligar_comentarios")!;
      assert.deepEqual(linha.estado_anterior, { is_comment_enabled: true });
      assert.deepEqual(linha.estado_novo, { is_comment_enabled: false });
      assert.equal(linha.confirmacao, "nao-exigida");
      assert.equal(linha.desfazer, "ig_ligar_comentarios com ligado: true");
    });

    it("não são ferramentas de prévia: sem _meta.ui", async () => {
      const { tools } = await c.cliente.listTools();
      for (const nome of ["ig_esconder_comentario", "ig_ligar_comentarios"]) {
        const t = tools.find((x) => x.name === nome)!;
        assert.equal((t._meta as { ui?: unknown } | undefined)?.ui, undefined, nome);
        assert.equal(t.annotations?.readOnlyHint, false);
      }
      for (const nome of ["ig_responder_comentario", "ig_comentar_midia", "ig_responder_no_privado", "ig_apagar_comentario"]) {
        assert.ok((tools.find((x) => x.name === nome)!._meta as { ui?: unknown }).ui, nome);
      }
      assert.equal(tools.find((x) => x.name === "ig_apagar_comentario")!.annotations?.destructiveHint, true);
    });
  });
});
