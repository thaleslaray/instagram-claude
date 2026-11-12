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

## Tudo que dá para fazer

Depois de instalado, é só conversar com o Claude do seu jeito. Não precisa saber o nome das ferramentas: as frases abaixo são exemplos. Nas tabelas, a coluna **Seu clique** diz o que acontece antes da ação ir para o Instagram:
- **Sim:** a ação só vai depois que você clica no cartão de prévia.
- **Direto:** dá para desfazer, então vai sem prévia e fica registrada.
- **—:** só leitura.

### Mensagens (DMs)

| Peça assim | O que o Claude faz | Seu clique |
|---|---|---|
| "Quem me chamou no direct?" / "Acha a conversa com @fulano" | Lista as conversas, da mais recente para a mais antiga | — |
| "O que o @fulano me escreveu? Ainda dá para responder?" | Lê as 20 mensagens mais recentes e diz até quando a janela de 24 h fica aberta | — |
| "Mostra essa mensagem e o anexo" | Abre uma mensagem com texto e anexos | — |
| "Quem é essa pessoa? Ela me segue?" | Mostra o perfil de quem escreveu: @, seguidores, se segue você, se é verificada | — |
| "Responde o @fulano com o link do material" | Responde por texto, dentro de 24 h da última mensagem da pessoa | Sim |
| "Manda o PDF da aula para quem pediu" | Envia imagem, vídeo, áudio ou PDF, do computador ou por link | Sim |
| "Dá um coração na última mensagem dela" | Reage com emoji ou tira a reação | Direto |

### Comentários

| Peça assim | O que o Claude faz | Seu clique |
|---|---|---|
| "O que comentaram no último post? Tem pergunta?" | Lista os comentários com as respostas, curtidas e quais estão ocultos | — |
| "Mostra esse comentário e as respostas dele" | Abre um comentário e a conversa embaixo dele | — |
| "Responde o comentário da @fulana agradecendo" | Responde em público | Sim |
| "Comenta no meu último post que o link está na bio" | Publica um comentário novo num post seu | Sim |
| "Manda no privado para quem comentou QUERO" | Responde por DM a quem comentou. Vale uma vez por comentário, até 7 dias depois dele | Sim |
| "Apaga esse comentário" | Apaga. Não tem volta, e o cartão avisa isso | Sim |
| "Esconde os comentários com spam" | Esconde ou volta a mostrar | Direto |
| "Desliga os comentários desse post" | Liga ou desliga os comentários de um post | Direto |

### Publicação

| Peça assim | O que o Claude faz | Seu clique |
|---|---|---|
| "Publica esta foto com esta legenda" | Post de foto, com legenda, texto alternativo, marcações, local e colaboradores | Sim |
| "Posta essas 5 fotos em carrossel" | Carrossel de 2 a 20 fotos ou vídeos | Sim |
| "Sobe este vídeo como Reels com capa no segundo 3" | Reels de 3 s a 15 min (até 300 MB), com capa, marcações e colaboradores | Sim |
| "Posta esse vídeo nos stories" | Story de foto ou de vídeo de até 60 s | Sim |
| "Já saiu aquele post?" | Diz em que passo a publicação está e dá o link quando sai | — |
| "Quantos posts ainda posso fazer hoje?" | Mostra a cota de 24 h da Meta | — |

A foto ou o vídeo pode ser um link ou um arquivo do seu computador. O vídeo do computador vai direto para a Meta. A foto do computador precisa de uma chave gratuita do Uploadcare, que a etapa 10 da skill configura.

### Seus posts, stories e a concorrência

| Peça assim | O que o Claude faz | Seu clique |
|---|---|---|
| "Quais foram meus posts de outubro?" | Lista posts, Reels e carrosséis, com filtro de período | — |
| "Esse post aceita comentários?" | Abre os detalhes de um post seu | — |
| "Tenho story no ar?" | Lista os stories das últimas 24 h | — |
| "Quem me marcou?" | Lista os posts de outras contas que marcaram você | — |
| "Como está o perfil da @concorrente?" | Mostra o perfil público e os últimos posts de outra conta comercial ou de criador | — |

### Números

| Peça assim | O que o Claude faz | Seu clique |
|---|---|---|
| "Qual foi meu alcance nos últimos 28 dias? E de onde é o meu público?" | Insights da conta: alcance, visualizações, interações, seguidores novos, cliques no perfil e demografia | — |
| "Como foi esse Reels? Fugiu do normal?" | Insights de um post, Reels ou story, comparando com a mediana dos seus últimos posts do mesmo tipo | — |
| "Quantos seguidores eu tenho?" / "Qual conta está conectada?" | Dados e números do perfil | — |
| "O token está valendo?" | Confere o token sem mostrar o valor dele, a conta e as permissões | — |

### Roteiros prontos

São cinco tarefas completas, que o servidor oferece como atalhos (os "prompts" do MCP). Não precisa achar o atalho: dá para pedir com as suas palavras, como "faz a triagem dos comentários do último post".

| Roteiro | O que faz |
|---|---|
| Relatório semanal | Junta os números da conta e dos posts dos últimos dias, com os posts que fugiram do normal no topo |
| Legenda e publicação | Escreve a legenda a partir do seu briefing e prepara a publicação do arquivo, com prévia |
| Triagem de comentários | Separa os comentários em 6 grupos, rascunha respostas e sugere esconder o que for abusivo |
| Caixa de DMs | Lê as conversas recentes, separa o que precisa de resposta dentro de 24 h e rascunha as respostas |
| Pesquisa de concorrentes | Olha o perfil público de outras contas e acha os posts com mais de 3 vezes a mediana delas |

### O cartão de prévia

Toda ação marcada com "Sim" abre um cartão na conversa antes de ir para o Instagram. O cartão:
- mostra exatamente o que vai sair: a foto ou as miniaturas, a legenda inteira, para quem vai e quanto da cota de posts ainda sobra;
- deixa você **corrigir o texto ali mesmo** antes de enviar, na resposta de DM, na resposta no privado e na legenda de post, carrossel e Reels;
- tem **Enviar** e **Cancelar**, e o pedido vence sozinho se ninguém clicar;
- acompanha a publicação até aparecer **Pronto**, com o botão **Ver no Instagram**;
- mostra a versão instalada no rodapé.

As 33 ferramentas, com todas as opções, estão em [`mcp/README.md`](mcp/README.md).

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
- **Modo só leitura, para quem instala pelo Claude Code.** O perfil `leitura` nem chega a registrar as ferramentas de escrita. Veja os [modos de uso](mcp/README.md#modos-de-uso-ig_perfil). A extensão do Claude Desktop vem sempre com todas as ferramentas.

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
