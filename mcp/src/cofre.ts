// De onde vem cada segredo (spec 5.1), em ordem:
// 1. Os campos seguros do Claude Desktop (`.mcpb`, `"sensitive": true`): o Desktop guarda o valor
//    no cofre do sistema (Mac ou Windows) e entrega ao servidor como IG_TOKEN. Decisão do autor em 10/11/2026: o .mcpb é o caminho principal.
// 2. O Keychain do macOS, serviço `instagram-mcp` (instalação pelo `~/.claude.json` + `guardar-token`).
// Nada de .env nem parâmetro de ferramenta. `IG_TESTE_TOKEN` só vale com a Graph falsa em 127.0.0.1.

import { ehBaseLocal, ehExtensao, ErroConfig, lerCampo, type Config } from "./config.ts";
import { registrar } from "./segredos.ts";
import { executarReal, type Executor } from "./sistema.ts";

export const SERVICO_KEYCHAIN = "instagram-mcp";
export const CONTA_TOKEN = "token-suat";

export interface Cofre {
  /** Devolve o valor guardado para a conta, ou null quando ainda não foi cadastrado. */
  ler(conta: string): Promise<string | null>;
}

export const MENSAGEM_SEM_TOKEN = "Token não cadastrado: rode `npm run guardar-token` no terminal.";
export const MENSAGEM_SEM_TOKEN_NA_EXTENSAO = "Token não cadastrado: abra as configurações da extensão Instagram no Claude Desktop e cole o token no campo dele.";

/** A frase de "sem token" que serve à instalação (extensão ou terminal). */
export const mensagemSemToken = (): string => (ehExtensao() ? MENSAGEM_SEM_TOKEN_NA_EXTENSAO : MENSAGEM_SEM_TOKEN);

/** Nomes de conta e de serviço do Keychain: letras minúsculas, números, hífen. Nada que vire opção do `security`. */
const NOME_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function conferirNomeKeychain(nome: string): string {
  if (!NOME_SEGURO.test(nome)) throw new Error(`Nome inválido para o Keychain: ${nome}`);
  return nome;
}

/** Cofre em memória: usado pelos testes e pelo autoteste. */
export class CofreEmMemoria implements Cofre {
  #token: string | null;
  #outros: Record<string, string>;
  constructor(token: string | null, outros: Record<string, string> = {}) {
    this.#token = token;
    this.#outros = outros;
    registrar(token);
    for (const valor of Object.values(outros)) registrar(valor);
  }
  async ler(conta: string): Promise<string | null> {
    if (conta === CONTA_TOKEN) return this.#token;
    return this.#outros[conta] ?? null;
  }
}

export interface OpcoesKeychain {
  /** Troca o `execFile` (testes). */
  executar?: Executor;
  /** Serviço do Keychain. Só os testes trocam. */
  servico?: string;
}

/** `security find-generic-password` do macOS. Sem shell; o valor só existe em memória. */
export class CofreKeychain implements Cofre {
  #executar: Executor;
  #servico: string;
  constructor(opcoes: OpcoesKeychain = {}) {
    this.#executar = opcoes.executar ?? executarReal;
    this.#servico = conferirNomeKeychain(opcoes.servico ?? SERVICO_KEYCHAIN);
  }

  async ler(conta: string): Promise<string | null> {
    conferirNomeKeychain(conta);
    const resultado = await this.#executar("security", ["find-generic-password", "-s", this.#servico, "-a", conta, "-w"]);
    // 44 = item ausente (errSecItemNotFound): não é falha, é "ainda não cadastrado".
    if (resultado.codigo === 44) return null;
    if (resultado.codigo !== 0) {
      // A saída do `security` fica de fora da mensagem de propósito.
      throw new Error(`Não consegui ler o Keychain (security saiu com código ${resultado.codigo}). Confira se o Mac está desbloqueado.`);
    }
    const valor = resultado.stdout.replace(/\r?\n$/, "");
    if (valor === "") return null;
    registrar(valor);
    return valor;
  }
}

type Ambiente = Record<string, string | undefined>;

/** Valor de um campo do Desktop: vazio, só espaços ou o marcador não substituído (`${user_config.X}`) contam como ausentes. */
function campoDoDesktop(env: Ambiente, nome: string): string | null {
  return lerCampo(env, nome) || null;
}

/** O token vindo do campo seguro do `.mcpb`. Sem ele, devolve null e o Keychain decide. */
export function cofreDosCamposDoDesktop(env: Ambiente): CofreEmMemoria | null {
  const token = campoDoDesktop(env, "IG_TOKEN");
  if (token === null) return null;
  if (!token.startsWith("EAA")) {
    throw new ErroConfig(
      "O campo \"Token do Instagram\" não parece um token da Meta (todo token começa com EAA). " +
        "Gere de novo no painel da Meta e cole no campo da extensão, em Configurações > Extensões.",
    );
  }
  return new CofreEmMemoria(token);
}

/**
 * Escolhe o cofre na partida.
 * `IG_TESTE_TOKEN` e `IG_KEYCHAIN_SERVICO` existem só para os testes e o autoteste: são aceitos
 * SÓ quando `IG_GRAPH_BASE` aponta para 127.0.0.1 (a Graph falsa). Fora disso a partida falha,
 * para nunca mandar um token de variável de ambiente para a Meta.
 */
export function escolherCofre(config: Config, env: Ambiente = process.env, executar?: Executor): Cofre {
  const doDesktop = cofreDosCamposDoDesktop(env);
  if (doDesktop) return doDesktop;
  const tokenTeste = env.IG_TESTE_TOKEN;
  if (tokenTeste !== undefined && tokenTeste !== "") {
    if (!ehBaseLocal(config.graphBase)) {
      throw new ErroConfig(
        "IG_TESTE_TOKEN só vale nos testes, com IG_GRAPH_BASE apontando para http://127.0.0.1. " +
          "Tire essa variável da configuração: o token de verdade fica no Keychain (`npm run guardar-token`).",
      );
    }
    return new CofreEmMemoria(tokenTeste);
  }
  const servico = env.IG_KEYCHAIN_SERVICO;
  if (servico !== undefined && servico !== "") {
    if (!ehBaseLocal(config.graphBase)) {
      throw new ErroConfig(
        "IG_KEYCHAIN_SERVICO só vale nos testes, com IG_GRAPH_BASE apontando para http://127.0.0.1. Tire essa variável da configuração.",
      );
    }
    if (!NOME_SEGURO.test(servico)) throw new ErroConfig(`IG_KEYCHAIN_SERVICO inválido (${servico}).`);
    return new CofreKeychain({ servico, ...(executar ? { executar } : {}) });
  }
  return new CofreKeychain(executar ? { executar } : {});
}
