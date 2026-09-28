/* ═══════════════ SHARED HELPERS ═══════════════ */

export const WALLETS = ['MTN', 'TELECEL', 'AT', 'CASH'];
export const NETWORKS = ['MTN', 'TELECEL', 'AT'];            // wallets that hold float
export const TX_TYPES = ['cash_in', 'cash_out', 'airtime', 'bundle'];

export const WALLET_LABEL = { MTN: 'MTN', TELECEL: 'Telecel', AT: 'AT', CASH: 'Cash' };
export const TYPE_LABEL = { cash_in: 'Cash in', cash_out: 'Cash out', airtime: 'Airtime', bundle: 'Bundle' };
export const TYPE_SHORT = { cash_in: 'IN', cash_out: 'OUT', airtime: 'AIR', bundle: 'BDL' };
export const KIND_LABEL = {
  lend: 'Lent out', borrow: 'Borrowed',
  repay_received: 'Repayment received', repay_paid: 'Repayment paid',
};

/* Ghana prefixes. Only ever a guess: numbers are portable, so the wallet stays editable. */
const PREFIX = {
  '024': 'MTN', '054': 'MTN', '055': 'MTN', '059': 'MTN', '025': 'MTN',
  '020': 'TELECEL', '050': 'TELECEL',
  '026': 'AT', '056': 'AT', '027': 'AT', '057': 'AT', '023': 'AT',
};

/* ── money: all arithmetic runs on integer pesewas, never on floats ── */
export const toP = (ghs) => Math.round((Number(ghs) || 0) * 100);
export const toGhs = (p) => (p || 0) / 100;

export function money(ghs, { sign = false, dp = 2 } = {}) {
  const n = Number(ghs) || 0;
  const s = Math.abs(n).toLocaleString('en-GH', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (n < 0 ? '-' : sign && n > 0 ? '+' : '') + s;
}
export const ghs = (n, o) => 'GHS ' + money(n, o);

/* ── dates ── */
export function today() { return dayKey(new Date()); }
export function dayKey(d) {
  const z = new Date(d);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}
export function monthKey(key) { return key.slice(0, 7); }
export function parseDay(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
export function dayLabel(key, { weekday = true } = {}) {
  return parseDay(key).toLocaleDateString('en-GB',
    { weekday: weekday ? 'short' : undefined, day: '2-digit', month: 'short', year: 'numeric' });
}
export function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── ids ── */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (a) => a.forEach((_, i) => (a[i] = Math.random() * 256)) }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ── customer numbers ── */
export function normalizeNumber(raw) {
  const d = String(raw || '').replace(/[^\d+]/g, '').replace(/^\+233/, '0').replace(/^233/, '0');
  return d.replace(/\D/g, '');
}
export function walletFromNumber(raw) {
  return PREFIX[normalizeNumber(raw).slice(0, 3)] || null;
}
/* What the agent types in an amount field: digits grouped as they go, so a
   long number stays readable — 20,000 rather than 20000. */
export function groupAmount(raw) {
  const t = String(raw ?? '').replace(/[^\d.]/g, '');
  if (t === '') return '';
  const [whole, ...rest] = t.split('.');
  const head = (whole || '0').replace(/^0+(?=\d)/, '');
  const grouped = head.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest.length ? `${grouped}.${rest.join('').slice(0, 2)}` : grouped;
}
export const parseAmount = (raw) => {
  const t = String(raw ?? '').replace(/[^\d.]/g, '');
  return t === '' ? '' : t;
};

/* A Ghana mobile number is exactly ten digits. */
export const NUMBER_LENGTH = 10;
export const isCompleteNumber = (raw) => normalizeNumber(raw).length === NUMBER_LENGTH;

/* 024 412 3456 — the three blocks are what makes a number readable at a glance. */
export function groupNumber(s) {
  const t = String(s || '');
  return [t.slice(0, 3), t.slice(3, 6), t.slice(6, 10)].filter(Boolean).join(' ');
}
export const formatNumber = (raw) => groupNumber(normalizeNumber(raw).slice(0, NUMBER_LENGTH));

/* 0244123456 -> 024 4** *456 ; enough to recognise a regular customer, not enough to dial. */
export function maskNumber(raw) {
  const n = normalizeNumber(raw);
  if (!n) return '';
  if (n.length <= 7) return groupNumber(n.slice(0, 2) + '***' + n.slice(-2));
  return groupNumber(n.slice(0, 4) + '***' + n.slice(-3));
}
export const last4 = (raw) => { const n = normalizeNumber(raw); return n ? '***' + n.slice(-4) : ''; };

/* The one place that decides how a stored number is shown, on screen or in the PDF. */
export function displayNumber(raw, mode = 'masked') {
  if (!raw) return '';
  if (mode === 'full') return formatNumber(raw);
  if (mode === 'last4') return last4(raw);
  return maskNumber(raw);
}

/* ── misc ── */
export const sum = (arr, f = (x) => x) => arr.reduce((t, x) => t + (f(x) || 0), 0);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const groupBy = (arr, f) => {
  const m = new Map();
  for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
};
