# Etapa 9: instalar a extensão do Instagram e testar

A extensão do Instagram é a ponte que deixa o Claude ler e operar a conta. Ela se instala no **Claude Desktop** e vale no chat e na aba Code. O token é colado num campo seguro da tela da extensão, e o Claude Desktop o guarda no cofre do computador. Não tem terminal nem arquivo de configuração no caminho.

## 9a. Conseguir a extensão

Se o aluno instalou pelo prompt do README, o arquivo já está em `~/Downloads/instagram-mcp.mcpb`. Confira com `ls ~/Downloads/instagram-mcp.mcpb`.

Se não estiver lá, ele baixa o `instagram-mcp.mcpb` da última versão em https://github.com/thaleslaray/instagram-claude/releases/latest. Não use outro endereço de download.

## 9b. Instalar

1. Dois cliques no arquivo `instagram-mcp.mcpb`. Ou: arrastar o arquivo para **Claude Desktop > Configurações > Extensões**.
2. O Claude Desktop avisa que o pacote não tem assinatura. **Isso é esperado.** O aluno confirma a instalação.
3. Na tela **"Configurar Instagram"**, preencher:
   - **Token do Instagram**: Cmd+V (o token que ele copiou na etapa 8 ainda está na área de transferência). No Windows, Ctrl+V.
   - **IG ID da conta**: o número que ele anotou na etapa 8.
   - **"Opcional (etapa 10): chave pública do Uploadcare"**: é **um** campo só. Deixar **em branco**. Ele só serve para publicar foto que está no computador (etapa 10, opcional).
4. Salvar.
5. **Feche o Claude Desktop por completo** (Cmd+Q) e abra de novo. Só fechar a janela não basta. Depois, use sempre uma **conversa nova**: conversa antiga continua com a versão velha da extensão (ou nem enxerga a extensão).

**Atualizar a extensão:** abra o arquivo novo por cima, depois Cmd+Q e conversa nova, como acima. O número da versão aparece no rodapé do cartão, embaixo à direita (por exemplo, v0.4.10). Se a tela de configuração vier com campos diferentes dos três acima, é a configuração de uma versão antiga: cancelar, desinstalar o Instagram em **Configurações > Extensões** e abrir o arquivo de novo.

**Nome repetido:** não pode existir outro servidor chamado `instagram` na mesma sessão (por exemplo, um antigo instalado à mão pelo professor). Com dois, os dois perdem o cartão de confirmação. Se o aluno nunca instalou nada do Instagram, isso não se aplica.

## 9c. Conferir a conta

Peça ao aluno para abrir uma **conversa nova** (chat ou aba Code), depois do Cmd+Q do passo 9b, e dizer: "use ig_conta". Tem que voltar o @ da conta certa.

## 9d. Teste de DM recebida

1. O aluno pega o celular, entra em **outro perfil** (de um amigo ou o pessoal) e **manda uma DM para a conta conectada**.
2. Peça: "liste minhas conversas do Instagram". Esperado: a conversa nova com a mensagem.
3. Se vier **lista vazia**: a mensagem caiu em **Solicitações** ou **Pedidos ocultos**, porque a conta não segue o outro perfil, e a API não lista a conversa enquanto ela está lá. O aluno abre o Direct da conta no celular, olha **Solicitações** e **Pedidos ocultos**, aceita o pedido e você pede a lista de novo. (Seguir o perfil de teste antes de ele mandar a mensagem também evita isso.)

## 9e. Responder pelo Claude

Peça: "responda a DM do @fulano com: Oi, funcionou!" (troque pelo @ do outro perfil). Aparece o **cartão** de confirmação:
- "Para: @fulano";
- o texto numa caixa que **o aluno pode editar**, com o contador de tamanho;
- os botões **Cancelar** e **Enviar**.

O aluno **fica na conversa até o cartão aparecer e até ele mostrar "Pronto"**. Clica em **Enviar uma vez**. Se o cartão sumir e voltar, **não clica de novo**: ele mostra "Este pedido já foi enviado". Você nunca confirma por ele, e nunca pede o código de confirmação a ele. A resposta chega no celular do outro perfil.

A Meta só deixa responder depois da primeira mensagem da pessoa, e dentro de 24 horas dela.

## Como saber que deu certo

A resposta enviada pelo cartão chega no outro perfil, no celular.

## Se der erro

| O que aparece | O que fazer |
|---|---|
| `(#10)` "Essa mensagem foi enviada fora do período permitido" (código 10, subcódigo 2534022) | A pessoa escreveu há mais de 24 horas: peça uma mensagem nova dela e tente de novo. **Se o erro vem segundos depois da mensagem**, é o bloqueio de conta descrito na etapa 0: teste com outra conta. |
| A conversa não aparece na lista | Está em Solicitações ou Pedidos ocultos (passo 9d.3). |
| O cartão não aparece, só texto | Versão antiga da extensão (desinstalar e abrir o arquivo de novo, passo 9b) ou dois servidores com o mesmo nome `instagram` (passo 9b). |
| "Não foi possível carregar este widget" | Cmd+Q no Claude Desktop, abrir de novo e usar uma conversa nova. |
| O cartão vira texto cru, com o campo `se_o_cartao_nao_apareceu` | Nada foi enviado. Peça a prévia de novo. Se repetir, Cmd+Q e conversa nova. |
| O cartão mostra "Este pedido já foi enviado" | Já foi enviado. Não clique de novo. Confira no celular. |
| `(#10)` "account type is not business or creator" | A conta é pessoal. Converter para profissional nas configurações do Instagram. |
| `(#200)` "owner has disabled access to Instagram Direct Messaging Outside of Instagram App" | Ligar **Permitir acesso às mensagens** (etapa 0, item 3). |
| `(#10)` "App is missing the instagram_manage_messages permission" | A configuração do app está sem a permissão. Voltar à etapa 5 e gerar token novo na etapa 8; depois colar o token novo na tela de configuração da extensão. |
| Token inválido no "API integration helper" do painel | Ignorar o helper: ele só entende token de outro tipo de login. Use a conferência da etapa 8b ou peça "use ig_estado_do_token". |
