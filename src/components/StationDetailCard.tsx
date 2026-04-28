"use client";

/**
 * StationDetailCard — modal card showing the metadata for the currently-
 * tuned station. Triggered by clicking the dial caption (the cream label
 * pill at the bottom of the dial). Mirrors AboutOverlay's visual family:
 * dark wood frame, brass plaque header, ink-on-ivory body.
 *
 * Now-playing is fetched independently of DialWindow so the card always
 * has fresh title text — and is re-fetched every 30s while open.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRadioStore } from "@/lib/store";

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
        /* swallow */
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

export default function StationDetailCard() {
  const open = useRadioStore((s) => s.ui.detailOpen);
  const setOpen = useRadioStore((s) => s.setDetailOpen);
  const station = useRadioStore((s) => s.currentStation());
  const nowPlaying = useNowPlaying(open ? station?.streamUrl : undefined);

  // ESC to close.
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
      {open && station && (
        <motion.div
          key="detail-overlay"
          className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Station details"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/65"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="relative w-full max-w-[480px] max-h-[85vh] rounded-[18px] flex flex-col overflow-hidden"
            style={{
              background: "linear-gradient(180deg, #2a1810 0%, #1a0f08 100%)",
              border: "1px solid rgba(0,0,0,0.6)",
              boxShadow:
                "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,200,140,0.08) inset",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 shrink-0"
              style={{
                borderBottom: "1px solid rgba(0,0,0,0.55)",
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 100%)",
              }}
            >
              <div className="px-4 py-1 rounded-full surface-brass text-walnut-900 font-display text-[11px] sm:text-xs tracking-[0.25em] uppercase">
                Station Card
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px] shrink-0"
                style={brassIconStyle}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <line
                    x1="2"
                    y1="2"
                    x2="12"
                    y2="12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <line
                    x1="12"
                    y1="2"
                    x2="2"
                    y2="12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div
              className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6 text-ink"
              style={{
                background:
                  "radial-gradient(ellipse at top, #f3e5c4 0%, #e8d6a8 100%)",
              }}
            >
              {/* Logo + name row */}
              <div className="flex items-start gap-3 mb-4">
                {station.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={station.logoUrl}
                    alt=""
                    className="w-14 h-14 rounded-md object-cover shrink-0"
                    style={{
                      border: "1px solid rgba(0,0,0,0.25)",
                      background: "rgba(0,0,0,0.05)",
                    }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                    }}
                  />
                ) : (
                  <div
                    aria-hidden
                    className="w-14 h-14 rounded-md shrink-0 flex items-center justify-center font-display text-[10px] uppercase tracking-[0.2em] text-walnut-700"
                    style={{
                      background:
                        "linear-gradient(180deg, #d8c089 0%, #b89c5e 100%)",
                      border: "1px solid rgba(0,0,0,0.25)",
                    }}
                  >
                    {station.streamType === "unknown"
                      ? "Live"
                      : station.streamType.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-[18px] sm:text-[20px] font-semibold leading-tight text-walnut-900">
                    {station.name}
                  </h2>
                  {nowPlaying && (
                    <p className="mt-1 italic text-[12px] sm:text-[13px] text-ink/85 truncate">
                      {nowPlaying}
                    </p>
                  )}
                </div>
              </div>

              {/* Metadata grid */}
              <DataRow label="Country" value={station.country} />
              <DataRow label="Language" value={station.language} />
              <DataRow
                label="Bitrate"
                value={station.bitrate ? `${station.bitrate} kbps` : undefined}
              />
              <DataRow
                label="Format"
                value={
                  station.streamType && station.streamType !== "unknown"
                    ? station.streamType.toUpperCase()
                    : undefined
                }
              />
              {station.tags && station.tags.length > 0 && (
                <div className="mt-3">
                  <h3 className="font-display uppercase tracking-[0.22em] text-[10px] text-walnut-700 mb-1.5">
                    Tags
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {station.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-full text-[11px] tracking-wide"
                        style={{
                          background: "rgba(90,63,26,0.18)",
                          color: "#3a2818",
                          border: "1px solid rgba(90,63,26,0.25)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Links / actions */}
              <div className="mt-4 flex flex-wrap gap-2">
                {station.homepage && (
                  <a
                    href={station.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-md font-display tracking-[0.18em] uppercase text-[10px]"
                    style={{
                      background:
                        "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
                      color: "#1a120a",
                      boxShadow:
                        "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
                    }}
                  >
                    Visit Homepage
                  </a>
                )}
              </div>

              {/* Stream URL — small, monospaced, copy button. Useful for
                  power users debugging a stream that isn't quite right. */}
              <div className="mt-5">
                <h3 className="font-display uppercase tracking-[0.22em] text-[10px] text-walnut-700 mb-1.5">
                  Stream URL
                </h3>
                <div className="flex items-stretch gap-2">
                  <code
                    className="flex-1 min-w-0 px-2 py-1.5 rounded text-[11px] truncate"
                    style={{
                      background: "rgba(0,0,0,0.08)",
                      border: "1px solid rgba(0,0,0,0.15)",
                      color: "#3a2818",
                    }}
                    title={station.streamUrl}
                  >
                    {station.streamUrl}
                  </code>
                  <CopyButton text={station.streamUrl} />
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DataRow({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-baseline gap-3 py-1 border-b border-walnut-700/15 last:border-b-0">
      <span className="font-display uppercase tracking-[0.22em] text-[10px] text-walnut-700 w-20 shrink-0">
        {label}
      </span>
      <span className="text-[13px] text-ink/90 truncate">{value}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* swallow — older browsers / permissions */
        }
      }}
      className="px-2 py-1.5 rounded font-display tracking-[0.18em] uppercase text-[10px] shrink-0"
      style={{
        background:
          "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
        color: "#1a120a",
        boxShadow:
          "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const brassIconStyle: React.CSSProperties = {
  background:
    "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
  boxShadow:
    "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
  color: "#1a120a",
};
