// Escrita que dá para desfazer e vai direto, sem prévia (spec 3.6: esconder comentário, ligar comentários, reagir a DM).
// Quem a usa passa os dados da ação; aqui sai o registro, sempre no mesmo formato:
// `confirmacao: "nao-exigida"`, `desfazer` (como voltar atrás) e o resultado ou o erro da Meta.

import type { Contexto } from "./contexto.ts";

export interface AcaoDireta {
  ferramenta: string;
  /** Sobre quem ou o quê a ação age (ex.: ID do comentário). */
  alvo: string;
  /** Como desfazer, em uma frase. */
  desfazer: string;
  /** Mais campos do registro (ex.: estado anterior e novo, ID da mensagem). */
  detalhes?: Record<string, unknown>;
}

/** Roda `enviar`; grava `enviado` (com o resultado) ou `erro` (com a mensagem) no registro de ações e devolve/relança. */
export async function executarEscritaDireta<R>(ctx: Pick<Contexto, "registro">, acao: AcaoDireta, enviar: () => Promise<R>): Promise<R> {
  const base = { ferramenta: acao.ferramenta, alvo: acao.alvo, confirmacao: "nao-exigida", ...acao.detalhes, desfazer: acao.desfazer };
  try {
    const resultado = await enviar();
    await ctx.registro.gravar({ evento: "enviado", ...base, resultado: resultado ?? { sucesso: true } });
    return resultado;
  } catch (erro) {
    await ctx.registro.gravar({ evento: "erro", ...base, resultado: { erro: erro instanceof Error ? erro.message : String(erro) } });
    throw erro;
  }
}
