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
                Good evening, dear listener.{" "}
                <em className="italic">Your Internet Radio Dial</em> is a
                hand-crafted receiver for the broadcasts traveling the
                world-wide web. Turn the knob and let the amber glow carry
                you where the signal leads.
              </Section>

              <Section title="To Tune the Dial">
                The brass knob on the right glides you from one station to
                the next. On the cream ticker-tape beneath the needle, drag
                the names left or right — the needle stays fixed, the
                stations roll beneath it. Click any visible name to jump
                straight to it.
              </Section>

              <Section title="Bands, Your Preset Buttons">
                Below the dial, your{" "}
                <em className="italic">bands</em> are collections of stations
                grouped however suits you. Click one to bring its stations
                onto the dial. When you have more bands than the bar can
                hold, drag the row sideways or tap the brass arrows at
                either end.
              </Section>

              <Section title="Finding New Stations">
                The brass magnifier at the far left of the preset bar opens
                the Search. Enter a name, a city, a feeling —{" "}
                <em className="italic">
                  &ldquo;jazz,&rdquo; &ldquo;Tokyo,&rdquo; &ldquo;BBC&rdquo;
                </em>{" "}
                — and pick from the results. Your choice joins the band of
                your choosing.
              </Section>

              <Section title="Curating Your Bands">
                The <strong className="font-semibold">New Band</strong>{" "}
                plaque below the preset bar creates a fresh band. Long-press
                (or right-click) any band button to rename, reorder, or
                remove it. The brass lines-icon at the far right opens a
                drawer of every station in the current band — to reorder,
                remove, or jump to one.
              </Section>

              <Section title="Your Identity on the Air">
                The brass person-icon opens your Account. As a guest, your
                library is kept on this device alone. Add your email address
                and your stations will travel with you from device to
                device. The small red dot is a gentle reminder that you are
                yet a guest.
              </Section>

              <Section title="And That's the Whole of It">
                Turn the knob, settle into your favorite chair, and let the
                airwaves do the rest. Happy listening.
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
