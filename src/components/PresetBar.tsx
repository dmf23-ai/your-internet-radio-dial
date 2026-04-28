"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRadioStore } from "@/lib/store";
import GroupEditor from "./GroupEditor";

/**
 * PresetBar — mechanical push-button bar for groups/bands.
 *
 * Layout:  [⌕ search]   [Favorites] [Jazz] [News] [Ambient] [+]   [☰ menu]
 *
 * Interactions:
 *  - Click a group → setActiveGroup
 *  - Long-press (≥500ms) or right-click a group → stub edit modal (M3 will
 *    host the real rename/reorder/delete editor)
 *  - "+" → stub "new group" modal
 *  - Search/menu brass icons toggle UI flags (overlays land in M3/M4)
 */
export default function PresetBar() {
  const groups = useRadioStore(
    useShallow((s) =>
      [...s.groups].sort((a, b) => a.position - b.position),
    ),
  );
  const activeGroupId = useRadioStore((s) => s.activeGroupId);
  const setActiveGroup = useRadioStore((s) => s.setActiveGroup);
  const setSearchOpen = useRadioStore((s) => s.setSearchOpen);
  const setStationListOpen = useRadioStore((s) => s.setStationListOpen);
  const setAccountOpen = useRadioStore((s) => s.setAccountOpen);
  const userIsAnonymous = useRadioStore(
    (s) => s.user?.isAnonymous ?? true,
  );

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const editingGroup = groups.find((g) => g.id === editingGroupId) ?? null;

  // --- Group-scroller overflow affordances ---
  // Reuses the dial strip's vocabulary: edge mask-fade + mouse drag-to-scroll
  // + click suppression after a drag. Touch keeps native horizontal swipe
  // (momentum scroll) for free. Arrow steppers on each end appear when
  // there's content to reveal in that direction.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const refreshScrollAffordances = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    refreshScrollAffordances();
    el.addEventListener("scroll", refreshScrollAffordances, { passive: true });
    const ro = new ResizeObserver(refreshScrollAffordances);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", refreshScrollAffordances);
      ro.disconnect();
    };
    // Re-check whenever the group count changes — adding/removing groups
    // can change scrollWidth without a resize event.
  }, [refreshScrollAffordances, groups.length]);

  const onScrollerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Leave touch to the browser (native momentum scroll). Only hijack mouse.
    if (e.pointerType !== "mouse") return;
    const el = scrollerRef.current;
    if (!el) return;
    // Intentionally NOT calling setPointerCapture here: the PresetButtons
    // inside the scroller need to keep receiving their own pointerup /
    // pointerleave events so their long-press timers cancel normally.
    // Document-level listeners handle the rest of the drag.
    dragRef.current = {
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
      moved: false,
    };
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      el.scrollLeft = d.startScrollLeft - dx;
      if (!d.moved && Math.abs(dx) > 5) d.moved = true;
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      if (d?.moved) {
        suppressClickRef.current = true;
        requestAnimationFrame(() => {
          suppressClickRef.current = false;
        });
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const scrollByStep = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 160, behavior: "smooth" });
  };

  return (
    <>
      <div className="flex items-center gap-2 sm:gap-3 w-full">
        <VerticalBrassLabel text="Radio" />

        <div
          className="flex-1 flex items-stretch gap-3 rounded-[14px] px-3 py-2 min-w-0"
          style={{
            background:
              "linear-gradient(180deg, #2a1810 0%, #1a0f08 100%)",
            border: "1px solid rgba(0,0,0,0.55)",
            boxShadow:
              "inset 0 2px 5px rgba(0,0,0,0.7), inset 0 -1px 2px rgba(255,200,140,0.07)",
          }}
          aria-label="Group presets"
        >
          <BrassIconButton
            label={userIsAnonymous ? "Account (guest)" : "Account"}
            icon={<PersonIcon />}
            onClick={() => setAccountOpen(true)}
            showDot={userIsAnonymous}
          />

          <BrassIconButton
            label="Search"
            icon={<MagnifierIcon />}
            onClick={() => setSearchOpen(true)}
          />

          <div className="flex-1 relative min-w-0">
          <div
            ref={scrollerRef}
            className="flex items-center gap-2 overflow-x-auto scrollbar-none"
            style={{
              scrollbarWidth: "none",
              maskImage:
                "linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)",
              cursor: dragging ? "grabbing" : "grab",
            }}
            onPointerDown={onScrollerPointerDown}
          >
            {groups.map((g) => (
              <PresetButton
                key={g.id}
                label={g.name}
                active={g.id === activeGroupId}
                onActivate={() => {
                  if (suppressClickRef.current) return;
                  setActiveGroup(g.id);
                }}
                onLongPress={() => setEditingGroupId(g.id)}
              />
            ))}
          </div>

          {/* Brass arrow-steppers — auto-hide when already at that end. */}
          {canScrollLeft && (
            <BrassStepper
              direction="left"
              onStep={() => scrollByStep(-1)}
              ariaLabel="Scroll presets left"
            />
          )}
          {canScrollRight && (
            <BrassStepper
              direction="right"
              onStep={() => scrollByStep(1)}
              ariaLabel="Scroll presets right"
            />
          )}
          </div>

          <BrassIconButton
            label="Stations in this band"
            icon={<MenuIcon />}
            onClick={() => setStationListOpen(true)}
          />
        </div>

        <VerticalBrassLabel text="Bands" />
      </div>

      {/* "New Band" plaque — dark walnut base with brass engraved text and a
          brass "+" glyph. Visual sibling to the preset buttons (it creates one,
          after all) and reads cleanly without the brass-on-brass wash-out the
          M5 maker-plate styling produced. */}
      <div className="flex justify-center mt-2">
        <button
          type="button"
          onClick={() => setCreatingGroup(true)}
          aria-label="Create a new band"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-display uppercase tracking-[0.22em] text-[11px] sm:text-xs transition-transform active:translate-y-[1px]"
          style={{
            color: "#e8d6a8",
            background: "linear-gradient(180deg, #2a1810 0%, #120a04 100%)",
            border: "1px solid rgba(0,0,0,0.7)",
            boxShadow:
              "inset 0 1px 1px rgba(255,200,140,0.18), inset 0 -2px 3px rgba(0,0,0,0.6), 0 2px 3px rgba(0,0,0,0.45)",
            textShadow: "0 1px 0 rgba(0,0,0,0.55)",
          }}
        >
          <svg
            aria-hidden
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
          >
            <line
              x1="5.5"
              y1="1.5"
              x2="5.5"
              y2="9.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line
              x1="1.5"
              y1="5.5"
              x2="9.5"
              y2="5.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          New Band
        </button>
      </div>

      {(editingGroup || creatingGroup) && (
        <GroupEditor
          mode={
            editingGroup
              ? { kind: "edit", groupId: editingGroup.id }
              : { kind: "create" }
          }
          onClose={() => {
            setEditingGroupId(null);
            setCreatingGroup(false);
          }}
        />
      )}
    </>
  );
}

// ----- Preset button with long-press detection -----

const LONG_PRESS_MS = 500;

function PresetButton({
  label,
  active,
  title,
  onActivate,
  onLongPress,
}: {
  label: string;
  active?: boolean;
  title?: string;
  onActivate: () => void;
  onLongPress?: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  const cancelTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Only track primary pointer. Ignore secondary touches / right mouse
    // (right-click is handled via onContextMenu below).
    if (e.button !== 0) return;
    longFiredRef.current = false;
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    if (!onLongPress) return;
    timerRef.current = setTimeout(() => {
      longFiredRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    // If the user starts scrubbing the preset bar horizontally, that's a
    // drag — not a long-press. Cancel the timer so the GroupEditor doesn't
    // pop up mid-scroll.
    const start = pressStartRef.current;
    if (!start || !timerRef.current) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > 25) cancelTimer(); // ~5px
  };

  const handlePointerUpOrLeave = () => {
    pressStartRef.current = null;
    cancelTimer();
  };

  const handleClick = () => {
    // If the long-press fired, swallow the trailing click.
    if (longFiredRef.current) {
      longFiredRef.current = false;
      return;
    }
    onActivate();
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!onLongPress) return;
    e.preventDefault();
    onLongPress();
  };

  useEffect(() => () => cancelTimer(), []);

  return (
    <button
      type="button"
      title={title}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrLeave}
      onPointerLeave={handlePointerUpOrLeave}
      onPointerCancel={handlePointerUpOrLeave}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className="shrink-0 select-none font-display uppercase tracking-[0.2em] text-[11px] sm:text-xs rounded-md px-3 py-1.5 transition-transform active:translate-y-[1px]"
      style={{
        color: active ? "#1a120a" : "#e8d6a8",
        background: active
          ? "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)"
          : "linear-gradient(180deg, #2a1810 0%, #120a04 100%)",
        border: "1px solid rgba(0,0,0,0.7)",
        boxShadow: active
          ? "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.5)"
          : "inset 0 1px 1px rgba(255,200,140,0.15), inset 0 -2px 3px rgba(0,0,0,0.6), 0 2px 3px rgba(0,0,0,0.4)",
        minWidth: 64,
      }}
    >
      {label}
    </button>
  );
}

// ----- Vertical brass label (e.g. "RADIO" / "BANDS" flanking the groups) -----

function VerticalBrassLabel({ text }: { text: string }) {
  return (
    <div
      aria-hidden
      className="shrink-0 flex flex-col items-center font-display uppercase text-brass-300 select-none"
      style={{
        fontSize: 11,
        letterSpacing: "0.1em",
        lineHeight: 1.35,
      }}
    >
      {text.toUpperCase().split("").map((ch, i) => (
        <span key={i}>{ch}</span>
      ))}
    </div>
  );
}

// ----- Brass icon button -----

function BrassIconButton({
  label,
  icon,
  onClick,
  showDot,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  /**
   * Small red "needs attention" dot rendered top-right. Used on the Account
   * button while the user is still anonymous to nudge them toward signup.
   */
  showDot?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px]"
      style={{
        background:
          "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
        boxShadow:
          "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
        color: "#1a120a",
      }}
    >
      {icon}
      {showDot && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 30% 25%, #ff8870 0%, #d63a24 60%, #7a1a0f 100%)",
            boxShadow:
              "0 0 4px rgba(255,100,70,0.7), inset 0 0.5px 0.5px rgba(255,220,200,0.7)",
          }}
        />
      )}
    </button>
  );
}

function MagnifierIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.7" />
      <line
        x1="12.5"
        y1="12.5"
        x2="17"
        y2="17"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <line x1="3" y1="5" x2="17" y2="5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="3" y1="15" x2="17" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M3.5 17c1.2-3.2 3.6-4.8 6.5-4.8s5.3 1.6 6.5 4.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ----- Brass arrow-stepper for PresetBar overflow -----

function BrassStepper({
  direction,
  onStep,
  ariaLabel,
}: {
  direction: "left" | "right";
  onStep: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onStep}
      className={`absolute top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center transition-transform active:translate-y-[calc(-50%+1px)] ${
        direction === "left" ? "left-0" : "right-0"
      }`}
      style={{
        background:
          "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
        boxShadow:
          "inset 0 1px 1.5px rgba(255,240,200,0.6), inset 0 -1.5px 2px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.6)",
        color: "#1a120a",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        {direction === "left" ? (
          <path
            d="M7.5 2.5L4 6l3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M4.5 2.5L8 6l-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}

