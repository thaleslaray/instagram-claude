// `npm run conferir`: leituras reais, SÓ DE LEITURA, em v27.0 e v26.0, com tabela no fim.
// Imprime contagens, nunca conteúdo de DM. Variáveis opcionais:
//   IG_CONFERIR_VERSOES=v27.0,v26.0   IG_CONFERIR_PERFIL_PUBLICO=bluebottle

import { escolherCofre } from "../src/cofre.ts";
import { conferir, formatarTabela, PERFIL_PUBLICO_PADRAO, VERSOES_PADRAO } from "../src/conferencia.ts";
import { lerConfig } from "../src/config.ts";

try {
  const config = lerConfig();
  const versoes = (process.env.IG_CONFERIR_VERSOES ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const resultado = await conferir({
    config,
    cofre: escolherCofre(config),
    versoes: versoes.length > 0 ? versoes : VERSOES_PADRAO,
    perfilPublico: process.env.IG_CONFERIR_PERFIL_PUBLICO?.trim() || PERFIL_PUBLICO_PADRAO,
  });
  console.log(formatarTabela(resultado));
  process.exitCode = resultado.ok ? 0 : 1;
} catch (erro) {
  console.log(`FALHA  configuração: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exitCode = 1;
}
