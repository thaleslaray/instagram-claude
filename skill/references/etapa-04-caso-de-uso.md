# Etapa 4: adicionar o caso de uso do Instagram

O caso de uso diz à Meta para que o app serve e quais permissões ele pode pedir.

## Passo a passo

1. (Opcional, só leitura) Chame `devtools_app_use_cases` com `list_available`. Procure **INSTAGRAM_BUSINESS** ("Manage messaging & content on Instagram").
   - Não confunda com FACEBOOK_MESSAGING (Messenger com Página).
2. Chame `devtools_app_use_cases_manage` com `use_case_key: INSTAGRAM_BUSINESS`. A primeira chamada devolve um resumo e um `confirm_token`.
3. Explique ao aluno: **"Depois de adicionado, a Meta não deixa remover este caso de uso do app."**
4. Pergunte: "Posso adicionar o caso de uso do Instagram?" Só confirme depois do "pode".

## Aviso para o aluno

Junto com o caso de uso, o menu lateral do painel passa a mostrar também **"Login do Facebook para Empresas"**. Ninguém pediu, veio junto. É normal, ignore.

## Como saber que deu certo

O resultado traz `added_use_case: INSTAGRAM_BUSINESS`. No painel (https://developers.facebook.com/apps/<APP_ID>/dashboard/) aparece o cartão "Personalizar o caso de uso 'Gerenciar mensagens e conteúdo no Instagram'".
