// `npm run doctor`: a mesma checagem do ig_estado_do_token pelo terminal, mais a chave pública do Uploadcare.
// Sai com 0 se estiver tudo saudável e com 1 se algo falhar. Uploadcare sem chave é só AVISO (é opcional). Só lê; nunca escreve nada.

import { verificarEstado, type ContextoDoEstado } from "./estado.ts";
import type { Politica } from "./perfis.ts";
import { limpar } from "./segredos.ts";

export interface EntradaDoctor {
  contexto: ContextoDoEstado;
  politica: Politica;
  /** A chave pública do Uploadcare está configurada (IG_UPLOADCARE_PUBLIC_KEY)? */
  uploadcare: boolean;
  /** Para onde vai cada linha (padrão: stdout). */
  escrever?: (linha: string) => void;
}

/** Devolve o código de saída: 0 saudável, 1 com problema. */
export async function rodarDoctor(entrada: EntradaDoctor): Promise<number> {
  const escrever = entrada.escrever ?? ((linha: string) => process.stdout.write(`${linha}\n`));
  let falhas = 0;
  const linha = (ok: boolean, texto: string) => {
    if (!ok) falhas++;
    escrever(`${ok ? "OK    " : "FALHA "} ${limpar(texto)}`);
  };

  const estado = await verificarEstado(entrada.contexto, entrada.politica);
  linha(estado.keychain.token_cadastrado, estado.keychain.token_cadastrado ? "token no Keychain" : "token não cadastrado (`npm run guardar-token`)");
  if (estado.conta) linha("username" in estado.conta, "username" in estado.conta ? `conta @${estado.conta.username} (${estado.conta.id})` : `conta: ${estado.conta.erro}`);
  if (estado.permissoes) {
    linha("concedidas" in estado.permissoes, "concedidas" in estado.permissoes ? `permissões: ${estado.permissoes.concedidas.join(", ") || "(nenhuma)"}` : `permissões: ${estado.permissoes.erro}`);
  }
  escrever(`INFO   Graph ${estado.graph_versao}, perfil ${estado.perfil}${estado.grupos_so_leitura.length ? `, só leitura em ${estado.grupos_so_leitura.join(", ")}` : ""}`);

  if (entrada.uploadcare) escrever("INFO   Uploadcare: chave pública configurada (foto do computador liberada)");
  else {
    escrever("AVISO  Uploadcare: sem chave pública (opcional, só para foto do computador). Vídeo do computador e mídia por endereço https funcionam sem ela.");
  }

  escrever(falhas === 0 ? "Tudo saudável." : `${falhas} problema(s) encontrado(s).`);
  return falhas === 0 ? 0 : 1;
}
