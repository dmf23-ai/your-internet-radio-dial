import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/hls?url=<upstream_m3u8_or_segment_url>
 *
 * HLS-aware same-origin proxy. Used for HLS streams whose origin doesn't
 * return permissive CORS headers (so hls.js can't fetch them directly).
 *
 * Two modes, keyed on upstream content-type / URL extension:
 *
 *   - Manifest (.m3u8, application/vnd.apple.mpegurl): rewrite every segment
 *     reference + URI="..." attribute to route back through /api/hls, using
 *     the final upstream URL (post-redirect) as the base for resolving
 *     relative paths.
 *
 *   - Segment (.ts, .aac, .m4s, .mp4, …): byte-passthrough. Forwards
 *     content-type, content-length, content-range, accept-ranges.
 *
 * Because the rewritten manifest keeps everything on our origin, hls.js
 * sees no CORS at all — and since the <audio> element loads a MediaSource
 * blob (same-origin), the Web Audio graph stays untainted → VU meter works.
 */
export const runtime = "nodejs";
// Each /api/hls call here is short-lived (a manifest fetch or a single
// segment), so this mostly matters for segment passthroughs in case Vercel
// would otherwise truncate a slow segment download. Set to plan max.
export const maxDuration = 300;

const UPSTREAM_TIMEOUT_MS = 10_000;

// --- M24: edge caching ------------------------------------------------------
// HLS media segments are immutable once published, so repeated fetches of the
// same ?url= can be served by Vercel's CDN instead of re-invoking this
// function and re-hitting the station's origin. The CDN cache key is the full
// request URL (including the query string), so identical upstream resources
// dedupe correctly across listeners. Only 200s get a TTL — 206/partial and
// error responses stay no-store (Range requests bypass the CDN cache anyway).
// Browsers keep max-age=0 and manage their own buffer; s-maxage is stripped
// before the response reaches them (check x-vercel-cache to see cache state).
const SEGMENT_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=30";
// Live manifests change every few seconds; a 1s edge TTL only collapses
// simultaneous polls from concurrent listeners without risking a stalled
// player (players re-poll on the order of the segment duration, 2-10s).
const MANIFEST_CACHE_CONTROL =
  "public, max-age=0, s-maxage=1, stale-while-revalidate=1";

// --- M24: per-IP rate limiting (in-memory token bucket) ---------------------
// Best-effort backstop against the recurring /api/hls bot spikes (~26k
// requests in 35 min from one client). State is per function instance, so a
// bot spread across instances can exceed the cap — a Vercel WAF rate-limit
// rule (Firewall tab, available on Hobby) is strictly stronger and runs
// before the function; this limiter is the zero-provisioning fallback.
// Ceiling is sized so a real listener never trips it: an active HLS session
// is ~1-2 req/s steady (edge cache absorbs repeats), so 5/s sustained with a
// 150-request burst allows several sessions behind one NAT.
const RATE_LIMIT_BURST = 150;
const RATE_LIMIT_REFILL_PER_SEC = 5;
const RATE_LIMIT_RETRY_AFTER_S = 10;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 60_000;

type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function clientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for; first entry is the client.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (now - lastSweep > RATE_LIMIT_SWEEP_INTERVAL_MS) {
    lastSweep = now;
    for (const [key, b] of buckets) {
      // A bucket that has fully refilled is indistinguishable from a new one.
      if (((now - b.last) / 1000) * RATE_LIMIT_REFILL_PER_SEC >= RATE_LIMIT_BURST) {
        buckets.delete(key);
      }
    }
  }
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: RATE_LIMIT_BURST, last: now };
    buckets.set(ip, b);
  }
  b.tokens = Math.min(
    RATE_LIMIT_BURST,
    b.tokens + ((now - b.last) / 1000) * RATE_LIMIT_REFILL_PER_SEC,
  );
  b.last = now;
  if (b.tokens < 1) return true;
  b.tokens -= 1;
  return false;
}

const SEGMENT_PASSTHROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
];

function isManifestContentType(ct: string | null): boolean {
  if (!ct) return false;
  const lower = ct.toLowerCase();
  return lower.includes("mpegurl") || lower.includes("m3u8");
}

function rewriteUri(uri: string, baseUrl: string): string {
  try {
    const abs = new URL(uri, baseUrl).toString();
    return `/api/hls?url=${encodeURIComponent(abs)}`;
  } catch {
    return uri;
  }
}

function rewriteManifest(body: string, baseUrl: string): string {
  return body
    .split("\n")
    .map((rawLine) => {
      const line = rawLine.replace(/\r$/, "");
      if (line === "") return line;
      if (line.startsWith("#")) {
        // Tags like EXT-X-KEY, EXT-X-MEDIA, EXT-X-MAP, EXT-X-I-FRAME-STREAM-INF
        // embed their target URL as URI="...". Rewrite every such attr.
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
          return `URI="${rewriteUri(uri, baseUrl)}"`;
        });
      }
      // Plain URL reference (segment or sub-playlist).
      return rewriteUri(line, baseUrl);
    })
    .join("\n");
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    return new NextResponse("rate limit exceeded", {
      status: 429,
      headers: {
        "retry-after": String(RATE_LIMIT_RETRY_AFTER_S),
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("missing url", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return new NextResponse("invalid url", { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return new NextResponse("unsupported protocol", { status: 400 });
  }

  const ac = new AbortController();
  const onClientAbort = () => ac.abort();
  req.signal.addEventListener("abort", onClientAbort);
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "*/*",
      },
      signal: ac.signal,
      redirect: "follow",
    });
  } catch (e: any) {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", onClientAbort);
    const msg = e?.message ?? "unknown";
    console.error(`[/api/hls] upstream fetch failed for ${url}: ${msg}`);
    return new NextResponse(`upstream fetch failed: ${msg}`, { status: 502 });
  }
  clearTimeout(timer);

  if (!upstream.ok && upstream.status !== 206) {
    req.signal.removeEventListener("abort", onClientAbort);
    console.error(`[/api/hls] upstream status ${upstream.status} for ${url}`);
    return new NextResponse(`upstream status ${upstream.status}`, {
      status: 502,
    });
  }

  const ct = upstream.headers.get("content-type");
  const looksLikeManifest =
    isManifestContentType(ct) || /\.m3u8(\?|$)/i.test(target.pathname);

  if (looksLikeManifest) {
    // Use final URL (after redirects) as base for resolving relative paths.
    const baseUrl = upstream.url || target.toString();
    const text = await upstream.text();
    const rewritten = rewriteManifest(text, baseUrl);
    console.log(
      `[/api/hls] rewrote manifest ${url} (base=${baseUrl}, ${text.length}→${rewritten.length} chars)`,
    );
    const headers = new Headers();
    headers.set("content-type", "application/vnd.apple.mpegurl");
    headers.set("cache-control", MANIFEST_CACHE_CONTROL);
    headers.set("access-control-allow-origin", "*");
    return new NextResponse(rewritten, { status: 200, headers });
  }

  // Segment (binary) passthrough.
  if (!upstream.body) {
    req.signal.removeEventListener("abort", onClientAbort);
    console.error(`[/api/hls] no upstream body for segment ${url}`);
    return new NextResponse("no upstream body", { status: 502 });
  }

  const headers = new Headers();
  for (const h of SEGMENT_PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Only full 200 responses are safe to cache; 206/partial responses interact
  // badly with caching and stay uncached.
  headers.set(
    "cache-control",
    upstream.status === 200 ? SEGMENT_CACHE_CONTROL : "no-store",
  );
  headers.set("access-control-allow-origin", "*");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
