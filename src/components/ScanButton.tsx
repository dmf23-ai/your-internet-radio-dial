"use client";

/**
 * ScanButton — brass-on-walnut pushbutton that toggles serendipity drift.
 * When active, the audio engine drifts to a random station every 12s
 * across all bands. A small lamp glows amber while scan is running.
 * Manually tuning the dial cancels scan automatically (handled in the
 * store's setCurrentStation).
 */

import { useRadioStore } from "@/lib/store";

export default function ScanButton() {
  const scanning = useRadioStore((s) => s.scanning);
  const setScanning = useRadioStore((s) => s.setScanning);

  return (
    <button
      type="button"
      onClick={() => setScanning(!scanning)}
      aria-pressed={scanning}
      aria-label={scanning ? "Stop scanning" : "Start scanning"}
      title={
        scanning
          ? "Scan: on (drifting every 12s — tune the dial to stop)"
          : "Scan: off (click to drift across stations)"
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
      <span
        aria-hidden
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${
          scanning ? "animate-pulse" : ""
        }`}
        style={{
          background: scanning ? "#ffb347" : "#3a2818",
          boxShadow: scanning
            ? "0 0 6px rgba(255,179,71,0.9), 0 0 1px rgba(255,179,71,1)"
            : "inset 0 1px 1px rgba(0,0,0,0.6)",
        }}
      />
      <span className="flex flex-col items-start leading-tight">
        <span className="font-display tracking-[0.2em] uppercase text-[9px] text-brass-300/80">
          Drift
        </span>
        <span
          className="font-display tracking-[0.18em] uppercase text-[12px] text-[#e8d6a8]"
          style={{ minWidth: 38, textAlign: "left" }}
        >
          {scanning ? "ON" : "SCAN"}
        </span>
      </span>
    </button>
  );
}
