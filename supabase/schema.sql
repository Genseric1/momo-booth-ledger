-- ═══════════════════════════════════════════════════════════════════════════
-- MoMo Booth Ledger — Postgres schema for Supabase (spec §3, §9)
--
-- One booth = one row in `booths`. Data isolation is enforced by the database
-- through Row Level Security: a signed-in user only ever sees the rows of the
-- booths they are a member of. Every table is an append-only *version* log
-- keyed by a client-generated uuid, so a device that syncs twice cannot
-- duplicate or silently overwrite anything.
--
-- Run this once in the Supabase SQL editor, then create the manager account and
-- insert them into booth_members.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

create table if not exists booths (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists booth_members (
  booth_id  uuid not null references booths(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'agent' check (role in ('manager', 'agent', 'viewer')),
  primary key (booth_id, user_id)
);

-- Helper used by every policy below.
create or replace function is_booth_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from booth_members m where m.booth_id = b and m.user_id = auth.uid());
$$;

-- `server_at` is the pull cursor: assigned by the server, never by the client.
create or replace function set_server_at() returns trigger
language plpgsql as $$
begin
  new.server_at := clock_timestamp();
  return new;
end;
$$;

-- ── version tables ────────────────────────────────────────────────────────
create table if not exists day_versions (
  vid               uuid primary key,
  booth_id          uuid not null references booths(id) on delete cascade,
  date              date not null,
  rev               timestamptz not null,
  opening           jsonb,
  closing           jsonb,
  estimated_extras  numeric(14,2),
  closed            boolean not null default false,
  agent             text,
  device            text,
  server_at         timestamptz not null default clock_timestamp()
);

create table if not exists tx_versions (
  vid              uuid primary key,
  booth_id         uuid not null references booths(id) on delete cascade,
  tx_id            uuid not null,
  rev              timestamptz not null,
  day              date not null,
  "time"           timestamptz not null,
  type             text not null check (type in ('cash_in','cash_out','airtime','bundle')),
  wallet           text not null check (wallet in ('MTN','TELECEL','AT')),
  amount           numeric(14,2) not null,
  customer_number  text,                     -- ciphertext (enc:v1:...) or null
  sub_type         text check (sub_type in ('deposit','sending')),
  agent            text,
  note             text,
  cancelled        boolean not null default false,
  cancelled_at     timestamptz,
  device           text,
  server_at        timestamptz not null default clock_timestamp()
);

create table if not exists debt_account_versions (
  vid         uuid primary key,
  booth_id    uuid not null references booths(id) on delete cascade,
  account_id  uuid not null,
  rev         timestamptz not null,
  name        text not null,
  archived    boolean not null default false,
  created_at  timestamptz not null,
  device      text,
  server_at   timestamptz not null default clock_timestamp()
);

create table if not exists debt_entry_versions (
  vid         uuid primary key,
  booth_id    uuid not null references booths(id) on delete cascade,
  entry_id    uuid not null,
  rev         timestamptz not null,
  account_id  uuid not null,
  day         date not null,
  "time"      timestamptz not null,
  kind        text not null check (kind in ('lend','borrow','repay_received','repay_paid')),
  direction   text not null check (direction in ('owed_to_us','we_owe')),
  amount      numeric(14,2) not null,
  wallet      text not null check (wallet in ('MTN','TELECEL','AT','CASH')),
  agent       text,
  note        text,
  cancelled   boolean not null default false,
  device      text,
  server_at   timestamptz not null default clock_timestamp()
);

create table if not exists commission_versions (
  vid            uuid primary key,
  booth_id       uuid not null references booths(id) on delete cascade,
  commission_id  uuid not null,
  rev            timestamptz not null,
  month          text not null,             -- YYYY-MM
  wallet         text not null check (wallet in ('MTN','TELECEL','AT')),
  amount         numeric(14,2) not null,
  device         text,
  server_at      timestamptz not null default clock_timestamp()
);

-- ── indexes on the pull cursor and the projection keys ────────────────────
create index if not exists day_versions_pull  on day_versions (booth_id, server_at);
create index if not exists tx_versions_pull   on tx_versions (booth_id, server_at);
create index if not exists tx_versions_entity on tx_versions (booth_id, tx_id, rev desc);
create index if not exists tx_versions_day    on tx_versions (booth_id, day);
create index if not exists debt_acc_pull      on debt_account_versions (booth_id, server_at);
create index if not exists debt_entry_pull    on debt_entry_versions (booth_id, server_at);
create index if not exists commission_pull    on commission_versions (booth_id, server_at);

-- ── triggers ──────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['day_versions','tx_versions','debt_account_versions',
                           'debt_entry_versions','commission_versions']
  loop
    execute format('drop trigger if exists %I_server_at on %I', t, t);
    execute format('create trigger %I_server_at before insert or update on %I
                    for each row execute function set_server_at()', t, t);
  end loop;
end $$;

-- ── row level security ────────────────────────────────────────────────────
alter table booths                enable row level security;
alter table booth_members         enable row level security;
alter table day_versions          enable row level security;
alter table tx_versions           enable row level security;
alter table debt_account_versions enable row level security;
alter table debt_entry_versions   enable row level security;
alter table commission_versions   enable row level security;

drop policy if exists booths_read on booths;
create policy booths_read on booths for select using (is_booth_member(id));

drop policy if exists members_read on booth_members;
create policy members_read on booth_members for select using (user_id = auth.uid() or is_booth_member(booth_id));

-- Members may read and insert versions of their own booth. Nothing may be
-- updated or deleted: corrections are new versions, which keeps the register
-- auditable and makes syncing conflict-free.
do $$
declare t text;
begin
  foreach t in array array['day_versions','tx_versions','debt_account_versions',
                           'debt_entry_versions','commission_versions']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (is_booth_member(booth_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert with check (is_booth_member(booth_id))', t, t);
  end loop;
end $$;

-- ── first booth (edit the name, then add the manager) ─────────────────────
-- insert into booths (name) values ('PACSBI MoMo booth') returning id;
-- insert into booth_members (booth_id, user_id, role)
--   values ('<booth-id>', '<auth-user-id>', 'manager');
