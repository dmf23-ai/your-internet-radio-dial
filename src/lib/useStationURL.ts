"use client";

// M21 — URL persistence + dynamic title.
//
// Single hook that owns all URL/title side-effects. Mounted from Console.
// Gated on the store's `hydrated` flag so we never try to resolve a station
// ID before the user's library is loaded.
//
// Scope:
//   - Reads `?station=<id>` on mount and (if it resolves) cues that station
//     without auto-playing. Real radios wake up off, plus browser autoplay
//     policies would block sound-without-gesture anyway.
//   - On settle (currentStationId stable for 400ms), writes the new ID back
//     to the URL via pushState. First write uses replaceState so the back
//     button doesn't trap the user on the app's initial entry.
//   - Updates document.title synchronously on station change. No debounce —
//     latency would feel laggy.
//
// Out of scope:
//   - Song info in title. NowPlayingLozenge keeps that as local state and
//     it's only known on tap; not worth lifting for a transient decoration.
//   - Band info in URL. Band is derived from station membership, same way
//     scan does cross-band drift in store.setCurrentStation.

import { useEffect, useRef } from "react";
import { useRadioStore } from "@/lib/store";

const PARAM = "station";
const DEFAULT_TITLE = "Your Internet Radio Dial";
const SETTLE_MS = 400;

export function useStationURL() {
  const hydrated = useRadioStore((s) => s.hydrated);
  const currentStationId = useRadioStore((s) => s.currentStationId);
  const stations = useRadioStore((s) => s.stations);
  const setCurrentStation = useRadioStore((s) => s.setCurrentStation);

  // True after the first successful URL read on mount, regardless of whether
  // the URL had a station= param. Gates the writer so we don't push a URL
  // entry on the very first render (when currentStationId hasn't actually
  // moved — it's just the hydrated default).
  const initialReadDoneRef = useRef(false);

  // Tracks the last value we wrote to the URL so the writer can no-op when
  // currentStationId === lastWritten. Avoids rewriting the same URL on
  // unrelated re-renders.
  const lastWrittenIdRef = useRef<string | null>(null);

  // Tracks whether we've written at least once since mount. First write uses
  // replaceState (so back button doesn't get trapped on the entry URL); all
  // subsequent writes use pushState (so back walks through tuned-station
  // history).
  const hasPushedRef = useRef(false);

  // --- Initial read: ?station=<id> on mount ---------------------------------
  // Runs once after hydration. If the param resolves to a station the user
  // has, we cue it (no autoplay). If not, silent no-op — too niche to deserve
  // a UI surface, and we don't want to surprise the user with a toast on a
  // fresh load.
  useEffect(() => {
    if (!hydrated || initialReadDoneRef.current) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const wantId = params.get(PARAM);
    if (wantId) {
      const exists = stations.some((s) => s.id === wantId);
      if (exists && wantId !== currentStationId) {
        // autoplay=false — pre-tune only. User taps power to start.
        setCurrentStation(wantId, false);
      }
    }

    // Whatever the URL had, the current store state is now authoritative.
    // Seed the writer's "last written" tracker so it doesn't immediately
    // rewrite the same URL on the next effect tick.
    lastWrittenIdRef.current = useRadioStore.getState().currentStationId;
    initialReadDoneRef.current = true;
  }, [hydrated, stations, currentStationId, setCurrentStation]);

  // --- Title: synchronous, no debounce --------------------------------------
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!hydrated) return;
    const station = stations.find((s) => s.id === currentStationId);
    document.title = station
      ? `${station.name} — ${DEFAULT_TITLE}`
      : DEFAULT_TITLE;
  }, [hydrated, currentStationId, stations]);

  // --- URL writer: debounced settle, pushState (replaceState first time) ----
  useEffect(() => {
    if (!initialReadDoneRef.current) return;
    if (typeof window === "undefined") return;
    if (currentStationId === lastWrittenIdRef.current) return;

    const timer = setTimeout(() => {
      // Re-check inside the timer — currentStationId might have moved on
      // again before settle, in which case the next effect run handles it.
      const live = useRadioStore.getState().currentStationId;
      if (live !== currentStationId) return;

      const url = new URL(window.location.href);
      if (currentStationId) {
        url.searchParams.set(PARAM, currentStationId);
      } else {
        url.searchParams.delete(PARAM);
      }
      const nextHref = url.pathname + url.search + url.hash;

      if (!hasPushedRef.current) {
        window.history.replaceState(window.history.state, "", nextHref);
        hasPushedRef.current = true;
      } else {
        window.history.pushState(window.history.state, "", nextHref);
      }
      lastWrittenIdRef.current = currentStationId;
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [currentStationId]);
}
