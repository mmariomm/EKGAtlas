#!/usr/bin/env node
/*
 * Generates the extension icons (16/48/128 px PNG) from scratch:
 * a healthcare-blue rounded square with a white cross.
 * Pure node (zlib + manual PNG chunks), no image libraries.
 * Run:  node tools/icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const crc32 = (buf) => {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Anti-aliased rounded square + cross, colors match the panel (#0B5CAD).
const BLUE = [11, 92, 173], WHITE = [255, 255, 255];
function pixel(x, y, size) {
  const s = size, r = s * 0.22, cx = x + 0.5, cy = y + 0.5;
  // signed distance to rounded rect (inset 1 hairline)
  const inset = s * 0.02;
  const hw = s / 2 - inset, hh = s / 2 - inset;
  const dx = Math.abs(cx - s / 2) - (hw - r), dy = Math.abs(cy - s / 2) - (hh - r);
  const dist = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
  const aa = 1.0;
  const alpha = Math.max(0, Math.min(1, 0.5 - dist / aa));
  if (alpha <= 0) return [0, 0, 0, 0];
  // cross: two bars
  const bar = s * 0.16, len = s * 0.56;
  const inV = Math.abs(cx - s / 2) <= bar / 2 && Math.abs(cy - s / 2) <= len / 2;
  const inH = Math.abs(cy - s / 2) <= bar / 2 && Math.abs(cx - s / 2) <= len / 2;
  const c = inV || inH ? WHITE : BLUE;
  return [c[0], c[1], c[2], Math.round(alpha * 255)];
}

for (const s of [16, 48, 128]) {
  writeFileSync(join(root, `extension/icon${s}.png`), png(s, pixel));
  console.log(`extension/icon${s}.png`);
}
