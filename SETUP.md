# Connecting the booth — step by step

Until this is done, the app is a notebook on one phone: it works, but each
phone has its own page. After it, every account of the booth sees the same
lines, on every device, within seconds.

You do this **once**, and it takes about twenty minutes. Nothing here costs
money: Supabase's free plan is far above what a booth writes in a year.

Have ready: the manager's email, and the MoMo manager's **own gmail address**.

---

## 1. Create the project (5 min)

1. Go to **https://supabase.com** and click *Start your project*. Sign in with
   GitHub or with an email.
2. Click **New project**.
   - *Name*: `pacsbi-momo`
   - *Database password*: click **Generate**, then **copy it somewhere safe**.
     You will not need it for the app, but you cannot get it back.
   - *Region*: choose the one nearest to Ghana — **West EU (London)** is the
     closest on the free plan.
3. Click **Create new project** and wait about two minutes.

## 2. Create the tables (2 min)

1. In the left menu, click **SQL Editor**, then **New query**.
2. Open the file `supabase/schema.sql` from this project, copy **everything**,
   and paste it into the editor.
3. Click **Run**. It should end with *Success. No rows returned*.

If it complains about something already existing, the file is safe to run
again — it only creates what is missing.

## 3. Create the booth, and keep its id (2 min)

Still in the SQL Editor, new query:

```sql
insert into booths (name) values ('PACSBI MoMo booth') returning id;
```

Run it. A line comes back with an `id` like
`3f8a1c92-...`. **Copy that id** — it is the booth id the app needs.

## 4. Close the door (1 min)

By default anybody who finds the address could create themselves an account.
Turn that off:

**Authentication → Sign In / Providers → Email** → switch **Allow new users to
sign up** off, and **Save**.

## 5. Let the MoMo manager in with his gmail (5 min)

1. **Authentication → Sign In / Providers → Google** → switch it on.
2. It asks for a *Client ID* and a *Client Secret*. Get them at
   **https://console.cloud.google.com** →
   *APIs & Services* → *Credentials* → **Create credentials** → *OAuth client
   ID* → type **Web application**.
   - In **Authorised redirect URIs**, paste the *Callback URL* that Supabase
     shows you on that same Google provider page (it ends in
     `/auth/v1/callback`).
   - Create it, then copy the **Client ID** and **Client secret** back into
     Supabase and **Save**.
3. **Authentication → URL Configuration** → in **Redirect URLs**, add the
   address of the app:
   `https://genseric1.github.io/momo-booth-ledger/`

## 6. Give me three things

From **Project Settings → API**:

| What | Where |
|---|---|
| **Project URL** | at the top, `https://xxxxxxxx.supabase.co` |
| **anon public key** | the long `eyJ...` key marked **anon** — *never* the one marked `service_role` |
| **Booth id** | the id from step 3 |

Send me those three. **Never send a password** — I do not need one, and I will
not ask for one. I put them in `js/config.js`, publish, and the account door
opens for everyone.

## 7. Put each person on the booth's list

An account says who someone is. The booth's list says who may come in, and as
what. The two are separate on purpose: otherwise any account on your project
could read the register.

### The way you will do it

1. **Authentication → Users → Add user → Create new user**: their email, a
   password you make up for now, *Auto Confirm User* on.
2. Their line appears in the table straight away. **Copy the UID** from the
   first column.
3. In the SQL Editor:

```sql
insert into booth_members (booth_id, user_id, role) values
  ('PASTE-THE-BOOTH-ID', 'PASTE-THE-UID', 'manager');
```

4. Send them the password. They sign in — **it works the first time**.
5. Tell them to change it: **☰ → Settings → Your account → Change my
   password**. The one you made up was only a ticket in; after that nobody
   else knows theirs, you included.

### The one case where they are turned away first

With **Continue with Google**, the account does not exist until the person has
signed in once. So the first attempt is refused, and the page shows them
exactly what you need:

> *That account is not on this booth's list yet. Give the manager this:
> kwame@gmail.com (id 9c1e...)*

They send you that line, you run the same `insert` with that id, they sign in
again. Nothing was broken — that refusal is the normal first step for Google.

### The four to start with

Kojo runs the MoMo business and writes nearly every line, so the app already
stamps his name on a line unless someone picks another from the menu.

| Person | Role to give | What it gives |
|---|---|---|
| **Kojo** | `manager` | everything: writes, corrects, deletes, counts, exports, and reopens a closed day |
| **Modeste** | `manager` | exactly the same as Kojo |
| **Codjo** (CEO) | `viewer` | reads everything, cannot touch a line |
| **Séphora** (COO) | `viewer` | same |

`manager` is full access — Kojo and Modeste are equal, neither can do anything
the other cannot. `agent` writes the register but cannot reopen a day that was
closed and counted: that stays with the manager. Change `viewer` to `agent` or
`manager` for anyone who should also be able to write.

Once each of the four has signed in once and sent you their id:

```sql
insert into booth_members (booth_id, user_id, role) values
  ('BOOTH-ID', 'KOJO-ID',     'manager'),
  ('BOOTH-ID', 'MODESTE-ID',  'manager'),
  ('BOOTH-ID', 'CODJO-ID',    'viewer'),
  ('BOOTH-ID', 'SEPHORA-ID',  'viewer');
```

The other four — Pio, Fofana, Anherma, Djamale — already appear in the list of
who can be named on a line. Give them an account the same way, the day they
need one.

---

## What is shared, and what is not

| Shared between all accounts | Stays on the phone |
|---|---|
| Every line, every correction, every deletion | Nothing, once signed in |
| Morning and evening counts | |
| Debts and repayments | |
| Monthly commissions | |

Customer numbers are kept in the booth's own database and refused to anyone
outside it. If you would rather not keep them at all, Settings has
*Customer numbers → Last 4 only* or *Do not store* — the surest answer to
Ghana's Data Protection Act.

## If something is wrong

- **"Could not reach the booth server"** — no network, or the Project URL is
  mistyped. It is `https://` + the project ref + `.supabase.co`, nothing after.
- **Signed in, but nothing arrives** — the account is signed in but not on the
  booth's list (step 7), or the booth id in `config.js` is not the one from
  step 3.
- **Lines written before all this** are not lost: they are stamped with the
  booth the first time the phone syncs, and they go up like the rest.

---

# Going live

Two things, in this order. Twenty minutes in all, once.

## 1. Empty the register (you, on the PC — 2 min)

The database still holds the lines written while setting all this up. The real
ledger should start on a clean page: it is the document that may one day be
asked for as a record.

Open the SQL editor:
`https://supabase.com/dashboard/project/mzslslabhwbonpklpzcv/sql/new`

Paste, then **Run**:

```sql
delete from tx_versions            where booth_id = '0403c685-eb17-4c5c-abd2-ed3b165198f7';
delete from day_versions           where booth_id = '0403c685-eb17-4c5c-abd2-ed3b165198f7';
delete from debt_entry_versions    where booth_id = '0403c685-eb17-4c5c-abd2-ed3b165198f7';
delete from debt_account_versions  where booth_id = '0403c685-eb17-4c5c-abd2-ed3b165198f7';
delete from commission_versions    where booth_id = '0403c685-eb17-4c5c-abd2-ed3b165198f7';
```

*Success. No rows returned.* The booth, the accounts and the access list are
untouched — only the register is emptied.

**Do this before touching the phones.** The other way round, a phone that syncs
brings the old lines straight back.

## 2. Install it on each device (2 min each)

An app opened in a browser tab works, but only an **installed** one keeps
working when the network drops — and at a booth, it will.

| | |
|---|---|
| **iPhone** | Open the address in **Safari** (not Chrome) → the **Share** button (the square with an arrow) → **Add to Home Screen** |
| **Android** | Open it in **Chrome** → the **⋮** menu → **Install app**, or **Add to Home screen** |
| **PC** | Chrome, Edge or Brave → the small **install** icon at the right of the address bar |

The address: `https://genseric1.github.io/momo-booth-ledger/`

Then, **from the new icon**, not from the browser:

1. Open the app.
2. Sign in with your email and your password.
3. If old test lines are still showing: **☰ → Settings → Erase local data**, then
   sign in again. The page comes back empty, and stays that way.

On an iPhone the installed app has its own storage, separate from Safari's, so
it starts empty on its own — the sign-in is the only step.

## 3. One last check, together

Kojo writes a line on his phone. You watch it appear on yours. Five seconds,
and you both know it works.
