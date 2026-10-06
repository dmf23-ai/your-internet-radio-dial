"use client";

// The "add new stations" offer, shared by the cabinet plaque (Console) and
// the search overlay's callout so both show it under the same conditions
// and with the same wording.

import { useMemo } from "react";
import { useRadioStore } from "@/lib/store";
import {
  defaultsOffer,
  type BandPlacement,
  type DefaultsOffer,
} from "@/lib/lineup";

/**
 * What the button would add, or null when there's nothing to offer. Only
 * customized libraries get the offer (untouched ones are updated
 * automatically), and only once the startup cloud step has settled: the
 * pull can replace the library, and the reconcile resolves its markers.
 */
export function useDefaultsOffer(): DefaultsOffer | null {
  const cloudSettled = useRadioStore((s) => s.cloudSettled);
  const customizedAt = useRadioStore((s) => s.customizedAt);
  const seedVersion = useRadioStore((s) => s.seedVersion);
  const stations = useRadioStore((s) => s.stations);
  const groups = useRadioStore((s) => s.groups);
  return useMemo(() => {
    if (!cloudSettled || customizedAt === null || seedVersion === null) {
      return null;
    }
    const offer = defaultsOffer({ stations, groups }, seedVersion);
    return offer.stations.length > 0 || offer.bands.length > 0 ? offer : null;
  }, [cloudSettled, customizedAt, seedVersion, stations, groups]);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "5 new stations + 1 new band" */
export function offerPhrase(stations: number, bands: number): string {
  return [
    stations > 0 ? plural(stations, "new station") : null,
    bands > 0 ? plural(bands, "new band") : null,
  ]
    .filter(Boolean)
    .join(" + ");
}

/** "FM USA (new band, 24 stations), Exploratorium +2" */
export function placementsPhrase(placements: BandPlacement[]): string {
  return placements
    .map((b) =>
      b.created
        ? `${b.name} (new band, ${plural(b.count, "station")})`
        : `${b.name} +${b.count}`,
    )
    .join(", ");
}
