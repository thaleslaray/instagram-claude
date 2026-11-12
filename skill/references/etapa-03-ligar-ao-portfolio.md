# Etapa 3: ligar o app ao portfólio

No login unificado, o app precisa ter um portfólio empresarial como dono. Sem isso, a aba "API setup with Unified login" nem aparece no painel.

## 3a. Escolher o portfólio

Chame `devtools_business_list`. Mostre os portfólios ao aluno e peça para escolher um com `can_add_assets: true`. Anote o `business_id`.

- Se não aparecer nenhum, falta liberar `business_management` no consentimento do MCP (etapa 2a). Refaça o consentimento em `/mcp`.
- Um portfólio que já tem outro app pode receber o app novo: cada app tem configuração, testadores e tokens próprios. Não precisa limpar nem remover nada do app antigo.
- Se o aluno não tem portfólio nenhum, chame `devtools_business_create` (mesma confirmação em duas etapas da criação do app; conta no limite de 15 por dia). Dados obrigatórios: nome e sobrenome de quem cria, e-mail de contato, site, e endereço com rua, cidade e país com 2 letras. CEP e estado são opcionais. Passe o fuso `America/Sao_Paulo` (se vier vazio, a Meta usa America/Los_Angeles). A primeira chamada devolve o resumo e avisa que o portfólio aceita os Termos Comerciais; só confirme depois do "pode".
- **Erro de limite:** a Meta pode recusar a confirmação com `You have reached the limit for the number of Businesses you can create at this time.` Nada foi criado. O limite é por pessoa e é diferente do de 15 por dia. A saída é usar um portfólio existente com `can_add_assets: true` (ou pedir a quem já tem portfólio que dê acesso).

## 3b. Ligar (não tem volta)

1. Chame `devtools_app_business_manage` com `app_id` e `business_id`. A primeira chamada devolve um resumo e um `confirm_token`.
2. Explique ao aluno: **"Isto é permanente: o portfólio vira dono do app e o app não muda de portfólio depois."**
3. Pergunte: "Posso ligar o app X ao portfólio Y?" Só chame de novo com o `confirm_token` depois do "pode".

## Como saber que deu certo

O resultado traz `access_status: CONFIRMED`. Guarde o `business_id` para o link da Business Suite (etapa 7).
