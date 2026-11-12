// Cartão remontado (0.4.8): `Pedidos.situacao` no servidor e o ajuste do cartão (ui/situacao.js), sem DOM.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Pedidos, VALIDADE_MS } from "../src/confirmacao.ts";
import type { Previa } from "../src/confirmacao.ts";
import type { RegistroAcoes } from "../src/registro-acoes.ts";
import { HTML_CONFIRMAR } from "../src/ui-gerada.ts";
import {
  aguardarEnvio,
  estadoDoPedido,
  INTERVALO_ENVIANDO_MS,
  LIMITE_ENVIANDO_MS,
  linkDoResultado,
  planoDaSituacao,
} from "../ui/situacao.js";

const previa: Previa = { titulo: "Publicar", conta: "@conta", alvo: "@alvo", botao: "Publicar" };

function pedidos(agora: () => number = () => 1_000) {
  const gravados: Array<Record<string, unknown>> = [];
  const registro = { gravar: async (e: Record<string, unknown>) => void gravados.push(e) } as unknown as RegistroAcoes;
  return { p: new Pedidos(registro, agora), gravados };
}

describe("Pedidos.situacao", () => {
  it("pendente, usado com resultado, cancelado e inexistente", async () => {
    const { p } = pedidos();
    assert.deepEqual(p.situacao("nada"), { estado: "inexistente" });
    const a = p.criar("f", { x: 1 }, previa, async () => ({ permalink: "https://instagram.com/p/x" }));
    assert.deepEqual(p.situacao(a.id), { estado: "pendente" });
    const d = await p.confirmar(a.id, a.codigo, "ig_confirmar_tela");
    assert.ok(d.ok);
    assert.deepEqual(p.situacao(a.id), { estado: "usado", resultado: { permalink: "https://instagram.com/p/x" } });
    const b = p.criar("f", { x: 2 }, previa, async () => ({}));
    await p.cancelar(b.id, "teste");
    assert.deepEqual(p.situacao(b.id), { estado: "cancelado" });
  });

  it("enviando enquanto o envio não voltou; falhou quando o envio deu erro", async () => {
    const { p } = pedidos();
    let soltar: (r: Record<string, unknown>) => void = () => {};
    const a = p.criar("f", {}, previa, () => new Promise<Record<string, unknown>>((ok) => (soltar = ok)));
    const emCurso = p.confirmar(a.id, a.codigo, "ig_confirmar_tela");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(p.situacao(a.id), { estado: "enviando" });
    soltar({ estado: "processando", trabalho_id: "t_0123456789" });
    await emCurso;
    assert.deepEqual(p.situacao(a.id), { estado: "usado", resultado: { estado: "processando", trabalho_id: "t_0123456789" } });

    const f = p.criar("f", {}, previa, async () => {
      throw new Error("Meta recusou");
    });
    await assert.rejects(p.confirmar(f.id, f.codigo, "ig_confirmar_tela"), /Meta recusou/);
    assert.deepEqual(p.situacao(f.id), { estado: "falhou" });
  });

  it("pendente vencido aparece como expirado, sem gravar nada no registro", () => {
    let agora = 1_000;
    const { p, gravados } = pedidos(() => agora);
    const a = p.criar("f", {}, previa, async () => ({}));
    agora += VALIDADE_MS + 1;
    assert.deepEqual(p.situacao(a.id), { estado: "expirado" });
    assert.equal(gravados.length, 0);
    assert.equal(p.estado(a.id), "pendente", "o estado interno não mudou: é só leitura");
  });
});

const resposta = (estado: string, resultado?: Record<string, unknown>) => ({ structuredContent: { pedido: "ab12cd34", estado, ...(resultado ? { resultado } : {}) } });

describe("ui/situacao.js: o que o cartão remontado faz", () => {
  it("pendente (ou consulta inválida): nada muda", () => {
    assert.equal(planoDaSituacao(resposta("pendente")).acao, "nada");
    assert.equal(planoDaSituacao({ isError: true, structuredContent: { estado: "usado" } }).acao, "nada");
    assert.equal(planoDaSituacao(undefined).acao, "nada");
    assert.equal(estadoDoPedido(resposta("qualquer")), null);
  });

  it("usado: 'já foi enviado' com link; com trabalho_id, segue o trabalho", () => {
    const foto = planoDaSituacao(resposta("usado", { permalink: "https://www.instagram.com/p/abc/" }));
    assert.deepEqual(foto, { acao: "enviado", mensagem: "Este pedido já foi enviado.", tipo: "ok", link: "https://www.instagram.com/p/abc/", trabalhoId: "" });
    const video = planoDaSituacao(resposta("usado", { estado: "processando", trabalho_id: "t_0123456789" }));
    assert.equal(video.acao, "enviado");
    assert.equal(video.trabalhoId, "t_0123456789");
    assert.equal(planoDaSituacao(resposta("usado", { permalink: "http://inseguro" })).link, "");
    assert.equal(linkDoResultado(resposta("usado", { permalink: "javascript:alert(1)" })), "");
  });

  it("enviando, falhou, cancelado, expirado e inexistente: frases do cartão", () => {
    assert.deepEqual(planoDaSituacao(resposta("enviando")), { acao: "enviando", mensagem: "Enviando… (o pedido já foi confirmado)", tipo: "", link: "", trabalhoId: "" });
    assert.deepEqual(planoDaSituacao(resposta("falhou")), { acao: "travar", mensagem: "O envio deste pedido falhou. Nada foi publicado. Peça a prévia de novo.", tipo: "erro", link: "", trabalhoId: "" });
    assert.deepEqual(planoDaSituacao(resposta("cancelado")), { acao: "travar", mensagem: "Pedido cancelado. Nada foi enviado.", tipo: "", link: "", trabalhoId: "" });
    const vencido = "Este pedido não vale mais (venceu ou o Claude Desktop reiniciou o servidor). Nada foi enviado. Peça a prévia de novo.";
    assert.equal(planoDaSituacao(resposta("expirado")).mensagem, vencido);
    assert.equal(planoDaSituacao(resposta("inexistente")).mensagem, vencido);
    assert.equal(planoDaSituacao(resposta("expirado")).acao, "travar");
  });

  async function esperarEnvio(respostas: Array<unknown>, cancelarNaConsulta = Infinity) {
    let agora = 0;
    let consultas = 0;
    const esperas: number[] = [];
    const r = await aguardarEnvio({
      consultar: async () => {
        const x = respostas[Math.min(consultas, respostas.length - 1)];
        consultas++;
        if (x instanceof Error) throw x;
        return x;
      },
      esperar: async (ms: number) => {
        esperas.push(ms);
        agora += ms;
      },
      agora: () => agora,
      cancelado: () => consultas >= cancelarNaConsulta,
    });
    return { r, consultas, esperas };
  }

  it("constantes: consulta a cada 3 s, até 2 minutos", () => {
    assert.equal(INTERVALO_ENVIANDO_MS, 3_000);
    assert.equal(LIMITE_ENVIANDO_MS, 120_000);
  });

  it("aguardarEnvio: consulta de 3 em 3 s até virar usado ou falhou", async () => {
    const a = await esperarEnvio([resposta("enviando"), resposta("enviando"), resposta("usado", { permalink: "https://x.y/" })]);
    assert.equal(estadoDoPedido(a.r), "usado");
    assert.equal(a.consultas, 3);
    assert.deepEqual(a.esperas, [3_000, 3_000, 3_000]);
    const b = await esperarEnvio([resposta("enviando"), resposta("falhou")]);
    assert.equal(estadoDoPedido(b.r), "falhou");
  });

  it("aguardarEnvio: desiste em 2 minutos, após 3 falhas seguidas ou quando mandam parar", async () => {
    const tempo = await esperarEnvio([resposta("enviando")]);
    assert.equal(tempo.r, null);
    assert.equal(tempo.consultas, LIMITE_ENVIANDO_MS / INTERVALO_ENVIANDO_MS);
    const falhas = await esperarEnvio([new Error("x")]);
    assert.equal(falhas.r, null);
    assert.equal(falhas.consultas, 3);
    const parou = await esperarEnvio([resposta("enviando")], 1);
    assert.equal(parou.r, null);
    assert.equal(parou.consultas, 1);
  });
});

describe("cartão gerado traz o ajuste pelo estado", () => {
  it("chama ig_estado_pedido_tela e protege contra clique antes da resposta", () => {
    assert.ok(HTML_CONFIRMAR.includes("ig_estado_pedido_tela"));
    assert.ok(HTML_CONFIRMAR.includes("Este pedido já foi enviado."));
  });
});
