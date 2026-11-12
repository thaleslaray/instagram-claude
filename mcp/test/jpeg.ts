// JPEG mínimo para os testes.

/** JPEG mínimo com um marcador SOF0 (só o cabeçalho, o bastante para ler as dimensões). */
export function jpeg(largura: number, altura: number, extra = 0): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(altura, 5);
  sof.writeUInt16BE(largura, 7);
  sof[9] = 3;
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(9)]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9]), Buffer.alloc(extra)]);
}

