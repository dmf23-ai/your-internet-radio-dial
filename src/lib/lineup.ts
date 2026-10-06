// Default-lineup reconciliation. Pure functions over a library; the store
// wires them up (reconcileLineup at startup, addNewDefaultStations for the
// "add new stations" button on the cabinet and in the search overlay).
//
// Every library carries two markers:
//   seedVersion  — the default-lineup version it reflects (CURRENT_VERSION
//                  when it was seeded or last brought up to date).
//   customizedAt — when the user last edited it (stations added, removed or
//                  reordered; bands created, renamed, deleted or reordered).
//                  null = never customized.
// Users who never customized are moved onto each new lineup automatically.
// Customizers keep their library and are offered the default stations added
// after their seedVersion that they don't already have, plus any default
// band added after it that they don't have, complete with its stations.
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

// Band names match trimmed and case-insensitive (David's bands have non-seed
// ids, so a default band is found by name when its id is missing).
const nameKey = (name: string) => name.trim().toLowerCase();

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
 * Default bands newer than the library's lineup that it has no band for (by
 * id or by name), in lineup order. The user never had them (rather than
 * deleted them), so the button creates them, complete with their stations.
 */
export function newDefaultBands(groups: Group[], seedVersion: number): Group[] {
  const ids = new Set(groups.map((g) => g.id));
  const names = new Set(groups.map((g) => nameKey(g.name)));
  return [...seedGroups]
    .sort((a, b) => a.position - b.position)
    .filter(
      (g) =>
        bandAddedIn(g.id) > seedVersion &&
        !ids.has(g.id) &&
        !names.has(nameKey(g.name)) &&
        seedMemberships.some((m) => m.groupId === g.id),
    );
}

/** What the "add new stations" button would add to a customized library. */
export interface DefaultsOffer {
  /**
   * Station records it lacks (by id or stream URL), in lineup order: the
   * default stations newer than its lineup, plus any other station of a new
   * band.
   */
  stations: Station[];
  /** Default bands it would create (newDefaultBands). */
  bands: Group[];
}

export function defaultsOffer(
  lib: Pick<Library, "stations" | "groups">,
  seedVersion: number,
): DefaultsOffer {
  const bands = newDefaultBands(lib.groups, seedVersion);
  const bandIds = new Set(bands.map((g) => g.id));
  const inNewBand = new Set(
    seedMemberships
      .filter((m) => bandIds.has(m.groupId))
      .map((m) => m.stationId),
  );
  const index = ownedIndex(lib.stations);
  const inBand = new Set(seedMemberships.map((m) => m.stationId));
  const offered = new Set<string>();
  const stations = seedStations.filter((s) => {
    if (stationAddedIn(s.id) <= seedVersion && !inNewBand.has(s.id)) {
      return false;
    }
    if (!inBand.has(s.id) || owns(index, s)) return false;
    const key = normalizeStreamUrl(s.streamUrl);
    if (offered.has(key)) return false;
    offered.add(key);
    return true;
  });
  return { stations, bands };
}

export interface BandPlacement {
  groupId: string;
  name: string;
  /** Memberships the button added to the band. */
  count: number;
  /** The button created the band (a new default band, or New Arrivals). */
  created: boolean;
}

/**
 * Adds an offer (from defaultsOffer) to the library. Append-only: nothing
 * already there moves, and nothing is renamed or removed.
 *  - A new default band is created at the end, complete: all its stations in
 *    lineup order. Ones the library already has (by id, or by stream URL
 *    under its own id) join it as an extra membership, so a station can then
 *    sit in two bands; the rest arrive as new stations.
 *  - Every other offered station goes into its default band(s), matched by
 *    band id, then by band name. A station none of whose default bands
 *    survives (the user deleted them) goes into a "New Arrivals" band,
 *    created last (after any new default bands) if missing.
 * New memberships are appended in lineup order.
 */
export function placeDefaultStations(
  lib: Library,
  offer: DefaultsOffer,
  newGroupId: () => string,
): Library & { placements: BandPlacement[] } {
  const groups = [...lib.groups];
  const memberships = [...lib.memberships];
  const stations = [...lib.stations];

  const byId = new Map(groups.map((g) => [g.id, g]));
  const byName = new Map<string, Group>();
  for (const g of [...groups].sort((a, b) => a.position - b.position)) {
    if (!byName.has(nameKey(g.name))) byName.set(nameKey(g.name), g);
  }
  const created = new Set<string>();
  const addBand = (id: string, name: string): Group => {
    const band = { id, name, position: groups.length };
    groups.push(band);
    byId.set(id, band);
    byName.set(nameKey(name), band);
    created.add(id);
    return band;
  };
  const seedBandById = new Map(seedGroups.map((g) => [g.id, g]));
  const newBands = new Set(offer.bands.map((g) => g.id));
  // The library's band for an existing default band; null when the user
  // deleted it.
  const resolveBand = (seedGroupId: string): Group | null => {
    const seedBand = seedBandById.get(seedGroupId);
    if (!seedBand) return null;
    return byId.get(seedGroupId) ?? byName.get(nameKey(seedBand.name)) ?? null;
  };

  // Add the offered records, then index every record by stream, so a new
  // band's stations join under the record the library already holds.
  const ids = new Set(stations.map((s) => s.id));
  for (const s of offer.stations) {
    if (ids.has(s.id)) continue;
    stations.push(s);
    ids.add(s.id);
  }
  const byStream = new Map<string, string>();
  for (const s of stations) {
    const key = normalizeStreamUrl(s.streamUrl);
    if (!byStream.has(key)) byStream.set(key, s.id);
  }
  const heldAs = (s: Station): string | null =>
    ids.has(s.id) ? s.id : byStream.get(normalizeStreamUrl(s.streamUrl)) ?? null;

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

  const offered = new Set(offer.stations.map((s) => s.id));
  const seedStationById = new Map(seedStations.map((s) => [s.id, s]));
  // Offered stations with nowhere to go: none of their default bands is in
  // the library or new to it.
  const homeless = new Set(
    offer.stations
      .filter(
        (s) =>
          !seedMemberships.some(
            (m) =>
              m.stationId === s.id &&
              (newBands.has(m.groupId) || resolveBand(m.groupId)),
          ),
      )
      .map((s) => s.id),
  );
  // Lineup order: band by band, each band's stations by position.
  const seedOrder = [...seedMemberships].sort((a, b) => {
    const ga = seedBandById.get(a.groupId)?.position ?? 0;
    const gb = seedBandById.get(b.groupId)?.position ?? 0;
    return ga - gb || a.position - b.position;
  });
  const arrivals: string[] = [];
  for (const m of seedOrder) {
    if (newBands.has(m.groupId)) {
      const band =
        byId.get(m.groupId) ??
        addBand(m.groupId, seedBandById.get(m.groupId)!.name);
      const seedStation = seedStationById.get(m.stationId);
      const id = seedStation ? heldAs(seedStation) : null;
      if (id) append(id, band);
      continue;
    }
    if (!offered.has(m.stationId)) continue;
    if (homeless.has(m.stationId)) {
      if (!arrivals.includes(m.stationId)) arrivals.push(m.stationId);
      continue;
    }
    const band = resolveBand(m.groupId);
    if (band) append(m.stationId, band);
  }
  // New Arrivals last, after any new default bands.
  if (arrivals.length > 0) {
    const band =
      byName.get(nameKey(NEW_ARRIVALS_BAND)) ??
      addBand(newGroupId(), NEW_ARRIVALS_BAND);
    for (const id of arrivals) append(id, band);
  }

  const placements = [...groups]
    .sort((a, b) => a.position - b.position)
    .filter((g) => counts.has(g.id))
    .map((g) => ({
      groupId: g.id,
      name: g.name,
      count: counts.get(g.id)!,
      created: created.has(g.id),
    }));
  return { stations, groups, memberships, placements };
}
