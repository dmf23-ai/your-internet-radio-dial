"use client";

// Small audio pool so rapid ticks don't cut each other off.
// Keeps us off the main Web Audio graph (that one is for the stream + VU).

let pool: HTMLAudioElement[] | null = null;
let idx = 0;

function ensurePool() {
  if (pool) return;
  if (typeof window === "undefined") return;
  pool = [];
  for (let i = 0; i < 4; i++) {
    const a = new Audio("/sfx/tick.wav");
    a.volume = 0.4;
    a.preload = "auto";
    pool.push(a);
  }
}

export function playTick(): void {
  if (typeof window === "undefined") return;
  ensurePool();
  if (!pool || pool.length === 0) return;
  const a = pool[idx++ % pool.length];
  try {
    a.currentTime = 0;
    void a.play();
  } catch {
    // ignored — user gesture may not have unlocked audio yet
  }
}
