/**
 * Reusable instruments, shared by the score and the SFX. Each takes a Voice (which owns
 * the nodes), a destination, a start time and musical parameters, and returns its end time.
 */
import { mtof } from './theory';
import { pad, perc, rr } from './util';
import type { Voice } from './voice';

/** Clean glass/celesta bell: harmonic FM attack, inharmonic glass partials, pure tail. */
export function glass(v: Voice, dest: AudioNode, t: number, f: number, gain: number, decay: number, bright = 0.6): number {
  const end = t + decay + 0.05;
  const car = v.osc('sine', f, t, end);
  const g = v.gain(0);
  car.connect(g).connect(dest);
  perc(g.gain, t, 0.0025, decay, gain);
  if (bright > 0.05) {
    const mod = v.osc('sine', f * 2, t, t + decay * 0.4 + 0.05);
    const mg = v.gain(0);
    mod.connect(mg).connect(car.frequency);
    perc(mg.gain, t, 0.001, decay * 0.3, f * (0.25 + 1.1 * bright));
  }
  if (f * 2.756 < 14000) {
    const p2 = v.osc('sine', f * 2.756, t, t + decay * 0.45 + 0.05);
    const g2 = v.gain(0);
    p2.connect(g2).connect(dest);
    perc(g2.gain, t, 0.0015, decay * 0.42, gain * (0.08 + 0.3 * bright));
  }
  if (bright > 0.3 && f * 5.404 < 15000) {
    const p3 = v.osc('sine', f * 5.404, t, t + decay * 0.18 + 0.05);
    const g3 = v.gain(0);
    p3.connect(g3).connect(dest);
    perc(g3.gain, t, 0.001, decay * 0.16, gain * 0.1 * bright);
  }
  return end;
}

/** Tiny crystalline ping: two oscillators, nothing else (cheap enough to fire 25×/s). */
export function ping(v: Voice, dest: AudioNode, t: number, f: number, gain: number, decay: number): number {
  const end = t + decay + 0.02;
  const a = v.osc('sine', f, t, end);
  const b = v.osc('sine', f * 2.756, t, end);
  const ga = v.gain(0);
  const gb = v.gain(0);
  a.connect(ga).connect(dest);
  b.connect(gb).connect(dest);
  perc(ga.gain, t, 0.0015, decay, gain);
  perc(gb.gain, t, 0.001, decay * 0.45, gain * 0.35);
  return end;
}

/** Metallic FM bell (gongs, sci-fi shimmer). `ratio` sets the inharmonicity. */
export function bell(v: Voice, dest: AudioNode, t: number, f: number, gain: number, decay: number, ratio = 3.5, index = 1.4): number {
  const end = t + decay + 0.05;
  const car = v.osc('sine', f, t, end);
  const mod = v.osc('sine', f * ratio, t, end);
  const mg = v.gain(0);
  mod.connect(mg).connect(car.frequency);
  perc(mg.gain, t, 0.001, decay * 0.6, index * f * ratio);
  const g = v.gain(0);
  car.connect(g).connect(dest);
  perc(g.gain, t, 0.002, decay, gain);
  return end;
}

/** Soft felt piano: slightly stretched partials, each decaying faster than the last, plus a felt thump. */
export function felt(v: Voice, dest: AudioNode, t: number, f: number, gain: number, decay = 3.2, bright = 0.5): number {
  const amps = [1, 0.42 + 0.2 * bright, 0.2 + 0.15 * bright, 0.09 + 0.1 * bright, 0.04 + 0.06 * bright, 0.02 + 0.03 * bright];
  const B = 0.00035;
  let end = t;
  for (let k = 1; k <= amps.length; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > 9000) break;
    const d = decay / (1 + 0.75 * (k - 1));
    const o = v.osc('sine', fk, t, t + d + 0.03);
    const g = v.gain(0);
    o.connect(g).connect(dest);
    perc(g.gain, t, 0.006 + 0.002 * k, d, gain * amps[k - 1]);
    end = Math.max(end, t + d + 0.03);
  }
  const n = v.noise(v.bank.pink, t, t + 0.12);
  const lp = v.bq('lowpass', 500 + f * 0.6, 0.8);
  const ng = v.gain(0);
  n.connect(lp).connect(ng).connect(dest);
  perc(ng.gain, t, 0.002, 0.07, gain * 0.25);
  return end;
}

/** Filtered-saw pluck (harp/synth ostinato). */
export function pluck(v: Voice, dest: AudioNode, t: number, f: number, gain: number, decay: number, cutoff = 2400): number {
  const end = t + decay + 0.05;
  const w = v.bank.waves.warm;
  const a = v.osc(w, f, t, end, -5);
  const b = v.osc(w, f, t, end, 6);
  const lp = v.bq('lowpass', cutoff, 1.4);
  lp.frequency.setValueAtTime(cutoff, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.2, 120), t + decay * 0.6);
  const g = v.gain(0);
  a.connect(lp);
  b.connect(lp);
  lp.connect(g).connect(dest);
  perc(g.gain, t, 0.003, decay, gain * 0.5);
  return end;
}

/** Sub boom with a pitch drop; `drive` adds a saturated harmonic layer so small speakers hear it. */
export function thump(v: Voice, dest: AudioNode, t: number, f0: number, f1: number, sweep: number, decay: number, gain: number, drive = 0): number {
  const end = t + decay + 0.1;
  const o = v.osc('sine', f0, t, end);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 10), t + Math.max(sweep, 0.01));
  const g = v.gain(0);
  o.connect(g).connect(dest);
  perc(g.gain, t, 0.003, decay, gain);
  if (drive > 0) {
    const pre = v.gain(2.2);
    const sh = v.shaper(v.bank.drive);
    const hp = v.bq('highpass', Math.max(f1 * 2, 70), 0.7);
    const lp = v.bq('lowpass', 900, 0.7);
    const dg = v.gain(drive);
    g.connect(pre).connect(sh).connect(hp).connect(lp).connect(dg).connect(dest);
  }
  return end;
}

export interface BurstOpts {
  buf?: AudioBuffer;
  type?: BiquadFilterType;
  f0: number;
  f1?: number;
  sweep?: number;
  q?: number;
  attack?: number;
  decay: number;
  gain: number;
  rate?: number;
}

/** Filtered noise burst with an optional exponential filter sweep. */
export function burst(v: Voice, dest: AudioNode, t: number, o: BurstOpts): number {
  const end = t + (o.attack ?? 0.002) + o.decay + 0.05;
  const n = v.noise(o.buf ?? v.bank.pink, t, end, o.rate ?? 1);
  const f = v.bq(o.type ?? 'lowpass', o.f0, o.q ?? 0.707);
  if (o.f1 !== undefined) {
    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 20), t + (o.sweep ?? o.decay));
  }
  const g = v.gain(0);
  n.connect(f).connect(g).connect(dest);
  perc(g.gain, t, o.attack ?? 0.002, o.decay, o.gain);
  return end;
}

export interface SwellOpts {
  wave?: PeriodicWave | OscillatorType;
  attack: number;
  hold: number;
  release: number;
  gain: number;
  detune?: number;
  spread?: number;
  cutoff?: number;
  q?: number;
  stagger?: number;
}

/**
 * A sustained chord with an S-curve swell: two detuned oscillators per note, split hard
 * left/right for width, into one shared low-pass. Returns the filter for sweeps.
 */
export function chordSwell(v: Voice, dest: AudioNode, t: number, midi: readonly number[], o: SwellOpts): { end: number; filter: BiquadFilterNode } {
  const lp = v.bq('lowpass', o.cutoff ?? 2200, o.q ?? 0.6);
  const spread = o.spread ?? 0.7;
  const left = v.pan(-spread);
  const right = v.pan(spread);
  left.connect(lp);
  right.connect(lp);
  lp.connect(dest);
  const det = o.detune ?? 7;
  const wave = o.wave ?? v.bank.waves.warm;
  let end = t;
  midi.forEach((m, i) => {
    const t0 = t + (o.stagger ?? 0) * i;
    const f = mtof(m);
    const e = t0 + o.attack + o.hold + o.release + 0.05;
    const per = o.gain / Math.sqrt(1 + 0.15 * i);
    for (const side of [-1, 1]) {
      const osc = v.osc(wave, f, t0, e, side * det + rr(v.r, -2, 2));
      const g = v.gain(0);
      osc.connect(g).connect(side < 0 ? left : right);
      pad(g.gain, t0, o.attack, t0 + o.attack + o.hold, o.release, per);
    }
    end = Math.max(end, e);
  });
  return { end, filter: lp };
}

const VOWELS = {
  a: [800, 1150, 2900],
  o: [450, 800, 2830],
  u: [325, 700, 2530],
  e: [400, 1600, 2700],
} as const;
export type Vowel = keyof typeof VOWELS;

export interface ChoirOpts {
  attack: number;
  hold: number;
  release: number;
  gain: number;
  vowel?: Vowel;
  spread?: number;
  vibrato?: number;
  stagger?: number;
}

/** Formant choir: buzzy detuned reeds through a vowel filter bank, with gentle vibrato. */
export function choir(v: Voice, dest: AudioNode, t: number, midi: readonly number[], o: ChoirOpts): number {
  const spread = o.spread ?? 0.6;
  const left = v.pan(-spread);
  const right = v.pan(spread);
  const bus = v.gain(1);
  left.connect(bus);
  right.connect(bus);
  const fm = VOWELS[o.vowel ?? 'a'];
  const fq = [7, 9, 11];
  const fg = [1.8, 1.0, 0.55];
  for (let i = 0; i < 3; i++) {
    const bp = v.bq('bandpass', fm[i], fq[i]);
    const g = v.gain(fg[i]);
    bus.connect(bp).connect(g).connect(dest);
  }
  const body = v.bq('lowpass', 600, 0.7);
  const bg = v.gain(0.12);
  bus.connect(body).connect(bg).connect(dest);
  let end = t;
  const total = o.attack + o.hold + o.release + (o.stagger ?? 0) * midi.length + 0.1;
  const vib = v.lfo(t, t + total, 4.6 + v.r() * 0.8, o.vibrato ?? 9);
  midi.forEach((m, i) => {
    const t0 = t + (o.stagger ?? 0) * i;
    const f = mtof(m);
    const e = t0 + o.attack + o.hold + o.release + 0.05;
    for (const side of [-1, 1]) {
      const osc = v.osc(v.bank.waves.reed, f, t0, e, side * 9 + rr(v.r, -3, 3));
      vib.connect(osc.detune);
      const g = v.gain(0);
      osc.connect(g).connect(side < 0 ? left : right);
      pad(g.gain, t0, o.attack, t0 + o.attack + o.hold, o.release, o.gain);
    }
    end = Math.max(end, e);
  });
  return end;
}

/** Bird / droplet chirp: a fast exponential glide, optionally trilled. */
export function chirp(v: Voice, dest: AudioNode, t: number, f0: number, f1: number, dur: number, gain: number, trill = 0, trillRate = 32): number {
  const end = t + dur + 0.02;
  const o = v.osc('sine', f0, t, end);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  if (trill > 0) {
    const m = v.osc('sine', trillRate, t, end);
    const mg = v.gain(f0 * trill);
    m.connect(mg).connect(o.frequency);
  }
  const g = v.gain(0);
  o.connect(g).connect(dest);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.18);
  g.gain.exponentialRampToValueAtTime(gain * 0.001, t + dur);
  g.gain.setValueAtTime(0, t + dur + 0.005);
  return end;
}
