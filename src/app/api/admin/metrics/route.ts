import { NextRequest, NextResponse } from "next/server";
import {
  getServiceClient,
  isAdminCaller,
  ADMIN_EMAIL,
} from "@/lib/supabase/server";

/**
 * GET /api/admin/metrics
 *
 * Single-roundtrip aggregator for the /admin dashboard. Runs ~10 parallel
 * queries against the events / suggestions / user_settings / stations /
 * auth.users tables, normalizes the results into a single response shape,
 * and returns it as JSON.
 *
 * Authorization: Bearer <access_token> in the Authorization header. The
 * token must resolve to ADMIN_EMAIL (David). Anyone else gets 403 — even
 * if they have a valid Supabase session.
 *
 * Server-only — uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS for cross-user
 * aggregation reads.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_SECONDS = 60;
// Sources excluded from "popular stations" rankings — scan churn would
// otherwise dominate (one scan tick = one tune event, every 8s).
const POPULARITY_EXCLUDE_SOURCES = new Set(["scan", "reconnect"]);

interface DailyCount {
  day: string; // YYYY-MM-DD in UTC
  count: number;
}
interface StationRank {
  stationId: string;
  stationName: string | null;
  count: number;
}
interface SuggestionRow {
  id: string;
  kind: "station" | "other";
  station_name: string | null;
  station_url: string | null;
  station_notes: string | null;
  message: string | null;
  contact_email: string | null;
  created_at: string;
}

export interface MetricsResponse {
  generatedAt: string;
  windowDays: number;
  users: {
    total: number;
    anonymous: number;
    permanent: number;
    dailyNew: DailyCount[];
  };
  pageViews: {
    total: number;
    dailyViews: DailyCount[];
    dailyUniqueVisitors: DailyCount[];
  };
  songIds: {
    allTime: number;
    last24h: number;
    last7d: number;
    last30d: number;
    hitRatePct: number | null; // null if no requests yet
  };
  listening: {
    allTimeMinutes: number;
    last24hMinutes: number;
    last7dMinutes: number;
    last30dMinutes: number;
    avgSessionMinutes: number | null; // null if no sessions yet
    sessionsCount: number;
  };
  topStations: {
    byTunes: StationRank[]; // last windowDays days, scan/reconnect filtered out
    byMinutes: StationRank[]; // last windowDays days, heartbeat-derived
  };
  tunedNow: StationRank[]; // snapshot from user_settings
  suggestions: SuggestionRow[];
}

export async function GET(req: NextRequest) {
  if (!(await isAdminCaller(req))) {
    return NextResponse.json(
      { error: `Forbidden — admin access requires sign-in as ${ADMIN_EMAIL}` },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const windowDays = clampInt(url.searchParams.get("days"), 30, 1, 365);

  const sb = getServiceClient();
  const now = Date.now();
  const windowStart = new Date(now - windowDays * 86_400_000).toISOString();
  const day24h = new Date(now - 86_400_000).toISOString();
  const day7d = new Date(now - 7 * 86_400_000).toISOString();
  const day30d = new Date(now - 30 * 86_400_000).toISOString();

  // Run everything in parallel. Each branch returns its own slice of the
  // final response; Promise.all + destructuring keeps the route flat.
  const [
    usersBranch,
    pageViewsBranch,
    songIdBranch,
    listeningBranch,
    topByTunesRows,
    topByMinutesRows,
    tunedNowRows,
    stationNames,
    suggestionRows,
  ] = await Promise.all([
    fetchUsers(sb, windowDays),
    fetchPageViews(sb, windowStart, windowDays),
    fetchSongIdCounts(sb, day24h, day7d, day30d),
    fetchListening(sb, day24h, day7d, day30d),
    fetchEventStationIds(sb, "station_tune", windowStart),
    fetchEventStationIds(sb, "session_heartbeat", windowStart),
    fetchTunedNow(sb),
    fetchStationNameMap(sb),
    fetchSuggestions(sb),
  ]);

  // Roll up top-N from raw event station_id lists. Scan/reconnect tunes
  // are filtered out of the popularity ranking (they're not user choice).
  const byTunes = rankStations(
    topByTunesRows
      .filter((r) => !POPULARITY_EXCLUDE_SOURCES.has(r.source ?? "manual"))
      .map((r) => r.stationId),
    stationNames,
    10,
  );
  const byMinutes = rankStations(
    topByMinutesRows.map((r) => r.stationId),
    stationNames,
    10,
  ).map((row) => ({
    ...row,
    // Each heartbeat = 60s. Convert count → minutes.
    count: row.count, // raw heartbeat count, dashboard displays as minutes
  }));
  const tunedNow = rankStations(tunedNowRows, stationNames, 20);

  const response: MetricsResponse = {
    generatedAt: new Date().toISOString(),
    windowDays,
    users: usersBranch,
    pageViews: pageViewsBranch,
    songIds: songIdBranch,
    listening: listeningBranch,
    topStations: {
      byTunes,
      byMinutes,
    },
    tunedNow,
    suggestions: suggestionRows,
  };

  return NextResponse.json(response, {
    headers: {
      // Even though we mark dynamic, belt + braces — never cache personalized
      // admin data at the edge.
      "cache-control": "no-store",
    },
  });
}

// ---------- branch helpers ----------

async function fetchUsers(
  sb: ReturnType<typeof getServiceClient>,
  windowDays: number,
): Promise<MetricsResponse["users"]> {
  // listUsers paginates at 50 per page by default. Most YIRD usage will fit
  // in a few pages; we cap at 20 pages (1000 users) to keep response time
  // bounded — change if the user base outgrows that.
  let total = 0;
  let anonymous = 0;
  let permanent = 0;
  const newPerDay = new Map<string, number>();
  const cutoffMs = Date.now() - windowDays * 86_400_000;

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users || data.users.length === 0) break;
    for (const u of data.users) {
      total++;
      // Supabase tags anon users with is_anonymous on the user record.
      const isAnon = Boolean(
        (u as unknown as { is_anonymous?: boolean }).is_anonymous,
      );
      if (isAnon) anonymous++;
      else permanent++;
      const created = u.created_at ? new Date(u.created_at).getTime() : 0;
      if (created >= cutoffMs) {
        const day = isoDate(new Date(created));
        newPerDay.set(day, (newPerDay.get(day) ?? 0) + 1);
      }
    }
    if (data.users.length < 200) break;
  }

  return {
    total,
    anonymous,
    permanent,
    dailyNew: fillMissingDays(newPerDay, windowDays),
  };
}

async function fetchPageViews(
  sb: ReturnType<typeof getServiceClient>,
  windowStart: string,
  windowDays: number,
): Promise<MetricsResponse["pageViews"]> {
  // Total page views (all time, fast count via head:true).
  const { count: totalCount } = await sb
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "page_view");

  // Per-day breakdown for the window — pull the rows and bucket in JS.
  // At ~hundreds-of-pageviews-per-day scale this is plenty fast.
  const { data: rows } = await sb
    .from("events")
    .select("created_at, user_id")
    .eq("event_type", "page_view")
    .gte("created_at", windowStart);

  const dailyViewsMap = new Map<string, number>();
  const dailyUniquesMap = new Map<string, Set<string>>();
  for (const r of rows ?? []) {
    const day = isoDate(new Date(r.created_at as string));
    dailyViewsMap.set(day, (dailyViewsMap.get(day) ?? 0) + 1);
    const uid = (r.user_id as string | null) ?? "anonymous-no-uid";
    let set = dailyUniquesMap.get(day);
    if (!set) {
      set = new Set();
      dailyUniquesMap.set(day, set);
    }
    set.add(uid);
  }
  const dailyUniques = new Map<string, number>();
  for (const [day, set] of dailyUniquesMap) dailyUniques.set(day, set.size);

  return {
    total: totalCount ?? 0,
    dailyViews: fillMissingDays(dailyViewsMap, windowDays),
    dailyUniqueVisitors: fillMissingDays(dailyUniques, windowDays),
  };
}

async function fetchSongIdCounts(
  sb: ReturnType<typeof getServiceClient>,
  day24h: string,
  day7d: string,
  day30d: string,
): Promise<MetricsResponse["songIds"]> {
  // Five parallel count queries. Each uses head:true so postgrest returns
  // the count without the row data.
  const base = () =>
    sb
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "song_id_request");

  const [allTimeQ, last24hQ, last7dQ, last30dQ, hitsQ, totalForRateQ] =
    await Promise.all([
      base(),
      base().gte("created_at", day24h),
      base().gte("created_at", day7d),
      base().gte("created_at", day30d),
      // Hits use the metadata.hit boolean we set when AudD matched.
      sb
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "song_id_request")
        .eq("metadata->>hit", "true"),
      // Total requests-with-metadata (for hit-rate denominator). Same as
      // allTime in practice but kept separate so the rate is defensible if
      // we ever insert song_id_request rows without metadata.
      sb
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "song_id_request")
        .not("metadata", "is", null),
    ]);

  const denom = totalForRateQ.count ?? 0;
  const numer = hitsQ.count ?? 0;
  const hitRatePct = denom > 0 ? Math.round((numer / denom) * 1000) / 10 : null;

  return {
    allTime: allTimeQ.count ?? 0,
    last24h: last24hQ.count ?? 0,
    last7d: last7dQ.count ?? 0,
    last30d: last30dQ.count ?? 0,
    hitRatePct,
  };
}

async function fetchListening(
  sb: ReturnType<typeof getServiceClient>,
  day24h: string,
  day7d: string,
  day30d: string,
): Promise<MetricsResponse["listening"]> {
  const base = () =>
    sb
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "session_heartbeat");

  const [allTimeQ, last24hQ, last7dQ, last30dQ, sessionRowsQ] =
    await Promise.all([
      base(),
      base().gte("created_at", day24h),
      base().gte("created_at", day7d),
      base().gte("created_at", day30d),
      // For session length: pull the past windowDays of heartbeats. This is
      // the heaviest query — capped at 50k rows by postgrest's default
      // limit, which at 60s-per-heartbeat is enough headroom for ~35 days
      // of one heavy listener (or any realistic mix at YIRD's scale).
      sb
        .from("events")
        .select("user_id, created_at")
        .eq("event_type", "session_heartbeat")
        .gte("created_at", day30d)
        .order("user_id", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  const heartbeatToMin = (count: number) => Math.round(count / 1); // 1 heartbeat = 1 minute

  // Detect distinct sessions: heartbeats from the same user with > 5 min gap
  // start a new session. avg session length = total heartbeats / sessions.
  const SESSION_GAP_MS = 5 * 60_000;
  let sessions = 0;
  let totalHeartbeats = 0;
  let lastUid: string | null = null;
  let lastTs = 0;
  for (const r of sessionRowsQ.data ?? []) {
    const uid = (r.user_id as string | null) ?? "anonymous-no-uid";
    const ts = new Date(r.created_at as string).getTime();
    totalHeartbeats++;
    if (uid !== lastUid || ts - lastTs > SESSION_GAP_MS) sessions++;
    lastUid = uid;
    lastTs = ts;
  }
  const avgSessionMinutes =
    sessions > 0 ? Math.round((totalHeartbeats / sessions) * 10) / 10 : null;

  return {
    allTimeMinutes: heartbeatToMin(allTimeQ.count ?? 0),
    last24hMinutes: heartbeatToMin(last24hQ.count ?? 0),
    last7dMinutes: heartbeatToMin(last7dQ.count ?? 0),
    last30dMinutes: heartbeatToMin(last30dQ.count ?? 0),
    avgSessionMinutes,
    sessionsCount: sessions,
  };
}

async function fetchEventStationIds(
  sb: ReturnType<typeof getServiceClient>,
  eventType: "station_tune" | "session_heartbeat",
  windowStart: string,
): Promise<{ stationId: string; source?: string }[]> {
  // Pull the raw rows in the window — bucketing happens client-side. Cap
  // generous; postgrest will cut off at the table's row-limit default
  // anyway, so worst-case we miss a small tail of older events.
  const { data } = await sb
    .from("events")
    .select("station_id, metadata")
    .eq("event_type", eventType)
    .not("station_id", "is", null)
    .gte("created_at", windowStart)
    .limit(50_000);
  return (data ?? [])
    .filter((r): r is { station_id: string; metadata: Record<string, unknown> | null } =>
      typeof r.station_id === "string",
    )
    .map((r) => ({
      stationId: r.station_id,
      source:
        r.metadata && typeof r.metadata === "object"
          ? ((r.metadata as { source?: string }).source ?? undefined)
          : undefined,
    }));
}

async function fetchTunedNow(
  sb: ReturnType<typeof getServiceClient>,
): Promise<string[]> {
  const { data } = await sb
    .from("user_settings")
    .select("current_station_id")
    .not("current_station_id", "is", null);
  return (data ?? [])
    .map((r) => r.current_station_id as string | null)
    .filter((id): id is string => !!id);
}

async function fetchStationNameMap(
  sb: ReturnType<typeof getServiceClient>,
): Promise<Map<string, string>> {
  // The stations table has one row per (user_id, station_id) — the same
  // station id can appear in many users' libraries with the same name. We
  // dedupe to first-seen.
  const { data } = await sb.from("stations").select("id, name").limit(5000);
  const map = new Map<string, string>();
  for (const r of data ?? []) {
    const id = r.id as string;
    if (!map.has(id)) map.set(id, r.name as string);
  }
  return map;
}

async function fetchSuggestions(
  sb: ReturnType<typeof getServiceClient>,
): Promise<SuggestionRow[]> {
  const { data } = await sb
    .from("suggestions")
    .select(
      "id, kind, station_name, station_url, station_notes, message, contact_email, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as SuggestionRow[];
}

// ---------- shared utilities ----------

function rankStations(
  ids: string[],
  names: Map<string, string>,
  topN: number,
): StationRank[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([stationId, count]) => ({
      stationId,
      stationName: names.get(stationId) ?? null,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function isoDate(d: Date): string {
  // UTC date so a single user spanning midnight isn't double-counted in
  // both days due to local-tz drift across the deployment region.
  return d.toISOString().slice(0, 10);
}

function fillMissingDays(
  counts: Map<string, number>,
  windowDays: number,
): DailyCount[] {
  const out: DailyCount[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const day = isoDate(d);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
