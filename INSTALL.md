# Guia de instalação para o agente

Este arquivo é para o **agente de código** (Claude Code ou a aba Code do Claude Desktop) instalar o Instagram + Claude no computador da pessoa. Ele vale para a versão **v0.4.11**. Se você é uma pessoa, a [instalação manual do README](README.md#instalação-manual) é mais simples.

## Regras (valem do começo ao fim)

1. **Antes do primeiro comando**, mostre à pessoa a lista "O que este guia escreve", logo abaixo, e espere ela dizer que pode.
2. **Nunca peça, leia, cole nem mostre token** da Meta ou do Instagram. O token só entra depois, pela tela da extensão, na etapa 9 da skill.
3. **Pare e pergunte** quando:
   - algum comando pedir senha ou `sudo`;
   - algum comando pedir login;
   - um destino abaixo já existir;
   - um comando falhar;
   - um hash não bater.
4. **Não use `sudo`**, não instale programa no sistema e não execute nada do que for baixado. Este guia só baixa, confere e copia arquivos.
5. Use **só** os endereços deste guia, todos presos à tag `v0.4.11`.
6. Fale com a pessoa em português do Brasil, em frases curtas e sem jargão.

## O que este guia escreve

| Caminho | O que é |
|---|---|
| `~/.claude/skills/instagram-app-meta/` | A skill que guia a configuração na Meta |
| `~/Downloads/instagram-mcp.mcpb` | A extensão do Claude Desktop, baixada mas **ainda não instalada** |
| Uma pasta temporária (`mktemp -d`) | Usada para o download e apagada no fim |

## Passo 1: conferir o computador

```bash
uname -s
ls -d /Applications/Claude.app
```

- Se `uname -s` não for `Darwin`, pare. Diga que este guia foi feito para Mac e que a extensão nunca foi testada no Windows. Indique a instalação manual do README.
- Se `/Applications/Claude.app` não existir, peça à pessoa para instalar o Claude Desktop em https://claude.ai/download e pare até ela dizer que instalou.

## Passo 2: instalar a skill

Primeiro, veja se o destino já existe:

```bash
ls -la ~/.claude/skills/instagram-app-meta 2>/dev/null || echo "não existe"
```

Se o destino existir, mostre à pessoa o que tem lá e pergunte se pode substituir. Com o "sim", guarde uma cópia **fora** da pasta de skills. Uma cópia dentro de `~/.claude/skills` vira uma segunda skill.

```bash
mkdir -p ~/.claude/backups-de-skills
mv ~/.claude/skills/instagram-app-meta ~/.claude/backups-de-skills/instagram-app-meta-$(date +%Y%m%d-%H%M%S)
```

Depois, baixe a versão e copie a skill:

```bash
TMP="$(mktemp -d)"
curl -fsSL https://github.com/thaleslaray/instagram-claude/archive/refs/tags/v0.4.11.tar.gz -o "$TMP/fonte.tar.gz"
tar -xzf "$TMP/fonte.tar.gz" -C "$TMP"
mkdir -p ~/.claude/skills
cp -R "$TMP/instagram-claude-0.4.11/skill" ~/.claude/skills/instagram-app-meta
head -3 ~/.claude/skills/instagram-app-meta/SKILL.md
```

**Deu certo se** a última linha mostrar `name: instagram-app-meta`.

## Passo 3: baixar a extensão e conferir

Se `~/Downloads/instagram-mcp.mcpb` já existir, pergunte antes de substituir.

```bash
curl -fsSL https://github.com/thaleslaray/instagram-claude/releases/download/v0.4.11/instagram-mcp.mcpb -o ~/Downloads/instagram-mcp.mcpb
shasum -a 256 ~/Downloads/instagram-mcp.mcpb
```

O hash tem que ser exatamente este:

```
a3db0b2af2b9e44a661158488ed7a309b5d00f301e2864f8d4b48e90c3bb8557
```

- **Se o hash for diferente:** mova o arquivo para a Lixeira (`mv ~/Downloads/instagram-mcp.mcpb ~/.Trash/`), pare e diga à pessoa que o download não bateu com o original.
- **Não abra o `.mcpb` agora.** A tela de instalação pede o token, e a pessoa só gera o token na etapa 8 da skill. A etapa 9 manda abrir o arquivo.

## Passo 4: limpar

```bash
rm -rf "$TMP"
```

## Passo 5: dizer à pessoa o que fazer agora

Termine com um resumo curto do que foi instalado e onde, e com estas instruções, nesta ordem:

1. Abra uma **conversa nova** na aba Code. A skill só aparece em conversa nova.
2. Digite `/instagram-app-meta`.
3. A skill guia 10 etapas, uma por vez: criar o app na Meta, gerar o token e instalar a extensão. O arquivo da extensão já está em `~/Downloads`. Reserve um tempo sem pressa, porque algumas telas da Meta demoram.
4. Para isso, a pessoa precisa de:
   - uma conta do Instagram profissional e pública;
   - acesso de administrador a um portfólio empresarial na Meta.

   A etapa 0 confere os dois.
