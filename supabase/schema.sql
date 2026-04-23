-- Your Internet Radio Dial — Supabase schema
-- M4.1 — initial tables, RLS, and updated_at triggers.
--
-- Paste this whole file into the Supabase SQL Editor and click "Run".
-- Safe to re-run: every statement is idempotent (drops + recreates policies,
-- uses `create table if not exists`, etc).
--
-- Design notes:
--   * Composite primary keys (user_id, id) so two users can independently own
--     rows with the same string id (e.g. both have "somafm-groove-salad").
--   * Stations / groups / memberships mirror the client-side store shape
--     (src/data/seed.ts). Field names are snake_case here, camelCase in TS —
--     the sync layer will map between them.
--   * RLS: every row is locked to its owning auth.uid(). Anonymous Supabase
--     users count as real users for RLS, so the same policies cover them.
--   * updated_at triggers give us a tie-breaker for future last-write-wins
--     sync conflict resolution.

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.stations (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  id           text        not null,
  name         text        not null,
  stream_url   text        not null,
  stream_type  text        not null,
  homepage     text,
  logo_url     text,
  country      text,
  language     text,
  bitrate      int,
  tags         text[],
  is_preset    boolean     not null default false,
  cors_ok      boolean,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.groups (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  id          text        not null,
  name        text        not null,
  position    int         not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.memberships (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  station_id  text        not null,
  group_id    text        not null,
  position    int         not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, station_id, group_id),
  foreign key (user_id, station_id) references public.stations(user_id, id) on delete cascade,
  foreign key (user_id, group_id)   references public.groups(user_id, id)   on delete cascade
);

-- Per-user singleton: active band, current station, volume.
create table if not exists public.user_settings (
  user_id            uuid        primary key references auth.users(id) on delete cascade,
  active_group_id    text,
  current_station_id text,
  volume             real        not null default 0.7,
  updated_at         timestamptz not null default now()
);

-- Helpful secondary indexes for typical reads.
create index if not exists groups_user_position_idx
  on public.groups (user_id, position);
create index if not exists memberships_user_group_position_idx
  on public.memberships (user_id, group_id, position);

-- ============================================================================
-- updated_at trigger
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.stations;
create trigger set_updated_at
  before update on public.stations
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.groups;
create trigger set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.memberships;
create trigger set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.user_settings;
create trigger set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.stations      enable row level security;
alter table public.groups        enable row level security;
alter table public.memberships   enable row level security;
alter table public.user_settings enable row level security;

-- stations
drop policy if exists "stations_select_own" on public.stations;
drop policy if exists "stations_insert_own" on public.stations;
drop policy if exists "stations_update_own" on public.stations;
drop policy if exists "stations_delete_own" on public.stations;

create policy "stations_select_own" on public.stations
  for select using (auth.uid() = user_id);
create policy "stations_insert_own" on public.stations
  for insert with check (auth.uid() = user_id);
create policy "stations_update_own" on public.stations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "stations_delete_own" on public.stations
  for delete using (auth.uid() = user_id);

-- groups
drop policy if exists "groups_select_own" on public.groups;
drop policy if exists "groups_insert_own" on public.groups;
drop policy if exists "groups_update_own" on public.groups;
drop policy if exists "groups_delete_own" on public.groups;

create policy "groups_select_own" on public.groups
  for select using (auth.uid() = user_id);
create policy "groups_insert_own" on public.groups
  for insert with check (auth.uid() = user_id);
create policy "groups_update_own" on public.groups
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "groups_delete_own" on public.groups
  for delete using (auth.uid() = user_id);

-- memberships
drop policy if exists "memberships_select_own" on public.memberships;
drop policy if exists "memberships_insert_own" on public.memberships;
drop policy if exists "memberships_update_own" on public.memberships;
drop policy if exists "memberships_delete_own" on public.memberships;

create policy "memberships_select_own" on public.memberships
  for select using (auth.uid() = user_id);
create policy "memberships_insert_own" on public.memberships
  for insert with check (auth.uid() = user_id);
create policy "memberships_update_own" on public.memberships
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "memberships_delete_own" on public.memberships
  for delete using (auth.uid() = user_id);

-- user_settings
drop policy if exists "user_settings_select_own" on public.user_settings;
drop policy if exists "user_settings_insert_own" on public.user_settings;
drop policy if exists "user_settings_update_own" on public.user_settings;
drop policy if exists "user_settings_delete_own" on public.user_settings;

create policy "user_settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "user_settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "user_settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_settings_delete_own" on public.user_settings
  for delete using (auth.uid() = user_id);
