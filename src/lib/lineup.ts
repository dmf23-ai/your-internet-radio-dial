// Default-lineup reconciliation. Pure functions over a library; the store
// wires them up (reconcileLineup at startup, addNewDefaultStations for the
// search overlay's button).
//
// Every library carries two markers:
//   seedVersion  — the default-lineup version it reflects (CURRENT_VERSION
//                  when it was seeded or last brought up to date).
//   customizedAt — when the user last edited it (stations added, removed or
//                  reordered; bands created, renamed, deleted or reordered).
//                  null = never customized.
// Users who never customized are moved onto each new lineup automatically.
// Customizers keep their library and are offered the default stations added
// after their seedVersion that they don't already have.
//
// Why a version and not a time: "stations added since the user last saved a
// customization" would hide every station added before an edit the user
// made later without ever having seen them. seedVersion only moves when the
// user actually receives a lineup (seeding, auto-update, the button).

import {
  seedStations,
  seedGroups,
  seedMemberships,
  seedDefaults,
  type Station,
  type Group,
  type Membership,
} from "@/data/seed";
import {
  LEGACY_MAX_VERSION,
  LINEUP_FLOOR,
  PAST_LINEUP_FINGERPRINTS,
  bandAddedIn,
  lineupFingerprint,
  normalizeStreamUrl,
  stationAddedIn,
} from "@/data/seedHistory";
import { CURRENT_VERSION } from "@/lib/storage";

export interface Library {
  stations: Station[];
  groups: Group[];
  memberships: Membership[];
}

export interface LineupMarkers {
  /** null = unknown: saved by a client that predates the markers. */
  seedVersion: number | null;
  customizedAt: string | null;
}

export interface Selection {
  activeGroupId: string | null;
  currentStationId: string | null;
}

export const NEW_ARRIVALS_BAND = "New Arrivals";

let currentFingerprint: string | null = null;

function fingerprintOf(version: number): string | null {
  if (version === CURRENT_VERSION) {
    currentFingerprint ??= lineupFingerprint(seedGroups, seedMemberships);
    return currentFingerprint;
  }
  return PAST_LINEUP_FINGERPRINTS[version] ?? null;
}

/** Lowest lineup version this library's layout matches exactly, if any. */
function matchingVersion(fingerprint: string): number | null {
  const versions = [
    ...Object.keys(PAST_LINEUP_FINGERPRINTS).map(Number),
    CURRENT_VERSION,
  ].sort((a, b) => a - b);
  return versions.find((v) => fingerprintOf(v) === fingerprint) ?? null;
}

function ownedIndex(stations: Station[]) {
  return {
    ids: new Set(stations.map((s) => s.id)),
    urls: new Set(stations.map((s) => normalizeStreamUrl(s.streamUrl))),
  };
}

function owns(index: ReturnType<typeof ownedIndex>, s: Station): boolean {
  return index.ids.has(s.id) || index.urls.has(normalizeStreamUrl(s.streamUrl));
}

/**
 * Best guess at the lineup a marker-less, customized library grew from: the
 * newest addedIn among the default stations it holds. Only lineups a
 * pre-marker client could have shipped count, so stations the user added
 * themselves that joined the defaults later (David's own library feeds the
 * defaults) don't make it look newer than it is.
 */
function legacyBaseVersion(lib: Library): number {
  const index = ownedIndex(lib.stations);
  let base = LINEUP_FLOOR;
  for (const s of seedStations) {
    const added = stationAddedIn(s.id);
    if (added <= base || added > LEGACY_MAX_VERSION) continue;
    if (owns(index, s)) base = added;
  }
  return base;
}

export interface ResolvedMarkers {
  seedVersion: number;
  customizedAt: string | null;
}

/**
 * Resolves the markers a library should carry. `now` stamps libraries found
 * to be customized without a recorded time.
 */
export function resolveLineupMarkers(
  lib: Library,
  markers: LineupMarkers,
  now: string,
): ResolvedMarkers {
  const { seedVersion, customizedAt } = markers;
  // Customized: the library is the user's own; nothing to check.
  if (seedVersion !== null && customizedAt !== null) {
    return { seedVersion, customizedAt };
  }

  const fingerprint = lineupFingerprint(lib.groups, lib.memberships);
  const matched = matchingVersion(fingerprint);

  if (seedVersion !== null) {
    // Claims to be an untouched lineup. Verify where we can: a client that
    // predates the markers (an old tab, say) may have rewritten the library
    // since, and its edits must not be replaced by the next auto-update.
    const claimed = fingerprintOf(seedVersion);
    if (claimed === null || claimed === fingerprint) {
      return { seedVersion, customizedAt: null };
    }
    if (matched !== null) return { seedVersion: matched, customizedAt: null };
    return { seedVersion, customizedAt: now };
  }

  // No markers: written before they existed. An exact past lineup means the
  // user never customized; anything else is their own library.
  if (matched !== null) return { seedVersion: matched, customizedAt: null };
  return { seedVersion: legacyBaseVersion(lib), customizedAt: now };
}

/**
 * The current default lineup, keeping the user's station and band where they
 * still exist. The dial shows only the active band, so the band follows the
 * station when it no longer holds it.
 */
export function currentDefaultLineup(
  selection: Selection,
): Library & Selection {
  const sortedBands = [...seedGroups].sort((a, b) => a.position - b.position);
  const bandsHolding = (stationId: string) =>
    sortedBands.filter((g) =>
      seedMemberships.some(
        (m) => m.groupId === g.id && m.stationId === stationId,
      ),
    );
  const firstStationOf = (groupId: string) =>
    seedMemberships
      .filter((m) => m.groupId === groupId)
      .sort((a, b) => a.position - b.position)[0]?.stationId ?? null;

  let activeGroupId = sortedBands.some((g) => g.id === selection.activeGroupId)
    ? selection.activeGroupId
    : null;
  let currentStationId =
    selection.currentStationId &&
    bandsHolding(selection.currentStationId).length > 0
      ? selection.currentStationId
      : null;

  if (currentStationId) {
    const homes = bandsHolding(currentStationId);
    if (!homes.some((g) => g.id === activeGroupId)) activeGroupId = homes[0].id;
  } else if (activeGroupId) {
    currentStationId = firstStationOf(activeGroupId);
  }
  if (!activeGroupId || !currentStationId) {
    activeGroupId = seedDefaults.activeGroupId;
    currentStationId = seedDefaults.currentStationId;
  }

  return {
    stations: seedStations,
    groups: seedGroups,
    memberships: seedMemberships,
    activeGroupId,
    currentStationId,
  };
}

/**
 * Default stations newer than the library's lineup that its stations don't
 * already include (by id or stream URL), in lineup order.
 */
export function newDefaultStations(
  stations: Station[],
  seedVersion: number,
): Station[] {
  const index = ownedIndex(stations);
  const inBand = new Set(seedMemberships.map((m) => m.stationId));
  const offered = new Set<string>();
  return seedStations.filter((s) => {
    if (stationAddedIn(s.id) <= seedVersion || !inBand.has(s.id)) return false;
    if (owns(index, s)) return false;
    const key = normalizeStreamUrl(s.streamUrl);
    if (offered.has(key)) return false;
    offered.add(key);
    return true;
  });
}

export interface BandPlacement {
  groupId: string;
  name: string;
  count: number;
}

/**
 * Adds `stations` (from newDefaultStations) to the library. Each goes into
 * its default band(s), matched by band id, then by band name (trimmed,
 * case-insensitive). A default band the library lacks is created at the end
 * when it's newer than the library's lineup (`seedVersion`): the user never
 * had it. Otherwise they deleted it, and a station none of whose default
 * bands survives goes into a "New Arrivals" band, created at the end if
 * missing. New stations are appended in lineup order; existing positions
 * don't move.
 */
export function placeDefaultStations(
  lib: Library,
  stations: Station[],
  seedVersion: number,
  newGroupId: () => string,
): Library & { placements: BandPlacement[] } {
  const groups = [...lib.groups];
  const memberships = [...lib.memberships];
  const libStations = [...lib.stations];

  const sortedBands = [...groups].sort((a, b) => a.position - b.position);
  const nameKey = (name: string) => name.trim().toLowerCase();
  const byId = new Map(groups.map((g) => [g.id, g]));
  const byName = new Map<string, Group>();
  for (const g of sortedBands) {
    if (!byName.has(nameKey(g.name))) byName.set(nameKey(g.name), g);
  }
  const seedBandById = new Map(seedGroups.map((g) => [g.id, g]));
  // The user's band for a default band; "create" when it's newer than their
  // lineup; null when they deleted it.
  const resolveBand = (seedGroupId: string): Group | "create" | null => {
    const own = byId.get(seedGroupId);
    if (own) return own;
    const seedBand = seedBandById.get(seedGroupId);
    if (!seedBand) return null;
    const named = byName.get(nameKey(seedBand.name));
    if (named) return named;
    return bandAddedIn(seedGroupId) > seedVersion ? "create" : null;
  };
  const addBand = (id: string, name: string): Group => {
    const band = { id, name, position: groups.length };
    groups.push(band);
    byId.set(id, band);
    byName.set(nameKey(name), band);
    return band;
  };

  const counts = new Map<string, number>();
  const append = (stationId: string, group: Group) => {
    if (
      memberships.some(
        (m) => m.stationId === stationId && m.groupId === group.id,
      )
    ) {
      return;
    }
    const position = memberships.filter((m) => m.groupId === group.id).length;
    memberships.push({ stationId, groupId: group.id, position });
    counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
  };

  let arrivals: Group | null = byName.get(nameKey(NEW_ARRIVALS_BAND)) ?? null;
  const wanted = new Set(stations.map((s) => s.id));
  // Lineup order: band by band, each band's stations by position.
  const seedOrder = [...seedMemberships].sort((a, b) => {
    const ga = seedBandById.get(a.groupId)?.position ?? 0;
    const gb = seedBandById.get(b.groupId)?.position ?? 0;
    return ga - gb || a.position - b.position;
  });
  const homeless = new Set(
    stations
      .filter(
        (s) =>
          !seedMemberships.some(
            (m) => m.stationId === s.id && resolveBand(m.groupId),
          ),
      )
      .map((s) => s.id),
  );
  for (const m of seedOrder) {
    if (!wanted.has(m.stationId)) continue;
    if (homeless.has(m.stationId)) {
      arrivals ??= addBand(newGroupId(), NEW_ARRIVALS_BAND);
      append(m.stationId, arrivals);
      continue;
    }
    const band = resolveBand(m.groupId);
    if (band === "create") {
      append(m.stationId, addBand(m.groupId, seedBandById.get(m.groupId)!.name));
    } else if (band) {
      append(m.stationId, band);
    }
  }

  const libIds = new Set(libStations.map((s) => s.id));
  for (const s of stations) {
    if (!libIds.has(s.id)) libStations.push(s);
  }

  const placements = [...groups]
    .sort((a, b) => a.position - b.position)
    .filter((g) => counts.has(g.id))
    .map((g) => ({ groupId: g.id, name: g.name, count: counts.get(g.id)! }));
  return { stations: libStations, groups, memberships, placements };
}
