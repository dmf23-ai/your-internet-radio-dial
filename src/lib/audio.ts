// Singleton audio engine.
//
// Two <audio> elements are maintained side-by-side:
//
//   corsEl   — crossOrigin="anonymous"; routed through AudioContext →
//              AnalyserNode → GainNode → destination. Enables the VU meter.
//              Requires the stream server to return permissive CORS headers.
//
//   nocorsEl — no crossOrigin; plays directly with element.volume. Used when
//              a stream server doesn't return CORS headers (setting
//              crossOrigin="anonymous" would otherwise make Chrome refuse
//              to load the media). No analyser / VU metering on this path.
//
// HLS streams are handed to hls.js (dynamic import) in either case.

import type { StreamType } from "@/data/seed";

export type AudioStatus = "idle" | "buffering" | "playing" | "error";

export interface AudioSnapshot {
  status: AudioStatus;
  meterAvailable: boolean;
  errorMessage?: string;
}

type Listener = (s: AudioSnapshot) => void;
type Kind = "cors" | "nocors";

class AudioEngine {
  private corsEl: HTMLAudioElement | null = null;
  private nocorsEl: HTMLAudioElement | null = null;
  private active: Kind = "cors";

  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;

  private hls: any = null;
  private timeBuf: Uint8Array<ArrayBuffer> | null = null;

  private listeners = new Set<Listener>();
  private snapshot: AudioSnapshot = { status: "idle", meterAvailable: false };
  private currentUrl = "";
  private currentType: StreamType = "unknown";
  private currentCorsOk = true;
  private volume = 0.7;

  // Auto-reconnect state. When the upstream proxy connection is terminated
  // (typically by Vercel's serverless function timeout, but also any network
  // hiccup), the audio element fires `ended` or pauses unexpectedly. We then
  // retry the same URL with backoff, transparent to the user. After
  // MAX_RECONNECTS consecutive failures we surface a real "signal lost"
  // error so the user knows the station itself is dead, not just transient.
  private intentPlaying = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Guards the brief window during a station change / reload where we
  // pause+load the element. Those internal pauses fire `pause` events that
  // would otherwise be misread as unexpected drops and schedule a bogus
  // reconnect that fires mid-playback.
  private inTransition = false;
  private static readonly RECONNECT_DELAYS_MS = [500, 1500, 4000];
  private static readonly MAX_RECONNECTS = 3;

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

    // Cancel any pending reconnect — a fresh play() supersedes it.
    this.clearReconnectTimer();
    // Record the playback target so reconnect attempts can re-issue with the
    // same args without depending on a closure.
    this.currentType = type;
    this.currentCorsOk = corsOk;
    // Mark intent up-front so any synchronous events (e.g. an immediate error
    // during el.play()) are correctly classified as unexpected.
    this.intentPlaying = true;

    // Decide which element + which URL to play:
    //  - CORS-clean streams → direct URL on corsEl (VU meter enabled).
    //  - Non-CORS, non-HLS → route through /api/stream (same-origin) on
    //    corsEl. Same-origin ⇒ no MediaElementSource taint ⇒ meter works.
    //  - Non-CORS HLS → route through /api/hls (manifest-rewriting proxy)
    //    on corsEl. hls.js fetches a same-origin manifest + segments and
    //    feeds MSE, so the media element stays untainted ⇒ meter works.
    const isHls = type === "hls" || /\.m3u8(\?|$)/i.test(url);
    const useProxy = !corsOk;
    const playUrl = useProxy
      ? isHls
        ? `/api/hls?url=${encodeURIComponent(url)}`
        : `/api/stream?url=${encodeURIComponent(url)}`
      : url;

    const nextKind: Kind = corsOk || useProxy ? "cors" : "nocors";
    const useEl = nextKind === "cors" ? this.corsEl! : this.nocorsEl!;
    const otherEl = nextKind === "cors" ? this.nocorsEl! : this.corsEl!;

    // Pause & unload the element we aren't using so we only emit one stream.
    this.teardownHls();
    try {
      otherEl.pause();
      otherEl.removeAttribute("src");
      otherEl.load();
    } catch {}

    // Same URL on the same path → just resume. We key on the upstream url
    // (what the caller passed), not playUrl, so proxy wrappers don't confuse
    // the cache check.
    if (url === this.currentUrl && useEl.src && this.active === nextKind) {
      try {
        if (nextKind === "cors") await this.ensureContext();
        await useEl.play();
        this.setStatus("playing");
      } catch (e: any) {
        this.intentPlaying = false;
        this.setStatus("error", e?.message ?? "play failed");
      }
      return;
    }

    // New URL (or path switch) — full reload on the chosen element. Mark
    // transition so the queued pause/emptied/abort events from the cleanup
    // below don't trigger a spurious reconnect.
    this.inTransition = true;
    try {
      useEl.pause();
    } catch {}
    useEl.removeAttribute("src");
    useEl.load();

    this.active = nextKind;
    this.currentUrl = url;
    this.setStatus("buffering");

    try {
      if (isHls && !useEl.canPlayType("application/vnd.apple.mpegurl")) {
        const mod: any = await import("hls.js").catch(() => null);
        const Hls = mod?.default ?? mod?.Hls ?? mod;
        if (!Hls || !Hls.isSupported?.()) {
          this.setStatus(
            "error",
            "HLS not supported in this browser (hls.js missing).",
          );
          return;
        }
        this.hls = new Hls({ enableWorker: true });
        // HLS is never routed through /api/stream right now.
        this.hls.loadSource(playUrl);
        this.hls.attachMedia(useEl);
      } else {
        useEl.src = playUrl;
      }

      if (nextKind === "cors") {
        await this.ensureContext();
      } else {
        // no-CORS path: skip the graph entirely; use element volume.
        useEl.volume = this.volume * this.volume;
      }

      // Reflect meter availability for the active path.
      const meterAvailable = nextKind === "cors" && !!this.analyser;
      this.snapshot = { ...this.snapshot, meterAvailable };
      this.emit();

      await useEl.play();
      this.setStatus("playing");
    } catch (e: any) {
      this.intentPlaying = false;
      this.setStatus("error", e?.message ?? "playback failed");
    } finally {
      // Clear transition AFTER play() resolves — by this point all queued
      // cleanup events have run through their (suppressed) handlers.
      this.inTransition = false;
    }
  }

  pause(): void {
    // User intent: stop listening. Cancel any auto-reconnect first so the
    // pause event handler (below) doesn't misread this as an unexpected drop.
    this.intentPlaying = false;
    this.clearReconnectTimer();
    const el = this.active === "cors" ? this.corsEl : this.nocorsEl;
    if (!el) return;
    try {
      el.pause();
      this.setStatus("idle");
    } catch {}
  }

  stop(): void {
    this.intentPlaying = false;
    this.clearReconnectTimer();
    this.teardownHls();
    for (const el of [this.corsEl, this.nocorsEl]) {
      if (!el) continue;
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch {}
    }
    this.currentUrl = "";
    this.setStatus("idle");
  }

  setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    this.volume = clamped;
    const out = clamped * clamped; // curved — more natural to the ear
    // CORS path via gain node (if context has been initialised).
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(out, this.ctx.currentTime, 0.01);
    } else if (this.corsEl) {
      // Fallback before context exists.
      this.corsEl.volume = out;
    }
    // No-CORS path always uses element volume.
    if (this.nocorsEl) this.nocorsEl.volume = out;
  }

  getVolume(): number {
    return this.volume;
  }

  // RMS of current analyser window, 0..1. Only the CORS path has a meter.
  getRms(): number {
    if (this.active !== "cors") return 0;
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

  private wireEvents(el: HTMLAudioElement, kind: Kind) {
    // Only fire status updates for the currently-active element. The other
    // element may be idling with no src; we don't want its events flipping
    // global status.
    const when = (fn: () => void) => () => {
      if (this.active === kind) fn();
    };
    el.addEventListener("waiting", when(() => this.setStatus("buffering")));
    el.addEventListener(
      "playing",
      when(() => {
        // Confirmed audio output → reset reconnect counter and cancel any
        // pending reconnect timer (e.g. one queued from a transition pause
        // that we couldn't suppress in time).
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();
        this.setStatus("playing");
      }),
    );
    el.addEventListener(
      "pause",
      when(() => {
        if (this.inTransition) return;
        if (this.snapshot.status === "error") return;
        // If the user asked to be playing but the element paused on its own
        // (Vercel cut the proxy stream, network blip, etc.), treat it as a
        // drop and try to reconnect transparently.
        if (this.intentPlaying) {
          this.scheduleReconnect();
        } else {
          this.setStatus("idle");
        }
      }),
    );
    el.addEventListener(
      "ended",
      when(() => {
        if (this.inTransition) return;
        // For continuous radio streams, `ended` should never legitimately
        // fire — it means the response body was closed (Vercel timeout,
        // upstream disconnect, etc.). Try to reconnect.
        if (this.intentPlaying) this.scheduleReconnect();
      }),
    );
    el.addEventListener(
      "error",
      when(() => {
        if (this.inTransition) return;
        // Decode/network error. If user wants to be playing, give reconnect
        // a chance — transient errors often recover on a fresh fetch. After
        // MAX_RECONNECTS, scheduleReconnect itself surfaces "signal lost".
        if (this.intentPlaying) this.scheduleReconnect();
        else this.setStatus("error", "audio element error");
      }),
    );
    el.addEventListener("stalled", when(() => this.setStatus("buffering")));
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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
    // Show "Tuning…" in the lamp while we retry.
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

    const useEl = this.active === "cors" ? this.corsEl : this.nocorsEl;
    if (useEl) {
      // Force the play() shortcut path to skip; we want a brand-new fetch,
      // not a resume on a closed connection. Wrap in inTransition so the
      // resulting pause/emptied don't recursively re-schedule a reconnect.
      this.inTransition = true;
      try {
        useEl.pause();
        useEl.removeAttribute("src");
        useEl.load();
      } catch {}
      this.inTransition = false;
    }

    try {
      await this.play(url, type, corsOk);
      // Note: reconnectAttempts is reset by the `playing` event when audio
      // is actually flowing — not here, since play() resolving doesn't yet
      // guarantee buffered playback.
    } catch {
      // play() already handled status; if it failed in a way that didn't
      // trigger a reconnect-worthy event, manually re-schedule.
      if (this.intentPlaying && !this.reconnectTimer) {
        this.scheduleReconnect();
      }
    }
  }

  private ensureDom() {
    if (typeof document === "undefined") return;
    if (!this.corsEl) {
      const el = document.createElement("audio");
      el.crossOrigin = "anonymous";
      el.preload = "none";
      (el as any).playsInline = true;
      el.setAttribute("playsinline", "");
      this.wireEvents(el, "cors");
      document.body.appendChild(el);
      this.corsEl = el;
    }
    if (!this.nocorsEl) {
      const el = document.createElement("audio");
      // No crossOrigin: browser plays media without requiring CORS headers.
      el.preload = "none";
      (el as any).playsInline = true;
      el.setAttribute("playsinline", "");
      this.wireEvents(el, "nocors");
      document.body.appendChild(el);
      this.nocorsEl = el;
    }
  }

  private async ensureContext() {
    if (!this.corsEl) return;
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      try {
        this.source = this.ctx.createMediaElementSource(this.corsEl);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.timeBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this.volume * this.volume;
        this.source.connect(this.analyser);
        this.analyser.connect(this.gain);
        this.gain.connect(this.ctx.destination);
        this.snapshot = { ...this.snapshot, meterAvailable: true };
        this.emit();
      } catch {
        // Graph failed — keep meterAvailable false.
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
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {}
      this.hls = null;
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
