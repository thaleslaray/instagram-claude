# Etapa 2: conectar o MCP da Meta e criar o app

## 2a. MCP da Meta

Já conferido na etapa 0. Se o MCP não está disponível para a conta, vá direto para 2d.

## 2b. Escolher o nome e o e-mail

Use o que você anotou na etapa 0. Lembre: até 30 caracteres, sem Instagram, Insta, Gram, Facebook, FB, Face, Book.

## 2c. Criar o app (confirmação em duas etapas)

1. Chame `devtools_app_create` com `name` e `contact_email`. **Essa primeira chamada não cria nada.** Ela devolve um resumo e um `confirm_token`.
2. Mostre o resumo ao aluno e explique, em palavras simples:
   - O app nasce em **modo de desenvolvimento**, sem nada configurado. Só o aluno e quem ele convidar usam.
   - **Confirmar significa aceitar os Termos da Plataforma da Meta e as Políticas de Desenvolvedor.** É uma decisão dele, não sua.
   - Limite da Meta: 15 apps ou portfólios criados por dia (recusar a confirmação também conta).
3. Pergunte: "Posso confirmar a criação do app chamado X?" Só chame de novo, com o `confirm_token`, depois do "pode" dele.
4. Guarde o `app_id` que voltar. Você vai usar nas próximas etapas. A chave secreta do app nunca volta pelo MCP, e não é preciso para este curso.

## 2d. Caminho só pelo painel (se o MCP da Meta não estiver disponível)

**Só use este caminho se o MCP da Meta estiver indisponível** (não instalado, sem liberação da Meta, ou `devtools_app_create` falhou). Com o MCP funcionando, crie sempre pelo 2c.

O aluno abre https://developers.facebook.com/apps/ e clica em **Criar app**. As regras de nome valem as mesmas. No caso de uso, escolhe **Gerenciar mensagens e conteúdo no Instagram**, e liga o app ao portfólio. Guie a tela de cada vez, pedindo para ele descrever o que aparece. Anote o ID do app, que aparece na barra de endereço depois de `/apps/`.

## Como saber que deu certo

O painel do app abre no link abaixo (troque `<APP_ID>`) e mostra "Não publicado":

https://developers.facebook.com/apps/<APP_ID>/dashboard/

Sem a etapa 3 feita, o menu ainda não mostra casos de uso. Isso é normal.
