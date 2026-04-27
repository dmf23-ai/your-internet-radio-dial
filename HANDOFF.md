# Handoff — Your Internet Radio Dial

> **Read these first (for the fresh-chat assistant):**
>
> 1. `.auto-memory/user_profile.md` — who David is and how to work with him
> 2. `.auto-memory/feedback_collaboration.md` — collaboration style (terse responses, milestone-based, patch diffs, etc.)
> 3. `.auto-memory/project_radio_dial.md` — project vision and constraints
> 4. `.auto-memory/project_hls_proxy_milestone.md` — the M2c proxy (architecture reference)
> 5. `.auto-memory/project_m3_milestone.md` — M3 library management (search + groups + drawer)
> 6. `.auto-memory/project_m4_milestone.md` — M4 Supabase auth + cloud sync
> 7. `.auto-memory/project_m5_polish_milestone.md` — M5 pre-deploy polish
> 8. `.auto-memory/project_deploy_checklist.md` — deploy punch list if that's where we are
>
> Then the rest of this doc. These memory files live at `<workspace>/.auto-memory/` (or at the user's global memory directory if the workspace copy isn't present — `MEMORY.md` lists them).

**Status (2026-04-26):** M1 → M8 shipped. Live at https://yourinternetradiodial.net. Full library management — search radio-browser, add stations by URL, rename/reorder/delete bands, reorder/remove stations. Supabase auth + cloud sync complete (anon-by-default, email upgrade preserves uid + data, magic-link sign-in for cross-device library load). M5 cleared the pre-deploy UX backlog (dial overflow, preset-bar overflow, About overlay, favicon, RADIO/BANDS brass labels, tagline). M6 added cross-device sign-in (overwrite, not merge). M7 added a rotate-to-landscape nudge for phones in portrait. M8 added "Add by URL" path inside the search overlay.

---

## What's built

| Milestone | Scope | Key files |
|-----------|-------|-----------|
| M1 | Seed data, dial UI, station caption lozenge | `src/data/seed.ts`, `src/components/Console.tsx`, `TunerKnob.tsx`, `DialWindow.tsx` |
| M2a | Audio engine (play/pause/volume/status), Zustand, IndexedDB (idb-keyval) | `src/lib/audio.ts`, `src/lib/store.ts`, `src/lib/storage.ts` |
| M2b | Now-playing metadata proxy + scrolling marquee caption | `src/app/api/now-playing/route.ts`, `DialWindow.tsx` |
| M2c | `/api/stream` (same-origin passthrough), `/api/hls` (manifest-rewriting), two-element audio engine, VU meter driven by real RMS, PresetBar wired to groups | `src/app/api/stream/route.ts`, `src/app/api/hls/route.ts`, `src/components/VUMeter.tsx`, `PresetBar.tsx` |
| M3 | `/api/stations` radio-browser proxy, search overlay (add), group editor (rename/reorder/create/delete), station-list drawer (tune/reorder/remove), dense-position invariant on all mutations | `src/app/api/stations/route.ts`, `src/components/SearchOverlay.tsx`, `GroupEditor.tsx`, `StationListDrawer.tsx`, `src/lib/store.ts` |
| M4 | Supabase schema + RLS, anonymous-by-default auth, write-through dual-sync (IndexedDB + cloud), pull-on-load, email upgrade that preserves uid & data, AccountDrawer + preset-bar person button, auth-change subscription (email confirmation flips Guest → Signed in without reload; sign-out mints fresh anon) | `supabase/schema.sql`, `src/lib/supabase/client.ts`, `src/lib/supabase/sync.ts`, `src/components/StoreHydrator.tsx`, `src/components/AccountDrawer.tsx`, `src/components/PresetBar.tsx` |
| M5 | Pre-deploy polish: drum-style dial ticker (station overflow), PresetBar edge-fade + drag-scroll + brass arrow-steppers (group overflow), "New Band" brass plaque, A FRUCHTOMANIA PRODUCTION tagline, vertical brass RADIO/BANDS labels, About/How-to overlay with "?" button, cathedral-radio favicon | `src/components/DialWindow.tsx`, `PresetBar.tsx`, `AboutOverlay.tsx`, `VerticalBrassLabel.tsx`, `src/app/icon.svg` |
| M6 | Cross-device magic-link sign-in. AccountDrawer's anon state has a "new account" / "sign in" mode toggle. Sign-in path uses `signInWithOtp({ shouldCreateUser:false })` so unknown emails get a clear error. StoreHydrator tracks the active uid in a ref and runs `pullFromCloud + applyCloudSnapshot` on auth-change when the uid actually changes (overwrite-not-merge semantics for the device's pre-sign-in guest library) | `src/lib/supabase/client.ts`, `src/components/AccountDrawer.tsx`, `src/components/StoreHydrator.tsx` |
| M7 | Mobile rotate-to-landscape nudge. Full-viewport overlay shows on phones held in portrait — animated phone-rotation icon + brass/walnut styling matching the cabinet. Detection: `(orientation: portrait) and (max-width: 820px) and (pointer: coarse)`. Dismissable per portrait session; resets on orientation change. (Browsers don't permit true orientation lock outside fullscreen, so this is the standard nudge pattern.) | `src/components/RotateOverlay.tsx`, `src/app/layout.tsx` |
| M8 | Add-station-by-URL. SearchOverlay grew a brass segmented "Search Directory / By URL" tab switcher. URL form: stream URL + station name, validates URL parses with http(s) protocol, infers `streamType` from path extension (.m3u8 → hls, .mp3, .aac, .ogg, else "unknown"), defaults `corsOk:false` so the proxy path is used. Reuses existing URL-based dedup in `addStationToGroup` | `src/components/SearchOverlay.tsx` |

---

## Architecture notes worth preserving

### Two-element audio engine (`src/lib/audio.ts`)

- `corsEl` — `crossOrigin="anonymous"`; routed through AudioContext graph (source → analyser → gain → destination). VU meter reads `getRms()` from the analyser.
- `nocorsEl` — no `crossOrigin`; plain element playback. Kept as a safety fallback but currently unused since every non-CORS stream now routes through `/api/stream` or `/api/hls` (both same-origin, so the graph stays untainted).
- `active: "cors" | "nocors"` tracks which element owns global status so idle-element events don't flip state.

### `corsOk` flag on `Station` (`src/data/seed.ts`)

- Default `true` (assume origin is CORS-clean).
- Set to `false` only when the origin refuses `crossOrigin="anonymous"` requests.
- Engine logic: `useProxy = !corsOk`; then HLS → `/api/hls`, else → `/api/stream`.

### `CURRENT_VERSION` in `src/lib/storage.ts`

Invalidates the user's IndexedDB cache on mismatch → forces re-seed. Bump whenever `seed.ts` shape changes so stale cached data doesn't shadow the new seed. Currently `9`.

### `/api/hls` manifest rewriting

- Rewrites bare segment URLs AND every `URI="..."` attribute on `#EXT-X-KEY`, `#EXT-X-MEDIA`, `#EXT-X-MAP`, `#EXT-X-I-FRAME-STREAM-INF`.
- Uses `upstream.url` (post-redirect) as the base for resolving relative paths.
- Binary-passthroughs segment requests; rewrites only when content-type looks like `mpegurl` or the URL ends with `.m3u8`.

### M3 library mutations — dense-position invariant

Every mutation in `src/lib/store.ts` that touches `groups` or `memberships` renumbers the affected group's `position` field to a dense `0..N-1` sequence. This makes `moveGroup` / `moveStationInGroup` a simple array swap + renumber and means UI sort-by-position is always stable.

- **User-added stations default to `corsOk: false`** — radio-browser doesn't expose CORS cleanliness, so forcing the proxy path is the always-works choice. Tiny latency hit, zero breakage.
- **Url-based dedup on add** — if an added radio-browser station shares its `streamUrl` with an existing station (e.g. a seed entry for Jazz24), the existing record is reused rather than creating a parallel entry with a different id.
- **Deleting the active group** auto-selects the first remaining group and tunes its first station (or nulls out if empty). **Last band cannot be deleted.**
- **Removing the currently-playing station** auto-advances to the next station in the band.

---

## Gotchas learned the hard way

- **Dead URLs masquerade as CORS problems.** When a station goes silent, check the server log first. `[/api/stream] upstream status 404` means the seed URL is stale, not that CORS is broken.
- **`radio-browser.info` is the source of truth for stream URLs.** API requires a `User-Agent` header or returns `[]`. Example: `curl -s -H "User-Agent: YIRD/1.0" "https://de1.api.radio-browser.info/json/stations/byname/<name>"`.
- **HLS needs same-origin for manifest AND segments** — not just the manifest. Segment URLs are embedded in the manifest; that's why M2c rewrites them.
- **BBC's master-playlist redirectors return stale pool numbers** (pool_904 → 410 Gone). Prefer the MP3 Icecast URL (`stream.live.vc.bbcmedia.co.uk/bbc_world_service`).
- **Monocle 24 and DW English moved behind paywalls / HLS-only.** `ABC News Radio (AU)` and `WNYC` are the working replacements.
- **VU meter SSR hydration warning** — `tickGeom` floating-point math produces tiny server/client mismatches. Known, not yet fixed. Fix by rounding tick coordinates to fixed precision or marking the SVG client-only.

---

## M4 — shipped

Supabase auth + cloud sync complete. Design notes:

- **Anonymous-by-default.** Every visitor gets a real `auth.uid()` on first load via `signInAnonymously`. No signup gate, and the uid persists in localStorage so a returning visitor keeps the same identity.
- **Single-user model, no merge logic.** `updateUser({ email })` on an anon user preserves the uid — all cloud rows keyed by `user_id` transfer automatically when they upgrade. No row-level merge code needed.
- **Write-through dual-sync.** `schedulePersist` writes to IndexedDB always; if `user` is set, it also pushes to cloud via `syncToCloud` (wipe-and-replace on each persist — good enough for a single-user library of this size).
- **Pull-on-load.** `StoreHydrator` sequence: hydrate IndexedDB → ensureAnonSession → pullFromCloud. Cloud wins on conflict. If cloud is empty, local seed is pushed up.
- **Auth-change subscription.** Email confirmation link flips the store user from anon to permanent in-place (same uid, now has email, `isAnonymous:false`) so the AccountDrawer updates without a page reload. Sign-out immediately mints a fresh anon session.
- **StrictMode lock.** `ensureAnonSession` is guarded by an in-flight promise so React 18 double-invoked effects don't create two anon users.
- **Supabase quirk.** Email upgrade uses `updateUser({ email })`, which fires the **"Change email address"** email template (not "Confirm sign up"). Since anon users have no prior email, the default template's "from [blank]" wording is odd — edit that template in the dashboard to read like a signup confirmation. See `supabase/SETUP.md`.

## M5 — shipped

Pre-deploy UX polish. Closed the entire design-dependent backlog in one pass so the first public version looks finished.

- **Dial-station overflow (drum-style ticker).** When a group has more stations than fit on the arc, the dial swaps to a horizontal drum/ticker strip: the red needle stays fixed dead-center (`left:50%, width:1px`, `#e34848 → #a82222` gradient), and station markers slide under it. Supports drag-to-tune AND click-to-jump.
- **PresetBar overflow.** Edge mask-fade + mouse drag-scroll + brass arrow-steppers that auto-hide at ends. Uses document-level pointer listeners instead of `setPointerCapture` so PresetButton long-press timers still cancel. PresetButton has its own 5px movement threshold that cancels long-press when the user is actually scrolling. The old "+" preset was replaced with a centered **"New Band"** brass plaque below the bar. Genre band removed from top of dial; **"A FRUCHTOMANIA PRODUCTION"** centered tagline there now.
- **About / How-to overlay.** `AboutOverlay.tsx`, triggered by a brass "?" at `absolute top-2 right-5 sm:top-3 sm:right-6`. Ivory-on-walnut service-manual body styling; 7 short sections in a warm 1940s-announcer tone. Store flag: `ui.aboutOpen` + `setAboutOpen`.
- **Vertical brass RADIO / BANDS labels.** Flank the dark PresetBar on the walnut, outside the cabinet pill. `<VerticalBrassLabel>` helper stacks upright uppercase letters at 11px / lineHeight 1.35 / letterSpacing 0.1em. Centered via `items-center` on the outer row so labels can overhang the bar naturally.
- **Favicon.** `src/app/icon.svg` — Next.js App Router auto-serves it. Cathedral-radio silhouette: arched walnut cabinet, brass-bezel amber dial with red needle at top, three brass grille bars. Silhouette-first so it reads at 16×16.

## M6 — shipped

Cross-device sign-in via magic link. Closes the gap from M4 (which assumed one device per account).

- **`signInWithEmail(email)` in `client.ts`** — wraps `signInWithOtp({ email, options: { shouldCreateUser:false, emailRedirectTo: window.location.origin } })`. `shouldCreateUser:false` means an unknown email errors clearly instead of silently creating a fresh user. `emailRedirectTo: window.location.origin` makes the link land back on whichever host (localhost or prod) sent it, so dev and prod both work without code changes — both must be in Supabase → URL Configuration → Redirect URLs.
- **AccountDrawer mode toggle** — anon state branches on a `mode: "new" | "existing"` flag. Same email field, different submit handler; toggle link at the bottom of the form (`Already have an account? Sign in instead →`). Sign-in copy includes a one-line warning: "Signing in will replace this device's guest library with your synced library."
- **StoreHydrator uid-change detection** — `knownUidRef` tracks the currently active uid. Auth-change subscriber compares prev vs new uid; on mismatch (only happens for true cross-device sign-in, NOT for the in-place anon→permanent upgrade), it runs `pullFromCloud + applyCloudSnapshot` to overwrite this device's local state with the user's synced library. Orphaned anon-uid rows in cloud are intentionally left behind.
- **Supabase dashboard step (must do once)** — enable the "Magic Link" email template in Authentication → Email Templates. Edit if needed to match the brand voice. Without this enabled, `signInWithOtp` will return an error.

## Deferred

- VU meter SSR hydration warning — cosmetic, low priority. Fix by rounding tick coordinates to fixed precision or marking the SVG client-only.
- Settings menu — `ui.menuOpen` / `setMenuOpen` are still in the store but no consumer. The PresetBar hamburger now opens the station list (M3.4); a new icon could be added for a future settings overlay.
- ESLint warning: `VUMeter.tsx:113` missing `startDeg` dep in `useEffect`. Non-blocking on Vercel; fix by adding the dep or disabling the rule inline.
- Orphan-anon-row cleanup — when a user signs in on a fresh device, the local anon uid's cloud rows (just the seed library, pushed by the bootstrap effect) are abandoned. Low priority; could be cleaned up by a Supabase scheduled function that deletes anon-user rows older than N days.

---

## Dev loop

`npm run dev` → `http://localhost:3000`. Hard-reload (Ctrl+Shift+R) after any `CURRENT_VERSION` bump.

Workspace folder name is always "Your Internet Radio Dial". Don't hardcode absolute paths that include session IDs.
