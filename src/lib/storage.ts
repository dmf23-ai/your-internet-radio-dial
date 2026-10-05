// IndexedDB persistence wrapper (idb-keyval).
// All writes are fire-and-forget; the store handles debouncing.

import { get, set, del } from "idb-keyval";
import type { Station, Group, Membership } from "@/data/seed";

export interface UserData {
  stations: Station[];
  groups: Group[];
  memberships: Membership[];
  activeGroupId: string | null;
  currentStationId: string | null;
  volume: number; // 0..1
  // Tone (M13). Optional — older saves predate these fields; default to 0
  // (transparent EQ). Only persisted to IndexedDB; not mirrored to cloud yet.
  bass?: number; // dB, ±12
  treble?: number; // dB, ±12
  // Lineup markers (see src/lib/lineup.ts). Absent on saves from clients
  // that predate them; the startup reconcile then infers both.
  // seedVersion: the default-lineup version this library reflects.
  // customizedAt: ISO time of the last library edit; null = never.
  seedVersion?: number | null;
  customizedAt?: string | null;
  // CURRENT_VERSION of the client that saved this.
  version: number;
}

const KEY = "yird:userData:v1";

// The default-lineup version: bump it whenever seed.ts's lineup changes
// (and record the new stations in src/data/seedHistory.ts). Users who never
// customized their library are moved onto the new lineup on their next
// visit; customizers are offered the new stations in the search overlay.
// Until v13 a mismatch discarded the saved library, and the cloud pull then
// put the old one straight back, so new defaults never reached returning
// users.
export const CURRENT_VERSION = 13;

export async function loadUserData(): Promise<UserData | null> {
  if (typeof window === "undefined") return null;
  try {
    const v = await get<UserData>(KEY);
    return v ?? null;
  } catch {
    return null;
  }
}

export async function saveUserData(data: UserData): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await set(KEY, { ...data, version: CURRENT_VERSION });
  } catch {
    // swallow — best-effort persistence
  }
}

export async function clearUserData(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await del(KEY);
  } catch {
    // noop
  }
}
