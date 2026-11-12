// Tela de confirmação (MCP App). Roda dentro do app do Claude, numa área isolada.
// Recebe a prévia em `_meta.previa` (ou, em servidor antigo, no próprio `structuredContent`) e o código/miniaturas
// em `_meta` (o modelo não vê o `_meta`). O `structuredContent` novo tem `pedido`, `para_o_claude` e `se_o_cartao_nao_apareceu`; o cartão só lê `pedido`.
// Clique no botão de ação:
//  - o app do Claude declara `serverTools` -> chama `ig_confirmar_tela` direto;
//  - senão (aba Code) -> manda a mensagem "Confirmo o pedido <id>, código <codigo>." no chat (só funciona
//    logo depois de um clique real nesta tela; o app do Claude recusa a mensagem se não houve).
// Vídeo: o servidor responde "processando" com um trabalho_id; o cartão fica de pé e consulta `ig_status_publicacao`
// a cada 5 s (ver acompanhamento.js), mostrando o passo até publicar, falhar ou passar de 6 minutos.
// Texto editável (ficha 16): com `texto_editavel` na prévia, o texto vira um <textarea>. Se o dono da conta mudou o texto,
// o código enviado é o editado (SHA-256 de código + "\n" + texto, em JavaScript puro: o iframe pode não ter
// crypto.subtle) e o texto novo vai junto. O servidor confere o código e as regras do texto.
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from "@modelcontextprotocol/ext-apps/app-with-deps";
import { acompanhar, diagnosticarSemTrabalho, extrairTrabalho } from "./acompanhamento.js";
import { aguardarEnvio, linkDoResultado, planoDaSituacao } from "./situacao.js";
import { codigoEditado, destinatario, detalhesDoCartao, separarDetalhes, mensagemDeConfirmacao, podeEnviar, rotuloDoContador, terceirosParaMostrar } from "./edicao.js";

const app = new App({ name: "instagram-confirmar", version: "1.0.0" }, {});
const $ = (id) => document.getElementById(id);

let pedido = null; // { id, codigo, original, edicao: { limite, unidade } | null }
let travado = false;
let encerrado = false; // pedido já usado, enviado ou cancelado: o cartão nunca mais destrava
let cliqueDado = false; // o dono da conta clicou: a consulta de estado que voltar depois não mexe mais no cartão
let geracao = 0; // cada resultado de ferramenta recebido abre uma geração; consulta de geração velha é descartada

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function aplicarContexto(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles && ctx.styles.css && ctx.styles.css.fonts) applyHostFonts(ctx.styles.css.fonts);
  const z = ctx.safeAreaInsets;
  if (z) {
    const r = document.documentElement.style;
    r.setProperty("--safe-top", z.top + "px");
    r.setProperty("--safe-right", z.right + "px");
    r.setProperty("--safe-bottom", z.bottom + "px");
    r.setProperty("--safe-left", z.left + "px");
  }
}

function mostrarEstado(texto, tipo) {
  const e = $("estado");
  if (!e) return;
  e.textContent = texto;
  e.className = "estado" + (tipo ? " " + tipo : "");
}

/** Texto que está na tela agora (o editado, se houver edição; senão o original). */
function textoAtual() {
  const campo = $("campo-texto");
  return campo ? campo.value : null;
}

/** Enviar fica desligado com o cartão travado, ou com o texto vazio ou acima do limite. */
function atualizarBotoes() {
  const cancelar = $("cancelar");
  if (cancelar) cancelar.disabled = travado;
  const acao = $("acao");
  if (!acao) return;
  const texto = textoAtual();
  const invalido = pedido && pedido.edicao && texto !== null && !podeEnviar(texto, pedido.edicao.limite, pedido.edicao.unidade);
  acao.disabled = travado || Boolean(invalido);
}

function travar(valor) {
  travado = valor || encerrado;
  const campo = $("campo-texto");
  if (campo) campo.readOnly = travado;
  atualizarBotoes();
}

/** Trava de vez: botão de ação e Cancelar desativados, texto só para ler. */
function encerrar() {
  encerrado = true;
  travar(true);
}

function mostrarLink(url) {
  const raiz = $("previa");
  if (!url || !raiz || $("ver-no-instagram")) return;
  const a = el("a", "ver", "Ver no Instagram");
  a.id = "ver-no-instagram";
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.addEventListener("click", (e) => {
    // O iframe do app não abre links sozinho: pede ao app do Claude.
    e.preventDefault();
    app.openLink({ url }).catch(() => {});
  });
  raiz.append(a);
}

function ajustarAltura(campo) {
  campo.style.height = "auto";
  campo.style.height = campo.scrollHeight + 2 + "px";
}

/** Bloco do texto: só leitura, ou <textarea> com contador ao vivo quando a ferramenta aceita edição. */
function blocoDoTexto(sc) {
  const bloco = el("div");
  const edicao = pedido && pedido.edicao;
  if (!edicao) {
    bloco.append(el("p", "rotulo", "Texto (" + Array.from(sc.texto).length + " caracteres)"), el("p", "texto", sc.texto));
    return bloco;
  }
  const rotulo = el("label", "rotulo", "Texto (você pode editar)");
  rotulo.htmlFor = "campo-texto";
  rotulo.style.display = "block";
  const campo = document.createElement("textarea");
  campo.id = "campo-texto";
  campo.className = "texto campo";
  campo.rows = 1;
  campo.value = sc.texto;
  campo.spellcheck = true;
  const contador = el("p", "contador");
  contador.id = "contador";
  contador.setAttribute("aria-live", "polite");
  const atualizar = () => {
    const texto = campo.value;
    contador.textContent = rotuloDoContador(texto, edicao.limite, edicao.unidade);
    contador.className = "contador" + (podeEnviar(texto, edicao.limite, edicao.unidade) ? "" : " excedeu");
    ajustarAltura(campo);
    atualizarBotoes();
  };
  campo.addEventListener("input", atualizar);
  bloco.append(rotulo, campo, contador);
  // O contador e a altura dependem do campo já estar na tela.
  queueMicrotask(atualizar);
  return bloco;
}

function desenhar(sc, meta) {
  const raiz = $("previa");
  raiz.replaceChildren();
  raiz.className = "cartao";
  raiz.append(el("p", "conta", "Conta " + (sc.conta || "?") + " · pedido " + (sc.pedido || "?")));
  if (sc.irreversivel) raiz.append(el("p", "sem-volta", "NÃO TEM VOLTA"));
  raiz.append(el("h1", "", sc.titulo || "Confirmar ação"));

  const para = el("p", "linha");
  para.append(el("b", "", "Para: "), document.createTextNode(destinatario(sc)));
  raiz.append(para);

  const fotos = Array.isArray(meta.miniaturas) ? meta.miniaturas : [];
  if (fotos.length > 0) {
    const grade = el("div", "miniaturas");
    fotos.forEach((src, i) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Miniatura " + (i + 1) + " de " + fotos.length;
      grade.append(img);
    });
    raiz.append(grade);
  }

  if (typeof sc.texto === "string") raiz.append(blocoDoTexto(sc));

  const terceiros = terceirosParaMostrar(sc);
  if (terceiros.length > 0) {
    const bloco = el("div");
    bloco.append(el("p", "rotulo", "De outra pessoa (só para você ler)"));
    for (const [campo, valor] of terceiros) bloco.append(el("p", "texto", campo.replace(/_/g, " ") + ": " + String(valor)));
    raiz.append(bloco);
  }

  const { aVista, recolhidas } = separarDetalhes(detalhesDoCartao(sc));
  const listaDe = (linhas) => {
    const lista = el("ul", "detalhes");
    for (const d of linhas) lista.append(el("li", "", d));
    return lista;
  };
  if (aVista.length > 0) raiz.append(listaDe(aVista));
  if (recolhidas.length > 0) {
    // <details> nativo: abre com clique, Enter ou espaço, e o leitor de tela anuncia aberto/fechado.
    const mais = el("details", "mais");
    mais.append(el("summary", "", "Ver detalhes (" + recolhidas.length + ")"), listaDe(recolhidas));
    raiz.append(mais);
  }

  const botoes = el("div", "botoes");
  const cancelar = el("button", "", "Cancelar");
  cancelar.id = "cancelar";
  cancelar.type = "button";
  const acao = el("button", "acao" + (sc.irreversivel ? " perigo" : ""), sc.botao || "Confirmar");
  acao.id = "acao";
  acao.type = "button";
  botoes.append(cancelar, acao);
  raiz.append(botoes, el("p", "estado"));
  raiz.lastChild.id = "estado";

  cancelar.addEventListener("click", () => decidir("cancelar"));
  acao.addEventListener("click", () => decidir("confirmar"));
  mostrarEstado("Clique uma vez e espere.");
  $("esqueleto").hidden = true;
  raiz.hidden = false;
}

function textoDoResultado(r) {
  const bloco = r && Array.isArray(r.content) ? r.content.find((c) => c.type === "text") : null;
  return bloco ? bloco.text : "";
}

/** Vídeo em segundo plano: mostra o passo e consulta o status até o fim. Os botões já estão travados. */
async function seguirTrabalho(trabalhoId) {
  const fim = await acompanhar({
    trabalhoId,
    pedidoId: pedido.id,
    consultar: () => app.callServerTool({ name: "ig_status_publicacao", arguments: { trabalho_id: trabalhoId } }),
    mostrar: mostrarEstado,
    esperar: (ms) => new Promise((pronto) => setTimeout(pronto, ms)),
    agora: () => Date.now(),
  });
  if (fim.fim === "publicado") mostrarLink(fim.permalink);
}

async function decidir(decisao) {
  if (travado || !pedido) return;
  cliqueDado = true;
  // Texto editado: só conta se mudou. Sem mudança, tudo como sempre (código original, sem `texto`).
  const atual = decisao === "confirmar" ? textoAtual() : null;
  const editado = atual !== null && atual !== pedido.original ? atual : null;
  const codigo = editado !== null ? codigoEditado(pedido.codigo, editado) : pedido.codigo;
  travar(true);
  mostrarEstado("Enviando… clique uma vez e espere.");
  const comServerTools = Boolean(app.getHostCapabilities() && app.getHostCapabilities().serverTools);
  try {
    if (comServerTools) {
      const r = await app.callServerTool(
        decisao === "confirmar"
          ? { name: "ig_confirmar_tela", arguments: { id: pedido.id, codigo, ...(editado !== null ? { texto: editado } : {}) } }
          : { name: "ig_cancelar_pedido", arguments: { id: pedido.id } },
      );
      mostrarEstado(textoDoResultado(r) || (r.isError ? "Não deu certo." : "Pronto."), r.isError ? "erro" : "ok");
      if (r.isError && decisao === "confirmar" && editado !== null && !/cancelado|venceu|já foi usado|não existe/.test(textoDoResultado(r))) {
        // Texto recusado pelo servidor (vazio, grande demais, regra da legenda): o pedido segue pendente, o dono da conta pode corrigir.
        travar(false);
        return;
      }
      // Nos outros casos o pedido já foi enviado, usado, cancelado ou venceu: trava de vez.
      encerrar();
      if (!r.isError) {
        mostrarLink(linkDoResultado(r));
        const trabalho = decisao === "confirmar" ? extrairTrabalho(r) : null;
        if (trabalho) await seguirTrabalho(trabalho.trabalhoId);
        else if (decisao === "confirmar") {
          // "Processando" sem trabalho extraído: não falha em silêncio.
          const diag = diagnosticarSemTrabalho(r);
          if (diag) {
            console.warn("[instagram-mcp] cartão: não achei o trabalho para acompanhar: " + diag.motivo);
            if (diag.trabalhoId !== "") mostrarEstado("Não consegui acompanhar. Peça ao Claude o status com o trabalho_id " + diag.trabalhoId + ".", "erro");
          }
        }
      }
      return;
    }
    const texto = decisao === "confirmar" ? mensagemDeConfirmacao(pedido.id, codigo, editado) : "Cancelo o pedido " + pedido.id + ".";
    const r = await app.sendMessage({ role: "user", content: [{ type: "text", text: texto }] });
    if (r && r.isError) throw new Error("o app do Claude recusou a mensagem");
    encerrar();
    mostrarEstado(
      decisao === "confirmar" ? "Mensagem enviada ao Claude. Espere ele concluir o envio." : "Cancelamento enviado ao Claude. Nada foi enviado ao Instagram.",
      "ok",
    );
  } catch (erro) {
    if (comServerTools) {
      mostrarEstado("Não consegui falar com o servidor: " + (erro && erro.message ? erro.message : "erro"), "erro");
      return;
    }
    // Nada saiu daqui: dá para tentar de novo, com um clique só.
    mostrarEstado("O app do Claude não aceitou a mensagem. Clique de novo, uma vez, e espere.", "erro");
    travar(false);
  }
}

/** Cartão remontado: pergunta ao servidor como está o pedido e se ajusta. Se a consulta falhar, o cartão fica como está. */
async function ajustarPeloEstado(minhaGeracao) {
  if (!app.getHostCapabilities() || !app.getHostCapabilities().serverTools) return;
  const id = pedido.id;
  const consultar = () => app.callServerTool({ name: "ig_estado_pedido_tela", arguments: { id } });
  const superado = () => cliqueDado || encerrado || minhaGeracao !== geracao;
  try {
    let r = await consultar();
    if (superado()) return;
    let plano = planoDaSituacao(r);
    if (plano.acao === "nada") return;
    encerrar();
    mostrarEstado(plano.mensagem, plano.tipo);
    if (plano.acao === "enviando") {
      const fim = await aguardarEnvio({
        consultar,
        esperar: (ms) => new Promise((pronto) => setTimeout(pronto, ms)),
        agora: () => Date.now(),
        cancelado: () => minhaGeracao !== geracao,
      });
      if (fim === null) return;
      r = fim;
      plano = planoDaSituacao(r);
      if (plano.acao === "nada" || plano.acao === "enviando") return;
      mostrarEstado(plano.mensagem, plano.tipo);
    }
    if (plano.acao === "enviado") {
      mostrarLink(plano.link);
      if (plano.trabalhoId) await seguirTrabalho(plano.trabalhoId);
    }
  } catch {
    // Consulta falhou: o cartão fica como está.
  }
}

app.ontoolresult = (resultado) => {
  geracao++;
  const bruto = resultado.structuredContent || {};
  const meta = resultado._meta || {};
  // Prévia nova: em `_meta.previa`. Sem ela (servidor antigo), o próprio `structuredContent`.
  const sc = meta.previa && typeof meta.previa === "object" ? { ...meta.previa, pedido: bruto.pedido } : bruto;
  if (!sc.pedido || !meta.codigo) {
    // Resultado sem prévia (erro, janela do Mac etc.): mostra o texto e mais nada.
    const bloco = $("previa");
    bloco.replaceChildren(el("p", "estado", textoDoResultado(resultado) || "Sem prévia para mostrar."));
    $("esqueleto").hidden = true;
    bloco.hidden = false;
    return;
  }
  const edicao = sc.texto_editavel && typeof sc.texto_editavel.limite === "number" && typeof sc.texto === "string" ? sc.texto_editavel : null;
  pedido = { id: sc.pedido, codigo: meta.codigo, original: typeof sc.texto === "string" ? sc.texto : null, edicao };
  desenhar(sc, meta);
  ajustarPeloEstado(geracao);
};
app.onhostcontextchanged = (ctx) => aplicarContexto(ctx);

await app.connect();
aplicarContexto(app.getHostContext());
