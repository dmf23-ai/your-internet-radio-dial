// Zustand store. Hydrates from IndexedDB, persists on change (debounced).
// Slices: stations, groups/memberships, playback, ui.

import { create } from "zustand";
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
  loadUserData,
  saveUserData,
  type UserData,
  CURRENT_VERSION,
} from "@/lib/storage";
import { getAudioEngine, type AudioStatus } from "@/lib/audio";
import type { AppUser } from "@/lib/supabase/client";
import { syncToCloud } from "@/lib/supabase/sync";

export interface UiState {
  searchOpen: boolean;
  menuOpen: boolean;
  stationListOpen: boolean;
  accountOpen: boolean;
  aboutOpen: boolean;
  suggestionBoxOpen: boolean;
  detailOpen: boolean;
}

export interface PlaybackState {
  isPlaying: boolean;
  status: AudioStatus;
  meterAvailable: boolean;
  errorMessage?: string;
}

export interface RadioState {
  hydrated: boolean;

  // auth — null until ensureAnonSession() resolves. Anonymous users get a
  // real Supabase uid here; email-signed-in users (M4.later) will swap to
  // isAnonymous: false. Sync writes are keyed off this uid.
  user: AppUser | null;

  // data
  stations: Station[];
  groups: Group[];
  memberships: Membership[];

  // selection
  activeGroupId: string | null;
  currentStationId: string | null;
  volume: number;

  // Tone (M13). Independently-saved EQ shelves applied by the audio engine.
  // Range -12..+12 dB; 0 = transparent.
  bass: number;
  treble: number;

  // Doze / sleep timer (M13). Both 0 when no timer is running.
  // `dozeMinutes` is the configured duration (15/30/60/90); `dozeEndAt`
  // is the epoch ms at which the timer expires. The audio engine owns the
  // actual fade + stop scheduling; the store just tracks UI state so the
  // doze plaque can render the countdown.
  dozeMinutes: number;
  dozeEndAt: number;

  // Scan / serendipity (M13). When true, a setInterval drifts the dial to
  // a random station every SCAN_PERIOD_MS until the user manually tunes or
  // toggles scan off.
  scanning: boolean;

  // user intent — true when Power is on, independent of stream success
  isOn: boolean;

  // playback (derived from audio engine)
  playback: PlaybackState;

  // ui
  ui: UiState;

  // --- actions ---
  hydrate: () => Promise<void>;
  /**
   * Idempotent data repair: any seed-default group that exists in the user's
   * library but has zero memberships gets its seed memberships restored
   * (and any missing seed stations re-added). Cheap no-op when nothing is
   * empty. Called after hydration and after any cloud snapshot is applied
   * — guards against a corrupted/partial sync that left a default band bare.
   */
  restoreEmptySeedBands: () => Promise<void>;
  setUser: (u: AppUser | null) => void;
  /**
   * Replace the local data slices with a cloud snapshot and persist to
   * IndexedDB (skipping the cloud-sync leg — we just read this state from
   * cloud, no point writing it back). Called by StoreHydrator on startup
   * when the user has cloud data.
   */
  applyCloudSnapshot: (data: UserData) => void;

  setActiveGroup: (id: string) => void;
  setCurrentStation: (id: string, autoplay?: boolean) => void;
  nextStation: () => void;
  prevStation: () => void;

  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;

  setVolume: (v: number) => void;

  // Tone (M13)
  setBass: (db: number) => void;
  setTreble: (db: number) => void;

  // Doze (M13). 0 cancels. Otherwise the engine schedules the fade + stop.
  setDoze: (minutes: number) => void;

  // Scan (M13). Toggles serendipity drift across all bands.
  setScanning: (active: boolean) => void;

  setSearchOpen: (v: boolean) => void;
  setMenuOpen: (v: boolean) => void;
  setStationListOpen: (v: boolean) => void;
  setAccountOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setSuggestionBoxOpen: (v: boolean) => void;
  setDetailOpen: (v: boolean) => void;

  // station/group mutations (M3)
  // Returns true if the station was newly added to the group, false if it was
  // already a member. If a station with the same streamUrl exists it is
  // reused; otherwise the passed station is appended to the stations list.
  addStationToGroup: (station: Station, groupId: string) => boolean;

  // Group mutations (M3.3). All mutations keep group positions as a dense
  // 0..N-1 sequence so reorder math is trivial.
  createGroup: (name: string) => string; // returns new group id
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string) => void;
  moveGroup: (id: string, direction: "up" | "down") => void;

  // Station-within-group mutations (M3.4). Positions stay dense 0..N-1.
  moveStationInGroup: (
    stationId: string,
    groupId: string,
    direction: "up" | "down",
  ) => void;
  removeStationFromGroup: (stationId: string, groupId: string) => void;

  // selectors (helper methods for components)
  stationsInActiveGroup: () => Station[];
  currentStation: () => Station | null;
}

// --- debounced persistence ---
// Writes to IndexedDB (always) and Supabase (when user is signed in). Both
// go through the same 400ms debounce so rapid mutations coalesce into one
// persist pass.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(get: () => RadioState) {
  if (typeof window === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = get();
    const data: UserData = {
      stations: s.stations,
      groups: s.groups,
      memberships: s.memberships,
      activeGroupId: s.activeGroupId,
      currentStationId: s.currentStationId,
      volume: s.volume,
      bass: s.bass,
      treble: s.treble,
      version: CURRENT_VERSION,
    };
    saveUserData(data);
    // Fire-and-forget cloud mirror. No-op when user is null (pre-auth) or
    // Supabase is misconfigured. Errors are logged inside syncToCloud.
    // Tone settings (bass/treble) live only in IndexedDB right now — the
    // cloud schema doesn't have a column for them yet.
    if (s.user) void syncToCloud(s.user.id, data);
  }, 400);
}

// --- scan / serendipity (M13) ---
// Module-level interval so setScanning(true) and setScanning(false) can
// idempotently start/stop a single drift loop without leaking timers across
// store renders.
const SCAN_PERIOD_MS = 12_000;
let scanTimer: ReturnType<typeof setInterval> | null = null;

function pickRandomStation(
  state: { stations: Station[]; memberships: Membership[] },
  excludeId: string | null,
): Station | null {
  // Restrict to stations that are members of *some* group — avoids drifting
  // onto orphaned imports the user has implicitly removed from circulation.
  const memberSet = new Set(state.memberships.map((m) => m.stationId));
  const pool = state.stations.filter(
    (s) => memberSet.has(s.id) && s.id !== excludeId,
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function startScanInterval(get: () => RadioState) {
  stopScanInterval();
  if (typeof window === "undefined") return;
  // Fire one drift immediately so the user gets feedback that scan is on.
  // We bypass setCurrentStation here because that action cancels scan as a
  // safeguard against manual tunes — scan is the one caller for whom that
  // safeguard is wrong.
  const driftOnce = () => {
    const s = get();
    if (!s.scanning) return;
    const next = pickRandomStation(s, s.currentStationId);
    if (!next) return;
    const nextGroup = s.memberships.find((m) => m.stationId === next.id);
    const patch: Partial<RadioState> = { currentStationId: next.id };
    if (nextGroup && nextGroup.groupId !== s.activeGroupId) {
      patch.activeGroupId = nextGroup.groupId;
    }
    useRadioStore.setState(patch);
    if (s.isOn) void s.play();
  };
  driftOnce();
  scanTimer = setInterval(driftOnce, SCAN_PERIOD_MS);
}

function stopScanInterval() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

// --- helper: list stations in a group, ordered ---
function stationsInGroup(
  stations: Station[],
  memberships: Membership[],
  groupId: string | null
): Station[] {
  if (!groupId) return [];
  const stationMap = new Map(stations.map((s) => [s.id, s]));
  return memberships
    .filter((m) => m.groupId === groupId)
    .sort((a, b) => a.position - b.position)
    .map((m) => stationMap.get(m.stationId))
    .filter((s): s is Station => !!s);
}

export const useRadioStore = create<RadioState>((set, get) => ({
  hydrated: false,
  user: null,

  stations: seedStations,
  groups: seedGroups,
  memberships: seedMemberships,

  activeGroupId: seedDefaults.activeGroupId,
  currentStationId: seedDefaults.currentStationId,
  volume: seedDefaults.volume,

  bass: 0,
  treble: 0,

  dozeMinutes: 0,
  dozeEndAt: 0,

  scanning: false,

  isOn: false,

  playback: {
    isPlaying: false,
    status: "idle",
    meterAvailable: false,
  },

  ui: {
    searchOpen: false,
    menuOpen: false,
    stationListOpen: false,
    accountOpen: false,
    aboutOpen: false,
    suggestionBoxOpen: false,
    detailOpen: false,
  },

  hydrate: async () => {
    if (get().hydrated) return;
    const saved = await loadUserData();
    if (saved) {
      set({
        stations: saved.stations?.length ? saved.stations : seedStations,
        groups: saved.groups?.length ? saved.groups : seedGroups,
        memberships: saved.memberships?.length
          ? saved.memberships
          : seedMemberships,
        activeGroupId: saved.activeGroupId ?? seedDefaults.activeGroupId,
        currentStationId:
          saved.currentStationId ?? seedDefaults.currentStationId,
        volume:
          typeof saved.volume === "number"
            ? saved.volume
            : seedDefaults.volume,
        bass: typeof saved.bass === "number" ? saved.bass : 0,
        treble: typeof saved.treble === "number" ? saved.treble : 0,
      });
    }
    // subscribe the store to audio engine status updates
    const engine = getAudioEngine();
    engine.setVolume(get().volume);
    engine.setBass(get().bass);
    engine.setTreble(get().treble);
    engine.subscribe((snap) => {
      set({
        playback: {
          isPlaying: snap.status === "playing" || snap.status === "buffering",
          status: snap.status,
          meterAvailable: snap.meterAvailable,
          errorMessage: snap.errorMessage,
        },
      });
    });
    set({ hydrated: true });
  },

  restoreEmptySeedBands: async () => {
    const state = get();
    const seedGroupIds = new Set(seedGroups.map((g) => g.id));
    const userGroupIds = new Set(state.groups.map((g) => g.id));
    const memberCountByGroup = new Map<string, number>();
    for (const m of state.memberships) {
      memberCountByGroup.set(
        m.groupId,
        (memberCountByGroup.get(m.groupId) ?? 0) + 1,
      );
    }

    // Empty seed-default groups that still exist in the user's library.
    const targetGroupIds = [...seedGroupIds].filter(
      (gid) =>
        userGroupIds.has(gid) && (memberCountByGroup.get(gid) ?? 0) === 0,
    );

    if (targetGroupIds.length === 0) return;

    const stationMap = new Map(state.stations.map((s) => [s.id, s]));
    const seedStationMap = new Map(seedStations.map((s) => [s.id, s]));
    const newStations = [...state.stations];
    const newMemberships = [...state.memberships];
    let restored = 0;

    for (const gid of targetGroupIds) {
      const seedRows = seedMemberships
        .filter((m) => m.groupId === gid)
        .sort((a, b) => a.position - b.position);
      seedRows.forEach((row, idx) => {
        // Add station if missing.
        if (!stationMap.has(row.stationId)) {
          const seedStation = seedStationMap.get(row.stationId);
          if (seedStation) {
            newStations.push(seedStation);
            stationMap.set(seedStation.id, seedStation);
          } else {
            return; // unreferenced — skip
          }
        }
        newMemberships.push({
          stationId: row.stationId,
          groupId: gid,
          position: idx,
        });
        restored += 1;
      });
    }

    set({ stations: newStations, memberships: newMemberships });
    schedulePersist(get);

    // eslint-disable-next-line no-console
    console.log(
      "[restore] re-populated",
      restored,
      "memberships across",
      targetGroupIds.length,
      "empty seed band(s):",
      targetGroupIds.join(", "),
    );
  },

  setUser: (u) => set({ user: u }),

  applyCloudSnapshot: (data) => {
    set({
      stations: data.stations,
      groups: data.groups,
      memberships: data.memberships,
      activeGroupId: data.activeGroupId,
      currentStationId: data.currentStationId,
      volume: data.volume,
    });
    // Keep the audio engine's volume in sync with the pulled value.
    getAudioEngine().setVolume(data.volume);
    // Persist to IndexedDB directly. Bypasses schedulePersist on purpose —
    // we just read this state from cloud, no need to push it back.
    void saveUserData(data);
  },

  setActiveGroup: (id) => {
    if (get().activeGroupId === id) return;
    const list = stationsInGroup(get().stations, get().memberships, id);
    const first = list[0]?.id ?? null;
    set({ activeGroupId: id });
    if (first) {
      // Delegate to setCurrentStation so the audio engine follows (auto-plays
      // when isOn). Without this, switching bands left the old stream running.
      get().setCurrentStation(first);
    } else {
      set({ currentStationId: null });
      schedulePersist(get);
    }
  },

  // Changes current station. If Power is on, auto-plays the new stream.
  // The optional autoplay param can force play regardless of Power state.
  // Manual tune cancels any active scan — the user is taking the wheel.
  setCurrentStation: (id, autoplay = false) => {
    if (get().scanning) {
      // Module-level interval handles the actual stop; we just flip the flag.
      stopScanInterval();
      set({ scanning: false });
    }
    set({ currentStationId: id });
    schedulePersist(get);
    if (autoplay || get().isOn) void get().play();
  },

  nextStation: () => {
    const list = get().stationsInActiveGroup();
    if (list.length === 0) return;
    const idx = list.findIndex((s) => s.id === get().currentStationId);
    const next = list[(idx + 1 + list.length) % list.length];
    get().setCurrentStation(next.id);
  },

  prevStation: () => {
    const list = get().stationsInActiveGroup();
    if (list.length === 0) return;
    const idx = list.findIndex((s) => s.id === get().currentStationId);
    const prev = list[(idx - 1 + list.length) % list.length];
    get().setCurrentStation(prev.id);
  },

  // Power on + start stream. isOn persists through transient stream errors.
  play: async () => {
    const s = get().currentStation();
    if (!s) return;
    set({ isOn: true });
    const engine = getAudioEngine();
    engine.setVolume(get().volume);
    // corsOk defaults to true when unset (assume CORS-clean unless flagged).
    await engine.play(s.streamUrl, s.streamType, s.corsOk ?? true);
  },

  // Power off. Scan and doze are automatic features that don't make sense
  // with the radio off, so cancel them too.
  pause: () => {
    if (get().scanning) {
      stopScanInterval();
      set({ scanning: false });
    }
    if (get().dozeMinutes > 0) {
      getAudioEngine().cancelDoze();
      set({ dozeMinutes: 0, dozeEndAt: 0 });
    }
    set({ isOn: false });
    getAudioEngine().pause();
  },

  togglePlay: async () => {
    if (get().isOn) {
      get().pause();
    } else {
      await get().play();
    }
  },

  setVolume: (v) => {
    const clamped = Math.min(1, Math.max(0, v));
    set({ volume: clamped });
    getAudioEngine().setVolume(clamped);
    schedulePersist(get);
  },

  setBass: (db) => {
    const clamped = Math.max(-12, Math.min(12, db));
    set({ bass: clamped });
    getAudioEngine().setBass(clamped);
    schedulePersist(get);
  },

  setTreble: (db) => {
    const clamped = Math.max(-12, Math.min(12, db));
    set({ treble: clamped });
    getAudioEngine().setTreble(clamped);
    schedulePersist(get);
  },

  setDoze: (minutes) => {
    const engine = getAudioEngine();
    if (minutes <= 0) {
      engine.cancelDoze();
      set({ dozeMinutes: 0, dozeEndAt: 0 });
      return;
    }
    // Make sure the radio is actually on — without playback there's nothing
    // to fade out, and silently scheduling a stop on an idle deck would just
    // be confusing.
    if (!get().isOn) {
      void get().play();
    }
    const totalSeconds = minutes * 60;
    engine.startDoze(totalSeconds);
    set({
      dozeMinutes: minutes,
      dozeEndAt: Date.now() + totalSeconds * 1000,
    });
  },

  setScanning: (active) => {
    const prev = get().scanning;
    if (prev === active) return;
    set({ scanning: active });
    if (active) {
      // Power on if not already, so the user hears the drift.
      if (!get().isOn) void get().play();
      startScanInterval(get);
    } else {
      stopScanInterval();
    }
  },

  setSearchOpen: (v) =>
    set((st) => ({ ui: { ...st.ui, searchOpen: v } })),
  setMenuOpen: (v) =>
    set((st) => ({ ui: { ...st.ui, menuOpen: v } })),
  setStationListOpen: (v) =>
    set((st) => ({ ui: { ...st.ui, stationListOpen: v } })),
  setAccountOpen: (v) =>
    set((st) => ({ ui: { ...st.ui, accountOpen: v } })),
  setAboutOpen: (v) =>
    set((st) => ({ ui: { ...st.ui, aboutOpen: v } })),
  setSuggestionBoxOpen: (v) =>
    set((st) => ({ ui: { ...st.ui, suggestionBoxOpen: v } })),
  setDetailOpen: (v) =>
    set((st) => ({ ui: { ...st.ui, detailOpen: v } })),

  createGroup: (name) => {
    const trimmed = name.trim() || "Untitled";
    const id = `g-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const { groups } = get();
    const nextGroups: Group[] = [
      ...groups,
      { id, name: trimmed, position: groups.length },
    ];
    set({ groups: nextGroups });
    schedulePersist(get);
    return id;
  },

  renameGroup: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextGroups = get().groups.map((g) =>
      g.id === id ? { ...g, name: trimmed } : g,
    );
    set({ groups: nextGroups });
    schedulePersist(get);
  },

  deleteGroup: (id) => {
    const { groups, memberships, activeGroupId } = get();
    if (groups.length <= 1) return; // Always keep at least one group.
    const remaining = groups
      .filter((g) => g.id !== id)
      // Renumber positions so the sequence stays dense.
      .sort((a, b) => a.position - b.position)
      .map((g, i) => ({ ...g, position: i }));
    const nextMemberships = memberships.filter((m) => m.groupId !== id);

    // If the deleted group was active, fall back to the first remaining one.
    let nextActive = activeGroupId;
    let nextCurrentId = get().currentStationId;
    if (activeGroupId === id) {
      nextActive = remaining[0]?.id ?? null;
      const firstStation = nextMemberships
        .filter((m) => m.groupId === nextActive)
        .sort((a, b) => a.position - b.position)[0];
      nextCurrentId = firstStation?.stationId ?? null;
    }

    set({
      groups: remaining,
      memberships: nextMemberships,
      activeGroupId: nextActive,
      currentStationId: nextCurrentId,
    });
    schedulePersist(get);
  },

  moveGroup: (id, direction) => {
    const sorted = [...get().groups].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    const nextGroups: Group[] = sorted.map((g, i) => ({ ...g, position: i }));
    set({ groups: nextGroups });
    schedulePersist(get);
  },

  moveStationInGroup: (stationId, groupId, direction) => {
    const sorted = get()
      .memberships.filter((m) => m.groupId === groupId)
      .sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((m) => m.stationId === stationId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    const renumbered = sorted.map((m, i) => ({ ...m, position: i }));
    const nextMemberships = [
      ...get().memberships.filter((m) => m.groupId !== groupId),
      ...renumbered,
    ];
    set({ memberships: nextMemberships });
    schedulePersist(get);
  },

  removeStationFromGroup: (stationId, groupId) => {
    const { memberships, activeGroupId, currentStationId } = get();
    const target = memberships.find(
      (m) => m.stationId === stationId && m.groupId === groupId,
    );
    if (!target) return;
    // Rebuild the group's memberships, then renumber positions.
    const groupRemainder = memberships
      .filter((m) => m.groupId === groupId && m.stationId !== stationId)
      .sort((a, b) => a.position - b.position)
      .map((m, i) => ({ ...m, position: i }));
    const nextMemberships = [
      ...memberships.filter((m) => m.groupId !== groupId),
      ...groupRemainder,
    ];
    set({ memberships: nextMemberships });

    // If we just removed the currently-playing station from the active group,
    // tune to the next station that still exists in the active group (or
    // null out if the group is now empty).
    if (
      activeGroupId === groupId &&
      currentStationId === stationId
    ) {
      const nextStationId = groupRemainder[0]?.stationId ?? null;
      if (nextStationId) {
        get().setCurrentStation(nextStationId);
      } else {
        set({ currentStationId: null });
      }
    }
    schedulePersist(get);
  },

  addStationToGroup: (station, groupId) => {
    const { stations, memberships } = get();
    // Reuse an existing station if the streamUrl matches; otherwise append.
    const existing = stations.find((s) => s.streamUrl === station.streamUrl);
    const effective = existing ?? station;
    const alreadyMember = memberships.some(
      (m) => m.stationId === effective.id && m.groupId === groupId,
    );
    if (alreadyMember) return false;

    const nextStations = existing ? stations : [...stations, station];
    // New membership goes at the end of the group.
    const groupCount = memberships.filter((m) => m.groupId === groupId).length;
    const nextMemberships: Membership[] = [
      ...memberships,
      {
        stationId: effective.id,
        groupId,
        position: groupCount,
      },
    ];
    set({ stations: nextStations, memberships: nextMemberships });
    schedulePersist(get);
    return true;
  },

  stationsInActiveGroup: () =>
    stationsInGroup(get().stations, get().memberships, get().activeGroupId),

  currentStation: () => {
    const id = get().currentStationId;
    if (!id) return null;
    return get().stations.find((s) => s.id === id) ?? null;
  },
}));
