import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ErroGraph, FRASES } from "../src/erros.ts";
import { montar, type Montagem } from "./ajuda.ts";
import { CONTA_TESTE, erroMeta, type RespostaFalsa } from "./graph-falsa.ts";

interface Caso {
  nome: string;
  resposta: RespostaFalsa;
  frase: string | RegExp;
}

// Mensagens reais ou no formato da Meta; algumas em português, como a Graph responde
// no idioma da conta (diário P20). A tradução não pode depender do texto.
const CASOS: Caso[] = [
  { nome: "190 token inválido", resposta: erroMeta(190, "Error validating access token: Session has expired"), frase: FRASES.token },
  { nome: "190 em português", resposta: erroMeta(190, "Erro ao validar o token de acesso"), frase: FRASES.token },
  {
    nome: "(#10) falta permissão",
    resposta: erroMeta(10, "(#10) Application does not have permission for this action, missing instagram_manage_messages"),
    frase: /^Falta a permissão `instagram_manage_messages`/,
  },
  {
    nome: "(#10) conta não profissional",
    resposta: erroMeta(10, "(#10) The user is not an Instagram Business or Creator account"),
    frase: FRASES.contaNaoProfissional,
  },
  { nome: "(#10) em português, sem pista", resposta: erroMeta(10, "(#10) O aplicativo não tem permissão para esta ação"), frase: FRASES.permissao },
  {
    nome: "(#200) DM desligada",
    resposta: erroMeta(200, "(#200) The user has disabled access to Instagram Direct Messaging for this account"),
    frase: FRASES.dmDesligada,
  },
  { nome: "9 / 2207042 cota de publicação", resposta: erroMeta(9, "Application request limit reached", 2207042), frase: FRASES.limitePublicacao },
  { nome: "só o subcode 2207042", resposta: erroMeta(4, "Limite", 2207042), frase: FRASES.limitePublicacao },
  { nome: "4 taxa", resposta: erroMeta(4, "(#4) Application request limit reached"), frase: FRASES.limiteChamadas },
  { nome: "17 taxa", resposta: erroMeta(17, "(#17) User request limit reached"), frase: FRASES.limiteChamadas },
  { nome: "32 taxa", resposta: erroMeta(32, "(#32) Page request limit reached"), frase: FRASES.limiteChamadas },
  { nome: "613 taxa", resposta: erroMeta(613, "(#613) Calls to this api have exceeded the rate limit."), frase: FRASES.limiteChamadas },
  {
    nome: "100/33 objeto não existe",
    resposta: erroMeta(100, "Unsupported get request. Object with ID '1789' does not exist", 33, "GraphMethodException"),
    frase: FRASES.naoExiste,
  },
  {
    nome: "9008/4928001 comentários desligados ('Media ID is not found' engana)",
    resposta: erroMeta(9008, "Media ID is not found", 4928001, "IGApiException"),
    frase: FRASES.comentariosDesligados,
  },
  {
    nome: "-1/2534023 resposta privada repetida (em português)",
    resposta: erroMeta(-1, "O comentário ao qual você está tentando responder já tem uma resposta.", 2534023),
    frase: FRASES.privadoRepetido,
  },
  { nome: "código desconhecido", resposta: erroMeta(1, "An unknown error occurred"), frase: FRASES.desconhecido },
];

describe("tradução dos erros da tabela 4.7", () => {
  let m: Montagem;
  beforeEach(async () => {
    m = await montar();
  });
  afterEach(async () => {
    await m.fechar();
  });

  for (const caso of CASOS) {
    it(caso.nome, async () => {
      m.graphFalsa.rota("GET", `/${CONTA_TESTE.id}`, caso.resposta);
      const erro = await m.graph.get(CONTA_TESTE.id).then(
        () => assert.fail("deveria falhar"),
        (e: unknown) => e,
      );
      assert.ok(erro instanceof ErroGraph, String(erro));
      const original = (caso.resposta.corpo as { error: { code: number; error_subcode?: number; fbtrace_id: string; message: string } }).error;
      if (typeof caso.frase === "string") assert.equal(erro.detalhe.frase, caso.frase);
      else assert.match(erro.detalhe.frase, caso.frase);
      // Mantém code, error_subcode e fbtrace_id, e a mensagem original.
      assert.equal(erro.code, original.code);
      assert.equal(erro.error_subcode, original.error_subcode ?? null);
      assert.equal(erro.fbtrace_id, original.fbtrace_id);
      assert.equal(erro.detalhe.mensagem_meta, original.message);
      assert.ok(erro.message.includes(`code ${original.code}`));
      assert.ok(erro.message.includes(`fbtrace_id ${original.fbtrace_id}`));
      if (original.error_subcode !== undefined) assert.ok(erro.message.includes(`subcode ${original.error_subcode}`));
    });
  }

  it("a mensagem original passa pela limpeza de segredos", async () => {
    m.graphFalsa.rota("GET", `/${CONTA_TESTE.id}`, erroMeta(190, "Malformed access token EAAGm0PX4ZCpsBAKZB3n7oZCxyz123abc"));
    const erro = await m.graph.get(CONTA_TESTE.id).catch((e: unknown) => e);
    assert.ok(erro instanceof ErroGraph);
    assert.equal(erro.detalhe.mensagem_meta, "Malformed access token ‹segredo›");
    assert.ok(!erro.message.includes("EAAGm0"));
  });
});
