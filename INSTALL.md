# Guia de instalação para o agente

Este arquivo é para o **agente de código** (Claude Code ou a aba Code do Claude Desktop) instalar o Instagram + Claude no computador da pessoa. Ele vale para a versão **v0.4.11**. Se você é uma pessoa, a [instalação manual do README](https://github.com/thaleslaray/instagram-claude/blob/v0.4.11/README.md#instalação-manual) é mais simples.

Neste guia, **passo** é um passo deste arquivo. **Etapa** é uma etapa da skill que a pessoa vai seguir depois (etapas 0 a 10).

## Regras (valem do começo ao fim)

1. **Antes do primeiro comando**, mande à pessoa esta mensagem e espere ela dizer que pode:
   > Vou instalar duas coisas: a skill que guia a configuração, em `~/.claude/skills/instagram-app-meta/`, e o arquivo da extensão do Instagram, em `~/Downloads/instagram-mcp.mcpb`. Ainda não vou instalar a extensão, só baixar e conferir se o arquivo é o original. Não vou pedir nem ver o seu token. Posso começar?
2. **Nunca peça, leia, cole nem mostre token** da Meta ou do Instagram. O token só entra mais tarde, pela tela da extensão, na etapa 9 da skill.
3. **Pare e pergunte** quando:
   - algum comando pedir senha ou `sudo`;
   - algum comando pedir login;
   - um destino já existir;
   - um comando falhar;
   - a conferência do arquivo der FALHOU.
4. **Não use `sudo`**, não instale programa no sistema e não execute nada do que for baixado. Este guia só baixa, confere e copia arquivos.
5. Use **só** os endereços deste guia, todos presos à versão `v0.4.11`.
6. **Rode cada bloco de comandos inteiro, numa chamada só do terminal.** Variáveis como `$TMP` não passam de uma chamada para outra.
7. Fale com a pessoa em português do Brasil, em frases curtas e sem jargão.

## O que este guia escreve

| Caminho | O que é |
|---|---|
| `~/.claude/skills/instagram-app-meta/` | A skill que guia a configuração na Meta |
| `~/Downloads/instagram-mcp.mcpb` | A extensão do Claude Desktop, baixada mas **ainda não instalada** |
| Uma pasta temporária (`mktemp -d`) | Usada no download da skill e apagada no mesmo bloco |

## Passo 1: conferir o computador

```bash
uname -s
ls -d /Applications/Claude.app 2>/dev/null || ls -d ~/Applications/Claude.app 2>/dev/null || echo "Claude Desktop não encontrado"
```

- Se `uname -s` não for `Darwin`, pare. Diga que este guia foi feito para Mac e que a extensão nunca foi testada no Windows. Indique a [instalação manual](https://github.com/thaleslaray/instagram-claude/blob/v0.4.11/README.md#instalação-manual).
- Se aparecer "Claude Desktop não encontrado", peça à pessoa para instalar o Claude Desktop em https://claude.ai/download e espere ela avisar que instalou.

## Passo 2: instalar a skill

Primeiro, veja se o destino já existe:

```bash
ls -la ~/.claude/skills/instagram-app-meta 2>/dev/null || echo "não existe"
```

Se o destino existir (pasta, arquivo ou link), mostre à pessoa o que tem lá e pergunte se pode substituir. Com o "sim", guarde uma cópia **fora** da pasta de skills. Uma cópia dentro de `~/.claude/skills` vira uma segunda skill.

```bash
mkdir -p ~/.claude/backups-de-skills
mv ~/.claude/skills/instagram-app-meta ~/.claude/backups-de-skills/instagram-app-meta-$(date +%Y%m%d-%H%M%S)
```

Depois, rode este bloco inteiro numa chamada só. Ele baixa a versão, copia a skill e apaga a pasta temporária:

```bash
(
  set -e
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL https://github.com/thaleslaray/instagram-claude/archive/refs/tags/v0.4.11.tar.gz -o "$TMP/fonte.tar.gz"
  tar -xzf "$TMP/fonte.tar.gz" -C "$TMP"
  mkdir -p ~/.claude/skills
  cp -R "$TMP/instagram-claude-0.4.11/skill" ~/.claude/skills/instagram-app-meta
  head -3 ~/.claude/skills/instagram-app-meta/SKILL.md
)
```

**Deu certo se** aparecer a linha `name: instagram-app-meta`. Se o bloco falhar no meio, a pasta temporária é apagada do mesmo jeito. Diga à pessoa o que falhou e pare.

## Passo 3: baixar a extensão e conferir

Se `~/Downloads/instagram-mcp.mcpb` já existir, pergunte antes de substituir. Com o "sim", mova o arquivo antigo para a Lixeira: `mv ~/Downloads/instagram-mcp.mcpb ~/.Trash/instagram-mcp-antigo-$(date +%Y%m%d-%H%M%S).mcpb`.

Rode este bloco inteiro numa chamada só. Ele baixa para um arquivo provisório e só dá o nome final se a conferência passar:

```bash
(
  cd ~/Downloads
  PARCIAL="instagram-mcp.mcpb.baixando"
  if curl -fsSL https://github.com/thaleslaray/instagram-claude/releases/download/v0.4.11/instagram-mcp.mcpb -o "$PARCIAL" \
     && echo "a3db0b2af2b9e44a661158488ed7a309b5d00f301e2864f8d4b48e90c3bb8557  $PARCIAL" | shasum -a 256 -c --status; then
    mv "$PARCIAL" instagram-mcp.mcpb
    echo "OK: arquivo original, em ~/Downloads/instagram-mcp.mcpb"
  else
    [ -f "$PARCIAL" ] && mv "$PARCIAL" ~/.Trash/
    echo "FALHOU: o download não terminou ou não é o arquivo original"
  fi
)
```

- **OK:** siga para o passo 4.
- **FALHOU:** pare e diga à pessoa que o download não deu certo, então nada foi instalado. Ela pode tentar de novo mais tarde.
- **Não abra o `.mcpb` agora.** A tela de instalação pede o token, e a pessoa só gera o token na etapa 8 da skill. A etapa 9 manda abrir o arquivo.

## Passo 4: dizer à pessoa o que fazer agora

Termine com um resumo curto do que foi instalado e onde, e com estas instruções, nesta ordem:

1. Comece uma **conversa nova** na aba Code do Claude Desktop, ou rode `claude` de novo no terminal. A skill só aparece em conversa nova.
2. Digite `/instagram-app-meta`.
3. Se `/instagram-app-meta` não aparecer: feche o Claude Desktop por completo com Cmd+Q, abra de novo e tente numa conversa nova.
4. A skill guia 10 etapas, uma por vez: criar o app na Meta, gerar o token e instalar a extensão. O arquivo da extensão já está em `~/Downloads`. Reserve um tempo sem pressa, porque algumas telas da Meta demoram.
5. Para isso, a pessoa precisa de:
   - uma conta do Instagram profissional e pública;
   - acesso de administrador a um portfólio empresarial na Meta.

   A etapa 0 confere os dois.
