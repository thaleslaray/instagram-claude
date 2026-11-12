// Laço de consulta do cartão (ui/acompanhamento.js): sem DOM, com relógio e consulta falsos.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VERSAO_SERVIDOR } from "../src/versao.ts";
import { fraseDePronto } from "../src/escrita.ts";
import { HTML_CONFIRMAR } from "../src/ui-gerada.ts";
import { acompanhar, diagnosticarSemTrabalho, extrairTrabalho, fraseDoPasso, INTERVALO_MS, LIMITE_MS, MAX_FALHAS_SEGUIDAS } from "../ui/acompanhamento.js";

type Linha = { texto: string; tipo: string };

/** Roda o laço com uma fila de respostas da consulta (cada item: o resultado, ou um Error para lançar). */
async function rodar(respostas: Array<unknown>) {
  let agora = 0;
  const esperas: number[] = [];
  const linhas: Linha[] = [];
  let consultas = 0;
  const fim = await acompanhar({
    trabalhoId: "t_0123456789",
    pedidoId: "ab12cd34",
    consultar: async () => {
      const r = respostas[Math.min(consultas, respostas.length - 1)];
      consultas++;
      if (r instanceof Error) throw r;
      return r;
    },
    mostrar: (texto, tipo) => linhas.push({ texto, tipo }),
    esperar: async (ms) => {
      esperas.push(ms);
      agora += ms;
    },
    agora: () => agora,
  });
  return { fim, esperas, linhas, consultas };
}
const status = (estado: string, extra: Record<string, unknown> = {}) => ({ structuredContent: { estado, ...extra } });

describe("cartão acompanha o trabalho em segundo plano", () => {
  it("constantes: consulta a cada 5 s, limite de 6 minutos, 3 falhas seguidas", () => {
    assert.equal(INTERVALO_MS, 5_000);
    assert.equal(LIMITE_MS, 360_000);
    assert.equal(MAX_FALHAS_SEGUIDAS, 3);
  });

  it("frases do passo por estado", () => {
    assert.equal(fraseDoPasso("hospedando"), "Enviando o vídeo para a Meta…");
    assert.equal(fraseDoPasso("criando_containers"), "Enviando o vídeo para a Meta…");
    assert.equal(fraseDoPasso("processando"), "A Meta está processando o vídeo…");
    assert.equal(fraseDoPasso("publicando"), "Publicando…");
    assert.equal(fraseDoPasso("qualquer"), "");
  });

  it("extrai o trabalho só de 'processando' com trabalho_id (structuredContent ou texto)", () => {
    assert.deepEqual(extrairTrabalho({ structuredContent: { resultado: { estado: "processando", trabalho_id: "t_0123456789" } } }), { trabalhoId: "t_0123456789" });
    assert.equal(extrairTrabalho({ structuredContent: { resultado: { estado: "publicado", trabalho_id: "t_0123456789" } } }), null);
    assert.equal(extrairTrabalho({ structuredContent: { resultado: { estado: "processando", trabalho_id: "x; drop" } } }), null);
    assert.equal(extrairTrabalho({ content: [{ type: "text", text: "Pronto (pedido ab12cd34): ok." }] }), null);
    assert.equal(extrairTrabalho(undefined), null);
  });

  const textoProcessando = fraseDePronto("ab12cd34", "reels", { estado: "processando", trabalho_id: "t_a91f342382", com_video: true });
  const bloco = (text: string) => [{ type: "text", text }];

  it("extrairTrabalho: estruturado completo, structuredContent ausente ou vazio, resultado sem estado", () => {
    const esperado = { trabalhoId: "t_a91f342382" };
    // estruturado completo (com o texto junto)
    assert.deepEqual(extrairTrabalho({ content: bloco(textoProcessando), structuredContent: { resultado: { estado: "processando", trabalho_id: "t_a91f342382" } } }), esperado);
    // structuredContent ausente: cai no texto de "processando"
    assert.deepEqual(extrairTrabalho({ content: bloco(textoProcessando) }), esperado);
    // structuredContent {}
    assert.deepEqual(extrairTrabalho({ content: bloco(textoProcessando), structuredContent: {} }), esperado);
    // resultado sem estado
    assert.deepEqual(extrairTrabalho({ content: bloco(textoProcessando), structuredContent: { resultado: { trabalho_id: "t_a91f342382" } } }), esperado);
    // estruturado com id inválido: tenta o texto
    assert.deepEqual(extrairTrabalho({ content: bloco(textoProcessando), structuredContent: { resultado: { estado: "processando", trabalho_id: "x; drop" } } }), esperado);
  });

  it("extrairTrabalho: texto de 'Pronto' de foto não acompanha, nem id solto, nem estado publicado", () => {
    const pronto = fraseDePronto("ab12cd34", "foto", { estado: "publicado", permalink: "https://www.instagram.com/p/ABC/" });
    assert.equal(extrairTrabalho({ content: bloco(pronto), structuredContent: { resultado: { estado: "publicado" } } }), null);
    assert.equal(extrairTrabalho({ content: bloco(pronto) }), null);
    assert.equal(extrairTrabalho({ content: bloco("Pronto (pedido ab12cd34): legenda cita t_a91f342382.") }), null);
    assert.equal(extrairTrabalho({ content: bloco(textoProcessando), structuredContent: { resultado: { estado: "publicado" } } }), null);
  });

  it("diagnóstico: processando que não deu para extrair mostra o trabalho_id; o resto fica em silêncio", () => {
    assert.equal(diagnosticarSemTrabalho({ content: bloco(textoProcessando) }), null, "extraiu, nada a diagnosticar");
    assert.equal(diagnosticarSemTrabalho({ content: bloco("Pronto (pedido ab12cd34): ok.") }), null);
    const d = diagnosticarSemTrabalho({ content: bloco("Recebido, use ig_status_publicacao com o trabalho_id t_a91f342382.") });
    assert.equal(d?.trabalhoId, "t_a91f342382");
    assert.ok(d && d.motivo !== "" && !d.motivo.includes("t_a91f342382"), "o motivo não leva o id");
    const e = diagnosticarSemTrabalho({ structuredContent: { resultado: { estado: "processando" } } });
    assert.equal(e?.trabalhoId, "");
  });

  it("o cartão gerado liga o diagnóstico e leva a versão no rodapé", () => {
    assert.ok(HTML_CONFIRMAR.includes("Não consegui acompanhar. Peça ao Claude o status com o trabalho_id "));
    assert.ok(HTML_CONFIRMAR.includes(`v${VERSAO_SERVIDOR}`));
  });

  it("mostra cada passo, de 5 em 5 s, e termina em publicado com o link", async () => {
    const { fim, esperas, linhas } = await rodar([
      status("criando_containers"),
      status("processando"),
      status("processando"),
      status("publicando"),
      status("publicado", { permalink: "https://www.instagram.com/reel/ABC/" }),
    ]);
    assert.deepEqual(fim, { fim: "publicado", permalink: "https://www.instagram.com/reel/ABC/" });
    assert.deepEqual(esperas, [5_000, 5_000, 5_000, 5_000]);
    const textos = linhas.map((l) => l.texto);
    assert.ok(textos.includes("Enviando o vídeo para a Meta…"));
    assert.ok(textos.includes("A Meta está processando o vídeo…"));
    assert.ok(textos.includes("Publicando…"));
    assert.deepEqual(linhas.at(-1), { texto: "Pronto (pedido ab12cd34): publicado no Instagram.", tipo: "ok" });
  });

  it("link que não é https não vira link", async () => {
    const { fim } = await rodar([status("publicado", { permalink: "javascript:alert(1)" })]);
    assert.equal(fim.fim, "publicado");
    assert.equal(fim.permalink, "");
  });

  it("falhou: mostra a frase do erro como erro e para", async () => {
    const { fim, linhas, consultas } = await rodar([status("processando"), status("falhou", { erro: "A Meta não aceitou o envio do vídeo (HTTP 500). Nada foi publicado." })]);
    assert.equal(fim.fim, "falhou");
    assert.equal(consultas, 2);
    assert.deepEqual(linhas.at(-1), { texto: "A Meta não aceitou o envio do vídeo (HTTP 500). Nada foi publicado.", tipo: "erro" });
  });

  it("uma consulta que falha é tentada de novo na volta seguinte", async () => {
    const { fim, consultas, esperas } = await rodar([new Error("rede"), { isError: true, content: [] }, status("publicado", { permalink: "https://www.instagram.com/p/X/" })]);
    assert.equal(fim.fim, "publicado");
    assert.equal(consultas, 3);
    assert.deepEqual(esperas, [5_000, 5_000]);
  });

  it("três falhas seguidas: para e mostra o trabalho_id", async () => {
    const { fim, consultas, linhas } = await rodar([new Error("rede")]);
    assert.equal(fim.fim, "sem_consulta");
    assert.equal(consultas, 3);
    assert.deepEqual(linhas.at(-1), { texto: "Não consegui acompanhar. Peça ao Claude o status com o trabalho_id t_0123456789.", tipo: "erro" });
  });

  it("falha, sucesso, falha, falha não conta como três seguidas", async () => {
    const { fim } = await rodar([new Error("x"), status("processando"), new Error("x"), new Error("x"), status("publicado")]);
    assert.equal(fim.fim, "publicado");
  });

  it("depois de 6 minutos: 'Ainda processando' com o trabalho_id", async () => {
    const { fim, esperas, linhas } = await rodar([status("processando")]);
    assert.equal(fim.fim, "tempo");
    assert.equal(esperas.reduce((a, b) => a + b, 0), 360_000);
    assert.equal(esperas.length, 72);
    assert.deepEqual(linhas.at(-1), { texto: "Ainda processando. Peça ao Claude o status com o trabalho_id t_0123456789.", tipo: "" });
  });

  it("o cartão gerado traz o laço ligado ao ig_status_publicacao", () => {
    assert.match(HTML_CONFIRMAR, /ig_status_publicacao/);
    assert.match(HTML_CONFIRMAR, /A Meta está processando o vídeo/);
  });
});
