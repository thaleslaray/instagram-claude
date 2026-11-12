// Ficha 06: responder DM, mandar mídia e reagir. Graph falsa e janela do Mac falsa: nada sai de verdade.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { VALIDADE_MS } from "../src/confirmacao.ts";
import { FRASES } from "../src/erros.ts";
import { LIMITE_DE_TEXTO_BYTES } from "../src/ferramentas/dms-escrita.ts";
import { esquecerSegredos } from "../src/segredos.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, erroMeta, partesMultipart, TOKEN_TESTE, type PedidoRegistrado } from "./graph-falsa.ts";
import { JanelaFalsa } from "./janela-falsa.ts";

const IG = CONTA_TESTE.id;
const PESSOA = "17841400000000001";
const H = 3_600_000;
const data = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+0000");
const dela = (ms: number, id: string) => ({ id, created_time: data(ms), from: { id: PESSOA, username: "fulano" } });
const conversa = { id: "conv1", updated_time: data(Date.now()), participants: { data: [{ id: PESSOA, username: "fulano" }, { id: IG, username: CONTA_TESTE.username }] } };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42", "latin1"), Buffer.alloc(32)]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypM4A ", "latin1"), Buffer.alloc(32)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32)]);

type Bloco = { text?: string };
type Resultado = { isError?: boolean; content: Bloco[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };
const textoDe = (r: Resultado): string => r.content.map((b) => b.text ?? "").join("\n");

describe("DMs: escrita", () => {
  let m: Montagem;
  let pasta: string;
  let agora: number;
  let janela: JanelaFalsa;

  beforeEach(async () => {
    esquecerSegredos();
    agora = Date.now();
    janela = new JanelaFalsa();
    pasta = await mkdtemp(join(tmpdir(), "dms-"));
    m = await montar({ executar: janela.executar, agora: () => agora });
    m.ctx.conta.arroba = CONTA_TESTE.username;
    m.graphFalsa.rota("GET", `/${IG}/conversations`, { corpo: { data: [conversa] } });
    m.graphFalsa.rota("POST", `/${IG}/messages`, { corpo: { recipient_id: PESSOA, message_id: "mid.enviada" } });
  });
  afterEach(async () => {
    await m.fechar();
  });

  /** Mensagem da pessoa há `horas` horas (janela aberta se < 24). */
  const escreveuHa = (horas: number) => m.graphFalsa.rota("GET", "/conv1", { corpo: { messages: { data: [dela(Date.now() - horas * H, "mid.dela")] } } });
  const posts = () => m.graphFalsa.pedidos.filter((p) => p.metodo === "POST");
  const registro = (): Array<Record<string, unknown>> => {
    try {
      return readFileSync(m.caminhoRegistro, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    } catch {
      return [];
    }
  };
  async function arquivo(nome: string, bytes: Buffer): Promise<string> {
    const caminho = join(pasta, nome);
    await writeFile(caminho, bytes);
    return caminho;
  }
  async function chamar(nome: string, args: Record<string, unknown>, comTela = true): Promise<Resultado> {
    const { cliente, fechar } = await conectarCliente(m.ctx, { comTela });
    try {
      return (await cliente.callTool({ name: nome, arguments: args })) as unknown as Resultado;
    } finally {
      await fechar();
    }
  }
  /** Chama uma ferramenta e confirma o pedido na mesma conexão (o pedido vive no contexto, não na conexão). */
  async function previaEConfirma(nome: string, args: Record<string, unknown>): Promise<{ previa: Resultado; id: string; codigo: string }> {
    const previa = await chamar(nome, args);
    return { previa, id: String(previa.structuredContent?.pedido), codigo: String(previa._meta?.codigo) };
  }

  it("registra as três ferramentas; só reagir fica sem tela de prévia", async () => {
    const { cliente, fechar } = await conectarCliente(m.ctx);
    try {
      const { tools } = await cliente.listTools();
      for (const nome of ["ig_responder_dm", "ig_enviar_midia_dm", "ig_reagir_dm"]) {
        const t = tools.find((x) => x.name === nome);
        assert.ok(t, nome);
        assert.equal(t.annotations?.readOnlyHint, false, nome);
      }
      assert.ok(tools.find((x) => x.name === "ig_responder_dm")?._meta?.ui);
      assert.ok(tools.find((x) => x.name === "ig_enviar_midia_dm")?._meta?.ui);
      assert.equal(tools.find((x) => x.name === "ig_reagir_dm")?._meta, undefined);
    } finally {
      await fechar();
    }
  });

  describe("ig_responder_dm", () => {
    it("janela fechada: recusa com a data, zero confirmações e zero escritas", async () => {
      escreveuHa(30);
      const r = await chamar("ig_responder_dm", { usuario_id: PESSOA, texto: "oi" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /Fora da janela de 24 h: a última mensagem de @fulano foi em \d{2}\/\d{2}\/\d{4}.*só permite responder até/s);
      assert.equal(r.structuredContent, undefined, "nenhuma prévia");
      assert.equal(posts().length, 0);
      assert.equal(janela.chamadas.length, 0);
      assert.equal(registro().length, 0);
    });

    it("pessoa que nunca escreveu, ou sem conversa: recusa sem pedido", async () => {
      m.graphFalsa.rota("GET", "/conv1", { corpo: { messages: { data: [{ id: "m", created_time: data(Date.now()), from: { id: IG } }] } } });
      assert.match(textoDe(await chamar("ig_responder_dm", { usuario_id: PESSOA, texto: "oi" })), /nunca escreveu/);
      assert.match(textoDe(await chamar("ig_responder_dm", { usuario_id: "99999999", texto: "oi" })), /Não achei conversa/);
      assert.equal(posts().length, 0);
    });

    it("texto com 1.001 bytes é recusado; com 1.000 passa (emoji conta 4 bytes)", async () => {
      escreveuHa(1);
      const longo = await chamar("ig_responder_dm", { usuario_id: PESSOA, texto: "a".repeat(LIMITE_DE_TEXTO_BYTES + 1) });
      assert.equal(longo.isError, true);
      assert.match(textoDe(longo), /1001 bytes/);
      const emojis = await chamar("ig_responder_dm", { usuario_id: PESSOA, texto: "😀".repeat(251) });
      assert.equal(emojis.isError, true, "251 emojis = 1.004 bytes");
      assert.equal((await chamar("ig_responder_dm", { usuario_id: PESSOA, texto: "a".repeat(LIMITE_DE_TEXTO_BYTES) })).isError, undefined);
      assert.equal(posts().length, 0);
    });

    it("mostra a prévia sem enviar; ig_confirmar envia o corpo recipient/message exato", async () => {
      escreveuHa(2);
      const texto = 'Oi, Fulano! "Aqui" vai o material 😀.';
      const { previa, id, codigo } = await previaEConfirma("ig_responder_dm", { usuario_id: PESSOA, texto });
      assert.ok(!previa.isError, textoDe(previa));
      assert.equal(posts().length, 0);
      assert.equal((previa._meta?.previa as Record<string, any>)?.titulo, "Responder DM em nome de @conta_de_teste");
      assert.equal((previa._meta?.previa as Record<string, any>)?.alvo, `IGSID ${PESSOA}`, "o @ de terceiro não fica no alvo");
      assert.deepEqual((previa._meta?.previa as Record<string, any>)?.conteudo_de_terceiros, { username: "@fulano" });
      assert.equal((previa._meta?.previa as Record<string, any>)?.texto, texto);
      assert.match(JSON.stringify((previa._meta?.previa as Record<string, any>)?.detalhes), /Janela aberta até .*Tamanho: \d+ de 1000 bytes/);
      assert.ok(!JSON.stringify(previa.structuredContent).includes(codigo));

      const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: true });
      try {
        const ok = (await cliente.callTool({ name: "ig_confirmar", arguments: { id, codigo } })) as unknown as Resultado;
        assert.ok(!ok.isError, textoDe(ok));
      } finally {
        await fechar();
      }
      assert.equal(posts().length, 1);
      const envio = posts()[0]!;
      assert.equal(envio.caminho, `/${IG}/messages`, "nunca /me/messages");
      assert.equal(envio.versao, "v27.0");
      assert.deepEqual(JSON.parse(envio.corpo), { recipient: { id: PESSOA }, message: { text: texto } });
      assert.ok(registro().some((l) => l.evento === "enviado" && l.ferramenta === "ig_responder_dm" && l.texto === texto));
    });

    it("sem tela, a janela do Mac é a confirmação; cancelar não envia", async () => {
      escreveuHa(2);
      janela.comportamento = "cancela";
      const cancelada = await chamar("ig_responder_dm", { usuario_id: PESSOA, texto: "oi" }, false);
      assert.match(textoDe(cancelada), /cancelou/);
      assert.equal(posts().length, 0);
      janela.comportamento = "aceita";
      const ok = await chamar("ig_responder_dm", { usuario_id: PESSOA, texto: "oi" }, false);
      assert.ok(!ok.isError, textoDe(ok));
      assert.equal(posts().length, 1);
    });

    it("erro da Meta por janela vira 'fora da janela (provável)', com o erro original limpo", async () => {
      escreveuHa(2);
      m.graphFalsa.rota("POST", `/${IG}/messages`, erroMeta(10, "This message is sent outside of allowed window. Token EAAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", 2534022));
      const { id, codigo } = await previaEConfirma("ig_responder_dm", { usuario_id: PESSOA, texto: "oi" });
      const r = await chamar("ig_confirmar", { id, codigo });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /Fora da janela \(provável\)/);
      assert.match(textoDe(r), /outside of allowed window/);
      assert.ok(!textoDe(r).includes("EAAXXXX"));
      assert.ok(textoDe(r).includes(FRASES.foraDaJanela.slice(0, 20)));
    });
  });

  describe("ig_enviar_midia_dm", () => {
    const anexos = () => m.graphFalsa.pedidos.filter((p) => p.metodo === "POST" && p.caminho === `/${IG}/message_attachments`);
    const mensagens = () => m.graphFalsa.pedidos.filter((p) => p.metodo === "POST" && p.caminho === `/${IG}/messages`);
    const parteDe = (p: PedidoRegistrado, nome: string) => partesMultipart(p).find((x) => x.nome === nome);
    const rotaDeAnexo = () => m.graphFalsa.rota("POST", `/${IG}/message_attachments`, { corpo: { attachment_id: "anexo-123" } });

    it("janela fechada: recusa antes de qualquer envio e sem prévia", async () => {
      escreveuHa(48);
      const foto = await arquivo("foto.jpg", JPEG);
      const r = await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: foto });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /Fora da janela de 24 h/);
      assert.equal(anexos().length, 0);
      assert.equal(posts().length, 0);
      assert.equal(registro().length, 0);
    });

    for (const [tipo, nome, bytes] of [
      ["image", "foto-do-cliente.jpg", JPEG],
      ["video", "video.mp4", MP4],
      ["audio", "audio.m4a", M4A],
      ["file", "material.pdf", PDF],
    ] as const) {
      it(`${tipo} local: nada sobe antes do clique; depois, message_attachments em multipart e messages com attachment_id`, async () => {
        escreveuHa(2);
        rotaDeAnexo();
        const caminho = await arquivo(nome, bytes);
        const { previa, id, codigo } = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo, arquivo: caminho });
        assert.ok(!previa.isError, textoDe(previa));
        assert.equal(posts().length, 0, "nada sai antes do clique");
        assert.match(JSON.stringify((previa._meta?.previa as Record<string, any>)?.detalhes), new RegExp(nome.replace(".", "\\.")));

        const ok = await chamar("ig_confirmar", { id, codigo });
        assert.ok(!ok.isError, textoDe(ok));
        assert.equal(anexos().length, 1);
        const [anexo] = anexos();
        assert.match(String(anexo!.cabecalhos["content-type"]), /^multipart\/form-data/);
        assert.equal(anexo!.cabecalhos.authorization, `Bearer ${TOKEN_TESTE}`);
        assert.equal(parteDe(anexo!, "platform")?.conteudo.toString(), "instagram");
        assert.deepEqual(JSON.parse(parteDe(anexo!, "message")!.conteudo.toString()), { attachment: { type: tipo } });
        assert.ok(parteDe(anexo!, "filedata")!.conteudo.equals(bytes));
        assert.equal(mensagens().length, 1);
        assert.deepEqual(JSON.parse(mensagens()[0]!.corpo), {
          recipient: { id: PESSOA },
          message: { attachment: { type: tipo, payload: { attachment_id: "anexo-123" } } },
        });
        assert.ok(m.graphFalsa.pedidos.indexOf(anexo!) < m.graphFalsa.pedidos.indexOf(mensagens()[0]!), "primeiro o anexo, depois a mensagem");
        const linhas = registro();
        assert.ok(linhas.some((l) => l.evento === "enviado" && l.ferramenta === "ig_enviar_midia_dm"));
        assert.ok(!JSON.stringify(linhas).includes(TOKEN_TESTE));
      });
    }

    it("não precisa de hospedagem nenhuma: sem a chave do Uploadcare o arquivo local segue", async () => {
      escreveuHa(2);
      rotaDeAnexo();
      m.ctx.hospedagem = null;
      const { previa, id, codigo } = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: await arquivo("foto.jpg", JPEG) });
      assert.ok(!previa.isError, textoDe(previa));
      assert.ok(!(await chamar("ig_confirmar", { id, codigo })).isError);
      assert.equal(mensagens().length, 1);
    });

    it("pedido cancelado, vencido ou com código errado: zero escritas", async () => {
      escreveuHa(2);
      rotaDeAnexo();
      const foto = await arquivo("foto.jpg", JPEG);
      const cancelado = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: foto });
      assert.ok(!(await chamar("ig_cancelar", { id: cancelado.id })).isError);
      const vencido = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: foto });
      agora += VALIDADE_MS + 1;
      const r = await chamar("ig_confirmar", { id: vencido.id, codigo: vencido.codigo });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /venceu/);
      const errado = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: foto });
      for (let i = 0; i < 3; i++) await chamar("ig_confirmar", { id: errado.id, codigo: `errado${i}` });
      janela.comportamento = "cancela";
      await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: foto }, false);
      assert.equal(posts().length, 0);
    });

    it("a Meta recusa o anexo: erro traduzido e a mensagem não é enviada", async () => {
      escreveuHa(2);
      m.graphFalsa.rota("POST", `/${IG}/message_attachments`, erroMeta(100, "Invalid parameter"));
      const { id, codigo } = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: await arquivo("foto.jpg", JPEG) });
      const r = await chamar("ig_confirmar", { id, codigo });
      assert.equal(r.isError, true);
      assert.equal(mensagens().length, 0);
    });

    it("anexo sem attachment_id na resposta: não envia a mensagem", async () => {
      escreveuHa(2);
      m.graphFalsa.rota("POST", `/${IG}/message_attachments`, { corpo: {} });
      const { id, codigo } = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: await arquivo("foto.jpg", JPEG) });
      const r = await chamar("ig_confirmar", { id, codigo });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /não devolveu o ID do anexo/);
      assert.equal(mensagens().length, 0);
    });

    it("envio da mensagem recusado pela Meta depois do anexo: erro", async () => {
      escreveuHa(2);
      rotaDeAnexo();
      m.graphFalsa.rota("POST", `/${IG}/messages`, erroMeta(100, "Invalid parameter"));
      const { id, codigo } = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: await arquivo("foto.jpg", JPEG) });
      assert.equal((await chamar("ig_confirmar", { id, codigo })).isError, true);
    });

    it("o arquivo que muda entre a prévia e o clique não é enviado", async () => {
      escreveuHa(2);
      rotaDeAnexo();
      const foto = await arquivo("foto.jpg", JPEG);
      const { id, codigo } = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: foto });
      await writeFile(foto, Buffer.concat([JPEG, Buffer.alloc(4)]));
      const r = await chamar("ig_confirmar", { id, codigo });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /mudou depois da prévia/);
      assert.equal(posts().length, 0);
    });

    it("PDF aceito em file; .docx recusado em file, antes de qualquer envio", async () => {
      escreveuHa(2);
      const docx = await arquivo("material.docx", DOCX);
      const recusado = await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "file", arquivo: docx });
      assert.equal(recusado.isError, true);
      assert.match(textoDe(recusado), /Formato não aceito em file.*só pdf/s);
      assert.equal(posts().length, 0);
    });

    it("formato que não serve ao tipo, arquivo grande, ausente e entrada ambígua são recusados", async () => {
      escreveuHa(2);
      const foto = await arquivo("foto.jpg", JPEG);
      const pdf = await arquivo("material.pdf", PDF);
      assert.match(textoDe(await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "video", arquivo: foto })), /Formato não aceito em video/);
      assert.match(textoDe(await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: pdf })), /Formato não aceito em image/);
      const grande = await arquivo("grande.jpg", Buffer.concat([JPEG, Buffer.alloc(8_000_000)]));
      assert.match(textoDe(await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: grande })), /grande demais/);
      assert.match(textoDe(await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: join(pasta, "nao-existe.jpg") })), /Não achei o arquivo/);
      assert.match(textoDe(await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image" })), /`arquivo` OU `url`/);
      assert.match(textoDe(await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "image", arquivo: foto, url: "https://exemplo.com/a.jpg" })), /`arquivo` OU `url`/);
      assert.equal(posts().length, 0);
    });

    it("url cuja extensão não combina com o tipo é recusada antes da prévia; sem extensão ou combinando passa", async () => {
      escreveuHa(2);
      const recusar = async (tipo: string, url: string, aceitos: string) => {
        const r = await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo, url });
        assert.equal(r.isError, true, `${tipo} ${url}`);
        assert.match(textoDe(r), new RegExp(`Formato não aceito em ${tipo}: .*${aceitos}`), `${tipo} ${url}`);
        assert.equal(r.structuredContent?.pedido, undefined);
      };
      await recusar("file", "https://exemplo.com/planilha.xlsx", "só pdf");
      await recusar("image", "https://exemplo.com/foto.gif?x=1", "png ou jpeg");
      await recusar("video", "https://exemplo.com/a.mp3", "mp4, ogg, avi, mov ou webm");
      await recusar("audio", "https://exemplo.com/a.WEBM", "aac, m4a, wav ou mp4");
      assert.equal(m.graphFalsa.pedidos.length, 0, "recusou sem falar com a Graph");
      for (const [tipo, url] of [["file", "https://exemplo.com/material.pdf"], ["image", "https://exemplo.com/a.JPG?v=2"], ["video", "https://exemplo.com/v.mov"], ["audio", "https://exemplo.com/a.mp4"], ["image", "https://exemplo.com/media/12345"]] as const) {
        const r = await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo, url });
        assert.ok(!r.isError, `${tipo} ${url}: ${textoDe(r)}`);
        assert.ok(r.structuredContent?.pedido, `${tipo} ${url}`);
      }
    });

    it("url https vai como está, sem upload; http e lixo são recusados", async () => {
      escreveuHa(2);
      const url = "https://exemplo.com/folder/audio.m4a";
      const { previa, id, codigo } = await previaEConfirma("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "audio", url });
      assert.ok(!previa.isError, textoDe(previa));
      assert.equal(anexos().length, 0);
      assert.match(JSON.stringify((previa._meta?.previa as Record<string, any>)?.detalhes), /https:\/\/exemplo\.com\/folder\/audio\.m4a/);
      assert.ok(!(await chamar("ig_confirmar", { id, codigo })).isError);
      assert.deepEqual(JSON.parse(posts()[0]!.corpo), { recipient: { id: PESSOA }, message: { attachment: { type: "audio", payload: { url } } } });
      assert.match(textoDe(await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "audio", url: "http://exemplo.com/a.m4a" })), /https/);
      assert.match(textoDe(await chamar("ig_enviar_midia_dm", { usuario_id: PESSOA, tipo: "audio", url: "nao é url" })), /endereço válido/);
    });
  });

  describe("ig_reagir_dm", () => {
    it("reage e tira a reação sem pedido de confirmação, com o corpo certo e uma linha no registro cada", async () => {
      escreveuHa(2);
      const reagiu = await chamar("ig_reagir_dm", { usuario_id: PESSOA, mensagem_id: "mid.dela", reacao: "love" });
      assert.ok(!reagiu.isError, textoDe(reagiu));
      assert.equal(reagiu.structuredContent?.pedido, undefined, "nenhum pedido de confirmação");
      assert.equal(reagiu._meta, undefined);
      const tirou = await chamar("ig_reagir_dm", { usuario_id: PESSOA, mensagem_id: "mid.dela", remover: true });
      assert.ok(!tirou.isError, textoDe(tirou));

      const [primeiro, segundo] = posts();
      assert.equal(primeiro!.caminho, `/${IG}/messages`);
      assert.deepEqual(JSON.parse(primeiro!.corpo), { recipient: { id: PESSOA }, sender_action: "react", payload: { message_id: "mid.dela", reaction: "love" } });
      assert.deepEqual(JSON.parse(segundo!.corpo), { recipient: { id: PESSOA }, sender_action: "unreact", payload: { message_id: "mid.dela" } });

      const linhas = registro().filter((l) => l.ferramenta === "ig_reagir_dm");
      assert.equal(linhas.length, 2);
      assert.deepEqual(linhas.map((l) => [l.evento, l.acao, l.confirmacao]), [["enviado", "react", "nao-exigida"], ["enviado", "unreact", "nao-exigida"]]);
      assert.equal(janela.chamadas.length, 0);
    });

    it("confere a janela: fechada, não envia e não registra; erro da Meta vira linha de erro", async () => {
      escreveuHa(30);
      const r = await chamar("ig_reagir_dm", { usuario_id: PESSOA, mensagem_id: "mid.dela", reacao: "❤️" });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /Fora da janela de 24 h/);
      assert.equal(posts().length, 0);
      assert.equal(registro().length, 0);

      escreveuHa(1);
      m.graphFalsa.rota("POST", `/${IG}/messages`, erroMeta(100, "Invalid parameter"));
      assert.equal((await chamar("ig_reagir_dm", { usuario_id: PESSOA, mensagem_id: "mid.dela", reacao: "love" })).isError, true);
      assert.deepEqual(registro().map((l) => l.evento), ["erro"]);
    });

    it("exige reacao OU remover", async () => {
      escreveuHa(1);
      assert.match(textoDe(await chamar("ig_reagir_dm", { usuario_id: PESSOA, mensagem_id: "mid.dela" })), /`reacao`.*OU.*`remover: true`/s);
      assert.match(textoDe(await chamar("ig_reagir_dm", { usuario_id: PESSOA, mensagem_id: "mid.dela", reacao: "love", remover: true })), /OU/);
      assert.equal(posts().length, 0);
    });
  });
});
