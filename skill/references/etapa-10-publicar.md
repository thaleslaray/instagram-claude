# Etapa 10: publicar o app

Com o app em desenvolvimento, a Meta só avisa de DMs de quem tem papel no app. Para clientes reais, o app precisa estar publicado.

## Passo a passo

1. Pelo MCP (`devtools_app basic_settings`), confira URL de privacidade, URL de exclusão de dados, categoria e ícone. O MCP não edita esses campos: o aluno preenche em Configurações do app → Básico (https://developers.facebook.com/apps/<APP_ID>/settings/basic/). O ícone precisa ter 1024 × 1024 px.
2. O aluno abre https://developers.facebook.com/apps/<APP_ID>/go_live/ e clica em **Publicar**.

## Como saber que deu certo

`devtools_app basic_settings` devolve `app_status: live_mode`.
