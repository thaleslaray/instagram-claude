// Hospedagem de foto no Uploadcare, contra o Uploadcare falso. Nada sai para a internet de verdade.

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ErroConfig } from "../src/config.ts";
import {
  criarHospedagemDoAmbiente,
  criarHospedagemUploadcare,
  ErroUploadcare,
  prefixoDoCdn,
  type Hospedagem,
} from "../src/hospedagem.ts";
import { jpeg } from "./jpeg.ts";
import { CHAVE_UPLOADCARE_TESTE, hospedagemDeTeste, PREFIXO_DA_CHAVE_TESTE, UploadcareFalso } from "./uploadcare-falso.ts";

describe("hospedagem de foto no Uploadcare", () => {
  let falso: UploadcareFalso;
  let pasta: string;
  let hosp: Hospedagem;

  const foto = async (nome = "foto.jpg", bytes: Buffer = jpeg(1080, 1350)): Promise<string> => {
    const caminho = join(pasta, nome);
    await writeFile(caminho, bytes);
    return caminho;
  };

  beforeEach(async () => {
    falso = new UploadcareFalso();
    await falso.iniciar();
    pasta = await mkdtemp(join(tmpdir(), "hosp-"));
    hosp = hospedagemDeTeste(falso);
  });
  afterEach(async () => {
    await falso.parar();
  });

  it("o prefixo do CDN vem do SHA-256 da chave pública em base 36 (vetor demopublickey -> 1s4oyld5dc)", () => {
    assert.equal(prefixoDoCdn("demopublickey"), "1s4oyld5dc");
    assert.equal(prefixoDoCdn(CHAVE_UPLOADCARE_TESTE), PREFIXO_DA_CHAVE_TESTE);
    assert.equal(prefixoDoCdn("outra-chave").length, 10);
  });

  it("envia em multipart com a chave, sem guardar (UPLOADCARE_STORE=0) e monta o endereço público", async () => {
    const bytes = jpeg(1080, 1350, 7);
    const { url } = await hosp.enviar(await foto("a.jpg", bytes));
    assert.equal(falso.pedidos.length, 1);
    const [pedido] = falso.pedidos;
    assert.equal(pedido!.metodo, "POST");
    assert.equal(pedido!.caminho, "/base/");
    assert.match(String(pedido!.cabecalhos["content-type"]), /^multipart\/form-data/);
    assert.equal(pedido!.cabecalhos.authorization, undefined, "nenhum token vai para o Uploadcare");
    const [envio] = falso.envios;
    assert.equal(envio!.campos.UPLOADCARE_PUB_KEY, CHAVE_UPLOADCARE_TESTE);
    assert.equal(envio!.campos.UPLOADCARE_STORE, "0");
    assert.ok(envio!.arquivo.equals(bytes));
    assert.equal(url, `${falso.base}/uuid-falso-1/foto.jpg`);
  });

  it("sem trocar o CDN, o endereço usa o prefixo da chave em ucarecd.net", async () => {
    const real = criarHospedagemUploadcare({ chave: CHAVE_UPLOADCARE_TESTE, uploadBase: falso.base });
    const { url } = await real.enviar(await foto());
    assert.equal(url, `https://${PREFIXO_DA_CHAVE_TESTE}.ucarecd.net/uuid-falso-1/foto.jpg`);
  });

  it("só aceita JPEG de até 8 MB e não envia nada quando recusa", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
    await assert.rejects(hosp.enviar(await foto("a.png", png)), ErroUploadcare);
    await assert.rejects(hosp.enviar(await foto("grande.jpg", jpeg(1080, 1350, 8 * 1024 * 1024))), /8 MB/);
    assert.equal(falso.pedidos.length, 0);
  });

  it("erro do Uploadcare vira frase em português, sem repassar o texto dele", async () => {
    falso.falha = { status: 400, corpo: { error: "texto-cru-do-servico" } };
    await assert.rejects(hosp.enviar(await foto()), (erro: Error) => {
      assert.ok(erro instanceof ErroUploadcare);
      assert.match(erro.message, /Uploadcare recusou a foto \(HTTP 400\)/);
      assert.doesNotMatch(erro.message, /texto-cru|demopublickey/);
      return true;
    });
  });

  it("resposta sem o uuid do arquivo também é erro", async () => {
    falso.falha = { status: 200, corpo: { outra: "coisa" } };
    await assert.rejects(hosp.enviar(await foto()), ErroUploadcare);
  });

  it("base do upload e do CDN trocadas só valem em 127.0.0.1 ou localhost", () => {
    assert.throws(() => criarHospedagemUploadcare({ chave: "k", uploadBase: "https://upload.exemplo.com" }), ErroConfig);
    assert.throws(() => criarHospedagemUploadcare({ chave: "k", cdnBase: "http://exemplo.com" }), ErroConfig);
    criarHospedagemUploadcare({ chave: "k", uploadBase: "http://localhost:1234", cdnBase: "http://127.0.0.1:1" });
  });

  it("do ambiente: sem a chave não há hospedagem; marcador cru do .mcpb conta como vazio", () => {
    assert.equal(criarHospedagemDoAmbiente({}), null);
    assert.equal(criarHospedagemDoAmbiente({ IG_UPLOADCARE_PUBLIC_KEY: "  " }), null);
    assert.equal(criarHospedagemDoAmbiente({ IG_UPLOADCARE_PUBLIC_KEY: "${user_config.IG_UPLOADCARE_PUBLIC_KEY}" }), null);
    assert.ok(criarHospedagemDoAmbiente({ IG_UPLOADCARE_PUBLIC_KEY: "demopublickey" }));
  });
});
