"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRadioStore, type DefaultsAdded } from "@/lib/store";
import {
  offerPhrase,
  placementsPhrase,
  useDefaultsOffer,
} from "@/lib/useDefaultsOffer";

/**
 * NewStationsPlaque — the cabinet's "add new stations" button, mounted to
 * the right of the Suggestion Box. It appears under the same conditions as
 * the search overlay's callout (useDefaultsOffer: a customized library that
 * lacks default stations or bands added since its lineup). A brass plate in
 * the Suggestion Box's family with an amber pilot lamp; one press adds
 * everything on offer, a cream ticket underneath says where it all went,
 * and the plaque bows out.
 *
 * Below 568px wide (portrait phones) the gap between the Suggestion Box and
 * the "?" is too narrow for the plaque, so a round brass badge stands in.
 * The slot's position (and where it gives up) lives in globals.css
 * (.new-stations-slot).
 */

// How long the confirmation stays up before the plaque leaves.
const CONFIRM_MS = 6000;

const plateStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #d4a754 0%, #b48a49 45%, #8a6327 100%)",
  boxShadow:
    "inset 0 1px 2px rgba(255,240,200,0.7), inset 0 -2px 3px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.5)",
};

const engraved: React.CSSProperties = {
  color: "#000",
  textShadow:
    "0 1px 0 rgba(255,240,200,0.35), 0 0 0.5px rgba(0,0,0,0.95), 0 0 1.5px rgba(0,0,0,0.55)",
};

export default function NewStationsPlaque() {
  const offer = useDefaultsOffer();
  const addNewDefaultStations = useRadioStore((s) => s.addNewDefaultStations);
  const [added, setAdded] = useState<DefaultsAdded | null>(null);

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [added]);

  const handleAdd = () => {
    const result = addNewDefaultStations();
    if (result) setAdded(result);
  };

  const stations = offer?.stations.length ?? 0;
  const bands = offer?.bands.length ?? 0;
  const label = offer
    ? `Add ${offerPhrase(stations, bands)} from the default lineup`
    : "";
  const confirmation = added
    ? `Added ${offerPhrase(added.stations, added.bands)} from the default lineup: ${placementsPhrase(added.placements)}.`
    : "";

  return (
    <AnimatePresence>
      {(offer || added) && (
        <motion.div
          key="new-stations"
          className="new-stations-slot absolute top-2.5 sm:top-3.5 z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* Plaque (568px and wider) */}
          <button
            type="button"
            onClick={handleAdd}
            disabled={!!added}
            aria-label={added ? "New stations added" : label}
            title={added ? confirmation : label}
            className="relative hidden min-[568px]:flex items-center gap-2 transition-[transform,filter] active:translate-y-[1px] enabled:hover:brightness-110 disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
            style={{
              ...plateStyle,
              width: 124,
              height: 44,
              padding: "0 9px 0 10px",
              borderRadius: 5,
            }}
          >
            <Screws />
            <PilotLamp done={!!added} size={10} />
            <span className="flex flex-col items-start text-left font-display uppercase leading-[1.15] min-w-0">
              <span
                className="tracking-[0.1em] whitespace-nowrap"
                style={{ ...engraved, fontSize: 10.5, fontWeight: 700 }}
              >
                {added ? "Added" : stations > 0 ? "New Stations" : bands > 1 ? "New Bands" : "New Band"}
              </span>
              <span
                className="tracking-[0.08em] whitespace-nowrap lining-nums"
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "rgba(20,12,6,0.88)",
                  textShadow: "0 1px 0 rgba(255,240,200,0.3)",
                }}
              >
                {added
                  ? "to your bands"
                  : [
                      stations > 0 ? `Add ${stations}` : "Add",
                      bands > 0
                        ? `${stations > 0 ? "+ " : ""}${bands} band${bands === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
              </span>
            </span>
          </button>

          {/* Badge (narrower than 568px) */}
          <button
            type="button"
            onClick={handleAdd}
            disabled={!!added}
            aria-label={added ? "New stations added" : label}
            title={added ? confirmation : label}
            className="relative flex min-[568px]:hidden w-8 h-8 rounded-full items-center justify-center transition-transform active:translate-y-[1px] disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
            style={{
              background:
                "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
              boxShadow:
                "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)",
              color: "#1a120a",
            }}
          >
            {added ? (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M3 8.5 L6.5 12 L13 4.5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <span className="font-numerals text-[13px] leading-none pb-px">
                +{stations > 0 ? stations : ""}
              </span>
            )}
            <span className="absolute -top-1.5 -right-1.5">
              <PilotLamp done={!!added} size={7} />
            </span>
          </button>

          {/* Confirmation ticket */}
          <AnimatePresence>
            {added && (
              <motion.div
                key="ticket"
                aria-hidden
                className="absolute right-0 top-full mt-2 w-[230px] rounded-md px-3 py-2 text-ink pointer-events-none"
                style={{
                  background:
                    "radial-gradient(ellipse at top, #f3e5c4 0%, #e8d6a8 100%)",
                  border: "1px solid rgba(0,0,0,0.5)",
                  boxShadow:
                    "0 8px 20px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.4)",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <span className="block font-display uppercase tracking-[0.18em] text-[10px] text-walnut-700 mb-0.5">
                  Added to your dial
                </span>
                <span className="block text-[11px] leading-snug">
                  {offerPhrase(added.stations, added.bands)}:{" "}
                  {placementsPhrase(added.placements)}.
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <span className="sr-only" role="status" aria-live="polite">
            {confirmation}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Four corner screws, as on the Suggestion Box. */
function Screws() {
  return (
    <>
      {[
        { top: 3, left: 3 },
        { top: 3, right: 3 },
        { bottom: 3, left: 3 },
        { bottom: 3, right: 3 },
      ].map((pos, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute rounded-full"
          style={{
            ...pos,
            width: 4,
            height: 4,
            background:
              "radial-gradient(circle at 35% 30%, #f0d9a8 0%, #8a6327 70%, #3a280f 100%)",
            boxShadow:
              "inset 0 0 0 0.5px rgba(0,0,0,0.6), 0 1px 1px rgba(0,0,0,0.4)",
          }}
        />
      ))}
    </>
  );
}

/**
 * Amber pilot lamp in a dark socket: lit while new stations wait (its glow
 * breathes, unless the visitor prefers reduced motion), green once they're
 * in.
 */
function PilotLamp({ done, size }: { done: boolean; size: number }) {
  const glow = done ? "rgba(150,210,110,0.9)" : "rgba(255,179,71,0.95)";
  return (
    <span
      aria-hidden
      className="relative inline-flex items-center justify-center rounded-full shrink-0"
      style={{
        width: size + 5,
        height: size + 5,
        background: "radial-gradient(circle at 40% 35%, #3a280f 0%, #120a04 100%)",
        boxShadow:
          "inset 0 1px 2px rgba(0,0,0,0.9), 0 1px 0 rgba(255,240,200,0.45)",
      }}
    >
      {!done && (
        <span
          className="absolute inset-0 rounded-full motion-safe:animate-pulse"
          style={{ boxShadow: `0 0 9px 2px ${glow}` }}
        />
      )}
      <span
        className="relative rounded-full"
        style={{
          width: size,
          height: size,
          background: done
            ? "radial-gradient(circle at 35% 30%, #efffd8 0%, #9fd27a 55%, #4f7a2e 100%)"
            : "radial-gradient(circle at 35% 30%, #ffe7a8 0%, #ffb347 55%, #b56a16 100%)",
          boxShadow: `0 0 6px ${glow}, inset 0 0 2px rgba(255,240,200,0.8)`,
        }}
      />
    </span>
  );
}
