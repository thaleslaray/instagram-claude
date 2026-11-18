# Etapa 10 (opcional): publicar foto que está no seu computador (Uploadcare)

**Quem só quer DM, comentário e vídeo pula esta etapa.** Vídeo do computador e mídia de DM já funcionam sem nada disso. Esta etapa só serve para publicar **foto que está no seu computador** (post, carrossel ou story de foto).

Por que precisa: para publicar uma foto, a Meta baixa a imagem de um endereço público. O Uploadcare guarda a foto por pouco tempo, só para a Meta baixar. Ela some sozinha em 24 horas. Cada aluno cria a própria conta.

Se você tem Reels, a capa pode ser um instante do próprio vídeo (`capa_ms`), e isso também dispensa esta etapa.

## 10a. Criar a conta no Uploadcare

1. Abra https://uploadcare.com e crie a conta (pode entrar com o Google).
2. **Não cadastre cartão.** A conta nova começa com 14 dias de teste do plano pago ("Pro trial"). Sem cartão, ela volta sozinha para o plano grátis no fim. Com cartão, vira plano pago.

## 10b. Copiar a chave pública

1. No Uploadcare, no menu da esquerda, clique em **API keys**.
2. No quadro **Public key**, clique em **Copy**.
3. A tela tem este endereço: `app.uploadcare.com/projects/<sua chave>/api-keys/`.

Essa chave **não é segredo** (a própria tela diz que pode ficar visível). Não ligue "Signed Uploads". Não gere chave secreta.

## 10c. Colar na extensão

1. Abra o **Claude Desktop**, vá em **Configurações > Extensões** e abra a extensão **Instagram**. Procure o botão de configurar dela.
2. No campo **"Opcional (etapa 10): chave pública do Uploadcare"**, cole a chave (Cmd+V).
3. Salve.
4. **Cmd+Q** no Claude Desktop e abra de novo. Só salvar não basta: o Claude continua com a versão antiga até você fechar o app por completo.
5. Abra uma **conversa nova**.

## 10d. Testar

1. Na conversa nova, peça: "faça a prévia de um post com a foto <caminho da foto no computador>".
2. Espere o cartão aparecer. Confira a miniatura da foto.
3. Para só testar, clique em **Cancelar**. Se quiser publicar de verdade, clique em **Publicar** **uma vez** e espere o "Pronto".

## Como saber que deu certo

O cartão aparece com a **miniatura da foto**, sem a recusa pedindo para colar a chave.

## Se der erro

| O que aparece | O que fazer |
|---|---|
| Recusa pedindo para "colar a chave pública do Uploadcare (etapa 10)" | Três causas comuns: a chave não foi salva (volte ao 10c e confira o campo), você salvou mas não fez Cmd+Q, ou está numa conversa antiga. Cmd+Q, abra o Claude Desktop e use uma conversa nova. |
| A recusa continua com a chave salva | Confira se colou a chave **pública** (20 letras e números, sem espaço) e não outra coisa. |
| O cartão não desenha, só texto | Veja a tabela da etapa 9. |
| O Uploadcare pede cartão | Pule o cartão. Não cadastre nenhum. |
