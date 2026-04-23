"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRadioStore } from "@/lib/store";
import type { Station, StreamType } from "@/data/seed";

/**
 * SearchOverlay — full-screen modal for finding stations via /api/stations
 * (radio-browser.info proxy) and adding them to the currently active group.
 *
 * Flow:
 *  - setSearchOpen(true) mounts / un-hides the overlay
 *  - input is debounced (300 ms). Enter triggers immediate search.
 *  - "Add" button inserts the station into the active group and marks the
 *    row as Added without closing the overlay (user can keep searching).
 *  - ESC or backdrop click closes.
 */

type ApiStation = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  codec: string;
  bitrate: number;
  hls: 0 | 1;
  lastcheckok: 0 | 1;
  favicon: string;
  homepage: string;
  country: string;
  countrycode: string;
  tags: string;
};

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

function codecToStreamType(codec: string, hls: 0 | 1): StreamType {
  if (hls) return "hls";
  const c = codec.toUpperCase();
  if (c === "MP3") return "mp3";
  if (c === "AAC" || c === "AAC+" || c === "AACP") return "aac";
  if (c === "OGG" || c === "OGG VORBIS" || c === "VORBIS") return "ogg";
  return "unknown";
}

function apiToStation(s: ApiStation): Station {
  const tags = s.tags
    ? s.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  return {
    id: `rb-${s.stationuuid}`,
    name: s.name || "(untitled)",
    streamUrl: s.url_resolved,
    streamType: codecToStreamType(s.codec, s.hls),
    homepage: s.homepage || undefined,
    logoUrl: s.favicon || undefined,
    country: s.country || undefined,
    bitrate: s.bitrate || undefined,
    tags,
    isPreset: false,
    // Assume user-added stations need proxying. Most non-SomaFM origins don't
    // serve CORS headers, and forcing false routes them through /api/stream
    // or /api/hls — which always works same-origin. Slight overhead, no fuss.
    corsOk: false,
  };
}

export default function SearchOverlay() {
  const searchOpen = useRadioStore((s) => s.ui.searchOpen);
  const setSearchOpen = useRadioStore((s) => s.setSearchOpen);
  const activeGroupId = useRadioStore((s) => s.activeGroupId);
  const activeGroupName = useRadioStore(
    (s) => s.groups.find((g) => g.id === s.activeGroupId)?.name ?? "group",
  );
  const addStationToGroup = useRadioStore((s) => s.addStationToGroup);
  // Stream URLs already in the active group — used to show "Added" for rows
  // that are already members (so re-opening search after adding reflects
  // state). We check URL rather than id because radio-browser uuids ≠ seed ids.
  const activeGroupStreamUrls = useRadioStore(
    useShallow((s) => {
      const ids = new Set(
        s.memberships
          .filter((m) => m.groupId === s.activeGroupId)
          .map((m) => m.stationId),
      );
      return new Set(
        s.stations.filter((st) => ids.has(st.id)).map((st) => st.streamUrl),
      );
    }),
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const inputRef = useRef<HTMLInputElement | null>(null);
  const acRef = useRef<AbortController | null>(null);

  // Reset state when the overlay is opened, and focus the input.
  useEffect(() => {
    if (!searchOpen) return;
    setQuery("");
    setResults([]);
    setError(null);
    setAddedIds(new Set());
    // Next frame — ensures the input is mounted before we focus it.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [searchOpen]);

  // Close on ESC.
  useEffect(() => {
    if (!searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, setSearchOpen]);

  // Debounced search.
  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults([]);
      setError(null);
      setLoading(false);
      // Abort any in-flight request.
      acRef.current?.abort();
      acRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      void runSearch(q);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchOpen]);

  async function runSearch(q: string) {
    // Cancel any prior request so out-of-order responses don't clobber the UI.
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stations?name=${encodeURIComponent(q)}&limit=25`,
        { signal: ac.signal },
      );
      if (!res.ok) {
        setError(`Search failed (${res.status})`);
        setResults([]);
        return;
      }
      const body = (await res.json()) as { results: ApiStation[] };
      setResults(body.results ?? []);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message ?? "Search failed");
      setResults([]);
    } finally {
      if (acRef.current === ac) {
        setLoading(false);
        acRef.current = null;
      }
    }
  }

  function handleAdd(api: ApiStation) {
    if (!activeGroupId) return;
    const station = apiToStation(api);
    const added = addStationToGroup(station, activeGroupId);
    if (added) {
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.add(api.stationuuid);
        return next;
      });
    } else {
      // Already a member — still mark as added so the UI reflects state.
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.add(api.stationuuid);
        return next;
      });
    }
  }

  const statusLine = useMemo(() => {
    const q = query.trim();
    if (q.length === 0) return "Type a station name to search";
    if (q.length < MIN_QUERY) return "Keep typing…";
    if (loading) return "Searching…";
    if (error) return error;
    if (results.length === 0) return "No matches";
    return `${results.length} station${results.length === 1 ? "" : "s"} found`;
  }, [query, loading, error, results]);

  if (!searchOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Find a station"
      onClick={() => setSearchOpen(false)}
    >
      <div className="absolute inset-0 bg-black/75" aria-hidden />

      <div
        className="relative w-full max-w-[560px] mt-6 rounded-[18px] p-3 surface-brass shadow-brass-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="rounded-[12px] bg-walnut-900/90 text-ivory-soft flex flex-col"
          style={{ maxHeight: "78vh" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="font-display uppercase tracking-[0.22em] text-sm text-brass-300">
              Find a Station
            </h2>
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px]"
              style={{
                background:
                  "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
                boxShadow:
                  "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
                color: "#1a120a",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Input */}
          <div className="px-4">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. KEXP, jazz, Radio Paradise"
              className="w-full rounded-md px-3 py-2 text-sm font-sans bg-walnut-800 border border-walnut-600 text-ivory-dial placeholder:text-ivory-soft/40 focus:outline-none focus:border-brass-500"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="mt-2 text-xs tracking-[0.1em] uppercase text-brass-300/80">
              {statusLine}
              <span className="ml-2 text-ivory-soft/50 normal-case tracking-normal">
                Add to <span className="text-brass-300">{activeGroupName}</span>
              </span>
            </div>
          </div>

          {/* Results list */}
          <div className="mt-2 overflow-y-auto px-2 pb-3" style={{ minHeight: 60 }}>
            {results.map((r) => {
              const added =
                addedIds.has(r.stationuuid) ||
                activeGroupStreamUrls.has(r.url_resolved);
              return (
                <ResultRow
                  key={r.stationuuid}
                  s={r}
                  added={added}
                  onAdd={() => handleAdd(r)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Result row ---

function ResultRow({
  s,
  added,
  onAdd,
}: {
  s: ApiStation;
  added: boolean;
  onAdd: () => void;
}) {
  const [iconOk, setIconOk] = useState(!!s.favicon);
  const subtitle = [
    s.country,
    s.bitrate ? `${s.bitrate} kbps` : null,
    s.codec ? s.codec : null,
    s.hls ? "HLS" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-walnut-800/60">
      <div
        className="shrink-0 w-9 h-9 rounded-md overflow-hidden flex items-center justify-center bg-walnut-800 border border-walnut-700"
        aria-hidden
      >
        {iconOk && s.favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.favicon}
            alt=""
            width={36}
            height={36}
            className="w-full h-full object-cover"
            onError={() => setIconOk(false)}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="font-display text-brass-300/70 text-xs">
            {(s.name || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-ivory-dial truncate">{s.name}</div>
        <div className="text-[11px] text-ivory-soft/60 truncate">
          {subtitle || "—"}
        </div>
      </div>

      <button
        type="button"
        onClick={onAdd}
        disabled={added}
        className="shrink-0 font-display uppercase tracking-[0.18em] text-[11px] rounded-md px-3 py-1.5 transition-transform active:translate-y-[1px] disabled:opacity-50 disabled:cursor-default disabled:active:translate-y-0"
        style={{
          color: "#1a120a",
          background: added
            ? "linear-gradient(180deg, #4d3220 0%, #2a1810 100%)"
            : "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
          border: "1px solid rgba(0,0,0,0.7)",
          boxShadow: added
            ? "inset 0 1px 2px rgba(0,0,0,0.6)"
            : "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.5)",
          minWidth: 64,
        }}
      >
        {added ? "Added" : "Add"}
      </button>
    </div>
  );
}
