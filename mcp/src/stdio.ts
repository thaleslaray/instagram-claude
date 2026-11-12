#!/usr/bin/env node
// Entrada do servidor por stdio. stdout é do protocolo: todo log vai para stderr.

import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { escolherCofre } from "./cofre.ts";
import { lerConfig, protocoloModerno } from "./config.ts";
import { criarContexto, partida } from "./contexto.ts";
import { ClienteGraph } from "./graph.ts";
import { criarHospedagemDoAmbiente } from "./hospedagem.ts";
import { lerPolitica } from "./perfis.ts";
import { log } from "./log.ts";
import { fabricaDeServidor, NOME_SERVIDOR } from "./servidor.ts";

function iniciar(): void {
  const config = lerConfig();
  const politica = lerPolitica();
  const cofre = escolherCofre(config);
  const hospedagem = criarHospedagemDoAmbiente();
  const ctx = criarContexto(config, new ClienteGraph({ config, cofre }), cofre, hospedagem);
  const fabrica = fabricaDeServidor(ctx, [], { politica });
  const moderno = protocoloModerno();
  if (moderno) {
    serveStdio(fabrica, { onerror: (erro) => log(`[${NOME_SERVIDOR}] ${erro.message}`) });
  } else {
    // Era de 2025 (ver protocoloModerno): um servidor só, ligado direto ao transporte.
    const transporte = new StdioServerTransport();
    transporte.onerror = (erro) => log(`[${NOME_SERVIDOR}] ${erro.message}`);
    void fabrica().connect(transporte);
  }
  log(`[${NOME_SERVIDOR}] no ar por stdio (conta ${config.contaId}, Graph ${config.graphVersao}, perfil ${politica.perfil}, protocolo ${moderno ? "2026 e 2025" : "2025"})`);
  void partida(ctx);
}

try {
  iniciar();
} catch (erro) {
  log(`[${NOME_SERVIDOR}] não iniciou: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exit(1);
}
