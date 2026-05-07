// Server-only Supabase helpers. Only import from API route handlers — never
// from client components. The service-role key bypasses RLS and must NEVER
// reach the browser bundle.

import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * The single email allowed to read the /admin dashboard. Changing this
 * email also requires updating the gate inside src/app/admin/page.tsx
 * (which checks the same value client-side as a UX hint — the real gate
 * is server-side here).
 *
 * Kept as a constant rather than an env var because rotating it is a
 * once-in-a-lifetime event for this app, and an env var miss in production
 * would silently lock everyone out of the dashboard.
 */
export const ADMIN_EMAIL = "dmf23@dawgranch.org";

let _serviceClient: SupabaseClient | null = null;

/**
 * Returns a service-role Supabase client. Bypasses RLS — every query
 * sees every row regardless of user_id. Use ONLY from /api/admin/* server
 * routes, never client components.
 *
 * Throws if env vars are missing rather than returning null, because every
 * caller needs the client to function (no graceful-degrade story).
 */
export function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    );
  }
  _serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _serviceClient;
}

/**
 * Verifies the caller's `Authorization: Bearer <access_token>` header and
 * returns the resolved user, or null if the token is missing/invalid.
 *
 * The dashboard page passes the current Supabase session's access_token
 * via this header on every fetch. We pass it through to Supabase Auth's
 * getUser endpoint, which validates the JWT signature and expiry, and
 * returns the linked user's email — which we then check against
 * ADMIN_EMAIL inside the route handler.
 *
 * This is the real authorization gate. The client-side email check on the
 * /admin page is just a UX nicety; sneaking past it gets you nothing
 * because every API call still goes through this check.
 */
export async function getUserFromBearer(
  req: NextRequest,
): Promise<{ id: string; email: string | null } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  const sb = getServiceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Convenience: returns true iff the caller's bearer token resolves to the
 * admin user. Used to gate every /api/admin/* route in one line.
 */
export async function isAdminCaller(req: NextRequest): Promise<boolean> {
  const user = await getUserFromBearer(req);
  if (!user) return false;
  return user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
