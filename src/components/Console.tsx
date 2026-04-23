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
import { PowerButton, OnAirLamp } from "./Lamps";
import { useRadioStore } from "@/lib/store";

/**
 * Console — the static cabinet frame.
 * This is the visual shell for Milestone 1.
 * Interactions (tuning, playback, VU) are wired in later milestones.
 */
export default function Console() {
  const setAboutOpen = useRadioStore((s) => s.setAboutOpen);

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
        {/* Corner screws */}
        <div className="brass-screw absolute top-3 left-3" />
        <div className="brass-screw absolute top-3 right-3" />
        <div className="brass-screw absolute bottom-3 left-3" />
        <div className="brass-screw absolute bottom-3 right-3" />

        {/* Brass "?" — About / How to Use. Tucked into the upper-right of
            the cabinet beside the corner screw. */}
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          aria-label="About &amp; how to use"
          title="About &amp; how to use"
          className="absolute top-2 right-5 sm:top-3 sm:right-6 w-7 h-7 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px] z-10"
          style={{
            background:
              "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
            boxShadow:
              "inset 0 1px 1.5px rgba(255,240,200,0.6), inset 0 -1.5px 2px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.6)",
            color: "#1a120a",
          }}
        >
          <span className="font-display text-[14px] leading-none font-bold pb-px">
            ?
          </span>
        </button>

        {/* Maker's plate */}
        <div className="flex justify-center mb-3 sm:mb-5">
          <div className="px-4 py-1 rounded-full surface-brass text-walnut-900 font-display text-sm sm:text-base tracking-[0.25em] uppercase">
            Your Internet Radio Dial
          </div>
        </div>

        {/* Main console layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-7">
          {/* Left column: volume + VU on mobile goes top */}
          <div className="md:col-span-3 flex md:flex-col items-center justify-around gap-5 order-2 md:order-1">
            <VUMeter />
            <VolumeKnob />
          </div>

          {/* Center: dial window */}
          <div className="md:col-span-6 order-1 md:order-2">
            <DialWindow />
          </div>

          {/* Right column: tuning knob */}
          <div className="md:col-span-3 flex items-center justify-center order-3">
            <TunerKnob />
          </div>
        </div>

        {/* Preset / group bar + search + menu */}
        <div className="mt-5 sm:mt-6">
          <PresetBar />
        </div>

        {/* Speaker grille below */}
        <div className="mt-5 sm:mt-6">
          <SpeakerGrille />
        </div>

        {/* Footer: Power button + maker plate + On Air lamp */}
        <div className="mt-5 flex items-center justify-between">
          <PowerButton />
          <div className="font-display italic text-brass-300 text-sm sm:text-base tracking-wide">
            Model No. 1 · Est. 2026
          </div>
          <OnAirLamp />
        </div>
      </div>

      {/* Overlays — rendered at cabinet root so they float above everything */}
      <SearchOverlay />
      <StationListDrawer />
      <AccountDrawer />
      <AboutOverlay />
    </div>
  );
}
