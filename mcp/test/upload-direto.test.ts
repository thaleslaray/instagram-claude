// Upload direto para a Meta (cliente da Graph): rupload do vídeo e anexo de DM em multipart.
// O token só vai para a Meta: o endereço do rupload vem da resposta da Meta e é conferido antes de qualquer envio.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CofreEmMemoria } from "../src/cofre.ts";
import { lerConfig } from "../src/config.ts";
import { ClienteGraph } from "../src/graph.ts";
import { esquecerSegredos } from "../src/segredos.ts";
import { CONTA_TESTE, TOKEN_TESTE } from "./graph-falsa.ts";

interface Chamada {
  url: string;
  init: RequestInit;
}

/** Cliente de produção (base da Meta de verdade) com um fetch que só anota e responde. Nada sai. */
function clienteDeProducao(responder: () => Response = () => Response.json({ success: true, message: "Upload Successful." })) {
  esquecerSegredos();
  const chamadas: Chamada[] = [];
  const config = lerConfig({ IG_ACCOUNT_ID: CONTA_TESTE.id });
  const graph = new ClienteGraph({
    config,
    cofre: new CofreEmMemoria(TOKEN_TESTE),
    fetch: async (entrada, init) => {
      chamadas.push({ url: String(entrada), init });
      return responder();
    },
  });
  return { graph, chamadas };
}

const BYTES = Buffer.from("conteudo-do-video");

describe("rupload da Meta", () => {
  it("em produção só aceita https://rupload.facebook.com e manda o token como OAuth, com offset e file_size", async () => {
    const { graph, chamadas } = clienteDeProducao();
    await graph.enviarParaRupload("https://rupload.facebook.com/ig-api-upload/v27.0/c1", BYTES);
    assert.equal(chamadas.length, 1);
    const { url, init } = chamadas[0]!;
    assert.equal(url, "https://rupload.facebook.com/ig-api-upload/v27.0/c1");
    assert.equal(init.method, "POST");
    const cab = init.headers as Record<string, string>;
    assert.equal(cab.Authorization, `OAuth ${TOKEN_TESTE}`);
    assert.equal(cab.offset, "0");
    assert.equal(cab.file_size, String(BYTES.length));
    assert.equal(init.redirect, "error", "nunca segue redirecionamento com o token");
    assert.ok(!url.includes(TOKEN_TESTE));
  });

  for (const uri of [
    "http://rupload.facebook.com/ig-api-upload/v27.0/c1",
    "https://rupload.facebook.com.evil.example/x",
    "https://evil.example/rupload.facebook.com/x",
    "https://usuario:senha@rupload.facebook.com/x",
    "https://graph.facebook.com/v27.0/c1",
    "http://127.0.0.1:9/x",
    "ftp://rupload.facebook.com/x",
    "isto não é endereço",
  ]) {
    it(`recusa ${uri} sem mandar nada (nem o token)`, async () => {
      const { graph, chamadas } = clienteDeProducao();
      await assert.rejects(graph.enviarParaRupload(uri, BYTES), /endereço de envio/);
      assert.equal(chamadas.length, 0);
    });
  }

  it("falha do rupload vira frase em português que manda tentar de novo, sem o texto cru nem o token", async () => {
    const { graph } = clienteDeProducao(() =>
      Response.json({ debug_info: { message: `Authorization: OAuth ${TOKEN_TESTE} falhou`, type: "ProcessingFailedError" } }, { status: 500 }),
    );
    await assert.rejects(graph.enviarParaRupload("https://rupload.facebook.com/ig-api-upload/v27.0/c1", BYTES), (erro: Error) => {
      assert.match(erro.message, /A Meta não aceitou o envio do vídeo \(HTTP 500\)/);
      assert.match(erro.message, /tente de novo/i);
      assert.doesNotMatch(erro.message, new RegExp(TOKEN_TESTE));
      assert.doesNotMatch(erro.message, /debug_info|ProcessingFailedError/);
      return true;
    });
  });

  it("resposta 200 sem success:true também é falha", async () => {
    const { graph } = clienteDeProducao(() => Response.json({ success: false }));
    await assert.rejects(graph.enviarParaRupload("https://rupload.facebook.com/ig-api-upload/v27.0/c1", BYTES), /não aceitou o envio do vídeo/);
  });

  it("erro de rede também sai limpo, sem o token", async () => {
    esquecerSegredos();
    const graph = new ClienteGraph({
      config: lerConfig({ IG_ACCOUNT_ID: CONTA_TESTE.id }),
      cofre: new CofreEmMemoria(TOKEN_TESTE),
      fetch: async () => {
        throw new Error(`conexão caiu em OAuth ${TOKEN_TESTE}`);
      },
    });
    await assert.rejects(graph.enviarParaRupload("https://rupload.facebook.com/ig-api-upload/v27.0/c1", BYTES), (erro: Error) => {
      assert.doesNotMatch(erro.message, new RegExp(TOKEN_TESTE));
      assert.match(erro.message, /tente de novo/i);
      return true;
    });
  });
});

describe("anexo de DM em multipart", () => {
  it("manda o formulário pelo Graph com Bearer e sem Content-Type fixo (o fetch põe o limite)", async () => {
    const { graph, chamadas } = clienteDeProducao(() => Response.json({ attachment_id: "anexo1" }));
    const form = new FormData();
    form.set("platform", "instagram");
    const r = await graph.postMultipart<{ attachment_id: string }>(`${CONTA_TESTE.id}/message_attachments`, form);
    assert.equal(r.attachment_id, "anexo1");
    const { url, init } = chamadas[0]!;
    assert.equal(url, `https://graph.facebook.com/v27.0/${CONTA_TESTE.id}/message_attachments`);
    const cab = init.headers as Record<string, string>;
    assert.equal(cab.Authorization, `Bearer ${TOKEN_TESTE}`);
    assert.equal(cab["Content-Type"], undefined);
    assert.equal(init.body, form);
  });

  it("tem prazo próprio, maior que o dos outros pedidos: um anexo de 25 MB não sobe em 30 s numa internet lenta", async () => {
    esquecerSegredos();
    // Um fetch lento que respeita o sinal: demora 80 ms, e o prazo comum do cliente é de 20 ms.
    const lento: typeof fetch = (_entrada, init) =>
      new Promise((pronto, falhou) => {
        const relogio = setTimeout(() => pronto(Response.json({ attachment_id: "anexo1" })), 80);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(relogio);
          falhou(init.signal?.reason ?? new Error("abortado"));
        });
      });
    const graph = new ClienteGraph({ config: lerConfig({ IG_ACCOUNT_ID: CONTA_TESTE.id }), cofre: new CofreEmMemoria(TOKEN_TESTE), fetch: lento, tempoLimiteMs: 20 });
    await assert.rejects(graph.post(`${CONTA_TESTE.id}/messages`, {}), "o pedido comum estoura o prazo de 20 ms");
    const r = await graph.postMultipart<{ attachment_id: string }>(`${CONTA_TESTE.id}/message_attachments`, new FormData());
    assert.equal(r.attachment_id, "anexo1");
  });
});
