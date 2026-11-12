// O cartão calcula o SHA-256 em JavaScript puro (iframe isolado, sem crypto.subtle). Confere contra o node:crypto.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { sha256Hex } from "../ui/sha256.js";

const referencia = (texto: string): string => createHash("sha256").update(texto, "utf8").digest("hex");

describe("SHA-256 do cartão", () => {
  it("bate com o node:crypto em textos vazios, curtos, com acento, emoji e vários blocos", () => {
    const casos = [
      "",
      "abc",
      "Olá, mundo! Ação, coração, não.",
      "Obrigado 😀🙏🏽 pelo carinho 🇧🇷",
      "linha 1\nlinha 2\r\nlinha 3\ttab",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(65),
      "Texto longo com acentuação ção ã é ü 🎉 ".repeat(200),
      "0123456789abcdef".repeat(2) + "\n" + "texto editado com emoji 🚀",
      "\u{10FFFF}\u0000￿",
    ];
    for (const caso of casos) assert.equal(sha256Hex(caso), referencia(caso), JSON.stringify(caso.slice(0, 30)));
  });

  it("valor conhecido: SHA-256 de 'abc'", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
