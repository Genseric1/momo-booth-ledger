/* ═══════════════ THE MENU ═══════════════
   Everything that is not the page lives behind one button, so the page stays
   the whole screen.                                                          */

import { el, sheet, toast } from '../ui.js';
import { money, dayLabel } from '../util.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import { reportFor } from './page.js';

export function menuScreen(ctx) {
  const rep = reportFor(ctx.date);
  const s = sync.status;
  const state = !s.online ? `offline${s.pendingCount ? ` · ${s.pendingCount} lines kept here` : ''}`
    : !s.configured ? 'this device only'
    : !s.signedIn ? 'not signed in'
    : s.pendingCount ? `${s.pendingCount} lines to send` : 'everything is sent';

  const row = (label, sub, go, value) => el('button.r', { onclick: () => ctx.go(go) },
    el('div', { text: label }, sub ? el('small', { text: sub }) : null),
    el('div.sp'),
    value ? el('div.v.num', { text: value }) : null,
    el('div.go', { text: '›' }));

  return el('div.sheetview',
    el('h2', { text: store.state.settings.boothName }),
    el('p.lead', { text: `${dayLabel(ctx.date)} · ${state}` }),
    el('div.rows',
      store.state.settings.agents.length ? el('button.r', { onclick: () => pickAgent(ctx) },
        el('div', { text: 'Who is writing' }, el('small', { text: 'stamped on each line' })),
        el('div.sp'),
        el('div.v', { text: ctx.agent || 'nobody' }),
        el('div.go', { text: '›' })) : null,
      row('Morning count', rep.hasOpening ? 'written' : 'not written yet', 'morning',
        rep.hasOpening ? money(rep.expectedCapital - totalMoved(rep), { dp: 0 }) : null),
      row('Evening count', rep.hasClosing ? 'written' : 'not written yet', 'evening',
        rep.hasClosing ? money(rep.realCapital, { dp: 0 }) : null),
      row('Search', 'find a line by number, amount or name', 'search'),
      row('Debts', 'who owes, and who is owed', 'debts'),
      row('Statistics', 'volume, networks, busiest hours', 'stats'),
      row('Export a register', 'PDF for one day, a week, a month', 'export'),
      row('Settings', 'agents, numbers, sync, PIN', 'settings')),
    el('button.big.quiet', { text: 'Back to the page', style: { marginTop: '20px' }, onclick: () => ctx.go('page') }));
}

const totalMoved = (rep) => Object.values(rep.movement).reduce((t, v) => t + v, 0);

function pickAgent(ctx) {
  sheet('Who is writing', ({ close }) => [
    el('div.rows', [null, ...store.state.settings.agents].map((a) => el('button.r', {
      onclick: () => { ctx.agent = a; toast(a ? `${a} is writing` : 'No name on the lines'); close(); ctx.refresh(); },
    }, el('div', { text: a || 'nobody' }), el('div.sp'), ctx.agent === a ? el('div.go', { text: '✓' }) : null))),
  ]);
}
