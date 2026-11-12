// Lógica do texto editável no cartão (ficha 16), sem tocar no DOM, para dar para testar no Node.
import { sha256Hex } from "./sha256.js";

/** Tamanho do texto na unidade do limite: bytes em UTF-8 ou caracteres (emoji conta 1). */
export function medir(texto, unidade) {
  return unidade === "bytes" ? new TextEncoder().encode(texto).length : Array.from(texto).length;
}

export function rotuloDoContador(texto, limite, unidade) {
  return medir(texto, unidade) + " de " + limite + " " + unidade;
}

/** Enviar só liga com texto não vazio e dentro do limite. */
export function podeEnviar(texto, limite, unidade) {
  return texto.trim() !== "" && medir(texto, unidade) <= limite;
}

/** Código de um pedido com texto editado: SHA-256(codigo + "\n" + texto), 32 primeiros caracteres. O servidor faz a mesma conta. */
export function codigoEditado(codigo, texto) {
  return sha256Hex(codigo + "\n" + texto).slice(0, 32);
}

/** Mensagem do caminho sem ferramenta da tela (aba Code). Com `texto`, o código já deve ser o editado. */
export function mensagemDeConfirmacao(id, codigo, texto) {
  if (texto === null) return "Confirmo o pedido " + id + ", código " + codigo + ".";
  return "Confirmo o pedido " + id + ", código " + codigo + ", com este texto:\n" + texto;
}

/** O alvo é só o ID de uma pessoa (DM)? Aí o @ dela diz mais que o número. */
function alvoEhIdDePessoa(sc) {
  return typeof sc.alvo === "string" && /^IGSID\b/.test(sc.alvo);
}

function arrobaDoAlvo(sc) {
  const u = sc.conteudo_de_terceiros && sc.conteudo_de_terceiros.username;
  return alvoEhIdDePessoa(sc) && typeof u === "string" && u.trim() !== "" ? u.trim() : null;
}

/** O que vai depois de "Para:". Em DM, o @ da pessoa no lugar do IGSID. */
export function destinatario(sc) {
  return arrobaDoAlvo(sc) || sc.alvo || "?";
}

/** Linhas do bloco "De outra pessoa": tudo de `conteudo_de_terceiros`, menos o @ que já foi para o "Para:". */
export function terceirosParaMostrar(sc) {
  const t = sc.conteudo_de_terceiros && typeof sc.conteudo_de_terceiros === "object" ? Object.entries(sc.conteudo_de_terceiros) : [];
  return arrobaDoAlvo(sc) ? t.filter(([campo]) => campo !== "username") : t;
}

/**
 * Linhas de detalhe que o cartão mostra. Ficam de fora o prazo da janela e o tamanho do texto: o contador
 * já mostra o tamanho, e o Claude diz o prazo no texto dele. O que fala do conteúdo ou da consequência
 * (cota, avisos, origem do arquivo, "ação sem volta") continua.
 */
export function detalhesDoCartao(sc) {
  const d = Array.isArray(sc.detalhes) ? sc.detalhes : [];
  return d.filter((linha) => typeof linha === "string" && !/^(Janela aberta|Tamanho:)/.test(linha));
}

/** Linhas que ficam sempre à vista: avisos e consequência sem volta. */
const LINHA_A_VISTA = /^(Aviso:|Ação sem volta)/;

/**
 * Separa as linhas do cartão (a pedido do dono da conta, 12/11): avisos e "ação sem volta" ficam à vista; o resto
 * (cota, arquivo, capa, janela do feed…) vai para "Ver detalhes". Uma linha só não vale um botão: fica à vista.
 * A ordem original é mantida dentro de cada grupo.
 */
export function separarDetalhes(linhas) {
  const aVista = linhas.filter((l) => LINHA_A_VISTA.test(l));
  const recolhidas = linhas.filter((l) => !LINHA_A_VISTA.test(l));
  if (recolhidas.length <= 1) return { aVista: [...linhas], recolhidas: [] };
  return { aVista, recolhidas };
}
