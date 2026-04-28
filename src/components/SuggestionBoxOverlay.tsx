"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRadioStore } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";

/**
 * SuggestionBoxOverlay — write-only feedback inbox.
 *
 * Two tabs:
 *   - "Suggest a Station" → submit a station for inclusion in the default
 *     library (name, stream URL, optional notes).
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
    }
  }, [open]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const canSubmit =
    status.kind !== "sending" &&
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
                          <input
                            type="text"
                            required
                            value={stationName}
                            onChange={(e) => setStationName(e.target.value)}
                            placeholder="e.g. WFMT Chicago"
                            className={inputClass}
                            style={inputStyle}
                          />
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
