import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/stream?url=<upstream_audio_url>
 *
 * Same-origin passthrough proxy for radio streams whose servers don't return
 * permissive CORS headers. Because the response is same-origin, the browser's
 * MediaElementSource is not tainted → VU meter works too.
 *
 * HLS (.m3u8) is NOT routed through here — manifests embed absolute segment
 * URLs that hls.js fetches independently; a proper HLS proxy would need to
 * rewrite the manifest.
 */
export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 10_000;

const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "icy-name",
  "icy-description",
  "icy-genre",
  "icy-br",
  "icy-sr",
];

export async function GET(req: NextRequest) {
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

  // Abort upstream if the client disconnects (user tunes away).
  const ac = new AbortController();
  const onClientAbort = () => ac.abort();
  req.signal.addEventListener("abort", onClientAbort);
  const initialTimer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        // Some radio servers reject non-browser UAs — use a real-looking one.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "*/*",
      },
      signal: ac.signal,
      redirect: "follow",
    });
  } catch (e: any) {
    clearTimeout(initialTimer);
    req.signal.removeEventListener("abort", onClientAbort);
    const msg = e?.message ?? "unknown";
    console.error(`[/api/stream] upstream fetch failed for ${url}: ${msg}`);
    return new NextResponse(`upstream fetch failed: ${msg}`, { status: 502 });
  }
  clearTimeout(initialTimer);

  if (!upstream.ok && upstream.status !== 206) {
    req.signal.removeEventListener("abort", onClientAbort);
    console.error(
      `[/api/stream] upstream status ${upstream.status} for ${url}`,
    );
    return new NextResponse(`upstream status ${upstream.status}`, {
      status: 502,
    });
  }
  if (!upstream.body) {
    req.signal.removeEventListener("abort", onClientAbort);
    console.error(`[/api/stream] no upstream body for ${url}`);
    return new NextResponse("no upstream body", { status: 502 });
  }

  console.log(
    `[/api/stream] streaming ${url} (status ${upstream.status}, ct=${upstream.headers.get(
      "content-type",
    )})`,
  );

  const headers = new Headers();
  for (const h of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "audio/mpeg");
  }
  headers.set("cache-control", "no-cache, no-store");
  headers.set("access-control-allow-origin", "*");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
