"use client";

/**
 * TunerKnob — large brass tuning knob (right of console).
 * Relative rotational input (not bounded to an arc). Rotating the knob advances
 * through the active group's stations; each station = DEG_PER_STATION of rotation.
 * Clamps at first/last station — the knob stops spinning once you can't advance further.
 * Soft-snaps to nearest station on release.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRadioStore } from "@/lib/store";
import { playTick } from "@/lib/tick";

const TICK_COUNT = 8; // fixed decorative ticks around the knob
const DEG_PER_STATION = 360 / TICK_COUNT; // 45° — one tick's worth per station
const PX_PER_STATION = 50; // touch drag: 50px = 1 station

export default function TunerKnob() {
  const { stations, memberships, activeGroupId, currentStationId, isPlaying } =
    useRadioStore(
      useShallow((s) => ({
        stations: s.stations,
        memberships: s.memberships,
        activeGroupId: s.activeGroupId,
        currentStationId: s.currentStationId,
        isPlaying: s.playback.isPlaying,
      }))
    );
  const setCurrentStation = useRadioStore((s) => s.setCurrentStation);

  const stationsInGroup = useMemo(() => {
    if (!activeGroupId) return [];
    const map = new Map(stations.map((st) => [st.id, st]));
    return memberships
      .filter((m) => m.groupId === activeGroupId)
      .sort((a, b) => a.position - b.position)
      .map((m) => map.get(m.stationId))
      .filter((st): st is NonNullable<typeof st> => !!st);
  }, [stations, memberships, activeGroupId]);

  const count = stationsInGroup.length;
  const max = Math.max(0, count - 1);

  const externalIdx = Math.max(
    0,
    stationsInGroup.findIndex((s) => s.id === currentStationId)
  );

  // Continuous station position (float). Integer = on a detent.
  const [position, setPosition] = useState<number>(externalIdx);
  const lastDetent = useRef<number>(externalIdx);

  // Sync when selection changes externally
  useEffect(() => {
    setPosition(externalIdx);
    lastDetent.current = externalIdx;
  }, [externalIdx]);

  const clamp = useCallback(
    (v: number) => Math.max(0, Math.min(max, v)),
    [max]
  );

  const commit = useCallback(
    (v: number) => {
      setPosition(v);
      const detent = Math.round(v);
      if (detent !== lastDetent.current && detent >= 0 && detent < count) {
        lastDetent.current = detent;
        playTick();
        const st = stationsInGroup[detent];
        if (st && st.id !== currentStationId) {
          setCurrentStation(st.id, isPlaying);
        }
      }
    },
    [count, currentStationId, isPlaying, setCurrentStation, stationsInGroup]
  );

  // --- drag logic (inline — rotational-input semantics, unlike the volume knob) ---
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    mode: "angle" | "delta";
    lastAng: number;
    lastX: number;
    lastY: number;
    cx: number;
    cy: number;
    running: number;
    pointerId: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      // Click/tap also focuses the knob so keyboard + focus ring work immediately.
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
      drag.current = {
        mode: e.pointerType === "mouse" ? "angle" : "delta",
        lastAng: ang,
        lastX: e.clientX,
        lastY: e.clientY,
        cx,
        cy,
        running: position,
        pointerId: e.pointerId,
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
    },
    [position]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = drag.current;
      if (!s || s.pointerId !== e.pointerId) return;

      let dv = 0;
      if (s.mode === "angle") {
        const a =
          (Math.atan2(e.clientY - s.cy, e.clientX - s.cx) * 180) / Math.PI;
        let d = a - s.lastAng;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        s.lastAng = a;
        dv = d / DEG_PER_STATION;
      } else {
        const dx = e.clientX - s.lastX;
        const dy = s.lastY - e.clientY;
        s.lastX = e.clientX;
        s.lastY = e.clientY;
        dv = (dx + dy) / PX_PER_STATION;
      }

      const next = clamp(s.running + dv);
      s.running = next;
      commit(next);
    },
    [clamp, commit]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = drag.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        ref.current?.releasePointerCapture(e.pointerId);
      } catch {}
      // Snap to nearest detent on release
      const snapped = Math.round(s.running);
      s.running = snapped;
      setPosition(snapped);
      drag.current = null;
    },
    []
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        commit(clamp(Math.round(position) + 1));
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        commit(clamp(Math.round(position) - 1));
        e.preventDefault();
      }
    },
    [clamp, commit, position]
  );

  // Visual rotation — 45° per station. For >8 stations, this exceeds 360° and
  // the dot does multiple revolutions as you scan. Clamps at first/last station.
  const angle = position * DEG_PER_STATION;

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="relative">
        {/* Outer brass ring — captures pointer + keyboard input */}
        <div
          ref={ref}
          tabIndex={0}
          role="slider"
          aria-label="Tuning"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.round(position)}
          aria-valuetext={
            stationsInGroup[Math.round(position)]?.name ?? "No station"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="surface-brass rounded-full shadow-brass-ring flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
          style={{
            width: 170,
            height: 170,
            touchAction: "none",
            cursor: "grab",
          }}
        >
          {/* 8 fixed tick "lamps" on the brass ring.
              Lit when a station exists at that slot (first `count` lamps, or
              all 8 if there are 8+ stations). Dim otherwise. */}
          {Array.from({ length: TICK_COUNT }).map((_, i) => {
            const a = i * DEG_PER_STATION;
            const lit = count >= TICK_COUNT || i < count;
            return (
              <span
                key={i}
                aria-hidden
                className="absolute rounded-full pointer-events-none"
                style={{
                  top: "50%",
                  left: "50%",
                  width: 5,
                  height: 5,
                  transform: `translate(-50%, -50%) rotate(${a}deg) translate(0, -78px)`,
                  background: lit ? "#ffcf7a" : "#3a2812",
                  boxShadow: lit
                    ? "0 0 6px rgba(255, 200, 100, 0.9), 0 0 2px rgba(255, 220, 160, 1)"
                    : "inset 0 1px 1px rgba(0,0,0,0.7)",
                  transition: "background 200ms ease, box-shadow 200ms ease",
                }}
              />
            );
          })}

          {/* Inner dark knob disc — rotates freely */}
          <div
            className="rounded-full relative shadow-knob"
            style={{
              width: 130,
              height: 130,
              background:
                "radial-gradient(circle at 35% 30%, #4d3220 0%, #2a1810 55%, #120a04 100%)",
              transform: `rotate(${angle}deg)`,
              transition: "transform 40ms linear",
            }}
          >
            {/* Knurled edge hints */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                backgroundImage:
                  "repeating-conic-gradient(rgba(255,210,160,0.12) 0deg 3deg, transparent 3deg 6deg)",
                WebkitMask:
                  "radial-gradient(circle, transparent 52%, #000 53%, #000 62%, transparent 63%)",
                mask: "radial-gradient(circle, transparent 52%, #000 53%, #000 62%, transparent 63%)",
              }}
            />
            {/* Pointer dot */}
            <div
              className="absolute rounded-full"
              style={{
                top: 12,
                left: "50%",
                translate: "-50% 0",
                width: 8,
                height: 8,
                background:
                  "radial-gradient(circle at 30% 30%, #ffd5a0 0%, #c47a1e 70%, #5a3f1a 100%)",
                boxShadow: "0 0 6px rgba(255, 179, 71, 0.6)",
              }}
            />
            {/* Center cap */}
            <div
              className="absolute rounded-full"
              style={{
                width: 40,
                height: 40,
                top: "50%",
                left: "50%",
                translate: "-50% -50%",
                background:
                  "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 45%, #5a3f1a 100%)",
                boxShadow:
                  "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
              }}
            />
          </div>
        </div>
      </div>
      <span className="font-display tracking-[0.25em] uppercase text-xs text-brass-300">
        Tuning
      </span>
    </div>
  );
}
