"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * RotateOverlay — full-viewport "please rotate to landscape" notice for
 * phones held in portrait.
 *
 * Why an overlay and not orientation-lock: browsers only allow
 * `screen.orientation.lock()` when the document is in fullscreen mode (and
 * iOS Safari doesn't support it at all). For a regular web page this is
 * the standard nudge.
 *
 * Detection: portrait orientation + small viewport + coarse pointer. The
 * coarse-pointer clause filters out a desktop window narrowed to phone
 * width (where the user is testing, not actually on a touch device).
 *
 * Dismissal: user can tap "Continue in portrait anyway" to hide for this
 * portrait session. If they rotate to landscape and back to portrait, the
 * overlay returns (we reset `dismissed` whenever `shouldShow` falls).
 */
export default function RotateOverlay() {
  const [shouldShow, setShouldShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(
      "(orientation: portrait) and (max-width: 820px) and (pointer: coarse)",
    );
    const update = () => setShouldShow(mq.matches);
    update();
    // addEventListener is the modern API; older Safari needs addListener
    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    } else {
      mq.addListener(update);
      return () => mq.removeListener(update);
    }
  }, []);

  // Reset dismissal whenever we leave portrait, so a rotate-out-and-back
  // shows the overlay again.
  useEffect(() => {
    if (!shouldShow) setDismissed(false);
  }, [shouldShow]);

  const visible = shouldShow && !dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="rotate-overlay"
          className="fixed inset-0 z-[100] flex items-center justify-center px-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-modal="true"
          aria-label="Rotate your device"
          style={{
            background:
              "radial-gradient(ellipse at center, #2a1810 0%, #120a04 75%, #0a0604 100%)",
          }}
        >
          <div className="flex flex-col items-center gap-7 max-w-sm text-center">
            <RotateIcon />

            <div className="flex flex-col gap-2.5">
              <h2 className="font-display uppercase tracking-[0.22em] text-brass-300 text-base">
                Rotate your device
              </h2>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "#e9d8ad" }}
              >
                Your Internet Radio Dial is built for landscape — turn your
                phone sideways for the full cabinet view.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="mt-2 text-[11px] tracking-[0.05em] text-brass-300/55 hover:text-brass-300/85 transition-colors underline-offset-4 hover:underline"
            >
              Continue in portrait anyway
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Animated SVG: a phone icon that rocks from upright to landscape and back,
 * suggesting the gesture the user should perform. Walnut + brass palette.
 */
function RotateIcon() {
  return (
    <motion.svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      initial={{ rotate: 0 }}
      animate={{ rotate: [0, -90, -90, 0, 0] }}
      transition={{
        duration: 3.2,
        times: [0, 0.35, 0.55, 0.85, 1],
        ease: "easeInOut",
        repeat: Infinity,
      }}
      style={{ transformOrigin: "60px 60px" }}
    >
      {/* Phone body — vertical rounded rectangle */}
      <rect
        x="40"
        y="20"
        width="40"
        height="80"
        rx="6"
        ry="6"
        fill="#1a120a"
        stroke="#b48a49"
        strokeWidth="2"
      />
      {/* Screen */}
      <rect
        x="44"
        y="28"
        width="32"
        height="60"
        rx="2"
        ry="2"
        fill="#3a2a18"
      />
      {/* Speaker slot */}
      <rect x="55" y="24" width="10" height="2" rx="1" fill="#5a3f1a" />
      {/* Home indicator */}
      <rect x="55" y="93" width="10" height="2" rx="1" fill="#5a3f1a" />
    </motion.svg>
  );
}
