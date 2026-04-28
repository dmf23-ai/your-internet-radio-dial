"use client";

import DialWindow from "./DialWindow";
import TunerKnob from "./TunerKnob";
import VolumeKnob from "./VolumeKnob";
import VUMeter from "./VUMeter";
import SpeakerGrille from "./SpeakerGrille";
import PresetBar from "./PresetBar";
import SearchOverlay from "./SearchOverlay";
import StationListDrawer from "./StationListDrawer";
import AccountDrawer from "./AccountDrawer";
import AboutOverlay from "./AboutOverlay";
import SuggestionBoxOverlay from "./SuggestionBoxOverlay";
import StationDetailCard from "./StationDetailCard";
import TonePanel from "./TonePanel";
import DozePlaque from "./DozePlaque";
import ScanButton from "./ScanButton";
import { PowerButton, OnAirLamp } from "./Lamps";
import { useRadioStore } from "@/lib/store";

/**
 * Console — the static cabinet frame.
 * This is the visual shell for Milestone 1.
 * Interactions (tuning, playback, VU) are wired in later milestones.
 */
export default function Console() {
  const setAboutOpen = useRadioStore((s) => s.setAboutOpen);
  const setSuggestionBoxOpen = useRadioStore((s) => s.setSuggestionBoxOpen);

  return (
    <div className="w-full max-w-[1100px]">
      {/* Outer wooden cabinet */}
      <div
        className="surface-wood relative rounded-[28px] p-5 sm:p-8 shadow-2xl"
        style={{
          border: "2px solid rgba(0,0,0,0.55)",
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,200,140,0.08) inset",
        }}
      >
        {/* Corner screws — both upper screws omitted to clear room for the
            POWER button (upper-left) and "?" button (upper-right) which now
            sit closer to the cabinet's top edges. */}
        <div className="brass-screw absolute bottom-3 left-3" />
        <div className="brass-screw absolute bottom-3 right-3" />

        {/* Suggestion Box mail-slot — mounted at the top of the cabinet,
            centered horizontally between the POWER button (upper-left) and
            the "?" button (upper-right). Brass face plate with four corner
            screws, a textured recessed slot suggesting an inner brass lip
            and a glimpse of the flap beyond, and an engraved "Suggestion
            Box" label beneath. */}
        <button
          type="button"
          onClick={() => setSuggestionBoxOpen(true)}
          aria-label="Suggestion Box"
          title="Drop a suggestion in the slot"
          className="absolute top-2.5 sm:top-3.5 left-1/2 -translate-x-1/2 z-10 transition-transform active:translate-y-[1px]"
          style={{
            width: 144,
            padding: "7px 12px 5px",
            borderRadius: 5,
            background:
              "linear-gradient(180deg, #d4a754 0%, #b48a49 45%, #8a6327 100%)",
            boxShadow:
              "inset 0 1px 2px rgba(255,240,200,0.7), inset 0 -2px 3px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.5)",
          }}
        >
          {/* Four corner screws */}
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
                width: 5,
                height: 5,
                background:
                  "radial-gradient(circle at 35% 30%, #f0d9a8 0%, #8a6327 70%, #3a280f 100%)",
                boxShadow:
                  "inset 0 0 0 0.5px rgba(0,0,0,0.6), 0 1px 1px rgba(0,0,0,0.4)",
              }}
            />
          ))}

          {/* The mail slot — deep dark recess with horizontal grain, a brass
              lip catching light at the top inner edge, and a faint glimpse of
              an inner flap beyond. */}
          <div
            aria-hidden
            className="relative mx-auto rounded-[2px] overflow-hidden"
            style={{
              width: "82%",
              height: 11,
              background:
                "repeating-linear-gradient(180deg, transparent 0px, transparent 1px, rgba(80,55,30,0.08) 1px, rgba(80,55,30,0.08) 2px), linear-gradient(180deg, #1f140d 0%, #050302 30%, #050302 65%, #14100a 90%, #2a1810 100%)",
              boxShadow:
                "inset 0 2px 3px rgba(0,0,0,0.95), inset 0 0 0 1px rgba(120,80,40,0.35), 0 1px 0 rgba(255,240,200,0.45)",
            }}
          >
            {/* Brass lip catching light at the top inner edge */}
            <div
              className="absolute inset-x-0 top-0"
              style={{
                height: 1,
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(220,170,95,0.55) 25%, rgba(245,195,115,0.75) 50%, rgba(220,170,95,0.55) 75%, transparent 100%)",
              }}
            />
            {/* Faint glimpse of an inner flap, set in from the edges */}
            <div
              className="absolute"
              style={{
                left: "22%",
                right: "22%",
                top: "60%",
                height: 1,
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(140,95,45,0.55) 30%, rgba(170,120,60,0.6) 50%, rgba(140,95,45,0.55) 70%, transparent 100%)",
              }}
            />
          </div>

          {/* Engraved label — solid black ink with a softened highlight so
              the letters read crisp against the brass. */}
          <div
            className="font-display tracking-[0.14em] uppercase text-center mt-1.5"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#000",
              textShadow:
                "0 1px 0 rgba(255,240,200,0.35), 0 0 0.5px rgba(0,0,0,0.95), 0 0 1.5px rgba(0,0,0,0.55)",
            }}
          >
            Suggestion Box
          </div>
        </button>

        {/* POWER — mounted on the cabinet's upper-left corner, mirroring
            the "?" button on the upper-right. The brass-rimmed lamp sits
            in the corner; the "POWER" wordmark extends inward. */}
        <div className="absolute top-2.5 left-3 sm:top-3.5 sm:left-4 z-10">
          <PowerButton />
        </div>

        {/* Brass "?" — About / How to Use. Sized to match the preset-bar
            brass icon family (40px) so it reads as a peer control rather than
            a tucked-away accent. The inner brass ring around the glyph
            reinforces "circled glyph = information" without adding a label. */}
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          aria-label="About &amp; how to use"
          title="About &amp; how to use"
          className="absolute top-2.5 right-3 sm:top-3.5 sm:right-4 w-10 h-10 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px] z-10"
          style={{
            background:
              "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
            boxShadow:
              "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)",
            color: "#1a120a",
          }}
        >
          {/* Inner etched ring — "circled glyph" = information cue */}
          <span
            aria-hidden
            className="absolute inset-1.5 rounded-full pointer-events-none"
            style={{
              boxShadow:
                "inset 0 0 0 1px rgba(20,12,6,0.45), inset 0 0 0 2px rgba(255,240,200,0.18)",
            }}
          />
          <span className="relative font-display text-[19px] leading-none font-bold pb-px">
            ?
          </span>
        </button>

        {/* Maker's plate — pushed down so it clears the top row of cabinet
            controls (POWER · SUGGESTION BOX · ?). */}
        <div className="flex justify-center mt-10 sm:mt-11 mb-2 sm:mb-3">
          <div className="px-4 py-1 rounded-full surface-brass text-walnut-900 font-display text-sm sm:text-base tracking-[0.25em] uppercase">
            Your Internet Radio Dial
          </div>
        </div>

        {/* Main console layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-7">
          {/* Left column: volume + VU on mobile goes top */}
          <div className="md:col-span-3 flex md:flex-col items-center justify-around gap-3 order-2 md:order-1">
            <VUMeter />
            <VolumeKnob />
          </div>

          {/* Center: dial window + ON AIR lamp. The lamp sits in a flex-1
              spacer below the dial; in the desktop layout the row stretches
              to match the taller volume column on the left, so the lamp
              vertically centers in the empty space between the dial face
              and the band ribbon below. */}
          <div className="md:col-span-6 order-1 md:order-2 flex flex-col">
            <DialWindow />
            <div className="flex-1 flex items-center justify-center mt-3">
              <OnAirLamp />
            </div>
          </div>

          {/* Right column: tuning knob */}
          <div className="md:col-span-3 flex items-center justify-center order-3">
            <TunerKnob />
          </div>
        </div>

        {/* Preset / group bar + search + menu */}
        <div className="mt-6 sm:mt-7">
          <PresetBar />
        </div>

        {/* Speaker grille below */}
        <div className="mt-5 sm:mt-6">
          <SpeakerGrille />
        </div>

        {/* Service-controls strip — Doze (sleep timer) on the left, Tone
            (Bass/Treble) in the middle, Drift/Scan on the right. Sits as a
            unified band of brass-on-walnut auxiliary controls below the
            speaker grille and above the maker-plate footer. */}
        <div className="mt-5 sm:mt-6 flex flex-wrap items-start justify-between gap-3 sm:gap-5">
          <DozePlaque />
          <TonePanel />
          <ScanButton />
        </div>

      </div>

      {/* Overlays — rendered at cabinet root so they float above everything */}
      <SearchOverlay />
      <StationListDrawer />
      <AccountDrawer />
      <AboutOverlay />
      <SuggestionBoxOverlay />
      <StationDetailCard />
    </div>
  );
}
