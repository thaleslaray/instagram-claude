# Etapa 11: conectar no ManyCraft

## Passo a passo

1. No ManyCraft: Configurações → Canais → **Instagram** → Conectar (ou, se o canal já existe, **Trocar credencial**).
2. O aluno cola o **ID da conta**, o **token** (da etapa 8, ainda na área de transferência) e a **chave secreta do app**. A chave fica em Configurações do app → Básico → Chave secreta → Mostrar (https://developers.facebook.com/apps/<APP_ID>/settings/basic/). Nada disso passa pelo chat.
3. Clicar em **Conectar** ou **Atualizar conexão**.

O ManyCraft faz sozinho: confere a chave secreta, **assina o webhook do app**, inscreve a conta do Instagram e **inscreve a Página do Facebook** no app (era o passo que faltava no caso real). Quando chega DM de conversa presa em outro app (aviso "standby"), ele pede o controle da conversa sozinho.

## Como saber que deu certo

A conferência da conexão mostra:
- **Token de acesso**: Ok
- **Chave secreta do app**: Ok. Se der pendente, a chave não é do app que gerou o token.
- **Página do Facebook**: Ok. Se der pendente, o texto diz o que falta: permissão de Página (volte às etapas 4 e 5 e gere outro token), Página não marcada no token (volte à etapa 8) ou inscrição recusada.
- **Mensagens**, **Comentários**, **Webhook**: Ok
- **Encaminhamento de conversas**: aparece sempre como "não conferido". A Meta não deixa ler essa configuração; ela é feita na etapa 12.
