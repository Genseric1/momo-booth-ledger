/* ═══════════════ LOCAL ENCRYPTION OF CUSTOMER NUMBERS (spec §9) ═══════════════
   The booth PIN never leaves the device. A PBKDF2 key derived from it encrypts
   customer numbers with AES-GCM before they are stored or synced, so the server
   only ever holds ciphertext. Because the PIN is shared inside the booth, every
   device of the same booth can read them; nothing else can.
   Everything else (amounts, types, balances) stays in clear: it must be usable
   for statistics and stays inside the booth's own rows.                      */

const PREFIX = 'enc:v1:';
let key = null;                     // CryptoKey, held in memory only while unlocked

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const hasKey = () => !!key;
export const lock = () => { key = null; };

/* The salt is the booth id, so the same PIN gives the same key on every device
   of the booth and a different key in another booth. */
export async function unlock(pin, boothId = 'local') {
  const material = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('momo-booth:' + boothId), iterations: 150000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return key;
}

/* PIN check value: stored instead of the PIN itself. */
export async function pinHash(pin, boothId = 'local') {
  const bits = await crypto.subtle.digest('SHA-256', enc.encode(`momo-booth:${boothId}:${pin}`));
  return b64(bits);
}

export async function encryptField(value) {
  if (value == null || value === '') return null;
  if (!key) return String(value);                         // encryption off / no PIN set
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(value)));
  return PREFIX + b64(iv) + ':' + b64(ct);
}

export async function decryptField(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (!s.startsWith(PREFIX)) return s;                    // stored in clear
  if (!key) return null;                                  // locked: show nothing rather than guess
  try {
    const [, , ivB, ctB] = s.split(':');
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB) }, key, unb64(ctB));
    return dec.decode(out);
  } catch { return null; }
}
