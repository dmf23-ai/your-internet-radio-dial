"use client";

import { useEffect } from "react";
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
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrate, setUser, applyCloudSnapshot]);

  // Subscribe to Supabase auth changes so the store stays in sync with the
  // live session. Fires on:
  //   - email confirmation link → anon user promoted to permanent (same uid,
  //     now has email + isAnonymous:false), UI should flip Account drawer
  //     from "guest" to "signed in" without reload
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
        setUser(user);
        return;
      }
      // Sign-out fired. Mint a fresh anon session so the app keeps working
      // as a guest without requiring a page reload. The new anon uid starts
      // with an empty cloud slate — next schedulePersist will seed it.
      const fresh = await ensureAnonSession();
      if (fresh) setUser(fresh);
    });
    return unsubscribe;
  }, [setUser]);

  return <>{children}</>;
}
