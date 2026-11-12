// Ficha 17 (item 3): sem token ou com token recusado (190), a frase aponta para o campo da extensão quando a
// instalação é a extensão; fora dela, continua o `npm run guardar-token`. O token nunca aparece.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { FRASES } from "../src/erros.ts";
import { INSTRUCOES, instrucoes } from "../src/servidor.ts";
import { conectarCliente, montar } from "./ajuda.ts";
import { erroMeta } from "./graph-falsa.ts";

const SEM_TOKEN_EXTENSAO = "Token não cadastrado: abra as configurações da extensão Instagram no Claude Desktop e cole o token no campo dele.";
const SEM_TOKEN_TERMINAL = "Token não cadastrado: rode `npm run guardar-token` no terminal.";

type Resultado = { isError?: boolean; content: Array<{ text?: string }> };
const textoDe = (r: Resultado): string => r.content.map((b) => b.text ?? "").join("\n");

describe("frases do token conforme a instalação", () => {
  const antes = process.env.IG_INSTALACAO;
  beforeEach(() => {
    delete process.env.IG_INSTALACAO;
  });
  afterEach(() => {
    if (antes === undefined) delete process.env.IG_INSTALACAO;
    else process.env.IG_INSTALACAO = antes;
  });

  async function chamarComToken(token: string | null, ferramenta: string, args: Record<string, unknown>, depois?: (m: Awaited<ReturnType<typeof montar>>) => void): Promise<string> {
    const m = await montar({ token });
    depois?.(m);
    const c = await conectarCliente(m.ctx);
    try {
      return textoDe((await c.cliente.callTool({ name: ferramenta, arguments: args })) as unknown as Resultado);
    } finally {
      await c.fechar();
      await m.fechar();
    }
  }

  it("fora da extensão: as frases de hoje", async () => {
    assert.equal(await chamarComToken(null, "ig_conta", {}), SEM_TOKEN_TERMINAL);
    assert.ok(INSTRUCOES.includes("rodar `npm run guardar-token` no terminal dele"));
    const t190 = await chamarComToken("EAAtokenfalso", "ig_conta", {}, (m) => m.graphFalsa.padrao(erroMeta(190, "Invalid OAuth access token")));
    assert.ok(t190.startsWith(FRASES.token), t190);
  });

  it("na extensão: sem token manda para o campo da extensão", async () => {
    process.env.IG_INSTALACAO = "extensao";
    assert.equal(await chamarComToken(null, "ig_conta", {}), SEM_TOKEN_EXTENSAO);
  });

  it("na extensão: token recusado (190) manda para o campo da extensão, sem npm run", async () => {
    process.env.IG_INSTALACAO = "extensao";
    const t = await chamarComToken("EAAtokenfalso", "ig_conta", {}, (m) => m.graphFalsa.padrao(erroMeta(190, "Invalid OAuth access token")));
    assert.match(t, /Token inválido ou revogado \(190\)/);
    assert.match(t, /campo do token, nas configurações da extensão Instagram no Claude Desktop/);
    assert.doesNotMatch(t, /npm run/);
    assert.doesNotMatch(t, /EAAtokenfalso/);
  });

  it("na extensão: ig_estado_do_token também fala do campo da extensão", async () => {
    process.env.IG_INSTALACAO = "extensao";
    const m = await montar({ token: null });
    const c = await conectarCliente(m.ctx);
    try {
      const r = (await c.cliente.callTool({ name: "ig_estado_do_token", arguments: {} })) as unknown as { structuredContent?: { problemas?: string[] } };
      assert.ok(r.structuredContent?.problemas?.includes(SEM_TOKEN_EXTENSAO), JSON.stringify(r.structuredContent));
    } finally {
      await c.fechar();
      await m.fechar();
    }
  });

  it("as instruções do servidor mudam a linha do token na extensão", () => {
    const ext = instrucoes(true);
    assert.ok(ext.includes('Se uma ferramenta disser "Token não cadastrado", peça ao dono da conta para abrir as configurações da extensão Instagram no Claude Desktop e colar o token no campo dele.'));
    assert.doesNotMatch(ext, /npm run/);
    assert.equal(ext.replace(/- Nunca peça o token no chat\..*\n/, ""), INSTRUCOES.replace(/- Nunca peça o token no chat\..*\n/, ""));
  });
});
