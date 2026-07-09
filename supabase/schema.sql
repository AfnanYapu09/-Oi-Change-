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

-- ── chart images ─────────────────────────────────────────────────────────
-- Actual image bytes live in a public Storage bucket (public so an <img> tag
-- can load them directly by URL, no signed-URL dance). "images" is a small
-- manifest table (slot id -> storage path) so a client can detect what
-- changed without listing the whole bucket, same idea as the updated_at
-- columns above.
insert into storage.buckets (id, name, public)
values ('chart-images', 'chart-images', true)
on conflict (id) do nothing;

drop policy if exists "anon all chart-images" on storage.objects;
create policy "anon all chart-images" on storage.objects for all to anon
  using (bucket_id = 'chart-images') with check (bucket_id = 'chart-images');

create table if not exists images (
  id         text primary key,   -- slot id, e.g. "img-gc-2026-07-09-baai-0"
  path       text not null,      -- object path within the chart-images bucket
  updated_at timestamptz default now()
);
alter table images enable row level security;
drop policy if exists "anon all images" on images;
create policy "anon all images" on images for all to anon using (true) with check (true);
