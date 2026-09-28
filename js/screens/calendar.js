/* ═══════════════ THE LITTLE CALENDAR ═══════════════
   Tapping the date opens a month in the corner. A dot marks a day that has
   lines, so he can see where he has been before he goes there.               */

import { el, fill } from '../ui.js';
import { dayKey, parseDay, today, WEEKDAYS } from '../util.js';
import * as store from '../store.js';

let open = null;
export function closeCalendar() { open?.remove(); open = null; }
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCalendar(); });

export function openCalendar(ctx) {
  closeCalendar();
  const written = new Set(store.datesWithData());
  const cursor = parseDay(ctx.date);
  let year = cursor.getFullYear(), month = cursor.getMonth();

  const box = el('div.cal');
  const bg = el('div.cal-bg', { onclick: (e) => { if (e.target === bg) closeCalendar(); } }, box);

  const render = () => {
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;                    // weeks start on Monday
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(el('span'));
    for (let d = 1; d <= days; d++) {
      const key = dayKey(new Date(year, month, d));
      const ahead = key > today();
      cells.push(el(`button${key === ctx.date ? '.on' : ''}${key === today() ? '.now' : ''}${written.has(key) ? '.has' : ''}`, {
        text: String(d), disabled: ahead,
        onclick: () => { closeCalendar(); ctx.setDate(key); },
      }));
    }
    fill(box,
      el('div.cal-head',
        el('button', { text: '‹', onclick: () => { month--; if (month < 0) { month = 11; year--; } render(); } }),
        el('span', { text: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }),
        el('button', { text: '›', disabled: new Date(year, month + 1, 1) > new Date(),
          onclick: () => { month++; if (month > 11) { month = 0; year++; } render(); } })),
      el('div.cal-week', WEEKDAYS.slice(1).concat(WEEKDAYS[0]).map((w) => el('span', { text: w[0] }))),
      el('div.cal-grid', cells),
      el('button.cal-today', { text: 'Today', onclick: () => { closeCalendar(); ctx.setDate(today()); } }));
  };
  render();
  document.body.append(bg);
  open = bg;
}
