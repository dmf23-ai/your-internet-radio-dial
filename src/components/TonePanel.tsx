"use client";

/**
 * TonePanel — two compact brass knobs (Bass / Treble) that control the
 * BiquadFilterNodes in the audio engine. Range -12..+12 dB, 0 = transparent.
 *
 * Detent at 0: arrow-key nudges and pointer drags both snap toward 0 when
 * within ±0.75 dB, so it's easy to find "flat". Double-click also resets a
 * knob to 0.
 *
 * Visual: smaller cousin of VolumeKnob — same brass ring + dark wood face,
 * scaled down so two of them fit beneath the volume knob without crowding
 * the cabinet's left column. A small "0" tick at the top of the ring makes
 * the centered/flat position legible at a glance.
 */

import { useRadioStore } from "@/lib/store";
import { useRotaryKnob } from "@/lib/useRotaryKnob";

interface ToneKnobProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
}

function ToneKnob({ label, value, onChange }: ToneKnobProps) {
  // Snap-to-zero detent: anything within ±0.75 dB of flat reads as flat.
  const detentSnap = (v: number) => (Math.abs(v) < 0.75 ? 0 : v);

  const { angle, bind } = useRotaryKnob({
    value,
    onChange: (v) => onChange(detentSnap(v)),
    min: -12,
    max: 12,
    step: 0.5,
    minAngle: -135,
    maxAngle: 135,
    ariaLabel: label,
    ariaValueText: `${value > 0 ? "+" : ""}${value.toFixed(1)} decibels`,
  });

  const tickRadius = 36;
  // Show the displayed value near the readout — useful when the user is
  // dialing in a specific cut/boost.
  const display =
    value === 0
      ? "0"
      : `${value > 0 ? "+" : ""}${
          Number.isInteger(value) ? value : value.toFixed(1)
        }`;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div className="relative" style={{ width: 92, height: 92 }}>
        {/* tick dots: 5 marks across the arc, with a brighter "0" at top */}
        {Array.from({ length: 5 }).map((_, i) => {
          const a = -135 + i * 67.5;
          const isCenter = i === 2; // top tick = 0 dB
          return (
            <span
              key={i}
              aria-hidden
              className="absolute rounded-full"
              style={{
                top: "50%",
                left: "50%",
                width: isCenter ? 4 : 2.5,
                height: isCenter ? 4 : 2.5,
                transform: `translate(-50%, -50%) rotate(${a}deg) translate(0, -${tickRadius}px)`,
                background: isCenter ? "#e8c878" : "#8a6327",
                boxShadow: isCenter
                  ? "0 0 4px rgba(255, 200, 100, 0.7)"
                  : "0 0 2px rgba(255, 200, 100, 0.3)",
              }}
            />
          );
        })}

        {/* brass ring + knob */}
        <div
          {...bind}
          onDoubleClick={() => onChange(0)}
          className="absolute surface-brass rounded-full shadow-brass-ring flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
          style={{
            ...bind.style,
            width: 64,
            height: 64,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            className="rounded-full relative shadow-knob"
            style={{
              width: 46,
              height: 46,
              background:
                "radial-gradient(circle at 35% 30%, #4d3220 0%, #2a1810 55%, #120a04 100%)",
              transform: `rotate(${angle}deg)`,
              transition: "transform 40ms linear",
            }}
          >
            {/* Pointer dot */}
            <div
              className="absolute rounded-full"
              style={{
                top: 5,
                left: "50%",
                translate: "-50% 0",
                width: 4,
                height: 4,
                background:
                  "radial-gradient(circle at 30% 30%, #ffd5a0 0%, #c47a1e 70%, #5a3f1a 100%)",
                boxShadow: "0 0 3px rgba(255, 179, 71, 0.6)",
              }}
            />
            {/* Center brass cap */}
            <div
              className="absolute rounded-full"
              style={{
                width: 14,
                height: 14,
                top: "50%",
                left: "50%",
                translate: "-50% -50%",
                background:
                  "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 45%, #5a3f1a 100%)",
                boxShadow:
                  "inset 0 1px 1px rgba(255,240,200,0.6), inset 0 -1px 2px rgba(0,0,0,0.7)",
              }}
            />
          </div>
        </div>
      </div>
      <span className="font-display tracking-[0.2em] uppercase text-[10px] text-brass-300">
        {label}
      </span>
      <span
        className="font-mono text-[10px] text-brass-300/80"
        style={{ minWidth: 24, textAlign: "center" }}
      >
        {display} dB
      </span>
    </div>
  );
}

export default function TonePanel() {
  const bass = useRadioStore((s) => s.bass);
  const treble = useRadioStore((s) => s.treble);
  const setBass = useRadioStore((s) => s.setBass);
  const setTreble = useRadioStore((s) => s.setTreble);

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <ToneKnob label="Bass" value={bass} onChange={setBass} />
      <ToneKnob label="Treble" value={treble} onChange={setTreble} />
    </div>
  );
}
