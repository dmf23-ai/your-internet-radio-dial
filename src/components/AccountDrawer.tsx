"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRadioStore } from "@/lib/store";
import {
  signInWithEmail,
  signOut,
  upgradeAnonToEmail,
} from "@/lib/supabase/client";

/**
 * AccountDrawer — right-edge panel for auth / account actions.
 *
 * Visual states:
 *   - Anonymous user, "new account" mode → email-upgrade form
 *   - Anonymous user, "sign in" mode     → magic-link sign-in form
 *   - Anonymous user, email submitted    → "check inbox" (copy varies by mode)
 *   - Permanent (email) user             → email + sign-out
 *
 * Reuses StationListDrawer's visual language (dark wood gradient, brass
 * accents, uppercase tracking-wide headings) to blend with the existing
 * drawer family.
 */
type AuthMode = "new" | "existing";

export default function AccountDrawer() {
  const open = useRadioStore((s) => s.ui.accountOpen);
  const setOpen = useRadioStore((s) => s.setAccountOpen);
  const user = useRadioStore((s) => s.user);

  // Local submit state — pending / sent / error.
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<AuthMode>("new");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent"; to: string; mode: AuthMode }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // Reset local state whenever the drawer closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setEmail("");
      setMode("new");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || status.kind === "sending") return;
    setStatus({ kind: "sending" });
    const result =
      mode === "new"
        ? await upgradeAnonToEmail(email)
        : await signInWithEmail(email);
    if (result.ok) {
      setStatus({ kind: "sent", to: email.trim(), mode });
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  }

  function toggleMode() {
    setMode((m) => (m === "new" ? "existing" : "new"));
    // Clear any inline error when switching modes — it likely no longer applies.
    if (status.kind === "error") setStatus({ kind: "idle" });
  }

  async function handleSignOut() {
    await signOut();
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="account-drawer"
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label="Account"
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
                  Account
                </div>
                <div className="font-display uppercase tracking-[0.18em] text-brass-300 text-sm truncate">
                  {user?.isAnonymous === false ? "Signed in" : "Guest"}
                </div>
              </div>
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

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-6 text-brass-300">
              {!user && <PendingState />}

              {user && user.isAnonymous && status.kind !== "sent" && (
                <AnonAuthForm
                  email={email}
                  setEmail={setEmail}
                  mode={mode}
                  onToggleMode={toggleMode}
                  status={status}
                  onSubmit={handleSubmit}
                />
              )}

              {user && user.isAnonymous && status.kind === "sent" && (
                <SentState email={status.to} mode={status.mode} />
              )}

              {user && !user.isAnonymous && (
                <SignedInState
                  email={user.email ?? "(no email on record)"}
                  onSignOut={handleSignOut}
                />
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- subviews ----------

function PendingState() {
  return (
    <p className="text-sm text-brass-300/70 leading-relaxed">
      Connecting to your account…
    </p>
  );
}

function AnonAuthForm({
  email,
  setEmail,
  mode,
  onToggleMode,
  status,
  onSubmit,
}: {
  email: string;
  setEmail: (v: string) => void;
  mode: AuthMode;
  onToggleMode: () => void;
  status:
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent"; to: string; mode: AuthMode }
    | { kind: "error"; message: string };
  onSubmit: (e: React.FormEvent) => void;
}) {
  const busy = status.kind === "sending";
  const isNew = mode === "new";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-brass-300/85">
        {isNew ? (
          <>
            You&apos;re listening as a guest. Your library lives only in this
            browser. Add an email and we&apos;ll send you a confirmation
            link — click it and your library will follow you to any device.
          </>
        ) : (
          <>
            Already signed up on another device? Enter the same email and
            we&apos;ll send a sign-in link. Click it on this device to load
            your synced library.
          </>
        )}
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] tracking-[0.22em] uppercase text-brass-300/70">
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          placeholder="you@example.com"
          className="px-3 py-2 rounded-md font-display tracking-[0.05em] text-brass-300 placeholder:text-brass-300/30 focus:outline-none"
          style={{
            background: "linear-gradient(180deg, #120a04 0%, #1a0f08 100%)",
            border: "1px solid rgba(0,0,0,0.7)",
            boxShadow:
              "inset 0 2px 4px rgba(0,0,0,0.7), inset 0 -1px 1px rgba(255,200,140,0.08)",
          }}
        />
      </label>

      <button
        type="submit"
        disabled={busy || !email.trim()}
        className="font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-3 py-2 transition-transform active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          color: "#1a120a",
          background:
            "radial-gradient(circle at 30% 20%, #f0d9a8 0%, #b48a49 70%, #8a6a32 100%)",
          border: "1px solid rgba(0,0,0,0.7)",
          boxShadow:
            "inset 0 1px 2px rgba(255,240,200,0.6), 0 2px 3px rgba(0,0,0,0.5)",
        }}
      >
        {busy ? "Sending…" : isNew ? "Send confirmation link" : "Send sign-in link"}
      </button>

      {!isNew && (
        <p className="text-xs leading-relaxed text-brass-300/55">
          Signing in will replace this device&apos;s guest library with your
          synced library.
        </p>
      )}

      {status.kind === "error" && (
        <p
          className="text-xs leading-relaxed px-3 py-2 rounded-md"
          style={{
            background: "rgba(80,20,15,0.4)",
            border: "1px solid rgba(180,50,40,0.35)",
            color: "#f4b59a",
          }}
        >
          {status.message}
        </p>
      )}

      {/* Mode toggle */}
      <button
        type="button"
        onClick={onToggleMode}
        disabled={busy}
        className="self-start text-[11px] tracking-[0.05em] text-brass-300/60 hover:text-brass-300 transition-colors disabled:opacity-50"
      >
        {isNew
          ? "Already have an account? Sign in instead →"
          : "← New here? Create an account instead"}
      </button>
    </form>
  );
}

function SentState({ email, mode }: { email: string; mode: AuthMode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-brass-300/85">
        Check your inbox at{" "}
        <span className="text-brass-300 font-display tracking-[0.04em]">
          {email}
        </span>
        .{" "}
        {mode === "new" ? (
          <>
            Click the confirmation link on this device. When you come back,
            your library will be tied to your email and sync to every device
            you sign in from.
          </>
        ) : (
          <>
            Click the sign-in link on this device. Your synced library will
            load automatically when you return.
          </>
        )}
      </p>
      <p className="text-xs leading-relaxed text-brass-300/55">
        No email? Check spam, or close this panel and try a different address.
      </p>
    </div>
  );
}

function SignedInState({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] tracking-[0.22em] uppercase text-brass-300/70">
          Signed in as
        </span>
        <span className="font-display tracking-[0.04em] text-brass-300 text-sm break-all">
          {email}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-brass-300/70">
        Your library is synced to the cloud and will follow you across
        devices. Sign out to use this browser as a guest again.
      </p>

      <button
        type="button"
        onClick={onSignOut}
        className="self-start font-display uppercase tracking-[0.2em] text-[11px] rounded-md px-3 py-2 transition-transform active:translate-y-[1px]"
        style={{
          color: "#e8d6a8",
          background: "linear-gradient(180deg, #2a1810 0%, #120a04 100%)",
          border: "1px solid rgba(0,0,0,0.7)",
          boxShadow:
            "inset 0 1px 1px rgba(255,200,140,0.15), inset 0 -2px 3px rgba(0,0,0,0.6), 0 2px 3px rgba(0,0,0,0.4)",
        }}
      >
        Sign out
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
