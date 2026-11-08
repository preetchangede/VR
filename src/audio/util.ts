/** Small helpers shared by every audio module. No allocations on hot paths unless noted. */

export type Rand = () => number;

/** Seeded PRNG (mulberry32): deterministic offline renders, varied live sessions. */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rr = (r: Rand, lo: number, hi: number) => lo + (hi - lo) * r();
export const pick = <T>(r: Rand, a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(r() * a.length))];
export const db = (decibels: number) => Math.pow(10, decibels / 20);
/** A finite number or the fallback (guards every value that crosses the public API). */
export const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const TINY = 1e-4;

/**
 * Percussive envelope on a gain-like param: 0 → peak in `attack` (linear), then an
 * exponential (dB-linear) decay of 80 dB over `decay`. Returns the time it is silent.
 */
export function perc(p: AudioParam, t: number, attack: number, decay: number, peak: number): number {
  const a = Math.max(attack, 0.0008);
  const pk = Math.max(peak, 1e-6);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.exponentialRampToValueAtTime(pk * TINY, t + a + Math.max(decay, 0.005));
  const end = t + a + Math.max(decay, 0.005) + 0.002;
  p.setValueAtTime(0, end);
  return end;
}

/** Exponential rise from silence to `peak` over `dur`, then a short cut (reverse-envelope swells). */
export function rise(p: AudioParam, t: number, dur: number, peak: number, cut = 0.012): number {
  const pk = Math.max(peak, 1e-6);
  p.setValueAtTime(pk * 0.0005, t);
  p.exponentialRampToValueAtTime(pk, t + Math.max(dur, 0.01));
  p.linearRampToValueAtTime(0, t + dur + cut);
  return t + dur + cut;
}

const curveCache = new Map<number, Float32Array>();
/** Unit raised-cosine curve (0 → 1), cached by resolution. */
function unitCurve(n: number): Float32Array {
  let c = curveCache.get(n);
  if (!c) {
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1));
    curveCache.set(n, c);
  }
  return c;
}

/** Smooth S-curve from `from` to `to` over `dur` (allocates one small array). */
export function swell(p: AudioParam, t: number, dur: number, from: number, to: number, n = 24): number {
  const u = unitCurve(n);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = from + (to - from) * u[i];
  p.setValueCurveAtTime(c, t, Math.max(dur, 0.005));
  return t + Math.max(dur, 0.005);
}

/**
 * Pad envelope: S-curve attack, hold, S-curve release. Returns the end time.
 * `attack` and `release` are seconds; `holdUntil` is absolute.
 */
export function pad(p: AudioParam, t: number, attack: number, holdUntil: number, release: number, peak: number): number {
  const a = Math.max(attack, 0.01);
  const tr = Math.max(holdUntil, t + a + 0.001);
  p.setValueAtTime(0, t);
  swell(p, t, a, 0, peak);
  p.setValueAtTime(peak, tr);
  return swell(p, tr, Math.max(release, 0.01), peak, 0);
}

/** Freeze a param at its current automated value at time t, discarding later events. */
export function hold(p: AudioParam, t: number): void {
  const q = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  try {
    if (typeof q.cancelAndHoldAtTime === 'function') {
      q.cancelAndHoldAtTime(t);
    } else {
      const v = p.value;
      p.cancelScheduledValues(t);
      p.setValueAtTime(v, t);
    }
  } catch {
    /* an overlapping curve: leave it, the caller's next event still applies */
  }
}

/** Glide a param toward a value from t with time-constant tau (cheap, safe to call often). */
export function glide(p: AudioParam, value: number, t: number, tau: number): void {
  try {
    p.setTargetAtTime(value, t, Math.max(tau, 0.001));
  } catch {
    /* ignore */
  }
}
