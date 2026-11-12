// Ajudantes comuns às ferramentas: uma versão só de cada coisa que antes aparecia copiada em vários grupos.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as z from "zod/v4";
import type { Contexto } from "../contexto.ts";

/** IDs entram no caminho da URL: só caracteres de ID da Graph, nunca `/`, `?` ou `#`. */
export const IdSchema = z.string().min(1).max(300).regex(/^[A-Za-z0-9_\-=.:]+$/, "ID inválido: só letras, números e _ - = . :");

/** IGSID de quem escreveu para a conta: só dígitos, de 5 a 30. A frase diz a regra inteira. */
export const IgsidSchema = z.string().regex(/^\d{5,30}$/, "O IGSID precisa ter só dígitos, de 5 a 30 (por exemplo, 17841400000000001)");

/** Tira as chaves com valor `undefined` (a Graph e o `structuredContent` não querem campo vazio). */
export const semVazios = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** `~` e `~/…` viram a pasta do usuário; o resultado é sempre absoluto. */
export function expandirCaminho(entrada: string): string {
  return resolve(entrada.startsWith("~/") ? join(homedir(), entrada.slice(2)) : entrada === "~" ? homedir() : entrada);
}

/** Nome da conta para prévias e frases: `@fulano`, ou `a conta <id>` enquanto o @ não foi conferido. */
export function nomeDaConta(ctx: Contexto): string {
  return ctx.conta.arroba ? `@${ctx.conta.arroba}` : `a conta ${ctx.config.contaId}`;
}
