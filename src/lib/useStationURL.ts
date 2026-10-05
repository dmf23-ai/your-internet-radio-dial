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
//   - The cue is display-only until StoreHydrator's startup cloud pull
//     settles (store.cloudSettled). The pulled snapshot carries the user's
//     last-saved station and would otherwise bump returning visitors off the
//     shared link a second after load. Once settled, the cue is re-applied
//     if the snapshot moved it, then committed through setCurrentStation
//     (persisted + logged as a 'url' tune). Deferring the persist also keeps
//     the cue's cloud sync (delete-all-then-insert-all) from racing the pull,
//     which could read the user's memberships mid-wipe.
//   - On settle (currentStationId stable for 400ms), writes the new ID back
//     to the URL via pushState. First write uses replaceState so the back
//     button doesn't trap the user on the app's initial entry.
//   - Updates document.title synchronously on station change. No debounce —
//     latency would feel laggy.
//
// Out of scope:
//   - Song info in title. NowPlayingLozenge keeps that as local state and
//     it's only known on tap; not worth lifting for a transient decoration.
//   - Band info in URL. Band is derived from station membership instead:
//     cueing a station outside the active band switches to a band that
//     holds it (bandToShow below), much like scan's cross-band drift.

import { useEffect, useRef } from "react";
import { useRadioStore, type RadioState } from "@/lib/store";

const PARAM = "station";
const DEFAULT_TITLE = "Your Internet Radio Dial";
const SETTLE_MS = 400;

// The dial only shows the active band, so cueing a station outside it would
// leave the needle on another band's station. Returns the band to switch to
// (the first by position that holds the station), or null when the active
// band already holds it or no band does.
function bandToShow(s: RadioState, stationId: string): string | null {
  const bands = new Set(
    s.memberships.filter((m) => m.stationId === stationId).map((m) => m.groupId),
  );
  if (s.activeGroupId && bands.has(s.activeGroupId)) return null;
  const first = [...s.groups]
    .sort((a, b) => a.position - b.position)
    .find((g) => bands.has(g.id));
  return first?.id ?? null;
}

export function useStationURL() {
  const hydrated = useRadioStore((s) => s.hydrated);
  const cloudSettled = useRadioStore((s) => s.cloudSettled);
  const currentStationId = useRadioStore((s) => s.currentStationId);
  const stations = useRadioStore((s) => s.stations);
  const setCurrentStation = useRadioStore((s) => s.setCurrentStation);

  // True after the first successful URL read on mount, regardless of whether
  // the URL had a station= param. Gates the writer so we don't push a URL
  // entry on the very first render (when currentStationId hasn't actually
  // moved — it's just the hydrated default).
  const initialReadDoneRef = useRef(false);

  // The ?station= id from the initial URL (null if absent), held from the
  // initial read until the commit. `urlCuedRef` records whether the initial
  // read actually moved the dial, as opposed to the URL just echoing the
  // saved station (a reload). `urlCommitDoneRef` makes the commit one-shot.
  const urlStationIdRef = useRef<string | null>(null);
  const urlCuedRef = useRef(false);
  const urlCommitDoneRef = useRef(false);

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
  // has, we show it right away, but display-only: no persist, no analytics —
  // the cloud pull may still be in flight. If not, silent no-op for now (the
  // commit below re-checks against the pulled library) — too niche to
  // deserve a UI surface, and we don't want to surprise the user with a
  // toast on a fresh load.
  useEffect(() => {
    if (!hydrated || initialReadDoneRef.current) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const wantId = params.get(PARAM);
    urlStationIdRef.current = wantId;
    const s = useRadioStore.getState();
    if (
      wantId &&
      wantId !== s.currentStationId &&
      s.stations.some((st) => st.id === wantId)
    ) {
      const patch: Partial<RadioState> = { currentStationId: wantId };
      const band = bandToShow(s, wantId);
      if (band) patch.activeGroupId = band;
      useRadioStore.setState(patch);
      urlCuedRef.current = true;
    }

    // Whatever the URL had, the current store state is now authoritative.
    // Seed the writer's "last written" tracker so it doesn't immediately
    // rewrite the same URL on the next effect tick.
    lastWrittenIdRef.current = useRadioStore.getState().currentStationId;
    initialReadDoneRef.current = true;
  }, [hydrated]);

  // --- Commit: once the startup cloud pull has settled ----------------------
  // For returning visitors the snapshot has replaced currentStationId (and
  // activeGroupId) with their last-saved values; re-apply the requested
  // station if the pulled library has it. Skipped when the URL only echoes
  // the station the user already had (e.g. a reload), so reloads don't log
  // tunes.
  useEffect(() => {
    if (!cloudSettled || !initialReadDoneRef.current) return;
    if (urlCommitDoneRef.current) return;
    urlCommitDoneRef.current = true;

    const wantId = urlStationIdRef.current;
    if (!wantId) return;
    const s = useRadioStore.getState();
    if (!s.stations.some((st) => st.id === wantId)) return;
    if (!urlCuedRef.current && s.currentStationId === wantId) return;

    const band = bandToShow(s, wantId);
    if (band) useRadioStore.setState({ activeGroupId: band });
    // autoplay=false — pre-tune only. User taps power to start.
    setCurrentStation(wantId, false, "url");
  }, [cloudSettled, setCurrentStation]);

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
