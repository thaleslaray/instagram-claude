# Webhook do Instagram

O webhook mais simples possível para ligar as DMs do seu app da Meta. Um clique, uma senha, pronto.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thaleslaray/instagram-claude/tree/main/webhook)

## Para que serve

A Meta só deixa o seu app responder DMs se a conta tiver a "Assinatura do webhook" ligada. Para ligar, ela exige um endereço (URL) que responda a verificação.

Este template cria esse endereço na sua conta da Cloudflare, de graça. Ele não guarda nem lê nada: só responde "ok".

## O que você precisa

- Conta grátis na Cloudflare (sem cartão).
- Conta no GitHub.
- Um app na Meta com o Instagram configurado e publicado (modo **Live**).

## Passo a passo

1. Clique no botão "Deploy to Cloudflare" acima.
2. Entre na Cloudflare e conecte o GitHub quando ela pedir. Ela cria uma cópia deste projeto no seu GitHub.
3. No campo `VERIFY_TOKEN`, invente uma senha sem espaços e anote.
4. Clique em "Create and deploy" e espere terminar. Copie o endereço que aparece, algo como `https://instagram-webhook.SEU-NOME.workers.dev`.
5. Abra o endereço no navegador. Se aparecer `forbidden`, está certo: é a resposta para quem não tem a senha. Se der erro 523, espere um minuto.
6. No painel da Meta (developers.facebook.com): seu app > Casos de uso > Instagram > Personalizar > "API setup with Instagram login" (em alguns apps o nome é "API setup with Unified login") > passo 3, "Configurar webhooks". Cole o endereço em "URL de callback" e a senha em "Verificar token". Clique em "Verificar e salvar".
7. Na lista de campos que aparece, assine `messages`.
8. Ainda na mesma página, no passo 2, ligue a chave "Assinatura do webhook" da sua conta do Instagram.
9. Teste com uma DM NOVA. Mensagens que chegaram antes de ligar a assinatura não podem ser respondidas.

## Faz parte do Instagram + Claude

Este webhook é a etapa 11 (opcional) da skill do [Instagram + Claude](https://github.com/thaleslaray/instagram-claude). Se você usa a skill, digite `/instagram-app-meta` e peça a etapa 11: o Claude guia cada clique.

## Deu errado?

| Problema | O que fazer |
|---|---|
| A Meta diz que não conseguiu validar o URL | Confira se colou o endereço inteiro, com `https`, e se a senha é igual nos dois lugares, letra por letra. |
| O endereço mostra "Hello World" | O deploy subiu o código padrão (falha conhecida da Cloudflare). Apague o Worker e clique no botão de novo. |
| Erro 523 ou 1010 ao abrir o endereço | Espere um minuto e tente de novo. |
| A DM de outra pessoa não chega, só a sua | O app está em modo de desenvolvimento. No topo do painel da Meta, mude para **Live**. |
| Erro (#10) ... fora do período permitido ao responder | A mensagem chegou antes de ligar a assinatura. Peça uma DM nova. |
| Esqueci a senha | Cloudflare > Workers & Pages > instagram-webhook > Settings > Variables and Secrets: troque o `VERIFY_TOKEN` e repita o passo 6. |

## Perguntas rápidas

**Custa alguma coisa?**
Não. O plano gratuito aguenta 100 mil chamadas por dia.

**Ele guarda minhas DMs?**
Não. Ele recebe o aviso da Meta e responde "ok", sem gravar. Os logs estão desligados.

**Um webhook serve para vários apps?**
Serve, mas cada app da Meta aceita só um endereço de callback.

**Preciso mexer no código?**
Não.

---

Projeto independente, sem vínculo com a Meta nem com a Cloudflare. Licença MIT.
