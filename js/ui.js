/* ═══════════════ TINY DOM TOOLKIT ═══════════════
   el('div.card', {...}, children) — enough structure to build the screens
   without a framework, so the app stays a plain set of files.              */

import { groupAmount, parseAmount } from './util.js';

export function el(spec, props = {}, ...children) {
  const [tagPart, ...classes] = String(spec).split('.');
  const node = document.createElement(tagPart || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (props && (Array.isArray(props) || props instanceof Node || typeof props !== 'object')) {
    children.unshift(props); props = {};
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = !!v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  add(node, children);
  return node;
}
function add(node, kids) {
  for (const c of kids.flat(4)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const frag = (...kids) => { const f = document.createDocumentFragment(); add(f, kids); return f; };
export const clear = (node) => { while (node.firstChild) node.firstChild.remove(); return node; };
/* replaceChildren() would print a literal "null" for a skipped child, so every
   in-place repaint goes through fill(). */
export const fill = (node, ...kids) => { clear(node); add(node, kids); return node; };

/* ── sheet ── */
let openSheet = null;
export function sheet(title, build, { onClose } = {}) {
  closeSheet();
  const body = el('div');
  const box = el('div.sheet',
    el('div.hd',
      el('h3', { text: title }),
      el('div.spacer'),
      el('button.x', { text: '✕', onclick: () => closeSheet() })),
    body);
  const bg = el('div.sheet-bg', { onclick: (e) => { if (e.target === bg) closeSheet(); } }, box);
  document.body.append(bg);
  openSheet = { bg, onClose };
  const api = { body, close: closeSheet, setTitle: (t) => { box.querySelector('h3').textContent = t; } };
  add(body, [build(api)].flat());
  const focusable = body.querySelector('input,select,textarea');
  if (focusable && !focusable.readOnly) setTimeout(() => focusable.focus(), 60);
  return api;
}
export function closeSheet() {
  if (!openSheet) return;
  const { bg, onClose } = openSheet;
  openSheet = null;
  bg.remove();
  onClose?.();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ── toast / confirm ── */
export function toast(msg, { error = false, ms = 2400 } = {}) {
  document.querySelector('.toast')?.remove();
  const t = el(`div.toast${error ? '.err' : ''}`, { text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
export function confirmSheet(title, message, { danger = false, okLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    sheet(title, ({ close }) => [
      el('p.lead', { text: message }),
      el(`button.big${danger ? '.warn' : ''}`, {
        text: okLabel, onclick: () => { done = true; resolve(true); close(); },
      }),
      el('button.big.quiet', { text: 'Cancel', style: { marginTop: '8px' }, onclick: () => close() }),
    ], { onClose: () => { if (!done) resolve(false); } });
  });
}

/* ── small pieces used across screens ──
   Everything renders as plain lines on paper: a label, a value, a rule.      */
export const tile = (k, v, s, { cls = '' } = {}) =>
  el('div.r',
    el('div', { text: k }, s ? el('small', { text: s }) : null),
    el('div.sp'),
    el(`div.v.num ${cls}`.trim(), { text: v }));

export function chipRow(items, current, onPick, { guess = null } = {}) {
  return el('div.pick', items.map((it) => {
    const value = it.value ?? it;
    const label = it.label ?? it;
    const on = value === current;
    return el(`button${on ? '.on' : ''}`, {
      text: guess === value && !on ? `${label} ·` : label,
      onclick: () => onPick(value),
    });
  }));
}

/* An amount field that groups the digits while they are typed. */
export function amountInput({ value = '', placeholder = '0', oninput }) {
  return el('input.num', {
    type: 'text', inputmode: 'decimal', placeholder,
    value: value === '' || value == null ? '' : groupAmount(value),
    oninput: (e) => {
      const raw = parseAmount(e.target.value);
      e.target.value = groupAmount(raw);
      oninput(raw);
    },
  });
}

/* A section of the page: a quiet label, then its lines. No box, no shadow. */
export function card(title, bodyKids, headKids = []) {
  const kids = [bodyKids].flat().filter(Boolean);
  const rows = kids.filter((k) => k?.classList?.contains('r'));
  const body = rows.length === kids.length ? [el('div.rows', kids)] : kids;
  return el('div.sec',
    title ? el('div.seclabel', el('span', { text: title }), ...[headKids].flat()) : null,
    ...body);
}

/* Horizontal bars, used for weekday / hour / capital views. */
export function bars(series, { format = (v) => v } = {}) {
  const max = Math.max(1, ...series.map((s) => s.value));
  const hot = Math.max(...series.map((s) => s.value));
  return el('div',
    el('div.bars', series.map((s) => el(`div.b${s.value === hot && hot > 0 ? '.hot' : ''}`, {
      style: { height: `${Math.max(2, (s.value / max) * 100)}%` },
      title: `${s.label}: ${format(s.value)}`,
    }))),
    el('div.barlabels', series.map((s) => el('span', { text: s.label }))));
}
