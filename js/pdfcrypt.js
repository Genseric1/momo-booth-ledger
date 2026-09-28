/* ═══════════════ MD5 + RC4 — PDF standard security handler ═══════════════
   Only used to password-protect an exported register (spec §8). PDF's own
   encryption is RC4-based; it keeps a casual reader out of a file sent over
   WhatsApp, and that is all it is claimed to do here.                       */

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
           5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
           4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
           6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

export function md5(msg) {
  const len = msg.length;
  const padLen = (((len + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(padLen);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 8, (len * 8) >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor(len / 536870912), true);

  let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
  const M = new Int32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16), ov = new DataView(out.buffer);
  ov.setInt32(0, a0, true); ov.setInt32(4, b0, true); ov.setInt32(8, c0, true); ov.setInt32(12, d0, true);
  return out;
}

export function rc4(key, data) {
  const box = new Uint8Array(256);
  for (let i = 0; i < 256; i++) box[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + box[i] + key[i % key.length]) & 255;
    [box[i], box[j]] = [box[j], box[i]];
  }
  const out = new Uint8Array(data.length);
  let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + box[i]) & 255;
    [box[i], box[j]] = [box[j], box[i]];
    out[k] = data[k] ^ box[(box[i] + box[j]) & 255];
  }
  return out;
}

const PAD = new Uint8Array([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);

const padPwd = (pw) => {
  const b = new Uint8Array(32);
  const s = new TextEncoder().encode(String(pw || '')).slice(0, 32);
  b.set(s); b.set(PAD.slice(0, 32 - s.length), s.length);
  return b;
};
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const le = (n, bytes) => Uint8Array.from({ length: bytes }, (_, i) => (n >> (8 * i)) & 255);

/* Revision 2 / 40-bit standard handler: /V 1 /R 2. */
export function standardSecurity({ userPassword = '', ownerPassword = '', permissions = -44, fileId }) {
  const owner = padPwd(ownerPassword || userPassword);
  const O = rc4(md5(owner).slice(0, 5), padPwd(userPassword));
  const key = md5(cat(padPwd(userPassword), O, le(permissions >>> 0, 4), fileId)).slice(0, 5);
  const U = rc4(key, PAD);
  return {
    O, U, key, permissions,
    objectKey(num, gen = 0) {
      return md5(cat(key, le(num, 3), le(gen, 2))).slice(0, Math.min(key.length + 5, 16));
    },
  };
}
