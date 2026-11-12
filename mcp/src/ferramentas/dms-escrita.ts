// DMs, escrita (spec 4.2, 3.6 e 5.3): ig_responder_dm, ig_enviar_midia_dm e ig_reagir_dm, todas em `POST /{ig}/messages`.
//
// Ordem fixa de responder e mandar mídia: validar a entrada -> janela de 24 h (fechada: recusa, sem prévia) ->
// pedido de confirmação (prévia + clique) -> enviar -> registrar. Nada do arquivo local sai antes do clique:
// depois dele, o arquivo sobe direto para a Meta (`POST /{ig}/message_attachments`, multipart) e a mensagem
// vai com o `attachment_id`. Mídia por `url` https segue como está, sem upload.
// Reagir NÃO abre prévia (dá para desfazer): confere a janela, envia e registra.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { executarEscritaDireta } from "../escrita-direta.ts";
import { IdSchema, IgsidSchema, expandirCaminho, nomeDaConta } from "./comum.ts";
import type { Previa } from "../confirmacao.ts";
import type { Contexto } from "../contexto.ts";
import { janelaDoUsuario, type Janela } from "../janela.ts";
import { conferirExtensaoDaUrl, validarArquivoDeDm, type TipoDeAnexo } from "../midia-dm.ts";
import { sha256DoArquivo } from "../publicacao.ts";
import { registrarEscrita, registrarEscritaDireta, respostaJson } from "../respostas.ts";

export const LIMITE_DE_TEXTO_BYTES = 1000;

/** As regras do texto de uma DM. Valem para a ferramenta e para o texto editado no cartão (ficha 16). */
export function conferirTextoDeDm(texto: string): void {
  const bytes = Buffer.byteLength(texto, "utf8");
  if (texto.trim() === "") throw new Error("O texto está vazio.");
  if (bytes > LIMITE_DE_TEXTO_BYTES) throw new Error(`Texto grande demais: ${bytes} bytes (o limite da Meta é ${LIMITE_DE_TEXTO_BYTES}). Encurte e tente de novo. Nada foi enviado.`);
}

const TIPOS: ReadonlyArray<TipoDeAnexo> = ["image", "video", "audio", "file"];
const ROTULO_DO_TIPO: Record<TipoDeAnexo, string> = { image: "imagem", video: "vídeo", audio: "áudio", file: "arquivo" };

const dataLocal = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dataCompleta = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

interface JanelaAberta {
  conversa_id: string;
  usuario_id: string;
  username: string | null;
  janela: Janela & { aberta: true; ate: string };
  /** `@fulano` ou o IGSID, para as frases e a prévia. */
  nome: string;
}

/** Acha a conversa e confere a janela de 24 h. Recusa sem nada enviado e sem abrir confirmação. */
async function exigirJanelaAberta(ctx: Contexto, usuarioId: string, signal: AbortSignal): Promise<JanelaAberta> {
  const achada = await janelaDoUsuario(ctx, usuarioId, { signal });
  if (!achada.encontrada) {
    throw new Error("Não achei conversa com essa pessoa nas 100 mais recentes. A Meta só deixa responder quem já escreveu para a conta. Nada foi enviado.");
  }
  const nome = achada.username ? `@${achada.username}` : `IGSID ${achada.usuario_id}`;
  const { janela } = achada;
  if (janela.ultima_da_pessoa === null || janela.ate === null) {
    throw new Error(`${nome} nunca escreveu para a conta: a Meta só deixa responder depois que a pessoa escreve. Nada foi enviado.`);
  }
  if (!janela.aberta) {
    throw new Error(
      `Fora da janela de 24 h: a última mensagem de ${nome} foi em ${dataCompleta.format(new Date(janela.ultima_da_pessoa))}. ` +
        `A Meta só permite responder até ${dataCompleta.format(new Date(janela.ate))}. Nada foi enviado.`,
    );
  }
  return { conversa_id: achada.conversa_id, usuario_id: achada.usuario_id, username: achada.username, janela: { ...janela, aberta: true, ate: janela.ate }, nome };
}

const caminhoDeEnvio = (ctx: Contexto): string => `${ctx.config.contaId}/messages`;

/** Corpo exato que vai para a Meta (e que o pedido guarda e confere por hash). */
interface CorpoDeDm {
  recipient: { id: string };
  message: { text: string } | { attachment: { type: TipoDeAnexo; payload: { url: string } | { attachment_id: string } } };
}

/**
 * Anexo do computador: o pedido guarda só o que o arquivo era na prévia (o caminho e o SHA-256). Os bytes sobem
 * depois do clique; se o arquivo mudou, nada é enviado.
 */
interface CorpoDeAnexoLocal {
  recipient: { id: string };
  arquivo_local: { tipo: TipoDeAnexo; caminho: string; mime: string; extensao: string; sha256: string };
}

/** Sobe o anexo direto para a Meta e manda a mensagem com o `attachment_id`. */
async function enviarAnexoLocal(ctx: Contexto, c: CorpoDeAnexoLocal): Promise<Record<string, unknown>> {
  const { tipo, caminho, mime, extensao, sha256 } = c.arquivo_local;
  const bytes = await readFile(caminho);
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new Error(`O arquivo ${basename(caminho)} mudou depois da prévia. Nada foi enviado; peça a prévia de novo.`);
  }
  const formulario = new FormData();
  formulario.set("platform", "instagram");
  formulario.set("message", JSON.stringify({ attachment: { type: tipo } }));
  formulario.set("filedata", new Blob([new Uint8Array(bytes)], { type: mime }), `anexo.${extensao}`);
  const anexo = await ctx.graph.postMultipart<{ attachment_id?: string }>(`${ctx.config.contaId}/message_attachments`, formulario);
  if (typeof anexo.attachment_id !== "string" || anexo.attachment_id === "") {
    throw new Error("A Meta não devolveu o ID do anexo. Nada foi enviado; tente de novo.");
  }
  const corpo: CorpoDeDm = { recipient: c.recipient, message: { attachment: { type: tipo, payload: { attachment_id: anexo.attachment_id } } } };
  return ctx.graph.post<Record<string, unknown>>(caminhoDeEnvio(ctx), corpo as unknown as Record<string, unknown>);
}

function urlHttpsValida(bruta: string): URL {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    throw new Error("A `url` não é um endereço válido.");
  }
  if (url.protocol !== "https:") throw new Error("A `url` precisa começar com https://.");
  if (url.username !== "" || url.password !== "") throw new Error("A `url` não pode ter usuário e senha.");
  return url;
}

export function registrarDmsEscrita(server: McpServer, ctx: Contexto): void {
  registrarEscrita(
    server,
    "ig_responder_dm",
    { destrutiva: false, idempotente: false },
    {
      title: "Responder DM",
      description:
        "Responde com texto uma DM de quem escreveu para a conta (até 1.000 bytes em UTF-8). Só dá para responder até 24 h depois da última mensagem da pessoa: fora disso a ferramenta recusa e não abre prévia. " +
        "Mostra uma prévia ao dono da conta e SÓ envia depois do clique dele; depois da prévia, pare e espere. " +
        'Exemplos: "responde o @fulano com o link do material", "manda um obrigado para quem escreveu agora".',
      inputSchema: z.strictObject({
        usuario_id: IgsidSchema.describe("IGSID da pessoa (o `id` do participante em ig_listar_conversas)"),
        texto: z.string().min(1).describe("Texto da resposta, até 1.000 bytes em UTF-8 (emoji conta 4 bytes)"),
      }),
    },
    async (args, mcp, escrever) => {
      conferirTextoDeDm(args.texto);

      const alvo = await exigirJanelaAberta(ctx, args.usuario_id, mcp.mcpReq.signal);
      const corpo: CorpoDeDm = { recipient: { id: alvo.usuario_id }, message: { text: args.texto } };
      const montarPrevia = (c: CorpoDeDm): Previa => {
        const texto = "text" in c.message ? c.message.text : "";
        return {
          titulo: `Responder DM em nome de ${nomeDaConta(ctx)}`,
          conta: nomeDaConta(ctx),
          alvo: `IGSID ${alvo.usuario_id}`,
          ...(alvo.username ? { conteudo_de_terceiros: { username: `@${alvo.username}` } } : {}),
          texto,
          detalhes: [`Janela aberta até ${dataLocal.format(new Date(alvo.janela.ate))}`, `Tamanho: ${Buffer.byteLength(texto, "utf8")} de ${LIMITE_DE_TEXTO_BYTES} bytes`],
          botao: "Enviar",
        };
      };
      const edicao = {
        limite: LIMITE_DE_TEXTO_BYTES,
        unidade: "bytes" as const,
        comTexto: (novo: string): CorpoDeDm => {
          conferirTextoDeDm(novo);
          return { recipient: corpo.recipient, message: { text: novo } };
        },
      };
      return escrever("ig_responder_dm", corpo, montarPrevia, (c) => ctx.graph.post<Record<string, unknown>>(caminhoDeEnvio(ctx), c as unknown as Record<string, unknown>), edicao);
    },
  );

  registrarEscrita(
    server,
    "ig_enviar_midia_dm",
    { destrutiva: false, idempotente: false },
    {
      title: "Mandar mídia por DM",
      description:
        "Manda uma imagem, vídeo, áudio ou arquivo por DM para quem escreveu para a conta, a partir de um `arquivo` local ou de uma `url` https. " +
        "Formatos: imagem png ou jpeg até 8 MB; vídeo mp4, ogg, avi, mov ou webm até 25 MB; áudio aac, m4a, wav ou mp4 até 25 MB; arquivo só pdf até 25 MB. " +
        "Só dá para mandar até 24 h depois da última mensagem da pessoa: fora disso recusa e não abre prévia. " +
        "O arquivo local só sai do computador depois do clique do dono da conta, e sobe direto para a Meta (não precisa de configuração nenhuma). Mostra uma prévia e SÓ envia depois do clique.",
      inputSchema: z.strictObject({
        usuario_id: IgsidSchema.describe("IGSID da pessoa"),
        tipo: z.enum(["image", "video", "audio", "file"]).describe("Tipo do anexo"),
        arquivo: z.string().min(1).max(1024).optional().describe("Caminho do arquivo no computador (ou use `url`)"),
        url: z.string().min(1).max(2000).optional().describe("Endereço https público da mídia (ou use `arquivo`); é usado como está, sem upload"),
      }),
    },
    async (args, mcp, escrever) => {
      if ((args.arquivo === undefined) === (args.url === undefined)) throw new Error("Passe `arquivo` OU `url`, um dos dois.");
      const tipo: TipoDeAnexo = args.tipo;
      if (!TIPOS.includes(tipo)) throw new Error(`Tipo inválido: ${String(tipo)}.`);

      // 1. validar a entrada
      let origem: string;
      let local: CorpoDeAnexoLocal["arquivo_local"] | null = null;
      let url: string | null = null;
      if (args.arquivo !== undefined) {
        const caminho = expandirCaminho(args.arquivo);
        const { tamanho, formato } = await validarArquivoDeDm(tipo, caminho);
        origem = `Arquivo local: ${basename(caminho)} (${Math.max(1, Math.round(tamanho / 1000))} KB, ${formato.ext})`;
        local = { tipo, caminho, mime: formato.tipo, extensao: formato.ext, sha256: await sha256DoArquivo(caminho) };
      } else {
        const alvoUrl = urlHttpsValida(args.url!);
        conferirExtensaoDaUrl(tipo, alvoUrl);
        url = alvoUrl.toString();
        origem = `URL: ${alvoUrl.origin}${alvoUrl.pathname}${alvoUrl.search ? " (com parâmetros, não mostrados)" : ""}`;
      }

      // 2. janela de 24 h: fechada, recusa sem abrir confirmação
      const alvo = await exigirJanelaAberta(ctx, args.usuario_id, mcp.mcpReq.signal);

      // 3. pedido de confirmação, envio (o anexo sobe só agora) e registro (o pedido grava)
      const montarPrevia = (): Previa => ({
        titulo: `Mandar ${ROTULO_DO_TIPO[tipo]} por DM em nome de ${nomeDaConta(ctx)}`,
        conta: nomeDaConta(ctx),
        alvo: `IGSID ${alvo.usuario_id}`,
        ...(alvo.username ? { conteudo_de_terceiros: { username: `@${alvo.username}` } } : {}),
        detalhes: [`Janela aberta até ${dataLocal.format(new Date(alvo.janela.ate))}`, origem],
        botao: "Enviar",
      });
      if (local !== null) {
        const corpo: CorpoDeAnexoLocal = { recipient: { id: alvo.usuario_id }, arquivo_local: local };
        return escrever("ig_enviar_midia_dm", corpo, montarPrevia, (c) => enviarAnexoLocal(ctx, c));
      }
      const corpo: CorpoDeDm = { recipient: { id: alvo.usuario_id }, message: { attachment: { type: tipo, payload: { url: url! } } } };
      return escrever("ig_enviar_midia_dm", corpo, montarPrevia, (c) => ctx.graph.post<Record<string, unknown>>(caminhoDeEnvio(ctx), c as unknown as Record<string, unknown>));
    },
  );

  registrarEscritaDireta(
    server,
    "ig_reagir_dm",
    { destrutiva: false, idempotente: true },
    {
      title: "Reagir a uma DM",
      description:
        "Reage com um emoji (ou `love`) a uma mensagem da pessoa, ou tira a reação (`remover: true`). Dá para desfazer, então NÃO abre prévia: vai direto e fica no registro de ações. " +
        "Só vale dentro da janela de 24 h da conversa. Passe `reacao` OU `remover: true`. " +
        'Exemplos: "dá um coração na última mensagem do @fulano", "tira a reação".',
      inputSchema: z.strictObject({
        usuario_id: IgsidSchema.describe("IGSID da pessoa"),
        mensagem_id: IdSchema.describe("ID da mensagem a reagir (de ig_ler_conversa)"),
        reacao: z.string().min(1).max(32).optional().describe("Emoji ou `love`; reagir de novo troca a reação"),
        remover: z.boolean().optional().describe("true tira a reação"),
      }),
      outputSchema: z.object({
        acao: z.enum(["react", "unreact"]),
        mensagem_id: z.string(),
        reacao: z.string().optional(),
        resultado: z.record(z.string(), z.unknown()),
      }),
    },
    async (args, mcp) => {
      const remover = args.remover === true;
      if (remover === (args.reacao !== undefined)) throw new Error("Passe `reacao` (para reagir) OU `remover: true` (para tirar a reação), um dos dois.");
      const alvo = await exigirJanelaAberta(ctx, args.usuario_id, mcp.mcpReq.signal);

      const acao = remover ? "unreact" : "react";
      const corpo = {
        recipient: { id: alvo.usuario_id },
        sender_action: acao,
        payload: remover ? { message_id: args.mensagem_id } : { message_id: args.mensagem_id, reaction: args.reacao! },
      };
      const resultado = await executarEscritaDireta(
        ctx,
        {
          ferramenta: "ig_reagir_dm",
          alvo: alvo.username ? `@${alvo.username} (IGSID ${alvo.usuario_id})` : `IGSID ${alvo.usuario_id}`,
          // A API não lê a reação anterior: para desfazer, tire a reação (ou reaja de novo com o emoji antigo, se o dono da conta souber qual era).
          desfazer: remover ? "reagir de novo com o emoji anterior (a API não informa qual era)" : "ig_reagir_dm com remover: true",
          detalhes: { acao, mensagem_id: args.mensagem_id, ...(remover ? {} : { reacao: args.reacao }) },
        },
        () => ctx.graph.post<Record<string, unknown>>(caminhoDeEnvio(ctx), corpo, {}, { signal: mcp.mcpReq.signal }),
      );
      return respostaJson({ acao, mensagem_id: args.mensagem_id, ...(remover ? {} : { reacao: args.reacao }), resultado });
    },
  );
}
