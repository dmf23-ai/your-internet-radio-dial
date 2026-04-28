"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRadioStore } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";

/**
 * SuggestionBoxOverlay — write-only feedback inbox.
 *
 * Two tabs:
 *   - "Suggest a Station" → submit a station for inclusion in the default
 *     library (name, stream URL, optional notes). The brass magnifying-glass
 *     button beside the name field opens an inline directory search (same
 *     /api/stations endpoint as Add-a-Station); selecting a result
 *     auto-populates name, URL, and a metadata blurb in the notes field.
 *   - "Other" → free-text suggestion / bug report / love letter / etc.
 *
 * In both modes the user may optionally provide a contact email for
 * follow-up. Submissions land in the `suggestions` Supabase table; RLS
 * permits insert-only by anon/authed users and read-only by the service
 * role (i.e. David from the Supabase dashboard).
 *
 * Visual family matches AboutOverlay — centered modal card on dark wood
 * with brass accents, ivory body card. The form fields use the same
 * dark-recessed input style as AccountDrawer for consistency.
 */
type Tab = "station" | "other";

type SubmitStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

// Shape of a row from /api/stations (radio-browser.info proxy). Duplicated
// from SearchOverlay rather than imported so the two overlays stay
// self-contained.
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

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_QUERY = 2;

export default function SuggestionBoxOverlay() {
  const open = useRadioStore((s) => s.ui.suggestionBoxOpen);
  const setOpen = useRadioStore((s) => s.setSuggestionBoxOpen);
  const user = useRadioStore((s) => s.user);

  const [tab, setTab] = useState<Tab>("station");
  // shared
  const [contactEmail, setContactEmail] = useState("");
  // station fields
  const [stationName, setStationName] = useState("");
  const [stationUrl, setStationUrl] = useState("");
  const [stationNotes, setStationNotes] = useState("");
  // other field
  const [message, setMessage] = useState("");

  const [status, setStatus] = useState<SubmitStatus>({ kind: "idle" });

  // --- station-search subview state ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ApiStation[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Reset everything when the overlay closes so reopening is fresh.
  useEffect(() => {
    if (!open) {
      setTab("station");
      setContactEmail("");
      setStationName("");
      setStationUrl("");
      setStationNotes("");
      setMessage("");
      setStatus({ kind: "idle" });
      setSearchOpen(false);
      setSearchQuery("");
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    }
  }, [open]);

  // Focus the search input when the search subview opens.
  useEffect(() => {
    if (!searchOpen) return;
    const id = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [searchOpen]);

  // ESC closes — but if the search subview is open, ESC backs out of it
  // first instead of closing the whole overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
      } else {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, searchOpen, setOpen]);

  // Debounced directory search (only active when the search subview is open).
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < SEARCH_MIN_QUERY) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      void runDirectorySearch(q);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchOpen]);

  async function runDirectorySearch(q: string) {
    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/stations?name=${encodeURIComponent(q)}&limit=25`,
        { signal: ac.signal },
      );
      if (!res.ok) {
        setSearchError(`Search failed (${res.status})`);
        setSearchResults([]);
        return;
      }
      const body = (await res.json()) as { results: ApiStation[] };
      setSearchResults(body.results ?? []);
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") return;
      setSearchError(err?.message ?? "Search failed");
      setSearchResults([]);
    } finally {
      if (searchAbortRef.current === ac) {
        setSearchLoading(false);
        searchAbortRef.current = null;
      }
    }
  }

  // Result selected from the directory: spray its metadata into the form
  // fields and return to the form view. The notes field gets a "country ·
  // codec · bitrate · tags · homepage" blurb the user can edit further.
  function handleSelectFromDirectory(s: ApiStation) {
    setStationName(s.name || "");
    setStationUrl(s.url_resolved || "");
    const noteParts: string[] = [];
    if (s.country) noteParts.push(s.country);
    if (s.bitrate) noteParts.push(`${s.bitrate} kbps`);
    if (s.codec) noteParts.push(s.codec);
    if (s.hls) noteParts.push("HLS");
    if (s.tags) {
      const tagsTrim = s.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
      if (tagsTrim) noteParts.push(`Tags: ${tagsTrim}`);
    }
    if (s.homepage) noteParts.push(s.homepage);
    setStationNotes(noteParts.join(" · "));
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  }

  const canSubmit =
    status.kind !== "sending" &&
    !searchOpen &&
    (tab === "station"
      ? stationName.trim().length > 0 && stationUrl.trim().length > 0
      : message.trim().length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus({ kind: "sending" });

    const sb = getSupabase();
    if (!sb) {
      setStatus({
        kind: "error",
        message:
          "We can't reach the workshop just now. Please try again in a moment.",
      });
      return;
    }

    const row =
      tab === "station"
        ? {
            user_id: user?.id ?? null,
            kind: "station" as const,
            station_name: stationName.trim(),
            station_url: stationUrl.trim(),
            station_notes: stationNotes.trim() || null,
            message: null,
            contact_email: contactEmail.trim() || null,
            user_agent:
              typeof navigator !== "undefined"
                ? navigator.userAgent.slice(0, 300)
                : null,
          }
        : {
            user_id: user?.id ?? null,
            kind: "other" as const,
            station_name: null,
            station_url: null,
            station_notes: null,
            message: message.trim(),
            contact_email: contactEmail.trim() || null,
            user_agent:
              typeof navigator !== "undefined"
                ? navigator.userAgent.slice(0, 300)
                : null,
          };

    const { error } = await sb.from("suggestions").insert(row);
    if (error) {
      setStatus({
        kind: "error",
        message:
          error.message ||
          "Something went amiss. Please try again in a moment.",
      });
      return;
    }
    setStatus({ kind: "sent" });
  }

  const searchStatusLine = (() => {
    const q = searchQuery.trim();
    if (q.length === 0) return "Type a station name to search the directory";
    if (q.length < SEARCH_MIN_QUERY) return "Keep typing…";
    if (searchLoading) return "Searching…";
    if (searchError) return searchError;
    if (searchResults.length === 0) return "No matches";
    return `${searchResults.length} station${searchResults.length === 1 ? "" : "s"} found`;
  })();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="suggestion-box-overlay"
          className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Suggestion Box"
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
            className="relative w-full max-w-[560px] max-h-[85vh] rounded-[18px] flex flex-col overflow-hidden"
            style={{
              background:
                "linear-gradient(180deg, #2a1810 0%, #1a0f08 100%)",
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
                Suggestion Box
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
              className="flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7"
              style={{
                background:
                  "radial-gradient(ellipse at top, #f3e5c4 0%, #e8d6a8 100%)",
              }}
            >
              {status.kind === "sent" ? (
                <SentState onClose={() => setOpen(false)} />
              ) : searchOpen ? (
                <StationSearchPanel
                  inputRef={searchInputRef}
                  query={searchQuery}
                  setQuery={setSearchQuery}
                  results={searchResults}
                  statusLine={searchStatusLine}
                  onSelect={handleSelectFromDirectory}
                  onCancel={() => {
                    setSearchOpen(false);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                />
              ) : (
                <>
                  <p className="text-[13px] sm:text-sm leading-relaxed text-ink/90 mb-5">
                    Drop a card in the box. We read them all — station
                    nominations for the default library, fixes, feature
                    wishes, kind words.
                  </p>

                  {/* Tab switcher — brass segmented control */}
                  <div className="flex gap-1 mb-5">
                    <TabButton
                      active={tab === "station"}
                      onClick={() => setTab("station")}
                    >
                      Suggest a Station
                    </TabButton>
                    <TabButton
                      active={tab === "other"}
                      onClick={() => setTab("other")}
                    >
                      Other Suggestion
                    </TabButton>
                  </div>

                  <form
                    onSubmit={handleSubmit}
                    className="flex flex-col gap-4"
                  >
                    {tab === "station" ? (
                      <>
                        <Field label="Station Name">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              required
                              value={stationName}
                              onChange={(e) => setStationName(e.target.value)}
                              placeholder="e.g. WFMT Chicago"
                              className={inputClass + " flex-1 min-w-0"}
                              style={inputStyle}
                            />
                            <button
                              type="button"
                              onClick={() => setSearchOpen(true)}
                              aria-label="Search the station directory"
                              title="Search the station directory"
                              className="shrink-0 w-10 rounded-md flex items-center justify-center transition-transform active:translate-y-[1px]"
                              style={brassIconStyle}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 14 14"
                                fill="none"
                                aria-hidden
                              >
                                <circle
                                  cx="6"
                                  cy="6"
                                  r="4"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                />
                                <line
                                  x1="9.2"
                                  y1="9.2"
                                  x2="12"
                                  y2="12"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                          </div>
                        </Field>

                        <Field label="Stream URL">
                          <input
                            type="url"
                            required
                            value={stationUrl}
                            onChange={(e) => setStationUrl(e.target.value)}
                            placeholder="https://example.com/stream.mp3"
                            className={inputClass}
                            style={inputStyle}
                          />
                        </Field>

                        <Field label="Notes (optional)">
                          <textarea
                            rows={3}
                            value={stationNotes}
                            onChange={(e) => setStationNotes(e.target.value)}
                            placeholder="Why this one? Genre, region, anything noteworthy."
                            className={inputClass + " resize-none"}
                            style={inputStyle}
                          />
                        </Field>
                      </>
                    ) : (
                      <Field label="Your Suggestion">
                        <textarea
                          required
                          rows={6}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          placeholder="A bug, a feature wish, a kind word. Anything."
                          className={inputClass + " resize-none"}
                          style={inputStyle}
                        />
                      </Field>
                    )}

                    <Field label="Contact Email (optional)">
                      <input
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="In case we'd like to follow up."
                        className={inputClass}
                        style={inputStyle}
                      />
                    </Field>

                    {status.kind === "error" && (
                      <p
                        className="text-xs leading-relaxed px-3 py-2 rounded-md"
                        style={{
                          background: "rgba(120,30,20,0.15)",
                          border: "1px solid rgba(180,50,40,0.4)",
                          color: "#7a1a0f",
                        }}
                      >
                        {status.message}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="font-display uppercase tracking-[0.2em] text-[11px] px-3 py-2 rounded-md text-walnut-700 hover:text-walnut-900 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!canSubmit}
                        className="font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-4 py-2 transition-transform active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          color: "#1a120a",
                          background:
                            "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
                          border: "1px solid rgba(0,0,0,0.5)",
                          boxShadow:
                            "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.35)",
                        }}
                      >
                        {status.kind === "sending" ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- subviews ----------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 font-display uppercase tracking-[0.2em] text-[10px] sm:text-[11px] rounded-md px-2 py-2 transition-transform active:translate-y-[1px]"
      style={{
        color: active ? "#1a120a" : "#5a3f1a",
        background: active
          ? "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)"
          : "linear-gradient(180deg, rgba(90,63,26,0.12) 0%, rgba(90,63,26,0.05) 100%)",
        border: "1px solid rgba(90,63,26,0.35)",
        boxShadow: active
          ? "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.25)"
          : "inset 0 1px 1px rgba(255,255,255,0.25)",
      }}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-[0.22em] uppercase text-walnut-700">
        {label}
      </span>
      {children}
    </label>
  );
}

// Inline directory-search subview shown when the user clicks the
// magnifying-glass button next to the Station Name field. Cream/ink palette
// to match the suggestion box body, and result rows that read on the same
// background.
function StationSearchPanel({
  inputRef,
  query,
  setQuery,
  results,
  statusLine,
  onSelect,
  onCancel,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  query: string;
  setQuery: (v: string) => void;
  results: ApiStation[];
  statusLine: string;
  onSelect: (s: ApiStation) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display uppercase tracking-[0.22em] text-[11px] sm:text-xs text-walnut-700">
          Search the Directory
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="font-display uppercase tracking-[0.2em] text-[10px] sm:text-[11px] px-2 py-1 rounded-md text-walnut-700 hover:text-walnut-900 transition-colors"
        >
          ← Back
        </button>
      </div>

      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. KEXP, jazz, Radio Paradise"
        className={inputClass}
        style={inputStyle}
        autoComplete="off"
        spellCheck={false}
      />

      <div className="text-[10px] tracking-[0.18em] uppercase text-walnut-700/80">
        {statusLine}
      </div>

      <div className="flex flex-col gap-1 max-h-[48vh] overflow-y-auto -mx-1 px-1">
        {results.map((r) => (
          <SuggestResultRow
            key={r.stationuuid}
            s={r}
            onSelect={() => onSelect(r)}
          />
        ))}
      </div>
    </div>
  );
}

// One row of search results, styled for the ivory body. Whole row is
// clickable; "Use" button on the right gives a clear affordance.
function SuggestResultRow({
  s,
  onSelect,
}: {
  s: ApiStation;
  onSelect: () => void;
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
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-walnut-700/10 active:bg-walnut-700/15"
    >
      <div
        className="shrink-0 w-9 h-9 rounded-md overflow-hidden flex items-center justify-center"
        aria-hidden
        style={{
          background: "rgba(90,63,26,0.12)",
          border: "1px solid rgba(90,63,26,0.25)",
        }}
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
          <span className="font-display text-walnut-700/70 text-xs">
            {(s.name || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink truncate">{s.name}</div>
        <div className="text-[11px] text-walnut-700/70 truncate">
          {subtitle || "—"}
        </div>
      </div>

      <span
        className="shrink-0 font-display uppercase tracking-[0.18em] text-[10px] sm:text-[11px] rounded-md px-3 py-1.5"
        style={{
          color: "#1a120a",
          background:
            "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
          border: "1px solid rgba(0,0,0,0.5)",
          boxShadow:
            "inset 0 1px 2px rgba(255,240,200,0.6), 0 1px 2px rgba(0,0,0,0.3)",
        }}
      >
        Use
      </span>
    </button>
  );
}

function SentState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-4 items-start">
      <h3 className="font-display uppercase tracking-[0.22em] text-[12px] sm:text-sm text-walnut-700">
        Card in the Box
      </h3>
      <p className="text-[13px] sm:text-sm leading-relaxed text-ink/90">
        Thank you. Your suggestion has reached the workshop. We read every
        one, though we cannot promise a reply to each.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-4 py-2 transition-transform active:translate-y-[1px]"
        style={{
          color: "#1a120a",
          background:
            "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
          border: "1px solid rgba(0,0,0,0.5)",
          boxShadow:
            "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.35)",
        }}
      >
        Close
      </button>
    </div>
  );
}

const inputClass =
  "px-3 py-2 rounded-md font-display tracking-[0.03em] text-ink placeholder:text-walnut-700/40 focus:outline-none focus:ring-2 focus:ring-amber-700/30";

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.55)",
  border: "1px solid rgba(90,63,26,0.35)",
  boxShadow:
    "inset 0 1px 2px rgba(90,63,26,0.18), inset 0 -1px 1px rgba(255,255,255,0.4)",
};

const brassIconStyle: React.CSSProperties = {
  background:
    "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
  boxShadow:
    "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
  color: "#1a120a",
};
