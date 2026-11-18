---
name: instagram-manycraft
description: Conecta o Instagram de um cliente ou aluno ao ManyCraft do zero, para as DMs e comentários chegarem na caixa de entrada. Fluxo completo da /instagram-app-meta (app, portfólio, caso de uso, permissões, testador, token) mais o que só o ManyCraft precisa (caso de uso Messenger, permissões de Página, webhook, publicar, Página inscrita, encaminhamento de conversas). Use quando pedirem para ligar um Instagram ao ManyCraft, ou quando o canal aparece conectado mas as DMs não chegam. Para a extensão do Claude (MCP) use a /instagram-app-meta.
---

# Instagram no ManyCraft: do zero até as DMs chegando na caixa de entrada

Você conduz o aluno por 14 etapas (0 a 13). Ao fim, as DMs e comentários da conta chegam na caixa de entrada do ManyCraft em segundos.

## Como conduzir (vale para todas as etapas)

1. **UMA etapa por vez.** Abra o arquivo da etapa em `references/` só quando chegar nela. Não adiante o que vem depois.
2. **Sempre o link direto.** Nunca diga "vá no menu tal" sem o link. Se a página tem endereço, mande o endereço.
3. **Passo a passo curto.** Diga exatamente onde clicar. Frases curtas. Português do Brasil, com acentos, tom de conversa.
4. **Espere o aluno dizer "fiz".** Só então confira (pelo MCP da Meta ou por comando, quando a etapa permitir) e siga.
5. **Cada etapa termina com "Como saber que deu certo".** Só avance se isso aconteceu. Se não aconteceu, resolva ali mesmo.
6. **Sem jargão.** Se um termo técnico for inevitável, explique em uma frase simples. "Token" = uma senha de acesso longa que o Claude usa no lugar da sua senha do Instagram. "MCP" = a ponte que deixa o Claude usar um programa. Evite termos de infraestrutura.
7. **Comece pela etapa 0** e anuncie o mapa: "são 14 etapas, uma de cada vez". Se o aluno já fez parte, pergunte onde parou e confira antes de pular.
8. **Tudo o que o MCP da Meta faz, faça pelo MCP.** Criar portfólio, criar app, ligar ao portfólio e adicionar caso de uso: sempre pelas ferramentas `devtools_*`. Painel ou navegador só quando o MCP estiver indisponível (não instalado, sem liberação da Meta, ou a ferramenta falhou) ou para o que o MCP não cobre (as etapas 5 a 8). Nunca proponha o painel "para testar" um caminho que o MCP já faz.

## Segurança (regras duras)

- **O token NUNCA é colado no chat.** Nem em print, nem digitado, nem lido da tela por você. Se o aluno colar um token, diga para ele gerar outro (o antigo fica exposto) e não repita o valor.
- Você nunca abre a aba onde o token aparece. O aluno gera e copia o token numa aba normal, aberta por ele.
- O token e a chave secreta só passam pela área de transferência e pelos campos do ManyCraft (Conectar / Trocar credencial). Nunca por chat, variável de ambiente ou arquivo.
- **Ação que não tem volta na Meta** (aceitar termos, ligar o app ao portfólio, adicionar caso de uso, adicionar conta ao portfólio) só acontece depois que você explicar o que muda e o aluno disser "pode" por escrito.
- Mexer só no que é do aluno. Nunca escolher uma conta real por engano quando a lista mostrar várias.

## As etapas (0 a 13)

As etapas 0 a 8 são as da `/instagram-app-meta`, com três diferenças: o caso de uso **Messenger** na 4, as 3 permissões de **Página** na 5 e a **Página** marcada no token na 8. As etapas 9 a 13 são do ManyCraft.

| # | Etapa | Arquivo | Onde acontece |
|---|---|---|---|
| 0 | Antes de começar | `references/etapa-00-antes-de-comecar.md` | Conversa + Instagram |
| 1 | Limpar ligações antigas do Instagram | `references/etapa-01-limpar-ligacoes.md` | Instagram |
| 2 | Conectar o MCP da Meta e criar o app | `references/etapa-02-criar-o-app.md` | Claude + Meta |
| 3 | Ligar o app ao portfólio | `references/etapa-03-ligar-ao-portfolio.md` | Claude + Meta |
| 4 | Casos de uso do Instagram **e do Messenger** | `references/etapa-04-caso-de-uso.md` | Claude + Meta |
| 5 | Configuração do login unificado, com as **11** permissões | `references/etapa-05-configuracao-e-permissoes.md` | Painel da Meta |
| 6 | Testador do Instagram e aceite do convite | `references/etapa-06-testador.md` | Painel + Instagram |
| 7 | Pôr a conta no portfólio | `references/etapa-07-conta-no-portfolio.md` | Business Suite |
| 8 | Gerar o token (com a **Página**) e conferir | `references/etapa-08-gerar-e-conferir-token.md` | Painel + terminal |
| 9 | Webhook do app (o ManyCraft assina sozinho; só conferir) | `references/etapa-09-webhook-do-app.md` | Claude + Meta |
| 10 | Publicar o app | `references/etapa-10-publicar.md` | Painel da Meta |
| 11 | Conectar no ManyCraft (o ManyCraft inscreve a Página sozinho) | `references/etapa-11-conectar-no-manycraft.md` | ManyCraft |
| 12 | Tirar o app antigo e pôr o ManyCraft como padrão das conversas | `references/etapa-12-encaminhamento-de-conversas.md` | Facebook + Business Suite |
| 13 | Testar com um perfil que nunca conversou com a conta | `references/etapa-13-testar.md` | Instagram + ManyCraft |

## Armadilhas que valem para o curso inteiro

- **Sem Página do Facebook, sem webhook.** No login pelo Facebook, a Meta só avisa das DMs se a **Página ligada ao Instagram** estiver inscrita no app. Por isso o caso de uso Messenger (etapa 4), as permissões de Página (etapa 5) e a Página no token (etapa 8) são obrigatórios aqui.
- **App antigo como padrão do encaminhamento leva as DMs embora** (etapa 12). Remover o app antigo do portfólio não tira ele de lá.
- **Conversa antiga não muda de dono.** Teste sempre com um perfil que nunca conversou com a conta.

- **Instagram Login não serve para app novo.** A Meta mostra o aviso de que a configuração com "login do Instagram" não está disponível para apps recentes. O caminho certo é o **login unificado**. Não procure a outra opção.
- **O token aparece uma vez só.** Se perder, gere outro. Não tem problema, só repete o clique.
- **Permissão nova pede token novo.** Por isso as 11 permissões já entram na etapa 5, antes de gerar o token.
- **Janela que fecha sozinha.** Algumas janelas da Meta fecham sem mensagem. Nada foi salvo; refaça a etapa da janela.
- **A tela da Meta demora.** Se ficar em branco, espere uns 10 segundos antes de recarregar.
- **DM de quem a conta não segue cai em Solicitações ou Pedidos ocultos.** Enquanto o pedido não for aceito no app do Instagram, a conversa pode não aparecer no ManyCraft (etapa 13).

## Se algo sair do roteiro

Peça ao aluno para descrever (sem token) o que aparece na tela, ou para dizer o texto da mensagem de erro. Resolva a etapa ali. Se o erro vier da Meta com um código, como `(#10)` ou `(#200)`, veja a etapa 13. Se o `(#10)` "fora do período permitido" vier segundos depois de a pessoa escrever, leia o aviso sobre contas bloqueadas na etapa 0.
