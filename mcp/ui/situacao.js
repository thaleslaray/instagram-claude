// Ajuste do cartão que o Claude Desktop recriou (sem DOM, para dar para testar no Node).
// O iframe novo recebe o MESMO resultado da prévia e se desenharia do zero (botão ativo, sem acompanhamento).
// Ao montar, o cartão pergunta ao servidor (`ig_estado_pedido_tela`) como está o pedido e se ajusta.

import { extrairTrabalho } from "./acompanhamento.js";

export const INTERVALO_ENVIANDO_MS = 3_000;
export const LIMITE_ENVIANDO_MS = 2 * 60_000;
export const MAX_FALHAS_SEGUIDAS_ENVIANDO = 3;

const ESTADOS = ["pendente", "enviando", "usado", "falhou", "cancelado", "expirado", "inexistente"];

/** Só endereço https vira link clicável. Aceita o resultado de ig_confirmar_tela e o de ig_estado_pedido_tela (mesma forma). */
export function linkDoResultado(r) {
  const dados = r && r.structuredContent && r.structuredContent.resultado;
  const url = dados && typeof dados.permalink === "string" ? dados.permalink : "";
  return /^https:\/\//.test(url) ? url : "";
}

/** O estado do pedido no resultado cru de `ig_estado_pedido_tela`, ou null se a consulta não deu uma resposta válida. */
export function estadoDoPedido(r) {
  const sc = r && !r.isError ? r.structuredContent : null;
  return sc && typeof sc.estado === "string" && ESTADOS.includes(sc.estado) ? sc.estado : null;
}

/**
 * O que o cartão faz com a resposta da consulta. `acao`:
 *  - "nada": pedido pendente, o cartão fica como foi desenhado;
 *  - "travar": trava de vez e mostra `mensagem` (`tipo`: "" ou "erro");
 *  - "enviado": trava, mostra "Este pedido já foi enviado." e, conforme o resultado, `link` e/ou `trabalhoId` (vídeo em segundo plano);
 *  - "enviando": trava e espera o envio voltar (ver `aguardarEnvio`).
 */
export function planoDaSituacao(r) {
  const estado = estadoDoPedido(r);
  if (estado === null || estado === "pendente") return { acao: "nada", mensagem: "", tipo: "", link: "", trabalhoId: "" };
  if (estado === "usado") {
    const trabalho = extrairTrabalho(r);
    return { acao: "enviado", mensagem: "Este pedido já foi enviado.", tipo: "ok", link: linkDoResultado(r), trabalhoId: trabalho ? trabalho.trabalhoId : "" };
  }
  if (estado === "enviando") return { acao: "enviando", mensagem: "Enviando… (o pedido já foi confirmado)", tipo: "", link: "", trabalhoId: "" };
  if (estado === "falhou") return { acao: "travar", mensagem: "O envio deste pedido falhou. Nada foi publicado. Peça a prévia de novo.", tipo: "erro", link: "", trabalhoId: "" };
  if (estado === "cancelado") return { acao: "travar", mensagem: "Pedido cancelado. Nada foi enviado.", tipo: "", link: "", trabalhoId: "" };
  return { acao: "travar", mensagem: "Este pedido não vale mais (venceu ou o Claude Desktop reiniciou o servidor). Nada foi enviado. Peça a prévia de novo.", tipo: "erro", link: "", trabalhoId: "" };
}

/**
 * Pedido em "enviando": consulta de 3 em 3 s, até 2 minutos, até virar outra coisa. Devolve o último resultado cru
 * (com estado diferente de "enviando"), ou null se a consulta falhou 3 vezes seguidas, o tempo acabou ou `cancelado()` mandou parar.
 */
export async function aguardarEnvio({ consultar, esperar, agora, cancelado = () => false }) {
  const inicio = agora();
  let falhas = 0;
  for (;;) {
    await esperar(INTERVALO_ENVIANDO_MS);
    if (cancelado()) return null;
    let r = null;
    try {
      r = await consultar();
    } catch {
      r = null;
    }
    if (cancelado()) return null;
    const estado = estadoDoPedido(r);
    if (estado === null) {
      falhas++;
      if (falhas >= MAX_FALHAS_SEGUIDAS_ENVIANDO) return null;
    } else {
      falhas = 0;
      if (estado !== "enviando") return r;
    }
    if (agora() - inicio >= LIMITE_ENVIANDO_MS) return null;
  }
}
