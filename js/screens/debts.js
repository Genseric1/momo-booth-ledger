/* ═══════════════ DEBT ACCOUNTS (spec §6.6) ═══════════════
   Up to four accounts. Direction is carried by the entries, not the account, so
   the same neighbour can owe us today and lend to us tomorrow. Debts move the
   till but never enter the statistics.                                       */

import { el, card, sheet, toast, tile, chipRow, confirmSheet, fill, amountInput } from '../ui.js';
import { WALLETS, WALLET_LABEL, KIND_LABEL, money, dayLabel, timeLabel, today } from '../util.js';
import { debtBalances } from '../calc.js';
import * as store from '../store.js';

const KINDS = ['lend', 'borrow', 'repay_received', 'repay_paid'];

export function debtsScreen(ctx) {
  const accounts = store.state.debtAccounts;
  const bal = debtBalances(store.state.debtEntries);
  const entries = store.state.debtEntries.slice(0, 60);

  return el('div.wrap',
    el('div', { style: { display: 'grid', gap: '14px' } },
      card('Debt accounts', [
        el('div.rows',
          tile('Owed to us', money(bal.owed_to_us), 'money out there'),
          tile('We owe', money(bal.we_owe), 'to give back'),
          tile('Net effect on capital', money(bal.owed_to_us - bal.we_owe, { sign: true }), '', { accent: true })),
        accounts.length
          ? el('div', { style: { marginTop: '12px' } }, accounts.map((a) => {
              const b = bal.perAccount.get(a.account_id) || { owed_to_us: 0, we_owe: 0, net: 0 };
              return el('div.r', { style: { marginBottom: '8px' } },
                el('div.r',
                  el('div', { style: { flex: '1' } },
                    el('div.v', { text: a.name }),
                    el('p.note', { text: `owes us ${money(b.owed_to_us)}  ·  we owe ${money(b.we_owe)}` })),
                  el('div.v.num', { class: b.net >= 0 ? 'pos' : 'neg', text: money(b.net, { sign: true }) })),
                el('div.r', { style: { marginTop: '8px' } },
                  el('button.act', { text: 'New entry', onclick: () => entrySheet(ctx, a.account_id) }),
                  el('button.act', { text: 'Rename', onclick: () => renameSheet(ctx, a) }),
                  el('button.act', { text: 'Remove', onclick: async () => {
                    if (!await confirmSheet('Remove account', `Hide ${a.name}? Its entries stay in the history and keep counting.`, { danger: true, okLabel: 'Remove' })) return;
                    await store.archiveDebtAccount(a.account_id); ctx.refresh();
                  } })));
            }))
          : el('p.lead', { style: { marginTop: '10px' }, text: 'No debt account yet. Add one for a neighbour, a colleague or a regular customer.' }),
        accounts.length < 4
          ? el('button.big.quiet', { text: '+ Add debt account', style: { marginTop: '10px' }, onclick: () => nameSheet(ctx) })
          : el('p.note', { style: { marginTop: '10px' }, text: 'Four accounts is the limit in this version.' }),
      ]),
      card('Recent entries', entries.length ? el('div', entries.map((e) => {
        const acc = accounts.find((a) => a.account_id === e.account_id);
        return el('div.r', { style: { marginBottom: '8px' } },
          el('div.r',
            el('div', { style: { flex: '1' } },
              el('div.v', { text: `${acc?.name || 'account'} — ${KIND_LABEL[e.kind]}` }),
              el('p.note', { text: `${dayLabel(e.day, { weekday: false })} ${timeLabel(e.time)} · ${WALLET_LABEL[e.wallet]}${e.agent ? ' · ' + e.agent : ''}${e.note ? ' · ' + e.note : ''}` })),
            el('div.v.num', { class: e.cancelled ? 'neg' : '', text: money(e.amount), style: e.cancelled ? { textDecoration: 'line-through' } : {} })),
          !e.cancelled ? el('button.act', { text: 'Cancel entry', onclick: async () => {
            if (!await confirmSheet('Cancel entry', 'Remove this entry from the balances? It stays visible.', { danger: true, okLabel: 'Cancel entry' })) return;
            await store.cancelDebtEntry(e.entry_id); ctx.refresh();
          } }) : null);
      })) : el('p.lead', { text: 'Nothing yet.' })),
    ),
    el('div', card('How it counts', [
      el('p.lead', { text: 'Lending takes money out of the till and puts it in "owed to us", so the capital does not change. A repayment does the opposite.' }),
      el('p.note', { style: { marginTop: '8px' }, text: 'Debt entries are excluded from the statistics on purpose: they are not booth business.' }),
    ])),
  );
}

function nameSheet(ctx) {
  let name = '';
  sheet('New debt account', ({ close }) => [
    el('div.field', el('label', { text: 'Name' }),
      el('input', { placeholder: 'e.g. Kwame next door', oninput: (e) => { name = e.target.value; } })),
    el('button.big', { text: 'Add account', onclick: async () => {
      if (!name.trim()) return toast('Enter a name', { error: true });
      try { await store.addDebtAccount(name); } catch (e) { return toast(e.message, { error: true }); }
      ctx.refresh(); close();
    } }),
  ]);
}
function renameSheet(ctx, a) {
  let name = a.name;
  sheet('Rename account', ({ close }) => [
    el('div.field', el('label', { text: 'Name' }), el('input', { value: name, oninput: (e) => { name = e.target.value; } })),
    el('button.big', { text: 'Save', onclick: async () => {
      await store.editDebtAccount(a.account_id, { name: name.trim() || a.name }); ctx.refresh(); close();
    } }),
  ]);
}

export function entrySheet(ctx, account_id = null) {
  const accounts = store.state.debtAccounts;
  if (!accounts.length) return toast('Add a debt account first', { error: true });
  const st = {
    account_id: account_id || accounts[0].account_id,
    kind: 'lend', wallet: 'CASH', amount: '', day: ctx.date || today(), note: '',
    agent: store.state.settings.agents[0] || null,
  };
  sheet('Debt entry', ({ body, close }) => {
    const render = () => fill(body, 
      el('div.field', el('label', { text: 'Account' }),
        chipRow(accounts.map((a) => ({ value: a.account_id, label: a.name })), st.account_id,
          (v) => { st.account_id = v; render(); }, { small: true })),
      el('div.field', el('label', { text: 'What happened' }),
        chipRow(KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })), st.kind, (v) => { st.kind = v; render(); }, { small: true })),
      el('div.field', el('label', { text: 'Amount (GHS)' }),
        amountInput({ value: st.amount, oninput: (v) => { st.amount = v; } })),
      el('div.field', el('label', { text: 'What moved' }),
        chipRow(WALLETS.map((w) => ({ value: w, label: WALLET_LABEL[w] })), st.wallet, (v) => { st.wallet = v; render(); }, { small: true })),
      el('div.field', el('label', { text: 'Date' }),
        el('input', { type: 'date', value: st.day, max: today(), onchange: (e) => { st.day = e.target.value; } })),
      store.state.settings.agents.length ? el('div.field', el('label', { text: 'Agent (optional)' }),
        chipRow([{ value: null, label: '—' }, ...store.state.settings.agents], st.agent, (v) => { st.agent = v; render(); }, { small: true })) : null,
      el('div.field', el('label', { text: 'Note (optional)' }),
        el('input', { value: st.note, oninput: (e) => { st.note = e.target.value; } })),
      el('p.note', { text: effectText(st) }),
      el('button.big', { text: 'Save entry', style: { marginTop: '10px' }, onclick: async () => {
        if (!(Number(st.amount) > 0)) return toast('Enter an amount', { error: true });
        await store.addDebtEntry(st);
        toast('Debt entry saved'); ctx.refresh(); close();
      } }),
    );
    render();
    return [];
  });
}

function effectText(st) {
  const a = Number(st.amount || 0);
  const w = WALLET_LABEL[st.wallet];
  switch (st.kind) {
    case 'lend': return `${w} goes down by ${money(a)}, owed to us goes up by ${money(a)}. Capital unchanged.`;
    case 'borrow': return `${w} goes up by ${money(a)}, we owe goes up by ${money(a)}. Capital unchanged.`;
    case 'repay_received': return `${w} goes up by ${money(a)}, owed to us goes down by ${money(a)}.`;
    default: return `${w} goes down by ${money(a)}, we owe goes down by ${money(a)}.`;
  }
}
