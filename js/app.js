/* ═══════════════ APP ═══════════════
   One page, one pen, one menu button. Everything else is behind the menu.    */

import { el, clear, toast } from './ui.js';
import { today, dayLabel, addDays } from './util.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { lockScreen } from './screens/lock.js';
import { pageScreen } from './screens/page.js';
import { writerBar, emptyDraft } from './screens/writer.js';
import { morningScreen, eveningScreen } from './screens/counts.js';
import { menuScreen } from './screens/menu.js';
import { debtsScreen } from './screens/debts.js';
import { statsScreen } from './screens/statistics.js';
import { exportScreen, initialExportState } from './screens/exportpdf.js';
import { settingsScreen } from './screens/settings.js';
import { searchScreen } from './screens/search.js';
import { CONFIG } from './config.js';
import { openCalendar, closeCalendar } from './screens/calendar.js';

const SCREENS = {
  page: pageScreen, menu: menuScreen, morning: morningScreen, evening: eveningScreen,
  debts: debtsScreen, stats: statsScreen, export: exportScreen, settings: settingsScreen,
  search: searchScreen,
};
const TITLE = { menu: 'Menu', morning: 'Morning', evening: 'Evening', debts: 'Debts',
  stats: 'Statistics', export: 'Export', settings: 'Settings', search: 'Search' };

const ctx = {
  view: 'page',
  date: today(),
  agent: CONFIG.defaultAgent || null,
  draft: emptyDraft(),
  statsPreset: 'week',
  statsCustom: {},
  exportState: initialExportState(),
  query: '',
  go: (view) => { ctx.view = view; closeCalendar(); render(); scrollTop(); },
  setDate: (d) => { ctx.date = d; closeCalendar(); render(); },
  refresh: (opts) => render(opts),
  setStatsPreset: (p) => { ctx.statsPreset = p; render(); },
  setStatsCustom: (c) => { ctx.statsCustom = c; render(); },
};

const root = document.getElementById('app');
const scrollTop = () => scrollTo({ top: 0 });

function render({ focus = false } = {}) {
  if (!store.state.ready) return;
  const onPage = ctx.view === 'page';
  clear(root);
  root.append(bar(onPage), SCREENS[ctx.view](ctx));
  if (onPage && sync.canWrite()) {
    const pen = writerBar(ctx);
    root.append(pen);
    scrollTo({ top: document.body.scrollHeight });
    if (focus) pen.focusPen();            // keep writing without reaching for the field
  }
  paintSync();
}

function bar(onPage) {
  const isToday = ctx.date === today();
  return el('div.bar',
    onPage ? null : el('button', { text: '‹', title: 'back', onclick: () => ctx.go('page') }),
    onPage
      ? el('button.datebtn', { title: 'pick a day', onclick: () => openCalendar(ctx) },
          el('div.date', { text: dayLabel(ctx.date) }),
          el('div.state', { text: sync.isViewer() ? 'read only' : isToday ? clockLabel() : 'another day' }))
      : el('div', el('div.date', { text: TITLE[ctx.view] })),
    el('div.sp'),
    onPage ? el('button', { text: '‹', title: 'day before', onclick: () => ctx.setDate(addDays(ctx.date, -1)) }) : null,
    onPage && !isToday ? el('button', { text: '›', title: 'day after', onclick: () => ctx.setDate(addDays(ctx.date, 1)) }) : null,
    onPage ? el('button', { text: '⌕', title: 'search', onclick: () => ctx.go('search') }) : null,
    onPage ? el('button', { text: '☰', title: 'menu', onclick: () => ctx.go('menu') }) : null,
  );
}

const clockLabel = () => `today · ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

function paintSync() {
  const s = sync.status;
  const state = root.querySelector('.bar .state');
  if (!state || ctx.view !== 'page') return;
  if (!s.configured) return;                       // no backend: nothing to say
  if (!s.online) state.textContent = `offline · ${s.pendingCount} kept here`;
  else if (s.busy) state.textContent = 'sending…';
  else if (s.pendingCount) state.textContent = `${s.pendingCount} to send`;
}

async function boot() {
  /* In a sandboxed frame the getter itself can throw, so this stays guarded. */
  try { navigator.serviceWorker?.register('sw.js').catch(() => {}); } catch { /* no offline cache here */ }
  await store.init();
  await sync.init();                 // loads the cached session — works offline
  await lockScreen(root);
  store.onSyncNeeded(sync.sync);
  sync.subscribe(() => {
    paintSync();
    /* Settings shows the state of the sync, so it has to follow it — but never
       while a field is being typed into, or the cursor would jump out. */
    if (ctx.view !== 'settings') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('.sheet-bg')) return;
    render();
  });
  sync.startAutoSync();
  render();
  sync.sync();

  let shownToday = today();
  setInterval(() => {
    const now = today();
    if (now === shownToday) return;
    if (ctx.date === shownToday) ctx.setDate(now);
    shownToday = now;
  }, 60000);

  addEventListener('online', () => toast('Back online'));
}

boot().catch((e) => {
  root.replaceChildren(el('div.sheetview',
    el('h2', { text: 'The page could not open' }),
    el('p.lead', { text: e.message }),
    el('p.note', { text: 'Storage may be blocked (private window). Lines need it to be safe.' })));
});
