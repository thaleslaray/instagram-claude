import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { criarEspacador } from "../src/espacador.ts";
import { acharConversa, calcularJanela, janelaDoUsuario } from "../src/janela.ts";
import { montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, erroMeta } from "./graph-falsa.ts";

const IG = CONTA_TESTE.id;
const PESSOA = "17841400000000001";
const AGORA = Date.parse("2026-11-07T12:00:00Z");
const H = 3_600_000;

/** Formato de data da Meta: `+0000`, sem dois-pontos. */
function data(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+0000");
}
const dela = (ms: number, id = "m-dela") => ({ id, created_time: data(ms), from: { id: PESSOA, username: "fulano" }, message: "oi" });
const minha = (ms: number, id = "m-minha") => ({ id, created_time: data(ms), from: { id: IG, username: CONTA_TESTE.username }, message: "olá" });

describe("calcularJanela", () => {
  it("sem mensagem da pessoa: fechada, sem data", () => {
    assert.deepEqual(calcularJanela([], IG, AGORA), { aberta: false, ate: null, ultima_da_pessoa: null });
    assert.deepEqual(calcularJanela([minha(AGORA - H)], IG, AGORA), { aberta: false, ate: null, ultima_da_pessoa: null });
  });

  it("23 h 59 min depois da mensagem dela: aberta, até 1 min a frente", () => {
    const j = calcularJanela([dela(AGORA - 23 * H - 59 * 60_000)], IG, AGORA);
    assert.equal(j.aberta, true);
    assert.equal(j.ate, new Date(AGORA + 60_000).toISOString());
  });

  it("24 h 01 min depois: fechada, mas diz até quando valeu", () => {
    const j = calcularJanela([dela(AGORA - 24 * H - 60_000)], IG, AGORA);
    assert.equal(j.aberta, false);
    assert.equal(j.ate, new Date(AGORA - 60_000).toISOString());
  });

  it("exatamente 24 h: fechada", () => {
    assert.equal(calcularJanela([dela(AGORA - 24 * H)], IG, AGORA).aberta, false);
  });

  it("última mensagem minha depois da dela não reabre nem fecha: vale a dela", () => {
    const mensagens = [minha(AGORA - 1 * H, "recente"), dela(AGORA - 5 * H, "dela")];
    const j = calcularJanela(mensagens, IG, AGORA);
    assert.equal(j.aberta, true);
    assert.equal(j.ate, new Date(AGORA + 19 * H).toISOString());
    assert.equal(j.ultima_da_pessoa, new Date(AGORA - 5 * H).toISOString());
  });

  it("acha a mais recente da pessoa mesmo fora de ordem e ignora data inválida", () => {
    const j = calcularJanela([dela(AGORA - 10 * H, "a"), dela(AGORA - 2 * H, "b"), { id: "x", created_time: "lixo", from: { id: PESSOA } }], IG, AGORA);
    assert.equal(j.ultima_da_pessoa, new Date(AGORA - 2 * H).toISOString());
  });
});

describe("acharConversa e janelaDoUsuario", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
  });
  afterEach(async () => {
    await m.fechar();
  });

  const conversa = (id: string, username: string, idPessoa = PESSOA) => ({
    id,
    updated_time: data(AGORA),
    participants: { data: [{ id: idPessoa, username }, { id: IG, username: CONTA_TESTE.username }] },
  });

  it("acha pelo @ (com ou sem arroba, sem diferenciar maiúscula) e pelo IGSID, lendo participants", async () => {
    m.graphFalsa.rota("GET", `/${IG}/conversations`, { corpo: { data: [conversa("c1", "outro", "999"), conversa("c2", "Fulano")] } });
    for (const alvo of ["@fulano", "FULANO", PESSOA]) {
      const achada = await acharConversa(m.ctx, alvo);
      assert.equal(achada?.conversa.id, "c2", alvo);
      assert.equal(achada?.participante.id, PESSOA);
    }
    const [pedido] = m.graphFalsa.pedidos;
    assert.equal(pedido!.query.platform, "instagram");
    assert.equal(pedido!.query.fields, "id,updated_time,participants");
    assert.ok(!("user_id" in pedido!.query), "o filtro user_id é ignorado pela Meta: não usar");
  });

  it("não considera a própria conta como a pessoa", async () => {
    m.graphFalsa.rota("GET", `/${IG}/conversations`, { corpo: { data: [conversa("c1", CONTA_TESTE.username, IG)] } });
    assert.equal(await acharConversa(m.ctx, CONTA_TESTE.username), null);
  });

  it("varre no máximo 100 conversas (4 páginas de 25) e desiste", async () => {
    m.graphFalsa.rota("GET", `/${IG}/conversations`, (p) => {
      const n = Number(p.query.after ?? 0);
      const itens = Array.from({ length: 25 }, (_, i) => conversa(`c${n + i}`, `x${n + i}`, `${1000 + n + i}`));
      return { corpo: { data: itens, paging: { cursors: { after: String(n + 25) }, next: "https://graph.facebook.com/v27.0/x?after=" + (n + 25) } } };
    });
    assert.equal(await acharConversa(m.ctx, "ninguem"), null);
    assert.equal(m.graphFalsa.pedidos.length, 4);
    assert.deepEqual(
      m.graphFalsa.pedidos.map((p) => p.query.after),
      [undefined, "25", "50", "75"],
    );
  });

  it("para de varrer ao achar", async () => {
    m.graphFalsa.rota("GET", `/${IG}/conversations`, (p) => {
      const n = Number(p.query.after ?? 0);
      const itens = n === 25 ? [conversa("alvo", "fulano")] : [conversa(`c${n}`, "outro", "999")];
      return { corpo: { data: itens, paging: { cursors: { after: String(n + 25) }, next: "x?after=" + (n + 25) } } };
    });
    assert.equal((await acharConversa(m.ctx, "fulano"))?.conversa.id, "alvo");
    assert.equal(m.graphFalsa.pedidos.length, 2);
  });

  it("janelaDoUsuario: acha a conversa, lê as mensagens e calcula", async () => {
    m.graphFalsa.rota("GET", `/${IG}/conversations`, { corpo: { data: [conversa("c2", "fulano")] } });
    m.graphFalsa.rota("GET", "/c2", { corpo: { messages: { data: [minha(Date.now() - 1 * H, "r"), dela(Date.now() - 2 * H, "d")] }, id: "c2" } });
    const r = await janelaDoUsuario(m.ctx, "@fulano");
    assert.ok(r.encontrada);
    assert.equal(r.conversa_id, "c2");
    assert.equal(r.usuario_id, PESSOA);
    assert.equal(r.janela.aberta, true);
    const leitura = m.graphFalsa.pedidos.find((p) => p.caminho === "/c2")!;
    assert.match(leitura.query.fields!, /^messages\{id,created_time,from/);
  });

  it("janelaDoUsuario: sem conversa devolve encontrada=false e não lê mensagens", async () => {
    m.graphFalsa.rota("GET", `/${IG}/conversations`, { corpo: { data: [] } });
    const r = await janelaDoUsuario(m.ctx, "fulano");
    assert.deepEqual(r, { encontrada: false });
    assert.equal(m.graphFalsa.pedidos.length, 1);
  });

  it("erro da Meta ao listar sobe traduzido", async () => {
    m.graphFalsa.rota("GET", `/${IG}/conversations`, erroMeta(200, "sem acesso"));
    await assert.rejects(janelaDoUsuario(m.ctx, "fulano"), /Acesso às mensagens desligado/);
  });
});

describe("espaçamento de 500 ms das chamadas de conversa", () => {
  it("espera o que falta para completar 500 ms entre o início de duas chamadas", async () => {
    let agora = 10_000;
    const esperas: number[] = [];
    const espacador = criarEspacador({
      agora: () => agora,
      dormir: async (ms) => {
        esperas.push(ms);
        agora += ms;
      },
    });
    await espacador.esperar(); // primeira: sem espera
    await espacador.esperar(); // logo em seguida: 500
    agora += 200; // a chamada demorou 200 ms
    await espacador.esperar(); // faltam 300
    agora += 900; // passou do intervalo
    await espacador.esperar(); // sem espera
    assert.deepEqual(esperas, [500, 300]);
  });

  it("chamadas simultâneas entram em fila, 500 ms uma da outra", async () => {
    let agora = 0;
    const inicios: number[] = [];
    const espacador = criarEspacador({
      agora: () => agora,
      dormir: async (ms) => {
        agora += ms;
      },
    });
    await Promise.all([1, 2, 3].map(async () => {
      await espacador.esperar();
      inicios.push(agora);
    }));
    assert.deepEqual(inicios, [0, 500, 1000]);
  });

  it("a varredura de conversas usa o espaçador a cada chamada", async () => {
    const m = await montar();
    try {
      let agora = 0;
      const esperas: number[] = [];
      m.ctx.espacador = criarEspacador({
        agora: () => agora,
        dormir: async (ms) => {
          esperas.push(ms);
          agora += ms;
        },
      });
      // cada página traz uma conversa de outra pessoa, para a varredura seguir até as 4 páginas
      m.graphFalsa.rota("GET", `/${IG}/conversations`, (p) => {
        const n = Number(p.query.after ?? 0);
        return { corpo: { data: Array.from({ length: 25 }, (_, i) => ({ id: `c${n + i}`, participants: { data: [{ id: `${n + i}`, username: "y" }] } })), paging: { cursors: { after: String(n + 25) }, next: "x?after=" + (n + 25) } } };
      });
      await acharConversa(m.ctx, "ninguem");
      assert.deepEqual(esperas, [500, 500, 500]);
    } finally {
      await m.fechar();
    }
  });
});
