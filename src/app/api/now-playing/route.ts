import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/now-playing?url=<stream_url>
 *
 * Best-effort "now playing" title lookup for an Icecast or Shoutcast server.
 * Strategy: derive server origin from stream URL, try Icecast /status-json.xsl
 * first, then Shoutcast v1 /7.html, then Shoutcast v2 /stats?sid=1.
 * Returns { title: string | null, source: string | null }.
 * Cached in-process for 30s per stream URL.
 */

export const runtime = "nodejs";
// Allow caching via the CDN layer too.
export const revalidate = 30;

type CacheEntry = { at: number; title: string | null; source: string | null };
const CACHE: Map<string, CacheEntry> = (globalThis as any).__nowPlayingCache ??
  ((globalThis as any).__nowPlayingCache = new Map<string, CacheEntry>());
const TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 3_000;

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

async function timedFetch(url: string, init?: RequestInit): Promise<Response | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: {
        "user-agent": "YourInternetRadioDial/1.0",
        accept: "application/json, text/html;q=0.9, */*;q=0.1",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Icecast: /status-json.xsl → { icestats: { source: {...} | [{...}] } } */
async function tryIcecast(origin: string, streamPath: string): Promise<string | null> {
  const res = await timedFetch(`${origin}/status-json.xsl`);
  if (!res || !res.ok) return null;
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const src = json?.icestats?.source;
  if (!src) return null;
  const list = Array.isArray(src) ? src : [src];
  // Prefer the source whose listenurl/mount matches our path.
  const match =
    list.find((s) => {
      const lu = (s?.listenurl ?? "") as string;
      const mount = (s?.mount ?? "") as string;
      return (
        (streamPath && (lu.endsWith(streamPath) || mount === streamPath)) ||
        false
      );
    }) ?? list[0];
  const title =
    (match?.title as string | undefined) ??
    (match?.yp_currently_playing as string | undefined) ??
    null;
  return title && String(title).trim() ? String(title).trim() : null;
}

/** Shoutcast v1: /7.html → <html>...<body>current,status,peak,max,unique,bitrate,songtitle</body> */
async function tryShoutcastV1(origin: string): Promise<string | null> {
  const res = await timedFetch(`${origin}/7.html`);
  if (!res || !res.ok) return null;
  const text = await res.text();
  const body = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? text;
  const stripped = body.replace(/<[^>]+>/g, "").trim();
  // CSV with 7 fields; song title is the last.
  const parts = stripped.split(",");
  if (parts.length < 7) return null;
  const title = parts.slice(6).join(",").trim();
  return title ? title : null;
}

/** Shoutcast v2: /stats?sid=1 → XML with <SONGTITLE>...</SONGTITLE> */
async function tryShoutcastV2(origin: string): Promise<string | null> {
  const res = await timedFetch(`${origin}/stats?sid=1`);
  if (!res || !res.ok) return null;
  const text = await res.text();
  const m = text.match(/<SONGTITLE>([\s\S]*?)<\/SONGTITLE>/i);
  const title = m?.[1]?.trim();
  return title ? title : null;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ title: null, source: null, error: "missing url" }, { status: 400 });
  }

  // Serve from cache if fresh.
  const now = Date.now();
  const cached = CACHE.get(url);
  if (cached && now - cached.at < TTL_MS) {
    return NextResponse.json(
      { title: cached.title, source: cached.source, cached: true },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  }

  const origin = originOf(url);
  if (!origin) {
    return NextResponse.json({ title: null, source: null, error: "bad url" }, { status: 400 });
  }
  const streamPath = pathOf(url);

  let title: string | null = null;
  let source: string | null = null;

  // Try in order; stop at first non-empty title.
  try {
    title = await tryIcecast(origin, streamPath);
    if (title) source = "icecast";
  } catch {
    /* noop */
  }
  if (!title) {
    try {
      title = await tryShoutcastV1(origin);
      if (title) source = "shoutcast-v1";
    } catch {
      /* noop */
    }
  }
  if (!title) {
    try {
      title = await tryShoutcastV2(origin);
      if (title) source = "shoutcast-v2";
    } catch {
      /* noop */
    }
  }

  CACHE.set(url, { at: now, title, source });

  return NextResponse.json(
    { title, source, cached: false },
    { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } },
  );
}
