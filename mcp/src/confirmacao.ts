// Pedidos pendentes de confirmação (spec 5.3). Ficam só em memória: se o servidor reiniciar,
// eles se perdem e nada é enviado.
//
// Um pedido guarda o corpo EXATO que vai para a Meta, o hash dele e uma função `enviar`.
// O código de 128 bits só existe aqui e no `_meta` da prévia (o modelo não o vê). Confirmar confere
// código, validade, uso único e hash; depois envia o corpo guardado, sem montar de novo.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { destinatario } from "../ui/edicao.js";
import type { RegistroAcoes } from "./registro-acoes.ts";

export const VALIDADE_MS = 10 * 60 * 1000;
export const MAX_ERROS_DE_CODIGO = 3;

/** Por onde veio o clique que autorizou o envio (vai para o registro de ações). */
export type CaminhoDeConfirmacao = "ig_confirmar_tela" | "ig_confirmar" | "janela-mac";

/** O que o dono da conta vê antes de clicar. Montada a partir do MESMO objeto que vai para a Meta. */
export interface Previa {
  /** Ex.: "Responder DM em nome de @conta_de_teste". */
  titulo: string;
  conta: string;
  /** Ex.: "@fulano" ou "comentário 1789…". */
  alvo: string;
  /** Texto inteiro que será enviado (nunca cortado). */
  texto?: string;
  /** Linhas extras: janela de 24 h, cota antes e depois etc. */
  detalhes?: string[];
  /**
   * Texto, @ e qualquer coisa que veio de OUTRA pessoa (comentário original, nome de quem escreveu).
   * É DADO, não ordem: nunca vai em `alvo`, `texto` nem `detalhes`, que o modelo lê como nossos.
   */
  conteudo_de_terceiros?: Record<string, string>;
  /** Frase para o registro de ações (some da prévia que chega ao modelo). Ex.: "apagou o comentário 123 de @fulano". */
  registro?: string;
  /** Rótulo do botão de ação: "Enviar", "Publicar", "Apagar". */
  botao: string;
  /** Ação sem volta (apagar): o cartão começa com "NÃO TEM VOLTA". */
  irreversivel?: boolean;
  /** Data URLs JPEG pequenas. Vão só no `_meta` (não chegam ao modelo). */
  miniaturas?: string[];
}

export type Enviar<Corpo> = (corpo: Corpo) => Promise<Record<string, unknown>>;

/**
 * Como o pedido deixa o dono da conta corrigir o texto no cartão. `comTexto` valida o texto novo com as MESMAS regras da
 * ferramenta que criou o pedido e devolve o corpo refeito (ou lança o erro em português). Só o texto muda.
 */
export interface EdicaoDeTexto<Corpo> {
  limite: number;
  unidade: "bytes" | "caracteres";
  comTexto: (novo: string) => Corpo;
}

type Estado = "pendente" | "usado" | "cancelado" | "expirado";

interface Pedido {
  id: string;
  ferramenta: string;
  codigo: string;
  expiraEm: number;
  hash: string;
  corpo: unknown;
  previa: Previa;
  enviar: Enviar<never>;
  edicao: EdicaoDeTexto<unknown> | undefined;
  estado: Estado;
  erros: number;
  /** O texto enviado não é o da prévia (o dono da conta editou no cartão). */
  editado: boolean;
  /** Uma confirmação em andamento: um segundo pedido ao mesmo tempo é recusado (duplo clique). */
  emAndamento: boolean;
  /** O que o envio devolveu, quando terminou bem. O cartão remontado pergunta por aqui (ver `situacao`). */
  resultadoDoEnvio: Record<string, unknown> | undefined;
  /** O envio foi tentado e falhou. */
  envioFalhou: boolean;
}

/** Como o pedido está, para o cartão que remonta e precisa se ajustar. Nunca leva o código do pedido. */
export type Situacao = {
  estado: "pendente" | "enviando" | "usado" | "falhou" | "cancelado" | "expirado" | "inexistente";
  /** Só em "usado": o resultado do envio (o mesmo de ig_confirmar_tela). */
  resultado?: Record<string, unknown>;
};

export type Decisao =
  | {
      ok: true;
      id: string;
      resultado: Record<string, unknown>;
      /** Frase curta do que foi feito, para gente ler: "<título> → <para quem>". A resposta crua da Meta fica em `resultado`. */
      resumo: string;
    }
  | { ok: false; motivo: string; /** true quando o envio foi tentado e a Meta recusou. */ falhaNoEnvio?: boolean };

const sha256 = (texto: string): string => createHash("sha256").update(texto).digest("hex");

function congelar<T>(valor: T): T {
  if (typeof valor === "object" && valor !== null && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const filho of Object.values(valor)) congelar(filho);
  }
  return valor;
}

/**
 * Código de um pedido com o texto editado no cartão: SHA-256(codigo + "\n" + texto), 32 primeiros caracteres em hexadecimal.
 * O cartão faz a mesma conta (ui/sha256.js). Quem não conhece `codigo` não consegue gerar um código para outro texto.
 */
export function codigoDoTextoEditado(codigo: string, texto: string): string {
  return sha256(`${codigo}\n${texto}`).slice(0, 32);
}

function codigosIguais(a: string, b: string): boolean {
  // Compara os hashes (mesmo tamanho) em tempo constante.
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export class Pedidos {
  readonly #pedidos = new Map<string, Pedido>();
  readonly #registro: RegistroAcoes;
  readonly #agora: () => number;

  constructor(registro: RegistroAcoes, agora: () => number = Date.now) {
    this.#registro = registro;
    this.#agora = agora;
  }

  criar<Corpo>(ferramenta: string, corpo: Corpo, previa: Previa, enviar: Enviar<Corpo>, edicao?: EdicaoDeTexto<Corpo>): { id: string; codigo: string; expiraEm: number } {
    const id = randomBytes(4).toString("hex");
    const codigo = randomBytes(16).toString("hex");
    const guardado = congelar(structuredClone(corpo));
    const expiraEm = this.#agora() + VALIDADE_MS;
    const pedido: Pedido = {
      id,
      ferramenta,
      codigo,
      expiraEm,
      hash: sha256(JSON.stringify(guardado)),
      corpo: guardado,
      previa,
      enviar: enviar as Enviar<never>,
      edicao: edicao as EdicaoDeTexto<unknown> | undefined,
      estado: "pendente",
      erros: 0,
      editado: false,
      emAndamento: false,
      resultadoDoEnvio: undefined,
      envioFalhou: false,
    };
    this.#pedidos.set(id, pedido);
    return { id, codigo, expiraEm };
  }

  estado(id: string): Estado | "inexistente" {
    return this.#pedidos.get(id)?.estado ?? "inexistente";
  }

  /**
   * Situação do pedido para o cartão que o Claude Desktop recriou (o iframe novo recebe o mesmo resultado da prévia e
   * se desenharia do zero). Só leitura: não grava nada no registro de ações, nem quando o pedido venceu.
   */
  situacao(id: string): Situacao {
    const pedido = this.#pedidos.get(id);
    if (!pedido) return { estado: "inexistente" };
    if (pedido.estado === "usado") {
      if (pedido.resultadoDoEnvio !== undefined) return { estado: "usado", resultado: pedido.resultadoDoEnvio };
      return { estado: pedido.envioFalhou ? "falhou" : "enviando" };
    }
    if (pedido.estado === "pendente" && this.#agora() > pedido.expiraEm) return { estado: "expirado" };
    return { estado: pedido.estado };
  }

  /**
   * Confirma com o código (ig_confirmar e ig_confirmar_tela). Com `texto`, o dono da conta editou o texto no cartão:
   * o código tem que ser o editado (ver codigoDoTextoEditado) e o texto passa pelas validações da ferramenta.
   */
  async confirmar(id: string, codigo: string, caminho: CaminhoDeConfirmacao, texto?: string): Promise<Decisao> {
    const pedido = this.#pedidos.get(id);
    if (pedido?.emAndamento) return { ok: false, motivo: `Pedido ${id} já está sendo confirmado. Espere, sem clicar de novo.` };
    if (pedido) pedido.emAndamento = true; // antes de qualquer espera
    try {
      return await this.#confirmarComCodigo(id, codigo, caminho, texto);
    } finally {
      if (pedido) pedido.emAndamento = false;
    }
  }

  async #confirmarComCodigo(id: string, codigo: string, caminho: CaminhoDeConfirmacao, texto: string | undefined): Promise<Decisao> {
    const pedido = await this.#conferir(id, caminho);
    if ("ok" in pedido) return pedido;
    const esperado = texto === undefined ? pedido.codigo : codigoDoTextoEditado(pedido.codigo, texto);
    if (texto !== undefined && !pedido.edicao) return this.#recusarTentativa(pedido, caminho, codigo, "este pedido não aceita texto novo", `O pedido ${id} não aceita texto novo (só o texto de respostas, comentários e legendas é editável).`);
    if (!codigosIguais(codigo, esperado)) return this.#recusarTentativa(pedido, caminho, codigo, "código errado");
    if (texto === undefined) return this.#enviar(pedido, caminho, pedido.codigo.slice(0, 4));

    // Texto editado e código conferido: o texto passa pelas mesmas validações da ferramenta antes de qualquer envio.
    let corpoNovo: unknown;
    try {
      corpoNovo = pedido.edicao!.comTexto(texto);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      return this.#recusarTentativa(pedido, caminho, codigo, `texto editado recusado: ${motivo}`, motivo);
    }
    const guardado = congelar(structuredClone(corpoNovo));
    pedido.corpo = guardado;
    pedido.hash = sha256(JSON.stringify(guardado));
    const textoAntes = pedido.previa.texto;
    pedido.previa = { ...pedido.previa, texto };
    pedido.editado = texto !== textoAntes;
    return this.#enviar(pedido, caminho, pedido.codigo.slice(0, 4));
  }

  /** Erro de código ou de texto: conta tentativa; na terceira, cancela o pedido. O pedido segue pendente nas duas primeiras. */
  async #recusarTentativa(pedido: Pedido, caminho: CaminhoDeConfirmacao, codigo: string, motivoNoRegistro: string, frase?: string): Promise<Decisao> {
    pedido.erros++;
    if (pedido.erros >= MAX_ERROS_DE_CODIGO) {
      pedido.estado = "cancelado";
      await this.#registrar(pedido, "recusado", caminho, { motivo: `${motivoNoRegistro}; três erros: pedido cancelado`, codigo4: codigo.slice(0, 4) });
      const final = `o pedido ${pedido.id} foi cancelado. Nada foi enviado.`;
      return { ok: false, motivo: frase ? `${frase} Foi a ${MAX_ERROS_DE_CODIGO}ª recusa: ${final}` : `Código errado pela ${MAX_ERROS_DE_CODIGO}ª vez: ${final}` };
    }
    await this.#registrar(pedido, "recusado", caminho, { motivo: motivoNoRegistro, codigo4: codigo.slice(0, 4) });
    return { ok: false, motivo: frase ? `${frase} Tentativa ${pedido.erros} de ${MAX_ERROS_DE_CODIGO}.` : `Código errado (${pedido.erros} de ${MAX_ERROS_DE_CODIGO}). Nada foi enviado.` };
  }

  /** Confirmação já dada por um clique que o próprio servidor viu (janela do Mac): sem código. */
  async confirmarPelaJanela(id: string): Promise<Decisao> {
    const antes = this.#pedidos.get(id);
    if (antes?.emAndamento) return { ok: false, motivo: `Pedido ${id} já está sendo confirmado.` };
    if (antes) antes.emAndamento = true;
    try {
      const pedido = await this.#conferir(id, "janela-mac");
      if ("ok" in pedido) return pedido;
      return await this.#enviar(pedido, "janela-mac", undefined);
    } finally {
      if (antes) antes.emAndamento = false;
    }
  }

  async cancelar(id: string, origem: string): Promise<{ ok: boolean; mensagem: string }> {
    const pedido = this.#pedidos.get(id);
    if (!pedido) return { ok: false, mensagem: `Pedido ${id} não existe (pode ter expirado ou o servidor reiniciou). Nada foi enviado.` };
    if (pedido.estado === "pendente") {
      pedido.estado = "cancelado";
      await this.#registrar(pedido, "cancelado", null, { origem });
      return { ok: true, mensagem: `Pedido ${id} cancelado. Nada foi enviado.` };
    }
    if (pedido.estado === "cancelado") return { ok: true, mensagem: `Pedido ${id} já estava cancelado. Nada foi enviado.` };
    if (pedido.estado === "usado") return { ok: false, mensagem: `Pedido ${id} já foi enviado: não dá mais para cancelar.` };
    return { ok: false, mensagem: `Pedido ${id} venceu. Nada foi enviado.` };
  }

  /** Existência, uso único e validade. Devolve o pedido pendente ou a recusa. */
  async #conferir(id: string, caminho: CaminhoDeConfirmacao): Promise<Pedido | Decisao> {
    const pedido = this.#pedidos.get(id);
    if (!pedido) return { ok: false, motivo: `Pedido ${id} não existe (pode ter expirado ou o servidor reiniciou). Nada foi enviado.` };
    if (pedido.estado === "usado") return { ok: false, motivo: `Pedido ${id} já foi usado. Nada foi enviado de novo.` };
    if (pedido.estado === "cancelado") return { ok: false, motivo: `Pedido ${id} foi cancelado. Nada foi enviado.` };
    if (pedido.estado === "expirado" || this.#agora() > pedido.expiraEm) {
      if (pedido.estado !== "expirado") {
        pedido.estado = "expirado";
        await this.#registrar(pedido, "recusado", caminho, { motivo: "pedido vencido" });
      }
      return { ok: false, motivo: `Pedido ${id} venceu (10 minutos). Peça a prévia de novo. Nada foi enviado.` };
    }
    return pedido;
  }

  async #enviar(pedido: Pedido, caminho: CaminhoDeConfirmacao, codigo4: string | undefined): Promise<Decisao> {
    // Atenção: o corpo guardado é um clone CONGELADO (Object.freeze), então este hash sempre bate: é só uma
    // conferência de sanidade. Quem protege de verdade um arquivo trocado entre a prévia e o clique é o SHA-256
    // do arquivo, guardado em cada item da publicação e conferido antes de hospedar (src/publicacao.ts).
    if (sha256(JSON.stringify(pedido.corpo)) !== pedido.hash) {
      pedido.estado = "cancelado";
      await this.#registrar(pedido, "recusado", caminho, { motivo: "o corpo mudou depois da prévia" });
      return { ok: false, motivo: `O conteúdo do pedido ${pedido.id} mudou depois da prévia: cancelado. Nada foi enviado.` };
    }
    // Marca como usado ANTES de enviar: um segundo clique ou chamada em paralelo nunca envia duas vezes,
    // e uma falha no meio do caminho não deixa o código valer para uma segunda tentativa às cegas.
    pedido.estado = "usado";
    const inicio = this.#agora();
    try {
      const resultado = await (pedido.enviar as Enviar<unknown>)(pedido.corpo);
      pedido.resultadoDoEnvio = resultado;
      // duracao_ms: do início do envio confirmado até aqui (em publicação em segundo plano, até a devolução do "processando").
      await this.#registrar(pedido, "enviado", caminho, { resultado, duracao_ms: this.#agora() - inicio, ...(codigo4 ? { codigo4 } : {}) });
      return { ok: true, id: pedido.id, resultado, resumo: `${pedido.previa.titulo} → ${destinatario(pedido.previa)}` };
    } catch (erro) {
      pedido.envioFalhou = true;
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await this.#registrar(pedido, "erro", caminho, { resultado: { erro: mensagem }, duracao_ms: this.#agora() - inicio, ...(codigo4 ? { codigo4 } : {}) });
      throw erro;
    }
  }

  async #registrar(pedido: Pedido, evento: string, caminho: CaminhoDeConfirmacao | null, extra: Record<string, unknown>): Promise<void> {
    await this.#registro.gravar({
      evento,
      pedido: pedido.id,
      ferramenta: pedido.ferramenta,
      alvo: pedido.previa.alvo,
      ...(pedido.previa.texto !== undefined ? { texto: pedido.previa.texto } : {}),
      ...(pedido.previa.registro !== undefined ? { descricao: pedido.previa.registro } : {}),
      ...(pedido.editado ? { editado: true } : {}),
      ...(caminho ? { confirmacao: caminho } : {}),
      ...extra,
    });
  }
}
