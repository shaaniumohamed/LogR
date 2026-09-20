/**
 * Draws the app icon and writes it at the sizes a home screen asks for.
 *
 * Written by hand rather than pulled from an image library because the icon is
 * three rectangles and a background, and a dependency that exists to draw three
 * rectangles is a dependency that will need updating for the next decade. Every
 * shape is supersampled four times and box-filtered down, which is where the
 * smooth edges come from.
 *
 * Run with `node scripts/make-icons.mjs` after changing anything here.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [11, 11, 13];        // --plane, dark
const PROFIT = [27, 175, 122];  // --profit
const LOSS = [227, 73, 72];     // --loss
const SS = 4;                   // supersampling factor

/** Signed coverage of a rounded rectangle, in unit coordinates. */
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x - 0, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y - 0, y1 - r));
  if (x >= x0 + r && x <= x1 - r) return y >= y0 && y <= y1;
  if (y >= y0 + r && y <= y1 - r) return x >= x0 && x <= x1;
  const qx = x < x0 + r ? x0 + r : x1 - r;
  const qy = y < y0 + r ? y0 + r : y1 - r;
  return (x - qx) ** 2 + (y - qy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
  void cx; void cy;
}

/**
 * Three candles, rising, with the first one red.
 *
 * A wordmark would be clearer at forty pixels and says nothing about what the
 * app is. Candles are the one shape every trader recognises instantly, and they
 * survive being shrunk because they are solid blocks rather than strokes.
 *
 * `inset` pushes the drawing inward for the maskable version, where a launcher
 * is free to crop the corners off.
 */
function drawIcon(size, { inset = 0.0, rounded = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const s = size;
  const pad = 0.5 * inset;

  // Candle geometry in unit coordinates, inside the safe area.
  const area = { x0: 0.18 + pad, x1: 0.82 - pad, y0: 0.2 + pad, y1: 0.8 - pad };
  const w = area.x1 - area.x0;
  const h = area.y1 - area.y0;
  const bodyW = w * 0.2;
  const wickW = w * 0.055;

  const candles = [
    { cx: area.x0 + w * 0.11, top: 0.46, bottom: 0.78, wickTop: 0.38, wickBottom: 0.88, up: false },
    { cx: area.x0 + w * 0.5,  top: 0.30, bottom: 0.62, wickTop: 0.22, wickBottom: 0.72, up: true },
    { cx: area.x0 + w * 0.89, top: 0.12, bottom: 0.44, wickTop: 0.06, wickBottom: 0.54, up: true },
  ].map((c) => ({
    ...c,
    top: area.y0 + h * c.top, bottom: area.y0 + h * c.bottom,
    wickTop: area.y0 + h * c.wickTop, wickBottom: area.y0 + h * c.wickBottom,
  }));

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) / s;
          const uy = (y + (sy + 0.5) / SS) / s;

          const onCanvas = rounded
            ? inRoundedRect(ux, uy, 0, 0, 1, 1, 0.22)
            : true;
          if (!onCanvas) continue;

          let c = BG;
          for (const cd of candles) {
            const colour = cd.up ? PROFIT : LOSS;
            const halfB = bodyW / 2, halfW = wickW / 2;
            const inBody = ux >= cd.cx - halfB && ux <= cd.cx + halfB && uy >= cd.top && uy <= cd.bottom;
            const inWick = ux >= cd.cx - halfW && ux <= cd.cx + halfW && uy >= cd.wickTop && uy <= cd.wickBottom;
            if (inBody || inWick) { c = colour; break; }
          }
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }

      const n = SS * SS;
      const i = (y * s + x) * 4;
      // Premultiplied average, then un-premultiplied, so the rounded edge fades
      // to transparent instead of to black.
      px[i] = a ? Math.round(r / (a / 255)) : 0;
      px[i + 1] = a ? Math.round(g / (a / 255)) : 0;
      px[i + 2] = a ? Math.round(b / (a / 255)) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // truecolour with alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- write */

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
const out = (name, size, opts) => {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size, drawIcon(size, opts)));
  console.log(name, size);
};

out("icon-192.png", 192);
out("icon-512.png", 512);
// Apple crops to its own shape and does not honour transparency, so this one is
// square to the edge and the rounding is left to iOS.
out("apple-icon.png", 180, { rounded: false });
// Android may crop anything outside the inner circle, so the drawing is pulled in.
out("icon-maskable-512.png", 512, { rounded: false, inset: 0.3 });
out("favicon-32.png", 32);
