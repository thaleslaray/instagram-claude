# Etapa 6: testador do Instagram e aceite do convite

Com o app em desenvolvimento, só quem é "testador do Instagram" pode gerar token para a conta.

## 6a. Convidar a conta

1. No painel, no mesmo link da etapa 5, card **"2. Gerar tokens de acesso"** (botão **Ver mais**). Aparece "Adicione uma conta do Instagram para gerar tokens de acesso" e o botão **Adicionar conta**.
2. Clicar em **Adicionar conta**. A Meta avisa: só conta profissional, e **só gera token para conta pública**. Clicar em **Continuar**.
3. Em vez de abrir login do Instagram, abre o diálogo **"Adicionar pessoas ao seu aplicativo"**. Marcar **Testador do Instagram** (fica em "Funções adicionais para este app").
4. Clicar no campo "Insira o nome de usuário da conta do Instagram...", digitar o @ da conta **sem o arroba**.
5. **A sugestão aparece logo abaixo do campo. Clicar na sugestão** (ela fica marcada) e só então clicar em **Adicionar**. Se apertar Adicionar sem selecionar a sugestão, não adiciona.

Armadilha: esse diálogo pode **fechar sozinho**, às vezes logo depois de digitar. Se fechou, nada foi adicionado. Refaça tudo: Adicionar conta, Continuar, Testador do Instagram, digitar, escolher a sugestão, Adicionar.

## 6b. Conferir o convite

O aluno abre (troque `<APP_ID>`): https://developers.facebook.com/apps/<APP_ID>/roles/roles/

Deve aparecer a conta como **Testador do Instagram, Pendente**.

## 6c. Aceitar o convite no Instagram

1. O aluno abre, logado **na conta de teste**: https://www.instagram.com/accounts/manage_access/?tab=tester
2. O convite aparece com o nome do app e o sufixo **"-IG"** (por exemplo "Meu Piloto de DMs-IG"). Clicar em **Aceitar**. (A tela diz que ao aceitar ele concorda com os Termos da Plataforma da Meta. Explique isso antes.)

## Como saber que deu certo

- Na página de funções (link da 6b), o status deixou de ser Pendente.
- Voltando ao card "2. Gerar tokens de acesso" (Ver mais), a conta aparece numa tabela com o @, o **ID da conta** (um número grande, que você anota com o aluno) e o link **Gerar token**. **Não clique em Gerar token ainda.** Primeiro a etapa 7.
