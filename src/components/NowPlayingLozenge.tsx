"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRadioStore } from "@/lib/store";
import { getAudioEngine } from "@/lib/audio";

/**
 * NowPlayingLozenge — tap-to-identify song-ID plaque (M18).
 *
 * Sits below the dial face on the cabinet. When tapped, it captures ~8s
 * of the live audio output (via the engine's MediaRecorder tap), POSTs it
 * to /api/song-id which forwards to AudD with a Supabase-backed cache,
 * and renders the identified artist/title.
 *
 * State machine:
 *   idle      — "tap to identify"
 *   listening — capture in flight (8s + ID lookup); button disabled
 *   success   — artist/title shown; tap again to re-identify
 *   unknown   — AudD returned no match; tap again to retry
 *   error     — capture or network failure; tap again to retry
 *
 * Resets to `idle` on station change so a new tune doesn't show stale info
 * from the prior station.
 *
 * Visual: brass face plate (matching the Suggestion Box mail-slot
 * vocabulary) with a recessed cream interior screen. Engraved "NOW
 * PLAYING" header above the dynamic body line.
 */

const CAPTURE_SECONDS = 8;

/**
 * AudD picks its decoder from the filename extension, so a MIME-mismatched
 * filename makes the upstream decode fail. The engine now always emits
 * audio/wav (since iOS Safari's MediaRecorder MP4 output was producing
 * fragmented containers AudD couldn't decode), but kept generic so a future
 * encoder change doesn't silently regress.
 */
function filenameForMime(mime: string): string {
  if (mime.startsWith("audio/wav")) return "clip.wav";
  if (mime.startsWith("audio/mp4")) return "clip.m4a";
  if (mime.startsWith("audio/webm")) return "clip.webm";
  if (mime.startsWith("audio/ogg")) return "clip.ogg";
  return "clip.bin";
}

type State =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "success"; artist: string | null; title: string | null }
  | { kind: "unknown" }
  | { kind: "error"; message: string };

function bodyText(state: State, isPlaying: boolean): string {
  // Gate the body text on isPlaying *before* the state machine, so the
  // user sees a clear "tune in first" cue instead of a cryptic error
  // when the radio is off.
  if (!isPlaying && state.kind !== "success") {
    return "turn on the radio to identify a song";
  }
  switch (state.kind) {
    case "idle":
      return "tap to identify";
    case "listening":
      return "listening…";
    case "success": {
      const a = state.artist?.trim();
      const t = state.title?.trim();
      if (a && t) return `${a.toUpperCase()} — ${t}`;
      if (t) return t;
      if (a) return a.toUpperCase();
      return "couldn't identify";
    }
    case "unknown":
      return "couldn't identify · tap to retry";
    case "error":
      // Show the actual error message so we can diagnose at a glance
      // without making the user open the console. Truncated by overflow:
      // hidden + truncate on the cream window.
      return state.message ? `error: ${state.message}` : "tap to retry";
  }
}

export default function NowPlayingLozenge() {
  const stationId = useRadioStore((s) => s.currentStationId);
  // isPlaying lives on the nested playback slice — NOT top-level on the
  // store. Reading s.isPlaying returns undefined (falsy) and gates the
  // lozenge off forever. Don't repeat that.
  const isPlaying = useRadioStore((s) => s.playback.isPlaying);
  const [state, setState] = useState<State>({ kind: "idle" });
  // Same reduced-motion gate ScrollingCaption uses (M17 lesson — an
  // infinite CSS keyframe + the global reduced-motion override = a ~100kHz
  // strobe). When reduced-motion is on, the listening dot stays solid
  // instead of pulsing AND the cream-window marquee is replaced with a
  // truncated single copy.
  const [reducedMotion, setReducedMotion] = useState(false);
  const inFlightRef = useRef(false);

  // Marquee state for the cream window — when the body text is wider than
  // the visible content area, render two copies + marquee animation
  // (mirroring DialWindow's ScrollingCaption pattern, including its global
  // @keyframes marquee in globals.css).
  const creamRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [bodyOverflow, setBodyOverflow] = useState(false);
  const [bodyDuration, setBodyDuration] = useState(12);

  // Drag-to-pan state for the reduced-motion fallback (mirrors the same
  // mechanism in DialWindow's ScrollingCaption). When reduced-motion is
  // on AND the body overflows, the user can click-and-drag horizontally
  // through the cream window to read the full string.
  const [pan, setPan] = useState(0); // resting translateX (≤ 0)
  const [maxPan, setMaxPan] = useState(0); // most-negative allowed translate
  const [drag, setDrag] = useState<{
    start: number;
    base: number;
    current: number;
    moved: boolean;
  } | null>(null);
  // One-frame click suppressor — when a pointerup ends a drag that moved
  // beyond the threshold, the trailing click on the button parent must be
  // swallowed so we don't also fire a song-ID capture.
  const suppressClickRef = useRef(false);
  const DRAG_THRESHOLD = 5;

  // Reset on station change. Even if a previous identification is still
  // visible, a new tune means the old result is no longer relevant.
  useEffect(() => {
    setState({ kind: "idle" });
  }, [stationId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  // Pre-compute the body string here (rather than below the JSX) so the
  // overflow measurement effect can depend on it.
  const body = bodyText(state, isPlaying);

  // Measure the body text against the visible cream-window width. When it
  // overflows, switch to a marquee (two copies + global @keyframes marquee
  // from globals.css). Mirrors the DialWindow ScrollingCaption pattern,
  // including the document.fonts.ready re-measure for late web-font swaps.
  useLayoutEffect(() => {
    const cream = creamRef.current;
    const m = measureRef.current;
    if (!cream || !m) return;

    const check = () => {
      const w = m.scrollWidth;
      // px-3 in the cream window eats 12px on each side; the actual
      // content area is the inner width minus that horizontal padding.
      const visible = cream.clientWidth - 24;
      const needs = w > visible + 1;
      setBodyOverflow(needs);
      if (needs) {
        // ~50px/sec like the dial caption, with an 8s minimum so a
        // borderline overflow doesn't whip past too fast on the smaller
        // lozenge surface.
        setBodyDuration(Math.max(8, w / 50));
        const newMax = visible - w; // negative — leftmost translateX
        setMaxPan(newMax);
        // Re-clamp current pan if bounds shrank (e.g. window resize).
        setPan((p) => Math.min(0, Math.max(newMax, p)));
      } else {
        setMaxPan(0);
        setPan(0);
      }
    };
    check();
    document.fonts?.ready?.then(check);
    const ro = new ResizeObserver(check);
    ro.observe(cream);
    ro.observe(m);
    return () => ro.disconnect();
  }, [body]);

  // When the body string changes (state transition or station change),
  // reset pan to 0 so the new content starts at the left edge.
  useLayoutEffect(() => {
    setPan(0);
  }, [body]);

  async function onTap() {
    // If the click was synthesized at the end of a drag-pan, swallow it.
    // Same one-frame window mechanism the dial caption uses.
    if (suppressClickRef.current) return;
    if (inFlightRef.current) return;
    if (!stationId) {
      setState({ kind: "error", message: "no station" });
      return;
    }
    if (!isPlaying) {
      setState({ kind: "error", message: "start playing first" });
      return;
    }

    inFlightRef.current = true;
    setState({ kind: "listening" });

    try {
      const cap = await getAudioEngine().captureAudioClip(CAPTURE_SECONDS);
      const { blob, peakAmplitude, durationMs, fireCount } = cap;
      const sizeKb = (blob.size / 1024).toFixed(0);
      const stats = `${sizeKb}KB ${durationMs}ms pk=${peakAmplitude.toFixed(2)} n=${fireCount}`;
      // eslint-disable-next-line no-console
      console.log("[song-id] capture:", stats);

      const form = new FormData();
      form.append("stationId", stationId);
      form.append("audio", blob, filenameForMime(blob.type));

      const res = await fetch("/api/song-id", { method: "POST", body: form });
      if (!res.ok) {
        // Try to surface the actual upstream reason from the JSON body so
        // iOS-class failures don't all collapse to a generic "error 500".
        let detail = `error ${res.status}`;
        try {
          const errBody = (await res.json()) as { error?: string };
          if (errBody?.error) detail = errBody.error;
        } catch {
          // Body wasn't JSON; keep the generic status-code message.
        }
        // Prepend capture stats so iOS-only failures are diagnosable
        // directly from the cream window: peak≈0 ⇒ silent capture
        // (analyser tap broken), tiny size ⇒ capture cut short, normal
        // size+peak ⇒ AudD is rejecting valid WAV.
        detail = `${stats} · ${detail}`;
        // eslint-disable-next-line no-console
        console.error("[song-id] HTTP", res.status, detail);
        setState({ kind: "error", message: detail });
        return;
      }

      const data = (await res.json()) as {
        artist: string | null;
        title: string | null;
        cached: boolean;
      };

      if (!data.artist && !data.title) {
        setState({ kind: "unknown" });
      } else {
        setState({
          kind: "success",
          artist: data.artist,
          title: data.title,
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[song-id] capture/upload failed:", (e as Error).message);
      setState({ kind: "error", message: (e as Error).message });
    } finally {
      inFlightRef.current = false;
    }
  }

  // Tappable only when (a) not currently in flight AND (b) the radio is on.
  // When off, the lozenge dims and the body cue tells the user to tune in.
  const tappable = state.kind !== "listening" && isPlaying;
  const marquee = bodyOverflow && !reducedMotion;
  // Drag-to-pan mode is the reduced-motion fallback for overflow text —
  // mirrors the dial caption's behavior. dragMode and marquee are mutually
  // exclusive; both require bodyOverflow.
  const dragMode = bodyOverflow && reducedMotion;
  const currentPan = drag ? drag.current : pan;
  const clamp = (t: number) => Math.min(0, Math.max(maxPan, t));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragMode) return;
    // Capture the pointer on the cream window so subsequent pointermove
    // events come back to it even if the cursor leaves the element.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ start: e.clientX, base: pan, current: pan, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.start;
    const next = clamp(drag.base + dx);
    const moved = drag.moved || Math.abs(dx) > DRAG_THRESHOLD;
    setDrag({ ...drag, current: next, moved });
  };
  const endDrag = () => {
    if (!drag) return;
    setPan(drag.current);
    if (drag.moved) {
      // Suppress the click that follows pointerup so the drag-release
      // doesn't also fire onTap (and trigger an unwanted song-ID capture).
      suppressClickRef.current = true;
      requestAnimationFrame(() => {
        suppressClickRef.current = false;
      });
    }
    setDrag(null);
  };

  return (
    <div className="flex justify-center w-full select-none">
      <button
        type="button"
        onClick={tappable ? onTap : undefined}
        disabled={!tappable}
        aria-label="Now playing — tap to identify the current song"
        title={
          dragMode
            ? "Drag the cream window to scroll · Tap to identify the current song"
            : "Tap to identify the current song"
        }
        className="relative w-[260px] sm:w-[320px] transition-[transform,opacity] active:translate-y-[1px] disabled:active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
        style={{
          padding: "6px 20px 10px",
          borderRadius: 10,
          background:
            "linear-gradient(180deg, #d4a754 0%, #b48a49 45%, #8a6327 100%)",
          boxShadow:
            "inset 0 1px 2px rgba(255,240,200,0.7), inset 0 -2px 3px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.5)",
          cursor: tappable ? "pointer" : "default",
          // Dim the whole plate when the radio is off so the disabled state
          // reads at a glance — same visual cue we use elsewhere for inert
          // controls. Brass-on-walnut at full opacity always looks "on".
          opacity: !isPlaying ? 0.55 : 1,
        }}
      >
        {/* Four corner screws — visual rhyme with the Suggestion Box */}
        {[
          { top: 4, left: 4 },
          { top: 4, right: 4 },
          { bottom: 4, left: 4 },
          { bottom: 4, right: 4 },
        ].map((pos, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute rounded-full"
            style={{
              ...pos,
              width: 5,
              height: 5,
              background:
                "radial-gradient(circle at 35% 30%, #f0d9a8 0%, #8a6327 70%, #3a280f 100%)",
              boxShadow:
                "inset 0 0 0 0.5px rgba(0,0,0,0.6), 0 1px 1px rgba(0,0,0,0.4)",
            }}
          />
        ))}

        {/* Engraved "NOW PLAYING" header — solid black ink with a softened
            highlight so the letters read crisp against the brass. */}
        <div
          className="font-display tracking-[0.25em] uppercase text-center"
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#000",
            textShadow:
              "0 1px 0 rgba(255,240,200,0.35), 0 0 0.5px rgba(0,0,0,0.95)",
          }}
        >
          Now Playing
        </div>

        {/* Recessed cream window — body text lives here. Inset shadow gives
            the impression of a window cut into the face plate.
            Three render branches:
              - dragMode (reducedMotion + overflow): single copy at
                translateX(currentPan); user can click-drag to scroll.
              - marquee (motion-allowed + overflow): two copies + global
                @keyframes marquee, mirroring the dial caption.
              - static: single copy with truncate. */}
        <div
          ref={creamRef}
          className="relative mx-auto mt-1.5 rounded-[3px] overflow-hidden"
          style={{
            width: "94%",
            height: 32,
            background:
              "linear-gradient(180deg, #ebd9b2 0%, #d8c290 60%, #c9b07a 100%)",
            boxShadow:
              "inset 0 2px 3px rgba(0,0,0,0.55), inset 0 -1px 1px rgba(255,240,200,0.4), 0 1px 0 rgba(255,240,200,0.35)",
            // In dragMode, the cream window itself is the drag handle;
            // touchAction: pan-y preserves vertical page scroll on touch
            // devices (otherwise touch drag would scroll the page).
            cursor: dragMode ? (drag ? "grabbing" : "grab") : undefined,
            touchAction: dragMode ? "pan-y" : undefined,
          }}
          onPointerDown={dragMode ? onPointerDown : undefined}
          onPointerMove={dragMode ? onPointerMove : undefined}
          onPointerUp={dragMode ? endDrag : undefined}
          onPointerCancel={dragMode ? endDrag : undefined}
        >
          {dragMode ? (
            <div
              className={
                "absolute inset-y-0 left-0 inline-flex items-center whitespace-nowrap px-3 " +
                (state.kind === "success"
                  ? "text-[14px] sm:text-[16px] font-display"
                  : "text-[13px] sm:text-[15px] font-display tracking-[0.05em]")
              }
              style={{
                color: "#1a120a",
                fontStyle: state.kind === "listening" ? "italic" : "normal",
                transform: `translateX(${currentPan}px)`,
                // No transition while actively dragging (so the pan tracks
                // the finger 1:1); a short ease-out on release for polish.
                transition: drag ? "none" : "transform 220ms ease-out",
                // While dragging, the inner content must not capture
                // pointer events (capture is on the cream window outer).
                pointerEvents: drag ? "none" : undefined,
              }}
            >
              {body}
            </div>
          ) : marquee ? (
            <div
              className={
                "absolute inset-y-0 left-0 inline-flex items-center whitespace-nowrap px-3 " +
                (state.kind === "success"
                  ? "text-[14px] sm:text-[16px] font-display"
                  : "text-[13px] sm:text-[15px] font-display tracking-[0.05em]")
              }
              style={{
                color: "#1a120a",
                fontStyle: state.kind === "listening" ? "italic" : "normal",
                animation: `marquee ${bodyDuration}s linear infinite`,
              }}
            >
              <span>{body}{"  •  "}</span>
              <span aria-hidden>{body}{"  •  "}</span>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-3">
              <span
                className={
                  "block w-full text-center truncate " +
                  (state.kind === "success"
                    ? "text-[14px] sm:text-[16px] font-display"
                    : "text-[13px] sm:text-[15px] font-display tracking-[0.05em]")
                }
                style={{
                  color: "#1a120a",
                  opacity:
                    state.kind === "idle" ||
                    state.kind === "unknown" ||
                    state.kind === "error"
                      ? 0.65
                      : 1,
                  fontStyle: state.kind === "listening" ? "italic" : "normal",
                }}
              >
                {body}
              </span>
            </div>
          )}

          {/* Hidden single-copy measurer — uses the same font sizing as the
              visible body span so scrollWidth is an honest measurement of
              the rendered text. Always present regardless of branch so the
              ResizeObserver can re-measure across state changes. */}
          <span
            ref={measureRef}
            aria-hidden
            className={
              "invisible whitespace-nowrap pointer-events-none absolute left-0 top-0 " +
              (state.kind === "success"
                ? "text-[14px] sm:text-[16px] font-display"
                : "text-[13px] sm:text-[15px] font-display tracking-[0.05em]")
            }
          >
            {body}
          </span>

          {/* Listening indicator — small dot inside the cream window so the
              user has live feedback that capture is in progress. Pulses on
              machines that allow motion; stays solid otherwise (the
              "listening…" text is sufficient feedback either way). */}
          {state.kind === "listening" && (
            <span
              aria-hidden
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{
                width: 8,
                height: 8,
                borderRadius: 9999,
                background:
                  "radial-gradient(circle at 35% 30%, #ff9d6e 0%, #c0411a 70%, #5a1a08 100%)",
                boxShadow: "0 0 8px rgba(255,140,70,0.9)",
                animation: reducedMotion
                  ? undefined
                  : "nplPulse 0.9s ease-in-out infinite",
              }}
            />
          )}
        </div>

        {/* Local keyframes for the listening dot — scoped via a unique name
            so it can't collide with anything else in the cascade. The
            reducedMotion gate above also avoids ever applying this when
            the user opts out, so the global reduced-motion CSS override
            (which crushes animation-duration to 0.01ms) never gets a
            chance to turn this into the M17-style strobe. */}
        <style jsx>{`
          @keyframes nplPulse {
            0%,
            100% {
              opacity: 0.4;
              transform: translateY(-50%) scale(0.85);
            }
            50% {
              opacity: 1;
              transform: translateY(-50%) scale(1.15);
            }
          }
        `}</style>
      </button>
    </div>
  );
}
