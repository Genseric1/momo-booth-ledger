# MoMo Booth Ledger — v1

Replaces the paper notebook of a mobile money booth in Ghana (MTN MoMo, Telecel
Cash, AT Money and physical cash). Built for the PACSBI Limited pilot: one booth,
one shared till, several agents.

Installable PWA, offline-first, no build step and no runtime dependency.

```bash
npm start          # http://localhost:8787
npm test           # the acceptance tests from the specification
npm run icons      # regenerate the app icons
```

A service worker needs `http://localhost` or HTTPS — opening `index.html` from
the file system will not work.

## What it looks like

One screen: the page of the notebook, and under it the totals block that writes
itself. A line is written exactly as on paper —

```
0244123456   mtn    in     400
0551234567   mtn    out    150
```

— the number, then in or out, then the amount. A number is **ten digits and
starts with 0**: a first digit that is not 0 is refused on the spot, and a
number read out without its zero ("244 123 456") gets it back. **The network is
read from the number while the agent types**, so it is one less thing to think about (it stays
one tap away when the guess is wrong, because numbers are portable).

The pen is one line at the foot of the page: number → `in` / `out` → amount →
✓, typed on the phone's own keyboard (or a PC's — Tab and Enter work). Ten
digits jump straight to the amount, and after a line is written the cursor comes
back ready for the next one. `airtime` and `bundle` sit under it for the rarer
lines.

Above the page, one quiet line says where each wallet stands. Everything else —
morning count, evening count, debts, statistics, export, settings — lives behind
the single ☰ button, so the list of the day keeps the whole screen.

Entry speed is the success criterion. If writing a line here is slower than
writing it in the notebook, agents go back to paper.

## Statistics and debts

**Statistics is one chart.** You choose what it draws — volume, cash in, cash
out, lines or capital — for one network or all of them, over 7 days, 30 days or
12 months. One series means one colour and no legend to decode; the figure above
it is the total for the period and how it compares with the period before. What
a line cannot say (biggest line, gaps, commissions) sits under it as plain rows.

**Debts are a name and an amount.** "Someone owes us" or "we owe someone", and
which wallet the money left or entered. It stays in the capital until it comes
back; tap the person, confirm the amount, and the line leaves the page. The
entries remain in the exported register.

## How the numbers work

For each non-cancelled transaction of amount A on network W:

| Type | W float | Cash |
|---|---|---|
| cash in | −A | +A |
| cash out | +A | −A |
| airtime | −A | +A |
| bundle | −A | +A |

* Expected closing = opening + everything above.
* Capital = MTN + Telecel + AT + cash + owed to us − we owe.
* **Gap = counted − expected**, per network and on the capital.
* With an extras estimate: **residual gap = gap − extras**.

The app never decides whether a gap is a mistake or a fee the agent charged on
top — it shows both numbers and lets the agent explain. When two networks are
off by the same amount in opposite directions, it says so: a line was probably
entered on the wrong network.

Commissions are paid by the networks at month end into separate accounts. They
are recorded for statistics only and never enter a daily total.

## Offline and sync

Every write goes to IndexedDB first and returns immediately; nothing waits for
the network. Records are **never overwritten**: an edit or a cancellation is a
new version with its own client-generated uuid and timestamp, and the newest
version of an entity wins (the uuid breaks ties, so every device projects the
same state). Two devices can write offline all day and sync in any order
without duplicating or losing a line.

Sync is optional. Without a backend the app is a complete local register.

### Supabase, and accounts

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor, then
   follow the comments at the end of that file: create the booth row, create
   each account yourself in **Authentication → Users**, and give it a role in
   `booth_members` (`manager`, `agent` or `viewer`).
2. Turn off public sign-ups — Authentication → Providers → Email → *Enable sign
   ups* off — so the link alone cannot create an account.
3. Put the project URL, the anon key and the booth id in
   [`js/config.js`](js/config.js) and publish. No agent ever types them.

`config.requireAccount` decides how the page opens:

| | |
|---|---|
| `config` empty | A local notebook on the device. No account, no server. |
| filled, `requireAccount: false` | Anyone with the link uses it; signing in adds sync. |
| filled, `requireAccount: true` | No account, no page. |

**The account is asked once.** After that the session is kept on the device and
the page opens with the PIN alone — with or without network. An account gate
that locks an agent out the day the network drops would be worse than the paper
it replaces.

Roles are enforced by the database, not the app: reading takes membership,
writing takes a role that may write, so a boss can be given a `viewer` account
that physically cannot touch the register. Rows can only ever be inserted, never
updated or deleted — the register stays auditable.

**Joining a booth later is safe.** Lines written before the device had a booth
are stamped with the real booth id on their way up, and their customer numbers
are re-encrypted under the new key when the PIN is next entered. A day written
before the account existed is not lost.

Any backend offering the same two operations (push versions by uuid, pull
versions after a cursor) can replace Supabase; see `js/sync.js`.

## Privacy

* The page shows the **whole customer number**, as the paper notebook does.
  Settings offer masked (`0244***123`), last four digits, or not storing them at
  all. The exported PDF masks them by default whatever the screen shows.
* Stored numbers are encrypted on the device with AES-GCM under a key derived
  from the booth PIN (PBKDF2), and stay encrypted when they sync — the server
  holds ciphertext only. Changing the PIN re-encrypts them and pushes new
  versions so the booth's other devices keep reading them.
* Numbers are never sent to analytics or logs, and never put in a URL.
* The PDF can be password-protected (PDF standard security handler, RC4-40).
  That keeps a casual reader out of a file sent over WhatsApp; it is not strong
  cryptography.

> **Before real customer numbers go on a server**, confirm the obligations under
> Ghana's Data Protection Act 2012 (Act 843), including registration with the
> Data Protection Commission, and whether the booth is controller or processor.
> This has not been verified — it is still open in §12 of the specification.

## Layout

```
index.html          shell            sw.js               offline cache
css/app.css         the paper look   manifest.webmanifest install metadata
js/util.js          money, dates, Ghana prefixes, masking
js/calc.js          the calculation rules  (pure, what the tests run against)
js/stats.js         the statistics         (pure)
js/db.js            IndexedDB version log
js/store.js         projection + mutations
js/sync.js          Supabase REST push/pull
js/crypto.js        PIN-derived field encryption
js/pdf.js           minimal PDF writer      js/pdfcrypt.js  MD5 + RC4
js/report.js        the register layout
js/ui.js            tiny DOM toolkit
js/screens/page.js     the notebook page + the totals block
js/screens/writer.js   the pen: number, in/out, amount
js/screens/counts.js   morning and evening count, and the verdict
js/screens/editline.js striking out and correcting a line
js/screens/menu.js     everything that is not the page
js/screens/         debts, statistics, exportpdf, settings, lock
tests/              the specification's acceptance tests
tools/make-icons.mjs generates the PNG icons
```

`sample-register.pdf` is an example of the exported register.

## Not in v1

Photo or OCR of transaction IDs, viewer accounts for bosses, several booths
under one owner, automatic reading of confirmation SMS. The data model leaves
room for all of them.

## Still to confirm with the pilot booth

* Whether agents accept the entry speed during a queue.
* Whether the tax authority wants the notebook itself or accepts this register.
* The exact fields on each network's agent statement (only MTN's was checked).
* The booth's legal status under Act 843.
