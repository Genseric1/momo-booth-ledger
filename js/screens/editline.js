/* ═══════════════ CORRECTING A LINE ═══════════════
   On paper a wrong line is struck out and written again. Here too: a
   correction is a new version, the old one is kept.                          */

import { el, sheet, toast, confirmSheet, closeSheet, fill, amountInput } from '../ui.js';
import { NETWORKS, WALLET_LABEL, money, timeLabel, groupNumber, acceptNumberInput, isCompleteNumber, NUMBER_LENGTH } from '../util.js';
import * as store from '../store.js';

const TYPES = [['cash_in', 'in'], ['cash_out', 'out'], ['airtime', 'airtime'], ['bundle', 'bundle']];

export function editLine(tx, ctx) {
  const st = { type: tx.type, wallet: tx.wallet, amount: String(tx.amount), number: tx.customer_number || '' };

  sheet('The line', ({ body, close }) => {
    const render = () => fill(body, 
      el('div.field',
        el('label', { text: 'Customer number' }),
        el('input.num', {
          value: groupNumber(st.number), inputmode: 'numeric', maxlength: 12,
          oninput: (e) => {
            const { value, error } = acceptNumberInput(e.target.value, st.number);
            st.number = value;
            e.target.value = groupNumber(st.number);
            if (error) toast(error, { error: true });
          },
        })),
      el('div.field',
        el('label', { text: 'In or out' }),
        el('div.pick', TYPES.map(([v, label]) => el(`button${st.type === v ? '.on' : ''}`, {
          text: label, onclick: () => { st.type = v; render(); },
        })))),
      el('div.field',
        el('label', { text: 'Network' }),
        el('div.pick', NETWORKS.map((w) => el(`button${st.wallet === w ? '.on' : ''}`, {
          text: WALLET_LABEL[w], onclick: () => { st.wallet = w; render(); },
        })))),
      el('div.field',
        el('label', { text: 'Amount' }),
        amountInput({ value: st.amount, oninput: (v) => { st.amount = v; } })),
      el('div.note', { text: `Written at ${timeLabel(tx.time)}${tx.agent ? ' by ' + tx.agent : ''}. Corrections are kept.` }),
      el('button.big', {
        text: 'Save the correction',
        onclick: async () => {
          if (!(Number(st.amount) > 0)) return toast('Amount?', { error: true });
          if (st.number && !isCompleteNumber(st.number)) return toast(`A number is 0 and ${NUMBER_LENGTH - 1} more digits`, { error: true });
          await store.editTx(tx.tx_id, {
            type: st.type, wallet: st.wallet, amount: Number(st.amount), customer_number: st.number,
          });
          toast('Line corrected'); close(); ctx.refresh();
        },
      }),
      tx.cancelled
        ? el('button.big.quiet', { text: 'Put the line back', style: { marginTop: '8px' }, onclick: async () => {
            await store.uncancelTx(tx.tx_id); toast('Line back'); close(); ctx.refresh();
          } })
        : el('button.big.warn', { text: 'Strike out this line', style: { marginTop: '8px' }, onclick: async () => {
            if (!await confirmSheet('Strike out', `${money(tx.amount)} — the line stays visible but leaves every total.`,
              { danger: true, okLabel: 'Strike out' })) return;
            await store.cancelTx(tx.tx_id); toast('Struck out'); closeSheet(); ctx.refresh();
          } }),
    );
    render();
    return [];
  });
}
