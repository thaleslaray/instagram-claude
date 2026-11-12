// ig_estado_do_token: sempre registrada, em qualquer perfil (grupo `sistema`).

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Contexto } from "../contexto.ts";
import { verificarEstado } from "../estado.ts";
import type { Politica } from "../perfis.ts";
import { registrarLeitura, respostaJson } from "../respostas.ts";

const EstadoSchema = z.object({
  saudavel: z.boolean(),
  keychain: z.object({ token_cadastrado: z.boolean() }),
  conta: z.union([z.object({ id: z.string(), username: z.string() }), z.object({ erro: z.string() })]).nullable(),
  permissoes: z.union([z.object({ concedidas: z.array(z.string()) }), z.object({ erro: z.string() })]).nullable(),
  graph_versao: z.string(),
  perfil: z.string().describe("Perfil de ferramentas ativo (IG_PERFIL)"),
  grupos_so_leitura: z.array(z.string()),
  problemas: z.array(z.string()),
});

export function registrarEstado(server: McpServer, ctx: Contexto, politica: Politica): void {
  registrarLeitura(
    server,
    "ig_estado_do_token",
    {
      title: "Estado do token e da conta",
      description:
        "Confere se o token está cadastrado no Keychain, qual conta ele abre, quais permissões a Meta concedeu, a versão da Graph e o perfil de ferramentas ativo. " +
        "Nunca mostra o token. Use quando uma ferramenta falhar por permissão ou token, ou para saber o que este servidor pode fazer. " +
        'Exemplos: "o token está valendo?", "que permissões eu tenho?".',
      inputSchema: z.strictObject({}),
      outputSchema: EstadoSchema,
    },
    async (_args, mcp) => respostaJson(EstadoSchema.parse(await verificarEstado(ctx, politica, mcp.mcpReq.signal))),
  );
}
