# Instagram + Claude

**Seu Claude lendo e operando o seu Instagram: DMs, comentários, publicação e números da conta.** Nada é publicado, respondido ou apagado sem o seu clique.

[![Licença MIT](https://img.shields.io/github/license/thaleslaray/instagram-claude)](LICENSE)
[![Versão](https://img.shields.io/github/v/release/thaleslaray/instagram-claude)](https://github.com/thaleslaray/instagram-claude/releases/latest)
[![Testado no macOS](https://img.shields.io/badge/testado%20no-macOS-lightgrey)](#compatibilidade)

Usa a API oficial da Meta, sem automação de navegador e sem senha do Instagram. O token fica guardado no cofre do seu computador.

## Instalar com um prompt

Abra o **Claude Desktop** na aba **Code** (ou o Claude Code no terminal), cole o texto abaixo e envie:

```text
Instale o Instagram + Claude seguindo o guia
https://raw.githubusercontent.com/thaleslaray/instagram-claude/v0.4.11/INSTALL.md
Leia o guia inteiro antes de rodar qualquer comando, me diga o que vai fazer
e pare para eu decidir sempre que precisar de login, senha ou token.
```

O Claude baixa a extensão e confere se o arquivo é o original. Depois instala a skill que vai te guiar no resto. Ele não pede nem toca no seu token.

Depois disso, abra uma **conversa nova** na aba Code e digite `/instagram-app-meta`. A skill te leva, uma etapa por vez, de "nunca mexi na Meta" até o Claude respondendo a sua primeira DM.

> Prefere fazer à mão? Veja [Instalação manual](#instalação-manual).

## O que vem no pacote

| Parte | O que é | O que faz |
|---|---|---|
| **Extensão do Instagram** ([`mcp/`](mcp/)) | Um servidor MCP empacotado como extensão `.mcpb` do Claude Desktop. MCP é a ponte que deixa o Claude usar um programa. | Dá ao Claude 33 ferramentas para ler e operar **uma** conta profissional do Instagram. Funciona no chat e na aba Code. |
| **Skill de configuração** ([`skill/`](skill/)) | Um guia que o Claude segue com você, em 10 etapas e uma opcional. | Cria o app na Meta, configura o login com as 8 permissões, gera e confere o token e instala a extensão. A etapa opcional liga a publicação de fotos do computador. |

## O que dá para pedir

Depois de instalado, é só conversar:

- "Quais DMs chegaram hoje e quem está esperando resposta?"
- "Responde o comentário da @fulana agradecendo."
- "Publica esta foto com esta legenda." (aceita link ou arquivo do computador)
- "Como foram meus últimos 10 posts em alcance e salvamentos?"
- "Esconde os comentários com spam do último post."
- "Me dá o relatório da semana."

| Área | O que o Claude faz |
|---|---|
| DMs | Lista conversas, lê mensagens e responde dentro da janela de 24 h da Meta. Também manda mídia e reage. |
| Comentários | Lista, responde, comenta, responde no privado, esconde, apaga e liga ou desliga comentários. |
| Publicação | Publica post, carrossel, Reels e story, por link ou arquivo do computador, e acompanha até sair. |
| Mídias e conta | Lista posts, stories e marcações. Lê o perfil público de outra conta comercial. |
| Números | Mostra insights da conta e de cada post, com métricas calculadas. |
| Roteiros prontos | Relatório semanal, legenda e publicação, triagem de comentários, caixa de DMs e pesquisa de concorrentes. |

A lista completa de ferramentas e de configurações está em [`mcp/README.md`](mcp/README.md).

### O que não dá

A API oficial não permite, então o Claude responde "não dá" em vez de tentar outro caminho:
- curtir;
- seguir;
- ver o feed ou os seguidores de outras contas;
- mandar a primeira DM para quem nunca te escreveu;
- responder DM depois de 24 h;
- apagar post publicado;
- buscar por hashtag;
- figurinha ou enquete em story;
- editar a legenda de post já publicado.

A lista com o porquê de cada item está em [`mcp/README.md`](mcp/README.md#o-que-não-faz).

## Segurança

- **Toda escrita passa pelo seu clique.** Publicar, responder e apagar mostram um cartão de prévia na conversa, e a ação só acontece quando você clica em Enviar. O Claude não consegue confirmar sozinho.
- **O token nunca passa pela conversa.** Você cola o token num campo seguro da extensão, e o Claude Desktop guarda no cofre do computador. O token não fica em arquivo, nem em variável de ambiente, nem em log.
- **Mensagem de terceiro é dado, não ordem.** Se uma DM ou um comentário disser "ignore as instruções", o Claude não obedece.
- **Tudo fica registrado.** Cada escrita entra num registro local (`~/Library/Logs/instagram-mcp/acoes.jsonl`), sem token.
- **Modo só leitura.** O perfil de ferramentas `leitura` nem registra as ferramentas de escrita. Veja [modos de uso](mcp/README.md#modos-de-uso-ig_perfil).

Achou uma falha de segurança? Veja [SECURITY.md](SECURITY.md).

## Compatibilidade

| | |
|---|---|
| Sistema | **macOS: testado.** Windows: a extensão foi feita para ele, mas nunca foi testada. |
| Claude | Claude Desktop, para a extensão. Aba Code do Claude Desktop ou Claude Code no terminal, para a skill. |
| Conta do Instagram | Profissional (comercial ou de criador de conteúdo) e pública. |
| Meta | Conta de desenvolvedor e um portfólio empresarial em que você seja administrador. A skill confere tudo isso na etapa 0. |
| Node | Não precisa: a extensão usa o Node que já vem no Claude Desktop. |

## Instalação manual

1. Baixe o `instagram-mcp.mcpb` da [última versão](https://github.com/thaleslaray/instagram-claude/releases/latest). **Não abra o arquivo ainda**: a tela de instalação pede o token, que você só gera na etapa 8.
2. Baixe o código-fonte da mesma versão e copie a pasta `skill/` para `~/.claude/skills/instagram-app-meta/`.
3. Abra uma conversa nova na aba Code e digite `/instagram-app-meta`. A skill faz o resto. Na etapa 9, ela pede para abrir o `.mcpb`.

## Atualizar

Rode o prompt de instalação de novo com a versão nova, ou baixe o `.mcpb` novo e abra por cima do antigo. Depois:
1. Feche o Claude Desktop por completo com **Cmd+Q**.
2. Abra de novo.
3. Use uma **conversa nova**. Conversa antiga continua com a versão velha.

A versão instalada aparece no rodapé do cartão de prévia.

## Desinstalar

1. Claude Desktop > **Configurações > Extensões** > Instagram > desinstalar.
2. Apague a pasta `~/.claude/skills/instagram-app-meta`.
3. Para cortar o acesso na Meta, logado na conta, abra https://www.instagram.com/accounts/manage_access/ e remova o app nas abas **Ativos** e **Testadores**.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| O Claude não enxerga a extensão | Cmd+Q no Claude Desktop, abra de novo e use uma conversa nova. |
| Apareceu texto no lugar do cartão de prévia | Peça a prévia de novo na mesma conversa. Se continuar, reinstale a extensão. |
| O cartão sumiu e voltou | Não clique de novo. Se já foi enviado, o cartão mostra isso. |
| A DM de alguém não aparece | DM de quem você não segue cai em **Solicitações**. Aceite no app do Instagram. |
| Erro `(#10)` ou `(#200)` da Meta | A tabela no fim da [etapa 9](skill/references/etapa-09-instalar-e-testar.md) explica cada um. |

Fique na conversa até o cartão mostrar **Pronto**. Vídeo pode levar 30 segundos ou mais, porque a Meta processa antes de publicar.

## Para quem desenvolve

O código está em [`mcp/`](mcp/), em TypeScript, com 535 testes que não usam a rede. Build, testes, empacotamento e uso no Claude Code ficam em [`mcp/README.md`](mcp/README.md#desenvolvimento).

## Licença e aviso

[MIT](LICENSE). Feito por [Thales Laray](https://thaleslaray.com.br).

Este projeto não é da Meta, do Instagram nem da Anthropic, e não tem ligação com eles. Ele usa a API oficial da Meta dentro das regras dela: você cria o seu próprio app e usa o seu próprio token.
