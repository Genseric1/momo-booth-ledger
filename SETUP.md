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

This is the last step, and it happens **after** each person has tried to sign
in once — signing in is what creates their account row.

1. Ask the person to open the app and sign in (with Google, or with an email
   and a password you gave them).
2. The app turns them away with a line like:
   *"That account is not on this booth's list yet. Give the manager this:
   kwame@gmail.com (id 9c1e...)"*
   Ask them to send you that line.
3. In the SQL Editor:

```sql
insert into booth_members (booth_id, user_id, role) values
  ('PASTE-THE-BOOTH-ID', 'PASTE-THE-ACCOUNT-ID', 'manager');
```

   Roles: `manager` and `agent` can write the register; `viewer` can only read
   it — the database refuses every line a viewer tries to write, and the app
   hides the pen from him.
4. They sign in again. They are in, and from then on every device of the booth
   shows the same page.

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
| Every line, every correction, every deletion | The booth PIN |
| Morning and evening counts | The agent chip list |
| Debts and repayments | How customer numbers are displayed |
| Monthly commissions | |

Customer numbers travel **encrypted**: the server never sees them in clear.
The key comes from the booth PIN, so every device of the booth must use the
**same PIN** to read them. Choose it once, together.

## If something is wrong

- **"Could not reach the booth server"** — no network, or the Project URL is
  mistyped. It is `https://` + the project ref + `.supabase.co`, nothing after.
- **Signed in, but nothing arrives** — the account is signed in but not on the
  booth's list (step 7), or the booth id in `config.js` is not the one from
  step 3.
- **Lines written before all this** are not lost: they are stamped with the
  booth the first time the phone syncs, and they go up like the rest.
