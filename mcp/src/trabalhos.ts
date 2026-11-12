// Gerenciador de trabalhos de publicação, só em memória (spec 4.4): guarda o estado de cada publicação
// (containers, horários) para o `ig_status_publicacao` e para o acompanhamento em segundo plano.
// Se o servidor reiniciar, os trabalhos se perdem.

import { randomBytes } from "node:crypto";

export type EstadoDoTrabalho = "hospedando" | "criando_containers" | "processando" | "publicando" | "publicado" | "falhou";

export interface ContainerDoTrabalho {
  id: string;
  /** "IMAGE", "VIDEO" ou "CAROUSEL" (o pai). */
  tipo: string;
  /** Último `status_code` visto (IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED). */
  status_code: string | null;
}

export interface Trabalho {
  id: string;
  /** "post" ou "carrossel". */
  tipo: string;
  estado: EstadoDoTrabalho;
  criadoEm: number;
  atualizadoEm: number;
  containers: ContainerDoTrabalho[];
  midiaId: string | null;
  permalink: string | null;
  /** Motivo da falha, já traduzido e limpo de segredos. */
  erro: string | null;
  avisos: string[];
}

const TERMINAIS: readonly EstadoDoTrabalho[] = ["publicado", "falhou"];
const MANTER_POR_MS = 24 * 3_600_000;

export class Trabalhos {
  readonly #porId = new Map<string, Trabalho>();
  readonly #esperas = new Map<string, Promise<void>>();
  readonly #agora: () => number;

  constructor(agora: () => number = Date.now) {
    this.#agora = agora;
  }

  criar(tipo: string): Trabalho {
    this.#limparVelhos();
    const quando = this.#agora();
    const trabalho: Trabalho = {
      id: `t_${randomBytes(5).toString("hex")}`,
      tipo,
      estado: "hospedando",
      criadoEm: quando,
      atualizadoEm: quando,
      containers: [],
      midiaId: null,
      permalink: null,
      erro: null,
      avisos: [],
    };
    this.#porId.set(trabalho.id, trabalho);
    return trabalho;
  }

  obter(id: string): Trabalho | undefined {
    return this.#porId.get(id);
  }

  mudar(trabalho: Trabalho, estado: EstadoDoTrabalho): void {
    trabalho.estado = estado;
    trabalho.atualizadoEm = this.#agora();
  }

  /** Liga o trabalho à promessa que o executa (para os testes e para quem quiser esperar o fim). */
  acompanhar(id: string, execucao: Promise<void>): void {
    this.#esperas.set(id, execucao);
  }

  /** Espera o trabalho terminar (publicado ou falhou). */
  async aguardar(id: string): Promise<Trabalho | undefined> {
    await this.#esperas.get(id);
    return this.#porId.get(id);
  }

  ehTerminal(trabalho: Trabalho): boolean {
    return TERMINAIS.includes(trabalho.estado);
  }

  #limparVelhos(): void {
    const limite = this.#agora() - MANTER_POR_MS;
    for (const [id, t] of this.#porId) {
      if (this.ehTerminal(t) && t.atualizadoEm < limite) {
        this.#porId.delete(id);
        this.#esperas.delete(id);
      }
    }
  }
}
