/* ═══════════════ APP ═══════════════
   One page, one pen, one menu button. Everything else is behind the menu.    */

import { el, clear, toast } from './ui.js';
import { today, dayLabel, addDays } from './util.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { lockScreen } from './screens/lock.js';
import { pageScreen, reportFor } from './screens/page.js';
import { writerBar, emptyDraft } from './screens/writer.js';
import { morningScreen, eveningScreen } from './screens/counts.js';
import { menuScreen } from './screens/menu.js';
import { statsScreen } from './screens/statistics.js';
import { exportScreen, initialExportState } from './screens/exportpdf.js';
import { settingsScreen } from './screens/settings.js';
import { searchScreen } from './screens/search.js';
import { CONFIG } from './config.js';
import { openCalendar, closeCalendar } from './screens/calendar.js';

const SCREENS = {
  page: pageScreen, menu: menuScreen, morning: morningScreen, evening: eveningScreen,
  stats: statsScreen, export: exportScreen, settings: settingsScreen,
  search: searchScreen,
};
const TITLE = { menu: 'Menu', morning: 'Morning', evening: 'Evening',
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
  /* the pen leaves the page when the day has been counted and closed */
  if (onPage && sync.canWrite() && !reportFor(ctx.date).closed) {
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
          el('div.state', { text: idleLabel() }))
      : el('div', el('div.date', { text: TITLE[ctx.view] })),
    el('div.sp'),
    onPage ? el('button', { text: '‹', title: 'day before', onclick: () => ctx.setDate(addDays(ctx.date, -1)) }) : null,
    onPage && !isToday ? el('button', { text: '›', title: 'day after', onclick: () => ctx.setDate(addDays(ctx.date, 1)) }) : null,
    onPage ? el('button', { text: '⌕', title: 'search', onclick: () => ctx.go('search') }) : null,
    onPage ? el('button', { text: '☰', title: 'menu', onclick: () => ctx.go('menu') }) : null,
  );
}

const clockLabel = () => `today · ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

/* Nothing may be redrawn from under a hand that is writing: the cursor would
   jump out of the field and a half-typed number would be lost. */
let wantRedraw = false;
const busyTyping = () => {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || !!document.querySelector('.sheet-bg');
};
function freshen() {
  if (busyTyping()) { wantRedraw = true; return; }
  wantRedraw = false;
  render();
}

const idleLabel = () => sync.isViewer() ? 'read only'
  : ctx.date === today() ? clockLabel() : 'another day';

/* The line under the date. It said "sending…" and then never said anything
   else: with nothing left to send no branch matched, so the word stayed there
   for ever and the sync looked stuck although it had finished. It now always
   ends by saying the ordinary thing again — and it only says "sending…" when
   there is really something of yours on its way, not on every routine look. */
function paintSync() {
  const s = sync.status;
  const state = root.querySelector('.bar .state');
  if (!state || ctx.view !== 'page') return;
  if (!s.configured) return;                       // no backend: nothing to say
  state.textContent = !s.online ? `offline · ${s.pendingCount} kept here`
    : s.busy && s.pendingCount ? 'sending…'
    : s.pendingCount ? `${s.pendingCount} to send`
    : idleLabel();
}

/* The app is kept on the device so it opens with no network, which means a new
   version does not arrive just because one was published: the browser has to be
   told to go and look. It looked only when the address was typed again — so a
   browser where the app simply stays open could sit on an old copy for days.
   It now looks every time the app comes back to the front, and reloads itself
   once the new copy has taken over. */
function watchForNewVersion() {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  const hadOne = !!sw.controller;          // false on the very first visit
  let reloading = false;

  sw.register('sw.js').then((reg) => {
    const look = () => { if (!document.hidden) reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', look);
    setInterval(look, 1800000);
  }).catch(() => {});

  sw.addEventListener('controllerchange', () => {
    if (!hadOne || reloading) return;      // first install: nothing to replace
    reloading = true;
    const whenFree = () => (busyTyping() ? setTimeout(whenFree, 4000) : location.reload());
    whenFree();                            // never mid-line
  });
}

/* Two spellings of one name are one person, and putting them back together is
   not the booth's job. It happens here, after every arrival of new rows — and
   it is said out loud, because it moves real money from one name to another. */
let tidying = false;
async function tidyNames() {
  if (tidying || !sync.canWrite()) return;
  tidying = true;
  try {
    for (const { from, into } of await store.healNames()) {
      toast(`${from} and ${into} are one person`);
    }
  } catch { /* it will be tried again on the next sync */ } finally { tidying = false; }
}

async function boot() {
  /* In a sandboxed frame the getter itself can throw, so this stays guarded. */
  try { watchForNewVersion(); } catch { /* no offline cache here */ }
  await store.init();
  await sync.init();                 // loads the cached session — works offline
  tidyNames();
  await lockScreen(root);
  store.onSyncNeeded(sync.sync);
  let seenPull = sync.status.pulledAt;
  sync.subscribe(() => {
    paintSync();
    /* Lines written on another device used to land in the database and stop
       there: the screen was never told, so they only appeared if you thought
       to reload the page. A sync that brought something now redraws. */
    if (sync.status.pulledAt !== seenPull) { seenPull = sync.status.pulledAt; wantRedraw = true; tidyNames(); }
    /* Settings shows the state of the sync, so it has to follow it. */
    if (ctx.view === 'settings') { if (!busyTyping()) render(); return; }
    if (wantRedraw) freshen();
  });
  /* a redraw held back while a line was being written goes through as soon as
     the hand leaves the field */
  addEventListener('focusout', () => { if (wantRedraw) setTimeout(freshen, 0); });
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
