// ig_estado_do_token e `npm run doctor`, contra a Graph falsa. Nada sai para a Meta.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { rodarDoctor } from "../src/doctor.ts";
import { verificarEstado } from "../src/estado.ts";
import { criarPolitica } from "../src/perfis.ts";
import { esquecerSegredos } from "../src/segredos.ts";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, erroMeta, TOKEN_TESTE } from "./graph-falsa.ts";
import { CofreEmMemoria } from "../src/cofre.ts";

const PERMISSOES = {
  data: [
    { permission: "instagram_business_basic", status: "granted" },
    { permission: "instagram_business_manage_messages", status: "granted" },
    { permission: "instagram_manage_contents", status: "declined" },
  ],
};

describe("ig_estado_do_token", () => {
  let m: Montagem;
  afterEach(async () => {
    await m.fechar();
    esquecerSegredos();
  });

  async function chamar() {
    const { cliente, fechar } = await conectarCliente(m.ctx, { servidor: { politica: criarPolitica("atendimento") } });
    try {
      return await cliente.callTool({ name: "ig_estado_do_token", arguments: {} });
    } finally {
      await fechar();
    }
  }

  it("com token: conta, só as permissões concedidas, versão e perfil; nunca o token", async () => {
    m = await montar();
    m.graphFalsa.rota("GET", `/${CONTA_TESTE.id}`, { corpo: CONTA_TESTE });
    m.graphFalsa.rota("GET", "/me/permissions", { corpo: PERMISSOES });
    const r = await chamar();
    assert.ok(!r.isError, JSON.stringify(r.content));
    assert.deepEqual(r.structuredContent, {
      saudavel: true,
      keychain: { token_cadastrado: true },
      conta: { id: CONTA_TESTE.id, username: CONTA_TESTE.username },
      permissoes: { concedidas: ["instagram_business_basic", "instagram_business_manage_messages"] },
      graph_versao: "v27.0",
      perfil: "atendimento",
      grupos_so_leitura: [],
      problemas: [],
    });
    assert.ok(!JSON.stringify(r).includes(TOKEN_TESTE));
  });

  it("o cofre vem do contexto, e o cliente da Graph não o expõe (o valor nunca sai dele)", async () => {
    m = await montar();
    assert.equal("cofre" in m.graph, false, "ClienteGraph não pode ter getter do cofre");
    assert.ok(m.ctx.cofre, "o Contexto carrega o cofre");
    // O Contexto manda: com o cofre dele vazio, o estado diz que não há token, mesmo que o cliente da Graph tenha um.
    const vazio = { ...m.ctx, cofre: new CofreEmMemoria(null) };
    const estado = await verificarEstado(vazio, criarPolitica());
    assert.equal(estado.keychain.token_cadastrado, false);
  });

  it("com o Keychain vazio: explica o que fazer e nem chama a Meta", async () => {
    m = await montar({ token: null });
    const r = await chamar();
    assert.ok(!r.isError);
    const e = r.structuredContent as { saudavel: boolean; keychain: { token_cadastrado: boolean }; conta: unknown; problemas: string[] };
    assert.equal(e.saudavel, false);
    assert.equal(e.keychain.token_cadastrado, false);
    assert.equal(e.conta, null);
    assert.match(e.problemas.join(" "), /npm run guardar-token/);
    assert.equal(m.graphFalsa.pedidos.length, 0);
  });

  it("erro da Meta nas permissões vira problema, sem derrubar a ferramenta, e sem o token", async () => {
    m = await montar();
    m.graphFalsa.rota("GET", `/${CONTA_TESTE.id}`, { corpo: CONTA_TESTE });
    m.graphFalsa.rota("GET", "/me/permissions", erroMeta(190, `token inválido ${TOKEN_TESTE}`));
    const r = await chamar();
    const e = r.structuredContent as { saudavel: boolean; permissoes: { erro: string } };
    assert.equal(e.saudavel, false);
    assert.ok(e.permissoes.erro.length > 0);
    assert.ok(!JSON.stringify(r).includes(TOKEN_TESTE));
  });
});

describe("doctor", () => {
  let m: Montagem;
  let linhas: string[];
  beforeEach(() => {
    esquecerSegredos();
    linhas = [];
  });
  afterEach(async () => {
    await m.fechar();
    esquecerSegredos();
  });

  const rodar = (uploadcare: boolean) => rodarDoctor({ contexto: m.ctx, politica: criarPolitica(), uploadcare, escrever: (l) => linhas.push(l) });
  const rotasSaudaveis = () => {
    m.graphFalsa.rota("GET", `/${CONTA_TESTE.id}`, { corpo: CONTA_TESTE });
    m.graphFalsa.rota("GET", "/me/permissions", { corpo: PERMISSOES });
  };

  it("tudo certo com a chave do Uploadcare: sai com 0 e diz que a foto do computador está liberada", async () => {
    m = await montar();
    rotasSaudaveis();
    assert.equal(await rodar(true), 0, linhas.join("\n"));
    const saida = linhas.join("\n");
    assert.match(saida, /Tudo saudável/);
    assert.match(saida, /Uploadcare: chave pública configurada/);
    assert.ok(!saida.includes(TOKEN_TESTE));
  });

  it("sem token: sai com 1", async () => {
    m = await montar({ token: null });
    assert.equal(await rodar(true), 1);
    assert.match(linhas.join("\n"), /FALHA .*token não cadastrado/);
  });

  it("sem a chave do Uploadcare: é opcional, só avisa e sai com 0", async () => {
    m = await montar();
    rotasSaudaveis();
    assert.equal(await rodar(false), 0, linhas.join("\n"));
    const saida = linhas.join("\n");
    assert.match(saida, /AVISO  Uploadcare: sem chave pública \(opcional, só para foto do computador\)/);
    assert.doesNotMatch(saida, /FALHA/);
    assert.match(saida, /Tudo saudável/);
  });
});
