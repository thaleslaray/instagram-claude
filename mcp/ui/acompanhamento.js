// Acompanhamento de uma publicação em segundo plano (vídeo), sem tocar no DOM, para dar para testar no Node.
// Depois do clique, se `ig_confirmar_tela` devolveu "processando" com um trabalho_id, o cartão consulta
// `ig_status_publicacao` a cada 5 s e mostra o passo, até publicar, falhar ou passar de 6 minutos.

export const INTERVALO_MS = 5_000;
export const LIMITE_MS = 6 * 60_000;
export const MAX_FALHAS_SEGUIDAS = 3;

/** Texto do passo, pelo estado do trabalho (os estados vêm de src/trabalhos.ts). */
export function fraseDoPasso(estado) {
  if (estado === "hospedando" || estado === "criando_containers") return "Enviando o vídeo para a Meta…";
  if (estado === "processando") return "A Meta está processando o vídeo…";
  if (estado === "publicando") return "Publicando…";
  return "";
}

const ID_DE_TRABALHO = /^t_[0-9a-f]+$/;

function textoDe(r) {
  const bloco = r && Array.isArray(r.content) ? r.content.find((c) => c && c.type === "text") : null;
  return bloco && typeof bloco.text === "string" ? bloco.text : "";
}

/**
 * O trabalho em andamento no resultado do clique: `{ trabalhoId }`, ou null se a publicação não ficou em segundo plano.
 * Tenta primeiro o structuredContent; se ele não der um trabalho_id válido (ausente, `{}`, `resultado` sem `estado`,
 * id estranho), tenta o texto. O texto só vale se for o de "processando" de fraseDePronto (src/escrita.ts), que tem
 * DUAS marcas juntas: "está processando" e "trabalho_id t_<10 hex>". O "Pronto" de foto não tem nenhuma das duas,
 * e uma só marca solta (um id citado numa legenda, por exemplo) não basta para sair acompanhando.
 */
export function extrairTrabalho(r) {
  const dados = r && r.structuredContent && r.structuredContent.resultado;
  if (dados && dados.estado === "processando" && typeof dados.trabalho_id === "string" && ID_DE_TRABALHO.test(dados.trabalho_id)) {
    return { trabalhoId: dados.trabalho_id };
  }
  // Um estruturado que diz outra coisa (publicado, falhou) manda: não procura no texto.
  if (dados && typeof dados.estado === "string" && dados.estado !== "processando") return null;
  const texto = textoDe(r);
  if (/\best[áa] processando\b/i.test(texto)) {
    const achado = /\btrabalho_id (t_[0-9a-f]{10})\b/.exec(texto);
    if (achado) return { trabalhoId: achado[1] };
  }
  return null;
}

/**
 * Para o diagnóstico: o resultado do clique parece de "processando" (o texto cita um trabalho_id, ou o estruturado
 * diz "processando") mas `extrairTrabalho` não achou nada? Devolve `{ trabalhoId, motivo }` (trabalhoId "" se nem o
 * texto o traz); null quando não há o que diagnosticar. O motivo não leva dados do pedido, só o formato.
 */
export function diagnosticarSemTrabalho(r) {
  if (extrairTrabalho(r)) return null;
  const texto = textoDe(r);
  const achado = /\bt_[0-9a-f]{10}\b/.exec(texto);
  const citaTrabalho = /trabalho_id/.test(texto) && achado !== null;
  const dados = r && r.structuredContent && r.structuredContent.resultado;
  const estruturadoProcessando = Boolean(dados && dados.estado === "processando");
  if (!citaTrabalho && !estruturadoProcessando) return null;
  const motivo = estruturadoProcessando
    ? "resultado estruturado diz processando, mas sem trabalho_id válido"
    : "o texto cita um trabalho_id, mas não tem o formato de processando nem structuredContent válido";
  return { trabalhoId: citaTrabalho ? achado[0] : "", motivo };
}

function link(url) {
  return typeof url === "string" && /^https:\/\//.test(url) ? url : "";
}

/**
 * Consulta de 5 em 5 s. `consultar()` devolve o resultado cru de `ig_status_publicacao` (ou lança);
 * `mostrar(texto, tipo)` atualiza a linha de estado do cartão; `esperar(ms)` e `agora()` existem para os testes.
 * Devolve `{ fim: "publicado" | "falhou" | "tempo" | "sem_consulta", permalink }`.
 */
export async function acompanhar({ trabalhoId, pedidoId, consultar, mostrar, esperar, agora }) {
  const inicio = agora();
  let falhasSeguidas = 0;
  mostrar(fraseDoPasso("criando_containers"), "");
  for (;;) {
    let dados = null;
    try {
      const r = await consultar();
      const sc = r && !r.isError ? r.structuredContent : null;
      if (sc && typeof sc.estado === "string") dados = sc;
    } catch {
      dados = null;
    }
    if (dados === null) {
      falhasSeguidas++;
      if (falhasSeguidas >= MAX_FALHAS_SEGUIDAS) {
        mostrar("Não consegui acompanhar. Peça ao Claude o status com o trabalho_id " + trabalhoId + ".", "erro");
        return { fim: "sem_consulta", permalink: "" };
      }
    } else {
      falhasSeguidas = 0;
      if (dados.estado === "publicado") {
        mostrar("Pronto (pedido " + pedidoId + "): publicado no Instagram.", "ok");
        return { fim: "publicado", permalink: link(dados.permalink) };
      }
      if (dados.estado === "falhou") {
        mostrar(typeof dados.erro === "string" && dados.erro !== "" ? dados.erro : "A publicação falhou. Nada foi publicado.", "erro");
        return { fim: "falhou", permalink: "" };
      }
      const frase = fraseDoPasso(dados.estado);
      if (frase !== "") {
        mostrar(frase, "");
      }
    }
    await esperar(INTERVALO_MS);
    if (agora() - inicio >= LIMITE_MS) {
      mostrar("Ainda processando. Peça ao Claude o status com o trabalho_id " + trabalhoId + ".", "");
      return { fim: "tempo", permalink: "" };
    }
  }
}
