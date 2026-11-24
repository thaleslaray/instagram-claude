# Etapa 11 (opcional): responder DMs de qualquer pessoa

**Quer que o Claude responda DMs de qualquer pessoa, não só de quem é testador do app? Então faça esta etapa.** Quem só lê DMs, comenta, publica ou vê números pula esta etapa.

Por que precisa: a Meta só deixa o app responder uma DM se a conta estava com a **"Assinatura do webhook"** ligada quando a mensagem chegou. Webhook é um endereço na internet que a Meta avisa toda vez que chega mensagem. Para ligar a assinatura, a Meta exige esse endereço. Sem ele, a resposta falha com o erro `(#10)` "fora do período permitido", mesmo dentro de 24 horas.

O endereço sai de um botão, de graça, na conta da Cloudflare do aluno. Ele só responde "ok" para a Meta: não guarda nem lê nenhuma mensagem. O Claude continua lendo e respondendo pela extensão, como na etapa 9.

O aluno vai inventar uma senha nesta etapa. **Você nunca pede, lê nem repete essa senha.** Ele digita nos campos da Cloudflare e da Meta.

## 11a. Criar o endereço (botão da Cloudflare)

O aluno precisa de conta grátis na Cloudflare (sem cartão) e de conta no GitHub. Se não tiver, ele cria agora em https://dash.cloudflare.com/sign-up e https://github.com/signup.

1. Mande o link do botão: https://deploy.workers.cloudflare.com/?url=https://github.com/thaleslaray/instagram-claude/tree/main/webhook
2. Ele entra na Cloudflare e conecta o GitHub quando ela pedir. Ela cria uma cópia do projeto no GitHub dele; isso é esperado.
3. No campo **`VERIFY_TOKEN`**, ele inventa uma senha **sem espaços** e anota num lugar seguro.
4. Ele clica em **Create and deploy** e espera terminar.
5. Ele copia o endereço que aparece, algo como `https://instagram-webhook.SEU-NOME.workers.dev`, e cola aqui. O endereço não é segredo.

Confira o endereço:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "<endereço que o aluno colou>"
```

- `403`: certo. É a resposta para quem não tem a senha.
- `200` (ou o navegador mostra "Hello World"): subiu o código padrão, falha conhecida da Cloudflare. Ele apaga o Worker em **Workers & Pages** e clica no botão de novo.
- `523` ou `1010`: espere um minuto e confira de novo.

## 11b. Ligar o endereço no app da Meta

No painel do app (https://developers.facebook.com/apps, abrir o app criado na etapa 2): **Casos de uso > Instagram > Personalizar > API setup with Unified login**. Em alguns apps o nome é "API setup with Instagram login".

1. No passo **3, "Configurar webhooks"**: colar o endereço em **URL de callback** e a senha em **Verificar token**. Clicar em **Verificar e salvar**.
2. Na lista de campos que aparece, assinar **`messages`**.
3. No passo **2**, na linha da conta do Instagram, ligar a chave **"Assinatura do webhook"**.

Se a Meta disser que não conseguiu validar o URL: o endereço tem que estar inteiro, com `https`, e a senha tem que ser igual nos dois lugares, letra por letra. Esqueceu a senha? Na Cloudflare, **Workers & Pages > instagram-webhook > Settings > Variables and Secrets**, ele troca o `VERIFY_TOKEN` e repete o item 1.

Confira pelo MCP da Meta: `devtools_webhook_list` com `list_subscriptions` tem que mostrar o tópico `instagram`, o endereço dele e o campo `messages`, com `enabled: true`. A chave "Assinatura do webhook" da conta não aparece no MCP: peça um print ou que ele diga se a chave está azul.

## 11c. App publicado (modo Live)

Com o app em desenvolvimento, a Meta só entrega e libera DMs de quem tem papel no app (como o testador da etapa 7). Para responder qualquer pessoa, o app precisa estar **publicado**.

1. Confira pelo MCP da Meta (`devtools_app`) em que modo o app está.
2. Se estiver em desenvolvimento, ele muda para **Live** na chave do topo do painel do app. Explique antes o que muda: o app passa a valer para contas sem papel nele. Só mude depois do "pode" dele.
3. Se a Meta pedir dados que faltam (por exemplo ícone, categoria ou URL de política de privacidade), o painel diz quais. Ele preenche e tenta de novo.

## 11d. Testar com uma DM nova

1. Alguém que **não é testador** do app manda uma DM **nova** para a conta. Mensagem que chegou antes de ligar a assinatura continua bloqueada para sempre: não adianta testar com ela.
2. Peça ao Claude: "liste minhas conversas do Instagram" e responda essa DM, como na etapa 9e.

## Como saber que deu certo

A resposta enviada pelo cartão chega no celular de uma pessoa que não é testadora do app.

## Se der erro

| O que aparece | O que fazer |
|---|---|
| `(#10)` "fora do período permitido" com DM que chegou **depois** de ligar a assinatura | Confira de novo a chave "Assinatura do webhook" (11b, item 3) e o modo Live (11c). Depois peça outra DM nova. |
| `(#10)` com DM que chegou **antes** de ligar a assinatura | Não tem conserto: peça uma DM nova. |
| A DM de outra pessoa nem aparece na lista | Veja Solicitações e Pedidos ocultos (etapa 9d) e confira o modo Live (11c). |
