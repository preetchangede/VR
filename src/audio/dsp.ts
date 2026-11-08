/**
 * Everything the engine synthesizes once at start-up: noise beds, crackle, a smooth random
 * modulation signal, a procedural reverb impulse response, wavetables and shaper curves.
 * All of it works on any BaseAudioContext, so offline renders are bit-identical to live.
 */
import { type Rand, rr } from './util';

export interface Waves {
  /** Warm, rolled-off saw: pads. */
  warm: PeriodicWave;
  /** Bright saw: string ensembles, brass-like blooms. */
  string: PeriodicWave;
  /** Hollow odd-harmonic tone: glassy pads. */
  glass: PeriodicWave;
  /** Buzzy reed: the source for formant choirs. */
  reed: PeriodicWave;
  /** Nearly sine with a little body: drones and subs. */
  soft: PeriodicWave;
}

export interface Bank {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  whiteSt: AudioBuffer;
  pinkSt: AudioBuffer;
  brownSt: AudioBuffer;
  /** Sparse fire crackle / sizzle impulses. Higher playbackRate = denser and brighter. */
  crackle: AudioBuffer;
  /** Smooth random signal in [-1, 1], one new value every ~0.5 s at playbackRate 1. */
  mod: AudioBuffer;
  /** Stereo reverb impulse response (~5 s hall with early reflections). */
  ir: AudioBuffer;
  waves: Waves;
  /** tanh soft-saturation, used to give sub-bass audible harmonics on headset speakers. */
  drive: Float32Array<ArrayBuffer>;
  /** Final safety soft clipper: linear to −2.5 dBFS, never above −1.1 dBFS. */
  ceiling: Float32Array<ArrayBuffer>;
}

/** Uniform white sample (filtering and RMS normalization make the distribution irrelevant). */
const uni = (r: Rand) => r() * 2 - 1;

function normalizeRms(d: Float32Array, target: number) {
  let mean = 0;
  for (let i = 0; i < d.length; i++) mean += d[i];
  mean /= d.length;
  let e = 0;
  for (let i = 0; i < d.length; i++) {
    d[i] -= mean;
    e += d[i] * d[i];
  }
  const rms = Math.sqrt(e / d.length) || 1;
  const s = target / rms;
  for (let i = 0; i < d.length; i++) d[i] *= s;
}

type Color = 'white' | 'pink' | 'brown';

function fill(color: Color, out: Float32Array, r: Rand, sr: number) {
  if (color === 'white') {
    for (let i = 0; i < out.length; i++) out[i] = uni(r);
  } else if (color === 'pink') {
    // Paul Kellet's refined pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < out.length; i++) {
      const w = uni(r);
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else {
    // Red noise: leaky integrator (−6 dB/oct above ~28 Hz, never drifts), then two one-pole
    // high-passes at 35 Hz so no energy is wasted below what any speaker can play.
    const a = Math.exp((-2 * Math.PI * 28) / sr);
    const h = Math.exp((-2 * Math.PI * 35) / sr);
    let y = 0;
    let h1 = 0;
    let x1 = 0;
    let h2 = 0;
    let x2 = 0;
    for (let i = 0; i < out.length; i++) {
      y = a * y + (1 - a) * uni(r);
      h1 = h * (h1 + y - x1);
      x1 = y;
      h2 = h * (h2 + h1 - x2);
      x2 = h1;
      out[i] = h2;
    }
  }
}

/** Seamlessly looping noise (equal-power crossfade of the tail into the head). */
function noise(ctx: BaseAudioContext, r: Rand, seconds: number, channels: number, color: Color): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(256, Math.floor(seconds * sr));
  const xf = Math.min(Math.floor(0.2 * sr), Math.floor(len / 4));
  const buf = ctx.createBuffer(channels, len, sr);
  const tmp = new Float32Array(len + xf);
  for (let ch = 0; ch < channels; ch++) {
    fill(color, tmp, r, sr);
    const d = buf.getChannelData(ch);
    d.set(tmp.subarray(0, len));
    for (let i = 0; i < xf; i++) {
      const x = ((i + 0.5) / xf) * (Math.PI / 2);
      d[i] = tmp[i] * Math.sin(x) + tmp[len + i] * Math.cos(x);
    }
    normalizeRms(d, 0.25);
  }
  return buf;
}

function crackle(ctx: BaseAudioContext, r: Rand, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const margin = Math.floor(0.012 * sr);
  let t = Math.floor(0.003 * sr);
  while (t < len - margin) {
    const phase = t / len;
    // Density breathes between ~20 and ~75 events/s so loops never sound mechanical.
    const density = 20 + 55 * Math.pow(0.5 + 0.5 * Math.sin(phase * Math.PI * 2 * 5 + 1.3), 2);
    t += Math.max(1, Math.floor((-Math.log(1 - r() * 0.999) / density) * sr));
    if (t >= len - margin) break;
    const amp = (0.06 + 0.94 * Math.pow(r(), 2.6)) * (r() < 0.5 ? -1 : 1);
    const big = r() < 0.12;
    const n = Math.max(4, Math.floor((big ? rr(r, 0.002, 0.008) : rr(r, 0.0003, 0.0025)) * sr));
    const f = big ? rr(r, 500, 1800) : rr(r, 1800, 7000);
    const tau = n / 3.5;
    const w = (2 * Math.PI * f) / sr;
    const ph = r() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const env = Math.exp(-k / tau);
      d[t + k] += amp * env * (0.65 * Math.sin(w * k + ph) + 0.2 * uni(r));
    }
  }
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
  const s = 0.95 / (pk || 1);
  for (let i = 0; i < len; i++) d[i] *= s;
  return buf;
}

/** Smooth, periodic random curve (Catmull-Rom through random points) at a low sample rate. */
function smoothRandom(ctx: BaseAudioContext, r: Rand, seconds: number, step: number): AudioBuffer {
  const rate = 8000;
  const len = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(1, len, rate);
  const n = Math.max(4, Math.round(seconds / step));
  const pts = new Float32Array(n);
  for (let i = 0; i < n; i++) pts[i] = r() * 2 - 1;
  const d = buf.getChannelData(0);
  const spp = len / n;
  for (let i = 0; i < len; i++) {
    const u = i / spp;
    const k = Math.floor(u);
    const f = u - k;
    const p0 = pts[(k - 1 + n) % n];
    const p1 = pts[k % n];
    const p2 = pts[(k + 1) % n];
    const p3 = pts[(k + 2) % n];
    d[i] =
      0.5 *
      (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  }
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  let pk = 0;
  for (let i = 0; i < len; i++) {
    d[i] -= mean;
    pk = Math.max(pk, Math.abs(d[i]));
  }
  for (let i = 0; i < len; i++) d[i] /= pk || 1;
  return buf;
}

/**
 * Procedural hall: early reflections, a smooth build-up, then decorrelated stereo noise
 * decaying in two bands (lows ring longer than highs, like a real large space), with the
 * mud below ~110 Hz removed. Energy-normalized so a send of 1 returns roughly unity.
 */
function impulse(ctx: BaseAudioContext, r: Rand, seconds: number, rtLow: number, rtHigh: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(0.016 * sr);
  const split = Math.exp((-2 * Math.PI * 1500) / sr);
  const hpA = Math.exp((-2 * Math.PI * 110) / sr);
  const lpA = Math.exp((-2 * Math.PI * 9000) / sr);
  const kL = -6.9078 / (rtLow * sr);
  const kH = -6.9078 / (rtHigh * sr);
  const build = Math.floor(0.07 * sr);
  const fadeOut = Math.floor(0.35 * sr);
  let energy = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    let eL = 1;
    let eH = 1;
    const mL = Math.exp(kL);
    const mH = Math.exp(kH);
    for (let i = pre; i < len; i++) {
      const k = i - pre;
      const w = uni(r);
      lp = split * lp + (1 - split) * w;
      let v = lp * eL + (w - lp) * eH;
      eL *= mL;
      eH *= mH;
      if (k < build) {
        const x = k / build;
        v *= x * x * (3 - 2 * x);
      }
      d[i] = v;
    }
    for (let e = 0; e < 18; e++) {
      const tt = 0.004 + Math.pow(r(), 1.3) * 0.08;
      const i0 = Math.floor((tt + (ch ? rr(r, 0, 0.0018) : 0)) * sr);
      const a = (1 - tt * 8) * rr(r, 0.35, 1) * (r() < 0.5 ? -1 : 1) * 2.4;
      const n = Math.max(8, Math.floor(rr(r, 0.0004, 0.0018) * sr));
      for (let k = 0; k < n && i0 + k < len; k++) d[i0 + k] += a * Math.exp(-k / (n / 3)) * uni(r);
    }
    let hy = 0;
    let hx = 0;
    let ly = 0;
    for (let i = 0; i < len; i++) {
      const x = d[i];
      hy = hpA * (hy + x - hx);
      hx = x;
      ly = lpA * ly + (1 - lpA) * hy;
      d[i] = ly;
    }
    for (let i = 0; i < fadeOut; i++) {
      const x = i / fadeOut;
      d[len - 1 - i] *= x * x;
    }
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
  }
  const s = 1 / Math.sqrt(energy / 2 || 1);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] *= s;
  }
  return buf;
}

function wave(ctx: BaseAudioContext, amps: ArrayLike<number>): PeriodicWave {
  const n = amps.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 1; i < n; i++) imag[i] = amps[i - 1];
  return ctx.createPeriodicWave(real, imag);
}

const harmonics = (count: number, f: (k: number) => number) => Array.from({ length: count }, (_, i) => f(i + 1));

function driveCurve(k: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

function ceilingCurve(knee: number, ceil: number, n = 8193): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const span = ceil - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

export function createBank(ctx: BaseAudioContext, r: Rand): Bank {
  return {
    white: noise(ctx, r, 3, 1, 'white'),
    pink: noise(ctx, r, 4, 1, 'pink'),
    brown: noise(ctx, r, 4, 1, 'brown'),
    whiteSt: noise(ctx, r, 3, 2, 'white'),
    pinkSt: noise(ctx, r, 4, 2, 'pink'),
    brownSt: noise(ctx, r, 4, 2, 'brown'),
    crackle: crackle(ctx, r, 6),
    mod: smoothRandom(ctx, r, 32, 0.5),
    ir: impulse(ctx, r, 4.5, 4.4, 1.7),
    waves: {
      warm: wave(ctx, harmonics(40, (k) => (1 / k) * Math.exp(-(k - 1) / 9))),
      string: wave(ctx, harmonics(64, (k) => (1 / k) * Math.exp(-(k - 1) / 34))),
      glass: wave(ctx, [1, 0.05, 0.32, 0.02, 0.13, 0, 0.05, 0, 0.02]),
      reed: wave(ctx, harmonics(36, (k) => ((k % 2 ? 1 : 0.5) / k) * Math.exp(-(k - 1) / 24))),
      soft: wave(ctx, [1, 0.2, 0.06, 0.03, 0.01]),
    },
    drive: driveCurve(2.4),
    ceiling: ceilingCurve(0.75, 0.891),
  };
}
