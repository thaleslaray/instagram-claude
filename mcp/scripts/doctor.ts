// `npm run doctor`: confere config, token, conta, permissões e a chave do Uploadcare, só lendo.

import { escolherCofre } from "../src/cofre.ts";
import { lerCampo, lerConfig } from "../src/config.ts";
import { rodarDoctor } from "../src/doctor.ts";
import { ClienteGraph } from "../src/graph.ts";
import { lerPolitica } from "../src/perfis.ts";

try {
  const config = lerConfig();
  const cofre = escolherCofre(config);
  process.exitCode = await rodarDoctor({
    contexto: { config, graph: new ClienteGraph({ config, cofre }), cofre, conta: { arroba: null } },
    politica: lerPolitica(),
    uploadcare: lerCampo(process.env, "IG_UPLOADCARE_PUBLIC_KEY") !== "",
  });
} catch (erro) {
  console.log(`FALHA  configuração: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exitCode = 1;
}
