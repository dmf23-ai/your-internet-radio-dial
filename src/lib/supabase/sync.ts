// Cloud sync layer — write-through mirror of local state to Supabase.
//
// Local is the source of truth; cloud is a live mirror. Every mutation that
// persists to IndexedDB also pushes the full user payload to Supabase (the
// store holds that push back until StoreHydrator's startup cloud step has
// settled, so a sync never races the startup pull).
//
// Strategy: replace-all per user per sync. Row counts are tiny (<100 rows per
// user even for heavy customizers), so resending everything is negligible
// and the correctness story is trivial — whatever is in local is what ends up
// in cloud, no drift possible.
//
// Atomicity: the primary path is one call to the replace_user_library
// Postgres function (supabase/schema.sql). It swaps the user's stations,
// groups and memberships and upserts user_settings in a single transaction,
// so a reader never sees a half-written library. If the function isn't
// deployed (PostgREST answers PGRST202), we fall back to the original
// delete-all-then-insert-all sequence, which leaves a sub-second window where
// the user's cloud library is empty.
//
// Concurrency: one sync in flight at a time. Calls made while one is running
// coalesce into a single follow-up sync of the latest payload, so the store's
// 400ms debounce (shorter than a sync) can't stack overlapping syncs — those
// collided with 409 duplicate-key errors and left stale or partial data.
//
// All functions catch + log rather than throw — a cloud hiccup should never
// break the local app loop.

import type {
  Station,
  Group,
  Membership,
  StreamType,
} from "@/data/seed";
import type { UserData } from "@/lib/storage";
import { CURRENT_VERSION } from "@/lib/storage";
import { getSupabase } from "@/lib/supabase/client";

type SupabaseClient = NonNullable<ReturnType<typeof getSupabase>>;

// ---------- camelCase ↔ snake_case mappers ----------
// Rows carry no user_id: replace_user_library writes auth.uid(), and the
// multi-step fallback adds user_id itself.

function stationToRow(s: Station) {
  return {
    id: s.id,
    name: s.name,
    stream_url: s.streamUrl,
    stream_type: s.streamType,
    homepage: s.homepage ?? null,
    logo_url: s.logoUrl ?? null,
    country: s.country ?? null,
    language: s.language ?? null,
    bitrate: s.bitrate ?? null,
    tags: s.tags ?? null,
    is_preset: s.isPreset,
    cors_ok: s.corsOk ?? null,
  };
}

function groupToRow(g: Group) {
  return {
    id: g.id,
    name: g.name,
    position: g.position,
  };
}

function membershipToRow(m: Membership) {
  return {
    station_id: m.stationId,
    group_id: m.groupId,
    position: m.position,
  };
}

function settingsToRow(data: UserData) {
  return {
    active_group_id: data.activeGroupId,
    current_station_id: data.currentStationId,
    volume: data.volume,
  };
}

// ---------- snake_case → camelCase mappers (pull path) ----------

interface StationRow {
  id: string;
  name: string;
  stream_url: string;
  stream_type: string;
  homepage: string | null;
  logo_url: string | null;
  country: string | null;
  language: string | null;
  bitrate: number | null;
  tags: string[] | null;
  is_preset: boolean;
  cors_ok: boolean | null;
}

interface GroupRow {
  id: string;
  name: string;
  position: number;
}

interface MembershipRow {
  station_id: string;
  group_id: string;
  position: number;
}

interface SettingsRow {
  active_group_id: string | null;
  current_station_id: string | null;
  volume: number;
}

function rowToStation(r: StationRow): Station {
  return {
    id: r.id,
    name: r.name,
    streamUrl: r.stream_url,
    streamType: r.stream_type as StreamType,
    homepage: r.homepage ?? undefined,
    logoUrl: r.logo_url ?? undefined,
    country: r.country ?? undefined,
    language: r.language ?? undefined,
    bitrate: r.bitrate ?? undefined,
    tags: r.tags ?? undefined,
    isPreset: r.is_preset,
    corsOk: r.cors_ok ?? undefined,
  };
}

function rowToGroup(r: GroupRow): Group {
  return { id: r.id, name: r.name, position: r.position };
}

function rowToMembership(r: MembershipRow): Membership {
  return {
    stationId: r.station_id,
    groupId: r.group_id,
    position: r.position,
  };
}

// ---------- library sanitizing ----------

type Library = Pick<UserData, "stations" | "groups" | "memberships">;

/**
 * Drops duplicate ids and memberships that point at a missing station or
 * band. Applied to every payload before it's written (one bad row would
 * otherwise fail the primary/foreign keys of every future sync) and to every
 * pull (four separate SELECTs can straddle another tab's sync, pairing
 * memberships from one version of the library with stations from another).
 */
function sanitizeLibrary(lib: Library): Library {
  const stationIds = new Set<string>();
  const stations: Station[] = [];
  for (const s of lib.stations) {
    if (stationIds.has(s.id)) continue;
    stationIds.add(s.id);
    stations.push(s);
  }
  const groupIds = new Set<string>();
  const groups: Group[] = [];
  for (const g of lib.groups) {
    if (groupIds.has(g.id)) continue;
    groupIds.add(g.id);
    groups.push(g);
  }
  const memberKeys = new Set<string>();
  const memberships: Membership[] = [];
  for (const m of lib.memberships) {
    const key = `${m.stationId}\u0000${m.groupId}`;
    if (memberKeys.has(key)) continue;
    if (!stationIds.has(m.stationId) || !groupIds.has(m.groupId)) continue;
    memberKeys.add(key);
    memberships.push(m);
  }
  return { stations, groups, memberships };
}

function errorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err
    ? String((err as { message?: string }).message)
    : String(err);
}

// ---------- cloud probe ----------

/**
 * Returns true if the user has any existing rows in cloud. Used to decide
 * whether the initial post-login sync should push local → cloud.
 *
 * Checks `groups` since every user who has ever synced has ≥1 group (the
 * schema allows zero, but the store invariant forbids deleting the last
 * group, so a synced user always has at least one).
 */
export async function cloudHasData(userId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { count, error } = await sb
    .from("groups")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) {
    console.warn("[sync] cloudHasData probe failed:", error.message);
    return false;
  }
  return (count ?? 0) > 0;
}

// ---------- write-through sync ----------

interface SyncJob {
  userId: string;
  data: UserData;
}

// The newest payload waiting for the in-flight sync to finish, plus the
// callers waiting on it. A newer call replaces the queued payload; its
// callers then wait for the newer payload, which supersedes theirs.
let queued: SyncJob | null = null;
let queuedWaiters: Array<() => void> = [];
let draining = false;
let idle: Promise<void> = Promise.resolve();

// Set once the database answers PGRST202 (replace_user_library isn't
// deployed). Later syncs in this page session go straight to the fallback.
let rpcMissing = false;

/**
 * Mirror local state into cloud: replaces the user's library rows and
 * upserts their settings.
 *
 * The returned promise resolves once this payload, or a newer one that
 * replaced it while it was queued, has been written (or the write failed —
 * failures are logged, never thrown).
 *
 * Silently no-ops when Supabase isn't configured or userId is missing.
 */
export function syncToCloud(
  userId: string | null | undefined,
  data: UserData,
): Promise<void> {
  if (!userId) return Promise.resolve();
  if (!getSupabase()) return Promise.resolve();
  queued = { userId, data };
  const done = new Promise<void>((resolve) => queuedWaiters.push(resolve));
  if (!draining) idle = drain();
  return done;
}

/** Resolves once no sync is running or queued. */
export function cloudSyncIdle(): Promise<void> {
  return idle;
}

async function drain(): Promise<void> {
  draining = true;
  try {
    while (queued) {
      const job = queued;
      const waiters = queuedWaiters;
      queued = null;
      queuedWaiters = [];
      await writeLibrary(job.userId, job.data);
      for (const resolve of waiters) resolve();
    }
  } finally {
    draining = false;
  }
}

async function writeLibrary(userId: string, data: UserData): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const lib = sanitizeLibrary(data);
  try {
    if (!rpcMissing) {
      // SECURITY INVOKER + auth.uid(): RLS still applies inside the function.
      // p_user_id must match the session's uid, so a payload built for one
      // account can't land in another if the session switched mid-queue.
      const { error } = await sb.rpc("replace_user_library", {
        p_user_id: userId,
        p_stations: lib.stations.map(stationToRow),
        p_groups: lib.groups.map(groupToRow),
        p_memberships: lib.memberships.map(membershipToRow),
        p_settings: settingsToRow(data),
      });
      if (!error) return;
      // Only a missing function falls back. Any other error rolled the whole
      // transaction back, so the cloud still holds the previous library —
      // retrying the non-atomic path could only make that worse.
      if (error.code !== "PGRST202") throw error;
      rpcMissing = true;
      console.warn(
        "[sync] replace_user_library is not deployed; using the multi-step sync",
      );
    }
    await writeLibraryInSteps(sb, userId, lib, data);
  } catch (err) {
    console.warn("[sync] syncToCloud failed:", errorMessage(err));
  }
}

/** Pre-RPC fallback: wipe the user's rows, then reinsert everything. */
async function writeLibraryInSteps(
  sb: SupabaseClient,
  userId: string,
  lib: Library,
  data: UserData,
): Promise<void> {
  // 1. Wipe memberships first (they FK to stations + groups, so they must
  //    go before we delete the parents). A bare `.delete()` is rejected by
  //    Supabase for safety; we scope by user_id explicitly, which RLS also
  //    enforces.
  const { error: delMemberships } = await sb
    .from("memberships")
    .delete()
    .eq("user_id", userId);
  if (delMemberships) throw delMemberships;

  // 2. Wipe stations and groups (no FKs between them, order doesn't matter).
  const { error: delStations } = await sb
    .from("stations")
    .delete()
    .eq("user_id", userId);
  if (delStations) throw delStations;
  const { error: delGroups } = await sb
    .from("groups")
    .delete()
    .eq("user_id", userId);
  if (delGroups) throw delGroups;

  // 3. Insert parents (stations + groups) — must precede memberships for FKs.
  const stationRows = lib.stations.map((s) => ({
    user_id: userId,
    ...stationToRow(s),
  }));
  if (stationRows.length > 0) {
    const { error: insStations } = await sb
      .from("stations")
      .insert(stationRows);
    if (insStations) throw insStations;
  }
  const groupRows = lib.groups.map((g) => ({
    user_id: userId,
    ...groupToRow(g),
  }));
  if (groupRows.length > 0) {
    const { error: insGroups } = await sb.from("groups").insert(groupRows);
    if (insGroups) throw insGroups;
  }

  // 4. Insert memberships (FK children).
  const membershipRows = lib.memberships.map((m) => ({
    user_id: userId,
    ...membershipToRow(m),
  }));
  if (membershipRows.length > 0) {
    const { error: insMemberships } = await sb
      .from("memberships")
      .insert(membershipRows);
    if (insMemberships) throw insMemberships;
  }

  // 5. Upsert singleton user_settings.
  const { error: upsSettings } = await sb
    .from("user_settings")
    .upsert({ user_id: userId, ...settingsToRow(data) });
  if (upsSettings) throw upsSettings;
}

// ---------- pull ----------

export type PullResult =
  // The user's library, ready to drop into the store.
  | { status: "ok"; data: UserData }
  // No groups in cloud: a new user (or one whose rows are gone). The caller
  // seeds the cloud from local.
  | { status: "empty" }
  // Supabase misconfigured or a fetch failed (already logged). The caller
  // keeps the local library and must not treat the cloud as empty, or it
  // would overwrite a library it merely failed to read.
  | { status: "error" };

// A sync this tab started before the pull (e.g. the previous account's,
// across a sign-in) gets this long to finish before the pull reads anyway.
const PULL_SYNC_WAIT_MS = 5000;

/**
 * Fetches the user's full cloud state.
 *
 * Ordering: stations + groups + memberships + settings fetched sequentially.
 * Total payload is small (<200 rows) so parallelism isn't worth the typing
 * pain around PostgrestFilterBuilder.
 */
export async function pullFromCloud(userId: string): Promise<PullResult> {
  const sb = getSupabase();
  if (!sb) return { status: "error" };

  // Never read while this tab is mid-write.
  await Promise.race([
    cloudSyncIdle(),
    new Promise((resolve) => setTimeout(resolve, PULL_SYNC_WAIT_MS)),
  ]);

  try {
    const { data: stationRows, error: sErr } = await sb
      .from("stations")
      .select(
        "id,name,stream_url,stream_type,homepage,logo_url,country,language,bitrate,tags,is_preset,cors_ok",
      )
      .eq("user_id", userId);
    if (sErr) throw sErr;

    const { data: groupRows, error: gErr } = await sb
      .from("groups")
      .select("id,name,position")
      .eq("user_id", userId);
    if (gErr) throw gErr;

    // No groups → treat as empty cloud (same as cloudHasData). Lets the caller
    // fall through to the seed-push branch without a second probe.
    if (!groupRows || groupRows.length === 0) return { status: "empty" };

    const { data: membershipRows, error: mErr } = await sb
      .from("memberships")
      .select("station_id,group_id,position")
      .eq("user_id", userId);
    if (mErr) throw mErr;

    // select("*") rather than a column list: a column this client doesn't
    // know yet (or one the database doesn't have yet) can't fail the pull.
    const { data: settingsRow, error: settErr } = await sb
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (settErr) throw settErr;

    const settings: SettingsRow | null = settingsRow ?? null;
    const lib = sanitizeLibrary({
      stations: (stationRows ?? []).map(rowToStation),
      groups: (groupRows ?? []).map(rowToGroup),
      memberships: (membershipRows ?? []).map(rowToMembership),
    });

    return {
      status: "ok",
      data: {
        ...lib,
        activeGroupId: settings?.active_group_id ?? null,
        currentStationId: settings?.current_station_id ?? null,
        volume: typeof settings?.volume === "number" ? settings.volume : 0.7,
        version: CURRENT_VERSION,
      },
    };
  } catch (err) {
    console.warn("[sync] pullFromCloud failed:", errorMessage(err));
    return { status: "error" };
  }
}
