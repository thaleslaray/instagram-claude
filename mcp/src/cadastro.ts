// Cadastro de segredos no Keychain (`npm run guardar-token`).
//
// Regras que vieram de um tropeço real (diário, P7):
// - O pedido de senha interativo do `security add-generic-password -w` CORTA o valor em 128
//   caracteres, e o token da Meta tem uns 250. Por isso o valor NUNCA vai no argv nem no pedido:
//   o comando inteiro segue pela ENTRADA PADRÃO do `security -i`, o que também o mantém fora
//   da lista de processos.
// - Depois de gravar, o valor é lido de volta e comparado antes de dizer que deu certo.
// - O valor vem da área de transferência (pbpaste) e ela é limpa no fim.
// - Nada aqui imprime um segredo.

import {
  CONTA_TOKEN,
  CofreKeychain,
  conferirNomeKeychain,
  SERVICO_KEYCHAIN,
} from "./cofre.ts";
import { lerConfig, type Config } from "./config.ts";
import { ClienteGraph } from "./graph.ts";
import { limpar, registrar } from "./segredos.ts";
import { executarReal, type Executor } from "./sistema.ts";

/** Erro com mensagem própria para o terminal, sem valor de segredo. */
export class ErroCadastro extends Error {
  override name = "ErroCadastro";
}

export const PADRAO_TOKEN = /^EAA[A-Za-z0-9]+$/;

export interface DependenciasCadastro {
  executar?: Executor;
  /** Para onde vão as mensagens (padrão: stdout). */
  escrever?: (linha: string) => void;
  /** Serviço do Keychain (padrão `instagram-mcp`; só os testes trocam). */
  servico?: string;
}

type DepsResolvidas = Required<DependenciasCadastro>;

function resolver(deps: DependenciasCadastro): DepsResolvidas {
  return {
    executar: deps.executar ?? executarReal,
    escrever: deps.escrever ?? ((linha) => console.log(linha)),
    servico: deps.servico ?? SERVICO_KEYCHAIN,
  };
}

export async function lerDaAreaDeTransferencia(executar: Executor): Promise<string> {
  const r = await executar("pbpaste", []);
  if (r.codigo !== 0) throw new ErroCadastro("Não consegui ler a área de transferência (pbpaste falhou).");
  return r.stdout.trim();
}

/** Esvazia a área de transferência. Falha aqui não derruba o cadastro, mas é avisada. */
export async function limparAreaDeTransferencia(executar: Executor): Promise<boolean> {
  try {
    const r = await executar("pbcopy", [], "");
    return r.codigo === 0;
  } catch {
    return false;
  }
}

/**
 * Grava no Keychain pela entrada padrão do `security -i`, lê de volta e compara.
 * O valor só pode ter caracteres sem aspas, barra ou espaço (o padrão do token já garante).
 */
export async function gravarNoKeychain(conta: string, valor: string, deps: DependenciasCadastro = {}): Promise<void> {
  const { executar, servico } = resolver(deps);
  conferirNomeKeychain(conta);
  conferirNomeKeychain(servico);
  if (valor === "" || /["'\\\s\u0000-\u001f]/.test(valor)) {
    throw new ErroCadastro("O valor tem caracteres que não posso gravar com segurança. Nada foi guardado.");
  }
  registrar(valor);
  const comando = `add-generic-password -U -s ${servico} -a ${conta} -w "${valor}"\n`;
  const gravacao = await executar("security", ["-i"], comando);
  if (gravacao.codigo !== 0 || gravacao.stderr.trim() !== "") {
    // A mensagem do `security` pode ecoar o comando (e o valor): fica de fora.
    throw new ErroCadastro(`O security recusou gravar ${conta} (a mensagem dele foi omitida para não arriscar mostrar o valor).`);
  }
  const lido = await new CofreKeychain({ executar, servico }).ler(conta);
  if (lido !== valor) {
    throw new ErroCadastro(`Gravei ${conta}, mas o valor lido de volta é diferente. Nada foi confirmado.`);
  }
}

/** Passo 1 de qualquer cadastro: pega da área de transferência e confere o formato. */
async function valorDaAreaDeTransferencia(nome: string, padrao: RegExp, dicaFormato: string, executar: Executor): Promise<string> {
  const valor = await lerDaAreaDeTransferencia(executar);
  if (!padrao.test(valor)) {
    throw new ErroCadastro(`A área de transferência não tem ${nome} (${dicaFormato}). Copie o valor certo e rode de novo. Nada foi guardado.`);
  }
  registrar(valor);
  return valor;
}

export interface OpcoesCadastroToken extends DependenciasCadastro {
  /** Variáveis de ambiente (para IG_ACCOUNT_ID, IG_GRAPH_VERSION). Padrão: process.env. */
  env?: Record<string, string | undefined>;
}

/** Resultado do cadastro do token: 0 tudo certo, 1 problema. */
export async function cadastrarToken(opcoes: OpcoesCadastroToken = {}): Promise<number> {
  const deps = resolver(opcoes);
  const env = opcoes.env ?? process.env;
  const dizer = (linha: string) => deps.escrever(limpar(linha));
  let valor: string;
  try {
    valor = await valorDaAreaDeTransferencia("um token da Meta", PADRAO_TOKEN, "começa com EAA, só letras e números", deps.executar);
  } catch (erro) {
    dizer(erro instanceof Error ? erro.message : String(erro));
    return 1;
  }
  try {
    await gravarNoKeychain(CONTA_TOKEN, valor, deps);
  } catch (erro) {
    dizer(erro instanceof Error ? erro.message : String(erro));
    return 1;
  } finally {
    if (!(await limparAreaDeTransferencia(deps.executar))) dizer("Aviso: não consegui limpar a área de transferência. Limpe você mesmo (copie qualquer texto).");
  }
  dizer(`Token guardado e conferido no Keychain (${valor.length} caracteres). Área de transferência limpa.`);

  const idConfigurado = env.IG_ACCOUNT_ID?.trim() ?? "";
  if (idConfigurado === "") {
    dizer("Não testei o token na Meta porque IG_ACCOUNT_ID não está definido. Para testar já na gravação: IG_ACCOUNT_ID=<IG ID da conta> npm run guardar-token.");
    return 0;
  }
  let config: Config;
  try {
    config = lerConfig(env);
  } catch (erro) {
    dizer(`Token guardado, mas não consegui testá-lo na Meta: ${erro instanceof Error ? erro.message : String(erro)}`);
    return 1;
  }
  try {
    const graph = new ClienteGraph({ config, cofre: new CofreKeychain({ executar: deps.executar, servico: deps.servico }) });
    const conta = await graph.get<{ username?: string }>(config.contaId, { fields: "username" });
    dizer(`Token guardado e funcionando para @${conta.username ?? "(sem username)"}.`);
    return 0;
  } catch (erro) {
    dizer(`Token guardado, mas a Meta não o aceitou agora: ${erro instanceof Error ? erro.message : String(erro)}`);
    return 1;
  }
}
