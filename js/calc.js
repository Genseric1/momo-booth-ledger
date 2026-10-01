/* ═══════════════ CALCULATION RULES (spec §5) ═══════════════
   Pure functions on integer pesewas. No I/O, no DOM: this file is the one
   the acceptance tests run against.                                        */

import { WALLETS, NETWORKS, toP, toGhs } from './util.js';

export const zeroWallets = () => ({ MTN: 0, TELECEL: 0, AT: 0, CASH: 0 });

/* Effect of one transaction, in pesewas, per wallet. */
export function txEffect(tx) {
  const e = zeroWallets();
  if (tx.cancelled) return e;                       // excluded from every calculation
  const a = toP(tx.amount);
  const w = tx.wallet;
  if (!WALLETS.includes(w) || w === 'CASH') return e;
  if (tx.type === 'cash_out') { e[w] += a; e.CASH -= a; }
  else { e[w] -= a; e.CASH += a; }                   // cash_in, airtime, bundle
  return e;
}

/* Effect of one debt entry: { wallets, owed_to_us, we_owe } in pesewas.

   A debt moves no wallet. It is an undertaking, not a payment out: nothing
   leaves the booth when one is written down, so nothing may be taken off MTN,
   Telecel, AT or the cash box. The four figures come from the lines of the
   page and from nowhere else — which is also why the page could once announce
   a cash box holding less than nothing.

   It stays consistent on the way back. Lending puts a claim beside the money
   (the capital rises by what is owed); the day it is paid, the claim goes and
   the cash that came in is found by the count that evening. The capital lands
   where it started without either half being counted twice. */
export function debtEffect(en) {
  const wallets = zeroWallets();
  let owed_to_us = 0, we_owe = 0;
  if (en.cancelled) return { wallets, owed_to_us, we_owe };
  const a = toP(en.amount);
  switch (en.kind) {
    case 'lend':           owed_to_us += a; break;
    case 'borrow':         we_owe += a; break;
    case 'repay_received': owed_to_us -= a; break;
    case 'repay_paid':     we_owe -= a; break;
  }
  return { wallets, owed_to_us, we_owe };
}

export const debtDirection = (kind) =>
  (kind === 'lend' || kind === 'repay_received') ? 'owed_to_us' : 'we_owe';

function addInto(target, src) { for (const w of WALLETS) target[w] += src[w]; return target; }

/* Debt balances built from every entry up to and including `upToDay` (null = all). */
export function debtBalances(entries, upToDay = null) {
  let owed_to_us = 0, we_owe = 0;
  const perAccount = new Map();
  for (const en of entries) {
    if (upToDay && en.day > upToDay) continue;
    const e = debtEffect(en);
    owed_to_us += e.owed_to_us; we_owe += e.we_owe;
    const cur = perAccount.get(en.account_id) || { owed_to_us: 0, we_owe: 0 };
    cur.owed_to_us += e.owed_to_us; cur.we_owe += e.we_owe;
    perAccount.set(en.account_id, cur);
  }
  return {
    owed_to_us: toGhs(owed_to_us), we_owe: toGhs(we_owe),
    perAccount: new Map([...perAccount].map(([k, v]) =>
      [k, { owed_to_us: toGhs(v.owed_to_us), we_owe: toGhs(v.we_owe), net: toGhs(v.owed_to_us - v.we_owe) }])),
  };
}

/* A debt whose name has not reached this device yet. It still counts in the
   capital, so it is still shown — under this instead of a name. */
export const NO_NAME = 'name not here yet';

/* Who is owing and who is owed, built from the entries themselves rather than
   from the list of names.

   It used to be built the other way round — walk the names, look up what each
   one owes — and an entry whose name had not yet arrived simply vanished from
   the list. It kept counting in the capital, because the capital is worked out
   from the entries; so the screen showed a total that did not add up from the
   lines above it, and three devices showed three different totals for the same
   evening. An entry is never dropped now: at worst it has no name yet. */
export function openBalances(entries, accounts = [], upToDay = null) {
  const bal = debtBalances(entries, upToDay);
  const named = new Map(accounts.map((a) => [a.account_id, a.name]));
  return [...bal.perAccount]
    .map(([account_id, b]) => ({ account_id, name: named.get(account_id) || NO_NAME, ...b }))
    .filter((p) => Math.abs(p.net) > 0.004)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ── the day sheet ───────────────────────────────────────────────────────
   day       : { date, opening?, closing?, estimated_extras?, closed? }
   txs       : transactions of that day (cancelled ones may be included)
   dayDebts  : debt entries of that day
   carried   : debt balances at the end of the previous day (GHS)            */
export function dayReport({ day, txs = [], dayDebts = [], carried = { owed_to_us: 0, we_owe: 0 } }) {
  const hasOpening = !!day?.opening;
  const hasClosing = !!day?.closing;

  const opening = zeroWallets();
  if (hasOpening) for (const w of WALLETS) opening[w] = toP(day.opening[w]);

  const movement = zeroWallets();
  for (const tx of txs) addInto(movement, txEffect(tx));
  let dOwed = 0, dOwe = 0;
  for (const en of dayDebts) {
    const e = debtEffect(en);
    addInto(movement, e.wallets);
    dOwed += e.owed_to_us; dOwe += e.we_owe;
  }

  const expected = zeroWallets();
  for (const w of WALLETS) expected[w] = opening[w] + movement[w];

  const owed_to_us = toP(carried.owed_to_us) + dOwed;
  const we_owe = toP(carried.we_owe) + dOwe;

  const expectedFloat = WALLETS.reduce((t, w) => t + expected[w], 0);
  const expectedCapital = expectedFloat + owed_to_us - we_owe;

  const real = zeroWallets();
  if (hasClosing) for (const w of WALLETS) real[w] = toP(day.closing[w]);
  const realFloat = WALLETS.reduce((t, w) => t + real[w], 0);
  const realCapital = realFloat + owed_to_us - we_owe;

  const gap = zeroWallets();
  if (hasClosing) for (const w of WALLETS) gap[w] = real[w] - expected[w];
  const totalGap = hasClosing ? realCapital - expectedCapital : 0;

  const extrasP = day?.estimated_extras == null ? null : toP(day.estimated_extras);
  const residual = hasClosing && extrasP != null ? totalGap - extrasP : null;

  const out = (o) => Object.fromEntries(WALLETS.map((w) => [w, toGhs(o[w])]));
  return {
    date: day?.date, hasOpening, hasClosing, closed: !!day?.closed,
    opening: out(opening), movement: out(movement), expected: out(expected),
    real: hasClosing ? out(real) : null, gap: hasClosing ? out(gap) : null,
    owed_to_us: toGhs(owed_to_us), we_owe: toGhs(we_owe),
    expectedCapital: toGhs(expectedCapital),
    realCapital: hasClosing ? toGhs(realCapital) : null,
    totalGap: hasClosing ? toGhs(totalGap) : null,
    estimated_extras: extrasP == null ? null : toGhs(extrasP),
    residualGap: residual == null ? null : toGhs(residual),
    hints: hasClosing ? swapHints(gap) : [],
    txCount: txs.filter((t) => !t.cancelled).length,
    cancelledCount: txs.filter((t) => t.cancelled).length,
  };
}

/* Two networks off by the same amount in opposite directions => a line was
   probably entered on the wrong network (spec §5). */
export function swapHints(gapP) {
  const hints = [];
  for (let i = 0; i < NETWORKS.length; i++) {
    for (let j = i + 1; j < NETWORKS.length; j++) {
      const a = NETWORKS[i], b = NETWORKS[j];
      if (gapP[a] !== 0 && gapP[a] === -gapP[b]) {
        const [plus, minus] = gapP[a] > 0 ? [a, b] : [b, a];
        hints.push({ kind: 'swap', a: plus, b: minus, amount: toGhs(Math.abs(gapP[a])) });
      }
    }
  }
  return hints;
}

/* Running expected balances after each transaction — powers the live panel. */
export function liveBalances({ day, txs = [], dayDebts = [] }) {
  return dayReport({ day, txs, dayDebts, carried: { owed_to_us: 0, we_owe: 0 } }).expected;
}
