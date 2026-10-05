// History of the default lineup (seed.ts): which lineup version each default
// station first shipped in, and fingerprints of past lineups. src/lib/
// lineup.ts uses it to auto-update users who never customized their library
// and to offer customizers the stations added since their lineup.
//
// Kept apart from seed.ts on purpose: the "Update stations" procedure
// regenerates seed.ts wholesale from David's IndexedDB export, which would
// wipe anything stored there. When a new lineup ships:
//   1. bump CURRENT_VERSION in src/lib/storage.ts (any lineup change needs
//      a bump: non-customized users are checked against the current lineup);
//   2. add each new station id to STATION_ADDED_IN, and each new band id to
//      BAND_ADDED_IN, with the new version (an id that's missing counts as
//      new in CURRENT_VERSION, which is right only until the next bump);
//   3. optionally add the outgoing lineup's fingerprint to
//      PAST_LINEUP_FINGERPRINTS (lineupFingerprint over that version's
//      seedGroups / seedMemberships) so its users are checked too.
//
// Backfilled 2026-10-05 from the git history of seed.ts: v9 be62413 (dev
// only, pre-launch), v10 1d485a0 (M9), v11 a5dd5dd, v12 31096da.

import type { Group, Membership } from "@/data/seed";
import { CURRENT_VERSION } from "@/lib/storage";

/** The first lineup that reached production users. */
export const LINEUP_FLOOR = 10;

/**
 * The last lineup shipped before per-user markers (seed_version /
 * customized_at) existed. A library without markers was written by a client
 * at this version or older, so it can only have received stations up to it.
 */
export const LEGACY_MAX_VERSION = 12;

/**
 * Lineup version each default station first shipped in (the start of its
 * latest unbroken run in the lineup, floored at LINEUP_FLOOR).
 */
export const STATION_ADDED_IN: Record<string, number> = {
  // v10: M9 curated library (1d485a0), the first production lineup.
  "rb-9034682c-5121-11e8-a4d1-52543be04c81": 10,
  "fip": 10,
  "kexp-seattle": 10,
  "rb-c454908c-eb81-11e9-a96c-52543be04c81": 10,
  "somafm-groove-salad": 10,
  "rb-d8d9f55b-5451-49c9-a769-bfa5f8115b29": 10,
  "rb-d67a9f10-1d97-462b-aaab-b71e45cb13b0": 10,
  "rb-96197030-0601-11e8-ae97-52543be04c81": 10,
  "rb-51f82c18-dc04-44f2-8437-6d734468a257": 10,
  "rb-cfdd3af7-131d-44c1-a5a8-4e26fdaef284": 10,
  "rb-4fbd441a-2d2a-40b9-b45b-9e9ee46b3217": 10,
  "rb-5b9ceedf-eb85-11e9-a96c-52543be04c81": 10,
  "radio-swiss-jazz": 10,
  "rb-afd2672a-d921-11e8-a9cc-52543be04c81": 10,
  "jazz24": 10,
  "rb-a6e1eef4-57f8-427d-bbb5-df077984798b": 10,
  "bbc-world-service": 10,
  "abc-news-radio-au": 10,
  "rb-60e8f7d3-affd-44ea-8860-08317c5d04b5": 10,
  "rb-96186f9e-0601-11e8-ae97-52543be04c81": 10,
  "wnyc-fm": 10,
  "rb-961dab15-0601-11e8-ae97-52543be04c81": 10,
  "npr-news": 10,
  "bluemars": 10,
  "somafm-drone-zone": 10,
  "somafm-deep-space-one": 10,
  "somafm-space-station": 10,
  "somafm-mission-control": 10,
  "radio-paradise-mellow": 10,
  "rb-7babd377-ed7c-4a63-9778-47b0fd94983b": 10,
  "rb-d62fa52b-7c1c-492c-9861-cd2c0ec02f00": 10,
  "rb-cbc50678-e70e-11e9-a96c-52543be04c81": 10,
  "rb-932eb148-e6f6-11e9-a96c-52543be04c81": 10,
  "rb-edb81cbf-0645-4944-a376-554b8299ff27": 10,
  "rb-9614f116-0601-11e8-ae97-52543be04c81": 10,
  "rb-21a282be-44f4-4b8e-aae9-b4c2041af4a5": 10,
  "rb-a8821077-6679-49de-b87a-2be909dfe7e2": 10,
  "rb-021e14a0-ddda-4ed5-bf37-3f5744b65eeb": 10,
  "rb-5649bc0b-c5bc-11e8-aaf2-52543be04c81": 10,
  "rb-643840c6-6e57-43e3-bdd9-3a09d20fdd40": 10,
  "rb-961e6cac-0601-11e8-ae97-52543be04c81": 10,
  "rb-9634ab94-0601-11e8-ae97-52543be04c81": 10,
  "rb-325a61dc-fe34-48c6-ae82-1467b710f07b": 10,
  "kcrw-eclectic24": 10,
  "rb-6f749ff6-d587-11e9-a861-52543be04c81": 10,
  "rb-961249b2-0601-11e8-ae97-52543be04c81": 10,
  "rb-434e9a4b-018a-4557-8ca1-8c328bb1e09d": 10,
  "url-the-worm": 10,
  // v11: curated library update (a5dd5dd).
  "rb-96233b6d-0601-11e8-ae97-52543be04c81": 11,
  "rb-9ceb61e8-5101-11e9-a4d7-52543be04c81": 11,
  "rb-9618344a-0601-11e8-ae97-52543be04c81": 11,
  "rb-c31977d2-91a7-4695-a842-ad3967aaa51c": 11,
  "url-waba-aguadilla": 11,
  "url-wael-maricao": 11,
  "url-wcmn-arecibo": 11,
  "url-wiob-mayaguez": 11,
  "rb-960a4ad1-0601-11e8-ae97-52543be04c81": 11,
  "rb-64a0b49e-f5f9-446c-9883-493f7a8889c9": 11,
  "rb-960a0f41-0601-11e8-ae97-52543be04c81": 11,
  "rb-963fb390-0601-11e8-ae97-52543be04c81": 11,
  "rb-bfdab331-e03c-4a34-b9ff-7647e3b89d94": 11,
  "rb-1651c32f-55d8-4429-995d-872ea0dcf520": 11,
  "rb-652e1061-5de4-442f-8b7e-cd0dfbd37048": 11,
  "rb-0bb84fe1-e899-11e9-a96c-52543be04c81": 11,
  "rb-a256200d-2ec4-11e9-8f31-52543be04c81": 11,
  "rb-db8f7083-7872-4561-8c84-918559c90124": 11,
  "rb-227d44b4-e3b5-4ded-895b-9d240eb11448": 11,
  "rb-962b23be-0601-11e8-ae97-52543be04c81": 11,
  // v12: Suggestion Box nominations (31096da).
  "rb-a7524b13-a5c9-4460-bcb8-8b7a3599f0cf": 12,
  "rb-ce61ecb3-cf9f-4991-b860-32047def71ed": 12,
  "rb-3487079b-91b1-4fb8-b315-c4150e705b7a": 12,
  "rb-83a18260-6d4f-4859-b7a0-30b41d0dc9e1": 12,
  "rb-a3bf114c-c001-4c43-9665-1748d3df0938": 12,
  "rb-8f0a7bd7-5e15-4442-b167-c1da804dbc08": 12,
  "rb-e6335725-d8ea-4a89-a5fe-c3af4b05248a": 12,
  "url-radio-unbound": 12,
  "rb-fcb3ce76-8f7b-4949-897e-4158b67ed952": 12,
  "url-wart-marshall": 12,
  "rb-d61e880e-e8f0-11e9-a96c-52543be04c81": 12,
  "url-wdbx-carbondale": 12,
  "rb-ba149f9e-2a82-4727-aac7-390667fa88a5": 12,
  "rb-360bb528-cea3-4e8e-84c6-3970c55bda71": 12,
  // v13: from David's library (2026-10-05).
  "rb-a5613717-c60b-4952-bb9c-a79d2063c96f": 13,
};

/**
 * Lineup version each default band first shipped in. A band newer than a
 * user's lineup is one they never had (rather than one they deleted), so its
 * new stations bring the band along instead of landing in "New Arrivals".
 */
export const BAND_ADDED_IN: Record<string, number> = {
  "g-favorites": 10,
  "g-austin": 10,
  "g-jazz": 10,
  "g-news": 10,
  "g-ambient": 10,
  "g-world": 10,
  "g-exploratorium": 10,
  "g-puerto-rico": 11,
};

/**
 * lineupFingerprint of each past default lineup, from git history. The
 * current lineup's fingerprint is computed from seed.ts at runtime instead,
 * so regenerating seed.ts can't leave a stale value behind.
 */
export const PAST_LINEUP_FINGERPRINTS: Record<number, string> = {
  9: "06e6272924b010",
  10: "026810f1114eaa",
  11: "0e99b7353725aa",
  12: "078c062554b838",
};

export function stationAddedIn(stationId: string): number {
  return STATION_ADDED_IN[stationId] ?? CURRENT_VERSION;
}

export function bandAddedIn(groupId: string): number {
  return BAND_ADDED_IN[groupId] ?? CURRENT_VERSION;
}

// cyrb53: small, fast 53-bit string hash (public domain, bryc).
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0))
    .toString(16)
    .padStart(14, "0");
}

/**
 * Fingerprint of a library's layout: band ids, names and positions, plus the
 * station ids in each band, in order. Station details (names, URLs) aren't
 * part of it: users can't edit those.
 */
export function lineupFingerprint(
  groups: Group[],
  memberships: Membership[],
): string {
  const byGroup = new Map<string, Membership[]>();
  for (const m of memberships) {
    const list = byGroup.get(m.groupId);
    if (list) list.push(m);
    else byGroup.set(m.groupId, [m]);
  }
  const canonical = [...groups]
    .sort(
      (a, b) =>
        a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((g) => {
      const ids = (byGroup.get(g.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((m) => m.stationId);
      return [g.id, g.name, String(g.position), ...ids].join("\u001f");
    })
    .join("\u001e");
  return cyrb53(canonical);
}

/**
 * Stream identity for "does the user already have this station?": host
 * (keeping a non-default port, which can select a different stream) and
 * path, ignoring scheme, "www.", query, case and trailing "/" or ";".
 */
export function normalizeStreamUrl(url: string): string {
  try {
    const u = new URL(url);
    return (
      u.host.replace(/^www\./, "") + u.pathname.replace(/[/;]+$/, "")
    ).toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}
