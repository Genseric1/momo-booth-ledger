/* ═══════════════ SERVICE WORKER ═══════════════
   The shell is cached on install so the register opens with no network at all.
   Data never goes through here: it lives in IndexedDB and syncs separately.  */

const CACHE = 'pacsbi-register-v27';
const SHELL = [
  '.', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/util.js', 'js/calc.js', 'js/db.js',
  'js/store.js', 'js/sync.js', 'js/crypto.js', 'js/config.js', 'js/logo.js', 'js/pdf.js', 'js/pdfcrypt.js', 'js/report.js',
  'js/screens/page.js', 'js/screens/writer.js', 'js/screens/counts.js',
  'js/screens/menu.js', 'js/screens/editline.js', 'js/screens/debts.js', 'js/chart.js',
  'js/screens/calendar.js', 'js/screens/search.js',
  'js/screens/statistics.js', 'js/screens/exportpdf.js', 'js/screens/settings.js', 'js/screens/lock.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;            // Supabase calls stay untouched

  /* cache first for the shell: opening the app must never wait for the network,
     while a fresh copy is fetched in the background for next time */
  e.respondWith(caches.match(request).then((hit) => {
    const network = fetch(request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
      return res;
    }).catch(() => hit || caches.match('index.html'));
    return hit || network;
  }));
});
