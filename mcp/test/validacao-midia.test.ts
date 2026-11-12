// Ficha 09: validação local da mídia e da legenda (spec 4.4.1).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jpeg } from "./jpeg.ts";
import { analisarLegenda, lerDimensoesJpeg, linhaDaJanelaDoFeed, validarImagem } from "../src/validacao-midia.ts";

describe("validação de imagem", () => {
  it("lê as dimensões pelo marcador SOF, pulando outros blocos", () => {
    assert.deepEqual(lerDimensoesJpeg(jpeg(1080, 1350)), { largura: 1080, altura: 1350 });
    assert.equal(lerDimensoesJpeg(jpeg(1080, 1350).subarray(0, 25)), null, "truncado");
  });

  it("aceita 1080×1350 (4:5) e 1440×754 (1,91:1)", () => {
    assert.deepEqual(validarImagem(jpeg(1080, 1350), "Imagem").erros, []);
    assert.deepEqual(validarImagem(jpeg(1440, 754), "Imagem").erros, []);
  });

  it("recusa PNG e HEIC pelos bytes, com a sugestão do sips", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
    const [erro] = validarImagem(png, "Imagem").erros;
    assert.match(erro!, /PNG.*sips -s format jpeg/s);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(20)]);
    assert.match(validarImagem(heic, "Imagem").erros[0]!, /HEIC/);
  });

  it("recusa largura, proporção e tamanho fora do limite", () => {
    assert.match(validarImagem(jpeg(300, 300), "Imagem").erros.join(), /largura de 300 px/);
    assert.match(validarImagem(jpeg(1600, 1600), "Imagem").erros.join(), /largura de 1600 px/);
    assert.match(validarImagem(jpeg(1000, 1500), "Imagem").erros.join(), /proporção/);
    assert.match(validarImagem(jpeg(1440, 600), "Imagem").erros.join(), /proporção/);
    assert.match(validarImagem(jpeg(1080, 1350, 9 * 1024 * 1024), "Imagem").erros.join(), /limite é 8,0 MB/);
  });
});

describe("análise da legenda", () => {
  it("recusa mais de 2.200 caracteres, 30 hashtags e 20 menções", () => {
    assert.match(analisarLegenda("a".repeat(2201)).erros.join(), /2201 caracteres/);
    assert.equal(analisarLegenda("a".repeat(2200)).erros.length, 0);
    const trinta = Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(" ");
    assert.equal(analisarLegenda(trinta).erros.length, 0);
    assert.match(analisarLegenda(`${trinta} #mais`).erros.join(), /31 hashtags/);
    const vinteUma = Array.from({ length: 21 }, (_, i) => `@user${i}`).join(" ");
    assert.match(analisarLegenda(vinteUma).erros.join(), /21 menções/);
  });

  it("só avisa acima de 5 hashtags (a API aceitou 7)", () => {
    const sete = Array.from({ length: 7 }, (_, i) => `#tag${i}`).join(" ");
    const a = analisarLegenda(`Oi ${sete}`);
    assert.equal(a.erros.length, 0);
    assert.match(a.avisos.join(), /7 hashtags.*5 por post/);
    assert.equal(analisarLegenda("Oi #a #b #c #d #e").avisos.length, 0);
  });

  it("e-mail não conta como menção", () => {
    assert.equal(analisarLegenda("fale com ana@exemplo.com.br").mencoes, 0);
  });

  it("a janela do feed tem os primeiros 125 caracteres", () => {
    const a = analisarLegenda("x".repeat(300));
    assert.equal([...a.janela].length, 125);
    assert.equal(a.cortada, true);
    assert.match(linhaDaJanelaDoFeed(a), /… mais$/);
    const curta = analisarLegenda("Oi");
    assert.equal(curta.cortada, false);
    assert.equal(curta.janela, "Oi");
  });

  it("avisa de link, de mais de um pedido de ação e de emoji no começo", () => {
    assert.match(analisarLegenda("Veja em https://exemplo.com").avisos.join(), /link.*não é clicável/);
    assert.match(analisarLegenda("Comente e salve este post").avisos.join(), /mais de um pedido de ação/);
    assert.equal(analisarLegenda("Comente aqui").avisos.length, 0);
    assert.match(analisarLegenda("🔥 Promoção").avisos.join(), /começa com emoji/);
    assert.equal(analisarLegenda("Promoção 🔥").avisos.length, 0);
  });
});
