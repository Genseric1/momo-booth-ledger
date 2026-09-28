/* Generates the PWA icons — a notebook page with a gold M — as real PNGs,
   with a 4x supersampled rasteriser so nothing extra has to be installed.
   Run: npm run icons                                                        */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const PAPER = [0xF7, 0xF4, 0xEA], INK = [0x16, 0x26, 0x3B], GOLD = [0xA8, 0x80, 0x1F];
const RULE = [0xDF, 0xD8, 0xC4], MARGIN = [0xD9, 0x8A, 0x80];

const SS = 4;                                  // supersampling factor

function icon(size, { maskable = false } = {}) {
  const S = size * SS;
  const px = new Float64Array(S * S * 4);
  const put = (x, y, [r, g, b], a = 1) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    px[i] = px[i] * (1 - a) + r * a;
    px[i + 1] = px[i + 1] * (1 - a) + g * a;
    px[i + 2] = px[i + 2] * (1 - a) + b * a;
    px[i + 3] = Math.max(px[i + 3], a * 255);
  };
  const rect = (x, y, w, h, c, a = 1) => {
    for (let j = Math.round(y); j < Math.round(y + h); j++)
      for (let i = Math.round(x); i < Math.round(x + w); i++) put(i, j, c, a);
  };
  /* rounded square page */
  const pad = maskable ? S * 0.14 : S * 0.05;
  const r = (S - pad * 2) * (maskable ? 0.22 : 0.19);
  const x0 = pad, y0 = pad, x1 = S - pad, y1 = S - pad;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      put(x, y, PAPER);
    }
  }
  /* ruled lines + red margin, like the notebook it replaces */
  const inner = x1 - x0;
  for (let k = 1; k <= 7; k++) rect(x0 + inner * 0.10, y0 + (inner * k) / 8, inner * 0.80, Math.max(1, S * 0.006), RULE);
  rect(x0 + inner * 0.22, y0 + inner * 0.08, Math.max(1, S * 0.008), inner * 0.84, MARGIN);

  /* gold M: two uprights and a V, drawn as thick segments */
  const seg = (ax, ay, bx, by, wid) => {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
      rect(cx - wid / 2, cy - wid / 2, wid, wid, GOLD);
    }
  };
  const mw = inner * 0.44, mh = inner * 0.34;
  const mx = x0 + inner * 0.34, my = y0 + inner * 0.33;
  const t = inner * 0.075;
  seg(mx, my + mh, mx, my, t);
  seg(mx, my, mx + mw / 2, my + mh * 0.62, t);
  seg(mx + mw / 2, my + mh * 0.62, mx + mw, my, t);
  seg(mx + mw, my, mx + mw, my + mh, t);
  /* a dark base line, the "ledger total" stroke */
  rect(mx - inner * 0.02, my + mh + inner * 0.07, mw + inner * 0.04, Math.max(2, S * 0.018), INK);

  /* downsample */
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r0 = 0, g0 = 0, b0 = 0, a0 = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * S + x * SS + dx) * 4;
        r0 += px[i]; g0 += px[i + 1]; b0 += px[i + 2]; a0 += px[i + 3];
      }
      const n = SS * SS, o = (y * size + x) * 4;
      out[o] = r0 / n; out[o + 1] = g0 / n; out[o + 2] = b0 / n; out[o + 3] = a0 / n;
    }
  }
  return png(out, size, size);
}

/* ── minimal PNG encoder ── */
function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return c ^ -1;
}

const dir = new URL('../icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', dir), icon(192));
writeFileSync(new URL('icon-512.png', dir), icon(512));
writeFileSync(new URL('icon-maskable-512.png', dir), icon(512, { maskable: true }));
console.log('icons written');
