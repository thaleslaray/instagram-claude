// Ficha 17 (item 6): os erros de entrada saem em português, e o do IGSID diz a regra inteira.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { conectarCliente, montar, type Montagem } from "./ajuda.ts";

type Resultado = { isError?: boolean; content: Array<{ text?: string }> };
const textoDe = (r: Resultado): string => r.content.map((b) => b.text ?? "").join("\n");

describe("mensagens do validador de entrada", () => {
  let m: Montagem;
  let c: Awaited<ReturnType<typeof conectarCliente>>;
  const chamar = async (nome: string, args: Record<string, unknown>): Promise<string> => {
    // Erro de entrada pode voltar como resultado com isError ou como exceção do cliente: as duas formas contam.
    try {
      const r = (await c.cliente.callTool({ name: nome, arguments: args })) as unknown as Resultado;
      assert.equal(r.isError, true);
      return textoDe(r);
    } catch (erro) {
      return erro instanceof Error ? erro.message : String(erro);
    }
  };

  beforeEach(async () => {
    m = await montar();
    c = await conectarCliente(m.ctx, { comTela: true });
  });
  afterEach(async () => {
    await c.fechar();
    await m.fechar();
  });

  it("texto vazio, lista grande demais e tipo errado vêm em português, sem inglês", async () => {
    const vazio = await chamar("ig_comentar_midia", { midia_id: "M1", texto: "" });
    assert.match(vazio, /Pequeno demais: esperava que o texto tivesse >= 1 caracteres/);
    const grande = await chamar("ig_publicar_post", { imagem: "https://exemplo.com/a.jpg", colaboradores: ["a", "b", "c", "d"] });
    assert.match(grande, /Grande demais: esperava que o vetor tivesse <= 3 elementos/);
    const tipo = await chamar("ig_esconder_comentario", { comentario_id: "c1", esconder: "sim" });
    assert.match(tipo, /Entrada inválida: esperava um valor booleano/);
    for (const t of [vazio, grande, tipo]) assert.doesNotMatch(t, /Too small|Too big|expected|Invalid input/);
  });

  it("IGSID inválido diz a regra inteira: só dígitos e de 5 a 30", async () => {
    for (const [ferramenta, args] of [
      ["ig_perfil_contato", { usuario_id: "123" }],
      ["ig_responder_dm", { usuario_id: "123", texto: "Oi" }],
      ["ig_enviar_midia_dm", { usuario_id: "12ab", tipo: "image", url: "https://exemplo.com/a.jpg" }],
      ["ig_reagir_dm", { usuario_id: "1", mensagem_id: "m1", reacao: "love" }],
    ] as const) {
      const t = await chamar(ferramenta, args);
      assert.match(t, /O IGSID precisa ter só dígitos, de 5 a 30 \(por exemplo, 17841400000000001\)/, ferramenta);
    }
  });
});
