# Webhook do Instagram

O webhook mais simples possível para ligar as DMs do seu app da Meta. Um clique e pronto.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thaleslaray/instagram-claude/tree/main/webhook)

## Para que serve

A Meta só deixa o seu app responder DMs se a conta tiver a "Assinatura do webhook" ligada. Para ligar, ela exige um endereço (URL) que responda a verificação.

Este template cria esse endereço na sua conta da Cloudflare, de graça. Ele não guarda nem lê nada: só responde "ok".

## O que você precisa

- Conta grátis na Cloudflare (sem cartão).
- Conta no GitHub.
- Um app na Meta com o Instagram configurado. Para responder pessoas que não são testadoras do app, ele precisa estar publicado (modo **Live**); dá para publicar depois de ligar o webhook.

## Passo a passo

1. Clique no botão "Deploy to Cloudflare" acima.
2. Entre na Cloudflare. Em **Git account**, escolha a sua conta do GitHub. Na primeira vez, clique em **New GitHub connection** e autorize; no GitHub, escolha **All repositories**. A Cloudflare cria uma cópia deste projeto no seu GitHub (marcar **Create private Git repository** é opcional).
3. Deixe o resto como está, inclusive o campo `VERIFY_TOKEN`, que já vem com `instagram-claude`.
4. Clique em **Deploy** e espere terminar. Copie o endereço que aparece, algo como `https://instagram-webhook.SEU-NOME.workers.dev`.
5. Abra o endereço no navegador. Se aparecer `forbidden`, está certo: é a resposta para quem não é a Meta. Se der erro 523, espere um minuto.
6. No painel da Meta (developers.facebook.com): seu app > Casos de uso > Instagram > Personalizar > "API setup with Unified login" (em alguns apps o nome é "API setup with Instagram login") > passo 3, "Configurar webhooks". Cole o endereço em "URL de callback" e escreva `instagram-claude` em "Verificar token". Clique em "Verificar e salvar".
7. Na lista de campos que aparece, assine `messages`.
8. Ainda na mesma página, no passo 2, na coluna "Assinatura do webhook", deixe a sua conta do Instagram como **Ativado**. O passo 4, "Conclua a análise do app", não precisa: app só para a sua própria conta dispensa a análise.
9. Teste com uma DM NOVA. Mensagens que chegaram antes de ligar a assinatura não podem ser respondidas.

## Faz parte do Instagram + Claude

Este webhook é a etapa 11 (opcional) da skill do [Instagram + Claude](https://github.com/thaleslaray/instagram-claude). Se você usa a skill, digite `/instagram-app-meta` e peça a etapa 11: o Claude guia cada clique.

## Deu errado?

| Problema | O que fazer |
|---|---|
| A Meta diz que não conseguiu validar o URL | Confira se colou o endereço inteiro, com `https`, e se escreveu `instagram-claude` em "Verificar token", tudo minúsculo. |
| O endereço mostra "Hello World" | O deploy subiu o código padrão (falha conhecida da Cloudflare). Apague o Worker e clique no botão de novo. |
| Erro 523 ou 1010 ao abrir o endereço | Espere um minuto e tente de novo. |
| A DM de outra pessoa não chega, só a sua | O app está em modo de desenvolvimento. No topo do painel da Meta, mude para **Live**. |
| Erro (#10) ... fora do período permitido ao responder | A mensagem chegou antes de ligar a assinatura. Peça uma DM nova. |

## Perguntas rápidas

**Custa alguma coisa?**
Não. O plano gratuito aguenta 100 mil chamadas por dia.

**Ele guarda minhas DMs?**
Não. Ele recebe o aviso da Meta e responde "ok", sem gravar. Os logs estão desligados.

**Um webhook serve para vários apps?**
Serve, mas cada app da Meta aceita só um endereço de callback.

**O "Verificar token" é igual para todo mundo. Tem problema?**
Não. Ele só serve para a Meta confirmar que o endereço responde. O Worker não guarda nem lê nada, então não há o que proteger. Quer outro? Troque o `VERIFY_TOKEN` em Settings > Variables and Secrets e use o mesmo na Meta.

**Preciso mexer no código?**
Não.

---

Projeto independente, sem vínculo com a Meta nem com a Cloudflare. Licença MIT.
