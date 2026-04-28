"use client";

import { useEffect, useRef } from "react";
import { useRadioStore } from "@/lib/store";
import {
  ensureAnonSession,
  subscribeToAuthChanges,
} from "@/lib/supabase/client";
import { pullFromCloud, syncToCloud } from "@/lib/supabase/sync";
import { CURRENT_VERSION } from "@/lib/storage";

export default function StoreHydrator({
  children,
}: {
  children: React.ReactNode;
}) {
  const hydrate = useRadioStore((s) => s.hydrate);
  const setUser = useRadioStore((s) => s.setUser);
  const applyCloudSnapshot = useRadioStore((s) => s.applyCloudSnapshot);
  const restoreEmptySeedBands = useRadioStore((s) => s.restoreEmptySeedBands);

  // Tracks the uid we currently believe we're acting as. Used by the
  // auth-change subscriber to detect a true cross-device sign-in (uid
  // changes) vs an in-place anon→permanent upgrade (uid stays the same).
  const knownUidRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Load IndexedDB into the store first so the UI renders instantly
      //    with whatever state the device had, independent of network latency.
      await hydrate();
      if (cancelled) return;

      // 2. Bootstrap Supabase session (creates anon user on first visit).
      const user = await ensureAnonSession();
      if (cancelled || !user) return;
      setUser(user);
      knownUidRef.current = user.id;
      // eslint-disable-next-line no-console
      console.log(
        "[supabase] session uid =",
        user.id,
        user.isAnonymous ? "(anonymous)" : "",
      );

      // 3. Pull-or-seed: if the user has cloud data, pull it into the store
      //    (cloud wins); otherwise push the local seed up as the initial
      //    snapshot.
      const cloud = await pullFromCloud(user.id);
      if (cancelled) return;
      if (cloud) {
        applyCloudSnapshot(cloud);
        // eslint-disable-next-line no-console
        console.log(
          "[sync] pulled cloud snapshot:",
          cloud.stations.length,
          "stations,",
          cloud.groups.length,
          "groups",
        );
      } else {
        const s = useRadioStore.getState();
        await syncToCloud(user.id, {
          stations: s.stations,
          groups: s.groups,
          memberships: s.memberships,
          activeGroupId: s.activeGroupId,
          currentStationId: s.currentStationId,
          volume: s.volume,
          version: CURRENT_VERSION,
        });
        // eslint-disable-next-line no-console
        console.log("[sync] initial cloud seed complete");
      }

      // 4. Idempotent data repair: any seed-default band that exists in the
      //    user's library but has zero memberships gets its seed memberships
      //    restored. Runs after step 3 so it sees the truly active state
      //    (cloud snapshot applied, or local seed pushed up). No-op when
      //    every default band still has at least one station.
      if (cancelled) return;
      await restoreEmptySeedBands();
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrate, setUser, applyCloudSnapshot, restoreEmptySeedBands]);

  // Subscribe to Supabase auth changes so the store stays in sync with the
  // live session. Fires on:
  //   - email confirmation link → anon user promoted to permanent (same uid,
  //     now has email + isAnonymous:false), UI should flip Account drawer
  //     from "guest" to "signed in" without reload
  //   - magic-link sign-in (M6) → uid changes from this device's anon to the
  //     existing permanent uid; we pull cloud and overwrite local state so
  //     the user's synced library replaces this device's guest library
  //   - sign-out → clears user; next ensureAnonSession (on reload) mints a
  //     fresh anon uid
  //   - token refresh → refreshed user payload, no visible change
  //
  // Kept separate from the bootstrap effect so the subscription lifecycle is
  // independent of initial hydration (and doesn't get torn down if the
  // bootstrap deps somehow re-ran).
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (user) => {
      if (user) {
        const previousUid = knownUidRef.current;
        setUser(user);
        knownUidRef.current = user.id;

        // True cross-device sign-in: uid changed. Pull the signed-in user's
        // library from cloud and overwrite this device's local state. The
        // prior anon uid's local data (and any rows it pushed under that
        // anon uid) is intentionally discarded — sign-in is overwrite, not
        // merge.
        if (previousUid && previousUid !== user.id) {
          // eslint-disable-next-line no-console
          console.log(
            "[sync] auth uid changed",
            previousUid,
            "→",
            user.id,
            "— pulling cloud snapshot",
          );
          const cloud = await pullFromCloud(user.id);
          if (cloud) {
            applyCloudSnapshot(cloud);
            // eslint-disable-next-line no-console
            console.log(
              "[sync] applied cloud snapshot:",
              cloud.stations.length,
              "stations,",
              cloud.groups.length,
              "groups",
            );
            // Re-run the empty-seed-band repair against the freshly pulled
            // library — same rationale as on initial bootstrap.
            await restoreEmptySeedBands();
          }
        }
        return;
      }
      // Sign-out fired. Mint a fresh anon session so the app keeps working
      // as a guest without requiring a page reload. The new anon uid starts
      // with an empty cloud slate — next schedulePersist will seed it.
      const fresh = await ensureAnonSession();
      if (fresh) {
        setUser(fresh);
        knownUidRef.current = fresh.id;
      } else {
        knownUidRef.current = null;
      }
    });
    return unsubscribe;
  }, [setUser, applyCloudSnapshot, restoreEmptySeedBands]);

  return <>{children}</>;
}
