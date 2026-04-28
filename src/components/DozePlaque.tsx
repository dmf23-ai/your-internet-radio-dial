"use client";

/**
 * DozePlaque — antique sleep-timer affordance. Cycles through preset
 * durations on click: OFF → 15 → 30 → 60 → 90 → OFF. While running, shows
 * remaining time as MM:SS and a glowing amber lamp. Long-press (or
 * double-click) cancels regardless of position.
 *
 * The audio engine handles the actual fade + stop; the plaque is a thin
 * controller + countdown view. Countdown is driven by a 1Hz ticker so we
 * don't churn the React tree on every animation frame.
 */

import { useEffect, useState } from "react";
import { useRadioStore } from "@/lib/store";

const STEPS = [0, 15, 30, 60, 90] as const; // minutes

function nextStep(current: number): number {
  const idx = STEPS.indexOf(current as (typeof STEPS)[number]);
  if (idx < 0) return 0; // unrecognised → reset to off
  return STEPS[(idx + 1) % STEPS.length];
}

function fmt(ms: number): string {
  if (ms <= 0) return "00:00";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function DozePlaque() {
  const dozeMinutes = useRadioStore((s) => s.dozeMinutes);
  const dozeEndAt = useRadioStore((s) => s.dozeEndAt);
  const setDoze = useRadioStore((s) => s.setDoze);

  // 1Hz tick driving the countdown readout.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!dozeEndAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [dozeEndAt]);

  const active = dozeMinutes > 0 && dozeEndAt > 0;
  const remaining = active ? Math.max(0, dozeEndAt - Date.now()) : 0;
  // While the timer is running, the plaque shows the LIVE countdown so the
  // user can see it tick down. When idle, it shows "OFF". The fixed step
  // label (e.g. "30 MIN") is shown briefly on click via the ticker, but
  // for simplicity the plaque face just shows OFF/MM:SS.
  const face = active ? fmt(remaining) : "OFF";

  return (
    <button
      type="button"
      onClick={() => setDoze(nextStep(dozeMinutes))}
      onDoubleClick={(e) => {
        e.preventDefault();
        setDoze(0);
      }}
      aria-label={
        active
          ? `Sleep timer — ${fmt(remaining)} remaining. Click to cycle, double-click to cancel.`
          : "Sleep timer — off. Click to set duration."
      }
      title={
        active
          ? `Doze: ${fmt(remaining)} (double-click to cancel)`
          : "Doze: off"
      }
      className="flex items-center gap-2 px-3 py-2 rounded-md transition-transform active:translate-y-[1px]"
      style={{
        background:
          "linear-gradient(180deg, #2a1810 0%, #120a04 100%)",
        border: "1px solid rgba(0,0,0,0.6)",
        boxShadow:
          "inset 0 1px 2px rgba(255,200,140,0.18), inset 0 -1px 1px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.5)",
      }}
    >
      {/* Lamp — glows when timer is active */}
      <span
        aria-hidden
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{
          background: active ? "#ffb347" : "#3a2818",
          boxShadow: active
            ? "0 0 6px rgba(255,179,71,0.9), 0 0 1px rgba(255,179,71,1)"
            : "inset 0 1px 1px rgba(0,0,0,0.6)",
        }}
      />
      <span className="flex flex-col items-start leading-tight">
        <span className="font-display tracking-[0.2em] uppercase text-[9px] text-brass-300/80">
          Doze
        </span>
        <span
          className="font-mono text-[12px] text-[#e8d6a8]"
          style={{ minWidth: 38, textAlign: "left" }}
        >
          {face}
        </span>
      </span>
    </button>
  );
}
