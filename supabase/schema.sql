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
-- Data API grants (per-user tables)
--
-- Supabase announced 2026-04-28 that new tables in `public` will no longer
-- be granted to the Data API roles automatically. The change applies to all
-- existing projects on 2026-10-30. Adding explicit grants here so this file
-- still produces a working schema if the project is ever recreated or opts
-- in early. RLS remains the real gate — these grants only make the tables
-- visible to PostgREST. See: https://github.com/orgs/supabase/discussions/45329
--
-- Every per-user table needs full CRUD for `authenticated` (anon-signed-in
-- and permanent users both run as `authenticated`). `anon` covers the brief
-- window before signInAnonymously completes. `service_role` covers any
-- future server-side maintenance.
-- ============================================================================

grant select, insert, update, delete on public.stations      to anon, authenticated, service_role;
grant select, insert, update, delete on public.groups        to anon, authenticated, service_role;
grant select, insert, update, delete on public.memberships   to anon, authenticated, service_role;
grant select, insert, update, delete on public.user_settings to anon, authenticated, service_role;

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

-- ============================================================================
-- Lineup markers + atomic library sync (2026-10-05)
--
-- customized_at: when the user last edited their library (added, removed or
-- reordered stations; created, renamed, deleted or reordered bands). NULL =
-- never customized: the client moves those users onto each new default
-- lineup automatically.
-- seed_version: the default-lineup version (CURRENT_VERSION in
-- src/lib/storage.ts) the library reflects. NULL = last written by a client
-- that predates these markers; the client then infers both markers from
-- the library itself.
-- ============================================================================

alter table public.user_settings
  add column if not exists customized_at timestamptz,
  add column if not exists seed_version  integer;

-- replace_user_library: replaces the caller's stations, groups and
-- memberships and upserts their user_settings in ONE transaction. The
-- client's sync (src/lib/supabase/sync.ts) used to be seven sequential
-- requests (delete everything, then insert everything); a pull overlapping
-- them could read an empty library. Readers now see the old library or the
-- new one, never a mix, and a failed write leaves the old one intact.
--
-- SECURITY INVOKER: runs as the caller, so the RLS policies above still
-- apply, and rows are written for auth.uid() only. p_user_id must equal
-- auth.uid(), so a payload queued for one account can't land in another if
-- the session switched before it was sent.
--
-- p_settings keys: active_group_id, current_station_id, volume, plus the
-- optional lineup markers customized_at / seed_version. An absent marker key
-- keeps the stored value (clients that predate the markers don't send them);
-- a key present with null sets NULL.
create or replace function public.replace_user_library(
  p_user_id     uuid,
  p_stations    jsonb,
  p_groups      jsonb,
  p_memberships jsonb,
  p_settings    jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'replace_user_library: not authenticated'
      using errcode = '42501';
  end if;
  if p_user_id is distinct from v_uid then
    raise exception 'replace_user_library: p_user_id does not match the session'
      using errcode = '42501';
  end if;

  delete from public.memberships where user_id = v_uid;
  delete from public.stations    where user_id = v_uid;
  delete from public.groups      where user_id = v_uid;

  insert into public.stations
    (user_id, id, name, stream_url, stream_type, homepage, logo_url,
     country, language, bitrate, tags, is_preset, cors_ok)
  select v_uid, s.id, s.name, s.stream_url, s.stream_type, s.homepage,
         s.logo_url, s.country, s.language, round(s.bitrate)::int, s.tags,
         coalesce(s.is_preset, false), s.cors_ok
  from jsonb_to_recordset(coalesce(p_stations, '[]'::jsonb)) as s(
    id text, name text, stream_url text, stream_type text, homepage text,
    logo_url text, country text, language text, bitrate numeric,
    tags text[], is_preset boolean, cors_ok boolean
  );

  insert into public.groups (user_id, id, name, position)
  select v_uid, g.id, g.name, g.position
  from jsonb_to_recordset(coalesce(p_groups, '[]'::jsonb))
    as g(id text, name text, position int);

  insert into public.memberships (user_id, station_id, group_id, position)
  select v_uid, m.station_id, m.group_id, m.position
  from jsonb_to_recordset(coalesce(p_memberships, '[]'::jsonb))
    as m(station_id text, group_id text, position int);

  insert into public.user_settings as us
    (user_id, active_group_id, current_station_id, volume,
     customized_at, seed_version)
  values (
    v_uid,
    p_settings ->> 'active_group_id',
    p_settings ->> 'current_station_id',
    coalesce((p_settings ->> 'volume')::real, 0.7),
    (p_settings ->> 'customized_at')::timestamptz,
    (p_settings ->> 'seed_version')::integer
  )
  on conflict (user_id) do update set
    active_group_id    = excluded.active_group_id,
    current_station_id = excluded.current_station_id,
    volume             = excluded.volume,
    customized_at      = case when p_settings ? 'customized_at'
                              then excluded.customized_at
                              else us.customized_at end,
    seed_version       = case when p_settings ? 'seed_version'
                              then excluded.seed_version
                              else us.seed_version end;
end;
$$;

-- Data API grants: callable by signed-in users (anonymous sign-ins
-- included; both run as `authenticated`). Revoked from PUBLIC and `anon`:
-- without a session there's no auth.uid() to write for.
revoke all on function public.replace_user_library(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.replace_user_library(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- Have PostgREST pick up the new columns and function right away.
notify pgrst, 'reload schema';

-- ============================================================================
-- Suggestions (M12.5)
--
-- A write-only inbox for user feedback: station nominations for the default
-- seed, plus general suggestions. Read access is service-role only (i.e.
-- David reading from the Supabase dashboard) — no anon/auth select policy
-- exists, so RLS denies reads from the browser.
-- ============================================================================

create table if not exists public.suggestions (
  id            uuid        primary key default gen_random_uuid(),
  -- Nullable: set when the submitter has a Supabase session (anon or
  -- permanent), null otherwise. on delete set null so a user signing out
  -- doesn't drop their suggestions from the inbox.
  user_id       uuid        references auth.users(id) on delete set null,
  kind          text        not null check (kind in ('station','other')),
  -- station fields (used when kind='station')
  station_name  text,
  station_url   text,
  station_notes text,
  -- other fields (used when kind='other')
  message       text,
  -- optional contact email for follow-up — independent of the user's auth
  -- email, since signed-in users may want to suggest under a different
  -- address (or none).
  contact_email text,
  -- meta
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists suggestions_created_at_idx
  on public.suggestions (created_at desc);

-- Data API grants: browser is INSERT-only (RLS enforces); service_role gets
-- full CRUD so the dashboard / future server code can read & manage.
grant insert                              on public.suggestions to anon, authenticated;
grant select, insert, update, delete      on public.suggestions to service_role;

alter table public.suggestions enable row level security;

drop policy if exists "suggestions_insert_any" on public.suggestions;
-- INSERT-only from the browser. user_id must either be null (best-effort) or
-- match the caller's auth.uid() so people can't impersonate other users'
-- suggestions. No SELECT/UPDATE/DELETE policy exists, so the anon key cannot
-- read or modify rows — only the service-role key (used from the dashboard)
-- can.
create policy "suggestions_insert_any" on public.suggestions
  for insert with check (
    user_id is null or auth.uid() = user_id
  );

-- ============================================================================
-- Song ID cache (M18)
--
-- Shared community cache for AudD song-identification results, keyed by
-- station_id. The /api/song-id route checks this table before calling AudD;
-- a hit younger than ~60s is returned immediately so multiple users tuned
-- to the same station within the TTL window only cost one AudD call.
--
-- Not user-scoped — this is a public lookup, intentionally readable and
-- writable by anyone with the anon key. Worst-case abuse is a polluted
-- artist/title string for a station, which the next legitimate ID call
-- overwrites within seconds. If abuse becomes a real problem, tighten by
-- moving writes behind a service-role API route.
-- ============================================================================

create table if not exists public.song_id_cache (
  station_id    text        primary key,
  artist        text,
  title         text,
  identified_at timestamptz not null default now()
);

create index if not exists song_id_cache_identified_at_idx
  on public.song_id_cache (identified_at desc);

-- Data API grants: shared community cache. /api/song-id (server) reads with
-- the anon key (no user JWT → anon role) and writes results back.
grant select, insert, update              on public.song_id_cache to anon, authenticated;
grant select, insert, update, delete      on public.song_id_cache to service_role;

alter table public.song_id_cache enable row level security;

drop policy if exists "song_id_cache_select_any" on public.song_id_cache;
drop policy if exists "song_id_cache_insert_any" on public.song_id_cache;
drop policy if exists "song_id_cache_update_any" on public.song_id_cache;

create policy "song_id_cache_select_any" on public.song_id_cache
  for select using (true);
create policy "song_id_cache_insert_any" on public.song_id_cache
  for insert with check (true);
create policy "song_id_cache_update_any" on public.song_id_cache
  for update using (true) with check (true);

-- ============================================================================
-- Events (M23) — generic analytics log
--
-- Append-only event stream powering the /admin dashboard. One row per
-- interesting thing: every page mount, every station tune (including scans
-- and reconnects, distinguished by metadata.source), every song-ID button
-- press, and a heartbeat every 60s while audio is actively playing.
--
-- user_id is nullable — we attach the caller's anon/permanent uid when a
-- session exists but never block the insert if it doesn't. on delete set
-- null so a user signing out (and the next anon session creating a new uid)
-- doesn't drop the historical events from the log.
--
-- RLS: anon key may INSERT but cannot SELECT/UPDATE/DELETE. Aggregation
-- reads run from /api/admin/metrics using the service-role key (server
-- only), gated by the caller's email matching the admin email.
-- ============================================================================

create table if not exists public.events (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,
  event_type  text        not null check (event_type in (
                              'page_view',
                              'station_tune',
                              'song_id_request',
                              'session_heartbeat'
                          )),
  station_id  text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_created_at_idx
  on public.events (created_at desc);
create index if not exists events_type_time_idx
  on public.events (event_type, created_at desc);
create index if not exists events_station_time_idx
  on public.events (station_id, created_at desc)
  where station_id is not null;

-- Data API grants: browser is INSERT-only (RLS enforces); /api/admin/metrics
-- reads via service_role.
grant insert                              on public.events to anon, authenticated;
grant select, insert, update, delete      on public.events to service_role;

alter table public.events enable row level security;

drop policy if exists "events_insert_any" on public.events;

-- INSERT-only from the browser. user_id must either be null (best-effort)
-- or match the caller's auth.uid() so nobody can spoof another user's
-- activity. No SELECT/UPDATE/DELETE policy exists — only the service-role
-- key (used from /api/admin/metrics) can read.
create policy "events_insert_any" on public.events
  for insert with check (
    user_id is null or auth.uid() = user_id
  );
