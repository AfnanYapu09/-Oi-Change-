-- ============================================================================
-- GC · Trade Journal — Supabase schema
-- Run this once in your Supabase project (SQL Editor → New query → Run).
-- Then paste your Project URL + anon key into js/config.js.
--
-- This journal has NO login: it reads and writes with the anon role, so the
-- policies below grant the anon role full access. Because anyone with your
-- anon key could read/write, keep the key to yourself and treat the project as
-- a single private workspace. (Add Supabase Auth later if you want per-user
-- data — see the README.)
-- ============================================================================

create table if not exists assets (
  id           text primary key,
  name         text not null,
  sub          text default '',
  badge        text default '',
  colors       jsonb,            -- ["#dark", "#light"]
  trading_days jsonb,            -- [1,2,3,4,5]  (0=Sun … 6=Sat)
  sort         int  default 0,
  updated_at   timestamptz default now()
);

create table if not exists records (
  asset_id   text not null references assets(id) on delete cascade,
  date_key   text not null,      -- 'YYYY-MM-DD'
  data       jsonb not null,     -- the full day record (bias, targets, option flow, result…)
  updated_at timestamptz default now(),
  primary key (asset_id, date_key)
);

alter table assets  enable row level security;
alter table records enable row level security;

-- Full access for the anon role (single private, no-login workspace).
drop policy if exists "anon all assets"  on assets;
drop policy if exists "anon all records" on records;
create policy "anon all assets"  on assets  for all to anon using (true) with check (true);
create policy "anon all records" on records for all to anon using (true) with check (true);
