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

import type { StreamType } from "@/data/seed";

export type AudioStatus = "idle" | "buffering" | "playing" | "error";

export interface AudioSnapshot {
  status: AudioStatus;
  meterAvailable: boolean;
  errorMessage?: string;
}

type Listener = (s: AudioSnapshot) => void;
type SlotIdx = 0 | 1;

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
  private timeBuf: Uint8Array<ArrayBuffer> | null = null;

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
      try {
        await this.ensureContext();
        await activeSlot.el.play();
        this.setStatus("playing");
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
    this.setStatus("buffering");

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
        activeSlot.mix.gain.cancelScheduledValues(t);
        otherSlot.mix.gain.cancelScheduledValues(t);
        activeSlot.mix.gain.setValueAtTime(1, t);
        otherSlot.mix.gain.setValueAtTime(0, t);
      }

      const meterAvailable = !!this.analyser;
      this.snapshot = { ...this.snapshot, meterAvailable };
      this.emit();

      await activeSlot.el.play();
      this.setStatus("playing");
      // Pre-warm gets scheduled inside the `playing` event handler once we
      // know audio is actually flowing.
    } catch (e: any) {
      this.intentPlaying = false;
      this.setStatus("error", e?.message ?? "playback failed");
    } finally {
      this.inTransition = false;
    }
  }

  pause(): void {
    // User intent: stop listening. Cancel reconnect and pre-warm so their
    // event handlers don't misread the resulting pauses as unexpected drops.
    this.intentPlaying = false;
    this.clearReconnectTimer();
    this.clearPrewarmTimer();
    this.prewarmActive = false;
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
        this.setStatus("playing");
        // Arm the pre-warm for ~30s before the expected Vercel cut.
        this.schedulePrewarm();
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
      this.setStatus("error", "signal lost");
      return;
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
