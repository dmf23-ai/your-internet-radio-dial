"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRadioStore } from "@/lib/store";
import type { Station, StreamType } from "@/data/seed";

/**
 * SearchOverlay — full-screen modal for adding stations to the currently
 * active group, in two modes:
 *
 *  - "search": query /api/stations (radio-browser.info proxy), debounced
 *    300 ms, Add button inserts and marks the row as Added without closing.
 *  - "url":    paste a direct stream URL + a name. Validates the URL,
 *    infers streamType from extension, and inserts with corsOk:false so it
 *    routes through the /api/stream or /api/hls proxy (always works
 *    same-origin, slight latency cost).
 *
 * ESC or backdrop click closes.
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

/**
 * Best-effort stream-type detection from a URL alone. The audio engine
 * tolerates "unknown" by letting the audio element sniff content-type, so
 * we only commit to a specific value when the URL is unambiguous.
 */
function inferStreamTypeFromUrl(rawUrl: string): StreamType {
  const path = rawUrl.toLowerCase().split("?")[0].split("#")[0];
  if (path.endsWith(".m3u8") || path.includes("/hls/")) return "hls";
  if (path.endsWith(".mp3")) return "mp3";
  if (path.endsWith(".aac") || path.endsWith(".aacp")) return "aac";
  if (path.endsWith(".ogg") || path.endsWith(".oga")) return "ogg";
  return "unknown";
}

type AddMode = "search" | "url";

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

  const [mode, setMode] = useState<AddMode>("search");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // URL-mode form state.
  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlJustAdded, setUrlJustAdded] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const urlFieldRef = useRef<HTMLInputElement | null>(null);
  const acRef = useRef<AbortController | null>(null);

  // Reset state when the overlay is opened, and focus the right input.
  useEffect(() => {
    if (!searchOpen) return;
    setMode("search");
    setQuery("");
    setResults([]);
    setError(null);
    setAddedIds(new Set());
    setUrlInput("");
    setNameInput("");
    setUrlError(null);
    setUrlJustAdded(null);
    // Next frame — ensures the input is mounted before we focus it.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [searchOpen]);

  // Refocus when switching modes so the user lands in the right field.
  useEffect(() => {
    if (!searchOpen) return;
    const id = requestAnimationFrame(() => {
      if (mode === "search") inputRef.current?.focus();
      else urlFieldRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [mode, searchOpen]);

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

  function handleAddByUrl(e: React.FormEvent) {
    e.preventDefault();
    setUrlError(null);
    setUrlJustAdded(null);

    const trimmedUrl = urlInput.trim();
    const trimmedName = nameInput.trim();
    if (!trimmedUrl || !trimmedName) {
      setUrlError("Both the stream URL and a station name are required.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmedUrl);
    } catch {
      setUrlError("That doesn't look like a valid URL.");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setUrlError("Stream URL must start with http:// or https://");
      return;
    }

    if (!activeGroupId) {
      setUrlError("No active band — pick one before adding.");
      return;
    }

    // Already in this band (URL match)? Tell the user; don't double-insert.
    if (activeGroupStreamUrls.has(trimmedUrl)) {
      setUrlError("That URL is already in this band.");
      return;
    }

    const newStation: Station = {
      // Stable-ish id; addStationToGroup dedups by streamUrl anyway, so a
      // collision with an existing station in another band reuses that one.
      id: `url-${
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2)
      }`,
      name: trimmedName,
      streamUrl: trimmedUrl,
      streamType: inferStreamTypeFromUrl(trimmedUrl),
      isPreset: false,
      corsOk: false,
    };

    const added = addStationToGroup(newStation, activeGroupId);
    if (added) {
      setUrlJustAdded(trimmedName);
      setUrlInput("");
      setNameInput("");
      // Keep focus in the URL field so the user can paste another.
      requestAnimationFrame(() => urlFieldRef.current?.focus());
    } else {
      setUrlError("That station is already in this band.");
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
              Add a Station
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

          {/* Mode switcher (segmented brass control) */}
          <div className="px-4 pb-1">
            <div
              className="inline-flex rounded-md p-0.5"
              style={{
                background: "linear-gradient(180deg, #120a04 0%, #1a0f08 100%)",
                border: "1px solid rgba(0,0,0,0.65)",
                boxShadow:
                  "inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 1px rgba(255,200,140,0.05)",
              }}
              role="tablist"
              aria-label="How to add a station"
            >
              <ModeTab
                active={mode === "search"}
                onClick={() => setMode("search")}
                label="Search Directory"
              />
              <ModeTab
                active={mode === "url"}
                onClick={() => setMode("url")}
                label="By URL"
              />
            </div>
          </div>

          {mode === "search" ? (
            <>
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
                    Add to{" "}
                    <span className="text-brass-300">{activeGroupName}</span>
                  </span>
                </div>
              </div>

              {/* Results list */}
              <div
                className="mt-2 overflow-y-auto px-2 pb-3"
                style={{ minHeight: 60 }}
              >
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
            </>
          ) : (
            <UrlAddForm
              urlRef={urlFieldRef}
              urlInput={urlInput}
              setUrlInput={setUrlInput}
              nameInput={nameInput}
              setNameInput={setNameInput}
              urlError={urlError}
              urlJustAdded={urlJustAdded}
              activeGroupName={activeGroupName}
              onSubmit={handleAddByUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// --- Mode switcher tab ---

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="font-display uppercase tracking-[0.18em] text-[10.5px] rounded px-3 py-1.5 transition-colors"
      style={
        active
          ? {
              color: "#1a120a",
              background:
                "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
              boxShadow:
                "inset 0 1px 2px rgba(255,240,200,0.6), 0 1px 2px rgba(0,0,0,0.5)",
            }
          : {
              color: "rgba(212,175,116,0.6)",
              background: "transparent",
            }
      }
    >
      {label}
    </button>
  );
}

// --- URL add form ---

function UrlAddForm({
  urlRef,
  urlInput,
  setUrlInput,
  nameInput,
  setNameInput,
  urlError,
  urlJustAdded,
  activeGroupName,
  onSubmit,
}: {
  urlRef: React.RefObject<HTMLInputElement>;
  urlInput: string;
  setUrlInput: (v: string) => void;
  nameInput: string;
  setNameInput: (v: string) => void;
  urlError: string | null;
  urlJustAdded: string | null;
  activeGroupName: string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="px-4 pb-4 pt-2 flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-ivory-soft/70">
        Have a direct link to an Icecast, Shoutcast, or HLS stream? Paste it
        below. Will be added to{" "}
        <span className="text-brass-300">{activeGroupName}</span>.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] tracking-[0.22em] uppercase text-brass-300/70">
          Stream URL
        </span>
        <input
          ref={urlRef}
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://example.com/stream.mp3"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md px-3 py-2 text-sm font-sans bg-walnut-800 border border-walnut-600 text-ivory-dial placeholder:text-ivory-soft/40 focus:outline-none focus:border-brass-500"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] tracking-[0.22em] uppercase text-brass-300/70">
          Station Name
        </span>
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="What should it be called on the dial?"
          autoComplete="off"
          maxLength={80}
          className="w-full rounded-md px-3 py-2 text-sm font-sans bg-walnut-800 border border-walnut-600 text-ivory-dial placeholder:text-ivory-soft/40 focus:outline-none focus:border-brass-500"
        />
      </label>

      <button
        type="submit"
        disabled={!urlInput.trim() || !nameInput.trim()}
        className="self-start font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-3 py-2 transition-transform active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          color: "#1a120a",
          background:
            "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
          border: "1px solid rgba(0,0,0,0.7)",
          boxShadow:
            "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.5)",
        }}
      >
        Add to band
      </button>

      {urlError && (
        <p
          className="text-xs leading-relaxed px-3 py-2 rounded-md"
          style={{
            background: "rgba(80,20,15,0.4)",
            border: "1px solid rgba(180,50,40,0.35)",
            color: "#f4b59a",
          }}
        >
          {urlError}
        </p>
      )}

      {urlJustAdded && (
        <p
          className="text-xs leading-relaxed px-3 py-2 rounded-md"
          style={{
            background: "rgba(35,55,25,0.45)",
            border: "1px solid rgba(140,180,90,0.3)",
            color: "#cfe6a8",
          }}
        >
          Added <span className="text-brass-300">{urlJustAdded}</span>. Paste
          another or close this drawer.
        </p>
      )}
    </form>
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
