// Revisão C3: tradução do `status` do container pela tabela oficial de erros do Instagram (error-codes.md),
// com o subcódigo lido de número OU de texto, nunca da frase em português.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { traduzirStatusDoContainer } from "../src/publicacao.ts";

const ESPERADOS: Array<[number, RegExp]> = [
  [2207003, /demorou demais para baixar/],
  [2207004, /imagem é grande demais/],
  [2207005, /formato da (mídia|imagem) não é aceito/],
  [2207006, /não achou a mídia.*(permissão|token)/s],
  [2207009, /proporção/],
  [2207010, /legenda.*(longa|passa)/],
  [2207020, /expirou/],
  [2207026, /formato do vídeo/],
  [2207032, /falhou ao criar/],
  [2207040, /marcações|@/],
  [2207042, /limite de publicação/],
  [2207050, /conta.*restrita/],
  [2207051, /spam|restringe/],
  [2207052, /não conseguiu baixar.*URL/],
  [2207053, /erro desconhecido.*upload/],
  [2207057, /capa|offset|instante/],
];

describe("traduzirStatusDoContainer (tabela oficial)", () => {
  for (const [codigo, frase] of ESPERADOS) {
    it(`${codigo} com status em texto`, () => {
      assert.match(traduzirStatusDoContainer("ERROR", `Error: Media upload has failed with error code ${codigo}`), frase);
    });
    it(`${codigo} com status numérico`, () => {
      assert.match(traduzirStatusDoContainer("ERROR", codigo), frase);
    });
  }

  it("2207006 não é mais 'não conseguiu baixar da URL' (isso é o 2207052)", () => {
    assert.doesNotMatch(traduzirStatusDoContainer("ERROR", 2207006), /baixar/);
  });

  it("subcódigo desconhecido ou status vazio: mensagem genérica, sem inventar motivo", () => {
    assert.match(traduzirStatusDoContainer("ERROR", 2207999), /não conseguiu processar a mídia \(ERROR\)\. Nada foi publicado/);
    assert.match(traduzirStatusDoContainer("ERROR", undefined), /não conseguiu processar a mídia \(ERROR\)/);
  });

  it("EXPIRED continua traduzido pelo status_code", () => {
    assert.match(traduzirStatusDoContainer("EXPIRED", undefined), /expirou/);
  });
});
