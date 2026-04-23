"use client";

// Shared rotary-knob interaction hook.
// Desktop (mouse): rotate by pointer angle around the knob's center.
// Touch: horizontal + upward drag -> value change.
// Keyboard: arrow keys nudge by `step`.
//
// IMPORTANT: per-frame deltas are applied to a running value in a ref.
// This prevents the "wrap-around" problem where over-rotating past max
// would cause the value to flip to the opposite extreme.

import { useCallback, useMemo, useRef } from "react";

export interface UseRotaryKnobOptions {
  value: number;
  onChange: (v: number) => void;
  onChangeEnd?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  minAngle?: number;
  maxAngle?: number;
  touchSensitivity?: number;
  ariaLabel?: string;
  ariaValueText?: string;
}

interface DragState {
  mode: "angle" | "delta";
  lastAng: number;
  lastX: number;
  lastY: number;
  cx: number;
  cy: number;
  running: number; // cumulative clamped value
  pointerId: number;
}

export function useRotaryKnob(opts: UseRotaryKnobOptions) {
  const {
    value,
    onChange,
    onChangeEnd,
    min = 0,
    max = 1,
    step = 0.05,
    minAngle = -135,
    maxAngle = 135,
    touchSensitivity = 220,
    ariaLabel,
    ariaValueText,
  } = opts;

  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);

  const clamp = useMemo(
    () => (v: number) => Math.max(min, Math.min(max, v)),
    [min, max]
  );

  const t = (value - min) / (max - min || 1);
  const angle = minAngle + t * (maxAngle - minAngle);

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
        running: value,
        pointerId: e.pointerId,
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
    },
    [value]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = drag.current;
      if (!s || s.pointerId !== e.pointerId) return;

      let dv = 0;
      const range = maxAngle - minAngle;
      if (s.mode === "angle") {
        const a =
          (Math.atan2(e.clientY - s.cy, e.clientX - s.cx) * 180) / Math.PI;
        let d = a - s.lastAng;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        s.lastAng = a;
        dv = (d / range) * (max - min);
      } else {
        const dx = e.clientX - s.lastX;
        const dy = s.lastY - e.clientY;
        s.lastX = e.clientX;
        s.lastY = e.clientY;
        dv = ((dx + dy) / touchSensitivity) * (max - min);
      }

      const next = clamp(s.running + dv);
      s.running = next;
      onChange(next);
    },
    [clamp, onChange, max, min, minAngle, maxAngle, touchSensitivity]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = drag.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        ref.current?.releasePointerCapture(e.pointerId);
      } catch {}
      const v = s.running;
      drag.current = null;
      onChangeEnd?.(v);
    },
    [onChangeEnd]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        onChange(clamp(value + step));
        e.preventDefault();
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        onChange(clamp(value - step));
        e.preventDefault();
      }
    },
    [clamp, value, step, onChange]
  );

  return {
    angle,
    bind: {
      ref,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      tabIndex: 0,
      role: "slider" as const,
      "aria-valuemin": min,
      "aria-valuemax": max,
      "aria-valuenow": Number.isFinite(value) ? value : 0,
      "aria-label": ariaLabel,
      "aria-valuetext": ariaValueText,
      style: { touchAction: "none" as const, cursor: "grab" as const },
    },
  };
}
