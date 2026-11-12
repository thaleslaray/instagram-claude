// Lógica do cartão para o texto editável (ui/edicao.js): contador, limite, código editado e a mensagem do caminho sem ferramenta.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { codigoDoTextoEditado } from "../src/confirmacao.ts";
import { HTML_CONFIRMAR } from "../src/ui-gerada.ts";
import { codigoEditado, destinatario, detalhesDoCartao, separarDetalhes, medir, mensagemDeConfirmacao, podeEnviar, rotuloDoContador, terceirosParaMostrar } from "../ui/edicao.js";
import { textoDaJanela } from "../src/escrita.ts";

describe("edição no cartão", () => {
  it("mede em bytes (UTF-8) ou em caracteres (emoji conta 1)", () => {
    assert.equal(medir("Olá 😀", "bytes"), Buffer.byteLength("Olá 😀", "utf8"));
    assert.equal(medir("Olá 😀", "caracteres"), 5);
  });

  it("contador ao vivo no formato 'N de LIMITE unidade'", () => {
    assert.equal(rotuloDoContador("0123456789012345", 1000, "bytes"), "16 de 1000 bytes");
    assert.equal(rotuloDoContador("abc", 2200, "caracteres"), "3 de 2200 caracteres");
  });

  it("Enviar fica desligado com texto vazio ou acima do limite", () => {
    assert.equal(podeEnviar("", 10, "bytes"), false);
    assert.equal(podeEnviar("  \n ", 10, "bytes"), false);
    assert.equal(podeEnviar("1234567890", 10, "bytes"), true);
    assert.equal(podeEnviar("12345678901", 10, "bytes"), false);
    assert.equal(podeEnviar("éééééé", 10, "bytes"), false, "12 bytes");
    assert.equal(podeEnviar("éééééé", 10, "caracteres"), true);
  });

  it("o código editado do cartão é o mesmo que o servidor espera (32 primeiros caracteres do SHA-256 de código + \\n + texto)", () => {
    const codigo = "0123456789abcdef0123456789abcdef";
    const texto = "Olá 😀\nsegunda linha";
    const independente = createHash("sha256").update(`${codigo}\n${texto}`, "utf8").digest("hex").slice(0, 32);
    assert.equal(codigoEditado(codigo, texto), independente);
    assert.equal(codigoDoTextoEditado(codigo, texto), independente);
    assert.equal(codigoEditado(codigo, texto).length, 32);
  });

  it("mensagem do caminho sem ferramenta: sem texto editado é a de sempre; com texto, o código editado e o texto numa linha nova", () => {
    assert.equal(mensagemDeConfirmacao("ab12", "cod", null), "Confirmo o pedido ab12, código cod.");
    assert.equal(mensagemDeConfirmacao("ab12", "cod", "Oi\nTudo bem?"), "Confirmo o pedido ab12, código cod, com este texto:\nOi\nTudo bem?");
  });

  it("a tela gerada embute a edição: textarea, texto_editavel e o envio do texto pela ferramenta da tela", () => {
    for (const trecho of ["texto_editavel", "textarea", "com este texto:", "ig_confirmar_tela"]) assert.ok(HTML_CONFIRMAR.includes(trecho), `a tela não contém "${trecho}"`);
  });
});

describe("destinatário no cartão (pedido do dono da conta: o @ no lugar do ID)", () => {
  const dm = { alvo: "IGSID 1000000000000001", conteudo_de_terceiros: { username: "@cliente_de_teste" } };

  it("DM: mostra o @ da pessoa em vez do IGSID", () => {
    assert.equal(destinatario(dm), "@cliente_de_teste");
  });

  it("DM: o @ já está em Para, então o bloco 'De outra pessoa' some", () => {
    assert.deepEqual(terceirosParaMostrar(dm), []);
  });

  it("sem @ conhecido, mostra o alvo como veio", () => {
    assert.equal(destinatario({ alvo: "IGSID 1000000000000001" }), "IGSID 1000000000000001");
    assert.equal(destinatario({ alvo: "IGSID 1", conteudo_de_terceiros: { username: "  " } }), "IGSID 1");
    assert.equal(destinatario({}), "?");
  });

  it("alvo que não é um ID de pessoa fica como está, e o @ continua no bloco", () => {
    const comentario = { alvo: "comentário 17900000000000001", conteudo_de_terceiros: { username: "@fulano", comentario: "Quanto custa?" } };
    assert.equal(destinatario(comentario), "comentário 17900000000000001");
    assert.deepEqual(terceirosParaMostrar(comentario), [["username", "@fulano"], ["comentario", "Quanto custa?"]]);
  });

  it("DM com mais conteúdo de terceiros: só o @ sai do bloco", () => {
    const sc = { alvo: "IGSID 9", conteudo_de_terceiros: { username: "@fulano", ultima_mensagem: "Oi" } };
    assert.equal(destinatario(sc), "@fulano");
    assert.deepEqual(terceirosParaMostrar(sc), [["ultima_mensagem", "Oi"]]);
  });

  it("a janela de reserva do Mac segue a mesma regra", () => {
    const t = textoDaJanela({ titulo: "Responder DM em nome de @conta", conta: "@conta", alvo: "IGSID 1000000000000001", conteudo_de_terceiros: { username: "@cliente_de_teste" }, texto: "Oi", botao: "Enviar" });
    assert.match(t, /\nPara: @cliente_de_teste\n/);
    assert.doesNotMatch(t, /IGSID|de terceiros/);
  });
});

describe("detalhes no cartão (pedido do dono da conta: sem prazo nem tamanho, que o Claude já diz em texto)", () => {
  it("DM: 'Janela aberta até…' e 'Tamanho:…' não aparecem no cartão", () => {
    assert.deepEqual(detalhesDoCartao({ detalhes: ["Janela aberta até 12/11, 17:14", "Tamanho: 15 de 1000 bytes"] }), []);
  });

  it("o que fala do conteúdo ou da consequência continua", () => {
    const d = ["Cota: 2 de 100 usadas. Depois deste post: 3 de 100.", "Aviso: mais de 5 hashtags", "Ação sem volta: o comentário some de vez.", "Arquivo local: foto.jpg (300 KB, jpg)"];
    assert.deepEqual(detalhesDoCartao({ detalhes: ["Janela aberta até 12/11, 17:14", ...d] }), d);
  });

  it("sem detalhes, lista vazia; e o cartão não acrescenta mais a linha 'Vale por N minutos'", () => {
    assert.deepEqual(detalhesDoCartao({}), []);
    assert.deepEqual(detalhesDoCartao({ detalhes: "x", valido_ate: "2026-11-11T20:50:00Z", valido_por_minutos: 10 }), []);
    assert.doesNotMatch(HTML_CONFIRMAR, /Vale por /);
  });
});

describe("detalhes recolhidos em \"Ver detalhes\" (a pedido do dono da conta, 12/11)", () => {
  it("reels: avisos à vista, o resto recolhido, na ordem original", () => {
    const linhas = ["Cota: 13 de 100.", "Vídeo: video.mp4", "Aviso: mais de 5 hashtags", "Capa: a que a Meta escolher", "Aviso: a cota da Meta tem atraso"];
    assert.deepEqual(separarDetalhes(linhas), {
      aVista: ["Aviso: mais de 5 hashtags", "Aviso: a cota da Meta tem atraso"],
      recolhidas: ["Cota: 13 de 100.", "Vídeo: video.mp4", "Capa: a que a Meta escolher"],
    });
  });

  it("'Ação sem volta' nunca fica escondida", () => {
    const r = separarDetalhes(["Ação sem volta: o comentário some de vez.", "Arquivo: a", "Arquivo: b"]);
    assert.deepEqual(r.aVista, ["Ação sem volta: o comentário some de vez."]);
  });

  it("uma linha só para recolher não vira botão: tudo fica à vista", () => {
    assert.deepEqual(separarDetalhes(["Aviso: x", "Cota: 1 de 100."]), { aVista: ["Aviso: x", "Cota: 1 de 100."], recolhidas: [] });
    assert.deepEqual(separarDetalhes([]), { aVista: [], recolhidas: [] });
  });

  it("o cartão usa <details> nativo com o rótulo 'Ver detalhes'", () => {
    assert.match(HTML_CONFIRMAR, /Ver detalhes \(/);
    assert.match(HTML_CONFIRMAR, /"details"/);
  });
});
