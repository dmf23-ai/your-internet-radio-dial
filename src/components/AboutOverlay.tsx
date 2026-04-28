"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRadioStore } from "@/lib/store";

/**
 * AboutOverlay — centered modal card showing the "About / How to Use"
 * copy. Triggered by the brass question-mark button in the upper-right
 * of the cabinet (rendered from Console). Styled to match the cabinet's
 * visual family: dark wood gradient card, brass accents, ink-on-ivory
 * body copy for readable long-form text.
 */
export default function AboutOverlay() {
  const open = useRadioStore((s) => s.ui.aboutOpen);
  const setOpen = useRadioStore((s) => s.setAboutOpen);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="about-overlay"
          className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="About Your Internet Radio Dial"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/65"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="relative w-full max-w-[560px] max-h-[85vh] rounded-[18px] flex flex-col overflow-hidden"
            style={{
              background:
                "linear-gradient(180deg, #2a1810 0%, #1a0f08 100%)",
              border: "1px solid rgba(0,0,0,0.6)",
              boxShadow:
                "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,200,140,0.08) inset",
            }}
          >
            {/* Header — brass plaque + close */}
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 shrink-0"
              style={{
                borderBottom: "1px solid rgba(0,0,0,0.55)",
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 100%)",
              }}
            >
              <div className="px-4 py-1 rounded-full surface-brass text-walnut-900 font-display text-[11px] sm:text-xs tracking-[0.25em] uppercase">
                About &amp; How to Use
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-full flex items-center justify-center transition-transform active:translate-y-[1px] shrink-0"
                style={brassIconStyle}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <line
                    x1="2"
                    y1="2"
                    x2="12"
                    y2="12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <line
                    x1="12"
                    y1="2"
                    x2="2"
                    y2="12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {/* Body — ink on ivory card, like a printed service manual. */}
            <div
              className="flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7 text-ink leading-relaxed"
              style={{
                background:
                  "radial-gradient(ellipse at top, #f3e5c4 0%, #e8d6a8 100%)",
              }}
            >
              <Section title="A Warm Welcome">
                Dear listeners, so glad you found us.{" "}
                <em className="italic">Your Internet Radio Dial</em> is a
                hand-crafted radio receiver for the internet age, curated
                yet customizable. Turn the knob and let the amber glow
                carry you where the signal leads.
              </Section>

              <Section title="The Power Switch">
                The brass-rimmed lamp at the upper-left switches the set on
                and off. Press it once to begin; press it again to silence
                the room. The lamp burns amber while a station plays.
              </Section>

              <Section title="To Tune the Dial">
                The larger brass knob on the right glides you from one
                station to the next. On the cream ticker-tape beneath the
                needle, you may also drag the station names left or right —
                the needle stays fixed; the names roll beneath it. Click
                any visible name to jump straight to it.
              </Section>

              <Section title="The Station Card">
                Beneath the dial sits a small grey pill that names the
                current station and what it is broadcasting. Click it for
                a fuller picture — the station&apos;s home, its country
                and language, its bitrate and format, and a copy of its
                stream address for the technically-minded. Press{" "}
                <em className="italic">Esc</em> to return to your listening.
              </Section>

              <Section title="The Volume Knob">
                On the left of the cabinet, the smaller knob controls the
                volume. Turn it clockwise to raise the sound; counter-
                clockwise to lower it. The needle on the meter beside it
                rises and falls with the music itself.
              </Section>

              <Section title="The On-Air Lamp">
                Between the dial face above and the band ribbon below, a
                small lamp keeps faithful watch. It burns steady amber
                while a station is on air, pulses softly while the signal
                is being tuned, and falls dark when the set is silent.
                Should the signal ever be lost, it turns a quiet red.
              </Section>

              <Section title="Bands, Your Preset Buttons">
                The dark bar below the dial holds your{" "}
                <em className="italic">bands</em> — collections of stations
                grouped however suits you. Click any band to bring its
                stations onto the dial. With more bands than the bar can
                hold, drag the row sideways or tap the brass arrows at
                either end. The vertical brass labels{" "}
                <strong className="font-semibold">RADIO</strong> and{" "}
                <strong className="font-semibold">BANDS</strong> flank the
                bar to keep your bearings.
              </Section>

              <Section title="Finding New Stations">
                The brass magnifier at the left of the band bar opens the
                Search. The two tabs at the top let you choose your method:
                <br />
                <strong className="font-semibold">Search Directory</strong>{" "}
                — Enter a name, a city, a feeling —{" "}
                <em className="italic">
                  &ldquo;jazz,&rdquo; &ldquo;Tokyo,&rdquo; &ldquo;BBC&rdquo;
                </em>{" "}
                — and pick from the results.
                <br />
                <strong className="font-semibold">By URL</strong> — If you
                already know a stream&apos;s address, paste it here with a
                name of your choosing.
                <br />
                Either way, choose the band your new station shall join.
              </Section>

              <Section title="Curating Your Bands">
                To rename, reorder, or remove an existing band,{" "}
                <em className="italic">long-press</em> (hold the button for
                half a second) — or, on a desktop, right-click. A small
                editor appears with all the controls you need. Below the
                band bar, the{" "}
                <strong className="font-semibold">+ New Band</strong> plaque
                creates a fresh, empty band.
              </Section>

              <Section title="The Station Drawer">
                The brass three-line button at the right of the band bar
                opens a drawer of every station in the current band. From
                there you may jump straight to a station, change its
                position in the band, or remove it from the band entirely.
              </Section>

              <Section title="A Portable Library">
                The brass person-icon at the left of the band bar opens
                your Account. As a guest, your library is kept on this
                device alone — close the browser and it remains; open it
                elsewhere and it does not follow.
                <br />
                Provide your email address and we will send a confirmation
                link. Click it, and your library will travel with you to
                every device you sign in from. Already signed up on another
                device? Use the{" "}
                <em className="italic">&ldquo;sign in instead&rdquo;</em>{" "}
                link to load your synced library here. The small red dot
                on the person-icon is a gentle reminder that you are yet a
                guest.
              </Section>

              <Section title="Drift / Scan">
                On the right of the speaker grille, the brass{" "}
                <strong className="font-semibold">SCAN</strong> button
                wanders the airwaves on your behalf — every twelve seconds
                it tunes to a fresh station drawn from any of your bands.
                The lamp beside it pulses while a drift is in progress.
                Tune the dial yourself, or press the button again, to bring
                the wandering to a halt.
              </Section>

              <Section title="The Doze Plaque">
                On the left of the speaker grille, the small{" "}
                <strong className="font-semibold">DOZE</strong> plaque is a
                sleep timer for the late hour. Select a fifteen, thirty,
                sixty, or ninety minute countdown. While running, the
                plaque shows the time remaining; in the final thirty
                seconds the volume slowly falls to a hush before the set
                switches itself off. Double-click to cancel at any moment.
              </Section>

              <Section title="The Suggestion Box">
                Centered at the top of the cabinet — between the power
                switch on the left and the question mark on the right —
                you will find a small brass{" "}
                <strong className="font-semibold">Suggestion Box</strong>,
                mounted like the post-box of old. Drop your thoughts
                through the slot — propose a station for the default
                library, or share any other notion with the workshop. We
                read every one.
              </Section>

              <Section title="And That's the Whole of It">
                Turn the knob, settle into your favorite chair, and travel
                on waves of sound across the great Web. Bon voyage!
              </Section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="font-display uppercase tracking-[0.22em] text-[11px] sm:text-xs text-walnut-700 mb-1.5">
        {title}
      </h3>
      <p className="text-[13px] sm:text-sm leading-relaxed text-ink/90">
        {children}
      </p>
    </section>
  );
}

const brassIconStyle: React.CSSProperties = {
  background:
    "radial-gradient(circle at 30% 25%, #f0d9a8 0%, #b48a49 55%, #5a3f1a 100%)",
  boxShadow:
    "inset 0 1px 2px rgba(255,240,200,0.6), inset 0 -2px 3px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
  color: "#1a120a",
};
