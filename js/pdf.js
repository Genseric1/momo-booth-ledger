/* ═══════════════ MINIMAL PDF WRITER ═══════════════
   Enough of PDF 1.4 to print a register: Helvetica text with real metrics
   (so columns align), rules, filled boxes, page numbering and optional
   password protection. No dependency, so the export works offline.         */

import { standardSecurity, rc4 } from './pdfcrypt.js';

/* Helvetica / Helvetica-Bold advance widths, 1/1000 em, codes 32..126. */
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
  334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
  722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  333,278,333,584,556,333,
  556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
  389,280,389,584];

/* The font we embed carries plain ASCII, so an accented name is folded rather
   than turned into question marks: Sephora reads, S?phora does not. */
const FOLD = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
  'ç': 'c', 'ñ': 'n', 'ÿ': 'y',
  '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '·': '-', '₵': 'C',
};
const ascii = (s) => String(s ?? '')
  .replace(/[^ -~]/g, (c) => FOLD[c] ?? FOLD[c.toLowerCase()]?.toUpperCase() ?? '?');
export function widthOf(text, size, bold = false) {
  const t = ascii(text), tab = bold ? W_BOLD : W_REG;
  let w = 0;
  for (let i = 0; i < t.length; i++) w += tab[t.charCodeAt(i) - 32] || 500;
  return (w * size) / 1000;
}
const esc = (s) => ascii(s).replace(/([\\()])/g, '\\$1');
const num = (n) => (Math.round(n * 100) / 100).toString();

export const SIZES = { A4: [595.28, 841.89], A4_LANDSCAPE: [841.89, 595.28] };

export class Pdf {
  /* y grows downwards from the top of the page, which is easier to lay out. */
  constructor({ size = 'A4', title = 'Register', author = 'MoMo Booth Ledger', password = '', ownerPassword = '' } = {}) {
    [this.w, this.h] = SIZES[size] || SIZES.A4;
    this.title = title; this.author = author;
    this.password = password; this.ownerPassword = ownerPassword;
    this.pages = []; this.ops = null;
    this.addPage();
  }
  addPage() { this.ops = []; this.pages.push(this.ops); return this.pages.length; }
  get pageCount() { return this.pages.length; }

  text(x, y, str, { size = 9, bold = false, color = [0, 0, 0], align = 'left', strike = false } = {}) {
    const s = esc(str);
    const w = widthOf(str, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${color.map(num).join(' ')} rg ` +
      `1 0 0 1 ${num(px)} ${num(this.h - y)} Tm (${s}) Tj ET`);
    if (strike) this.line(px, y - size * 0.3, px + w, y - size * 0.3, { width: 0.7, color });
    return w;
  }
  line(x1, y1, x2, y2, { width = 0.5, color = [0.75, 0.75, 0.75], dash = null } = {}) {
    this.ops.push(`${dash ? `[${dash}] 0 d ` : '[] 0 d '}${num(width)} w ${color.map(num).join(' ')} RG ` +
      `${num(x1)} ${num(this.h - y1)} m ${num(x2)} ${num(this.h - y2)} l S`);
  }
  rect(x, y, w, h, { fill = null, stroke = null, width = 0.5, radius = 0 } = {}) {
    const y0 = this.h - y - h;
    if (fill) this.ops.push(`${fill.map(num).join(' ')} rg ${num(x)} ${num(y0)} ${num(w)} ${num(h)} re f`);
    if (stroke) this.ops.push(`${num(width)} w ${stroke.map(num).join(' ')} RG ${num(x)} ${num(y0)} ${num(w)} ${num(h)} re S`);
    void radius;
  }

  /* Truncate to a column width, with an ellipsis, so a long note never bleeds. */
  fit(str, maxW, size, bold = false) {
    let s = ascii(str);
    if (widthOf(s, size, bold) <= maxW) return s;
    while (s.length && widthOf(s + '...', size, bold) > maxW) s = s.slice(0, -1);
    return s + '...';
  }

  save() {
    const enc = new TextEncoder();
    const chunks = [];
    let len = 0;
    const push = (bytes) => { chunks.push(bytes); len += bytes.length; return len; };
    const pushStr = (s) => push(enc.encode(s));

    const fileId = new Uint8Array(16);
    (globalThis.crypto || { getRandomValues: (a) => a.forEach((_, i) => (a[i] = (Math.random() * 256) | 0)) }).getRandomValues(fileId);
    const sec = this.password || this.ownerPassword
      ? standardSecurity({ userPassword: this.password, ownerPassword: this.ownerPassword || this.password, fileId })
      : null;
    const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

    /* object 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, [6 encrypt], then per page
       a page object and a content stream. */
    const encObj = sec ? 1 : 0;
    const first = 6 + encObj;
    const pageIds = this.pages.map((_, i) => first + i * 2);
    const streamIds = this.pages.map((_, i) => first + i * 2 + 1);
    const objects = new Map();

    objects.set(1, `<< /Type /Catalog /Pages 2 0 R >>`);
    objects.set(2, `<< /Type /Pages /Count ${this.pages.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`);
    objects.set(3, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
    objects.set(4, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
    objects.set(5, `<< /Title (${esc(this.title)}) /Author (${esc(this.author)}) /Producer (MoMo Booth Ledger) /CreationDate (D:${stampDate()}) >>`);
    if (sec) objects.set(6, `<< /Filter /Standard /V 1 /R 2 /O <${hex(sec.O)}> /U <${hex(sec.U)}> /P ${sec.permissions} >>`);

    this.pages.forEach((ops, i) => {
      objects.set(pageIds[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.w)} ${num(this.h)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamIds[i]} 0 R >>`);
      objects.set(streamIds[i], { stream: ops.join('\n') });
    });

    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const offsets = new Map();
    for (const [id, body] of [...objects].sort((a, b) => a[0] - b[0])) {
      offsets.set(id, len);
      if (typeof body === 'string') {
        /* Strings inside an encrypted document are encrypted too; the only ones
           here are in /Info, and /Encrypt itself must stay in clear. */
        const out = sec && id === 5 ? encryptInfo(body, sec, id) : body;
        pushStr(`${id} 0 obj\n${out}\nendobj\n`);
      } else {
        let data = enc.encode(body.stream);
        if (sec) data = rc4(sec.objectKey(id), data);
        pushStr(`${id} 0 obj\n<< /Length ${data.length} >>\nstream\n`);
        push(data);
        pushStr('\nendstream\nendobj\n');
      }
    }
    const xref = len;
    const maxId = Math.max(...offsets.keys());
    let table = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= maxId; i++) {
      table += `${String(offsets.get(i) ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    pushStr(table);
    pushStr(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R /Info 5 0 R ${sec ? '/Encrypt 6 0 R ' : ''}` +
      `/ID [<${hex(fileId)}> <${hex(fileId)}>] >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

function stampDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function encryptInfo(dict, sec, id) {
  return dict.replace(/\(((?:[^()\\]|\\.)*)\)/g, (m, inner) => {
    const bytes = new TextEncoder().encode(inner.replace(/\\([\\()])/g, '$1'));
    const out = rc4(sec.objectKey(id), bytes);
    return '<' + [...out].map((b) => b.toString(16).padStart(2, '0')).join('') + '>';
  });
}
