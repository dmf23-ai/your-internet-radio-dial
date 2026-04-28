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
  version: number;
}

const KEY = "yird:userData:v1";
export const CURRENT_VERSION = 10;

export async function loadUserData(): Promise<UserData | null> {
  if (typeof window === "undefined") return null;
  try {
    const v = await get<UserData>(KEY);
    if (!v) return null;
    // Bumped version → discard old data and re-seed. Prevents stale station
    // lists from sticking around after seed changes.
    if (v.version !== CURRENT_VERSION) return null;
    return v;
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
