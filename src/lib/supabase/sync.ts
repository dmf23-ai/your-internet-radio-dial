// Cloud sync layer — write-through mirror of local state to Supabase.
//
// M4.3a scope: local is the source of truth; cloud is a live mirror. Every
// mutation that persists to IndexedDB also pushes the full user payload to
// Supabase. Pull-on-load is deferred to M4.3b.
//
// Strategy: delete-all-then-insert-all per user per sync. Row counts are
// tiny (<100 rows per user even for heavy customizers), so the extra traffic
// is negligible and the correctness story is trivial — whatever is in local
// is what ends up in cloud, no drift possible.
//
// Trade-off: there's a sub-second window mid-sync where the user's cloud is
// empty (between delete and insert). For a single-device anon user this is
// invisible. M4.3b will introduce a Postgres RPC to make sync atomic when
// cross-device reads start mattering.
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

// ---------- camelCase ↔ snake_case mappers ----------

function stationToRow(userId: string, s: Station) {
  return {
    user_id: userId,
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

function groupToRow(userId: string, g: Group) {
  return {
    user_id: userId,
    id: g.id,
    name: g.name,
    position: g.position,
  };
}

function membershipToRow(userId: string, m: Membership) {
  return {
    user_id: userId,
    station_id: m.stationId,
    group_id: m.groupId,
    position: m.position,
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

/**
 * Mirror local state into cloud. Wipes the user's rows and reinserts.
 *
 * Call after every local mutation (the store's schedulePersist already
 * debounces, so this runs at most once per 400ms).
 *
 * Silently no-ops when Supabase isn't configured or userId is missing.
 */
export async function syncToCloud(
  userId: string | null | undefined,
  data: UserData,
): Promise<void> {
  if (!userId) return;
  const sb = getSupabase();
  if (!sb) return;

  try {
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
    const stationRows = data.stations.map((s) => stationToRow(userId, s));
    if (stationRows.length > 0) {
      const { error: insStations } = await sb
        .from("stations")
        .insert(stationRows);
      if (insStations) throw insStations;
    }
    const groupRows = data.groups.map((g) => groupToRow(userId, g));
    if (groupRows.length > 0) {
      const { error: insGroups } = await sb.from("groups").insert(groupRows);
      if (insGroups) throw insGroups;
    }

    // 4. Insert memberships (FK children).
    const membershipRows = data.memberships.map((m) =>
      membershipToRow(userId, m),
    );
    if (membershipRows.length > 0) {
      const { error: insMemberships } = await sb
        .from("memberships")
        .insert(membershipRows);
      if (insMemberships) throw insMemberships;
    }

    // 5. Upsert singleton user_settings.
    const { error: upsSettings } = await sb.from("user_settings").upsert({
      user_id: userId,
      active_group_id: data.activeGroupId,
      current_station_id: data.currentStationId,
      volume: data.volume,
    });
    if (upsSettings) throw upsSettings;
  } catch (err) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? (err as { message?: string }).message
        : String(err);
    console.warn("[sync] syncToCloud failed:", msg);
  }
}

// ---------- pull ----------

/**
 * Fetches the user's full cloud state and returns it as a UserData payload
 * ready to drop into the store.
 *
 * Returns null if:
 *   - Supabase is misconfigured
 *   - the user has no groups (treated as "empty cloud"; same signal as
 *     cloudHasData so the caller can fall through to initial-seed logic)
 *   - a fetch error occurred (already logged)
 *
 * Ordering: stations + groups + memberships + settings fetched sequentially.
 * Total payload is small (<200 rows) so parallelism isn't worth the typing
 * pain around PostgrestFilterBuilder.
 */
export async function pullFromCloud(
  userId: string,
): Promise<UserData | null> {
  const sb = getSupabase();
  if (!sb) return null;

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
    if (!groupRows || groupRows.length === 0) return null;

    const { data: membershipRows, error: mErr } = await sb
      .from("memberships")
      .select("station_id,group_id,position")
      .eq("user_id", userId);
    if (mErr) throw mErr;

    const { data: settingsRow, error: settErr } = await sb
      .from("user_settings")
      .select("active_group_id,current_station_id,volume")
      .eq("user_id", userId)
      .maybeSingle();
    if (settErr) throw settErr;

    const settings: SettingsRow | null = settingsRow ?? null;

    return {
      stations: (stationRows ?? []).map(rowToStation),
      groups: (groupRows ?? []).map(rowToGroup),
      memberships: (membershipRows ?? []).map(rowToMembership),
      activeGroupId: settings?.active_group_id ?? null,
      currentStationId: settings?.current_station_id ?? null,
      volume: typeof settings?.volume === "number" ? settings.volume : 0.7,
      version: CURRENT_VERSION,
    };
  } catch (err) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? (err as { message?: string }).message
        : String(err);
    console.warn("[sync] pullFromCloud failed:", msg);
    return null;
  }
}
