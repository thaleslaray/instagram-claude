# Etapa 5: criar a configuração do login unificado, com as 8 permissões

Aqui o aluno decide o que o Claude vai poder fazer na conta. Marcar as 8 permissões agora evita voltar depois, porque **permissão nova obriga a gerar um token novo**.

## Passo a passo

1. O aluno abre este link (troque `<APP_ID>` e `<ID_DO_PORTFOLIO>`):

   https://developers.facebook.com/apps/<APP_ID>/use_cases/customize/?use_case_enum=INSTAGRAM_BUSINESS&product_route=instagram-business&selected_tab=Unified-Login-API-Setup&business_id=<ID_DO_PORTFOLIO>

   A tela demora. Espere uns 10 segundos.

2. No topo, a Meta avisa que a configuração com login do Instagram não está disponível para apps recentes e que o app usa o **login unificado**. É o esperado. O menu da esquerda mostra "API setup with Unified login". É essa aba.

3. No card **"1. Configure seu app"**, clicar em **Criar nova configuração**. Abre "Confirmar detalhes da configuração de login" com estes valores (não precisa mudar nada além das permissões):
   - Variação de login: **Geral**
   - Token de acesso: **Token de acesso do usuário do sistema**
   - Expiração: **O token nunca expira**
   - Ativos: Contas do Instagram, Contas de anúncios
   - Aviso da Meta: "As permissões no acesso padrão só serão solicitadas a pessoas com funções neste app." Isso é bom: só o aluno usa.

4. Clicar em **Criar do modelo**. Não precisa preencher URL de redirecionamento: ela só serve para botão de login em site.

5. Na configuração criada ("Selecionado", com o selo "Compatível com o Login do Instagram"), clicar em **Prévia**, depois em **Editar permissões**. Abre "Selecionar permissões", com uma caixa **"6 permissões selecionadas"**. Clicar na caixa para abrir a lista.

6. Deixar marcadas e **marcar as que faltam**, até ficarem as 8:
   - `ads_management`
   - `ads_read`
   - `instagram_basic` (obrigatória, não dá para desmarcar)
   - `instagram_manage_messages` (obrigatória, não dá para desmarcar)
   - `instagram_manage_comments`
   - `instagram_content_publish`
   - `instagram_manage_insights` (números da conta e dos posts)
   - `instagram_manage_events`

   Possível armadilha: clicar numa opção alterna a marca, e uma tentativa pode não pegar (já aconteceu com `instagram_manage_insights`; na rodada mais recente o clique pegou de primeira em cada opção). Confira se ficou marcada; se não, clique de novo.

7. Apertar **Esc** para fechar a lista. A caixa deve dizer **"8 permissões selecionadas"**. Clicar em **Salvar**.

## É uma lista só

São **8 permissões, sem alternativa**. Não ofereça "tirar as de anúncio" nem outra versão da lista: na rodada de teste isso gerou confusão. As de anúncio (`ads_management` e `ads_read`) vêm no modelo; o aluno não as usa agora, mas ficam marcadas. Na hora de gerar o token (etapa 8) a conta de anúncios fica em branco.

## Como saber que deu certo

Ao reabrir **Prévia**, a lista mostra as 8 permissões, a variação "Geral", token de usuário do sistema e expiração "Nunca". Peça ao aluno para ler as permissões em voz alta (ou copiar só os nomes).
