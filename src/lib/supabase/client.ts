// Singleton browser Supabase client + anon-session bootstrap.
//
// M4.2 scope: just enough to ensure every visitor has a real auth.uid() so
// later milestones (M4.3 sync) have somewhere to write. No data sync yet.
//
// Design:
//   * Lazy singleton so importing this file from any bundle (including any
//     accidental server-side bundle) is safe — nothing happens until
//     getSupabase() is called from browser code.
//   * Returns null (doesn't throw) when env vars are missing, so the app
//     degrades gracefully to "local-only" mode if Supabase is misconfigured.
//   * Default storage is localStorage — sessions persist across reloads, so
//     a returning visitor keeps the same anon uid they signed in with.
//
// @supabase/supabase-js persists sessions in localStorage by default and
// handles token refresh automatically, so there's no polling to set up.
//
// See SETUP.md for project setup. See schema.sql for RLS policies — every
// read/write the client makes is filtered by auth.uid() = user_id.

import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

/**
 * Returns the singleton browser Supabase client, or null if:
 *   - called server-side (no window), or
 *   - env vars are missing.
 *
 * Call from inside useEffect / event handlers, not at module top-level.
 */
export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not set — cloud sync disabled",
    );
    return null;
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

export interface AppUser {
  id: string;
  isAnonymous: boolean;
  email?: string;
}

/**
 * Ensures there's an active Supabase session. If none exists, signs in
 * anonymously so the user has a real uid for RLS-gated writes.
 *
 * Safe to call multiple times — subsequent calls return the existing session
 * without creating a new anon user. Concurrent callers (e.g. React StrictMode
 * double-invoked effects in dev) share a single in-flight promise so we never
 * create two anon users for one visit.
 *
 * Returns the signed-in user, or null if Supabase is misconfigured or the
 * sign-in failed (network, anonymous sign-ins disabled in dashboard, etc).
 */
let _inFlight: Promise<AppUser | null> | null = null;

export async function ensureAnonSession(): Promise<AppUser | null> {
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    const sb = getSupabase();
    if (!sb) return null;

    const {
      data: { session: existing },
      error: getErr,
    } = await sb.auth.getSession();
    if (getErr) {
      console.warn("[supabase] getSession failed:", getErr.message);
    }
    if (existing?.user) {
      return toAppUser(existing);
    }

    const { data, error } = await sb.auth.signInAnonymously();
    if (error || !data.session) {
      console.error(
        "[supabase] anonymous sign-in failed:",
        error?.message ?? "no session returned",
      );
      return null;
    }
    return toAppUser(data.session);
  })();
  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}

function toAppUser(session: Session): AppUser {
  return userToAppUser(session.user);
}

function userToAppUser(u: User): AppUser {
  return {
    id: u.id,
    // is_anonymous is set to true by Supabase for users created via
    // signInAnonymously(); absent/false for email-signed-in users.
    isAnonymous: Boolean((u as { is_anonymous?: boolean }).is_anonymous),
    email: u.email ?? undefined,
  };
}

// ---------- auth actions (M4.4) ----------

export type UpgradeResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Upgrade the currently signed-in anonymous user to an email-based account.
 *
 * Supabase sends a confirmation email to the provided address. When the user
 * clicks the link, their anonymous user is promoted to a permanent user with
 * this email — the uid is preserved, so all cloud data keyed by user_id
 * transfers automatically with zero merge work.
 *
 * Fails cleanly (returns {ok:false, error}) if:
 *   - no current session (not possible in normal flow, but guarded)
 *   - the email is already associated with another account
 *   - network / server error
 */
export async function upgradeAnonToEmail(email: string): Promise<UpgradeResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "Email required" };

  const { error } = await sb.auth.updateUser({ email: trimmed });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Ends the current session. After sign-out, the user is fully signed-out —
 * the next ensureAnonSession() call will create a brand-new anonymous user
 * with a fresh uid. Their prior data remains in cloud under the old uid but
 * is no longer reachable from this browser.
 */
export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

/**
 * Subscribe to auth state changes. Fires when:
 *   - a new session is established (sign-in, sign-up, anon sign-in)
 *   - the session ends (sign-out)
 *   - the user's record is updated (email confirmation → anon becomes permanent)
 *
 * Returns an unsubscribe function.
 */
export function subscribeToAuthChanges(
  cb: (user: AppUser | null) => void,
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    if (session?.user) cb(userToAppUser(session.user));
    else cb(null);
  });
  return () => data.subscription.unsubscribe();
}
