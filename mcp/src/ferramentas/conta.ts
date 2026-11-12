// ig_conta: dados da própria conta profissional (spec 4.1).

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Contexto } from "../contexto.ts";
import { registrarLeitura, respostaJson } from "../respostas.ts";

export const CAMPOS_CONTA = [
  "id",
  "username",
  "name",
  "biography",
  "followers_count",
  "follows_count",
  "media_count",
  "profile_picture_url",
  "website",
] as const;

// A Meta omite campo vazio (ex.: biography sem texto): por isso quase tudo é opcional.
export const ContaSchema = z.object({
  id: z.string().describe("IG ID da conta"),
  username: z.string().describe("@ da conta, sem a arroba"),
  name: z.string().optional().describe("Nome exibido no perfil"),
  biography: z.string().optional().describe("Bio do perfil (some quando está vazia)"),
  followers_count: z.number().int().optional().describe("Seguidores"),
  follows_count: z.number().int().optional().describe("Contas que ela segue"),
  media_count: z.number().int().optional().describe("Publicações"),
  profile_picture_url: z.string().optional().describe("URL da foto de perfil (temporária, da CDN da Meta)"),
  website: z.string().optional().describe("Site do perfil (some quando está vazio)"),
  aviso: z.string().optional().describe("Presente quando algum campo ficou de fora"),
});

export type Conta = z.infer<typeof ContaSchema>;

export function registrarConta(server: McpServer, ctx: Contexto): void {
  registrarLeitura(
    server,
    "ig_conta",
    {
      title: "Conta do Instagram",
      description:
        "Mostra os dados da conta profissional do Instagram configurada: @, nome, bio, site, foto e os números de seguidores, seguindo e publicações. " +
        "Use para saber qual conta está conectada ou para números gerais do perfil. Campos vazios na Meta (bio, site) simplesmente não aparecem. " +
        'Exemplos: "quantos seguidores eu tenho?", "qual conta está conectada?".',
      inputSchema: z.strictObject({}),
      outputSchema: ContaSchema,
    },
    async (_args, mcp) => {
      const { dados, aviso } = await ctx.graph.getComReserva<Record<string, unknown>>(ctx.config.contaId, CAMPOS_CONTA, {}, { signal: mcp.mcpReq.signal });
      const conta = ContaSchema.parse({ ...dados, ...(aviso ? { aviso } : {}) });
      ctx.conta.arroba = conta.username;
      return respostaJson(conta);
    },
  );
}
