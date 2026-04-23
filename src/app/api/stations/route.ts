import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/stations?name=&tag=&country=&limit=
 *
 * Server-side proxy to radio-browser.info's station search. Centralizes
 * User-Agent handling (the API returns [] without one), caches results
 * in-process for 60s per query, and trims the upstream record to the
 * fields the UI needs.
 *
 * All query params are optional; at least one of name/tag/country should
 * be provided or the upstream will return a firehose. limit defaults to
 * 30 (max 100).
 *
 * Response: { results: TrimmedStation[], cached: boolean }
 * TrimmedStation: {
 *   stationuuid, name, url_resolved, codec, bitrate, hls (0|1),
 *   lastcheckok (0|1), favicon, homepage, country, countrycode, tags (string)
 * }
 */

export const runtime = "nodejs";

const UPSTREAM_BASE = "https://de1.api.radio-browser.info";
const FETCH_TIMEOUT_MS = 6_000;
const TTL_MS = 60_000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

const USER_AGENT = "YourInternetRadioDial/1.0 (https://github.com/)";

type TrimmedStation = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  codec: string;
  bitrate: number;
  hls: 0 | 1;
  lastcheckok: 0 | 1;
  favicon: string;
  homepage: string;
  country: string;
  countrycode: string;
  tags: string;
};

type CacheEntry = { at: number; results: TrimmedStation[] };
const CACHE: Map<string, CacheEntry> =
  (globalThis as any).__stationsCache ??
  ((globalThis as any).__stationsCache = new Map<string, CacheEntry>());

function trim(raw: any): TrimmedStation | null {
  if (!raw || typeof raw !== "object") return null;
  const url_resolved = String(raw.url_resolved ?? raw.url ?? "");
  if (!url_resolved) return null;
  return {
    stationuuid: String(raw.stationuuid ?? ""),
    name: String(raw.name ?? "").trim(),
    url_resolved,
    codec: String(raw.codec ?? "").toUpperCase(),
    bitrate: Number(raw.bitrate ?? 0) || 0,
    hls: raw.hls ? 1 : 0,
    lastcheckok: raw.lastcheckok ? 1 : 0,
    favicon: String(raw.favicon ?? ""),
    homepage: String(raw.homepage ?? ""),
    country: String(raw.country ?? ""),
    countrycode: String(raw.countrycode ?? ""),
    tags: String(raw.tags ?? ""),
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const name = (sp.get("name") ?? "").trim();
  const tag = (sp.get("tag") ?? "").trim();
  const country = (sp.get("country") ?? "").trim();
  const limitRaw = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
  );

  if (!name && !tag && !country) {
    return NextResponse.json(
      { results: [], error: "at least one of name/tag/country required" },
      { status: 400 },
    );
  }

  const cacheKey = JSON.stringify({ name, tag, country, limit });
  const now = Date.now();
  const cached = CACHE.get(cacheKey);
  if (cached && now - cached.at < TTL_MS) {
    return NextResponse.json(
      { results: cached.results, cached: true },
      { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  }

  // Build upstream URL. radio-browser.info's /json/stations/search accepts
  // name/tag/country/limit + a few ordering hints. We also ask for only
  // working stations (hidebroken=true) and order by clickcount desc so
  // popular results float to the top.
  const u = new URL(`${UPSTREAM_BASE}/json/stations/search`);
  if (name) u.searchParams.set("name", name);
  if (tag) u.searchParams.set("tag", tag);
  if (country) u.searchParams.set("country", country);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("hidebroken", "true");
  u.searchParams.set("order", "clickcount");
  u.searchParams.set("reverse", "true");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(u.toString(), {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json",
      },
      signal: ac.signal,
      cache: "no-store",
    });
  } catch (e: any) {
    clearTimeout(timer);
    console.error(`[/api/stations] upstream fetch failed: ${e?.message ?? e}`);
    return NextResponse.json(
      { results: [], error: "upstream fetch failed" },
      { status: 502 },
    );
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    console.error(`[/api/stations] upstream status ${upstream.status}`);
    return NextResponse.json(
      { results: [], error: `upstream status ${upstream.status}` },
      { status: 502 },
    );
  }

  let raw: any;
  try {
    raw = await upstream.json();
  } catch (e: any) {
    console.error(`[/api/stations] upstream JSON parse failed: ${e?.message ?? e}`);
    return NextResponse.json(
      { results: [], error: "upstream parse failed" },
      { status: 502 },
    );
  }

  const results: TrimmedStation[] = Array.isArray(raw)
    ? raw.map(trim).filter((r): r is TrimmedStation => r !== null)
    : [];

  CACHE.set(cacheKey, { at: now, results });

  // Simple LRU-ish cap so long-running dev servers don't grow forever.
  if (CACHE.size > 500) {
    const oldestKey = CACHE.keys().next().value;
    if (oldestKey) CACHE.delete(oldestKey);
  }

  return NextResponse.json(
    { results, cached: false },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
