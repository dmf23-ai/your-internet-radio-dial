"use client";

/**
 * VolumeKnob — smaller knob, left side.
 * Desktop: rotate by pointer angle. Touch: horizontal/upward drag.
 * Keyboard: Arrow keys nudge by 5%.
 * Ring is labeled OFF ... MAX with 7 tick dots.
 */

import { useEffect, useState } from "react";
import { useRadioStore } from "@/lib/store";
import { useRotaryKnob } from "@/lib/useRotaryKnob";
import { isIos } from "@/lib/isIos";

export default function VolumeKnob() {
  const volume = useRadioStore((s) => s.volume);
  const setVolume = useRadioStore((s) => s.setVolume);

  // iOS: neither masterGain (silent due to the WebKit MES bug) nor el.volume
  // (Apple ignores programmatic writes on <audio> as platform policy)
  // actually attenuates audible audio. Grey the knob and show a persistent
  // caption explaining hardware-button-only control. Detected after
  // hydration to keep SSR markup consistent.
  const [iosDisabled, setIosDisabled] = useState(false);
  useEffect(() => setIosDisabled(isIos()), []);

  const { angle, bind } = useRotaryKnob({
    value: volume,
    onChange: setVolume,
    min: 0,
    max: 1,
    step: 0.05,
    minAngle: -135,
    maxAngle: 135,
    ariaLabel: "Volume",
    ariaValueText: `${Math.round(volume * 100)} percent`,
  });

  const tickRadius = 64;
  const labelRadius = 76;

  return (
    <div
      className="flex flex-col items-center select-none"
      title={
        iosDisabled
          ? "Volume on iPhone is controlled by the hardware buttons (Apple platform policy)"
          : undefined
      }
    >
      <div
        className="relative"
        style={{
          width: 160,
          height: 160,
          opacity: iosDisabled ? 0.4 : 1,
          pointerEvents: iosDisabled ? "none" : undefined,
        }}
      >
        {iosDisabled && (
          <span
            aria-hidden
            className="absolute inset-0 z-10"
            style={{ cursor: "not-allowed" }}
          />
        )}
        {/* tick dots every 45° from -135 to +135 */}
        {Array.from({ length: 7 }).map((_, i) => {
          const a = -135 + i * 45;
          return (
            <span
              key={i}
              aria-hidden
              className="absolute rounded-full"
              style={{
                top: "50%",
                left: "50%",
                width: 3,
                height: 3,
                transform: `translate(-50%, -50%) rotate(${a}deg) translate(0, -${tickRadius}px)`,
                background: "#8a6327",
                boxShadow: "0 0 2px rgba(255, 200, 100, 0.35)",
              }}
            />
          );
        })}

        {/* OFF / MAX labels — rotated to sit at -135 and +135, text kept upright */}
        <span
          aria-hidden
          className="absolute font-display text-[10px] uppercase tracking-[0.22em] text-brass-300"
          style={{
            top: "50%",
            left: "50%",
            transform: `translate(-50%, -50%) rotate(-135deg) translate(0, -${labelRadius}px) rotate(135deg)`,
          }}
        >
          Off
        </span>
        <span
          aria-hidden
          className="absolute font-display text-[10px] uppercase tracking-[0.22em] text-brass-300"
          style={{
            top: "50%",
            left: "50%",
            transform: `translate(-50%, -50%) rotate(135deg) translate(0, -${labelRadius}px) rotate(-135deg)`,
          }}
        >
          Max
        </span>

        {/* brass ring + knob — centered in the labeled container */}
        <div
          {...bind}
          className="absolute surface-brass rounded-full shadow-brass-ring flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
          style={{
            ...bind.style,
            width: 110,
            height: 110,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            className="rounded-full relative shadow-knob"
            style={{
              width: 82,
              height: 82,
              background:
                "radial-gradient(circle at 35% 30%, #4d3220 0%, #2a1810 55%, #120a04 100%)",
              transform: `rotate(${angle}deg)`,
              transition: "transform 40ms linear",
            }}
          >
            <div
              className="absolute rounded-full"
              style={{
                top: 8,
                left: "50%",
                translate: "-50% 0",
                width: 6,
                height: 6,
                background:
                  "radial-gradient(circle at 30% 30%, #ffd5a0 0%, #c47a1e 70%, #5a3f1a 100%)",
                boxShadow: "0 0 4px rgba(255, 179, 71, 0.6)",
              }}
            />
            <div
              className="absolute rounded-full"
              style={{
                width: 26,
                height: 26,
                top: "50%",
                left: "50%",
                translate: "-50% -50%",
                background:
                  "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 45%, #5a3f1a 100%)",
                boxShadow:
                  "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7)",
              }}
            />
          </div>
        </div>
      </div>
      <span
        className="-mt-3 font-display tracking-[0.25em] uppercase text-xs text-brass-300"
        style={{ opacity: iosDisabled ? 0.5 : 1 }}
      >
        Volume
      </span>
      {iosDisabled && (
        <span
          className="mt-0.5 font-display text-[9px] uppercase tracking-[0.18em] text-brass-300/60 text-center"
          style={{ maxWidth: 160 }}
        >
          iPhone: use hardware buttons
        </span>
      )}
    </div>
  );
}
