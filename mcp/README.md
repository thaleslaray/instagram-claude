# instagram-mcp

Servidor MCP local (stdio) para o Claude ler e operar **uma** conta profissional do Instagram pela Graph API oficial da Meta, com o token do login unificado. Testado no macOS. Para instalar sem mexer em código, veja o [README da raiz](../README.md).

Regra de ouro: **publicar, responder e apagar nunca acontecem direto**. A ferramenta mostra uma prévia dentro da conversa (ou uma janela do macOS, de reserva) e só segue depois do seu clique. O token mora no Keychain (ou no campo seguro da extensão) e nunca passa pela conversa.

## O que faz

| Área | Ferramentas |
|---|---|
| Conta | `ig_conta`, `ig_estado_do_token` |
| DMs | `ig_listar_conversas`, `ig_ler_conversa` (com a janela de 24 h), `ig_ver_mensagem`, `ig_perfil_contato`; escrita: `ig_responder_dm`, `ig_enviar_midia_dm`, `ig_reagir_dm` |
| Comentários | `ig_listar_comentarios`, `ig_ver_comentario`, `ig_listar_respostas`; escrita: `ig_responder_comentario`, `ig_comentar_midia`, `ig_responder_no_privado`, `ig_apagar_comentario`, `ig_esconder_comentario`, `ig_ligar_comentarios` |
| Mídias | `ig_listar_midias`, `ig_ver_midia`, `ig_listar_stories`, `ig_listar_marcacoes`, `ig_perfil_publico` (outra conta comercial) |
| Publicação | `ig_publicar_post`, `ig_publicar_carrossel`, `ig_publicar_reels`, `ig_publicar_story`, `ig_status_publicacao`, `ig_limite_publicacao` (vídeo do computador sobe direto para a Meta; foto do computador sobe pelo Uploadcare, com a chave pública opcional) |
| Insights | `ig_insights_conta`, `ig_insights_midia` (com métricas derivadas) |
| Confirmação | `ig_confirmar`, `ig_cancelar` (a tela usa duas ferramentas escondidas do modelo) |
| Roteiros prontos | `ig_relatorio_semanal`, `ig_legenda_e_publicacao`, `ig_triagem_de_comentarios`, `ig_caixa_de_dms`, `ig_pesquisa_concorrentes` |

Cada escrita fica no registro local `~/Library/Logs/instagram-mcp/acoes.jsonl` (sem token e sem URL assinada). Texto de DM, comentário, legenda alheia e bio de outras contas volta dentro de `conteudo_de_terceiros`: é dado, não ordem.

## O que NÃO faz

A API oficial não oferece estas ações, ou elas não valem para este login e estas permissões. O servidor avisa o Claude para dizer "não dá" em vez de tentar outro caminho.

| Não faz | Por quê |
|---|---|
| Curtir ou descurtir post ou comentário | A API existe, mas só no login com Facebook e com uma permissão que este app não tem |
| Seguir ou deixar de seguir | Não existe endpoint |
| Ver feed, stories ou seguidores de outras contas | A API só trata do que a própria conta criou; de contas comerciais, só perfil público e posts |
| Mandar DM para quem nunca escreveu | A Meta só deixa responder depois da primeira mensagem da pessoa (exceção: resposta privada a um comentário) |
| Responder depois de 24 h | A tag Human Agent (7 dias) exige App Review e não está na configuração do app |
| Ler mais que as 20 mensagens mais recentes de uma conversa | Limite da Conversations API |
| Apagar post publicado | Só no login com Facebook, com permissão que o app não tem |
| Buscar por hashtag | Exige App Review (Instagram Public Content Access) |
| Figurinha, link ou enquete em story; enquete na legenda; trial reels; etiqueta de parceria | Não suportados pela API neste login |
| Editar a legenda de um post publicado | Fora da v1 |
| Saber na hora que chegou DM ou comentário | Sem webhooks na v1: o Claude só vê quando consulta |
| Passar a conversa para outro app (handover) | Não suportado no login unificado |

## Antes de instalar: token (e, se quiser, a chave do Uploadcare)

Nada de segredo em arquivo, variável de ambiente ou campo do Claude. Tudo vai para o Keychain do macOS, serviço `instagram-mcp`, e o servidor lê com `security find-generic-password`.

Pré-requisitos: Node 22 ou mais novo, `npm install` dentro da pasta do projeto e `npm run build`.

### Token do Instagram

1. No painel da Meta, gere o token do usuário do sistema (login unificado) e **copie**.
2. No terminal, dentro da pasta do projeto:

```bash
IG_ACCOUNT_ID=<IG ID da conta> npm run guardar-token
```

O script lê a área de transferência (`pbpaste`), confere que o valor começa com `EAA`, grava no Keychain, lê de volta, compara e limpa a área de transferência. Com `IG_ACCOUNT_ID` ele ainda testa na Meta ("Token guardado e funcionando para @…"). Nunca imprime o token.

### Chave pública do Uploadcare (opcional, só para foto do computador)

Vídeo do computador (Reels, story, item de carrossel) e mídia de DM do computador sobem **direto para a Meta**, sem configurar nada. Só a **foto** do computador (post, foto de carrossel, story de foto, capa de Reels em JPEG) precisa de um endereço público para a Meta baixar, e para isso usamos o Uploadcare:

1. Crie uma conta gratuita em uploadcare.com e um projeto.
2. Copie a **chave pública** (Public key) do projeto. Ela não é segredo.
3. Passe como `IG_UPLOADCARE_PUBLIC_KEY` (no `.mcpb`, campo "Opcional (etapa 10)"; no Claude Code, variável da entrada do servidor).

A foto sobe só **depois do seu clique de confirmação**, sem ser guardada (`UPLOADCARE_STORE=0`): o arquivo some sozinho do Uploadcare em 24 horas. O endereço público se calcula a partir da chave (`https://<prefixo>.ucarecd.net/<id>/foto.jpg`, prefixo = 10 primeiros caracteres do SHA-256 da chave em base 36). Sem a chave, o pedido com foto do computador é recusado antes da prévia; URL `https` e vídeo do computador funcionam normalmente.

## Instalar no Claude Code (editando `~/.claude.json`)

Não use `claude mcp add`: a opção `-e` é variádica e engole o nome do servidor. Edite o `~/.claude.json` **com backup**. A entrada não tem token.

Troque `PASTA` pelo caminho absoluto do projeto (ele precisa ficar num lugar fixo, porque o Claude Code aponta direto para o `mcpb/server/index.mjs`) e os valores das variáveis pelos seus. O `IG_UPLOADCARE_PUBLIC_KEY` é opcional: sem ele, só a foto do computador fica de fora (apague a linha dele). O comando grava o caminho completo do `node` (o de `command -v node`, que sobrevive a atualização do Homebrew), porque o app do Claude nem sempre acha o `node` pelo PATH do terminal.

```bash
cp ~/.claude.json ~/.claude.json.bak-$(date +%Y%m%d-%H%M%S)

NODE="$(command -v node)" \
PASTA="$HOME/Projetos/instagram-claude/mcp" \
IG_ACCOUNT_ID="17841400000000000" \
IG_UPLOADCARE_PUBLIC_KEY="<chave pública do Uploadcare, opcional>" \
node -e '
const fs = require("fs");
const arquivo = process.env.HOME + "/.claude.json";
const j = JSON.parse(fs.readFileSync(arquivo, "utf8"));
j.mcpServers = {
  ...j.mcpServers,
  instagram: {
    type: "stdio",
    command: process.env.NODE,
    args: [process.env.PASTA + "/mcpb/server/index.mjs"],
    env: {
      IG_ACCOUNT_ID: process.env.IG_ACCOUNT_ID,
      IG_PERFIL: "completo",
      ...(process.env.IG_UPLOADCARE_PUBLIC_KEY ? { IG_UPLOADCARE_PUBLIC_KEY: process.env.IG_UPLOADCARE_PUBLIC_KEY } : {}),
    },
  },
};
fs.writeFileSync(arquivo, JSON.stringify(j, null, 2) + "\n");
'

claude mcp list   # "instagram" tem que aparecer conectado
```

Se algo der errado, volte o backup (`cp ~/.claude.json.bak-… ~/.claude.json`). Depois de mudar variáveis ou rebuildar, abra uma sessão nova do Claude Code.

## Instalar no Claude Desktop (`.mcpb`)

```bash
npm run pack      # build + instagram-mcp.mcpb (usa @anthropic-ai/mcpb 2.1.2)
```

Dois cliques no `instagram-mcp.mcpb` (ou Claude Desktop → Configurações → Extensões) e preencha:

| Campo | Para quê |
|---|---|
| Token do Instagram (`IG_TOKEN`) | obrigatório; campo seguro, guardado no cofre do computador |
| IG ID da conta (`IG_ACCOUNT_ID`) | obrigatório, só números |
| Chave pública do Uploadcare (`IG_UPLOADCARE_PUBLIC_KEY`) | opcional, só para foto do computador |

A extensão roda sempre com o perfil `completo`. Os outros perfis (abaixo) valem só na instalação pelo Claude Code. Para conferir o pacote sem instalar: `npx -y @anthropic-ai/mcpb@2.1.2 validate mcpb/manifest.json`.

## Modos de uso (`IG_PERFIL`)

| Perfil | O que o Claude enxerga |
|---|---|
| `completo` (padrão) | tudo |
| `leitura` | só leituras: **nenhuma ferramenta de escrita chega a ser registrada** |
| `publicar` | conta, mídias, publicação e comentários |
| `atendimento` | conta, DMs e comentários |

`IG_GRUPOS_SO_LEITURA` trava a escrita de grupos e mantém a leitura deles (grupos: `conta`, `dms`, `midias`, `publicacao`, `comentarios`; exemplo: `IG_GRUPOS_SO_LEITURA=dms,publicacao`).

## Conferir

Os dois leem a configuração do ambiente, então passe as mesmas variáveis do MCP (a do Uploadcare só se você usa):

```bash
IG_ACCOUNT_ID=<IG ID> npm run doctor     # token, conta, permissões e chave do Uploadcare (só lê; sai com 1 se algo falhar)
IG_ACCOUNT_ID=<IG ID> npm run conferir   # leituras reais em v27.0 e v26.0, com tabela no fim (só lê)
```

No `doctor`, a chave do Uploadcare ausente aparece como `AVISO` (opcional, só para foto do computador) e não conta como problema.

`npm run conferir` roda `ig_conta`, `ig_listar_midias` (com e sem `caption`), `ig_listar_stories`, `ig_listar_conversas`, `ig_ler_conversa` da primeira conversa, `ig_perfil_contato`, `ig_listar_marcacoes`, `ig_perfil_publico`, `ig_insights_conta` (`reach`) e `ig_limite_publicacao` em cada versão da Graph, e imprime "ferramenta → ok ou erro traduzido" por versão, marcando qualquer diferença. A saída só tem contagens, nunca texto de DM, e é segura para colar no diário. Opcionais: `IG_CONFERIR_VERSOES` (padrão `v27.0,v26.0`) e `IG_CONFERIR_PERFIL_PUBLICO` (padrão `bluebottle`). Sai com 1 se algum passo errar ou as versões divergirem.

## Configuração

| Variável | Obrigatória | Padrão | Para quê |
|---|---|---|---|
| `IG_ACCOUNT_ID` | sim | — | IG ID da conta (só números). Com o token do usuário do sistema, `/me` não é a conta. |
| `IG_PERFIL` | não | `completo` | Perfil de ferramentas (acima). |
| `IG_GRUPOS_SO_LEITURA` | não | — | Grupos em que só a leitura vale. |
| `IG_UPLOADCARE_PUBLIC_KEY` | para foto do computador | — | Chave pública do Uploadcare (não é segredo). |
| `IG_GRAPH_VERSION` | não | `v27.0` | Versão da Graph em todo caminho. |
| `IG_GRAPH_BASE` | não | `https://graph.facebook.com` | **Só testes.** Aceita apenas a Meta ou `http://127.0.0.1:<porta>`. |
| `IG_TESTE_TOKEN` | não | — | **Só testes/autoteste.** Token falso, aceito somente com a Graph em 127.0.0.1. O token real nunca vai em variável de ambiente. |
| `IG_KEYCHAIN_SERVICO` | não | `instagram-mcp` | **Só testes/autoteste**, com a mesma trava. |

O token vai sempre em cabeçalho, nunca na URL nem no corpo: `Authorization: Bearer` na Graph e `Authorization: OAuth` no envio de vídeo ao `rupload.facebook.com` (o endereço vem da Meta e só é aceito se for desse host).

## Segurança

- **Limpeza de segredos** (`src/segredos.ts`): tudo o que sai (erro devolvido à ferramenta, linha de log no stderr, registro de ações) passa por `limpar()`, que troca os valores do cofre e qualquer `EAA…` por `‹segredo›`. Logs: sempre `log()` de `src/log.ts`.
- **Gravação no Keychain:** o `security add-generic-password -w` corta o valor em 128 caracteres (o token da Meta tem uns 250), por isso os scripts mandam o comando inteiro pela entrada padrão do `security -i` e conferem o que voltou.
- **Confirmação:** o código de confirmação só chega ao Claude depois do clique real; o modelo não consegue chamar a segunda etapa sozinho.

## Desenvolvimento

```bash
npm install
npm test           # testes (node --test), sem rede: o fetch dos testes só deixa falar com 127.0.0.1
npm run typecheck  # tsc
npm run build      # gera mcpb/server/index.mjs (esbuild, arquivo único)
npm run autoteste  # sobe o build por stdio contra a Graph falsa e confere tudo
npm run check      # typecheck + testes + build + autoteste
npm run pack       # build + .mcpb
```

Os testes nunca tocam o Keychain do serviço `instagram-mcp` nem a Meta nem o Uploadcare: usam Graph falsa (com rupload e anexo de DM), Uploadcare falso, cofre em memória e executor falso. Requer Node 22 ou mais novo (os testes rodam os `.ts` direto).

Estrutura: `src/stdio.ts` (entrada), `src/servidor.ts` (fábrica e instruções), `src/ferramentas/` (um arquivo por grupo), `src/graph.ts` (cliente: Bearer, versão, paginação só pelo cursor `after`), `src/erros.ts` (tradução por `code` e `error_subcode`), `src/respostas.ts` (anotações, `structuredContent`, teto de 25.000 caracteres), `src/cofre.ts` e `src/segredos.ts`, `src/hospedagem.ts` (foto no Uploadcare), `src/conferencia.ts` (a lógica do `npm run conferir`), `test/graph-falsa.ts`, `mcpb/manifest.json`.
