# Etapa 11 (opcional): responder DMs de qualquer pessoa

**Quer que o Claude responda DMs de qualquer pessoa, não só de quem é testador do app? Então faça esta etapa.** Quem só lê DMs, comenta, publica ou vê números pula esta etapa.

Por que precisa: a Meta só deixa o app responder uma DM se a conta estava com a **"Assinatura do webhook"** ligada quando a mensagem chegou. Webhook é um endereço na internet que a Meta avisa toda vez que chega mensagem. Para ligar a assinatura, a Meta exige esse endereço. Sem ele, a resposta falha com o erro `(#10)` "fora do período permitido", mesmo dentro de 24 horas.

O endereço sai de um botão, de graça, na conta da Cloudflare do aluno. Ele só responde "ok" para a Meta: não guarda nem lê nenhuma mensagem. O Claude continua lendo e respondendo pela extensão, como na etapa 9.

## 11a. Criar o endereço (botão da Cloudflare)

O aluno precisa de conta grátis na Cloudflare (sem cartão) e de conta no GitHub. Se não tiver, ele cria agora em https://dash.cloudflare.com/sign-up e https://github.com/signup.

1. Mande o link do botão: https://deploy.workers.cloudflare.com/?url=https://github.com/thaleslaray/instagram-claude/tree/main/webhook
2. Ele entra na Cloudflare. Em **Git account**, escolhe a conta do GitHub dele. Na primeira vez, clica em **New GitHub connection** e autoriza; no GitHub, escolhe **All repositories** (com "Only select repositories" o app pode não alcançar o repositório novo). A Cloudflare cria uma cópia do projeto no GitHub dele; isso é esperado. Marcar **Create private Git repository** é opcional.
3. O campo **`VERIFY_TOKEN`** já vem com `instagram-claude`: deixar como está, e o resto também. Ele clica em **Deploy** e espera o build terminar (uns 30 segundos).
4. Ele copia o endereço que aparece, algo como `https://instagram-webhook.SEU-NOME.workers.dev`, e cola aqui. O endereço não é segredo.

Confira o endereço (troque pelo que o aluno colou):

```bash
U="<endereço que o aluno colou>"
curl -s -w ' %{http_code}\n' "$U/?hub.mode=subscribe&hub.verify_token=instagram-claude&hub.challenge=12345"
curl -s -o /dev/null -w '%{http_code}\n' "$U"
```

- `12345 200` e depois `403`: certo. O primeiro imita a verificação da Meta; o segundo é quem abre o endereço sem ser a Meta.
- `Hello World` ou `200` nos dois: subiu o código padrão, falha conhecida da Cloudflare. Ele apaga o Worker em **Workers & Pages** e clica no botão de novo.
- `523` ou `1010`: espere um minuto e confira de novo.

## 11b. Ligar o endereço no app da Meta (você faz pelo MCP)

O aluno não precisa mexer no painel para isso: você cadastra o endereço pelo MCP da Meta. O "Verificar token" é `instagram-claude`, igual para todo mundo e não é segredo: pode aparecer no chat.

1. **Veja o que já existe.** `devtools_webhook_list` com `action: "list_subscriptions"` e o `app_id` do app da etapa 2.
   - Sem assinatura do tópico `instagram`: siga.
   - Já tem o tópico `instagram` com **outro** endereço: mostre ao aluno o endereço atual (vem cortado, só o começo) e explique que o app só aceita um. Trocar desliga o que usa o endereço antigo (outra automação, por exemplo). Só siga com o "pode" dele.
2. **Explique e peça o "pode".** "Vou cadastrar no seu app o endereço `<endereço>` para receber os avisos de mensagens (campo `messages`). Posso?"
3. **Cadastre.** `devtools_webhook_manage` com `action: "subscribe"`, `app_id`, `topic: "instagram"`, `callback_url: "<endereço>"`, `verify_token: "instagram-claude"` e `fields: ["messages"]`. A primeira chamada não faz nada: ela devolve um resumo e um `confirm_token`. Mostre o resumo ao aluno e, com o "sim", chame de novo com os **mesmos** argumentos e o `confirm_token`.
4. **Confira.** `list_subscriptions` de novo: o tópico `instagram` com o endereço dele, o campo `messages` e `enabled: true`.
5. **A chave da conta (painel).** Essa o MCP não liga. O aluno abre o painel do app (https://developers.facebook.com/apps, o app da etapa 2) > **Casos de uso > Instagram > Personalizar > API setup with Unified login** (em alguns apps, "API setup with Instagram login"). No passo **2**, na linha da conta do Instagram, a coluna **"Assinatura do webhook"** tem que dizer **Ativado**. Se disser outra coisa, ele clica para ativar. Peça para ele dizer o que aparece.

O passo **4, "Conclua a análise do app"**, não precisa: app que só opera a conta da própria empresa dispensa a análise. Diga isso ao aluno antes que ele se assuste.

**Se o MCP falhar:**
- **"não conseguiu validar" o endereço:** confira de novo com o `curl` do 11a. Tem que estar inteiro, com `https`.
- **MCP da Meta indisponível:** o aluno faz no painel. No passo **3, "Configurar webhooks"**, cola o endereço em **URL de callback** e escreve `instagram-claude` em **Verificar token**. Depois clica em **Verificar e salvar** e assina **`messages`** na lista.

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
