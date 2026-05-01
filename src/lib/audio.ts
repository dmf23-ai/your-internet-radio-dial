// Singleton audio engine.
//
// Two CORS-clean <audio> elements are maintained side-by-side as parallel
// "slots". At any moment one slot is active (audible) and the other is
// either idle or silently pre-warming the next stream connection.
//
//   slot.el   — HTMLAudioElement, crossOrigin="anonymous"
//   slot.mes  — MediaElementAudioSourceNode (wired once at context init)
//   slot.mix  — per-slot GainNode; 1.0 for active slot, 0 for the other
//   slot.hls  — optional hls.js instance for HLS streams
//
// Audio graph:
//
//   slot[0].el → mes → mix(0|1) ──┐
//                                  ├→ analyser → bass → treble → masterGain → destination
//   slot[1].el → mes → mix(1|0) ──┘
//
// Why per-slot mix gains: createMediaElementSource can only be called once
// per element, so both slots must be wired permanently at context init.
// Switching between them is just a 50ms gain crossfade — no graph rewiring,
// no audible click. masterGain holds the user's volume independently.
//
// Tone (M13): two BiquadFilterNodes — `bass` (lowshelf, 200Hz) and `treble`
// (highshelf, 4kHz) — sit between the analyser and masterGain. Both default
// to 0dB (transparent). The analyser stays *above* the filters so the VU
// meter reflects the source signal, not the post-EQ signal.
//
// Doze (M13): `dozeGain` is a separate GainNode chained after masterGain,
// 1.0 normally, ramped to 0 over the last 30s of an active sleep timer.
// Keeping it separate from masterGain means the user can still adjust the
// volume knob during a fade-out without breaking the ramp envelope.
//
// CORS: streams whose origin lacks permissive CORS are routed through
// /api/stream (or /api/hls for HLS). Same-origin proxied responses are
// CORS-clean, so MediaElementSource is never tainted → VU meter always
// works.
//
// Pre-warm (M11): about 30s before Vercel cuts the active proxy connection
// (300s timeout, see route.ts files), the inactive slot fetches a fresh
// connection to the same URL silently. When the active slot drops, we swap
// to the pre-warmed one with no audible gap.
//
// Reconnect fallback (M10): if pre-warm wasn't ready (HLS, transient
// pre-warm failure, etc.) we fall back to retry-with-backoff on the active
// slot. SIGNAL LOST surfaces only after MAX_RECONNECTS consecutive failures.
//
// Capture tap (M18, reworked): `captureAudioClip()` taps PCM samples off
// the analyser via a transient ScriptProcessorNode → mixes to mono →
// encodes 16-bit WAV → returns the Blob. Originally used MediaRecorder
// over a MediaStreamAudioDestinationNode, but iOS Safari produces
// fragmented MP4 (no top-level moov atom) that AudD's decoder rejects.
// WAV sidesteps the codec/container negotiation entirely. The legacy
// `captureDest` MediaStreamAudioDestinationNode is still wired in
// `ensureContext` for backward compatibility but is no longer used.
// Tapping at the analyser output means pre-volume / pre-Doze / pre-EQ —
// a muted user can still ID, an in-progress Doze fade doesn't silence
// the clip.
//
// Tuning static (M19): a procedurally-generated pink-noise+crackle buffer
// loops through `staticGain` (default 0) into the analyser input. On a
// user-initiated tune, the active slot's mix gain ramps to 0 while staticGain
// ramps up — the user hears FM-shhhh between stations. After a minimum
// plateau, the new station's `playing` event triggers a crossfade back:
// staticGain → 0 + new-slot.mix → 1. Drag-tunes (DialWindow drum) hold static
// continuously between pointerdown-past-threshold and release, then lock in
// on release. Static routes through the same EQ/master/doze chain as audio,
// so it obeys the user's volume + tone + Doze fade and drives the VU meter.

import type { StreamType } from "@/data/seed";

export type AudioStatus =
  | "idle"
  | "buffering"
  | "tuning"
  | "playing"
  | "error";

export interface AudioSnapshot {
  status: AudioStatus;
  meterAvailable: boolean;
  errorMessage?: string;
}

type Listener = (s: AudioSnapshot) => void;
type SlotIdx = 0 | 1;

/**
 * Encode a Float32 sample buffer as a 16-bit PCM mono WAV file.
 * Used by `captureAudioClip` to produce a universally-decodable blob —
 * AudD accepts WAV without any codec ambiguity, no per-browser quirks.
 * Buffer layout: standard 44-byte RIFF/WAVE header + raw little-endian
 * int16 samples.
 */
function encodeWavMono16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // file size - 8
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);  // subchunk1 size (PCM)
  view.setUint16(20, 1, true);   // audio format = PCM
  view.setUint16(22, 1, true);   // num channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono * 16-bit)
  view.setUint16(32, 2, true);   // block align (mono * 16-bit / 8)
  view.setUint16(34, 16, true);  // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}

interface Slot {
  el: HTMLAudioElement | null;
  mes: MediaElementAudioSourceNode | null;
  mix: GainNode | null;
  hls: any;
  // performance.now() at the most recent `playing` event for this slot.
  // Used to compute when this slot's proxy connection is likely to be cut,
  // so post-swap pre-warm rescheduling is accurate.
  startedAt: number;
}

class AudioEngine {
  private slots: [Slot, Slot] = [
    { el: null, mes: null, mix: null, hls: null, startedAt: 0 },
    { el: null, mes: null, mix: null, hls: null, startedAt: 0 },
  ];
  private activeIdx: SlotIdx = 0;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bassFilter: BiquadFilterNode | null = null;
  private trebleFilter: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;
  private dozeGain: GainNode | null = null;
  // M18: parallel tap off the analyser output for song-ID fingerprint
  // capture. Lazily attached in ensureContext alongside the rest of the graph.
  private captureDest: MediaStreamAudioDestinationNode | null = null;
  private timeBuf: Uint8Array<ArrayBuffer> | null = null;

  // M20 captureStream diagnostic. Parallel, inert tap on slot[0] via
  // `el.captureStream() → createMediaStreamSource → analyser`. Lets us check
  // whether captureStream actually carries decoded samples on iOS Safari
  // (where the existing MediaElementAudioSourceNode path is silent). Wired
  // lazily in ensureContext; not connected to destination, doesn't mute the
  // element, doesn't change audible behavior on any platform. Read via
  // `getCaptureStreamDiag()` / `sampleCaptureStreamDiag()`. Removed once
  // M20 itself ships.
  private diagCsStream: MediaStream | null = null;
  private diagCsSrc: MediaStreamAudioSourceNode | null = null;
  private diagCsAnalyser: AnalyserNode | null = null;
  private diagCsBuf: Uint8Array<ArrayBuffer> | null = null;
  private diagCsSupported = false;
  private diagCsError: string | null = null;

  // Tone (M13). Stored in dB so they survive context (re)init, and applied
  // to the BiquadFilterNodes once `ensureContext` has built the graph.
  private bassDb = 0;
  private trebleDb = 0;

  // Doze / sleep timer (M13). Singleton across the engine — only one can
  // be running at a time. `dozeStopTimer` is the hard-stop (call pause()
  // and clear intent) scheduled for the END of the duration; `dozeFadeStart`
  // is the absolute timestamp at which masterGain begins its 30s ramp to 0.
  private dozeStopTimer: ReturnType<typeof setTimeout> | null = null;
  private dozeFadeStart = 0;
  private dozeEndAt = 0;
  private static readonly DOZE_FADE_S = 30;

  private listeners = new Set<Listener>();
  private snapshot: AudioSnapshot = { status: "idle", meterAvailable: false };

  private currentUrl = ""; // upstream URL the caller passed
  private currentPlayUrl = ""; // resolved URL (proxied if needed) — what we hand to <audio>
  private currentType: StreamType = "unknown";
  private currentCorsOk = true;
  private currentIsHls = false;
  private volume = 0.7;

  // M10 reconnect state.
  private intentPlaying = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Suppresses spurious reconnect/swap during the brief window where we
  // pause+load an element as part of an intentional transition (station
  // change, manual reload, post-swap cleanup).
  private inTransition = false;
  private static readonly RECONNECT_DELAYS_MS = [500, 1500, 4000];
  private static readonly MAX_RECONNECTS = 3;

  // M11 pre-warm state.
  // Vercel Pro plans cap serverless function duration at 300s. We pre-warm
  // 270s after the active slot's `playing` event — 30s before the expected
  // cut, leaving comfortable buffer headroom.
  private prewarmTimer: ReturnType<typeof setTimeout> | null = null;
  private prewarmActive = false;
  private static readonly PREWARM_DELAY_MS = 270_000;
  private static readonly SWAP_RAMP_S = 0.05;

  // M19 tuning-static state. The static node graph (buffer source + gain) is
  // built lazily inside ensureContext() and lives for the engine's lifetime.
  // `tuneToken` increments on every tune entry so superseded scheduled
  // callbacks (load delay, lock-in) can no-op. `tuneMinLockAt` is the
  // earliest performance.now() ms at which the lock-in crossfade may start;
  // 0 means "lock in as soon as the new station starts playing" (used by
  // the drag-release path so snap-tune feels snappy).
  private staticBuffer: AudioBuffer | null = null;
  private staticSource: AudioBufferSourceNode | null = null;
  private staticGain: GainNode | null = null;
  // AudioBufferSourceNode.start() can only be called once per node; this
  // gates the lazy start that runs after ctx.resume() (the source must not
  // be started while the context is still suspended on first power-on,
  // or it can fail to actually produce audio when ctx eventually resumes).
  private staticSourceStarted = false;
  private tuneToken = 0;
  private inTuneSequence = false;
  private tuneMinLockAt = 0;
  // When true (manual tunes, drag-release), an overrun fires the brief
  // 50ms lock-in snap so total time ≈ load time. When false (reconnect),
  // overruns still use the full 300ms crossfade so a stream-drop bridge
  // gets matched fade-in / fade-out static.
  private tuneAllowOverrunSnap = true;
  private static readonly TUNE_GAIN_TARGET = 0.33;
  private static readonly TUNE_FADE_S = 0.15;
  private static readonly TUNE_LOCK_RAMP_S = 0.3;
  // Brief lock-in used when the new station took longer than the plateau to
  // start playing — snaps static out without adding 300ms to the natural
  // tune time.
  private static readonly TUNE_LOCK_RAMP_OVERRUN_S = 0.05;
  private static readonly TUNE_PLATEAU_MS = 550; // 0.15 fade + 0.4 plateau + 0.3 lock = 0.85s
  private static readonly TUNE_LOAD_DELAY_MS = 200;

  // --- public API ---

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshot(): AudioSnapshot {
    return this.snapshot;
  }

  async play(
    url: string,
    type: StreamType,
    corsOk: boolean = true,
  ): Promise<void> {
    this.ensureDom();

    // Cancel any pending reconnect/pre-warm — a fresh play() supersedes them.
    this.clearReconnectTimer();
    this.clearPrewarmTimer();
    this.prewarmActive = false;

    this.currentType = type;
    this.currentCorsOk = corsOk;
    // Mark intent up-front so any synchronous events (e.g. an immediate error
    // during el.play()) are correctly classified as unexpected.
    this.intentPlaying = true;

    const isHls = type === "hls" || /\.m3u8(\?|$)/i.test(url);
    this.currentIsHls = isHls;

    const useProxy = !corsOk;
    const playUrl = useProxy
      ? isHls
        ? `/api/hls?url=${encodeURIComponent(url)}`
        : `/api/stream?url=${encodeURIComponent(url)}`
      : url;
    this.currentPlayUrl = playUrl;

    const activeIdx = this.activeIdx;
    const otherIdx = (activeIdx === 0 ? 1 : 0) as SlotIdx;
    const activeSlot = this.slots[activeIdx];
    const otherSlot = this.slots[otherIdx];
    if (!activeSlot.el || !otherSlot.el) return;

    // Tear down any HLS instances and clear the OTHER slot — only one stream
    // should be emitting until pre-warm fires later.
    this.teardownHls();
    try {
      otherSlot.el.pause();
      otherSlot.el.removeAttribute("src");
      otherSlot.el.load();
    } catch {}

    // Same URL → just resume on the active slot.
    if (url === this.currentUrl && activeSlot.el.src) {
      // Capture pre-await state — after the await, paused will be false in
      // both "was playing" and "was paused, .play() succeeded" cases.
      const wasAlreadyPlaying = !activeSlot.el.paused;
      try {
        await this.ensureContext();
        await activeSlot.el.play();
        if (this.inTuneSequence && wasAlreadyPlaying) {
          // No `playing` transition will fire (the element was already
          // playing) → manually lock in or we'd stall in 'tuning' forever.
          this.lockInTune();
        } else if (!this.inTuneSequence) {
          this.setStatus("playing");
        }
        // else (inTuneSequence && was paused): `playing` event will fire and
        // its handler schedules the lock-in with the plateau gate intact.
      } catch (e: any) {
        this.intentPlaying = false;
        this.setStatus("error", e?.message ?? "play failed");
      }
      return;
    }

    // New URL — full reload on the active slot. inTransition suppresses the
    // queued pause/emptied/abort events that would otherwise be misread as
    // an unexpected drop.
    this.inTransition = true;
    try {
      activeSlot.el.pause();
    } catch {}
    activeSlot.el.removeAttribute("src");
    activeSlot.el.load();

    this.currentUrl = url;
    // During a tune sequence, status stays 'tuning' until lock-in. Without
    // this guard, the buffering setStatus would flip the caption out of
    // "Tuning…" mid-sequence.
    if (!this.inTuneSequence) this.setStatus("buffering");

    try {
      if (isHls && !activeSlot.el.canPlayType("application/vnd.apple.mpegurl")) {
        const mod: any = await import("hls.js").catch(() => null);
        const Hls = mod?.default ?? mod?.Hls ?? mod;
        if (!Hls || !Hls.isSupported?.()) {
          this.setStatus(
            "error",
            "HLS not supported in this browser (hls.js missing).",
          );
          return;
        }
        activeSlot.hls = new Hls({ enableWorker: true });
        activeSlot.hls.loadSource(playUrl);
        activeSlot.hls.attachMedia(activeSlot.el);
      } else {
        activeSlot.el.src = playUrl;
      }

      await this.ensureContext();

      // Make sure the active slot is the one that's audible.
      if (this.ctx && activeSlot.mix && otherSlot.mix) {
        const t = this.ctx.currentTime;
        otherSlot.mix.gain.cancelScheduledValues(t);
        otherSlot.mix.gain.setValueAtTime(0, t);
        // During a tune sequence, the active mix is held at 0 by fadeToStatic
        // and gets ramped back up by lockInTune. Don't snap it to 1 here —
        // that would defeat the static envelope.
        if (!this.inTuneSequence) {
          activeSlot.mix.gain.cancelScheduledValues(t);
          activeSlot.mix.gain.setValueAtTime(1, t);
        }
      }

      const meterAvailable = !!this.analyser;
      this.snapshot = { ...this.snapshot, meterAvailable };
      this.emit();

      await activeSlot.el.play();
      // During a tune sequence, status stays 'tuning' until lock-in. The
      // 'playing' event handler will schedule lock-in once audio is flowing.
      if (!this.inTuneSequence) {
        this.setStatus("playing");
      }
      // Pre-warm gets scheduled inside the `playing` event handler once we
      // know audio is actually flowing.
    } catch (e: any) {
      this.intentPlaying = false;
      this.setStatus("error", e?.message ?? "playback failed");
    } finally {
      this.inTransition = false;
    }
  }

  /**
   * M19 — user-initiated tune entry point. Plays the FM-shhhh tuning-static
   * envelope around a station change:
   *
   *   t=0     — fade old slot.mix → 0 + ramp staticGain → TARGET over 150ms,
   *             status="tuning"
   *   t=200ms — load new station on the active slot (via play())
   *   t≥550   — once new slot fires `playing` AND minimum plateau elapsed,
   *             crossfade staticGain → 0 + new slot.mix → 1 over 300ms,
   *             status="playing"
   *
   * Total floor: ~0.85s. Stretches gracefully if the new stream takes longer
   * than the plateau to start playing — static holds at full until lock-in.
   *
   * Called via `store.play()` so EVERY user-initiated tune (dial click, band
   * button, drawer click, search-add, scan tick, power-on) gets the envelope.
   * M10 reconnect and M11 pre-warm swap call `play()` directly and stay silent.
   *
   * If a drag is in progress (beginDragTuning was called), static is already
   * up — this just loads the new URL and lets the lock-in fire on `playing`.
   */
  async tune(
    url: string,
    type: StreamType,
    corsOk: boolean = true,
  ): Promise<void> {
    // First — make sure the slot <audio> elements exist. ensureContext
    // bails early when they don't, and on the very first power-on tune()
    // would silently fall through to play() and skip the static envelope
    // entirely. Mirrors what play() does at its top.
    this.ensureDom();
    await this.ensureContext();
    // No graph yet → fall through to plain play. Happens on the very first
    // user gesture if a tune happens to fire before AudioContext unlock.
    if (!this.ctx || !this.staticGain) {
      return this.play(url, type, corsOk);
    }

    const sameUrl = this.currentUrl === url;
    const active = this.slots[this.activeIdx];
    const isPlaying = !!active.el && !active.el.paused;

    // Mid-drag, released on the same station → just lock in. No reload.
    if (this.inTuneSequence && sameUrl && isPlaying) {
      this.lockInTune();
      return;
    }

    // Not mid-tune, already playing this URL → no-op. Avoids a 2.25s static
    // detour for clicking the already-active station.
    if (
      !this.inTuneSequence &&
      sameUrl &&
      isPlaying &&
      this.snapshot.status === "playing"
    ) {
      return;
    }

    // Bump token on every entry that supersedes prior tune state — keeps
    // any stale scheduled callbacks (load delay, lock-in) from firing.
    const token = ++this.tuneToken;
    // User-initiated tune → opt back into the overrun-snap behavior in
    // case we're inheriting the no-snap state from a prior reconnect.
    this.tuneAllowOverrunSnap = true;

    // Mid-tune (drag in progress, or reconnect static is up), different URL
    // (or paused same URL) → static already audible; just load and let
    // lock-in fire on the new slot's `playing` event.
    if (this.inTuneSequence) {
      return this.play(url, type, corsOk);
    }

    // Fresh tune. Fade old + raise static, then load after a short delay so
    // the static fade-in is audible before the new connection's buffering.
    this.inTuneSequence = true;
    this.tuneMinLockAt = performance.now() + AudioEngine.TUNE_PLATEAU_MS;
    this.intentPlaying = true;
    this.setStatus("tuning");
    this.fadeToStatic(AudioEngine.TUNE_FADE_S);

    setTimeout(() => {
      if (this.tuneToken !== token) return; // superseded
      void this.play(url, type, corsOk);
    }, AudioEngine.TUNE_LOAD_DELAY_MS);
  }

  /**
   * M19 — begin a drag-tune. Called by DialWindow when the dial-drum drag
   * crosses the click/drag threshold. Fades old audio → 0 and raises static
   * to TARGET; static stays up continuously until release. The release path
   * goes through `tune(url,...)` (via store.setCurrentStation → store.play),
   * which sees `inTuneSequence=true` and just loads the new URL — lock-in
   * fires on the new slot's `playing` event with no plateau gate.
   *
   * No-op if no AudioContext yet (no playback has ever started) or if
   * already in a tune sequence.
   */
  async beginDragTuning(): Promise<void> {
    // Power-off guard: a drag gesture on the dial-drum's cream window is a UI
    // event, not user intent to play. When the radio is off (intentPlaying
    // false) we don't want to raise static — and unlike a tune, there's no
    // store.play follow-through to eventually trigger lockInTune, so static
    // would persist until the user powers on. Just no-op.
    if (!this.intentPlaying) return;
    // Mirror tune() — ensureContext bails early without slot elements, and
    // beginDragTuning before any tune ever happened would otherwise no-op.
    this.ensureDom();
    await this.ensureContext();
    if (!this.ctx || !this.staticGain) return;
    if (this.inTuneSequence) return;
    this.tuneToken++;
    this.inTuneSequence = true;
    this.tuneMinLockAt = 0; // no plateau — lock in as soon as new slot plays
    this.tuneAllowOverrunSnap = true;
    this.setStatus("tuning");
    this.fadeToStatic(AudioEngine.TUNE_FADE_S);
  }

  /**
   * M19 — close out a drag-tune that resolved on the *same* station the user
   * started on. There's no reload to do, so `tune()` won't be called via the
   * store — but static is still up. Crossfade it back to the live audio.
   *
   * The store-side path for "drag landed on a different station" runs
   * `setCurrentStation → play → tune`, and `tune()` handles its own lock-in.
   */
  endDragTuning(): void {
    if (!this.inTuneSequence) return;
    this.lockInTune();
  }

  pause(): void {
    // User intent: stop listening. Cancel reconnect and pre-warm so their
    // event handlers don't misread the resulting pauses as unexpected drops.
    this.intentPlaying = false;
    this.clearReconnectTimer();
    this.clearPrewarmTimer();
    this.prewarmActive = false;
    // Bail out of any active tune sequence so static doesn't leak into idle.
    this.killStatic();
    // Pause both slots — pre-warm may be silently buffering on the inactive
    // one and we don't want it churning a connection in the background.
    for (const slot of this.slots) {
      if (slot.el) {
        try {
          slot.el.pause();
        } catch {}
      }
    }
    this.setStatus("idle");
  }

  stop(): void {
    this.intentPlaying = false;
    this.clearReconnectTimer();
    this.clearPrewarmTimer();
    this.prewarmActive = false;
    this.killStatic();
    this.teardownHls();
    for (const slot of this.slots) {
      if (!slot.el) continue;
      try {
        slot.el.pause();
        slot.el.removeAttribute("src");
        slot.el.load();
      } catch {}
    }
    this.currentUrl = "";
    this.currentPlayUrl = "";
    this.setStatus("idle");
  }

  setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    this.volume = clamped;
    const out = clamped * clamped; // curved — more natural to the ear
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(out, this.ctx.currentTime, 0.01);
    } else {
      // Fallback before context exists. Once the graph is up, masterGain
      // takes over and element volume is reset to 1 (see ensureContext).
      for (const slot of this.slots) {
        if (slot.el) slot.el.volume = out;
      }
    }
  }

  getVolume(): number {
    return this.volume;
  }

  // --- Tone (M13) ---

  /** Set bass shelf gain in dB. Clamped to ±12dB. */
  setBass(db: number): void {
    const clamped = Math.max(-12, Math.min(12, db));
    this.bassDb = clamped;
    if (this.bassFilter && this.ctx) {
      this.bassFilter.gain.setTargetAtTime(
        clamped,
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  /** Set treble shelf gain in dB. Clamped to ±12dB. */
  setTreble(db: number): void {
    const clamped = Math.max(-12, Math.min(12, db));
    this.trebleDb = clamped;
    if (this.trebleFilter && this.ctx) {
      this.trebleFilter.gain.setTargetAtTime(
        clamped,
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  getBass(): number {
    return this.bassDb;
  }

  getTreble(): number {
    return this.trebleDb;
  }

  // --- Doze / sleep timer (M13) ---

  /**
   * Start a sleep timer. Audio plays unchanged for (totalSeconds - 30s),
   * then masterGain fades to 0 over the final 30s, then we pause and clear
   * intentPlaying so reconnect logic doesn't kick in.
   *
   * Calling this while another timer is active replaces it (the new timer
   * starts from now). Call `cancelDoze()` to abort cleanly.
   *
   * Returns `false` if totalSeconds <= 0 (no-op).
   */
  startDoze(totalSeconds: number): boolean {
    if (totalSeconds <= 0) return false;
    this.cancelDoze();

    const fadeS = AudioEngine.DOZE_FADE_S;
    const now = performance.now();
    const fadeAt = now + Math.max(0, (totalSeconds - fadeS)) * 1000;
    const stopAt = now + totalSeconds * 1000;
    this.dozeFadeStart = fadeAt;
    this.dozeEndAt = stopAt;

    // Schedule the audio-context fade ramp at the right wall-clock moment.
    // Done inside a setTimeout so it lines up with the timer-card UI.
    const fadeDelay = Math.max(0, fadeAt - now);
    setTimeout(() => {
      // Bail if user cancelled or restarted in the meantime.
      if (this.dozeFadeStart !== fadeAt) return;
      if (this.dozeGain && this.ctx) {
        const t = this.ctx.currentTime;
        const target = Math.max(0.0001, fadeS); // avoid 0-second ramp
        try {
          this.dozeGain.gain.cancelScheduledValues(t);
          this.dozeGain.gain.setValueAtTime(this.dozeGain.gain.value, t);
          this.dozeGain.gain.linearRampToValueAtTime(0, t + target);
        } catch {}
      }
    }, fadeDelay);

    this.dozeStopTimer = setTimeout(() => {
      this.dozeStopTimer = null;
      // End of timer — stop playback and reset doze gain so the next play()
      // isn't silenced.
      this.intentPlaying = false;
      this.stop();
      if (this.dozeGain && this.ctx) {
        try {
          this.dozeGain.gain.cancelScheduledValues(this.ctx.currentTime);
          this.dozeGain.gain.setValueAtTime(1, this.ctx.currentTime);
        } catch {}
      }
      this.dozeFadeStart = 0;
      this.dozeEndAt = 0;
    }, totalSeconds * 1000);

    return true;
  }

  /** Cancel any active doze timer and restore master volume. */
  cancelDoze(): void {
    if (this.dozeStopTimer) {
      clearTimeout(this.dozeStopTimer);
      this.dozeStopTimer = null;
    }
    this.dozeFadeStart = 0;
    this.dozeEndAt = 0;
    if (this.dozeGain && this.ctx) {
      const t = this.ctx.currentTime;
      try {
        this.dozeGain.gain.cancelScheduledValues(t);
        // 50ms fade back up to 1 — if we're mid-fade, this avoids a click.
        this.dozeGain.gain.setValueAtTime(this.dozeGain.gain.value, t);
        this.dozeGain.gain.linearRampToValueAtTime(1, t + 0.05);
      } catch {}
    }
  }

  /** Returns ms remaining on the active doze timer, or 0 if none. */
  getDozeRemainingMs(): number {
    if (!this.dozeEndAt) return 0;
    return Math.max(0, this.dozeEndAt - performance.now());
  }

  // --- Song-ID capture (M18, reworked) ---

  /**
   * Record `seconds` of the current audio output into a WAV Blob suitable
   * for upload to AudD or any other fingerprinting service.
   *
   * **Why WAV and not MediaRecorder?** Originally this used MediaRecorder
   * over `captureDest.stream`, picking the best supported MIME (webm/opus
   * on desktop, mp4 on iOS). That worked on desktop but iOS Safari/Chrome
   * produce *fragmented MP4* (moof/mdat boxes, no top-level moov atom)
   * which AudD's decoder rejects with "Recognition failed: ... should
   * send only audio files". Routing PCM samples through a ScriptProcessor
   * tap and encoding WAV ourselves sidesteps the entire codec/container
   * negotiation. Larger uploads (~96 KB/s @ 48k mono 16-bit) but bulletproof.
   *
   * Throws if the audio context isn't initialized yet (no playback has ever
   * started). Captures ~8s by default — AudD's recommended minimum for
   * reliable fingerprint matching.
   */
  async captureAudioClip(seconds: number = 8): Promise<{
    blob: Blob;
    peakAmplitude: number;
    durationMs: number;
    sampleRate: number;
    fireCount: number;
  }> {
    // If the graph isn't built yet (no playback has ever started), try
    // ensureContext() once — it's a no-op when slots haven't been wired.
    if (!this.ctx || !this.analyser) {
      await this.ensureContext();
    }
    if (!this.ctx || !this.analyser) {
      throw new Error("audio context unavailable (no playback yet?)");
    }
    const ctx = this.ctx;
    const analyser = this.analyser;
    const sr = ctx.sampleRate;
    const targetSamples = Math.max(1, Math.floor(seconds * sr));

    // ScriptProcessor is deprecated in favor of AudioWorklet but remains
    // reliable across every current browser including iOS. Connect proc
    // directly to ctx.destination (instead of via a 0-gain sink) and
    // explicitly zero the output buffers — ScriptProcessor's spec
    // requires a path to destination for onaudioprocess to fire, and a
    // 0-gain sink can be optimized away by aggressive WebKit graph
    // pruning. Direct connection + zero-fill is the canonical "tap"
    // pattern that works on iOS without bleeding any audio into the
    // main output. (2,2) symmetric I/O for compatibility — mono mixdown
    // happens in JS below.
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    analyser.connect(proc);
    proc.connect(ctx.destination);

    const accum: Float32Array[] = [];
    let totalSamples = 0;
    let fireCount = 0;
    const wallClockMs = Math.max(1000, seconds * 1000) + 1000; // +1s slack

    return new Promise<{
      blob: Blob;
      peakAmplitude: number;
      durationMs: number;
      sampleRate: number;
      fireCount: number;
    }>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        try {
          proc.onaudioprocess = null;
        } catch {
          /* noop */
        }
        try {
          analyser.disconnect(proc);
        } catch {
          /* noop */
        }
        try {
          proc.disconnect();
        } catch {
          /* noop */
        }
      };
      const finalize = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (totalSamples === 0) {
          reject(new Error("captured 0 samples (audio not flowing?)"));
          return;
        }
        const want = Math.min(totalSamples, targetSamples);
        const all = new Float32Array(want);
        let off = 0;
        for (const buf of accum) {
          if (off >= want) break;
          const take = Math.min(want - off, buf.length);
          all.set(buf.subarray(0, take), off);
          off += take;
        }
        // Peak amplitude over the captured window. Near-zero (< 0.005)
        // means the analyser tap isn't carrying signal even though the
        // user can hear audio — usually an iOS Safari taint of the
        // MediaElementAudioSourceNode. Surfaced in the lozenge error
        // path so failures are diagnosable from the cream window.
        let peak = 0;
        for (let i = 0; i < all.length; i++) {
          const a = Math.abs(all[i]);
          if (a > peak) peak = a;
        }
        const durationMs = Math.round((all.length / sr) * 1000);
        const wav = encodeWavMono16(all, sr);
        resolve({
          blob: new Blob([wav], { type: "audio/wav" }),
          peakAmplitude: peak,
          durationMs,
          sampleRate: sr,
          fireCount,
        });
      };

      proc.onaudioprocess = (e: AudioProcessingEvent) => {
        fireCount++;
        const inBuf = e.inputBuffer;
        const len = inBuf.length;
        const numCh = inBuf.numberOfChannels;
        const mono = new Float32Array(len);
        if (numCh >= 2) {
          const l = inBuf.getChannelData(0);
          const r = inBuf.getChannelData(1);
          for (let i = 0; i < len; i++) mono[i] = (l[i] + r[i]) * 0.5;
        } else if (numCh === 1) {
          mono.set(inBuf.getChannelData(0));
        }
        accum.push(mono);
        totalSamples += len;
        // Explicitly zero the outputs so this tap doesn't introduce any
        // audible signal at ctx.destination (we read from input only).
        const outBuf = e.outputBuffer;
        for (let ch = 0; ch < outBuf.numberOfChannels; ch++) {
          outBuf.getChannelData(ch).fill(0);
        }
        if (totalSamples >= targetSamples) finalize();
      };

      // Wall-clock failsafe — covers the case where onaudioprocess stops
      // firing before reaching the sample target (e.g. context gets
      // suspended, audio drops mid-capture).
      setTimeout(finalize, wallClockMs);
    });
  }

  // RMS of current analyser window, 0..1. The analyser sits downstream of
  // both slot mixes, so it always reflects whatever's audible — no special
  // case needed at swap time.
  getRms(): number {
    if (!this.analyser || !this.timeBuf) return 0;
    try {
      this.analyser.getByteTimeDomainData(this.timeBuf);
    } catch {
      return 0;
    }
    let sumSq = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      const v = (this.timeBuf[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.timeBuf.length);
    return Math.min(1, rms * 2.2);
  }

  // --- M20 captureStream diagnostic ---

  /**
   * Snapshot read of the parallel captureStream tap on slot[0]. Returns the
   * current peak amplitude (0..1) over the analyser's ~21ms window. Used to
   * verify whether captureStream actually carries decoded samples on iOS
   * Safari (where the existing MediaElementAudioSourceNode path is silent).
   *
   * `peak` near zero AND audio audibly playing → captureStream has the same
   * silent-tap problem as MES on this browser, M20 plan won't work.
   * `peak` non-zero → captureStream carries signal, M20 is viable.
   */
  getCaptureStreamDiag(): {
    supported: boolean;
    error: string | null;
    peak: number;
    trackState: string;
  } {
    const trackState =
      this.diagCsStream?.getAudioTracks()[0]?.readyState ?? "no-track";
    if (!this.diagCsSupported) {
      return { supported: false, error: this.diagCsError, peak: 0, trackState };
    }
    if (!this.diagCsAnalyser || !this.diagCsBuf) {
      return {
        supported: true,
        error: "diagnostic analyser missing",
        peak: 0,
        trackState,
      };
    }
    try {
      this.diagCsAnalyser.getByteTimeDomainData(this.diagCsBuf);
    } catch (e) {
      return {
        supported: true,
        error: (e as Error).message,
        peak: 0,
        trackState,
      };
    }
    let peak = 0;
    for (let i = 0; i < this.diagCsBuf.length; i++) {
      const v = Math.abs((this.diagCsBuf[i] - 128) / 128);
      if (v > peak) peak = v;
    }
    return { supported: true, error: null, peak, trackState };
  }

  /**
   * Sample the captureStream diagnostic at 100ms intervals over `durationMs`,
   * return the maximum peak observed. Single snapshots can land in a quiet
   * moment of music and read near-zero even when the stream is healthy;
   * sampling over the full song-ID capture window gives us a robust answer.
   */
  async sampleCaptureStreamDiag(durationMs: number): Promise<{
    supported: boolean;
    error: string | null;
    peak: number;
    trackState: string;
  }> {
    // Retry the wire here — by the time the user taps NOW PLAYING, audio
    // has been actively playing for a while, so browsers (e.g. Chrome) that
    // only populate the captureStream's audio track after playback is live
    // will now succeed.
    this.tryWireCaptureStreamDiag();
    const startTs = performance.now();
    let peak = 0;
    let lastSnap = this.getCaptureStreamDiag();
    if (!lastSnap.supported) return lastSnap;
    return new Promise((resolve) => {
      const tick = () => {
        const r = this.getCaptureStreamDiag();
        if (r.peak > peak) peak = r.peak;
        lastSnap = r;
        if (performance.now() - startTs >= durationMs) {
          resolve({
            supported: true,
            error: lastSnap.error,
            peak,
            trackState: lastSnap.trackState,
          });
        } else {
          setTimeout(tick, 100);
        }
      };
      tick();
    });
  }

  // --- internals ---

  private wireEvents(el: HTMLAudioElement, idx: SlotIdx) {
    el.addEventListener("waiting", () => {
      if (this.activeIdx === idx) this.setStatus("buffering");
    });
    el.addEventListener("playing", () => {
      // Always record start time — needed for both active (pre-warm
      // scheduling) and pre-warm slot (post-swap reschedule).
      this.slots[idx].startedAt = performance.now();
      if (this.activeIdx === idx) {
        // Confirmed audio output → reset reconnect counter and cancel any
        // pending reconnect timer.
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();

        // M19: if a tune sequence is in flight, defer the status flip and
        // pre-warm scheduling until lock-in. Lock-in waits for the minimum
        // plateau (if any) so brief tunes still feel like tuning, not just
        // skipping. Token check guards re-entry: if a newer tune has started
        // since we entered this handler, our scheduled lock-in no-ops.
        //
        // Overrun: if the new station took longer than the plateau to start
        // playing, the static has already been audible for the full plateau
        // duration AND the load-wait. Use a brief snap (50ms) instead of
        // the full 300ms crossfade so total static time ≈ natural load time
        // instead of always adding 300ms on top.
        if (this.inTuneSequence) {
          const token = this.tuneToken;
          const now = performance.now();
          const overrun = now > this.tuneMinLockAt;
          const delay = overrun ? 0 : this.tuneMinLockAt - now;
          // Overrun snap (50ms) only when explicitly opted in (manual tunes,
          // drag-release). Reconnect leaves the flag false so it always uses
          // the full 300ms crossfade — matches the audible fade-in.
          const ramp =
            overrun && this.tuneAllowOverrunSnap
              ? AudioEngine.TUNE_LOCK_RAMP_OVERRUN_S
              : AudioEngine.TUNE_LOCK_RAMP_S;
          setTimeout(() => {
            if (this.tuneToken !== token) return;
            if (!this.inTuneSequence) return;
            this.lockInTune(ramp);
          }, delay);
        } else {
          this.setStatus("playing");
          // Arm the pre-warm for ~30s before the expected Vercel cut.
          this.schedulePrewarm();
        }
      }
    });
    el.addEventListener("pause", () => {
      if (this.inTransition) return;
      if (this.activeIdx !== idx) {
        // Pre-warm slot paused on its own (proxy died early?). Mark backup
        // unavailable; if active drops before the next pre-warm fires we'll
        // fall back to M10 reconnect.
        this.prewarmActive = false;
        return;
      }
      if (this.snapshot.status === "error") return;
      if (this.intentPlaying) {
        this.tryFailoverOrReconnect();
      } else {
        this.setStatus("idle");
      }
    });
    el.addEventListener("ended", () => {
      if (this.inTransition) return;
      if (this.activeIdx !== idx) {
        // Pre-warm proxy connection ended before swap. Re-arm in 5s.
        this.prewarmActive = false;
        this.clearPrewarmTimer();
        this.prewarmTimer = setTimeout(() => {
          this.prewarmTimer = null;
          this.startPrewarm();
        }, 5000);
        return;
      }
      // For continuous radio, `ended` should never legitimately fire — it
      // means the response body closed (Vercel timeout, upstream disconnect).
      if (this.intentPlaying) this.tryFailoverOrReconnect();
    });
    el.addEventListener("error", () => {
      if (this.inTransition) return;
      if (this.activeIdx !== idx) {
        this.prewarmActive = false;
        return;
      }
      if (this.intentPlaying) this.tryFailoverOrReconnect();
      else this.setStatus("error", "audio element error");
    });
    el.addEventListener("stalled", () => {
      if (this.activeIdx === idx) this.setStatus("buffering");
    });
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPrewarmTimer() {
    if (this.prewarmTimer) {
      clearTimeout(this.prewarmTimer);
      this.prewarmTimer = null;
    }
  }

  // Decide whether to swap to the pre-warmed slot or fall back to retry.
  private tryFailoverOrReconnect() {
    if (!this.intentPlaying) return;
    if (this.canSwap()) {
      this.swapToBackup();
      return;
    }
    this.scheduleReconnect();
  }

  private canSwap(): boolean {
    if (this.currentIsHls) return false; // HLS isn't pre-warmed in MVP
    if (!this.prewarmActive) return false;
    const otherIdx = (this.activeIdx === 0 ? 1 : 0) as SlotIdx;
    const slot = this.slots[otherIdx];
    if (!slot.el) return false;
    // readyState >= HAVE_CURRENT_DATA (2) means at least one frame is ready
    // to play. paused/ended would mean the backup isn't actually rolling.
    if (slot.el.readyState < 2) return false;
    if (slot.el.paused) return false;
    if (slot.el.ended) return false;
    return true;
  }

  private swapToBackup() {
    if (!this.ctx) return;
    const oldIdx = this.activeIdx;
    const newIdx = (oldIdx === 0 ? 1 : 0) as SlotIdx;
    const oldSlot = this.slots[oldIdx];
    const newSlot = this.slots[newIdx];
    if (!newSlot.mix || !oldSlot.mix) return;

    const t = this.ctx.currentTime;
    const ramp = AudioEngine.SWAP_RAMP_S;
    // Brief crossfade on the per-slot mix gains. masterGain (volume) is
    // unchanged, so audible level is preserved.
    newSlot.mix.gain.cancelScheduledValues(t);
    oldSlot.mix.gain.cancelScheduledValues(t);
    newSlot.mix.gain.setValueAtTime(newSlot.mix.gain.value, t);
    oldSlot.mix.gain.setValueAtTime(oldSlot.mix.gain.value, t);
    newSlot.mix.gain.linearRampToValueAtTime(1, t + ramp);
    oldSlot.mix.gain.linearRampToValueAtTime(0, t + ramp);

    this.activeIdx = newIdx;
    this.prewarmActive = false;

    // Tear down the old slot's now-dead connection so we don't leave a
    // zombie audio element churning. inTransition suppresses the resulting
    // pause/emptied events.
    this.inTransition = true;
    try {
      if (oldSlot.hls) {
        try {
          oldSlot.hls.destroy();
        } catch {}
        oldSlot.hls = null;
      }
      oldSlot.el?.pause();
      oldSlot.el?.removeAttribute("src");
      oldSlot.el?.load();
    } catch {}
    this.inTransition = false;

    // Active is now newSlot — reschedule pre-warm based on its startedAt.
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.setStatus("playing");
    this.schedulePrewarm();
    console.log(
      `[audio] swapped to slot ${newIdx} (pre-warmed) — no audible gap`,
    );
  }

  private schedulePrewarm() {
    if (this.currentIsHls) return; // not implemented for HLS
    if (!this.intentPlaying) return;
    if (!this.currentPlayUrl) return;
    this.clearPrewarmTimer();

    const active = this.slots[this.activeIdx];
    const elapsed =
      active.startedAt > 0 ? performance.now() - active.startedAt : 0;
    // If we've already burned past the pre-warm window (e.g. swap happened
    // very late), fire essentially immediately.
    const remaining = AudioEngine.PREWARM_DELAY_MS - elapsed;
    const delay = Math.max(remaining, 0);

    this.prewarmTimer = setTimeout(() => {
      this.prewarmTimer = null;
      this.startPrewarm();
    }, delay);
  }

  private startPrewarm() {
    if (this.currentIsHls) return;
    if (!this.intentPlaying) return;
    if (!this.currentPlayUrl) return;

    const otherIdx = (this.activeIdx === 0 ? 1 : 0) as SlotIdx;
    const slot = this.slots[otherIdx];
    if (!slot.el || !slot.mix) return;
    // Backup mix should already be 0 from prior state. Make extra sure so
    // the buffering doesn't bleed through audibly.
    if (this.ctx) {
      slot.mix.gain.cancelScheduledValues(this.ctx.currentTime);
      slot.mix.gain.setValueAtTime(0, this.ctx.currentTime);
    }

    try {
      slot.el.pause();
      slot.el.removeAttribute("src");
      slot.el.load();
      slot.el.src = this.currentPlayUrl;
      this.prewarmActive = true;
      const p = slot.el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // Pre-warm failed to start. Re-arm in 5s — the proxy might be
          // transiently unavailable. If active drops first we just reconnect.
          this.prewarmActive = false;
          this.clearPrewarmTimer();
          this.prewarmTimer = setTimeout(() => {
            this.prewarmTimer = null;
            this.startPrewarm();
          }, 5000);
        });
      }
      console.log(`[audio] pre-warming slot ${otherIdx} (silent)`);
    } catch {
      this.prewarmActive = false;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return; // already pending
    if (!this.intentPlaying) return;
    if (!this.currentUrl) return;

    if (this.reconnectAttempts >= AudioEngine.MAX_RECONNECTS) {
      // Give up — surface a real error so the lamp turns red.
      this.intentPlaying = false;
      this.reconnectAttempts = 0;
      this.killStatic();
      this.setStatus("error", "signal lost");
      return;
    }

    // M19: bridge the silent reconnect gap with tuning static — same FM-shhhh
    // envelope as a manual tune, fades in over 150ms when the drop is detected
    // and crossfades out over 300ms once the stream resumes via lockInTune.
    // Idempotent: re-asserting on retry attempts 2/3 is a no-op when static is
    // already at TARGET. tuneAllowOverrunSnap stays false so the lock-in uses
    // the full 300ms crossfade rather than the manual-tune overrun snap.
    if (!this.inTuneSequence) {
      this.tuneToken++;
      this.inTuneSequence = true;
      this.tuneMinLockAt = 0;
      this.tuneAllowOverrunSnap = false;
      this.fadeToStatic(AudioEngine.TUNE_FADE_S);
    }

    const delay =
      AudioEngine.RECONNECT_DELAYS_MS[this.reconnectAttempts] ?? 4000;
    this.reconnectAttempts++;
    this.setStatus("buffering");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptReload();
    }, delay);
  }

  private async attemptReload() {
    if (!this.intentPlaying) return;
    const url = this.currentUrl;
    const type = this.currentType;
    const corsOk = this.currentCorsOk;
    if (!url) return;

    const slot = this.slots[this.activeIdx];
    if (slot.el) {
      // Force play()'s same-URL shortcut to skip; we want a fresh fetch on
      // the active slot, not a resume on a closed connection.
      this.inTransition = true;
      try {
        slot.el.pause();
        slot.el.removeAttribute("src");
        slot.el.load();
      } catch {}
      this.inTransition = false;
    }

    try {
      await this.play(url, type, corsOk);
    } catch {
      if (this.intentPlaying && !this.reconnectTimer) {
        this.scheduleReconnect();
      }
    }
  }

  private ensureDom() {
    if (typeof document === "undefined") return;
    for (let i = 0; i < 2; i++) {
      const idx = i as SlotIdx;
      const slot = this.slots[idx];
      if (!slot.el) {
        const el = document.createElement("audio");
        el.crossOrigin = "anonymous";
        el.preload = "none";
        (el as any).playsInline = true;
        el.setAttribute("playsinline", "");
        this.wireEvents(el, idx);
        document.body.appendChild(el);
        slot.el = el;
      }
    }
  }

  private async ensureContext() {
    if (!this.slots[0].el || !this.slots[1].el) return;
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      try {
        // Wire BOTH slots permanently. createMediaElementSource can only
        // be called once per element, so lazy wiring would lock us out of
        // ever using a slot we hadn't initialised at first play.
        for (let i = 0; i < 2; i++) {
          const idx = i as SlotIdx;
          const slot = this.slots[idx];
          const mes = this.ctx.createMediaElementSource(slot.el!);
          const mix = this.ctx.createGain();
          mix.gain.value = idx === this.activeIdx ? 1 : 0;
          mes.connect(mix);
          slot.mes = mes;
          slot.mix = mix;
        }
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.timeBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

        // Tone — lowshelf (bass) at 200Hz, highshelf (treble) at 4kHz.
        // ±12dB range. 0dB = transparent (default).
        this.bassFilter = this.ctx.createBiquadFilter();
        this.bassFilter.type = "lowshelf";
        this.bassFilter.frequency.value = 200;
        this.bassFilter.gain.value = this.bassDb;
        this.trebleFilter = this.ctx.createBiquadFilter();
        this.trebleFilter.type = "highshelf";
        this.trebleFilter.frequency.value = 4000;
        this.trebleFilter.gain.value = this.trebleDb;

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.volume * this.volume;

        // Doze fade gain — 1.0 normally; ramped to 0 over the last 30s of
        // an active sleep timer. Independent of masterGain so volume knob
        // adjustments during a fade don't reset the envelope.
        this.dozeGain = this.ctx.createGain();
        this.dozeGain.gain.value = 1;

        // Chain: slot mixes → analyser → bass → treble → masterGain → dozeGain → out
        this.slots[0].mix!.connect(this.analyser);
        this.slots[1].mix!.connect(this.analyser);
        this.analyser.connect(this.bassFilter);
        this.bassFilter.connect(this.trebleFilter);
        this.trebleFilter.connect(this.masterGain);
        this.masterGain.connect(this.dozeGain);
        this.dozeGain.connect(this.ctx.destination);

        // M18 capture tap. Parallel branch off the analyser — same point in
        // the graph where the bass filter pulls — so the captured stream has
        // the source signal at full level regardless of user volume / doze
        // fade. `captureDest.stream` is a MediaStream that MediaRecorder can
        // consume on demand from `captureAudioClip()`.
        this.captureDest = this.ctx.createMediaStreamDestination();
        this.analyser.connect(this.captureDest);

        // M19 tuning-static. Pink-noise+crackle buffer source feeds a gain
        // (default 0) into the analyser input — sums with slot mixes so it
        // shares the same EQ/master/doze chain and drives VU during tunes.
        // The source is created here but `start()` is deferred to after
        // `ctx.resume()` below — calling start() on a still-suspended context
        // can leave the source in a state where it never produces audio once
        // the context finally resumes (observed on first power-on). Gating
        // happens at `staticGain`.
        this.staticBuffer = this.buildStaticBuffer(this.ctx);
        this.staticGain = this.ctx.createGain();
        this.staticGain.gain.value = 0;
        this.staticSource = this.ctx.createBufferSource();
        this.staticSource.buffer = this.staticBuffer;
        this.staticSource.loop = true;
        this.staticSource.connect(this.staticGain);
        this.staticGain.connect(this.analyser);
        // Now that masterGain owns volume, reset element-level volume to 1
        // so the chain isn't compounding (out * out).
        for (const slot of this.slots) {
          if (slot.el) slot.el.volume = 1;
        }
        this.snapshot = { ...this.snapshot, meterAvailable: true };
        this.emit();
      } catch {
        // Graph failed — keep meterAvailable false. Audio still plays
        // (element volume), but VU meter and pre-warm swap won't work.
        this.snapshot = { ...this.snapshot, meterAvailable: false };
        this.emit();
      }
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {}
    }

    // M19 — start the static buffer source NOW that the context is running.
    // AudioBufferSourceNode.start() can only be called once per node (it
    // throws InvalidStateError on a second call); the flag guards repeat
    // entry to ensureContext.
    if (
      this.staticSource &&
      !this.staticSourceStarted &&
      this.ctx.state === "running"
    ) {
      try {
        this.staticSource.start(0);
        this.staticSourceStarted = true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          "[audio] staticSource.start failed:",
          (e as Error).message,
        );
      }
    }

    // M18 — defensively (re-)create the capture destination if it's missing.
    // Handles the case where ensureContext ran in a prior session before M18
    // shipped, leaving us with an AudioContext that has no captureDest node.
    // Idempotent: we only build it once per context lifetime.
    if (this.ctx && this.analyser && !this.captureDest) {
      try {
        this.captureDest = this.ctx.createMediaStreamDestination();
        this.analyser.connect(this.captureDest);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[audio] captureDest setup failed:", (e as Error).message);
      }
    }

    // M20 diagnostic — try to wire the parallel captureStream tap. Helper
    // is also called from sampleCaptureStreamDiag right before sampling, so
    // browsers that only populate the audio track after playback is live
    // (e.g. desktop Chrome) get a fresh attempt at the moment we need it.
    this.tryWireCaptureStreamDiag();
  }

  /**
   * M20 diagnostic — attempt to wire a parallel captureStream tap on slot[0].
   * Inert (not connected to destination, element not muted) — purely for
   * reading peak amplitude to verify whether captureStream actually carries
   * decoded samples on iOS Safari (where MES is silent). Idempotent: bails
   * once `diagCsSupported` is true. Safe to call repeatedly.
   */
  private tryWireCaptureStreamDiag(): void {
    if (!this.ctx || this.diagCsSupported) return;
    try {
      const el0 = this.slots[0].el;
      const cap = el0 ? (el0 as any).captureStream : undefined;
      if (typeof cap !== "function") {
        this.diagCsError = "captureStream not available on HTMLAudioElement";
        return;
      }
      const stream: MediaStream = cap.call(el0);
      if (!stream || stream.getAudioTracks().length === 0) {
        // Stream exists but no audio track yet — Chrome only populates the
        // track after playback is actively decoding. Leave diagCsSupported
        // false so the next call (e.g. from sampleCaptureStreamDiag at tap
        // time) re-attempts when audio is rolling.
        this.diagCsError = "captureStream returned no audio track yet";
        return;
      }
      const src = this.ctx.createMediaStreamSource(stream);
      const a = this.ctx.createAnalyser();
      a.fftSize = 1024;
      src.connect(a);
      this.diagCsStream = stream;
      this.diagCsSrc = src;
      this.diagCsAnalyser = a;
      this.diagCsBuf = new Uint8Array(new ArrayBuffer(a.fftSize));
      this.diagCsSupported = true;
      this.diagCsError = null;
    } catch (e) {
      this.diagCsError = `captureStream wire failed: ${(e as Error).message}`;
    }
  }

  // --- M19 tuning-static internals ---

  /**
   * Build a 4-second pink-noise + crackle buffer for between-station static.
   *
   * Pink noise via Paul Kellet's IIR-cascade approximation (cheap, sounds
   * right). A one-pole highpass thins out the bass so the result reads as
   * "FM-shhhh between stations" rather than "AM hum". Sparse random spikes
   * (~0.05% chance per sample, ≈22Hz at 44.1kHz, ±0.4 amplitude) add the
   * analog-radio crackle character without becoming a popcorn track.
   *
   * Loops forever once `staticSource.start(0)` is called — the user only
   * hears it when `staticGain` ramps up during a tune sequence.
   */
  private buildStaticBuffer(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const length = Math.floor(sr * 4);
    const buf = ctx.createBuffer(1, length, sr);
    const data = buf.getChannelData(0);

    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    let prevX = 0,
      prevY = 0;
    const alpha = 0.95; // ~350Hz cutoff at 44.1kHz

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      pink *= 0.11;

      // 1-pole HP to thin out the rumble.
      const y = alpha * (prevY + pink - prevX);
      prevX = pink;
      prevY = y;
      let s = y;

      // Sparse crackle pops post-HP so they keep their click-like edge.
      if (Math.random() < 0.0005) {
        s += (Math.random() * 2 - 1) * 0.4;
      }

      data[i] = Math.max(-1, Math.min(1, s));
    }
    return buf;
  }

  /**
   * Ramp the active slot's mix gain to 0 and the staticGain to TUNE_GAIN_TARGET
   * over `rampS` seconds. Idempotent — calling repeatedly during an existing
   * tune just re-asserts the targets.
   */
  private fadeToStatic(rampS: number): void {
    if (!this.ctx || !this.staticGain) return;
    const t = this.ctx.currentTime;
    const active = this.slots[this.activeIdx];
    if (active.mix) {
      active.mix.gain.cancelScheduledValues(t);
      active.mix.gain.setValueAtTime(active.mix.gain.value, t);
      active.mix.gain.linearRampToValueAtTime(0, t + rampS);
    }
    this.staticGain.gain.cancelScheduledValues(t);
    this.staticGain.gain.setValueAtTime(this.staticGain.gain.value, t);
    this.staticGain.gain.linearRampToValueAtTime(
      AudioEngine.TUNE_GAIN_TARGET,
      t + rampS,
    );
  }

  /**
   * Crossfade staticGain → 0 and the active slot mix → 1 over `rampS`
   * seconds. Clears tune-sequence state, then re-arms pre-warm and reports
   * status="playing" once the ramp completes.
   *
   * Default ramp is `TUNE_LOCK_RAMP_S` (300ms); the playing-event handler
   * passes `TUNE_LOCK_RAMP_OVERRUN_S` (50ms) when the new station took
   * longer than the plateau to start playing — keeps the total static time
   * close to the natural load time instead of always adding 300ms on top.
   */
  private lockInTune(rampS: number = AudioEngine.TUNE_LOCK_RAMP_S): void {
    if (!this.ctx || !this.staticGain) {
      this.inTuneSequence = false;
      this.setStatus("playing");
      return;
    }
    const t = this.ctx.currentTime;
    const active = this.slots[this.activeIdx];
    this.staticGain.gain.cancelScheduledValues(t);
    this.staticGain.gain.setValueAtTime(this.staticGain.gain.value, t);
    this.staticGain.gain.linearRampToValueAtTime(0, t + rampS);
    if (active.mix) {
      active.mix.gain.cancelScheduledValues(t);
      active.mix.gain.setValueAtTime(active.mix.gain.value, t);
      active.mix.gain.linearRampToValueAtTime(1, t + rampS);
    }
    this.inTuneSequence = false;
    this.tuneMinLockAt = 0;
    setTimeout(() => {
      this.setStatus("playing");
      this.schedulePrewarm();
    }, rampS * 1000);
  }

  /**
   * Bail out of any active tune sequence. Used by pause()/stop() so a
   * power-off mid-tune doesn't leave staticGain stuck or a lock-in dangling.
   * Bumps tuneToken so any pending scheduled callbacks no-op when they fire.
   */
  private killStatic(): void {
    this.inTuneSequence = false;
    this.tuneMinLockAt = 0;
    this.tuneToken++;
    if (this.staticGain && this.ctx) {
      const t = this.ctx.currentTime;
      try {
        this.staticGain.gain.cancelScheduledValues(t);
        this.staticGain.gain.setValueAtTime(this.staticGain.gain.value, t);
        this.staticGain.gain.linearRampToValueAtTime(0, t + 0.1);
      } catch {}
    }
  }

  private teardownHls() {
    for (const slot of this.slots) {
      if (slot.hls) {
        try {
          slot.hls.destroy();
        } catch {}
        slot.hls = null;
      }
    }
  }

  private setStatus(status: AudioStatus, errorMessage?: string) {
    this.snapshot = {
      ...this.snapshot,
      status,
      errorMessage: status === "error" ? errorMessage : undefined,
    };
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn(this.snapshot);
  }
}

let _engine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!_engine) _engine = new AudioEngine();
  return _engine;
}

export type { AudioEngine };
