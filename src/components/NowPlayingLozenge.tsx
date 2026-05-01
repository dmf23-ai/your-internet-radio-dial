"use client";

import { useEffect, useRef, useState } from "react";
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
  // instead of pulsing.
  const [reducedMotion, setReducedMotion] = useState(false);
  const inFlightRef = useRef(false);

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

  async function onTap() {
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
      const blob = await getAudioEngine().captureAudioClip(CAPTURE_SECONDS);

      const form = new FormData();
      form.append("stationId", stationId);
      form.append("audio", blob, "clip.webm");

      const res = await fetch("/api/song-id", { method: "POST", body: form });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error("[song-id] HTTP", res.status);
        setState({ kind: "error", message: `error ${res.status}` });
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
  const body = bodyText(state, isPlaying);

  return (
    <div className="flex justify-center w-full select-none">
      <button
        type="button"
        onClick={tappable ? onTap : undefined}
        disabled={!tappable}
        aria-label="Now playing — tap to identify the current song"
        title="Tap to identify the current song"
        className="relative w-[260px] sm:w-[320px] transition-[transform,opacity] active:translate-y-[1px] disabled:active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
        style={{
          padding: "12px 20px 10px",
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
            the impression of a window cut into the face plate. */}
        <div
          className="relative mx-auto mt-1.5 rounded-[3px] overflow-hidden flex items-center justify-center px-3"
          style={{
            width: "94%",
            height: 32,
            background:
              "linear-gradient(180deg, #ebd9b2 0%, #d8c290 60%, #c9b07a 100%)",
            boxShadow:
              "inset 0 2px 3px rgba(0,0,0,0.55), inset 0 -1px 1px rgba(255,240,200,0.4), 0 1px 0 rgba(255,240,200,0.35)",
          }}
        >
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
