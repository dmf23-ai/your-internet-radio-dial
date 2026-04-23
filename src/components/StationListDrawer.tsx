"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useRadioStore } from "@/lib/store";
import type { Station } from "@/data/seed";

/**
 * StationListDrawer — right-edge panel listing stations in the active band.
 *
 * Interactions:
 *  - Tap a row → setCurrentStation (auto-plays when Power is on)
 *  - ↑ / ↓ buttons → reorder within the band
 *  - 🗑 button → removeStationFromGroup
 *  - Backdrop tap / ESC / close X → dismiss
 */
export default function StationListDrawer() {
  const open = useRadioStore((s) => s.ui.stationListOpen);
  const setOpen = useRadioStore((s) => s.setStationListOpen);
  const activeGroupId = useRadioStore((s) => s.activeGroupId);
  const activeGroupName = useRadioStore(
    (s) => s.groups.find((g) => g.id === s.activeGroupId)?.name ?? "",
  );
  const stations = useRadioStore(
    useShallow((s) => s.stationsInActiveGroup()),
  );
  const currentStationId = useRadioStore((s) => s.currentStationId);

  const setCurrentStation = useRadioStore((s) => s.setCurrentStation);
  const moveStationInGroup = useRadioStore((s) => s.moveStationInGroup);
  const removeStationFromGroup = useRadioStore(
    (s) => s.removeStationFromGroup,
  );
  const setSearchOpen = useRadioStore((s) => s.setSearchOpen);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="station-list"
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label="Station list"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Panel */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
            className="absolute top-0 right-0 h-full w-full sm:w-[360px] flex flex-col"
            style={{
              background:
                "linear-gradient(180deg, #2a1810 0%, #1a0f08 100%)",
              borderLeft: "1px solid rgba(0,0,0,0.6)",
              boxShadow: "-8px 0 24px rgba(0,0,0,0.55)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{
                borderBottom: "1px solid rgba(0,0,0,0.55)",
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 100%)",
              }}
            >
              <div className="min-w-0">
                <div className="text-[10px] tracking-[0.22em] uppercase text-brass-300/70">
                  Band
                </div>
                <div className="font-display uppercase tracking-[0.18em] text-brass-300 text-sm truncate">
                  {activeGroupName || "—"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setSearchOpen(true);
                  }}
                  aria-label="Search stations"
                  title="Add stations"
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px]"
                  style={brassIconStyle}
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                    <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.7" />
                    <line x1="12.5" y1="12.5" x2="17" y2="17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px]"
                  style={brassIconStyle}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-2 px-2">
              {stations.length === 0 ? (
                <EmptyState onOpenSearch={() => {
                  setOpen(false);
                  setSearchOpen(true);
                }} />
              ) : (
                stations.map((s, idx) => (
                  <Row
                    key={s.id}
                    station={s}
                    isCurrent={s.id === currentStationId}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < stations.length - 1}
                    onTune={() => setCurrentStation(s.id)}
                    onMoveUp={() =>
                      activeGroupId &&
                      moveStationInGroup(s.id, activeGroupId, "up")
                    }
                    onMoveDown={() =>
                      activeGroupId &&
                      moveStationInGroup(s.id, activeGroupId, "down")
                    }
                    onRemove={() =>
                      activeGroupId &&
                      removeStationFromGroup(s.id, activeGroupId)
                    }
                  />
                ))
              )}
            </div>

            {/* Footer count */}
            <div
              className="shrink-0 px-4 py-2 text-[10px] tracking-[0.18em] uppercase text-ivory-soft/50"
              style={{ borderTop: "1px solid rgba(0,0,0,0.55)" }}
            >
              {stations.length} station{stations.length === 1 ? "" : "s"}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- Row ----------------

function Row({
  station,
  isCurrent,
  canMoveUp,
  canMoveDown,
  onTune,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  station: Station;
  isCurrent: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onTune: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const subtitle = [
    station.country,
    station.bitrate ? `${station.bitrate} kbps` : null,
    station.streamType !== "unknown" ? station.streamType.toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-2 mb-1"
      style={{
        background: isCurrent
          ? "linear-gradient(180deg, rgba(255,200,140,0.10) 0%, rgba(255,200,140,0.02) 100%)"
          : "transparent",
        border: isCurrent
          ? "1px solid rgba(180,138,73,0.45)"
          : "1px solid transparent",
      }}
    >
      {/* Tap target: logo + name (the main row body) */}
      <button
        type="button"
        onClick={onTune}
        className="flex-1 flex items-center gap-2 min-w-0 text-left"
      >
        <div
          className="shrink-0 w-9 h-9 rounded-md overflow-hidden flex items-center justify-center bg-walnut-800 border border-walnut-700"
          aria-hidden
        >
          {station.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={station.logoUrl}
              alt=""
              width={36}
              height={36}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span className="font-display text-brass-300/70 text-xs">
              {station.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div
            className={`text-sm truncate ${
              isCurrent ? "text-amber-warm" : "text-ivory-dial"
            }`}
          >
            {station.name}
          </div>
          <div className="text-[11px] text-ivory-soft/55 truncate">
            {subtitle || "—"}
          </div>
        </div>
      </button>

      {/* Row actions */}
      <div className="flex items-center gap-1 shrink-0">
        <IconButton
          onClick={onMoveUp}
          disabled={!canMoveUp}
          label="Move up"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2 L2 7 H10 Z" fill="currentColor" />
          </svg>
        </IconButton>
        <IconButton
          onClick={onMoveDown}
          disabled={!canMoveDown}
          label="Move down"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 10 L10 5 H2 Z" fill="currentColor" />
          </svg>
        </IconButton>
        <IconButton onClick={onRemove} label="Remove" danger>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 4h8v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm2-2h4v1h2v1H3V3h2V2Z"
              fill="currentColor"
            />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-7 h-7 rounded flex items-center justify-center transition-transform active:translate-y-[1px] disabled:opacity-30 disabled:cursor-default disabled:active:translate-y-0"
      style={{
        color: danger ? "#e8a58b" : "#e8d6a8",
        background: "linear-gradient(180deg, #2a1810 0%, #120a04 100%)",
        border: "1px solid rgba(0,0,0,0.55)",
        boxShadow:
          "inset 0 1px 1px rgba(255,200,140,0.1), 0 1px 2px rgba(0,0,0,0.4)",
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center py-10 px-4 text-center">
      <div className="font-display uppercase tracking-[0.18em] text-sm text-brass-300/80">
        Empty Band
      </div>
      <div className="mt-2 text-xs text-ivory-soft/60 max-w-[240px]">
        No stations in this band yet. Tap below to find some.
      </div>
      <button
        type="button"
        onClick={onOpenSearch}
        className="mt-4 font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-3 py-1.5"
        style={{
          color: "#1a120a",
          background:
            "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
          border: "1px solid rgba(0,0,0,0.7)",
          boxShadow:
            "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.5)",
        }}
      >
        Find stations
      </button>
    </div>
  );
}

const brassIconStyle: React.CSSProperties = {
  background:
    "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
  boxShadow:
    "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
  color: "#1a120a",
};
