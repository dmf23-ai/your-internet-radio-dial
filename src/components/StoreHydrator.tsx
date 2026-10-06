"use client";

import { useEffect, useRef } from "react";
import { useRadioStore } from "@/lib/store";
import {
  ensureAnonSession,
  subscribeToAuthChanges,
} from "@/lib/supabase/client";
import { pullFromCloud } from "@/lib/supabase/sync";
import { trackPageView, trackSessionHeartbeat } from "@/lib/analytics";

/**
 * One cloud step: pull the account's library (cloud wins), reconcile its
 * lineup, then settle, which releases the store's held-back cloud syncs.
 * Runs at startup and again whenever a sign-in switches the uid.
 * `isCurrent` turns false once a newer step (or an unmount) takes over; a
 * stale step stops without touching the store, so an overtaken pull can't
 * land on top of a newer account's library.
 *
 * userId null = local-only mode (Supabase unconfigured or sign-in failed):
 * no snapshot is coming, so the local library is final as soon as it's here.
 */
async function runCloudStep(
  userId: string | null,
  isCurrent: () => boolean,
): Promise<void> {
  const store = useRadioStore.getState;
  let pushLocal = false;

  if (userId) {
    // Pull-or-seed: if the user has cloud data, pull it into the store
    // (cloud wins); if the cloud is empty, push the local library up as the
    // initial snapshot once settled. A failed pull keeps the local library
    // and pushes nothing — the cloud may hold a library we just couldn't
    // read.
    const pulled = await pullFromCloud(userId);
    if (!isCurrent()) return;
    if (pulled.status === "ok") {
      store().applyCloudSnapshot(pulled.data);
      // eslint-disable-next-line no-console
      console.log(
        "[sync] pulled cloud snapshot:",
        pulled.data.stations.length,
        "stations,",
        pulled.data.groups.length,
        "groups",
      );
    } else if (pulled.status === "empty") {
      pushLocal = true;
    } else {
      console.warn("[sync] cloud pull failed; keeping this device's library");
    }
  }

  // Lineup markers, and the move onto the current default lineup for a
  // library that was never customized. After the pull (which can replace the
  // library) and before settling, so useStationURL commits against the final
  // library and the update reaches the cloud with the settle. An empty
  // default band stays empty: since M25 made the sync atomic, it can only be
  // a customizer's choice, so M14's refill of empty bands is gone.
  store().reconcileLineup();

  // The pull can no longer overwrite the selection, so useStationURL may
  // commit a ?station= cue now, and the cloud may hear about everything
  // persisted while we waited.
  const synced = store().markCloudSettled({ push: pushLocal });
  if (pushLocal) {
    void synced.then(() => {
      // eslint-disable-next-line no-console
      console.log("[sync] initial cloud seed complete");
    });
  }
}

export default function StoreHydrator({
  children,
}: {
  children: React.ReactNode;
}) {
  const hydrate = useRadioStore((s) => s.hydrate);
  const setUser = useRadioStore((s) => s.setUser);
  const markCloudUnsettled = useRadioStore((s) => s.markCloudUnsettled);

  // Tracks the uid we currently believe we're acting as. Used by the
  // auth-change subscriber to detect a true cross-device sign-in (uid
  // changes) vs an in-place anon→permanent upgrade (uid stays the same).
  const knownUidRef = useRef<string | null>(null);

  // Bumped by every cloud step; a step is current only while the counter
  // still holds the value it started with.
  const cloudStepRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Load IndexedDB into the store first so the UI renders instantly
      //    with whatever state the device had, independent of network latency.
      await hydrate();
      if (cancelled) return;

      // 2. Bootstrap Supabase session (creates anon user on first visit).
      const user = await ensureAnonSession();
      if (cancelled) return;
      const step = ++cloudStepRef.current;
      const isCurrent = () => !cancelled && step === cloudStepRef.current;
      if (!user) {
        await runCloudStep(null, isCurrent);
        return;
      }
      setUser(user);
      knownUidRef.current = user.id;
      // eslint-disable-next-line no-console
      console.log(
        "[supabase] session uid =",
        user.id,
        user.isAnonymous ? "(anonymous)" : "",
      );

      // 3. Pull (or seed), reconcile, settle.
      await runCloudStep(user.id, isCurrent);
      if (cancelled) return;

      // 4. M23 — log a page_view event now that the session is established.
      //    Fires once per app mount; placed after session bootstrap so the
      //    event row gets the user's real uid attached.
      trackPageView();
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrate, setUser]);

  // Subscribe to Supabase auth changes so the store stays in sync with the
  // live session. Fires on:
  //   - email confirmation link → anon user promoted to permanent (same uid,
  //     now has email + isAnonymous:false), UI should flip Account drawer
  //     from "guest" to "signed in" without reload
  //   - magic-link sign-in (M6) → uid changes from this device's anon to the
  //     existing permanent uid; we pull cloud and overwrite local state so
  //     the user's synced library replaces this device's guest library
  //   - sign-out → mints a fresh anon uid and seeds its empty cloud from
  //     this device's library
  //   - token refresh → refreshed user payload, no visible change
  //
  // Kept separate from the bootstrap effect so the subscription lifecycle is
  // independent of initial hydration (and doesn't get torn down if the
  // bootstrap deps somehow re-ran).
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (user, event) => {
      // The bootstrap effect resolves the initial session itself (and mints
      // the anon user when there's none).
      if (event === "INITIAL_SESSION") return;

      if (user) {
        const previousUid = knownUidRef.current;
        if (!previousUid || previousUid === user.id) {
          setUser(user);
          knownUidRef.current = user.id;
          return;
        }

        // True cross-device sign-in: uid changed. Pull the signed-in user's
        // library from cloud and overwrite this device's local state. The
        // prior anon uid's local data (and any rows it pushed under that
        // anon uid) is intentionally discarded — sign-in is overwrite, not
        // merge. Cloud syncs are held back first, so nothing persisted in
        // the meantime can push this device's library into the account.
        const step = ++cloudStepRef.current;
        markCloudUnsettled();
        setUser(user);
        knownUidRef.current = user.id;
        // eslint-disable-next-line no-console
        console.log(
          "[sync] auth uid changed",
          previousUid,
          "→",
          user.id,
          "— pulling cloud snapshot",
        );
        await runCloudStep(user.id, () => step === cloudStepRef.current);
        return;
      }

      // Sign-out fired. Mint a fresh anon session so the app keeps working
      // as a guest without requiring a page reload. Forget the old uid first
      // so the fresh anon's SIGNED_IN isn't mistaken for a sign-in; its empty
      // cloud then gets seeded from this device's library.
      knownUidRef.current = null;
      const step = ++cloudStepRef.current;
      const isCurrent = () => step === cloudStepRef.current;
      markCloudUnsettled();
      const fresh = await ensureAnonSession();
      if (!isCurrent()) return;
      if (fresh) {
        setUser(fresh);
        knownUidRef.current = fresh.id;
        await runCloudStep(fresh.id, isCurrent);
      } else {
        setUser(null);
        await runCloudStep(null, isCurrent);
      }
    });
    return unsubscribe;
  }, [setUser, markCloudUnsettled]);

  // M23 — listening-time heartbeat. Fires every 60s while audio is actively
  // playing, recording the currently-tuned station. Total listening minutes
  // = count(heartbeat) × 60s; per-station listen time is just bucketed by
  // station_id. Skipped while buffering/tuning/idle/error so dead air or
  // reconnect attempts don't pad the numbers.
  //
  // Subscribes via useRadioStore.subscribe so the interval reacts to
  // play/pause without a re-render loop. The store reference itself is
  // stable across the component's lifetime, so the empty deps array is
  // intentional — this effect mounts/unmounts with the hydrator.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startHeartbeat = () => {
      if (intervalId !== null) return;
      // First tick after 60s, not immediately — page_view already covers the
      // "user is here" signal at t=0.
      intervalId = setInterval(() => {
        const s = useRadioStore.getState();
        if (s.playback.status !== "playing") return;
        trackSessionHeartbeat(s.currentStationId ?? null);
      }, 60_000);
    };
    const stopHeartbeat = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    // Sync to current state (in case audio was already playing on mount).
    if (useRadioStore.getState().playback.status === "playing") {
      startHeartbeat();
    }

    // React to status changes. The selector returns the status string so the
    // listener only fires when it actually changes — not on every store write.
    const unsubscribe = useRadioStore.subscribe((s, prev) => {
      const status = s.playback.status;
      const prevStatus = prev.playback.status;
      if (status === prevStatus) return;
      if (status === "playing") startHeartbeat();
      else stopHeartbeat();
    });

    return () => {
      stopHeartbeat();
      unsubscribe();
    };
  }, []);

  return <>{children}</>;
}
