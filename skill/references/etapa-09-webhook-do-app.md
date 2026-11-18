# Etapa 9: webhook do app (automático)

O ManyCraft assina o webhook do app sozinho na etapa 11, ao Conectar ou Atualizar conexão. Ele usa o ID do app e a chave secreta que a pessoa cola: tópico `instagram`, a URL de retorno e o token de verificação do próprio ManyCraft, e os campos messages, messaging_postbacks, messaging_seen, messaging_referral, message_reactions, message_edit, comments, live_comments, mentions e standby.

Aqui você só confere uma coisa antes: `devtools_webhook_list list_subscriptions`.
- **Sem tópico `instagram`, ou já com a URL do ManyCraft:** siga para a etapa 10.
- **Com o tópico `instagram` apontando para outro sistema:** o ManyCraft não sobrescreve. Pergunte ao aluno se pode trocar e, com o "pode", use `devtools_webhook_manage subscribe` com a URL e o token de verificação da tela do canal no ManyCraft.

## Como saber que deu certo

Depois da etapa 11, o item **Webhook** da conferência aparece como Ok.
