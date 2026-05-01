"use client";

import { useRadioStore } from "@/lib/store";

/**
 * PowerButton — brass-rimmed pushbutton at bottom-left of the console.
 *
 * The button is the cabinet's primary "press to play/stop" affordance, so it
 * reads as a real piece of hardware: a brass bezel housing a glass lamp dome,
 * with the universal power glyph (⏻, IEC 60417-5009) etched on the bezel.
 * Lamp dims walnut-brown when off, glows amber when on. "POWER" wordmark
 * sits to the right at slightly larger size than its M5 sibling.
 */
export function PowerButton() {
  const on = useRadioStore((s) => s.isOn);
  const togglePlay = useRadioStore((s) => s.togglePlay);

  return (
    <button
      type="button"
      onClick={() => void togglePlay()}
      aria-label={on ? "Power — off" : "Power — on"}
      title={on ? "Stop" : "Play"}
      className="group flex items-center gap-2.5 rounded-full pl-0.5 pr-2 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 active:translate-y-[1px] transition-transform"
    >
      {/* Brass-rimmed lamp socket. Etched ⏻ glyph above the dome. */}
      <span
        aria-hidden
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
          boxShadow:
            "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
        }}
      >
        {/* Etched power glyph — sits behind the lamp dome, dark on brass. */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          className="absolute"
          style={{
            color: "rgba(20,12,6,0.55)",
            filter: "drop-shadow(0 1px 0 rgba(255,240,200,0.35))",
          }}
        >
          {/* Top break in the ring + vertical bar = IEC power glyph */}
          <path
            d="M11 4 V10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M6.5 6.5 A6 6 0 1 0 15.5 6.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        {/* Glass dome — dark when off, glowing amber when on. */}
        <span
          className="relative inline-block w-3.5 h-3.5 rounded-full"
          style={{
            background: on
              ? "radial-gradient(circle at 35% 30%, #ffe7a8 0%, #ffb347 55%, #b56a16 100%)"
              : "radial-gradient(circle at 35% 30%, #5a3f1a 0%, #2a1810 70%)",
            boxShadow: on
              ? "0 0 10px rgba(255,179,71,0.95), 0 0 3px rgba(255,179,71,1), inset 0 0 2px rgba(255,240,200,0.8)"
              : "inset 0 1px 2px rgba(0,0,0,0.85), inset 0 -1px 1px rgba(255,200,140,0.12)",
          }}
        />
      </span>

      <span className="font-display tracking-[0.22em] uppercase text-sm sm:text-base text-brass-300 group-active:text-brass-200">
        Power
      </span>
    </button>
  );
}

/**
 * OnAirLamp — passive status indicator at bottom-right.
 * idle = dark, buffering = pulsing amber, playing = steady amber, error = red.
 *
 * M19: 'tuning' status (between-stations static envelope) renders the lamp
 * the same as 'playing' — steady amber, no pulse — so the color stays stable
 * across the user's tune action. The label flips to "Tuning…" so the user
 * has a textual cue to match the dial caption.
 */
export function OnAirLamp() {
  const status = useRadioStore((s) => s.playback.status);

  const color =
    status === "playing" || status === "tuning"
      ? "#ffb347"
      : status === "buffering"
      ? "#ff9d30"
      : status === "error"
      ? "#e5533a"
      : "#5a3f1a";

  const glow =
    status === "playing" || status === "tuning"
      ? "0 0 8px rgba(255,179,71,0.9), 0 0 2px rgba(255,179,71,1)"
      : status === "buffering"
      ? "0 0 10px rgba(255,157,48,0.95), 0 0 2px rgba(255,157,48,1)"
      : status === "error"
      ? "0 0 8px rgba(229,83,58,0.95), 0 0 2px rgba(229,83,58,1)"
      : "inset 0 1px 2px rgba(0,0,0,0.7)";

  const pulseClass = status === "buffering" ? "animate-pulse" : "";

  const label =
    status === "error"
      ? "Signal Lost"
      : status === "buffering" || status === "tuning"
      ? "Tuning…"
      : "On Air";

  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span
        aria-hidden
        className={`inline-block w-2.5 h-2.5 rounded-full ${pulseClass}`}
        style={{ background: color, boxShadow: glow }}
      />
      <span className="font-display tracking-[0.2em] uppercase text-xs sm:text-sm text-brass-300">
        {label}
      </span>
    </div>
  );
}
