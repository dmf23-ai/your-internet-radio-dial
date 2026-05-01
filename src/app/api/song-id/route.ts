import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/song-id
 *
 * Body: multipart/form-data with:
 *   - stationId: string  (required, used as cache key)
 *   - audio:     Blob    (required, ~8s webm/opus or similar)
 *
 * Strategy:
 *   1. Look up station_id in public.song_id_cache. If a row exists with
 *      identified_at younger than CACHE_TTL_MS, return it as cached and
 *      skip the AudD call. (Multiple users tuned to the same station
 *      within the TTL window all share one fingerprint lookup.)
 *   2. Otherwise forward the audio blob to AudD via multipart POST.
 *   3. Upsert the result back into song_id_cache (artist + title may be
 *      null when AudD couldn't identify; cached "unknown" stays in place
 *      for TTL_MS so we don't immediately re-query the same dead air).
 *
 * Response shape: { artist, title, cached, identifiedAt } — fields may
 * be null if no match. HTTP 200 on success (matched or unmatched both
 * count); 4xx/5xx only for actual errors.
 */

export const runtime = "nodejs";
// AudD calls can take a few seconds — give the function room to breathe.
export const maxDuration = 30;

const CACHE_TTL_MS = 60_000;
const AUDD_ENDPOINT = "https://api.audd.io/";

type SongIdResponse = {
  artist: string | null;
  title: string | null;
  cached: boolean;
  identifiedAt: string | null;
  error?: string;
};

function badRequest(error: string): NextResponse<SongIdResponse> {
  return NextResponse.json(
    {
      artist: null,
      title: null,
      cached: false,
      identifiedAt: null,
      error,
    },
    { status: 400 },
  );
}

function serverError(error: string): NextResponse<SongIdResponse> {
  return NextResponse.json(
    {
      artist: null,
      title: null,
      cached: false,
      identifiedAt: null,
      error,
    },
    { status: 500 },
  );
}

export async function POST(req: NextRequest) {
  const auddToken = process.env.AUDD_API_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!auddToken) {
    return serverError("AUDD_API_TOKEN not configured");
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return serverError("Supabase env vars not configured");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("invalid multipart body");
  }

  const stationId = form.get("stationId");
  const audio = form.get("audio");

  if (typeof stationId !== "string" || !stationId.trim()) {
    return badRequest("missing stationId");
  }
  if (!(audio instanceof Blob) || audio.size === 0) {
    return badRequest("missing audio blob");
  }

  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- Cache check ---
  try {
    const { data: cached } = await sb
      .from("song_id_cache")
      .select("artist, title, identified_at")
      .eq("station_id", stationId)
      .maybeSingle();

    if (cached) {
      const ageMs = Date.now() - new Date(cached.identified_at).getTime();
      if (ageMs < CACHE_TTL_MS) {
        return NextResponse.json({
          artist: cached.artist,
          title: cached.title,
          cached: true,
          identifiedAt: cached.identified_at,
        });
      }
    }
  } catch {
    // Cache lookup failure is non-fatal — proceed to AudD.
  }

  // --- AudD call ---
  let artist: string | null = null;
  let title: string | null = null;

  try {
    const auddForm = new FormData();
    auddForm.set("api_token", auddToken);
    // AudD accepts the field name "file"; pass the blob with a filename so
    // the multipart wrapper has a Content-Disposition.filename param.
    auddForm.set("file", audio, "clip.webm");

    const res = await fetch(AUDD_ENDPOINT, {
      method: "POST",
      body: auddForm,
    });

    if (!res.ok) {
      const body = await res.text();
      // eslint-disable-next-line no-console
      console.error("[song-id] AudD upstream non-OK:", res.status, body.slice(0, 300));
      return serverError(`AudD upstream ${res.status}`);
    }

    const json = (await res.json()) as {
      status?: string;
      result?: { artist?: string; title?: string } | null;
      error?: { error_code?: number; error_message?: string };
    };

    if (json.status !== "success") {
      // eslint-disable-next-line no-console
      console.error("[song-id] AudD error:", json.error?.error_message ?? "(unknown)");
      return serverError(json.error?.error_message ?? "AudD call failed");
    }

    if (json.result) {
      artist = json.result.artist?.trim() || null;
      title = json.result.title?.trim() || null;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[song-id] AudD fetch threw:", (e as Error).message);
    return serverError("AudD fetch failed");
  }

  // --- Upsert cache ---
  const identifiedAt = new Date().toISOString();
  try {
    await sb
      .from("song_id_cache")
      .upsert(
        { station_id: stationId, artist, title, identified_at: identifiedAt },
        { onConflict: "station_id" },
      );
  } catch {
    // Cache write failure is non-fatal — return the AudD result anyway.
  }

  return NextResponse.json({
    artist,
    title,
    cached: false,
    identifiedAt,
  });
}
