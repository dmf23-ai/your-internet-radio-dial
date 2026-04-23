"use client";

import { useRadioStore } from "@/lib/store";

/**
 * PowerButton — clickable power lamp at bottom-left of the console.
 * Click/tap to play or pause the current station. Lights amber when playing.
 */
export function PowerButton() {
  const on = useRadioStore((s) => s.isOn);
  const togglePlay = useRadioStore((s) => s.togglePlay);

  return (
    <button
      type="button"
      onClick={() => void togglePlay()}
      aria-label={on ? "Power — off" : "Power — on"}
      className="flex items-center gap-2 rounded-full px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 active:scale-[0.97] transition-transform"
    >
      <span
        aria-hidden
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{
          background: on ? "#ffb347" : "#5a3f1a",
          boxShadow: on
            ? "0 0 8px rgba(255,179,71,0.9), 0 0 2px rgba(255,179,71,1)"
            : "inset 0 1px 2px rgba(0,0,0,0.7)",
        }}
      />
      <span className="font-display tracking-[0.2em] uppercase text-xs sm:text-sm text-brass-300">
        Power
      </span>
    </button>
  );
}

/**
 * OnAirLamp — passive status indicator at bottom-right.
 * idle = dark, buffering = pulsing amber, playing = steady amber, error = red.
 */
export function OnAirLamp() {
  const status = useRadioStore((s) => s.playback.status);

  const color =
    status === "playing"
      ? "#ffb347"
      : status === "buffering"
      ? "#ff9d30"
      : status === "error"
      ? "#e5533a"
      : "#5a3f1a";

  const glow =
    status === "playing"
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
      : status === "buffering"
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
