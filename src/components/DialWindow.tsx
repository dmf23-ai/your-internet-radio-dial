"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRadioStore } from "@/lib/store";

/**
 * Fetch "now playing" title for a stream URL via our proxy.
 * Returns null while loading or if unavailable. Re-polls every 30s
 * while the same station is active.
 */
function useNowPlaying(streamUrl: string | undefined): string | null {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    setTitle(null);
    if (!streamUrl) return;

    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch(
          `/api/now-playing?url=${encodeURIComponent(streamUrl)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { title: string | null };
        if (!cancelled) setTitle(data.title ?? null);
      } catch {
        /* swallow — best-effort */
      }
    };

    fetchOnce();
    const id = setInterval(fetchOnce, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [streamUrl]);

  return title;
}

/**
 * ScrollingCaption — displays text; if it overflows the container, it scrolls
 * as a seamless marquee (two copies + CSS keyframe translating -50%).
 * Falls back to truncate when the text fits.
 *
 * The whole pill is wired as a button when `onClick` is provided — clicking
 * it opens the Station Detail card (M13). When there's no station tuned
 * yet, the prop is omitted and the pill renders as a plain div.
 */
function ScrollingCaption({
  text,
  onClick,
}: {
  text: string;
  onClick?: () => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [duration, setDuration] = useState(20);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const m = measureRef.current;
    if (!outer || !m) return;

    const check = () => {
      const w = m.scrollWidth;
      const c = outer.clientWidth;
      const needs = w > c + 1;
      setOverflow(needs);
      // ~50px/sec feels like a period-appropriate ticker; min 12s so short
      // overflows don't whip past too fast.
      if (needs) setDuration(Math.max(12, w / 50));
    };
    check();
    // Web fonts may still be loading on first paint; their swap changes the
    // measurer's intrinsic width without changing the pill's clientWidth,
    // so the ResizeObserver below wouldn't catch it. Re-measure once fonts
    // settle. (Manifests on machines where a corporate VPN delays the WOFF2
    // fetch enough that initial measurement happens against a fallback font
    // — Times-on-Windows is much narrower than Cormorant Garamond, so the
    // cached duration ends up wildly short once the real font swaps in.)
    document.fonts?.ready?.then(check);
    const ro = new ResizeObserver(check);
    ro.observe(outer);
    ro.observe(m); // catch any inner-width changes (font swap, zoom, reflow)
    return () => ro.disconnect();
  }, [text]);

  const sep = "\u00a0\u00a0•\u00a0\u00a0";

  // The pill itself stays a div for clean ref typing; we layer an absolutely
  // positioned button over it when interactive, so the click target is the
  // whole pill but the ref/layout machinery is unaffected.
  return (
    <div
      ref={outerRef}
      className={`relative max-w-full overflow-hidden px-4 py-1 rounded-full bg-walnut-900/40 text-ink font-display italic text-xs sm:text-sm tracking-wide ${
        onClick ? "hover:bg-walnut-900/55 transition-colors" : ""
      }`}
    >
      {overflow ? (
        <div
          className="inline-flex whitespace-nowrap"
          style={{ animation: `marquee ${duration}s linear infinite` }}
        >
          <span>
            {text}
            {sep}
          </span>
          <span aria-hidden>
            {text}
            {sep}
          </span>
        </div>
      ) : (
        <div className="truncate whitespace-nowrap">{text}</div>
      )}
      {/* Hidden single-copy measurer — always present so we can re-measure
          the true text width regardless of current render mode. */}
      <span
        ref={measureRef}
        aria-hidden
        className="invisible whitespace-nowrap pointer-events-none absolute left-0 top-0"
      >
        {text}
      </span>
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          aria-label="Show station details"
          title="Show station details"
          className="absolute inset-0 cursor-pointer"
          style={{ background: "transparent" }}
        />
      )}
    </div>
  );
}

/**
 * DialWindow — the amber-lit tuning dial.
 * Wired: needle tracks currentStation index within active group,
 * caption shows name · bitrate · codec. Now-playing added in M2b.
 */
export default function DialWindow() {
  const list = useRadioStore(useShallow((s) => s.stationsInActiveGroup()));
  const current = useRadioStore((s) => s.currentStation());
  const currentStationId = useRadioStore((s) => s.currentStationId);
  const setCurrentStation = useRadioStore((s) => s.setCurrentStation);
  const setDetailOpen = useRadioStore((s) => s.setDetailOpen);
  const nowPlaying = useNowPlaying(current?.streamUrl);

  const count = list.length;
  const idx = currentStationId
    ? Math.max(0, list.findIndex((s) => s.id === currentStationId))
    : 0;

  // Drum-strip geometry: fixed physical pitch between labels so each is
  // readable regardless of how many stations the band holds. The tape
  // slides so label[idx] is always centered in the strip window.
  const STRIP_PITCH = 120; // px per label slot
  const DRAG_THRESHOLD = 5; // px of movement before a down-gesture becomes a drag

  // Drag-to-tune state. Non-null while the pointer is down.
  //   start:    clientX at pointerdown
  //   base:     tape translateX at pointerdown (in px, negative for rightward tape shift)
  //   current:  tape translateX right now (clamped to valid range)
  //   moved:    has the pointer moved past DRAG_THRESHOLD yet
  const [drag, setDrag] = useState<{
    start: number;
    base: number;
    current: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  // Default tape offset: center label[idx] in the strip window.
  const baseTranslate = -(idx * STRIP_PITCH + STRIP_PITCH / 2);
  const translate = drag ? drag.current : baseTranslate;

  // If the user is dragging, the label under the center marker isn't
  // necessarily the tuned station yet — it's the *preview*. Highlight that.
  const previewIdx =
    drag && drag.moved && count > 0
      ? Math.max(
          0,
          Math.min(
            count - 1,
            Math.round((-drag.current - STRIP_PITCH / 2) / STRIP_PITCH),
          ),
        )
      : idx;

  const clampTranslate = (t: number) => {
    if (count === 0) return -STRIP_PITCH / 2;
    const min = -((count - 1) * STRIP_PITCH + STRIP_PITCH / 2);
    const max = -STRIP_PITCH / 2;
    return Math.min(max, Math.max(min, t));
  };

  const onStripPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (count === 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      start: e.clientX,
      base: baseTranslate,
      current: baseTranslate,
      moved: false,
    });
  };

  const onStripPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.start;
    const next = clampTranslate(drag.base + dx);
    const moved = drag.moved || Math.abs(dx) > DRAG_THRESHOLD;
    setDrag({ ...drag, current: next, moved });
  };

  const endDrag = () => {
    if (!drag) return;
    if (drag.moved && count > 0) {
      const snapIdx = Math.max(
        0,
        Math.min(
          count - 1,
          Math.round((-drag.current - STRIP_PITCH / 2) / STRIP_PITCH),
        ),
      );
      const target = list[snapIdx];
      if (target && target.id !== currentStationId) {
        setCurrentStation(target.id);
      }
      // Swallow the click event that follows pointerup so the label the
      // user happened to release over doesn't also fire its own tune.
      suppressClickRef.current = true;
      requestAnimationFrame(() => {
        suppressClickRef.current = false;
      });
    }
    setDrag(null);
  };

  const onLabelClick = (stationId: string) => {
    if (suppressClickRef.current) return;
    setCurrentStation(stationId);
  };

  // Caption bits
  const bits: string[] = [];
  if (current) {
    bits.push(current.name);
    if (current.bitrate) bits.push(`${current.bitrate} kbps`);
    if (current.streamType && current.streamType !== "unknown") {
      bits.push(current.streamType.toUpperCase());
    }
  }
  const metaLine =
    bits.length > 0 ? bits.join(" · ") : "— turn the dial to begin —";
  const caption = nowPlaying ? `${metaLine} — ${nowPlaying}` : metaLine;

  return (
    <div className="relative">
      {/* Amber glow halo */}
      <div className="absolute inset-0 amber-glow rounded-[22px] pointer-events-none" />

      {/* Brass bezel */}
      <div className="surface-brass p-[6px] rounded-[22px] shadow-brass-ring">
        {/* Inner dial */}
        <div
          className="surface-dial relative rounded-[18px] overflow-hidden"
          style={{ minHeight: 210 }}
        >
          {/* Production credit — centered at the top of the dial face. */}
          <div className="flex justify-center px-6 pt-4 text-ink font-display uppercase tracking-[0.25em] text-[10px] sm:text-xs">
            <span className="opacity-75">A Fruchtomania Production</span>
          </div>

          {/* Maker's mark — sits under the production credit, etched in
              walnut ink on the cream dial face. Italic for the period
              feel; size matches the credit above. */}
          <div className="flex justify-center px-6 pt-0.5 text-ink/80 font-display italic tracking-wide text-[10px] sm:text-xs">
            <span>Model No. 1 · Est. 2026</span>
          </div>

          {/* Frequency-style tick marks + station ticks.
              The 41 background hashes are a static "frequency ruler"
              (decorative). The brass station markers ride a sliding
              container at the same pitch as the name strip below, so
              the current station's marker always sits at the row's
              center — directly under the fixed needle. */}
          <div className="relative mx-6 mt-2 h-5">
            {Array.from({ length: 41 }).map((_, i) => (
              <span
                key={i}
                className="absolute top-0 bg-ink"
                style={{
                  left: `${(i / 40) * 100}%`,
                  width: i % 5 === 0 ? 2 : 1,
                  height: i % 5 === 0 ? 18 : 10,
                  opacity: i % 5 === 0 ? 0.8 : 0.45,
                }}
              />
            ))}
            {/* Sliding station markers — scoped to a mask-image'd container
                so they fade in/out at the row's edges as they scroll. */}
            {count > 0 && (
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  maskImage:
                    "linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)",
                }}
              >
                <div
                  className="absolute top-0 h-full"
                  style={{
                    left: "50%",
                    transform: `translateX(${translate}px)`,
                    transition: drag
                      ? "none"
                      : "transform 320ms cubic-bezier(0.22, 0.8, 0.3, 1)",
                  }}
                >
                  {list.map((s, i) => {
                    const isCurrent = i === previewIdx;
                    return (
                      <span
                        key={s.id}
                        className="absolute top-0"
                        style={{
                          left: i * STRIP_PITCH + STRIP_PITCH / 2 - 1,
                          width: 2,
                          height: 22,
                          background: isCurrent ? "#ffd58a" : "#c8964a",
                          boxShadow: isCurrent
                            ? "0 0 6px rgba(255,200,120,0.9)"
                            : "none",
                          opacity: isCurrent ? 1 : 0.8,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Drum-dial name strip — a cream ticker-tape that slides so the
              current station's label is centered in the window. Edges fade
              to transparent for a "rolling behind a viewport" effect. The
              full-length needle (rendered below) passes through the strip
              and acts as the center indicator. */}
          <div
            className="mx-6 mt-2 relative h-8 rounded-[3px] bg-ivory-dial/90 overflow-hidden select-none"
            style={{
              boxShadow:
                "inset 0 1px 2px rgba(0,0,0,0.35), inset 0 -1px 1px rgba(255,220,170,0.35)",
              maskImage:
                "linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)",
              touchAction: "pan-y",
              cursor: drag ? "grabbing" : "grab",
            }}
            onPointerDown={onStripPointerDown}
            onPointerMove={onStripPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {count > 0 && (
              <div
                className="absolute top-0 h-full flex items-center"
                style={{
                  left: "50%",
                  transform: `translateX(${translate}px)`,
                  transition: drag
                    ? "none"
                    : "transform 320ms cubic-bezier(0.22, 0.8, 0.3, 1)",
                }}
              >
                {list.map((s, i) => {
                  const isCurrent = i === previewIdx;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onLabelClick(s.id)}
                      className={`font-display uppercase tracking-[0.18em] whitespace-nowrap text-center px-1 truncate transition-colors ${
                        isCurrent
                          ? "text-amber-deep text-[12px] font-semibold"
                          : "text-ink/75 hover:text-ink text-[11px]"
                      }`}
                      style={{
                        width: STRIP_PITCH,
                        flex: "0 0 auto",
                        // While dragging, the button shouldn't steal the
                        // pointer events from the parent's drag handler.
                        pointerEvents: drag ? "none" : "auto",
                      }}
                      title={s.name}
                      draggable={false}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Needle + cap — fixed at the center of the dial. The drum-style
              station markers and name strip slide beneath it, bringing the
              current station's mark and label directly under the needle. */}
          <div className="pointer-events-none absolute top-0 bottom-0 left-6 right-6">
            <div
              className="absolute top-3 bottom-10 w-[1px]"
              style={{
                left: "50%",
                transform: "translateX(-50%)",
                background:
                  "linear-gradient(180deg, #e34848 0%, #a82222 100%)",
                boxShadow: "0 0 5px rgba(255, 110, 110, 0.8)",
              }}
            />
            <div
              className="absolute w-3 h-3 rounded-full"
              style={{
                left: "50%",
                transform: "translateX(-50%)",
                top: 6,
                background:
                  "radial-gradient(circle at 30% 30%, #ffd5a0 0%, #c47a1e 60%, #5a3f1a 100%)",
                boxShadow: "0 0 4px rgba(0,0,0,0.6)",
              }}
            />
          </div>

          {/* Caption */}
          <div className="absolute left-0 right-0 bottom-2 flex justify-center px-4">
            <ScrollingCaption
              text={caption}
              onClick={current ? () => setDetailOpen(true) : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
