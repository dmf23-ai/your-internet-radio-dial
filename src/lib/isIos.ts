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
