// M23 — analytics event logging.
//
// Tiny client-side helper that fires append-only rows into public.events.
// Every interesting thing the user does writes one row, which the /admin
// dashboard then aggregates server-side via /api/admin/metrics.
//
// Design notes:
//   * No-ops gracefully when supabase isn't configured (just like the rest
//     of the cloud layer — the app stays fully usable in local-only mode).
//   * Errors are swallowed silently. Analytics MUST NOT break the app — a
//     dropped event is far less bad than a tuned-out user staring at an
//     uncaught promise rejection.
//   * Writes attach the current uid when a session exists. Anon visitors
//     still get a uid via ensureAnonSession() during StoreHydrator's first
//     pass, so most events end up with a non-null user_id.
//   * Browser-only. Calls are no-ops on the server (typeof window check
//     inside getSupabase()).

import { getSupabase } from "./supabase/client";

type EventType =
  | "page_view"
  | "station_tune"
  | "song_id_request"
  | "session_heartbeat";

/**
 * Source-of-tune classifier. Used to filter scan churn and reconnect
 * thrash out of station-popularity rankings on the admin dashboard.
 *   manual    — user clicked the dial / dragged the cursor
 *   preset    — user clicked a station preset button
 *   drawer    — user clicked a station from the station-list drawer
 *   url       — useStationURL() restored a station from ?station= on mount
 *   scan      — auto-advance during scan-across-bands
 *   reconnect — engine retried after a stream drop (shouldn't count toward
 *               popularity since the user didn't actively choose it)
 */
export type TuneSource =
  | "manual"
  | "preset"
  | "drawer"
  | "url"
  | "scan"
  | "reconnect";

interface InsertRow {
  event_type: EventType;
  station_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

async function logEvent(row: InsertRow): Promise<void> {
  try {
    const sb = getSupabase();
    if (!sb) return;
    // Attach current uid if a session exists. The server enforces
    // (user_id is null OR user_id = auth.uid()) so spoofing is impossible.
    const {
      data: { session },
    } = await sb.auth.getSession();
    const user_id = session?.user?.id ?? null;
    await sb.from("events").insert({
      user_id,
      event_type: row.event_type,
      station_id: row.station_id ?? null,
      metadata: row.metadata ?? null,
    });
  } catch {
    // Silent — analytics must never throw into the app.
  }
}

/** Fired once per app mount (after session bootstrap, from StoreHydrator). */
export function trackPageView(): void {
  void logEvent({ event_type: "page_view" });
}

/**
 * Fired when the user (or scan, or reconnect) tunes to a station. The
 * `source` field lets the dashboard filter scan/reconnect noise out of
 * popularity rankings.
 */
export function trackStationTune(
  stationId: string,
  source: TuneSource,
): void {
  void logEvent({
    event_type: "station_tune",
    station_id: stationId,
    metadata: { source },
  });
}

/**
 * Fired when the NOW PLAYING brass plaque returns from /api/song-id. `hit`
 * captures whether AudD actually identified the song — useful for the
 * dashboard's hit-rate tile.
 */
export function trackSongIdRequest(
  stationId: string,
  hit: boolean,
): void {
  void logEvent({
    event_type: "song_id_request",
    station_id: stationId,
    metadata: { hit },
  });
}

/**
 * Fired every 60s while playback.status === "playing". Used to estimate
 * total listening minutes and per-station listen time. station_id captures
 * what the user was tuned to during that minute.
 */
export function trackSessionHeartbeat(stationId: string | null): void {
  void logEvent({
    event_type: "session_heartbeat",
    station_id: stationId,
  });
}
