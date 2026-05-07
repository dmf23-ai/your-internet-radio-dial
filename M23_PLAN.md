# M23 — Analytics dashboard (`/admin`)

A David-only dashboard at `yourinternetradiodial.net/admin` showing visitors,
listening activity, song-ID requests, top stations, suggestions, and other
trackable info — styled in YIRD's walnut + brass aesthetic.

---

## What we're shipping

**A. New Supabase table: `events`**

A general-purpose, append-only event log. Every interesting thing the user
does writes one row. Service-role-only reads, anon-allowed insert.

```sql
create table public.events (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,
  event_type  text        not null check (event_type in (
                              'page_view',
                              'station_tune',
                              'song_id_request',
                              'session_heartbeat'
                          )),
  station_id  text,                    -- nullable; set for tune + song_id
  metadata    jsonb,                   -- nullable; e.g. {"source":"scan"}
  created_at  timestamptz not null default now()
);
-- Indexes for the dashboard queries we'll run:
create index events_created_at_idx  on public.events (created_at desc);
create index events_type_time_idx   on public.events (event_type, created_at desc);
create index events_station_time_idx on public.events (station_id, created_at desc) where station_id is not null;

alter table public.events enable row level security;
-- INSERT-only from anon. No SELECT/UPDATE/DELETE policy → service-role only.
create policy "events_insert_any" on public.events
  for insert with check (
    user_id is null or auth.uid() = user_id
  );
```

**B. Client-side analytics helper: `src/lib/analytics.ts`**

Tiny module exporting four functions:

- `trackPageView()` — fired once per app mount (from `StoreHydrator`)
- `trackStationTune(stationId, source)` — fired from the radio store's
  `setCurrentStation` action; `source` distinguishes manual / scan / preset / drawer
- `trackSongIdRequest(stationId, hit)` — fired from `NowPlayingLozenge` when
  the user taps the brass plaque; `hit` = whether AudD returned a match
- `trackSessionHeartbeat()` — fired every 60 s while `playback.status` is
  `"playing"`, from a new effect inside `StoreHydrator`

All four no-op gracefully when supabase isn't configured. Errors are swallowed
silently so analytics never breaks the app.

**C. Instrumentation points (5 small edits)**

| File | What to add |
|---|---|
| `src/components/StoreHydrator.tsx` | `trackPageView()` after session bootstrap; heartbeat interval driven by `playback.status` |
| `src/lib/store.ts` | `trackStationTune()` inside `setCurrentStation` (skips no-op same-station calls already handled there) |
| `src/components/NowPlayingLozenge.tsx` | `trackSongIdRequest()` after the API response resolves |

**D. Server-side admin API routes**

Two new Next API routes — both server-only, both gated by checking the
session-cookie email matches `dmf23@dawgranch.org`. They use the
`SUPABASE_SERVICE_ROLE_KEY` (server env, never shipped to browser) so RLS
doesn't get in the way of cross-user aggregation.

- `/api/admin/metrics` — single round-trip that returns:
  - Total users (anon + permanent), broken out
  - New users per day (last 30 days)
  - Page views per day (last 30 days, from `events`)
  - Unique daily-visitors per day (distinct user_id per day)
  - Total / 24h / 7d / 30d song-ID request counts
  - Song-ID hit rate (matches vs. unknowns)
  - Top 10 stations by tune count (last 30 days)
  - Top 10 stations by total listening minutes (heartbeat count × 60 s)
  - Total listening minutes (24h, 7d, 30d, all-time)
  - Average session length (heartbeat clusters with > 5min gap = new session)
  - Recent suggestions (latest 20)
  - Currently-tuned snapshot (count by `user_settings.current_station_id`)

~~`/api/admin/vercel`~~ — **dropped.** Since we're already tracking page_views
ourselves, Vercel adds nothing the dashboard needs. The `<Analytics />`
widget stays in `layout.tsx` so Vercel's own dashboard is still available as
a cross-check whenever David wants it.

**E. Dashboard page: `src/app/admin/page.tsx`**

Email gate at the top of the page (anything else just renders "Nothing to
see here" so a logged-in stranger doesn't see hints). Tiles arranged in a
walnut cabinet:

```
┌─────────────────────────────────────────────────────────┐
│  YIRD — STATION LOG                          [refresh]  │
├──────────────┬──────────────┬──────────────┬────────────┤
│  TOTAL USERS │  PAGE VIEWS  │  LISTENING   │  SONG IDs  │
│   1,234      │   8,901      │   42 hrs     │   217      │
│  ▔▔▔▔▔▔▔▔   │  ▔▔▔▔▔▔▔▔   │  ▔▔▔▔▔▔▔▔   │  ▔▔▔▔▔▔▔▔ │
├──────────────┴──────────────┴──────────────┴────────────┤
│  DAILY ACTIVITY (last 30 days)                          │
│  [vertical bar chart styled like a VU meter ladder]     │
├─────────────────────────────────┬───────────────────────┤
│  TOP STATIONS                   │  TUNED IN NOW         │
│  1. SomaFM Groove Salad   142   │  • SomaFM Groove …  4 │
│  2. WFMU                   89   │  • WFMU             2 │
│  …                              │  …                    │
├─────────────────────────────────┼───────────────────────┤
│  RECENT SONG IDs                │  SUGGESTION BOX       │
│  Boards of Canada — Dayvan…    │  "Add WFUV"           │
│  Brian Eno — 1/1                │  "Love this app!"     │
│  …                              │  …                    │
└─────────────────────────────────┴───────────────────────┘
```

Visual elements:
- Walnut wood-grain cabinet using existing `.surface-wood`
- Brass-bezeled tile frames using `.surface-brass`
- Big numerals in DM Serif Display (matches the dial's frequency markings)
- Headings in Cormorant Garamond, uppercase + tracking-wide (matches existing
  panels like AccountDrawer, StationListDrawer)
- VU-meter-style bar chart (rectangles with subtle amber glow, matching the
  existing `VUMeter` component's vocabulary)
- Refresh button styled like the brass envelope / power switch
- Mobile-responsive: tiles stack to single column; charts stay readable

**F. Required environment variables (you add these)**

One new env var in `.env.local` (and on Vercel for production):

```bash
# server-only — never ship to browser. Used by /api/admin/metrics for
# cross-user aggregation reads that bypass RLS.
SUPABASE_SERVICE_ROLE_KEY=...   # from Supabase → Project Settings → API
```

Will update `.env.local.example` with these so future-you remembers.

---

## Files touched / created

**New:**
- `src/lib/analytics.ts`
- `src/app/admin/page.tsx`
- `src/app/admin/Dashboard.tsx` (client component — splits the page so the page can stay a server component for the email gate)
- `src/app/api/admin/metrics/route.ts`
- `src/lib/supabase/server.ts` (service-role client — server-only)

**Modified:**
- `supabase/schema.sql` (events table + RLS)
- `src/components/StoreHydrator.tsx` (page_view + heartbeat)
- `src/lib/store.ts` (station_tune in `setCurrentStation`)
- `src/components/NowPlayingLozenge.tsx` (song_id_request)
- `.env.local.example` (new env vars)
- `HANDOFF.md` (M23 entry at the bottom)

---

## Open questions / known caveats

1. **Vercel Analytics API is undocumented.** If their endpoint refuses our
   token or returns an unexpected shape, the dashboard falls back to our
   own `page_view` counts (which we're logging anyway). Numbers won't match
   Vercel's exactly because Vercel does its own bot filtering — that's
   expected and fine for a personal dashboard.

2. **Heartbeat granularity is 60 s.** A user who plays for 30 s gets logged
   as 60 s. Could go finer but it'd 4× our event volume. 60 s is a fine
   compromise for a personal-scale app.

3. **Tune events fire on ALL station changes**, including scan ticks. Scan
   churns through stations every 8 s, so popular-station rankings would be
   meaningless without filtering. Solution: include `metadata.source` on
   each tune event (`"manual"`, `"scan"`, `"preset"`, `"drawer"`,
   `"reconnect"`) and filter out `"scan"` and `"reconnect"` from the
   popularity ranking.

4. **Email gate is client-readable.** Anyone curious enough to inspect the
   network tab can see that we're checking the email field — but the API
   routes themselves verify the session-cookie's email server-side, so
   spoofing the client doesn't get you data. The route returns 403 if the
   email isn't yours.

5. **Storage cost is negligible.** Heartbeats every 60 s × ~10 concurrent
   users × 24 h = ~14k rows/day. Supabase free tier handles this fine for
   years. We can add a 90-day retention policy later if it ever matters.
