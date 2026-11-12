# Etapa 8: gerar o token e conferir

O token é a senha de acesso longa do app à conta. **Vai tudo pela área de transferência do Mac. Você (Claude) nunca vê, nunca pede e nunca lê o token.**

## Regras desta etapa (diga ao aluno antes)

- **Não cole o token aqui na conversa.** Nem faça print dele.
- **Gere e copie o token numa aba normal, aberta por você mesmo** no navegador. Não use aba aberta por automação nem por mim: a aba pode fechar sozinha na hora de copiar, e o token aparece uma vez só. (Já aconteceu: o token se perdeu e foi preciso gerar outro.)
- Se perder o token, não tem problema: clique em **Gerar token** de novo.

## 8a. Gerar

0. **Antes de gerar, anote o ID da conta** (número grande, abaixo do @, no card "2. Gerar tokens de acesso"). Pode copiar e colar aqui na conversa: o ID não é segredo. Faça isso agora porque, depois que o token for copiado, o aluno não pode copiar mais nada até a etapa 9.
1. O aluno abre, numa aba dele, o link da etapa 5 (https://developers.facebook.com/apps/<APP_ID>/use_cases/customize/?use_case_enum=INSTAGRAM_BUSINESS&product_route=instagram-business&selected_tab=Unified-Login-API-Setup&business_id=<ID_DO_PORTFOLIO>) e no card **"2. Gerar tokens de acesso"** clica em **Ver mais**.
2. Na linha da conta, clicar em **Gerar token**. Abre uma janela do **Login do Facebook para Empresas**: "Selecione os ativos de negócios para compartilhar".
3. Preencher:
   - **Portfólio empresarial**: o do app.
   - **Conta do Instagram**: a conta de teste. **Cuidado:** a lista pode mostrar, em "Outros portfólios", contas reais que o seu Facebook administra. Escolha só a conta combinada na etapa 0. Se ela não aparece, volte à etapa 7: a conta ainda não está no portfólio. Feche a janela sem concluir.
   - **Conta de anúncios**: deixar **em branco** (é opcional).
4. Na tela "Reveja o que você vai compartilhar", conferir o portfólio e a conta. A lista de permissões pode não citar mensagens. Não se preocupe, a conferência a seguir mostra se a permissão veio. Clicar em **Confirmar**.
5. Aparece "A empresa ... foi conectada ao ...". Clicar em **Concluir**.
6. De volta ao painel, o token aparece uma vez (na linha da conta, coluna Token). **Copie na hora** (Cmd+C) e **não copie mais nada** até a etapa 9, senão o token sai da área de transferência. Se não encontrar o token na tela, clique em Gerar token de novo.

## 8b. Conferir (o aluno roda no terminal dele)

Com o token ainda na área de transferência, o aluno cola este comando no terminal (troque `<ID_DA_CONTA>` pelo número). No Claude Code ele pode digitar `!` antes do comando para rodar sem sair da sessão. O comando **não mostra o token** na tela:

```bash
T=$(pbpaste); for u in "me/permissions" "<ID_DA_CONTA>?fields=id,username" "<ID_DA_CONTA>/conversations?platform=instagram&limit=1&fields=id"; do echo "== $u"; curl -s "https://graph.facebook.com/v27.0/$u" -H "Authorization: Bearer $T"; echo; done; unset T
```

Peça que ele cole a **saída** (que não tem token) e leia você.

O que esperar:
1. `me/permissions`: `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish`, `instagram_manage_insights` e `instagram_manage_events`, todas com `status: granted` (mais `public_profile`). As de anúncio **não** aparecem, porque não escolhemos conta de anúncios. É normal.
2. `<ID_DA_CONTA>?fields=id,username`: devolve o `id` e o `username` certos.
3. `.../conversations`: devolve `data` (pode ser lista vazia). Não pode dar erro `(#10)` nem `(#200)`. Se der `(#200)` ("The account owner has disabled access to Instagram Direct Messaging Outside of Instagram App"), o acesso às mensagens está desligado na conta: o aluno liga pelo caminho do item 3 da etapa 0 e roda a conferência de novo.

Nota: `me/assigned_instagram_accounts` aparece vazio nesse tipo de token. Por isso o ID é digitado pelo aluno. Não é erro.

Se faltar permissão: o aluno volta à etapa 5, confere que são 8 marcadas e salva, e gera outro token (a permissão nova só vale em token novo).

## Como saber que deu certo

As seis permissões do Instagram aparecem como `granted`, o `username` bate com a conta e a conversa responde sem erro. Aí o aluno **não fecha a aba nem copia mais nada**: o token vai ser colado na extensão na etapa 9.
