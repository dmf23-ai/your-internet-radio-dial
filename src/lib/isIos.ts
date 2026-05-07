/**
 * iOS Safari/Chrome detection. Single source of truth for gating features
 * that depend on the WebAudio graph downstream of `<audio>` element playback
 * (Bass/Treble, Doze fade, VU meter, song-ID capture). All of these are
 * silently broken on iOS because `MediaElementAudioSourceNode` produces
 * zero samples through the graph, and there is no available API on iOS to
 * work around it (`captureStream` is also unavailable on both `<audio>` and
 * `<video>` elements — confirmed via the M20 diagnostic, 2026-04-30).
 *
 * On iOS the radio still plays audio (the element's direct-to-speaker path)
 * and tuning static still works (synthesized in WebAudio, sent straight to
 * `ctx.destination` — doesn't depend on MES). Volume falls back to writing
 * `el.volume` directly. Other features degrade gracefully.
 *
 * Detection is intentionally UA-based rather than feature-detected: the
 * bug isn't synchronously detectable at startup (would require playing
 * audio and reading samples), and Chrome/Firefox/Safari on iOS all share
 * the same WebKit underneath, so the UA is the cleanest signal.
 *
 * SSR-safe: returns `false` when navigator is undefined.
 */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ identifies as Mac with touch support — pretends to be macOS
  // until you check maxTouchPoints (real Macs report 0 or 1).
  if (
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
}

/**
 * macOS Safari detection (M22). Same WebKit MES silent-tap bug as iOS — the
 * analyser node receives zero samples, so VU meter, Bass/Treble, and song-ID
 * capture are all dead. UNLIKE iOS, programmatic `el.volume` writes are
 * honored on macOS (no Apple hardware-button platform policy on the desktop),
 * so the VolumeKnob can still work via an `el.volume` fallback in the audio
 * engine (see audio.ts setVolume).
 *
 * Detection requires Safari in the UA AND none of the Chromium/Firefox-
 * branded markers (those browsers all advertise "Safari" in their UA strings
 * for compatibility), AND macOS as the platform, AND not iPad-as-Mac (which
 * is_isIos's domain).
 */
export function isMacSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iOS family handled by isIos() — bail.
  if (/iPad|iPhone|iPod/.test(ua)) return false;
  // iPadOS-as-Mac handled by isIos() — bail.
  if (
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    return false;
  }
  // Must be running on macOS hardware.
  const isMac =
    /Macintosh/.test(ua) || navigator.platform === "MacIntel";
  if (!isMac) return false;
  // Must be Safari proper — exclude Chromium-family and Firefox-iOS-style
  // browsers that include "Safari" in their UA for compatibility.
  const isSafari =
    /Safari/.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg\/|OPR\//.test(ua);
  return isSafari;
}

/**
 * True for any WebKit-based browser that exhibits the MES silent-tap bug:
 * iOS (all browsers there are forced to WebKit) plus macOS Safari. Used by
 * the three components whose features depend on the analyser tap (VUMeter,
 * TonePanel, NowPlayingLozenge). NOT used by VolumeKnob — that one stays
 * gated on isIos() because macOS Safari can use the el.volume fallback.
 */
export function isWebKitDegraded(): boolean {
  return isIos() || isMacSafari();
}
