---
name: instagram-app-meta
description: Guia o aluno, uma etapa por vez, do zero até o Claude dele pilotando o próprio Instagram. Cria o app na Meta, configura o login unificado com as 8 permissões, gera e confere o token e instala a extensão do Instagram no Claude Desktop. Use quando o aluno disser "quero conectar meu Instagram ao Claude", "criar app na Meta para o Instagram", "gerar token do Instagram", "instalar o MCP do Instagram", "pilotar meu Instagram com o Claude", ou chamar /instagram-app-meta. Feito para Claude Desktop em Mac e Windows, mas só foi provado no Mac.
---

# Instagram + Claude: do zero até o seu Claude pilotando seu Instagram

Você conduz o aluno por 10 etapas, mais uma opcional. A extensão do Instagram foi feita para Mac e Windows, mas **só foi provada no Mac**: diga isso ao aluno de Windows. Ao fim, o Claude dele lê DMs, responde, publica e vê números da conta, sempre com confirmação dele antes de qualquer escrita.

## Como conduzir (vale para todas as etapas)

1. **UMA etapa por vez.** Abra o arquivo da etapa em `references/` só quando chegar nela. Não adiante o que vem depois.
2. **Sempre o link direto.** Nunca diga "vá no menu tal" sem o link. Se a página tem endereço, mande o endereço.
3. **Passo a passo curto.** Diga exatamente onde clicar. Frases curtas. Português do Brasil, com acentos, tom de conversa.
4. **Espere o aluno dizer "fiz".** Só então confira (pelo MCP da Meta ou por comando, quando a etapa permitir) e siga.
5. **Cada etapa termina com "Como saber que deu certo".** Só avance se isso aconteceu. Se não aconteceu, resolva ali mesmo.
6. **Sem jargão.** Se um termo técnico for inevitável, explique em uma frase simples. "Token" = uma senha de acesso longa que o Claude usa no lugar da sua senha do Instagram. "MCP" = a ponte que deixa o Claude usar um programa. Evite termos de infraestrutura.
7. **Comece pela etapa 0** e anuncie o mapa: "são 10 etapas, mais uma opcional, uma de cada vez". Se o aluno já fez parte, pergunte onde parou e confira antes de pular.
8. **Tudo o que o MCP da Meta faz, faça pelo MCP.** Criar portfólio, criar app, ligar ao portfólio e adicionar caso de uso: sempre pelas ferramentas `devtools_*`. Painel ou navegador só quando o MCP estiver indisponível (não instalado, sem liberação da Meta, ou a ferramenta falhou) ou para o que o MCP não cobre (as etapas 5 a 8). Nunca proponha o painel "para testar" um caminho que o MCP já faz.

## Segurança (regras duras)

- **O token NUNCA é colado no chat.** Nem em print, nem digitado, nem lido da tela por você. Se o aluno colar um token, diga para ele gerar outro (o antigo fica exposto) e não repita o valor.
- Você nunca abre a aba onde o token aparece. O aluno gera e copia o token numa aba normal, aberta por ele.
- O token só passa pela área de transferência e pelo **campo da extensão** na tela do Claude Desktop, que o guarda no cofre do computador. Nunca por variável de ambiente, arquivo ou chat.
- **Ação que não tem volta na Meta** (aceitar termos, ligar o app ao portfólio, adicionar caso de uso, adicionar conta ao portfólio) só acontece depois que você explicar o que muda e o aluno disser "pode" por escrito.
- Mexer só no que é do aluno. Nunca escolher uma conta real por engano quando a lista mostrar várias.

## As etapas (0 a 9, e a 10 opcional)

| # | Etapa | Arquivo | Onde acontece |
|---|---|---|---|
| 0 | Antes de começar | `references/etapa-00-antes-de-comecar.md` | Conversa + Instagram |
| 1 | Limpar ligações antigas do Instagram | `references/etapa-01-limpar-ligacoes.md` | Instagram |
| 2 | Conectar o MCP da Meta e criar o app | `references/etapa-02-criar-o-app.md` | Claude + Meta |
| 3 | Ligar o app ao portfólio | `references/etapa-03-ligar-ao-portfolio.md` | Claude + Meta |
| 4 | Adicionar o caso de uso do Instagram | `references/etapa-04-caso-de-uso.md` | Claude + Meta |
| 5 | Criar a configuração do login unificado, com as 8 permissões | `references/etapa-05-configuracao-e-permissoes.md` | Painel da Meta |
| 6 | Testador do Instagram e aceite do convite | `references/etapa-06-testador.md` | Painel + Instagram |
| 7 | Pôr a conta no portfólio | `references/etapa-07-conta-no-portfolio.md` | Business Suite |
| 8 | Gerar o token e conferir | `references/etapa-08-gerar-e-conferir-token.md` | Painel + terminal |
| 9 | Instalar a extensão do Instagram e testar | `references/etapa-09-instalar-e-testar.md` | Claude Desktop |
| 10 | **Opcional:** publicar foto que está no computador (Uploadcare) | `references/etapa-10-foto-do-computador.md` | Uploadcare + Claude Desktop |

## Armadilhas que valem para o curso inteiro

- **Instagram Login não serve para app novo.** A Meta mostra o aviso de que a configuração com "login do Instagram" não está disponível para apps recentes. O caminho certo é o **login unificado**. Não procure a outra opção.
- **O token aparece uma vez só.** Se perder, gere outro. Não tem problema, só repete o clique.
- **Permissão nova pede token novo.** Por isso as 8 permissões já entram na etapa 5, antes de gerar o token.
- **Janela que fecha sozinha.** Algumas janelas da Meta fecham sem mensagem. Nada foi salvo; refaça a etapa da janela.
- **A tela da Meta demora.** Se ficar em branco, espere uns 10 segundos antes de recarregar.
- **DM de quem a conta não segue cai em Solicitações ou Pedidos ocultos.** Enquanto o pedido não for aceito no app do Instagram, a conversa não aparece para o Claude (etapa 9).
- **Pacote novo da extensão precisa de número de versão novo.** Se o Claude Desktop mostrar a tela de configuração antiga, desinstale a extensão e abra o arquivo de novo (etapa 9).
- **Instalou, atualizou ou salvou a configuração da extensão? Cmd+Q no Claude Desktop, abra de novo e use uma conversa nova.** Conversa antiga continua com a versão velha, ou nem enxerga a extensão.
- **Fique na conversa até o cartão aparecer e mostrar "Pronto".** Sair antes pode perder o cartão.
- **Clique em Enviar UMA vez.** Se o cartão sumir e voltar, não clique de novo: ele mostra "Este pedido já foi enviado".

## Se algo sair do roteiro

Peça ao aluno para descrever (sem token) o que aparece na tela, ou para dizer o texto da mensagem de erro. Resolva a etapa ali. Se o erro vier da Meta com um código, como `(#10)` ou `(#200)`, veja a tabela no fim da etapa 9. Se o `(#10)` "fora do período permitido" vier segundos depois de a pessoa escrever, leia o aviso sobre contas bloqueadas na etapa 0.
