// Ferramenta de escrita SÓ DOS TESTES (nunca registrada no servidor de verdade): prova o fluxo
// prévia -> clique -> envio sem depender de nenhuma ferramenta de escrita real (fichas 06 em diante).
// Ela "escreve" com um POST na Graph falsa.

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Previa } from "../src/confirmacao.ts";
import type { Contexto } from "../src/contexto.ts";
import { registrarEscrita } from "../src/respostas.ts";

export const NOME_ESCRITA_TESTE = "ig_escrita_teste";

export interface OpcoesEscritaTeste {
  miniaturas?: string[];
  irreversivel?: boolean;
  /** Liga a edição do texto no cartão (limite de bytes). Sem isso a ferramenta não oferece edição. */
  editavel?: { limite: number };
}

/** Mesma frase de erro que as ferramentas de verdade dão quando o texto passa do limite. */
export const frasesDeTeste = {
  vazio: "O texto está vazio.",
  grande: (bytes: number, limite: number) => `Texto grande demais: ${bytes} bytes (o limite é ${limite}). Nada foi enviado.`,
};

export function registrarEscritaDeTeste(opcoes: OpcoesEscritaTeste = {}) {
  return (server: McpServer, ctx: Contexto): void => {
    registrarEscrita(
      server,
      NOME_ESCRITA_TESTE,
      { destrutiva: false, idempotente: false },
      {
        title: "Escrita de teste",
        description: "Só nos testes: manda um texto para a Graph falsa depois da confirmação.",
        inputSchema: z.strictObject({ texto: z.string(), para: z.string().default("@fulano") }),
      },
      async ({ texto, para }, _mcp, escrever) => {
        const corpo = { caminho: `/${ctx.config.contaId}/mensagem_de_teste`, texto, para };
        const montarPrevia = (c: typeof corpo): Previa => ({
          titulo: `Responder DM em nome de @${ctx.conta.arroba ?? "conta_de_teste"}`,
          conta: `@${ctx.conta.arroba ?? "conta_de_teste"}`,
          alvo: c.para,
          texto: c.texto,
          detalhes: ["janela aberta até 08/11 14:32"],
          botao: opcoes.irreversivel ? "Apagar" : "Enviar",
          ...(opcoes.irreversivel ? { irreversivel: true } : {}),
          ...(opcoes.miniaturas ? { miniaturas: opcoes.miniaturas } : {}),
        });
        const edicao = opcoes.editavel
          ? {
              limite: opcoes.editavel.limite,
              unidade: "bytes" as const,
              comTexto: (novo: string) => {
                const bytes = Buffer.byteLength(novo, "utf8");
                if (novo.trim() === "") throw new Error(frasesDeTeste.vazio);
                if (bytes > opcoes.editavel!.limite) throw new Error(frasesDeTeste.grande(bytes, opcoes.editavel!.limite));
                return { ...corpo, texto: novo };
              },
            }
          : undefined;
        return escrever(
          NOME_ESCRITA_TESTE,
          corpo,
          montarPrevia,
          async (c) => {
            const r = await ctx.graph.post<{ id: string }>(c.caminho.slice(1), { texto: c.texto, para: c.para });
            return { id: r.id };
          },
          edicao,
        );
      },
    );
  };
}
