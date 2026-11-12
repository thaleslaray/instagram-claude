# Etapa 0: antes de começar

Confira os pré-requisitos com o aluno, um por um. Não siga enquanto algum faltar.

## O que o aluno precisa ter

1. **Claude Desktop instalado** (provado no Mac). A extensão da etapa 9 foi feita para Mac e Windows, mas só foi provada no Mac. Se o aluno usa **Windows**, leia `references/windows.md` e diga isso a ele com franqueza. Ele **não precisa instalar Node**: a extensão roda com o Node que já vem dentro do Claude Desktop.
2. **Uma conta de Instagram profissional** (comercial ou criador de conteúdo) **e pública**. A Meta só gera token para conta profissional e pública. Se a conta for pessoal, o Instagram oferece converter na hora de adicionar. Recomende uma conta que nunca foi ligada a outro app.
   - **Aviso do caso real:** algumas contas a Meta não deixa responder DM pela API, e não achamos a causa. O sinal é o erro `(#10)` "fora do período permitido" **segundos depois** de a pessoa escrever, e o perfil dela devolvendo `(#230) User consent is required`. Se acontecer na etapa 9, a saída é usar outra conta. Não afirme causa nenhuma (nem conta nova, nem tipo de conta).
3. **O acesso às mensagens ligado na conta.** Peça ao aluno, no app do Instagram no celular, com a conta que vai ser conectada: **Configurações > Tipo e ferramentas da conta > Ferramentas de mensagens > Controle de mensagem > Permitir acesso às mensagens**, ligado. Conta nova vem com isso desligado, e sem ele a etapa 8 devolve o erro `(#200)`. (A documentação da Meta cita outro caminho, "Connected Tools", que não bate com o app atual.)
4. **Um portfólio empresarial na Meta** (antes chamado Business Manager) em que ele seja administrador. Ele confere em https://business.facebook.com/. Se não tiver nenhum, na etapa 3 você cria um pelo MCP.
5. **O MCP da Meta instalado e com acesso ao portfólio.** Ele é a ponte que deixa você criar o app por conversa, sem clicar em dezenas de telas. Confira agora, na seção "Conferir o MCP da Meta" abaixo, e não deixe para a etapa 2: se faltar, o aluno instala e reinicia o Claude antes de começar, sem perder o fio no meio.
6. **Estar logado na Meta** (Facebook de desenvolvedor) e, em outra aba, **no Instagram da conta que vai ser conectada**.

## Conferir o MCP da Meta (você confere, nesta ordem)

1. **Está instalado?** Tente `devtools_app_list` (só leitura). Se a ferramenta não existir, o aluno roda no terminal:
   ```bash
   claude mcp add --transport http meta-social https://mcp.facebook.com/devtools
   ```
   Depois fecha e abre uma sessão nova do Claude Code, digita `/mcp`, escolhe `meta-social` e entra com a conta de desenvolvedor da Meta. Na tela de consentimento, marca **Gerenciamento** (não só Leitura), **business_management** e os portfólios que vai usar. Documentação: https://developers.facebook.com/documentation/mcp/devtools-mcp
   - Se aparecer "It looks like this app isn't available", a Meta ainda não liberou o MCP para essa conta. Siga sem ele: a etapa 2 vai pelo painel (2d).
2. **Responde?** `devtools_app_list` devolve uma lista (mesmo vazia) sem erro.
3. **Enxerga o portfólio?** Chame `devtools_business_list` (só leitura).
   - Lista vazia: faltou marcar `business_management` ou o portfólio no consentimento. O aluno refaz pelo `/mcp`.
   - O portfólio que ele vai usar aparece com `can_add_assets: true`: ótimo, anote o `business_id`.
   - Ele não tem portfólio nenhum: o portfólio vai ser criado na etapa 3. Para isso a Meta exige nome e sobrenome, e-mail, **site** e **endereço** (rua, cidade e país com 2 letras; CEP e estado são opcionais): peça agora para ele ter em mãos.
   - Ele já tem vários portfólios: a Meta limita quantos uma pessoa pode criar ("You have reached the limit for the number of Businesses you can create at this time"). Para quem já tem muitos, use um existente em vez de criar outro.

## Pergunte e anote (sem escrever em arquivo)

- O @ da conta do Instagram que será pilotada.
- Um e-mail de contato para o app.
- Um nome para o app: **até 30 caracteres e sem marca da Meta** (nada de Instagram, Insta, Gram, Facebook, FB, Face, Book). Exemplo: "Meu Piloto de DMs".

## Como saber que deu certo

O aluno confirma os itens, o acesso às mensagens está ligado, o `devtools_business_list` mostra o portfólio dele (ou ficou decidido criar um, com site e endereço em mãos), e você tem o @, o e-mail e o nome do app.
