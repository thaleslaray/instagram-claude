// Ficha 16: as ferramentas de escrita com texto oferecem a edição no cartão, com as MESMAS regras da própria ferramenta.
// Graph falsa, S3 não usado (fotos por URL) e janela do Mac falsa: nada sai de verdade.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE } from "./graph-falsa.ts";

const IG = CONTA_TESTE.id;
const PESSOA = "17841400000000001";
const data = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+0000");
const conversa = { id: "conv1", updated_time: data(Date.now()), participants: { data: [{ id: PESSOA, username: "fulano" }, { id: IG, username: CONTA_TESTE.username }] } };

type Resultado = { isError?: boolean; content: Array<{ text?: string }>; structuredContent?: Record<string, any>; _meta?: Record<string, any> };
const textoDe = (r: Resultado): string => r.content.map((b) => b.text ?? "").join("\n");
const codigoEditado = (codigo: string, texto: string): string => createHash("sha256").update(`${codigo}\n${texto}`, "utf8").digest("hex").slice(0, 32);

describe("texto editável nas ferramentas de escrita", () => {
  let m: Montagem;
  let c: Awaited<ReturnType<typeof conectarCliente>>;
  const chamar = async (nome: string, args: Record<string, unknown>): Promise<Resultado> => (await c.cliente.callTool({ name: nome, arguments: args })) as unknown as Resultado;
  const posts = () => m.graphFalsa.pedidos.filter((p) => p.metodo === "POST");
  const corpoDoUltimoPost = () => JSON.parse(posts().at(-1)!.corpo) as Record<string, any>;
  const comentario = (id: string) => ({ id, text: "Que post lindo!", username: "fulano", timestamp: new Date(Date.now() - 86_400_000).toISOString().replace("Z", "+0000"), like_count: 0, hidden: false });

  /** Pede a prévia e tenta confirmar com o texto editado, como o cartão faz. */
  async function editar(ferramenta: string, args: Record<string, unknown>, novo: string) {
    const previa = await chamar(ferramenta, args);
    assert.ok(!previa.isError, textoDe(previa));
    const id = String(previa.structuredContent?.pedido);
    const codigo = String(previa._meta?.codigo);
    return { previa, id, codigo, confirmar: (texto: string = novo) => chamar("ig_confirmar", { id, codigo: codigoEditado(codigo, texto), texto }) };
  }

  beforeEach(async () => {
    m = await montar();
    m.ctx.conta.arroba = CONTA_TESTE.username;
    c = await conectarCliente(m.ctx, { comTela: true });
    m.graphFalsa.rota("GET", `/${IG}/conversations`, { corpo: { data: [conversa] } });
    m.graphFalsa.rota("GET", "/conv1", { corpo: { messages: { data: [{ id: "mid.dela", created_time: data(Date.now() - 3_600_000), from: { id: PESSOA, username: "fulano" } }] } } });
    m.graphFalsa.rota("POST", `/${IG}/messages`, { corpo: { recipient_id: PESSOA, message_id: "mid.enviada" } });
  });
  afterEach(async () => {
    await c.fechar();
    await m.fechar();
  });

  describe("ig_responder_dm (1.000 bytes em UTF-8)", () => {
    it("a prévia oferece edição em bytes e o texto editado é o que vai para a Meta", async () => {
      const e = await editar("ig_responder_dm", { usuario_id: PESSOA, texto: "Oi!" }, "Oi, tudo bem? 😀");
      assert.deepEqual((e.previa._meta?.previa as Record<string, any>)?.texto_editavel, { limite: 1000, unidade: "bytes" });
      const ok = await e.confirmar();
      assert.ok(!ok.isError, textoDe(ok));
      assert.deepEqual(corpoDoUltimoPost(), { recipient: { id: PESSOA }, message: { text: "Oi, tudo bem? 😀" } });
    });

    it("recusa texto acima de 1.000 bytes (emoji conta 4) e vazio, com o pedido pendente", async () => {
      const e = await editar("ig_responder_dm", { usuario_id: PESSOA, texto: "Oi!" }, "x");
      const grande = "😀".repeat(251); // 1004 bytes, 251 caracteres
      const r1 = await e.confirmar(grande);
      assert.equal(r1.isError, true);
      assert.match(textoDe(r1), /Texto grande demais: 1004 bytes \(o limite da Meta é 1000\)/);
      const r2 = await e.confirmar("   ");
      assert.equal(r2.isError, true);
      assert.match(textoDe(r2), /O texto está vazio/);
      assert.equal(posts().length, 0);
      assert.ok(!(await chamar("ig_confirmar", { id: e.id, codigo: e.codigo })).isError, "o pedido continuava pendente");
    });
  });

  describe("comentários (2.200 caracteres)", () => {
    it("ig_comentar_midia: edita; 2.200 caracteres passam, 2.201 não (emoji conta 1)", async () => {
      m.graphFalsa.rota("GET", "/M1", { corpo: { id: "M1" } });
      m.graphFalsa.rota("POST", "/M1/comments", { corpo: { id: "c9" } });
      const e = await editar("ig_comentar_midia", { midia_id: "M1", texto: "Oi" }, "x");
      assert.deepEqual((e.previa._meta?.previa as Record<string, any>)?.texto_editavel, { limite: 2200, unidade: "caracteres" });
      const acima = await e.confirmar("😀".repeat(2201));
      assert.equal(acima.isError, true);
      assert.match(textoDe(acima), /2\.?200/);
      const ok = await e.confirmar("😀".repeat(2200));
      assert.ok(!ok.isError, textoDe(ok));
      assert.deepEqual(corpoDoUltimoPost(), { message: "😀".repeat(2200) });
    });

    it("ig_responder_comentario: edita o texto e mantém o alvo", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      m.graphFalsa.rota("POST", "/c1/replies", { corpo: { id: "r9" } });
      const e = await editar("ig_responder_comentario", { comentario_id: "c1", texto: "Obrigado!" }, "Muito obrigado, de coração!");
      const ok = await e.confirmar();
      assert.ok(!ok.isError, textoDe(ok));
      assert.equal(posts().at(-1)!.caminho, "/c1/replies");
      assert.deepEqual(corpoDoUltimoPost(), { message: "Muito obrigado, de coração!" });
    });

    it("ig_responder_no_privado: limite de 1.000 bytes", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      const e = await editar("ig_responder_no_privado", { comentario_id: "c1", texto: "Oi" }, "Aqui vai o link novo");
      assert.deepEqual((e.previa._meta?.previa as Record<string, any>)?.texto_editavel, { limite: 1000, unidade: "bytes" });
      const grande = await e.confirmar("é".repeat(501)); // 1002 bytes
      assert.equal(grande.isError, true);
      assert.match(textoDe(grande), /1002 bytes/);
      const ok = await e.confirmar();
      assert.ok(!ok.isError, textoDe(ok));
      assert.deepEqual(corpoDoUltimoPost(), { recipient: { comment_id: "c1" }, message: { text: "Aqui vai o link novo" } });
    });

    it("o bloco conteudo_de_terceiros continua só leitura: não há como editá-lo", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      m.graphFalsa.rota("POST", "/c1/replies", { corpo: { id: "r9" } });
      const e = await editar("ig_responder_comentario", { comentario_id: "c1", texto: "Oi" }, "Novo");
      assert.ok((e.previa._meta?.previa as Record<string, any>)?.conteudo_de_terceiros);
      assert.equal((e.previa._meta?.previa as Record<string, any>)?.texto_editavel?.limite, 2200);
      assert.ok(!(await e.confirmar()).isError);
      assert.deepEqual(Object.keys(corpoDoUltimoPost()), ["message"]);
    });

    it("ig_apagar_comentario não oferece edição e recusa `texto`", async () => {
      m.graphFalsa.rota("GET", "/c1", { corpo: comentario("c1") });
      const e = await editar("ig_apagar_comentario", { comentario_id: "c1" }, "qualquer");
      assert.equal("texto_editavel" in (e.previa._meta?.previa as object), false);
      const r = await e.confirmar();
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /não aceita texto novo/);
    });
  });

  describe("publicação (legenda: 2.200 caracteres e as regras de hashtag)", () => {
    const URL_FOTO = "https://exemplo.com/foto.jpg";
    beforeEach(() => {
      m.graphFalsa.rota("GET", `/${IG}/content_publishing_limit`, { corpo: { data: [{ quota_usage: 0, config: { quota_total: 100, quota_duration: 86400 } }] } });
      m.graphFalsa.rota("POST", `/${IG}/media`, { corpo: { id: "c1" } });
      m.graphFalsa.rota("POST", `/${IG}/media_publish`, { corpo: { id: "midia1" } });
      m.graphFalsa.rota("GET", "/midia1", { corpo: { id: "midia1", permalink: "https://www.instagram.com/p/ABC/" } });
      m.graphFalsa.rota("GET", "/c1", { corpo: { id: "c1", status_code: "FINISHED" } });
    });

    it("ig_publicar_post: edita a legenda; hashtags demais e legenda vazia são recusadas com o pedido pendente", async () => {
      const e = await editar("ig_publicar_post", { imagem: URL_FOTO, legenda: "Oi, mundo" }, "Legenda nova #ok");
      assert.deepEqual((e.previa._meta?.previa as Record<string, any>)?.texto_editavel, { limite: 2200, unidade: "caracteres" });
      const muitas = await e.confirmar(Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" "));
      assert.equal(muitas.isError, true);
      assert.match(textoDe(muitas), /31 hashtags/);
      const vazia = await e.confirmar("  ");
      assert.equal(vazia.isError, true);
      assert.equal(posts().length, 0);
      const ok = await e.confirmar();
      assert.ok(!ok.isError, textoDe(ok));
      const container = posts().find((p) => p.caminho === `/${IG}/media`)!;
      assert.deepEqual(JSON.parse(container.corpo), { image_url: URL_FOTO, caption: "Legenda nova #ok" });
    });

    it("post sem legenda não oferece edição", async () => {
      const previa = await chamar("ig_publicar_post", { imagem: URL_FOTO });
      assert.ok(!previa.isError, textoDe(previa));
      assert.equal("texto_editavel" in (previa._meta?.previa as object), false);
    });

    it("ig_publicar_story não oferece edição", async () => {
      const previa = await chamar("ig_publicar_story", { midia: URL_FOTO });
      assert.ok(!previa.isError, textoDe(previa));
      assert.equal("texto_editavel" in (previa._meta?.previa as object), false);
    });
  });

  it("ig_enviar_midia_dm (sem legenda) não oferece edição", async () => {
    const previa = await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", url: "https://exemplo.com/a.png" });
    assert.ok(!previa.isError, textoDe(previa));
    assert.equal("texto_editavel" in (previa._meta?.previa as object), false);
  });
});
