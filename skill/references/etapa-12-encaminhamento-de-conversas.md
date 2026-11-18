# Etapa 12: tirar o app antigo e pôr o ManyCraft como padrão

Desde 23/10/2025, o Instagram entrega as DMs ao **app padrão do encaminhamento de conversas** (Conversation Routing). Se outro app for o padrão, como o Manychat, as DMs vão para ele e o ManyCraft não recebe nada, mesmo com tudo verde na etapa 11.

Quem faz esta etapa precisa administrar a Página do Facebook da conta.

## Passo a passo (nesta ordem)

1. **Tirar o app antigo do encaminhamento do Instagram.** Logado no Facebook **como a Página**, abra https://www.facebook.com/settings/?tab=ig_conversation_routing e remova o app antigo.
   - No caso real, este foi **o único lugar que tirou o Manychat do padrão**. Remover do portfólio, das integrações do Facebook ou de "Apps e sites" do Instagram não adiantou.
   - **Não** clique em "Desconectar conta" na tela "Connected Instagram". Isso separa Página e Instagram e quebra o ManyCraft.
2. **Pôr o ManyCraft como padrão.** Abra o Business Suite → Configurações → Integrações → **Encaminhamento da conversa** (https://business.facebook.com/latest/settings/conversation_routing?business_id=<ID_DO_PORTFOLIO>), clique na conta do Instagram e, em **App padrão de encaminhamento**, escolha **ManyCraft**.
   - Se aparecer "Falha ao configurar encaminhamento de conversas", falta a parte de Página: caso de uso Messenger (etapa 4), permissões de Página (etapa 5), token com a Página (etapa 8) ou a Página inscrita (etapa 11). Com isso pronto, a Meta aceita.
3. **Permissões dos apps parceiros.** Na mesma tela, aba **Apps do parceiro**:
   - no **ManyCraft**, ligar "Acesse todas as conversas" e "Assuma o controle das conversas";
   - no app antigo, desligar os dois.
4. **Limpeza.** Business Suite → Integrações → **Apps conectados**: remover o app antigo se o cliente não usa mais.

Você pode ler essas telas pelo navegador para conferir, mas só leia. Trocar o app padrão é decisão do dono da conta.

## Como saber que deu certo

Em Encaminhamento da conversa → conta do Instagram, aparece **App padrão de encaminhamento: ManyCraft**, com o ID do app.
