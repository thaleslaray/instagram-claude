import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { conectarCliente, montar } from "./ajuda.ts";

const manifesto = JSON.parse(readFileSync(new URL("../mcpb/manifest.json", import.meta.url), "utf8"));

describe("mcpb/manifest.json", () => {
  it("obrigatórios só o token (campo seguro) e o ID; a chave pública do Uploadcare vem depois, opcional e sem ser segredo", () => {
    const uc = manifesto.user_config;
    assert.deepEqual(Object.keys(uc), ["IG_TOKEN", "IG_ACCOUNT_ID", "IG_UPLOADCARE_PUBLIC_KEY"]);
    assert.equal(uc.IG_TOKEN.sensitive, true);
    assert.equal(uc.IG_TOKEN.required, true);
    assert.equal(uc.IG_ACCOUNT_ID.required, true);
    assert.notEqual(uc.IG_ACCOUNT_ID.sensitive, true);
    const chave = uc.IG_UPLOADCARE_PUBLIC_KEY;
    assert.equal(chave.required, false);
    assert.notEqual(chave.sensitive, true, "a chave pública não é segredo");
    assert.equal(chave.title, "Opcional (etapa 10): chave pública do Uploadcare");
    assert.match(chave.description, /foto/i);
    for (const k of Object.keys(uc)) assert.equal(manifesto.server.mcp_config.env[k], `\${user_config.${k}}`, k);
    // Além dos campos do usuário, só IG_INSTALACAO=extensao (muda as frases para o caminho da extensão).
    assert.equal(manifesto.server.mcp_config.env.IG_INSTALACAO, "extensao");
    assert.equal(Object.keys(manifesto.server.mcp_config.env).length, Object.keys(uc).length + 1);
    assert.deepEqual(manifesto.compatibility.platforms, ["darwin", "win32"]);
  });

  it("não sobra nenhum campo, texto ou ferramenta do R2 e a versão é a do pacote", () => {
    assert.doesNotMatch(JSON.stringify(manifesto), /R2|Cloudflare|bucket/i);
    const pacote = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(manifesto.version, pacote.version);
    assert.equal(manifesto.version, "0.4.11");
    const bloqueio = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    assert.equal(bloqueio.version, pacote.version);
    assert.equal(bloqueio.packages[""].version, pacote.version);
    assert.ok(!("aws4fetch" in (pacote.dependencies ?? {})));
  });

  it("os textos de apresentação descrevem o caminho do .mcpb (token no campo), não o do terminal", () => {
    const texto = `${manifesto.description} ${manifesto.long_description}`;
    assert.doesNotMatch(texto, /guardar-token|Keychain|Só macOS|npm run/);
    assert.match(manifesto.long_description, /Token do Instagram/);
    assert.equal(manifesto.author.name, "Thales Laray");
  });

  it("lista só ferramentas que o servidor tem, e todas as que o modelo enxerga", async () => {
    const m = await montar();
    const { cliente, fechar } = await conectarCliente(m.ctx, { comTela: true });
    try {
      const { tools } = await cliente.listTools();
      const doModelo = tools.filter((t) => !JSON.stringify(t._meta ?? {}).includes('"visibility":["app"]')).map((t) => t.name).sort();
      const doManifesto = (manifesto.tools as Array<{ name: string }>).map((t) => t.name).sort();
      assert.deepEqual(doManifesto, doModelo);
    } finally {
      await fechar();
      await m.fechar();
    }
  });
});
