"use client";

import { useEffect, useRef, useState } from "react";
import { useRadioStore } from "@/lib/store";
import { getAudioEngine } from "@/lib/audio";
import { isIos } from "@/lib/isIos";

/**
 * VUMeter — analog level meter.
 * When audio is playing and the analyser is accessible, the needle tracks
 * smoothed RMS. When the analyser is blocked (CORS) or the stream is
 * buffering, it idle-pulses so the meter feels alive and we show a subtle
 * "meter unavailable" badge. When idle/errored it parks at zero.
 */
export default function VUMeter() {
  const status = useRadioStore((s) => s.playback.status);
  const meterAvailable = useRadioStore((s) => s.playback.meterAvailable);

  // --- arc geometry ---
  const w = 180;
  const h = 110;
  const cx = w / 2;
  const cy = h + 10; // pivot below the visible area
  const r = 100;
  const startDeg = -60;
  const endDeg = 60;

  // tick positions (printed scale)
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const t = i / 10;
    const deg = startDeg + (endDeg - startDeg) * t;
    return { t, deg, label: i % 2 === 0 ? String(-20 + i * 3) : null };
  });

  // --- needle animation loop ---
  const needleRef = useRef<SVGGElement>(null);
  const currentRef = useRef(0); // smoothed normalized level 0..1
  const rafRef = useRef<number | null>(null);

  // Engine reports meterAvailable=true whenever the analyser was created,
  // but a CORS-locked stream silently returns zeros. We detect that with a
  // zero-streak timer: ≥2s of RMS≈0 → flip to pulse + badge; ≥1 non-zero
  // reading clears it (so a genuinely quiet song doesn't trap the badge).
  const [suspectBlocked, setSuspectBlocked] = useState(false);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Classic VU-ish: fast attack, slow decay. Reduced-motion eases both.
    const attack = prefersReduced ? 0.15 : 0.35;
    const decay = prefersReduced ? 0.05 : 0.09;

    const engine = getAudioEngine();
    const isActive = status === "playing" || status === "buffering";
    const canMeter = status === "playing" && meterAvailable;

    const start = performance.now();
    let zeroStart: number | null = null;
    let blocked = false; // local mirror of suspectBlocked, drives decisions in-loop

    const pulse = (elapsedMs: number) => {
      const t = elapsedMs / 1000;
      return 0.22 + 0.13 * Math.sin(t * Math.PI);
    };

    const tick = (ts: number) => {
      let target: number;
      if (canMeter) {
        const r = engine.getRms(); // 0..1
        if (r < 0.001) {
          if (zeroStart == null) zeroStart = ts;
          if (!blocked && ts - zeroStart > 2000) {
            blocked = true;
            setSuspectBlocked(true);
          }
        } else {
          zeroStart = null;
          if (blocked) {
            blocked = false;
            setSuspectBlocked(false);
          }
        }
        target = blocked ? pulse(ts - start) : r;
      } else if (isActive) {
        target = pulse(ts - start);
      } else {
        target = 0;
      }

      const cur = currentRef.current;
      const factor = target > cur ? attack : decay;
      const next = cur + (target - cur) * factor;
      currentRef.current = next;

      const norm = Math.min(1, Math.max(0, next));
      const deg = startDeg + (endDeg - startDeg) * norm;
      if (needleRef.current) {
        needleRef.current.setAttribute(
          "transform",
          `rotate(${deg.toFixed(2)} ${cx} ${cy})`,
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      // When the stream changes, clear stale suspicion so the new stream
      // gets a fresh 2s grace window.
      setSuspectBlocked(false);
    };
  }, [status, meterAvailable, cx, cy]);

  // iOS: the analyser receives zero samples (WebKit MES bug), so the meter
  // would always be parked — show a permanent "VU meter not available on
  // iPhone" overlay rather than the sometimes-pulsing/sometimes-zero
  // ambiguity. Detected after hydration to keep SSR markup consistent.
  const [iosMode, setIosMode] = useState(false);
  useEffect(() => setIosMode(isIos()), []);

  const showMeterBadge =
    !iosMode &&
    (status === "playing" || status === "buffering") &&
    (!meterAvailable || suspectBlocked);

  // initial needle position = parked
  const initialDeg = startDeg;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="surface-brass rounded-lg p-[4px] shadow-brass-ring"
        style={{ width: w + 16 }}
      >
        <div
          className="relative overflow-hidden rounded-md"
          style={{
            width: w,
            height: h,
            background:
              "radial-gradient(ellipse at 50% 100%, #f3e5c4 0%, #e8d6a8 60%, #c9b282 100%)",
          }}
        >
          {/* Faint printed arc band */}
          <svg width={w} height={h + 10} className="absolute inset-0">
            {/* green band */}
            <path
              d={describeArc(cx, cy, r, startDeg, startDeg + 80)}
              stroke="#4a7c59"
              strokeWidth={4}
              fill="none"
              opacity={0.7}
            />
            {/* red band */}
            <path
              d={describeArc(cx, cy, r, startDeg + 80, endDeg)}
              stroke="#b13b2e"
              strokeWidth={4}
              fill="none"
              opacity={0.75}
            />
            {/* ticks + labels */}
            {ticks.map(({ deg, label }, i) => {
              const { x1, y1, x2, y2, lx, ly } = tickGeom(cx, cy, r, deg, !!label);
              return (
                <g key={i}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#1a120a"
                    strokeWidth={label ? 1.5 : 1}
                    opacity={0.85}
                  />
                  {label && (
                    <text
                      x={lx}
                      y={ly}
                      fill="#1a120a"
                      fontSize="9"
                      fontFamily="var(--font-numerals), serif"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      opacity={0.85}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
            {/* needle — transform is driven imperatively via rAF */}
            <g
              ref={needleRef}
              transform={`rotate(${initialDeg} ${cx} ${cy})`}
            >
              <line
                x1={cx}
                y1={cy}
                x2={cx}
                y2={cy - r + 4}
                stroke="#8a1515"
                strokeWidth={1.6}
                strokeLinecap="round"
              />
              <circle cx={cx} cy={cy} r={5} fill="#5a3f1a" />
              <circle cx={cx} cy={cy} r={2.5} fill="#ffd5a0" />
            </g>
          </svg>
          {/* "VU" label */}
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-display italic text-ink/70 text-xs tracking-widest">
            VU
          </span>
          {/* Meter-unavailable badge (CORS-locked analyser) */}
          {showMeterBadge && (
            <span
              className="absolute top-1 left-1/2 -translate-x-1/2 font-display uppercase tracking-[0.18em] text-[9px] text-ink/60"
              title="This stream's server blocks analyser access (CORS). Audio is playing but level can't be measured."
            >
              meter unavailable
            </span>
          )}
          {/* iOS overlay — covers the dial face with a clear, two-line
              explanation. Grey ink on the cream meter face matches the
              "engraved on the panel" reading; pointer-events:none so the
              underlying SVG is still inspectable in DevTools. */}
          {iosMode && (
            <div
              className="absolute inset-0 flex items-center justify-center text-center px-2 pointer-events-none"
              style={{
                color: "rgba(26, 18, 10, 0.55)",
                background:
                  "radial-gradient(ellipse at 50% 50%, rgba(243,229,196,0.55) 0%, rgba(243,229,196,0.2) 70%, rgba(243,229,196,0) 100%)",
              }}
            >
              <span className="font-display uppercase tracking-[0.18em] text-[9px] leading-[1.4]">
                VU meter
                <br />
                not available
                <br />
                on iPhone
              </span>
            </div>
          )}
        </div>
      </div>
      <span className="font-display tracking-[0.25em] uppercase text-xs text-brass-300">
        Level
      </span>
    </div>
  );
}

// ----- SVG arc helpers -----
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function describeArc(cx: number, cy: number, r: number, a1: number, a2: number) {
  const p1 = polar(cx, cy, r, a1);
  const p2 = polar(cx, cy, r, a2);
  const large = a2 - a1 <= 180 ? 0 : 1;
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
}
function tickGeom(
  cx: number,
  cy: number,
  r: number,
  deg: number,
  major: boolean,
) {
  const outer = polar(cx, cy, r - 2, deg);
  const inner = polar(cx, cy, r - (major ? 14 : 8), deg);
  const label = polar(cx, cy, r - 22, deg);
  return {
    x1: outer.x,
    y1: outer.y,
    x2: inner.x,
    y2: inner.y,
    lx: label.x,
    ly: label.y,
  };
}
