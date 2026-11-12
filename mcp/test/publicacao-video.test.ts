// Ficha 10: publicação de reels e story. Tudo contra a Graph falsa (inclusive o rupload), o Uploadcare falso,
// um `ffprobe` falso e um relógio falso: nada sai para a Meta nem para o Uploadcare de verdade.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ContagemPublicacoes } from "../src/contagem-publicacoes.ts";
import { configurarPublicacao, estadoDePublicacao, INTERVALO_EM_SEGUNDO_PLANO_MS } from "../src/publicacao.ts";
import { trocarSaidaDoLog } from "../src/log.ts";
import { esquecerSegredos } from "../src/segredos.ts";
import type { Executor } from "../src/sistema.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, rotasDeContainer, TOKEN_TESTE, type RespostaFalsa } from "./graph-falsa.ts";
import { jpeg } from "./jpeg.ts";
import { hospedagemDeTeste, UploadcareFalso } from "./uploadcare-falso.ts";

const IG = CONTA_TESTE.id;
const URL_VIDEO = "https://exemplo.com/video.mp4";
const URL_FOTO = "https://exemplo.com/foto.jpg";
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(32)]);

type Resultado = { isError?: boolean; content: Array<{ text?: string }>; structuredContent?: Record<string, any>; _meta?: Record<string, any> };
const textoDe = (r: Resultado): string => r.content.map((b) => b.text ?? "").join("\n");

describe("publicação de reels e story", () => {
  let m: Montagem;
  let uc: UploadcareFalso;
  let pasta: string;
  let esperas: number[];
  let duracao: number | null;
  let cliente: Awaited<ReturnType<typeof conectarCliente>>["cliente"];
  let fechar: () => Promise<void>;

  const chamar = async (nome: string, args: Record<string, unknown>): Promise<Resultado> => (await cliente.callTool({ name: nome, arguments: args })) as Resultado;
  /** As escritas na Graph (o rupload fica de fora: o corpo dele são os bytes do vídeo). */
  const posts = () => m.graphFalsa.pedidos.filter((p) => p.metodo === "POST" && !p.caminho.startsWith("/rupload/"));
  const corpoDe = (p: { corpo: string }) => JSON.parse(p.corpo) as Record<string, any>;
  const arquivo = (nome: string, bytes: Buffer): string => {
    const caminho = join(pasta, nome);
    writeFileSync(caminho, bytes);
    return caminho;
  };
  const registro = (): Array<Record<string, any>> => {
    try {
      return readFileSync(m.caminhoRegistro, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };

  function rotas(opcoes: { statuses?: Array<Record<string, unknown>>; rupload?: RespostaFalsa } = {}): void {
    const g = m.graphFalsa;
    g.rota("GET", `/${IG}/content_publishing_limit`, { corpo: { data: [{ quota_usage: 0, config: { quota_total: 100, quota_duration: 86400 } }] } });
    rotasDeContainer(g, IG, opcoes.rupload ? { rupload: opcoes.rupload } : {});
    g.rota("POST", `/${IG}/media_publish`, { corpo: { id: "midia1" } });
    g.rota("GET", "/midia1", { corpo: { id: "midia1", permalink: "https://www.instagram.com/reel/ABC/" } });
    const fila = [...(opcoes.statuses ?? [{ status_code: "FINISHED" }])];
    const proximo = () => (fila.length > 1 ? fila.shift()! : fila[0]!);
    for (const id of ["c1", "c2"]) g.rota("GET", `/${id}`, () => ({ corpo: { id, ...proximo() } }));
  }

  async function previa(nome: string, args: Record<string, unknown>): Promise<{ id: string; codigo: string; r: Resultado }> {
    const r = await chamar(nome, args);
    assert.ok(!r.isError, textoDe(r));
    return { id: String(r.structuredContent?.pedido), codigo: String(r._meta?.codigo), r };
  }
  const confirmar = (p: { id: string; codigo: string }) => chamar("ig_confirmar", { id: p.id, codigo: p.codigo });
  const detalhesDe = (p: { r: Resultado }): string => ((p.r._meta?.previa as Record<string, any>)?.detalhes as string[]).join("\n");

  beforeEach(async () => {
    esquecerSegredos();
    duracao = 20;
    m = await montar({
      executar: async (comando) =>
        comando === "ffprobe" && duracao !== null ? { codigo: 0, stdout: `${duracao}\n`, stderr: "" } : { codigo: 127, stdout: "", stderr: "" },
    });
    uc = new UploadcareFalso();
    await uc.iniciar();
    pasta = mkdtempSync(join(tmpdir(), "pub-video-"));
    esperas = [];
    m.ctx.hospedagem = hospedagemDeTeste(uc);
    configurarPublicacao(m.ctx, {
      contagem: new ContagemPublicacoes(join(pasta, "publicacoes.json")),
      esperar: async (ms) => void esperas.push(ms),
    });
    ({ cliente, fechar } = await conectarCliente(m.ctx, { comTela: true }));
  });
  afterEach(async () => {
    await fechar();
    await m.fechar();
    await uc.parar();
    rmSync(pasta, { recursive: true, force: true });
  });

  describe("reels", () => {
    it("vídeo local sobe direto para a Meta (resumable + rupload) e a capa local pelo Uploadcare; container REELS completo", async () => {
      rotas();
      const p = await previa("ig_publicar_reels", {
        video: arquivo("reels.mp4", MP4),
        capa: arquivo("capa.jpg", jpeg(1080, 1920)),
        legenda: "Meu reels #oi",
        nome_do_audio: "Som original",
        marcacoes: [{ usuario: "@amiga" }],
        local_id: "123456",
        colaboradores: ["parceiro"],
      });
      assert.equal(posts().length, 0, "a prévia não escreve nada");
      assert.equal(uc.pedidos.length, 0, "nada sobe antes do clique");
      assert.equal(m.graphFalsa.pedidos.filter((x) => x.caminho.startsWith("/rupload/")).length, 0, "nada sobe antes do clique");
      assert.match(detalhesDe(p), /Vídeo: reels\.mp4 · vídeo MP4/);
      assert.match(detalhesDe(p), /Capa: capa\.jpg · JPEG/);
      const r = await confirmar(p);
      assert.ok(!r.isError, textoDe(r));
      const resultado = r.structuredContent!.resultado;
      assert.equal(resultado.estado, "processando", "vídeo sempre responde na hora");
      assert.match(resultado.trabalho_id, /^t_/);
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(resultado.trabalho_id);
      assert.equal(t?.estado, "publicado");
      assert.equal(uc.envios.length, 1, "só a capa vai para o Uploadcare");
      const [container, publicar] = posts();
      const c = corpoDe(container!);
      assert.equal(c.media_type, "REELS");
      assert.equal(c.upload_type, "resumable");
      assert.ok(!("video_url" in c), "vídeo local não tem video_url");
      assert.equal(c.cover_url, `${uc.base}/uuid-falso-1/foto.jpg`);
      const rupload = m.graphFalsa.pedidos.filter((x) => x.caminho.startsWith("/rupload/"));
      assert.equal(rupload.length, 1);
      assert.equal(rupload[0]!.metodo, "POST");
      assert.equal(rupload[0]!.caminho, "/rupload/ig-api-upload/v27.0/c1");
      assert.equal(rupload[0]!.cabecalhos.authorization, `OAuth ${TOKEN_TESTE}`);
      assert.equal(rupload[0]!.cabecalhos.offset, "0");
      assert.equal(rupload[0]!.cabecalhos.file_size, String(MP4.length));
      assert.ok(rupload[0]!.corpoBruto.equals(MP4));
      assert.ok(!rupload[0]!.urlBruta.includes(TOKEN_TESTE), "token nunca na URL");
      const ordem = m.graphFalsa.pedidos.map((x) => x.caminho);
      assert.ok(ordem.indexOf("/rupload/ig-api-upload/v27.0/c1") < ordem.indexOf("/c1"), "envia os bytes antes de consultar o status");
      assert.equal(c.share_to_feed, true);
      assert.equal(c.caption, "Meu reels #oi");
      assert.equal(c.audio_name, "Som original");
      assert.deepEqual(c.user_tags, [{ username: "amiga" }]);
      assert.equal(c.location_id, "123456");
      assert.deepEqual(c.collaborators, ["parceiro"]);
      assert.ok(!("thumb_offset" in c));
      assert.ok(!("trial_params" in c));
      assert.deepEqual(corpoDe(publicar!), { creation_id: "c1" });
      const status = await chamar("ig_status_publicacao", { trabalho_id: resultado.trabalho_id });
      assert.equal(status.structuredContent?.estado, "publicado");
      assert.equal(status.structuredContent?.midia_id, "midia1");
      assert.equal(status.structuredContent?.permalink, "https://www.instagram.com/reel/ABC/");
      assert.equal(status.structuredContent?.tipo, "reels");
      assert.ok(registro().some((l) => l.evento === "publicado" && l.ferramenta === "ig_publicar_reels"));
    });

    it("passando por IN_PROGRESS, FINISHED e publicado em segundo plano (relógio falso)", async () => {
      rotas({ statuses: [{ status_code: "IN_PROGRESS" }, { status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }] });
      const r = await confirmar(await previa("ig_publicar_reels", { video: URL_VIDEO, capa_ms: 2500, mostrar_no_feed: false }));
      const { estado, trabalho_id } = r.structuredContent!.resultado;
      assert.equal(estado, "processando");
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(trabalho_id);
      assert.equal(t?.estado, "publicado");
      assert.deepEqual(esperas, [10_000, 10_000, 10_000]);
      assert.deepEqual(t?.containers.map((c) => c.status_code), ["FINISHED"]);
      const c = corpoDe(posts()[0]!);
      assert.equal(c.thumb_offset, 2500);
      assert.equal(c.share_to_feed, false);
      assert.ok(!("cover_url" in c));
      assert.equal(c.video_url, URL_VIDEO);
      assert.equal(uc.pedidos.length, 0, "URL https não passa pelo Uploadcare");
      assert.equal(m.graphFalsa.pedidos.filter((x) => x.caminho.startsWith("/rupload/")).length, 0, "URL https não passa pelo rupload");
    });

    it("consulta aos 10 s e depois a cada 10 s, e desiste em 5 min sem publicar", async () => {
      rotas({ statuses: [{ status_code: "IN_PROGRESS" }] });
      const r = await confirmar(await previa("ig_publicar_reels", { video: URL_VIDEO }));
      assert.equal(r.structuredContent!.resultado.estado, "processando");
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(r.structuredContent!.resultado.trabalho_id);
      assert.equal(t?.estado, "falhou");
      assert.match(t?.erro ?? "", /5 minutos/);
      assert.equal(esperas.length, 30);
      assert.ok(esperas.every((e) => e === 10_000));
      assert.equal(esperas.reduce((x, y) => x + y, 0), 300_000);
      assert.ok(!posts().some((x) => x.caminho.endsWith("/media_publish")));
    });

    it("EXPIRED em segundo plano falha o trabalho sem publicar", async () => {
      rotas({ statuses: [{ status_code: "IN_PROGRESS" }, { status_code: "EXPIRED" }] });
      const r = await confirmar(await previa("ig_publicar_reels", { video: arquivo("reels.mov", MOV) }));
      assert.equal(r.structuredContent!.resultado.estado, "processando");
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(r.structuredContent!.resultado.trabalho_id);
      assert.equal(t?.estado, "falhou");
      assert.match(t?.erro ?? "", /expirou/);
      assert.ok(!posts().some((x) => x.caminho.endsWith("/media_publish")));
      const status = await chamar("ig_status_publicacao", { trabalho_id: r.structuredContent!.resultado.trabalho_id });
      assert.equal(status.structuredContent?.estado, "falhou");
      assert.match(status.structuredContent?.erro, /expirou/);
    });

    it("ERROR com o subcódigo da Meta vira a frase traduzida", async () => {
      rotas({ statuses: [{ status_code: "ERROR", status: "Error: 2207026" }] });
      const r = await confirmar(await previa("ig_publicar_reels", { video: URL_VIDEO }));
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(r.structuredContent!.resultado.trabalho_id);
      assert.equal(t?.estado, "falhou");
      assert.match(t?.erro ?? "", /o formato do vídeo não é aceito/);
    });

    it("recusa antes de qualquer pedido: duração, tamanho, capa e vídeo errado", async () => {
      duracao = 2;
      let r = await chamar("ig_publicar_reels", { video: arquivo("curto.mp4", MP4) });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /2 s; Reels precisa ter de 3 s a 15 min/);
      duracao = 901;
      r = await chamar("ig_publicar_reels", { video: arquivo("longo.mp4", MP4) });
      assert.match(textoDe(r), /901 s; Reels precisa ter de 3 s a 15 min/);
      duracao = 20;
      r = await chamar("ig_publicar_reels", { video: arquivo("foto.jpg", jpeg(1080, 1920)) });
      assert.match(textoDe(r), /é uma foto; Reels aceita só vídeo/);
      r = await chamar("ig_publicar_reels", { video: URL_FOTO.replace("foto.jpg", "outra.png"), capa: URL_FOTO, capa_ms: 100 });
      assert.match(textoDe(r), /capa OU capa_ms/);
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
      r = await chamar("ig_publicar_reels", { video: arquivo("ok.mp4", MP4), capa: arquivo("capa.png", png) });
      assert.match(textoDe(r), /Capa \(capa\.png\).*PNG/s);
      r = await chamar("ig_publicar_reels", { video: arquivo("ok.mp4", MP4), capa: arquivo("capa2.mp4", MP4) });
      assert.match(textoDe(r), /Capa.*só aceito foto/s);
      assert.equal(m.graphFalsa.pedidos.length, 0, "nada chegou à Graph");
    });

    it("sem ffprobe a confirmação avisa que a duração não foi conferida", async () => {
      duracao = null;
      rotas();
      const p = await previa("ig_publicar_reels", { video: arquivo("reels.mp4", MP4) });
      assert.match(detalhesDe(p), /Aviso: .*não consegui ler a duração \(ffprobe ausente\)/);
    });

    it("arquivo acima de 300 MB é recusado pelo tamanho (sem ler o arquivo todo)", async () => {
      const caminho = join(pasta, "grande.mp4");
      writeFileSync(caminho, MP4);
      const { truncateSync } = await import("node:fs");
      truncateSync(caminho, 301 * 1024 * 1024);
      const r = await chamar("ig_publicar_reels", { video: caminho });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /limite de Reels é 300,0 MB/);
    });

    it("o vídeo que muda entre a prévia e o clique não é publicado", async () => {
      rotas();
      const caminho = arquivo("reels.mp4", MP4);
      const p = await previa("ig_publicar_reels", { video: caminho });
      writeFileSync(caminho, Buffer.concat([MP4, Buffer.alloc(8)]));
      const r = await confirmar(p);
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /mudou depois da prévia/);
      assert.equal(posts().length, 0);
      assert.equal(uc.pedidos.length, 0);
    });

    it("falha no rupload (500 com debug_info) depois do segundo plano: o trabalho falha com a frase em português, o status e o registro mostram, token fora de tudo", async () => {
      rotas({ rupload: { status: 500, corpo: { debug_info: { message: `Authorization: OAuth ${TOKEN_TESTE}`, type: "ProcessingFailedError" } } } });
      const linhas: string[] = [];
      const restaurar = trocarSaidaDoLog((l) => linhas.push(l));
      let trabalhoId = "";
      try {
        const r = await confirmar(await previa("ig_publicar_reels", { video: arquivo("reels.mp4", MP4) }));
        assert.ok(!r.isError, "o cartão recebe 'processando'; a falha vem depois, pelo status");
        assert.equal(r.structuredContent!.resultado.estado, "processando");
        trabalhoId = r.structuredContent!.resultado.trabalho_id;
        const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(trabalhoId);
        assert.equal(t?.estado, "falhou");
        assert.match(t?.erro ?? "", /A Meta não aceitou o envio do vídeo \(HTTP 500\).*tente de novo/s);
        const status = await chamar("ig_status_publicacao", { trabalho_id: trabalhoId });
        assert.equal(status.structuredContent?.estado, "falhou");
        assert.match(status.structuredContent?.erro, /A Meta não aceitou o envio do vídeo \(HTTP 500\)/);
        assert.ok(!JSON.stringify(r).includes(TOKEN_TESTE));
        assert.ok(!JSON.stringify(status).includes(TOKEN_TESTE));
        assert.ok(!JSON.stringify(status).includes("debug_info"));
        assert.ok(!linhas.join("\n").includes(TOKEN_TESTE));
      } finally {
        restaurar();
      }
      assert.ok(!posts().some((x) => x.caminho.endsWith("/media_publish")), "nada publicado");
      assert.ok(!m.graphFalsa.pedidos.some((x) => x.caminho === "/c1"), "nem consultou o status");
      const falha = registro().find((l) => l.evento === "publicacao_falhou");
      assert.ok(falha, "registrado no registro de ações");
      assert.equal(falha.trabalho_id, trabalhoId);
      assert.match(falha.erro, /A Meta não aceitou o envio do vídeo/);
      assert.ok(!readFileSync(m.caminhoRegistro, "utf8").includes(TOKEN_TESTE));
      assert.equal(await estadoDePublicacao(m.ctx).contagem.contar(), 0, "falhou: não conta na cota local");
    });

    it("vídeo local: 'processando' sai ANTES de criar o container; estados criando_containers → processando → publicando → publicado; cota local contada uma vez", async () => {
      rotas({ statuses: [{ status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }] });
      const estado = estadoDePublicacao(m.ctx);
      const estados: string[] = [];
      const mudarOriginal = estado.trabalhos.mudar.bind(estado.trabalhos);
      estado.trabalhos.mudar = (t, e) => {
        if (estados[estados.length - 1] !== e) estados.push(e);
        mudarOriginal(t, e);
      };
      // Segura toda escrita na Graph até o teste soltar: prova que a resposta não esperou o container.
      let soltar!: () => void;
      const portao = new Promise<void>((r) => (soltar = r));
      const postOriginal = m.ctx.graph.post.bind(m.ctx.graph);
      let postsFeitos = 0;
      (m.ctx.graph as any).post = async (...a: unknown[]) => {
        await portao;
        postsFeitos++;
        return (postOriginal as any)(...a);
      };
      const r = await confirmar(await previa("ig_publicar_reels", { video: arquivo("reels.mp4", MP4) }));
      assert.ok(!r.isError, textoDe(r));
      const resultado = r.structuredContent!.resultado;
      assert.equal(resultado.estado, "processando");
      assert.equal(resultado.com_video, true);
      assert.equal(postsFeitos, 0, "nenhum container foi criado quando a resposta saiu");
      assert.equal(posts().length, 0);
      assert.match(textoDe(r), /O vídeo foi recebido.*publicação sai sozinha.*ig_status_publicacao com o trabalho_id t_/s);
      // Enquanto o container não sai, o status estruturado mostra o passo e não tem link.
      const durante = await chamar("ig_status_publicacao", { trabalho_id: resultado.trabalho_id });
      assert.equal(durante.structuredContent?.estado, "criando_containers");
      assert.equal(durante.structuredContent?.permalink, undefined);
      soltar();
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(resultado.trabalho_id);
      assert.equal(t?.estado, "publicado");
      assert.deepEqual(estados, ["criando_containers", "processando", "publicando", "publicado"]);
      assert.equal(await estado.contagem.contar(), 1, "a cota local conta uma vez");
      const depois = await chamar("ig_status_publicacao", { trabalho_id: resultado.trabalho_id });
      assert.equal(depois.structuredContent?.estado, "publicado");
      assert.equal(depois.structuredContent?.permalink, "https://www.instagram.com/reel/ABC/");
    });

    it("etapas_ms de vídeo local traz criar_container e enviar_video numéricos (e containers continua)", async () => {
      rotas();
      const r = await confirmar(await previa("ig_publicar_reels", { video: arquivo("reels.mp4", MP4) }));
      await estadoDePublicacao(m.ctx).trabalhos.aguardar(r.structuredContent!.resultado.trabalho_id);
      const publicado = registro().find((l) => l.evento === "publicado");
      assert.ok(publicado);
      const etapas = publicado.etapas_ms as Record<string, unknown>;
      for (const campo of ["hospedagem", "containers", "espera", "publicacao", "criar_container", "enviar_video"]) {
        assert.equal(typeof etapas[campo], "number", campo);
        assert.ok((etapas[campo] as number) >= 0, campo);
      }
      assert.deepEqual(Object.keys(etapas).sort(), ["containers", "criar_container", "enviar_video", "espera", "hospedagem", "publicacao"]);
    });

    it("carrossel com vídeo local também responde na hora e soma as etapas dos vídeos", async () => {
      rotas();
      m.graphFalsa.rota("GET", "/c3", { corpo: { id: "c3", status_code: "FINISHED" } }); // o container pai
      const p = await previa("ig_publicar_carrossel", { itens: [{ arquivo: arquivo("a.mp4", MP4) }, { arquivo: arquivo("b.mp4", MP4) }] });
      const r = await confirmar(p);
      assert.ok(!r.isError, textoDe(r));
      assert.equal(r.structuredContent!.resultado.estado, "processando");
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(r.structuredContent!.resultado.trabalho_id);
      assert.equal(t?.estado, "publicado", t?.erro ?? "");
      const etapas = registro().find((l) => l.evento === "publicado")!.etapas_ms as Record<string, unknown>;
      assert.equal(typeof etapas.criar_container, "number");
      assert.equal(typeof etapas.enviar_video, "number");
    });

    it("foto sozinha continua síncrona: devolve 'publicado' sem passar por segundo plano e sem campos de vídeo em etapas_ms", async () => {
      rotas();
      const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO }));
      assert.ok(!r.isError, textoDe(r));
      const resultado = r.structuredContent!.resultado;
      assert.equal(resultado.estado, "publicado");
      assert.equal(resultado.permalink, "https://www.instagram.com/reel/ABC/");
      assert.ok(!("criar_container" in resultado.etapas_ms) && !("enviar_video" in resultado.etapas_ms));
      assert.match(textoDe(r), /^Pronto \(pedido/);
    });

    it("vídeo local funciona sem a chave do Uploadcare (ela só serve para foto)", async () => {
      m.ctx.hospedagem = null;
      rotas();
      const r = await confirmar(await previa("ig_publicar_reels", { video: arquivo("reels.mp4", MP4) }));
      assert.ok(!r.isError, textoDe(r));
      assert.equal(uc.pedidos.length, 0);
    });

    it("sem a chave do Uploadcare, capa local é recusada antes da prévia e a frase lembra do capa_ms", async () => {
      m.ctx.hospedagem = null;
      const r = await chamar("ig_publicar_reels", { video: URL_VIDEO, capa: arquivo("capa.jpg", jpeg(1080, 1920)) });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /^Não publiquei nada e não pedi confirmação:\n- Para publicar foto do computador.*`capa_ms`.*dispensa a chave/s);
      assert.equal(r.structuredContent?.pedido, undefined);
      assert.equal(m.graphFalsa.pedidos.length, 0);
    });
  });

  describe("story", () => {
    it("de imagem: sobe pelo Uploadcare, container STORIES com image_url e publica sem sair da chamada", async () => {
      rotas();
      const p = await previa("ig_publicar_story", { midia: arquivo("story.jpg", jpeg(1080, 1920)) });
      assert.match(detalhesDe(p), /Mídia: story\.jpg · JPEG · 1080×1920/);
      assert.equal(uc.pedidos.length, 0, "nada sobe antes do clique");
      const r = await confirmar(p);
      assert.ok(!r.isError, textoDe(r));
      assert.equal(r.structuredContent?.resultado.estado, "publicado");
      assert.equal(r.structuredContent?.resultado.midia_id, "midia1");
      const [container, publicar] = posts();
      const c = corpoDe(container!);
      assert.equal(c.media_type, "STORIES");
      assert.equal(c.image_url, `${uc.base}/uuid-falso-1/foto.jpg`);
      assert.deepEqual(Object.keys(c).sort(), ["image_url", "media_type"]);
      assert.deepEqual(corpoDe(publicar!), { creation_id: "c1" });
      assert.deepEqual(esperas, [1000]);
    });

    it("de imagem com URL e marcação: a URL passa direto e a marcação vai em user_tags", async () => {
      rotas();
      const r = await confirmar(await previa("ig_publicar_story", { midia: URL_FOTO, marcacoes: [{ usuario: "amiga", x: 0.5, y: 0.4 }] }));
      assert.equal(r.structuredContent?.resultado.estado, "publicado");
      assert.deepEqual(corpoDe(posts()[0]!), { media_type: "STORIES", image_url: URL_FOTO, user_tags: [{ username: "amiga", x: 0.5, y: 0.4 }] });
      assert.equal(uc.pedidos.length, 0);
    });

    it("de vídeo local: container STORIES resumable, bytes direto para a Meta, responde na hora e publica em segundo plano", async () => {
      rotas({ statuses: [{ status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }] });
      const p = await previa("ig_publicar_story", { midia: arquivo("story.mp4", MP4) });
      assert.match(detalhesDe(p), /Mídia: story\.mp4 · vídeo MP4/);
      const r = await confirmar(p);
      const resultado = r.structuredContent!.resultado;
      assert.equal(resultado.estado, "processando");
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(resultado.trabalho_id);
      assert.equal(t?.estado, "publicado");
      const c = corpoDe(posts()[0]!);
      assert.equal(c.media_type, "STORIES");
      assert.deepEqual(c, { media_type: "STORIES", upload_type: "resumable" });
      assert.equal(t?.containers[0]?.tipo, "VIDEO");
      assert.equal(uc.pedidos.length, 0, "vídeo nunca passa pelo Uploadcare");
      const rupload = m.graphFalsa.pedidos.filter((x) => x.caminho.startsWith("/rupload/"));
      assert.equal(rupload.length, 1);
      assert.ok(rupload[0]!.corpoBruto.equals(MP4));
    });

    it("vídeo de 70 s é recusado como story (ffprobe falso)", async () => {
      duracao = 70;
      const r = await chamar("ig_publicar_story", { midia: arquivo("longo.mp4", MP4) });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /70 s; vídeo de story precisa ter de 3 s a 60 s/);
      assert.equal(m.graphFalsa.pedidos.length, 0);
      assert.equal(uc.pedidos.length, 0);
    });

    it("EXPIRED em segundo plano falha sem publicar", async () => {
      rotas({ statuses: [{ status_code: "EXPIRED" }] });
      const r = await confirmar(await previa("ig_publicar_story", { midia: URL_VIDEO }));
      const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(r.structuredContent!.resultado.trabalho_id);
      assert.equal(t?.estado, "falhou");
      assert.match(t?.erro ?? "", /expirou/);
      assert.ok(!posts().some((x) => x.caminho.endsWith("/media_publish")));
    });

    it("sem a chave do Uploadcare, foto de story local é recusada antes da prévia; vídeo local passa", async () => {
      m.ctx.hospedagem = null;
      const r = await chamar("ig_publicar_story", { midia: arquivo("s.jpg", jpeg(1080, 1920)) });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /^Não publiquei nada e não pedi confirmação:\n- Para publicar foto do computador/);
      assert.doesNotMatch(textoDe(r), /capa_ms/);
      assert.equal(m.graphFalsa.pedidos.length, 0);
    });

    it("recusa texto_alternativo e colaboradores com explicação, sem chamar a Graph", async () => {
      const r = await chamar("ig_publicar_story", { midia: URL_FOTO, texto_alternativo: "Uma foto", colaboradores: ["alguem"] });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /Story não aceita texto_alternativo/);
      assert.match(textoDe(r), /Story não aceita colaboradores/);
      assert.equal(m.graphFalsa.pedidos.length, 0);
    });

    it("foto fora de 9:16 só avisa; PNG é recusado", async () => {
      rotas();
      const p = await previa("ig_publicar_story", { midia: arquivo("quadrada.jpg", jpeg(1080, 1080)) });
      assert.match(detalhesDe(p), /Aviso: .*1080×1080 não é 9:16/);
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
      const r = await chamar("ig_publicar_story", { midia: arquivo("s.png", png) });
      assert.equal(r.isError, true);
      assert.match(textoDe(r), /PNG/);
    });
  });
});
