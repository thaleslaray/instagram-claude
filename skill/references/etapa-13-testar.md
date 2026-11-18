# Etapa 13: testar

## Passo a passo

1. Peça uma DM para a conta, mandada de um perfil que **nunca conversou** com ela.
   - A conversa que já existia antes fica com o app que era o dono quando ela começou e não muda sozinha. Por isso o teste com um perfil antigo engana.
2. Abra a caixa de entrada do ManyCraft.

## Como saber que deu certo

A conversa aparece na caixa de entrada em poucos segundos.

## Se não aparecer

- Confira no banco: `inbound_events` do canal (`npx wrangler d1 execute manycraft --remote ...`). O `wrangler tail` pula eventos por amostragem, então não decida só por ele.
- Um 401 no registro com `webhook_rejected`:
  - `reason: signature`: a chave secreta no ManyCraft está errada. Volte à etapa 11.
  - `reason: unknown_account` com `accounts:["0"]`: é o aviso de teste da Meta, ignore.
  - `reason: unknown_account` com outro número: a Meta mandou um ID de conta que o canal não tem. Compare com o ID salvo.
- Nenhum aviso chegando: reveja a etapa 12 (app padrão) e se a Página aparece inscrita (`GET /{page-id}/subscribed_apps` com o token da Página).

## O que NÃO era a causa no caso real

| Suspeita | Por que não era |
|---|---|
| Chave secreta errada | A conferência "Chave secreta do app" prova com appsecret_proof |
| URL ou assinatura do webhook | O teste do painel chegava e o ManyCraft aceitava aviso assinado com a chave certa |
| App em desenvolvimento x publicado | Trocar o modo não mudou nada sozinho |
| "Permitir acesso às mensagens" | Se estivesse desligado, a leitura de conversas daria erro (#200) |

Caso real completo: /Users/thaleslaray/Projetos/manycraft/.scratch/instagram-webhook/diario.md
