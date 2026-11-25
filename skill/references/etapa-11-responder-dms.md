# Etapa 11 (opcional): responder DMs de qualquer pessoa

**Quer que o Claude responda DMs de qualquer pessoa, não só de quem é testador do app? Então faça esta etapa.** Quem só lê DMs, comenta, publica ou vê números pula esta etapa.

Por que precisa: a Meta só deixa o app responder uma DM se a conta estava com a **"Assinatura do webhook"** ligada quando a mensagem chegou. Webhook é um endereço na internet que a Meta avisa toda vez que chega mensagem. Para ligar a assinatura, a Meta exige esse endereço. Sem ele, a resposta falha com o erro `(#10)` "fora do período permitido", mesmo dentro de 24 horas. E o app precisa estar publicado (11c): em desenvolvimento, a Meta só manda esse aviso para quem tem papel no app.

O endereço sai de um botão, de graça, na conta da Cloudflare do aluno. Ele só responde "ok" para a Meta: não guarda nem lê nenhuma mensagem. Ele também serve o que a Meta pede para publicar o app (11c): as páginas de política de privacidade e de exclusão de dados, e um ícone pronto. O Claude continua lendo e respondendo pela extensão, como na etapa 9.

## 11a. Criar o endereço (botão da Cloudflare)

O aluno precisa de conta grátis na Cloudflare (sem cartão) e de conta no GitHub. Explique: a Cloudflare é onde o endereço vai morar; o GitHub é onde ela guarda uma cópia do código do endereço. Ele não vai mexer em código nenhum. Se não tiver, ele cria agora em https://dash.cloudflare.com/sign-up e https://github.com/signup.

1. Mande o link do botão: https://deploy.workers.cloudflare.com/?url=https://github.com/thaleslaray/instagram-claude/tree/main/webhook
2. Ele entra na Cloudflare. Se tiver mais de uma conta lá, aparece primeiro "Select an account to continue": ele clica no nome da conta. Em **Git account**, escolhe a conta do GitHub dele. Na primeira vez, clica em **New GitHub connection** e autoriza; no GitHub, escolhe **All repositories** (com "Only select repositories" o app pode não alcançar o repositório novo). A Cloudflare cria uma cópia do projeto no GitHub dele; isso é esperado. Marcar **Create private Git repository** é opcional.
3. O campo **`VERIFY_TOKEN`** já vem com `instagram-claude`: deixar como está, e o resto também. Ele clica em **Deploy** e espera o build terminar (uns 30 segundos).
4. Ele copia o endereço que aparece, algo como `https://instagram-webhook.SEU-NOME.workers.dev`, e cola aqui. O endereço não é segredo.

Confira o endereço (troque pelo que o aluno colou):

```bash
U="<endereço que o aluno colou>"
curl -s -w ' %{http_code}\n' "$U/?hub.mode=subscribe&hub.verify_token=instagram-claude&hub.challenge=12345"
curl -s -o /dev/null -w '%{http_code}\n' "$U"
```

- `12345 200` e depois `403`: certo. O primeiro imita a verificação da Meta; o segundo é quem abre o endereço sem ser a Meta.
- `Hello World` ou `200` nos dois: subiu o código padrão, falha conhecida da Cloudflare. Ele apaga o Worker em **Workers & Pages** e clica no botão de novo. Na segunda vez, em **Project name**, ele usa outro nome (por exemplo `instagram-webhook-2`), para não bater no repositório que a primeira tentativa criou no GitHub dele.
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

## 11c. Publicar o app (modo Live): obrigatório

Sem publicar, esta etapa não funciona. A Meta só manda o aviso de mensagem (webhook) com o app **publicado** (Live). Em desenvolvimento, o aviso só vem de quem tem papel no app, como o testador da etapa 7. Sem aviso, a DM de quem não tem papel não fica liberada, e a resposta falha com o mesmo `(#10)`.

Publicar **não** é a análise do app (App Review). É só uma chave no painel. App que opera só a conta da própria empresa continua sem precisar de análise.

1. **Veja o modo.** `devtools_app` com `action: "basic_settings"` e o `app_id`. Se vier `is_live: true`, o app já está publicado: pule para o 11d.
2. **Preencha o que a Meta exige.** App novo só publica com quatro coisas, todas em **Configurações do app > Básico** (https://developers.facebook.com/apps/<APP_ID>/settings/basic/). Enquanto faltar alguma, o topo da página diz "Não qualificado para envio no momento" e lista o que falta.
   - **URL da Política de Privacidade**: `<endereço>/privacidade`, a página que o endereço do 11a já serve. Antes, abra o link com o aluno e mostre o que ela diz: que o app é usado só por ele, que as respostas saem com a ajuda do Claude, aprovadas uma a uma, e que para pedir exclusão basta mandar DM para a conta. Use com o "pode" dele. Se ele já tem política de privacidade no site dele, pode usar a dele.
   - **URL de instruções de exclusão de dados** (em "Exclusão de dados do usuário"): `<endereço>/exclusao-de-dados`.
   - **Ícone do app (1024 x 1024)**: ele abre `<endereço>/icone.png`, salva a imagem no computador (botão direito > Salvar imagem) e arrasta para o campo **Ícone do app**. Abre "Cortar o ícone do app": ele clica em **Carregar**. Se preferir, pode usar a logo dele, quadrada.
   - **Categoria**: ele escolhe **Negócio e Páginas**. Atenção: o `basic_settings` do MCP mostra `category: "ALL"` mesmo quando nenhuma foi escolhida. Não confie nesse campo: confie na lista do "Não qualificado".
   - Ele clica em **Salvar alterações** e recarrega a página. O aviso "Não qualificado" tem que sumir.
   - Se `<endereço>/privacidade` ou `<endereço>/icone.png` der `forbidden`, o Worker é de antes dessas páginas: ele apaga o Worker e clica no botão do 11a de novo, com outro **Project name**.
3. **Explique e peça o "pode".** Diga assim: "Publicar faz o app valer para quem não tem papel nele. O app continua ligado só à sua conta do Instagram." Com o "pode", ele abre https://developers.facebook.com/apps/<APP_ID>/go_live/ (é o **Publicar** do menu da esquerda), confere o caso de uso listado e clica no botão **Publicar**. Em apps mais antigos não existe essa página: a chave **Modo do app** fica no topo, e ele clica nela para passar de "desenvolvimento" para **Ao vivo** e confirma.
4. **Se o painel recusar,** ele mostra o que falta. Ele preenche e tenta de novo.
5. **Confira.** `basic_settings` de novo tem que dizer `is_live: true`.

## 11d. Testar com uma DM nova

1. Alguém que **não é testador** do app manda uma DM **nova** para a conta. Mensagem que chegou antes de ligar a assinatura continua bloqueada para sempre: não adianta testar com ela.
2. Peça ao Claude: "liste minhas conversas do Instagram" e responda essa DM, como na etapa 9e.

## Como saber que deu certo

A resposta enviada pelo cartão chega no celular de uma pessoa que não é testadora do app.

## Se der erro

| O que aparece | O que fazer |
|---|---|
| `(#10)` "fora do período permitido" com DM que chegou **depois** de ligar a assinatura | Confira de novo a chave "Assinatura do webhook" (11b, item 5) e o modo Live (11c). Depois peça outra DM nova. |
| `(#10)` com DM que chegou **antes** de ligar a assinatura | Não tem conserto: peça uma DM nova. |
| A DM de outra pessoa nem aparece na lista | Veja Solicitações e Pedidos ocultos (etapa 9d) e confira o modo Live (11c). |
