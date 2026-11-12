// Ficha 09: publicação de post e carrossel. Tudo contra a Graph falsa, o Uploadcare falso e um relógio falso:
// nada sai para a Meta nem para o Uploadcare de verdade, e a contagem local fica numa pasta temporária.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { VALIDADE_MS } from "../src/confirmacao.ts";
import { ContagemPublicacoes } from "../src/contagem-publicacoes.ts";
import { configurarPublicacao, estadoDePublicacao, ESPERAS_DE_IMAGEM_MS, INTERVALO_EM_SEGUNDO_PLANO_MS } from "../src/publicacao.ts";
import { esquecerSegredos } from "../src/segredos.ts";
import type { Executor } from "../src/sistema.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, erroMeta, rotasDeContainer } from "./graph-falsa.ts";
import { CHAVE_UPLOADCARE_TESTE, hospedagemDeTeste, UploadcareFalso } from "./uploadcare-falso.ts";
import { jpeg } from "./jpeg.ts";

const IG = CONTA_TESTE.id;
const URL_FOTO = "https://exemplo.com/foto.jpg";
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);

type Resultado = { isError?: boolean; content: Array<{ text?: string }>; structuredContent?: Record<string, any>; _meta?: Record<string, any> };
const textoDe = (r: Resultado): string => r.content.map((b) => b.text ?? "").join("\n");

describe("publicação de post e carrossel", () => {
  let m: Montagem;
  let uc: UploadcareFalso;
  let pasta: string;
  let esperas: number[];
  let agora: number;
  let cliente: Awaited<ReturnType<typeof conectarCliente>>["cliente"];
  let fechar: () => Promise<void>;
  let contagemCaminho: string;

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

  /** Rotas comuns: cota, containers (c1, c2...), status em roteiro, publicação e link. */
  function rotas(opcoes: { usoDaMeta?: number; statuses?: Array<Record<string, unknown>>; publicar?: Record<string, unknown> } = {}): void {
    const g = m.graphFalsa;
    g.rota("GET", `/${IG}/content_publishing_limit`, { corpo: { data: [{ quota_usage: opcoes.usoDaMeta ?? 0, config: { quota_total: 100, quota_duration: 86400 } }] } });
    rotasDeContainer(g, IG);
    g.rota("POST", `/${IG}/media_publish`, { corpo: opcoes.publicar ?? { id: "midia1" } });
    g.rota("GET", "/midia1", { corpo: { id: "midia1", permalink: "https://www.instagram.com/p/ABC/" } });
    const statuses = opcoes.statuses ?? [{ status_code: "FINISHED" }];
    // Um roteiro por container: cada GET de status consome o próximo item; o último se repete.
    const fila = [...statuses];
    const proximo = () => (fila.length > 1 ? fila.shift()! : fila[0]!);
    for (const id of ["c1", "c2", "c3", "c4"]) g.rota("GET", `/${id}`, () => ({ corpo: { id, ...proximo() } }));
  }

  /** Pede a prévia e devolve id e código. */
  async function previa(nome: string, args: Record<string, unknown>): Promise<{ id: string; codigo: string; r: Resultado }> {
    const r = await chamar(nome, args);
    assert.ok(!r.isError, textoDe(r));
    return { id: String(r.structuredContent?.pedido), codigo: String(r._meta?.codigo), r };
  }
  const confirmar = (p: { id: string; codigo: string }) => chamar("ig_confirmar", { id: p.id, codigo: p.codigo });

  beforeEach(async () => {
    esquecerSegredos();
    agora = 1_000_000;
    m = await montar({ agora: () => agora });
    uc = new UploadcareFalso();
    await uc.iniciar();
    pasta = mkdtempSync(join(tmpdir(), "pub-"));
    contagemCaminho = join(pasta, "publicacoes.json");
    esperas = [];
    m.ctx.hospedagem = hospedagemDeTeste(uc);
    configurarPublicacao(m.ctx, {
      contagem: new ContagemPublicacoes(contagemCaminho),
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

  it("o resultado e o texto Pronto trazem o link da publicação, buscado com GET permalink depois de publicar", async () => {
    rotas();
    const p = await previa("ig_publicar_post", { imagem: URL_FOTO, legenda: "Oi" });
    const r = await confirmar(p);
    assert.ok(!r.isError, textoDe(r));
    assert.equal(r.structuredContent?.resultado.permalink, "https://www.instagram.com/p/ABC/");
    assert.match(textoDe(r), /^Pronto \(pedido .+\): .*\. Link: https:\/\/www\.instagram\.com\/p\/ABC\/$/);
    const consulta = m.graphFalsa.pedidos.find((x) => x.metodo === "GET" && x.caminho === "/midia1");
    assert.equal(consulta?.query.fields, "permalink");
    const publicou = posts().findIndex((x) => x.caminho === `/${IG}/media_publish`);
    assert.ok(publicou >= 0);
  });

  it("se o GET do permalink falhar, a publicação continua certa e o resultado sai sem link", async () => {
    rotas();
    m.graphFalsa.rota("GET", "/midia1", { status: 400, corpo: { error: { message: "Unsupported get request", code: 100 } } });
    const p = await previa("ig_publicar_post", { imagem: URL_FOTO, legenda: "Oi" });
    const r = await confirmar(p);
    assert.ok(!r.isError, textoDe(r));
    assert.equal(r.structuredContent?.resultado.estado, "publicado");
    assert.equal(r.structuredContent?.resultado.midia_id, "midia1");
    assert.equal("permalink" in r.structuredContent?.resultado, false);
    assert.match(textoDe(r), /^Pronto \(pedido .+\): [^]*\.$/);
    assert.ok(!textoDe(r).includes("Link:"));
  });

  it("imagem que fica FINISHED na hora: container com alt_text, consulta aos 2 s, publica, grava o registro e conta localmente", async () => {
    rotas();
    const p = await previa("ig_publicar_post", { imagem: URL_FOTO, legenda: "Oi, mundo", texto_alternativo: "Uma foto" });
    assert.equal(posts().length, 0, "a prévia não escreve nada");
    const r = await confirmar(p);
    assert.ok(!r.isError, textoDe(r));
    assert.equal(r.structuredContent?.resultado.estado, "publicado");
    assert.equal(r.structuredContent?.resultado.permalink, "https://www.instagram.com/p/ABC/");
    const [container, publicar] = posts();
    assert.equal(container!.caminho, `/${IG}/media`);
    assert.deepEqual(corpoDe(container!), { image_url: URL_FOTO, caption: "Oi, mundo", alt_text: "Uma foto" });
    assert.equal(publicar!.caminho, `/${IG}/media_publish`);
    assert.deepEqual(corpoDe(publicar!), { creation_id: "c1" });
    assert.deepEqual(esperas, [1000]);
    assert.equal(JSON.parse(readFileSync(contagemCaminho, "utf8")).publicacoes.length, 1);
    const publicado = registro().find((l) => l.evento === "publicado");
    assert.equal(publicado?.midia_id, "midia1");
  });

  it("foto local: nada sobe antes do clique; depois, sobe para o Uploadcare sem guardar e a Meta recebe o endereço do CDN", async () => {
    rotas();
    const bytes = jpeg(1080, 1350);
    const caminho = arquivo("foto.jpg", bytes);
    const p = await previa("ig_publicar_post", { imagem: caminho, legenda: "Local" });
    assert.equal(uc.pedidos.length, 0, "nada sobe antes do clique");
    const r = await confirmar(p);
    assert.ok(!r.isError, textoDe(r));
    assert.equal(uc.envios.length, 1);
    assert.equal(uc.envios[0]!.campos.UPLOADCARE_STORE, "0");
    assert.equal(uc.envios[0]!.campos.UPLOADCARE_PUB_KEY, CHAVE_UPLOADCARE_TESTE);
    assert.ok(uc.envios[0]!.arquivo.equals(bytes));
    const [container] = posts();
    const c = corpoDe(container!);
    assert.equal(c.image_url, `${uc.base}/uuid-falso-1/foto.jpg`);
    assert.ok(!("upload_type" in c));
    assert.ok(!JSON.stringify(r).includes(CHAVE_UPLOADCARE_TESTE), "a chave não aparece na resposta");
  });

  it("IN_PROGRESS seguido de FINISHED: consulta aos 1 s e 2 s e publica sem ir para segundo plano", async () => {
    rotas({ statuses: [{ status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }] });
    const p = await previa("ig_publicar_post", { imagem: URL_FOTO });
    const r = await confirmar(p);
    assert.equal(r.structuredContent?.resultado.estado, "publicado");
    assert.deepEqual(esperas, [1000, 1000]);
  });

  it("ERROR: o trabalho falha com a frase traduzida e não publica", async () => {
    rotas({ statuses: [{ status_code: "ERROR", status: "Error: Media upload has failed with error code 2207004" }] });
    const caminho = arquivo("foto.jpg", jpeg(1080, 1350));
    const p = await previa("ig_publicar_post", { imagem: caminho });
    const r = await confirmar(p);
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /ERROR: a imagem é grande demais/);
    assert.ok(!posts().some((x) => x.caminho.endsWith("/media_publish")), "não publicou");
    assert.ok(registro().some((l) => l.evento === "publicacao_falhou"));
    assert.equal(existsSync(contagemCaminho), false, "não contou publicação");
  });

  it("EXPIRED também falha sem publicar", async () => {
    rotas({ statuses: [{ status_code: "EXPIRED" }] });
    const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO }));
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /expirou/);
    assert.ok(!posts().some((x) => x.caminho.endsWith("/media_publish")));
  });

  it("ainda processando depois de 15 s: devolve 'processando' com trabalho_id e termina sozinho; ig_status_publicacao acompanha", async () => {
    // 10 consultas em 15 s (todas IN_PROGRESS), depois duas em segundo plano (a 2ª termina).
    rotas({ statuses: [...Array(11).fill({ status_code: "IN_PROGRESS" }), { status_code: "FINISHED" }] });
    const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO }));
    assert.ok(!r.isError, textoDe(r));
    const { estado, trabalho_id } = r.structuredContent!.resultado;
    assert.equal(estado, "processando");
    assert.match(trabalho_id, /^t_/);
    const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(trabalho_id);
    assert.equal(t?.estado, "publicado");
    assert.deepEqual(esperas, [...ESPERAS_DE_IMAGEM_MS, INTERVALO_EM_SEGUNDO_PLANO_MS, INTERVALO_EM_SEGUNDO_PLANO_MS]);
    const status = await chamar("ig_status_publicacao", { trabalho_id });
    assert.equal(status.structuredContent?.estado, "publicado");
    assert.equal(status.structuredContent?.midia_id, "midia1");
    assert.equal((await chamar("ig_status_publicacao", { trabalho_id: "t_naoexiste" })).isError, true);
  });

  it("falha em segundo plano fica no status do trabalho", async () => {
    rotas({ statuses: [...Array(10).fill({ status_code: "IN_PROGRESS" }), { status_code: "ERROR" }] });
    const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO }));
    const id = r.structuredContent!.resultado.trabalho_id as string;
    const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(id);
    assert.equal(t?.estado, "falhou");
    assert.match(t?.erro ?? "", /ERROR/);
  });

  it("desiste depois de 5 minutos em IN_PROGRESS", async () => {
    rotas({ statuses: [{ status_code: "IN_PROGRESS" }] });
    const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO }));
    const id = r.structuredContent!.resultado.trabalho_id as string;
    const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(id);
    assert.equal(t?.estado, "falhou");
    assert.match(t?.erro ?? "", /5 minutos/);
    assert.equal(esperas.reduce((a, b) => a + b, 0), 300_000);
    assert.ok(!posts().some((x) => x.caminho.endsWith("/media_publish")));
  });

  it("imagem FINISHED na 2ª consulta: publica depois de ~2 s de espera simulada (1 s + 1 s)", async () => {
    rotas({ statuses: [{ status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }] });
    const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO }));
    assert.equal(r.structuredContent?.resultado.estado, "publicado");
    assert.equal(esperas.reduce((a, b) => a + b, 0), 2_000);
    assert.equal(m.graphFalsa.pedidos.filter((x) => x.metodo === "GET" && x.caminho === "/c1").length, 2);
  });

  it("imagem que nunca termina em 15 s: as 10 consultas somam 15 s e a ferramenta devolve 'processando'", async () => {
    rotas({ statuses: [{ status_code: "IN_PROGRESS" }] });
    const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO }));
    assert.equal(r.structuredContent?.resultado.estado, "processando");
    assert.equal(ESPERAS_DE_IMAGEM_MS.length, 10);
    assert.equal(ESPERAS_DE_IMAGEM_MS.reduce((a, b) => a + b, 0), 15_000);
    await estadoDePublicacao(m.ctx).trabalhos.aguardar(r.structuredContent!.resultado.trabalho_id);
    assert.deepEqual(esperas.slice(0, 10), [...ESPERAS_DE_IMAGEM_MS]);
    // Depois dos 15 s: de 10 em 10 s; a última espera encurta para fechar exatamente 5 min (28 x 10 s + 5 s).
    assert.ok(esperas.slice(10, -1).every((e) => e === INTERVALO_EM_SEGUNDO_PLANO_MS));
    assert.equal(esperas.reduce((x, y) => x + y, 0), 300_000);
  });

  it("o evento 'enviado' traz duracao_ms numérico e a publicação traz etapas_ms (só números)", async () => {
    rotas();
    const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO }));
    assert.ok(!r.isError, textoDe(r));
    const enviado = registro().find((l) => l.evento === "enviado");
    assert.equal(typeof enviado?.duracao_ms, "number");
    assert.ok(enviado!.duracao_ms >= 0);
    for (const alvo of [enviado?.resultado?.etapas_ms, registro().find((l) => l.evento === "publicado")?.etapas_ms]) {
      assert.deepEqual(Object.keys(alvo).sort(), ["containers", "espera", "hospedagem", "publicacao"]);
      for (const v of Object.values(alvo)) assert.equal(typeof v, "number");
    }
  });

  it("cota cheia (Meta): recusa antes de qualquer pedido de confirmação e sem escrever", async () => {
    rotas({ usoDaMeta: 100 });
    const r = await chamar("ig_publicar_post", { imagem: URL_FOTO });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /Cota de publicação cheia: 100 de 100/);
    assert.equal(r._meta?.codigo, undefined);
    assert.equal(posts().length, 0);
  });

  it("a Meta diz 0, mas a contagem local tem 100 nas últimas 24 h: usa o maior e recusa", async () => {
    rotas({ usoDaMeta: 0 });
    writeFileSync(contagemCaminho, JSON.stringify({ publicacoes: Array.from({ length: 100 }, () => Date.now() - 3_600_000) }));
    const r = await chamar("ig_publicar_post", { imagem: URL_FOTO });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /100 de 100/);
    const limite = await chamar("ig_limite_publicacao", {});
    assert.deepEqual(
      { usadas: limite.structuredContent?.usadas, restantes: limite.structuredContent?.restantes, meta: limite.structuredContent?.usadas_segundo_a_meta },
      { usadas: 100, restantes: 0, meta: 0 },
    );
  });

  it("publicações com mais de 24 h não contam", async () => {
    rotas();
    writeFileSync(contagemCaminho, JSON.stringify({ publicacoes: [Date.now() - 25 * 3_600_000] }));
    const limite = await chamar("ig_limite_publicacao", {});
    assert.equal(limite.structuredContent?.usadas, 0);
  });

  it("PNG é recusado antes da confirmação, sem falar com a Graph", async () => {
    const png = arquivo("foto.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]));
    const r = await chamar("ig_publicar_post", { imagem: png });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /PNG.*sips/s);
    assert.equal(m.graphFalsa.pedidos.length, 0);
    assert.equal(uc.pedidos.length, 0);
  });

  it("legenda com 31 hashtags é recusada; com 7 só avisa na prévia", async () => {
    const legenda31 = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    const r = await chamar("ig_publicar_post", { imagem: URL_FOTO, legenda: legenda31 });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /31 hashtags/);
    assert.equal(m.graphFalsa.pedidos.length, 0);

    rotas();
    const sete = Array.from({ length: 7 }, (_, i) => `#t${i}`).join(" ");
    const p = await previa("ig_publicar_post", { imagem: URL_FOTO, legenda: `Oi ${sete}` });
    assert.match(((p.r._meta?.previa as Record<string, any>)?.detalhes as string[]).join("\n"), /Aviso: A legenda tem 7 hashtags/);
  });

  it("carrossel com 21 itens é recusado", async () => {
    const itens = Array.from({ length: 21 }, (_, i) => ({ arquivo: `https://exemplo.com/${i}.jpg` }));
    const r = await chamar("ig_publicar_carrossel", { itens });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /de 2 a 20 itens \(recebi 21\)/);
    assert.equal(m.graphFalsa.pedidos.length, 0);
    const um = await chamar("ig_publicar_carrossel", { itens: [{ arquivo: URL_FOTO }] });
    assert.match(textoDe(um), /de 2 a 20 itens \(recebi 1\)/);
  });

  it("pedido cancelado ou vencido: zero escritas e nada sobe", async () => {
    rotas();
    const caminho = arquivo("foto.jpg", jpeg(1080, 1350));
    const cancelado = await previa("ig_publicar_post", { imagem: caminho });
    const c = await chamar("ig_cancelar", { id: cancelado.id });
    assert.ok(!c.isError, textoDe(c));
    const vencido = await previa("ig_publicar_post", { imagem: caminho });
    agora += VALIDADE_MS + 1;
    for (const p of [cancelado, vencido]) {
      const r = await confirmar(p);
      assert.equal(r.isError, true);
    }
    assert.equal(posts().length, 0);
    assert.equal(uc.pedidos.length, 0, "nada subiu");
  });

  it("a confirmação mostra a legenda inteira, a cota e a janela do feed", async () => {
    rotas({ usoDaMeta: 3 });
    const legenda = `${"Palavra ".repeat(40)}fim`;
    const { r } = await previa("ig_publicar_post", { imagem: URL_FOTO, legenda, texto_alternativo: "Foto" });
    const dados = r._meta?.previa as Record<string, any>;
    assert.equal(dados.texto, legenda, "legenda inteira, sem cortar");
    const detalhes = (dados.detalhes as string[]).join("\n");
    assert.match(detalhes, /Cota: 3 de 100 usadas nas últimas 24 h/);
    assert.match(detalhes, /Depois deste post: 4 de 100/);
    assert.match(detalhes, /Janela do feed \(~125 caracteres.*… mais/);
    assert.equal(dados.botao, "Publicar");
    assert.ok(!JSON.stringify(r.structuredContent).includes(String(r._meta?.codigo)));
  });

  it("miniatura da foto vai só no _meta, gerada com sips", async () => {
    rotas();
    const miniatura = jpeg(160, 200);
    const executar: Executor = async (comando, args) => {
      if (comando === "sips") {
        writeFileSync(args[args.indexOf("--out") + 1]!, miniatura);
        return { codigo: 0, stdout: "", stderr: "" };
      }
      return { codigo: 127, stdout: "", stderr: "" };
    };
    m.ctx.executar = executar;
    const p = await previa("ig_publicar_post", { imagem: arquivo("foto.jpg", jpeg(1080, 1350)) });
    assert.equal(p.r._meta?.miniaturas.length, 1);
    assert.match(p.r._meta?.miniaturas[0], /^data:image\/jpeg;base64,/);
  });

  it("o arquivo que muda entre a prévia e o clique não é publicado", async () => {
    rotas();
    const caminho = arquivo("foto.jpg", jpeg(1080, 1350));
    const p = await previa("ig_publicar_post", { imagem: caminho });
    writeFileSync(caminho, jpeg(1080, 1350, 10));
    const r = await confirmar(p);
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /mudou depois da prévia/);
    assert.equal(posts().length, 0);
    assert.equal(uc.pedidos.length, 0);
  });

  it("config_issue na resposta do media_publish vira aviso", async () => {
    rotas({ publicar: { id: "midia1", config_issue: "CAPTION_NOT_ATTACHED" } });
    const r = await confirmar(await previa("ig_publicar_post", { imagem: URL_FOTO, legenda: "x" }));
    assert.equal(r.structuredContent?.resultado.estado, "publicado");
    assert.match(r.structuredContent?.resultado.avisos[0], /CAPTION_NOT_ATTACHED/);
  });

  it("limite de publicação (code 9) no media_publish falha com a frase de limite", async () => {
    rotas();
    m.graphFalsa.rota("POST", `/${IG}/media_publish`, erroMeta(9, "limit", 2207042));
    const r = await confirmar(await previa("ig_publicar_post", { imagem: arquivo("f.jpg", jpeg(1080, 1350)) }));
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /Limite de publicação atingido/);
  });

  it("carrossel misto (foto local e vídeo local): a foto vai pelo Uploadcare, o vídeo direto para a Meta; pai CAROUSEL com children", async () => {
    rotas({ statuses: [{ status_code: "FINISHED" }] });
    const itens = [{ arquivo: arquivo("a.jpg", jpeg(1080, 1350)), texto_alternativo: "A" }, { arquivo: arquivo("b.mp4", MP4) }];
    const p = await previa("ig_publicar_carrossel", { itens, legenda: "Carrossel" });
    assert.match(((p.r._meta?.previa as Record<string, any>)?.detalhes as string[]).join("\n"), /Item 2: b\.mp4 · vídeo MP4/);
    const r = await confirmar(p);
    assert.ok(!r.isError, textoDe(r));
    const resultado = r.structuredContent!.resultado;
    assert.equal(resultado.estado, "processando", "com vídeo a ferramenta devolve na hora");
    const t = await estadoDePublicacao(m.ctx).trabalhos.aguardar(resultado.trabalho_id);
    assert.equal(t?.estado, "publicado");
    const [filho1, filho2, pai, publicar] = posts();
    const urlFilho1 = corpoDe(filho1!).image_url as string;
    assert.deepEqual(corpoDe(filho1!), { image_url: urlFilho1, is_carousel_item: true, alt_text: "A" });
    const b2 = corpoDe(filho2!);
    assert.deepEqual(b2, { media_type: "VIDEO", upload_type: "resumable", is_carousel_item: true });
    assert.equal(uc.envios.length, 1, "só a foto passa pelo Uploadcare");
    assert.equal(urlFilho1, `${uc.base}/uuid-falso-1/foto.jpg`);
    const rupload = m.graphFalsa.pedidos.filter((x) => x.caminho.startsWith("/rupload/"));
    assert.equal(rupload.length, 1, "só o vídeo vai pelo rupload");
    assert.equal(rupload[0]!.caminho, "/rupload/ig-api-upload/v27.0/c2");
    assert.ok(rupload[0]!.corpoBruto.equals(MP4));
    assert.deepEqual(corpoDe(pai!), { media_type: "CAROUSEL", children: ["c1", "c2"], caption: "Carrossel" });
    assert.deepEqual(corpoDe(publicar!), { creation_id: "c3" });
  });

  it("carrossel só de fotos publica sem sair da chamada", async () => {
    rotas();
    const itens = [{ arquivo: URL_FOTO }, { arquivo: "https://exemplo.com/b.jpg" }];
    const r = await confirmar(await previa("ig_publicar_carrossel", { itens }));
    assert.equal(r.structuredContent?.resultado.estado, "publicado");
    assert.equal(posts().length, 4);
  });

  it("item de carrossel PNG recusa o carrossel inteiro antes da confirmação", async () => {
    const png = arquivo("b.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]));
    const r = await chamar("ig_publicar_carrossel", { itens: [{ arquivo: arquivo("a.jpg", jpeg(1080, 1350)) }, { arquivo: png }] });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /Item 2 \(b\.png\).*PNG/s);
    assert.equal(m.graphFalsa.pedidos.length, 0);
  });

  it("post não aceita vídeo", async () => {
    const r = await chamar("ig_publicar_post", { imagem: arquivo("v.mp4", MP4) });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /só aceito foto/);
  });

  it("sem a chave do Uploadcare, foto local é recusada antes da prévia, sem Graph e sem pedido; URL https segue", async () => {
    m.ctx.hospedagem = null;
    const r = await chamar("ig_publicar_post", { imagem: arquivo("foto.jpg", jpeg(1080, 1350)) });
    assert.equal(r.isError, true);
    assert.match(textoDe(r), /^Não publiquei nada e não pedi confirmação:\n- Para publicar foto do computador/);
    assert.equal(r.structuredContent?.pedido, undefined);
    assert.equal(m.graphFalsa.pedidos.length, 0);
    rotas();
    const url = await chamar("ig_publicar_post", { imagem: URL_FOTO });
    assert.ok(!url.isError, textoDe(url));
  });
});
