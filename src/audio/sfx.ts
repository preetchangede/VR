/**
 * One-shot sound designs. Each builds into a Voice: `v.out` is the spatial (mono → HRTF)
 * path at the event position, `v.wide` is unpanned stereo for musical blooms and
 * sub-panners, `v.wet` / `v.dly` are the reverb and echo sends.
 */
import { bell, burst, choir, chirp, chordSwell, felt, glass, ping, thump } from './instruments';
import { mtof, pent } from './theory';
import type { SfxName, Vec3 } from './types';
import { clamp, pad, perc, type Rand, rise, rr } from './util';
import type { Voice } from './voice';

export interface SfxCtx {
  v: Voice;
  t: number;
  /** 0..1 */
  size: number;
  /** Multiplier. */
  pitch: number;
  pos: Vec3 | null;
  listener: Vec3;
  r: Rand;
}

export interface SfxDef {
  /** 0 = expendable … 3 = hero. Lower priorities are stolen first. */
  priority: number;
  /** Hero sounds cut through silence() (they are the reason for it). */
  hero?: boolean;
  /** Base level of the design. */
  level: number;
  build(c: SfxCtx): void;
}

/** Octave shift (in semitones) implied by a pitch multiplier, so musical layers stay in key. */
const octaves = (p: number) => 12 * Math.round(Math.log2(clamp(p, 0.25, 4)));

/** A stereo-placed group feeding `v.wide` plus sends; returns its input node. */
function group(v: Voice, pan: number, rev: number, echo = 0): GainNode {
  const g = v.gain(1);
  const p = v.pan(pan);
  g.connect(p).connect(v.wide);
  v.send(g, rev, echo);
  return g;
}

/** A few shared stereo groups: events pick one instead of each allocating its own. */
function groups(v: Voice, pans: readonly number[], rev: number, echo = 0): GainNode[] {
  return pans.map((p) => group(v, p, rev, echo));
}
const anyOf = <T>(r: Rand, a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(r() * a.length))];
const SPREAD3 = [-0.7, 0, 0.7] as const;

/** Pulsar beam event: a whoosh swelling into a hard metallic tick. `lead` = whoosh pre-roll. */
export function pulsarEvent(v: Voice, dest: AudioNode, t: number, period: number, lead: number, gain = 1): number {
  const w = Math.min(0.45, period * 0.6);
  const w0 = t - lead;
  const n = v.noise(v.bank.pink, w0, t + w + 0.05);
  const bp = v.bq('bandpass', 500, 1.4);
  bp.frequency.setValueAtTime(450, w0);
  bp.frequency.exponentialRampToValueAtTime(2000, t + 0.01);
  bp.frequency.exponentialRampToValueAtTime(600, t + w);
  const g = v.gain(0);
  g.gain.setValueAtTime(0, w0);
  g.gain.linearRampToValueAtTime(0.32 * gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0005, t + w);
  g.gain.setValueAtTime(0, t + w + 0.01);
  n.connect(bp).connect(g).connect(dest);
  burst(v, dest, t, { buf: v.bank.white, type: 'bandpass', f0: 3400, q: 1.4, attack: 0.002, decay: 0.03, gain: 0.32 * gain });
  const pt = v.osc('sine', 1760, t, t + 0.12);
  const pg = v.gain(0);
  pt.connect(pg).connect(dest);
  perc(pg.gain, t, 0.0006, 0.07, 0.1 * gain);
  bell(v, dest, t, 2637, 0.035 * gain, 0.22, 1.41, 0.9);
  return t + w + 0.06;
}

export const SFX: Record<SfxName, SfxDef> = {
  // ─── The moment a star is born ────────────────────────────────────────────────
  ignite: {
    priority: 3,
    hero: true,
    level: 1,
    build({ v, t, size: S, pitch: P, r }) {
      const deep = 1 - 0.35 * S;
      const oct = octaves(P);
      // Flash: a bright crack, then the sub-boom and the whoomp of gas catching fire.
      burst(v, v.out, t, { buf: v.bank.white, type: 'highpass', f0: 2800, q: 0.6, attack: 0.001, decay: 0.2, gain: 0.22 });
      thump(v, v.out, t, 120 * P * deep, 36 * P * deep, 0.45, 1.8 + 1.6 * S, 0.62, 0.32);
      burst(v, v.out, t, { buf: v.bank.pink, type: 'lowpass', f0: 9000, f1: 300, sweep: 1.6, q: 0.9, attack: 0.004, decay: 1.9 + S, gain: 0.36 });
      const wn = v.noise(v.bank.pinkSt, t, t + 3.6);
      const wf = v.bq('lowpass', 7000, 0.7);
      wf.frequency.setValueAtTime(7000, t);
      wf.frequency.exponentialRampToValueAtTime(450, t + 2.6);
      const wg = v.gain(0);
      perc(wg.gain, t, 0.01, 2.8, 0.16);
      wn.connect(wf).connect(wg).connect(v.wide);
      v.send(wg, 0.8);

      // The bloom: a bright Dmaj9 with the Lydian #11 on top, strummed open, long tail.
      const bloomIn = v.gain(1);
      bloomIn.connect(v.wide);
      v.send(bloomIn, 0.95, 0.12);
      const low = S > 0.65 ? -12 : 0;
      const notes = [50 + low, 57, 62, 66, 69, 73, 76].map((m) => m + oct);
      const bloom = chordSwell(v, bloomIn, t + 0.015, notes, {
        wave: v.bank.waves.string,
        attack: 0.08,
        hold: 0.25,
        release: 6.5 + 2 * S,
        gain: 0.05,
        detune: 8,
        spread: 0.85,
        cutoff: 600,
        q: 0.7,
        stagger: 0.022,
      });
      const bf = bloom.filter.frequency;
      bf.setValueAtTime(500, t);
      bf.exponentialRampToValueAtTime(5600, t + 0.32);
      bf.exponentialRampToValueAtTime(1500, t + 3);
      bf.exponentialRampToValueAtTime(650, t + 8);

      // Voices in the light.
      choir(v, bloomIn, t + 0.04, [62, 66, 69, 73].map((m) => m + oct), { attack: 0.35, hold: 0.6, release: 5.5 + 2 * S, gain: 0.022, vowel: 'a', spread: 0.8, stagger: 0.03 });
      // Low brass-like fifth under it: weight and triumph.
      const brass = chordSwell(v, bloomIn, t + 0.03, [38, 45, 50].map((m) => m + oct + low), {
        wave: v.bank.waves.string,
        attack: 0.14,
        hold: 0.35,
        release: 4.8 + 1.5 * S,
        gain: 0.05,
        detune: 4,
        spread: 0.35,
        cutoff: 300,
        q: 1.3,
      });
      const brf = brass.filter.frequency;
      brf.setValueAtTime(240, t);
      brf.exponentialRampToValueAtTime(2300, t + 0.28);
      brf.exponentialRampToValueAtTime(420, t + 4);

      // Sparkles thrown off the flash: D6 A6 C#7 E7 G#6 F#7.
      const sparkle = groups(v, [-0.8, 0.8], 0.7, 0.3);
      [86, 93, 97, 100, 92, 102].forEach((m, i) => {
        glass(v, sparkle[i % 2], t + 0.05 + i * 0.075 + rr(r, 0, 0.05), mtof(m + oct), 0.034, 2.4 + r() * 1.2, 0.8);
      });
      // Air rising out of the bloom.
      const air = v.noise(v.bank.whiteSt, t, t + 4.5);
      const ab = v.bq('bandpass', 7500, 0.8);
      const ag = v.gain(0);
      air.connect(ab).connect(ag).connect(v.wide);
      pad(ag.gain, t + 0.05, 0.5, t + 0.8, 3.4, 0.05);
      v.send(ag, 0.9);
    },
  },

  'star-born': {
    priority: 2,
    level: 1.25,
    build({ v, t, size: S, pitch: P }) {
      const oct = octaves(P);
      const voicings = [
        [57, 64, 66, 73, 76],
        [50, 57, 64, 66, 69],
        [38, 45, 54, 61, 64],
      ];
      const notes = voicings[S < 0.34 ? 0 : S < 0.67 ? 1 : 2].map((m) => m + oct);
      const k = 1 + 0.6 * S;
      const cg = v.gain(1);
      cg.connect(v.wide);
      v.send(cg, 0.85, 0.08);
      choir(v, cg, t, notes, { attack: 1.3 * k, hold: 0.8 * k, release: 2.8 * k, gain: 0.034, vowel: 'a', spread: 0.75, stagger: 0.12 });
      chordSwell(v, cg, t + 0.15, notes, { wave: v.bank.waves.warm, attack: 1.5 * k, hold: 0.6 * k, release: 3 * k, gain: 0.022, cutoff: 1400, spread: 0.6 });
      const air = v.noise(v.bank.whiteSt, t, t + 6 * k);
      const ab = v.bq('bandpass', 6000, 0.7);
      const ag = v.gain(0);
      air.connect(ab).connect(ag).connect(cg);
      pad(ag.gain, t, 1.4 * k, t + 1.8 * k, 2.6 * k, 0.025);
      if (S > 0.5) {
        const sub = v.osc('sine', mtof(38 + oct), t, t + 5.5 * k);
        const sg = v.gain(0);
        sub.connect(sg).connect(v.wide);
        pad(sg.gain, t, 1.2 * k, t + 1.6 * k, 3 * k, 0.12 * S);
      }
    },
  },

  collapse: {
    priority: 3,
    hero: true,
    level: 1.3,
    build({ v, t, size: S }) {
      const D = 0.8 + 0.6 * S;
      const n = v.noise(v.bank.pink, t, t + D + 0.05);
      const f = v.bq('bandpass', 250, 0.9);
      f.frequency.setValueAtTime(250, t);
      f.frequency.exponentialRampToValueAtTime(7000, t + D);
      const g = v.gain(0);
      rise(g.gain, t, D, 0.42);
      n.connect(f).connect(g).connect(v.out);
      const n2 = v.noise(v.bank.whiteSt, t, t + D + 0.05);
      const hp = v.bq('highpass', 300, 0.7);
      hp.frequency.setValueAtTime(300, t);
      hp.frequency.exponentialRampToValueAtTime(5000, t + D);
      const g2 = v.gain(0);
      rise(g2.gain, t, D, 0.12);
      n2.connect(hp).connect(g2).connect(v.wide);
      // A glassy cluster sucked upward (reverse envelope, rising pitch).
      for (const m of [74, 80, 81, 85, 88, 92]) {
        const f0 = mtof(m);
        const o = v.osc('sine', f0 * 0.93, t, t + D + 0.05);
        o.frequency.setValueAtTime(f0 * 0.93, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 1.07, t + D);
        const og = v.gain(0);
        rise(og.gain, t, D, 0.03);
        o.connect(og).connect(v.wide);
      }
      const sub = v.osc('sine', 28, t, t + D + 0.05);
      sub.frequency.setValueAtTime(28, t);
      sub.frequency.exponentialRampToValueAtTime(120, t + D);
      const sg = v.gain(0);
      rise(sg.gain, t, D, 0.42);
      sub.connect(sg).connect(v.out);
      const pre = v.gain(2);
      const sh = v.shaper(v.bank.drive);
      const shg = v.gain(0.12);
      sg.connect(pre).connect(sh).connect(shg).connect(v.out);
    },
  },

  // ─── The detonation ─────────────────────────────────────────────────────────────
  supernova: {
    priority: 3,
    hero: true,
    level: 1.15,
    build({ v, t, size: S, pitch: P, pos, listener: l, r }) {
      const L = 7 + 4 * S;
      const deep = 1 - 0.3 * S;
      const oct = octaves(P);
      // Flash crack and punch.
      burst(v, v.out, t, { buf: v.bank.white, type: 'highpass', f0: 1400, q: 0.5, attack: 0.0008, decay: 0.14, gain: 0.34 });
      burst(v, v.wide, t, { buf: v.bank.whiteSt, type: 'highpass', f0: 3000, q: 0.5, attack: 0.0008, decay: 0.45, gain: 0.12 });
      thump(v, v.out, t, 170 * P, 48 * P, 0.12, 0.5, 0.42, 0.3);
      // Sub drop (the floor falls away).
      thump(v, v.wide, t + 0.01, 78 * P * deep, 22 * P * deep, 2.6, 4 + 3 * S, 0.62, 0.3);
      // The roar: wide brown + pink noise, closing from white-hot to a rumble, roiling.
      const roar = (buf: AudioBuffer, gain: number) => {
        const n = v.noise(buf, t, t + L + 0.05);
        const lp = v.bq('lowpass', 14000, 0.6);
        lp.frequency.setValueAtTime(14000, t);
        lp.frequency.exponentialRampToValueAtTime(2600, t + 0.9);
        lp.frequency.exponentialRampToValueAtTime(320, t + L * 0.8);
        v.mod(t, t + L, 1.6, 240).connect(lp.frequency);
        const g = v.gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.02);
        g.gain.exponentialRampToValueAtTime(gain * 0.7, t + 1.5);
        g.gain.exponentialRampToValueAtTime(gain * 0.3, t + 4);
        g.gain.exponentialRampToValueAtTime(gain * 0.0001, t + L);
        g.gain.setValueAtTime(0, t + L + 0.01);
        n.connect(lp).connect(g).connect(v.wide);
        v.send(g, 0.45);
      };
      roar(v.bank.brownSt, 0.55);
      roar(v.bank.pinkSt, 0.2);
      // Rolling thunder: the blast echoing off the edges of the room.
      const thunder = groups(v, [-0.55, 0.55], 0.6);
      [1.1, 2.6, 4.3].forEach((d, i) => {
        const tt = t + d + rr(r, -0.2, 0.2);
        const g = thunder[i % 2];
        const n = v.noise(v.bank.brown, tt, tt + 4.2);
        const lp = v.bq('lowpass', 420, 0.8);
        lp.frequency.setValueAtTime(700, tt);
        lp.frequency.exponentialRampToValueAtTime(160, tt + 3.8);
        const ng = v.gain(0);
        n.connect(lp).connect(ng).connect(g);
        pad(ng.gain, tt, 0.5, tt + 0.7, 3.2, (0.42 - 0.1 * i) * (0.6 + 0.4 * S));
      });
      // The braam: a saturated low brass cluster that blooms and darkens.
      const bt = t + 0.05;
      const bus = v.gain(1);
      const sh = v.shaper(v.bank.drive);
      const blp = v.bq('lowpass', 200, 1.1);
      blp.frequency.setValueAtTime(180, bt);
      blp.frequency.exponentialRampToValueAtTime(1700, bt + 0.45);
      blp.frequency.exponentialRampToValueAtTime(240, bt + 5.5);
      const bg = v.gain(0);
      bg.gain.setValueAtTime(0, bt);
      bg.gain.linearRampToValueAtTime(0.34, bt + 0.25);
      bg.gain.exponentialRampToValueAtTime(0.16, bt + 2.2);
      bg.gain.exponentialRampToValueAtTime(0.0003, bt + 5.5 + 2 * S);
      bg.gain.setValueAtTime(0, bt + 5.6 + 2 * S);
      bus.connect(sh).connect(blp).connect(bg).connect(v.wide);
      v.send(bg, 0.5);
      for (const m of [26, 38, 45]) {
        for (const d of [-11, 9]) {
          const o = v.osc(v.bank.waves.string, mtof(m + oct), bt, bt + 6 + 2 * S, d);
          const og = v.gain(0.16);
          o.connect(og).connect(bus);
        }
      }
      // Metallic shimmer: bell-mode partials on D and A, beating slowly.
      const ratios = [1, 2.756, 5.404, 8.933];
      [mtof(62 + oct), mtof(69 + oct)].forEach((base, bi) => {
        const g = group(v, bi ? 0.6 : -0.6, 0.9, 0.05);
        ratios.forEach((k, i) => {
          for (const beat of i < 2 ? [-0.7, 0.9] : [0.4]) {
            const f = base * k + beat;
            if (f > 12000) continue;
            const o = v.osc('sine', f, t, t + L);
            const og = v.gain(0);
            o.connect(og).connect(g);
            perc(og.gain, t + 0.02 + 0.12 * i, 0.08 + 0.3 * i, L * (0.85 - 0.15 * i), 0.03 / (1 + 0.4 * i));
          }
        });
      });
      // Shockwave: a roaring whoosh that rushes from the star, through your head, to behind you.
      const sw = t + 0.1;
      const swDur = 0.95;
      const from = pos ?? { x: l.x, y: l.y - 0.3, z: l.z - 0.5 };
      const dx = l.x - from.x;
      const dy = l.y - from.y;
      const dz = l.z - from.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const to = { x: l.x + (dx / dl) * 1.6, y: l.y + (dy / dl) * 0.4, z: l.z + (dz / dl) * 1.6 };
      const mp = v.panner3d(from, 0.45);
      mp.positionX.setValueAtTime(from.x, sw);
      mp.positionY.setValueAtTime(from.y, sw);
      mp.positionZ.setValueAtTime(from.z, sw);
      mp.positionX.linearRampToValueAtTime(to.x, sw + swDur);
      mp.positionY.linearRampToValueAtTime(to.y, sw + swDur);
      mp.positionZ.linearRampToValueAtTime(to.z, sw + swDur);
      mp.connect(v.wide);
      const swn = v.noise(v.bank.pink, sw, sw + swDur + 0.1);
      const swf = v.bq('bandpass', 300, 0.8);
      swf.frequency.setValueAtTime(300, sw);
      swf.frequency.exponentialRampToValueAtTime(2800, sw + swDur * 0.45);
      swf.frequency.exponentialRampToValueAtTime(450, sw + swDur);
      const swg = v.gain(0);
      swg.gain.setValueAtTime(0, sw);
      swg.gain.linearRampToValueAtTime(0.62, sw + swDur * 0.42);
      swg.gain.linearRampToValueAtTime(0, sw + swDur);
      swn.connect(swf).connect(swg).connect(mp);
      // Newborn elements: crystalline sparkles appearing all around you (four HRTF zones,
      // front-left-high, front-right, behind-left, behind-right-low, shared by all sparkles).
      const zones = [
        { x: -0.8, y: 0.45, z: -0.55 },
        { x: 0.85, y: 0.1, z: -0.5 },
        { x: -0.7, y: 0.2, z: 0.75 },
        { x: 0.75, y: -0.2, z: 0.7 },
      ].map((o) => {
        const g = v.gain(1);
        g.connect(v.panner3d({ x: l.x + o.x, y: l.y + o.y, z: l.z + o.z }, 0.6)).connect(v.wide);
        v.send(g, 0.6, 0.15);
        return g;
      });
      const count = Math.round(10 + 6 * S);
      for (let i = 0; i < count; i++) {
        const tt = t + 0.6 + 6.5 * Math.pow(r(), 1.6);
        ping(v, anyOf(r, zones), tt, mtof(pent(Math.floor(rr(r, 10, 19))) + oct), rr(r, 0.045, 0.085), rr(r, 1.2, 2.6));
      }
      // Stellar wind: the long airy tail.
      const wind = v.noise(v.bank.whiteSt, t, t + L + 0.05);
      const whp = v.bq('bandpass', 4200, 0.6);
      v.mod(t, t + L, 0.5, 1500).connect(whp.frequency);
      const wg = v.gain(0);
      wind.connect(whp).connect(wg).connect(v.wide);
      pad(wg.gain, t + 0.3, 2, t + 2.5, L - 2.6, 0.035);
      v.send(wg, 0.8);
    },
  },

  'gather-tick': {
    priority: 0,
    level: 4.5,
    build({ v, t, pitch: P, r }) {
      const m = pent(Math.floor(rr(r, 10, 17)));
      ping(v, v.out, t, mtof(m) * P, rr(r, 0.035, 0.06), rr(r, 0.06, 0.13));
    },
  },

  'pulsar-tick': {
    priority: 1,
    level: 9,
    build({ v, t, size: S }) {
      pulsarEvent(v, v.out, t, 0.6 + S, 0, 1);
      v.send(v.out, 0.25, 0.1);
    },
  },

  'planet-form': {
    priority: 2,
    level: 1.25,
    build({ v, t, size: S, pitch: P, r }) {
      const k = 1 + S;
      thump(v, v.out, t, 90 * P, 38 * P, 0.25, 0.75 * k, 0.6, 0.35);
      burst(v, v.out, t, { buf: v.bank.pink, type: 'lowpass', f0: 600, q: 0.8, attack: 0.002, decay: 0.3, gain: 0.3 });
      // Molten rumble, roiling.
      const n = v.noise(v.bank.brown, t, t + 2.8 * k);
      const lp = v.bq('lowpass', 260, 0.9);
      v.mod(t, t + 2.8 * k, 1.8, 120).connect(lp.frequency);
      const g = v.gain(0);
      perc(g.gain, t, 0.08, 2.4 * k, 0.5);
      n.connect(lp).connect(g).connect(v.out);
      // Lava crackle.
      const c = v.noise(v.bank.crackle, t, t + 2 * k, 0.7);
      const cb = v.bq('bandpass', 1100, 0.8);
      const cg = v.gain(0);
      perc(cg.gain, t, 0.05, 1.7 * k, 0.16);
      c.connect(cb).connect(cg).connect(v.out);
      // Bubbles.
      const bubbles = 4 + Math.floor(r() * 3);
      for (let i = 0; i < bubbles; i++) {
        const tt = t + rr(r, 0.12, 1.4 * k);
        const f0 = rr(r, 110, 180) * P;
        chirp(v, v.out, tt, f0, f0 * 2.2, rr(r, 0.05, 0.09), rr(r, 0.07, 0.12));
      }
      // A warm fifth: the world's first note.
      const hum = group(v, 0, 0.5);
      chordSwell(v, hum, t + 0.05, [38, 45].map((m) => m + octaves(P)), { wave: v.bank.waves.warm, attack: 0.35, hold: 0.4, release: 2.4 * k, gain: 0.08, cutoff: 420, spread: 0.3 });
      v.send(v.out, 0.3);
    },
  },

  throw: {
    priority: 1,
    level: 5.3,
    build({ v, t, size: S, pitch: P }) {
      const k = (1 - 0.4 * S) * P;
      const d = 0.55 + 0.35 * S;
      const n = v.noise(v.bank.pink, t, t + d + 0.1);
      const bp = v.bq('bandpass', 500, 1.2);
      bp.frequency.setValueAtTime(500 * k, t);
      bp.frequency.exponentialRampToValueAtTime(2300 * k, t + d * 0.32);
      bp.frequency.exponentialRampToValueAtTime(700 * k, t + d);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.55, t + d * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0005, t + d);
      g.gain.setValueAtTime(0, t + d + 0.01);
      n.connect(bp).connect(g).connect(v.out);
      const w = v.osc('sine', 900 * k, t, t + d + 0.05);
      w.frequency.setValueAtTime(900 * k, t);
      w.frequency.exponentialRampToValueAtTime(1500 * k, t + d * 0.3);
      w.frequency.exponentialRampToValueAtTime(1000 * k, t + d);
      const wg = v.gain(0);
      w.connect(wg).connect(v.out);
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(0.025, t + d * 0.3);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + d);
      v.send(v.out, 0.2);
    },
  },

  'orbit-settle': {
    priority: 1,
    level: 1.6,
    build({ v, t, pitch: P }) {
      const oct = octaves(P);
      [69, 76, 81].forEach((m, i) => glass(v, v.out, t + i * 0.11, mtof(m + oct), 0.07, 2.6 - i * 0.3, 0.35));
      v.send(v.out, 0.55, 0.35);
    },
  },

  'ocean-form': {
    priority: 2,
    level: 0.85,
    build({ v, t, size: S, pitch: P, r }) {
      const k = 1 + 0.5 * S;
      const oct = octaves(P);
      // Water: wide noise through a rising, burbling band-pass.
      const n = v.noise(v.bank.pinkSt, t, t + 5 * k);
      const bp = v.bq('bandpass', 400, 0.9);
      bp.frequency.setValueAtTime(380, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 3 * k);
      v.mod(t, t + 5 * k, 7, 180).connect(bp.frequency);
      const g = v.gain(0);
      n.connect(bp).connect(g).connect(v.wide);
      pad(g.gain, t, 2 * k, t + 2.2 * k, 2.5 * k, 0.3);
      v.send(g, 0.5);
      // Droplets, denser and higher as the ocean fills.
      const drops = Math.round(20 + 8 * S);
      const dropGroups = groups(v, SPREAD3, 0.4, 0.1);
      for (let i = 0; i < drops; i++) {
        const x = Math.pow(i / drops, 0.7);
        const tt = t + 0.25 + x * 3 * k + rr(r, -0.05, 0.05);
        const f0 = rr(r, 600, 1100) * (1 + x);
        chirp(v, anyOf(r, dropGroups), tt, f0, f0 * rr(r, 1.8, 2.6), rr(r, 0.02, 0.04), rr(r, 0.035, 0.07));
      }
      // A rising pentatonic shimmer.
      const shimmer = groups(v, [-0.6, 0.6], 0.7, 0.3);
      for (let i = 0; i < 8; i++) {
        const tt = t + 0.4 + 2.6 * k * Math.pow(i / 8, 0.8);
        glass(v, shimmer[i % 2], tt, mtof(pent(5 + i) + oct), 0.03, 2.2, 0.5);
      }
      // E/D: the Lydian chord of open water.
      const pg = group(v, 0, 0.8);
      chordSwell(v, pg, t + 0.3, [50, 64, 68, 71].map((m) => m + oct), { wave: v.bank.waves.glass, attack: 1.6 * k, hold: 0.8, release: 3 * k, gain: 0.03, cutoff: 3000, spread: 0.7 });
    },
  },

  'life-bloom': {
    priority: 2,
    level: 0.8,
    build({ v, t, size: S, pitch: P, r }) {
      const oct = octaves(P);
      const k = 1 + 0.5 * S;
      const pg = group(v, 0, 0.7, 0.05);
      chordSwell(v, pg, t, [50, 57, 61, 64, 66, 69].map((m) => m + oct), { wave: v.bank.waves.warm, attack: 0.9 * k, hold: 1.4 * k, release: 3.6 * k, gain: 0.034, cutoff: 2200, spread: 0.8, stagger: 0.05 });
      const sub = v.osc('sine', mtof(38 + oct), t, t + 6.5 * k);
      const sg = v.gain(0);
      sub.connect(sg).connect(v.wide);
      pad(sg.gain, t, 1 * k, t + 2.2 * k, 3.6 * k, 0.07);
      // Birdsong: short trilled phrases from the world.
      const phrases = 3 + Math.floor(r() * 3);
      for (let p = 0; p < phrases; p++) {
        let tt = t + rr(r, 0.3, 3.4 * k);
        const base = rr(r, 2300, 4200);
        const chirps = 3 + Math.floor(r() * 5);
        const dir = r() < 0.5 ? -1 : 1;
        for (let c = 0; c < chirps; c++) {
          const f0 = base * (1 + 0.06 * c * dir) * rr(r, 0.95, 1.05);
          const d = rr(r, 0.04, 0.09);
          chirp(v, v.out, tt, f0, f0 * rr(r, 1.25, 1.6), d, rr(r, 0.04, 0.07), r() < 0.4 ? 0.04 : 0, rr(r, 24, 40));
          tt += d + rr(r, 0.03, 0.09);
        }
      }
      const sparkle = groups(v, [-0.75, 0.75], 0.7, 0.3);
      for (let i = 0; i < 5; i++) {
        glass(v, sparkle[i % 2], t + rr(r, 0.2, 2.5), mtof(pent(Math.floor(rr(r, 10, 17))) + oct), 0.025, 1.8, 0.6);
      }
      v.send(v.out, 0.3, 0.1);
    },
  },

  chime: {
    priority: 1,
    level: 2,
    build({ v, t, pitch: P }) {
      const f = 880 * P;
      glass(v, v.out, t, f, 0.1, 2.2, 0.5);
      glass(v, v.out, t + 0.004, f * 2, 0.025, 1.2, 0.2);
      v.send(v.out, 0.5, 0.25);
    },
  },

  'ember-speak': {
    priority: 0,
    level: 3.4,
    build({ v, t, pitch: P, r }) {
      const n = v.noise(v.bank.white, t, t + 1.1);
      const bp = v.bq('bandpass', 5200, 0.7);
      const ng = v.gain(0);
      n.connect(bp).connect(ng).connect(v.out);
      pad(ng.gain, t, 0.25, t + 0.3, 0.7, 0.05);
      const hum = v.osc('sine', 880 * P, t, t + 1.1);
      v.lfo(t, t + 1.1, 5.5, 6).connect(hum.detune);
      const hg = v.gain(0);
      hum.connect(hg).connect(v.out);
      pad(hg.gain, t, 0.3, t + 0.35, 0.6, 0.012);
      const count = 3 + Math.floor(r() * 3);
      for (let i = 0; i < count; i++) {
        ping(v, v.out, t + rr(r, 0, 0.6), mtof(pent(Math.floor(rr(r, 10, 18)))) * P, rr(r, 0.018, 0.03), rr(r, 0.25, 0.6));
      }
      v.send(v.out, 0.45, 0.3);
    },
  },

  'burn-away': {
    priority: 2,
    level: 0.95,
    build({ v, t, size: S, r }) {
      const k = 1 + 0.3 * S;
      // Fire: crackle and roar swelling around you.
      const c = v.noise(v.bank.crackle, t, t + 6.5 * k, 0.9);
      const chp = v.bq('highpass', 900, 0.7);
      const cg = v.gain(0);
      c.connect(chp).connect(cg).connect(v.wide);
      pad(cg.gain, t, 2.5 * k, t + 3 * k, 3.2 * k, 0.34);
      const roar = v.noise(v.bank.brownSt, t, t + 6.5 * k);
      const rlp = v.bq('lowpass', 700, 0.8);
      v.mod(t, t + 6.5 * k, 2.2, 300).connect(rlp.frequency);
      const rg = v.gain(0);
      roar.connect(rlp).connect(rg).connect(v.wide);
      pad(rg.gain, t, 2.8 * k, t + 3.1 * k, 3 * k, 0.42);
      const mid = v.noise(v.bank.pinkSt, t, t + 6.5 * k);
      const mbp = v.bq('bandpass', 1400, 0.6);
      const mg = v.gain(0);
      mid.connect(mbp).connect(mg).connect(v.wide);
      pad(mg.gain, t, 2.8 * k, t + 3 * k, 3 * k, 0.12);
      v.send(rg, 0.3);
      // A whoosh rising into the transformation.
      const w = v.noise(v.bank.pinkSt, t, t + 4 * k);
      const wb = v.bq('bandpass', 300, 1.1);
      wb.frequency.setValueAtTime(300, t);
      wb.frequency.exponentialRampToValueAtTime(4200, t + 3 * k);
      const wg = v.gain(0);
      w.connect(wb).connect(wg).connect(v.wide);
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(0.2, t + 3 * k);
      wg.gain.linearRampToValueAtTime(0, t + 3.6 * k);
      v.send(wg, 0.5);
      // …into a vast airy pad: Dmaj9 over A in the high register, choir "ooh" under it. (No G#:
      // this rings on into the dawn, whose G chord would clash with it.)
      const pt = t + 2.4 * k;
      const pg = group(v, 0, 0.95, 0.1);
      chordSwell(v, pg, pt, [57, 64, 69, 73, 78, 81], { wave: v.bank.waves.glass, attack: 3, hold: 2, release: 5.5, gain: 0.028, cutoff: 4200, spread: 0.9, stagger: 0.15 });
      choir(v, pg, pt + 0.4, [50, 57, 64, 66], { attack: 3, hold: 1.6, release: 5, gain: 0.026, vowel: 'u', spread: 0.6 });
      const air = v.noise(v.bank.whiteSt, pt, pt + 11);
      const ab = v.bq('bandpass', 7000, 0.5);
      const ag = v.gain(0);
      air.connect(ab).connect(ag).connect(pg);
      pad(ag.gain, pt, 3, pt + 4.5, 5.5, 0.045);
      const sub = v.osc('sine', mtof(26), t + 1.8 * k, pt + 7);
      const sg = v.gain(0);
      sub.connect(sg).connect(v.wide);
      pad(sg.gain, t + 1.8 * k, 1.5, pt + 1.5, 4, 0.1);
      void r;
    },
  },

  return: {
    priority: 2,
    level: 1.4,
    build({ v, t, pitch: P, r }) {
      const D = 1.7;
      const oct = octaves(P);
      // Reverse shimmer: a bell cluster swelling backwards, then landing softly.
      const sides = groups(v, [-0.65, 0.65], 0.6, 0.1);
      for (const m of [74, 78, 81, 86, 90, 93]) {
        const f = mtof(m + oct);
        const o = v.osc('sine', f, t, t + D + 0.3);
        const o2 = v.osc('sine', f * 2.756, t, t + D + 0.3);
        const g = v.gain(0);
        const g2 = v.gain(0);
        const pg = anyOf(r, sides);
        o.connect(g).connect(pg);
        o2.connect(g2).connect(pg);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.035, t + D);
        g.gain.linearRampToValueAtTime(0, t + D + 0.25);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.012, t + D);
        g2.gain.linearRampToValueAtTime(0, t + D + 0.12);
      }
      const n = v.noise(v.bank.whiteSt, t, t + D + 0.1);
      const hp = v.bq('highpass', 6000, 0.7);
      hp.frequency.setValueAtTime(7000, t);
      hp.frequency.exponentialRampToValueAtTime(1800, t + D);
      const ng = v.gain(0);
      n.connect(hp).connect(ng).connect(v.wide);
      rise(ng.gain, t, D, 0.08, 0.08);
      const land = group(v, 0, 0.6, 0.3);
      glass(v, land, t + D, mtof(69 + oct), 0.07, 2.6, 0.4);
      glass(v, land, t + D + 0.008, mtof(74 + oct), 0.05, 2.2, 0.3);
    },
  },

  impact: {
    priority: 1,
    level: 1.9,
    build({ v, t, size: S, pitch: P, r }) {
      const k = (1 - 0.35 * S) * P;
      thump(v, v.out, t, 125 * k, 50 * k, 0.08, 0.28 + 0.35 * S, 0.6, 0.3);
      const c = v.noise(v.bank.crackle, t, t + 0.4, 2.6);
      const cb = v.bq('bandpass', 1800 * k, 0.9);
      const cg = v.gain(0);
      c.connect(cb).connect(cg).connect(v.out);
      perc(cg.gain, t, 0.001, 0.2 + 0.15 * S, 0.5);
      burst(v, v.out, t, { buf: v.bank.pink, type: 'bandpass', f0: 750 * k, q: 0.9, attack: 0.001, decay: 0.14 + 0.1 * S, gain: 0.4 });
      const debris = 6 + Math.floor(r() * 5);
      for (let i = 0; i < debris; i++) {
        const tt = t + 0.02 + Math.pow(r(), 1.5) * (0.35 + 0.3 * S);
        burst(v, v.out, tt, { buf: v.bank.white, type: 'bandpass', f0: rr(r, 1800, 5200), q: 2, attack: 0.0005, decay: rr(r, 0.004, 0.012), gain: rr(r, 0.08, 0.22) * (1 - (tt - t)) });
      }
      v.send(v.out, 0.2);
    },
  },

  'ring-shatter': {
    priority: 2,
    level: 1.6,
    build({ v, t, r }) {
      burst(v, v.out, t, { buf: v.bank.white, type: 'highpass', f0: 2500, q: 0.6, attack: 0.0005, decay: 0.09, gain: 0.32 });
      const shards = 24;
      const spread = groups(v, [-0.85, -0.3, 0.3, 0.85], 0.4, 0.15);
      for (let i = 0; i < shards; i++) {
        const tt = t + Math.pow(r(), 2.2) * 1.4;
        const f = r() < 0.5 ? rr(r, 2000, 8500) : mtof(pent(Math.floor(rr(r, 15, 22))));
        ping(v, anyOf(r, spread), tt, f, rr(r, 0.028, 0.075) * (1 - 0.5 * (tt - t)), rr(r, 0.08, 0.5));
      }
      const n = v.noise(v.bank.whiteSt, t, t + 2.2);
      const hp = v.bq('highpass', 5000, 0.7);
      const ng = v.gain(0);
      n.connect(hp).connect(ng).connect(v.wide);
      perc(ng.gain, t, 0.005, 2, 0.08);
      v.send(ng, 0.7);
      const rg = group(v, 0, 0.9, 0.1);
      chordSwell(v, rg, t + 0.3, [88, 95, 102], { wave: v.bank.waves.glass, attack: 0.8, hold: 0.6, release: 2.2, gain: 0.016, cutoff: 9000, spread: 0.9 });
    },
  },

  discovery: {
    priority: 2,
    level: 1.05,
    build({ v, t, pitch: P, r }) {
      const oct = octaves(P);
      const g = group(v, 0, 0.6, 0.3);
      [69, 74, 78].forEach((m, i) => {
        felt(v, g, t + i * 0.11, mtof(m + oct), 0.1, 2.4, 0.6);
        glass(v, g, t + i * 0.11, mtof(m + 12 + oct), 0.025, 1.6, 0.4);
      });
      glass(v, g, t + 0.36, mtof(93 + oct), 0.03, 2.2, 0.7);
      glass(v, g, t + 0.37, mtof(97 + oct), 0.022, 2, 0.7);
      const n = v.noise(v.bank.whiteSt, t + 0.2, t + 1.8);
      const hp = v.bq('highpass', 7000, 0.7);
      const ng = v.gain(0);
      n.connect(hp).connect(ng).connect(v.wide);
      pad(ng.gain, t + 0.2, 0.3, t + 0.5, 1.1, 0.04);
      v.send(ng, 0.6);
      void r;
    },
  },

  'gas-giant': {
    priority: 2,
    level: 1.2,
    build({ v, t, size: S, pitch: P }) {
      const k = 1 + 0.6 * S;
      const oct = octaves(P);
      thump(v, v.out, t, 75 * P, 44 * P, 0.4, 1.4 * k, 0.45, 0.3);
      const n = v.noise(v.bank.pinkSt, t, t + 4 * k);
      const bp = v.bq('bandpass', 300, 1.5);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(900, t + 0.8);
      bp.frequency.exponentialRampToValueAtTime(380, t + 3.5 * k);
      v.lfo(t, t + 4 * k, 0.7, 120).connect(bp.frequency);
      const g = v.gain(0);
      n.connect(bp).connect(g).connect(v.wide);
      pad(g.gain, t, 0.6, t + 0.9, 2.8 * k, 0.32);
      v.send(g, 0.4);
      // Bm7: the melancholy of a star that never lit.
      const cg = group(v, 0, 0.7);
      chordSwell(v, cg, t + 0.1, [47, 54, 57, 62].map((m) => m + oct), { wave: v.bank.waves.warm, attack: 0.8, hold: 0.8, release: 3.4 * k, gain: 0.04, cutoff: 900, spread: 0.6 });
    },
  },

  poke: {
    priority: 1,
    level: 6,
    build({ v, t, pitch: P }) {
      burst(v, v.out, t, { buf: v.bank.pink, type: 'bandpass', f0: 1500 * P, q: 0.9, attack: 0.01, decay: 0.25, gain: 0.32 });
      burst(v, v.out, t, { buf: v.bank.white, type: 'highpass', f0: 4000, q: 0.7, attack: 0.005, decay: 0.15, gain: 0.12 });
      burst(v, v.out, t, { buf: v.bank.crackle, type: 'highpass', f0: 2000, rate: 1.5, attack: 0.01, decay: 0.3, gain: 0.2 });
      thump(v, v.out, t, 190 * P, 120 * P, 0.15, 0.22, 0.14);
      v.send(v.out, 0.2);
    },
  },

  'menu-open': {
    priority: 0,
    level: 6.3,
    build({ v, t }) {
      ping(v, v.out, t, 880, 0.05, 0.22);
      ping(v, v.out, t + 0.07, 1318.5, 0.045, 0.26);
      burst(v, v.out, t, { buf: v.bank.white, type: 'highpass', f0: 6000, attack: 0.0005, decay: 0.006, gain: 0.05 });
      v.send(v.out, 0.3, 0.15);
    },
  },

  'menu-close': {
    priority: 0,
    level: 6.3,
    build({ v, t }) {
      ping(v, v.out, t, 1318.5, 0.045, 0.2);
      ping(v, v.out, t + 0.07, 880, 0.045, 0.24);
      burst(v, v.out, t, { buf: v.bank.white, type: 'highpass', f0: 6000, attack: 0.0005, decay: 0.006, gain: 0.05 });
      v.send(v.out, 0.3, 0.1);
    },
  },

  'well-open': {
    priority: 2,
    level: 0.82,
    build({ v, t, size: S, r }) {
      const k = 1 + 0.4 * S;
      // A deep gong-like opening.
      bell(v, v.out, t, mtof(38), 0.14, 5 * k, 1.4, 2.2);
      const sub = v.osc('sine', mtof(26), t, t + 6 * k);
      const sg = v.gain(0);
      sub.connect(sg).connect(v.wide);
      pad(sg.gain, t, 1.5, t + 2, 3.5 * k, 0.11);
      const pre = v.gain(2);
      const sh = v.shaper(v.bank.drive);
      const hp = v.bq('highpass', 70, 0.7);
      const shg = v.gain(0.12);
      sg.connect(pre).connect(sh).connect(hp).connect(shg).connect(v.wide);
      // A resonant drone opening up.
      const dr = v.gain(1);
      const res = v.bq('bandpass', 200, 4);
      res.frequency.setValueAtTime(200, t);
      res.frequency.exponentialRampToValueAtTime(900, t + 3 * k);
      res.frequency.exponentialRampToValueAtTime(400, t + 5.5 * k);
      const rg = v.gain(0);
      dr.connect(res).connect(rg).connect(v.wide);
      pad(rg.gain, t, 1.2, t + 3 * k, 2.6 * k, 0.32);
      v.send(rg, 0.6);
      for (const [m, d] of [[38, -8], [45, 7], [50, 4]] as const) {
        const o = v.osc(v.bank.waves.warm, mtof(m), t, t + 6 * k, d);
        o.connect(dr);
      }
      // Rising air out of the hole in the table.
      const air = v.noise(v.bank.pinkSt, t, t + 6 * k);
      const ab = v.bq('bandpass', 250, 0.8);
      ab.frequency.setValueAtTime(250, t);
      ab.frequency.exponentialRampToValueAtTime(3500, t + 4 * k);
      const ag = v.gain(0);
      air.connect(ab).connect(ag).connect(v.wide);
      pad(ag.gain, t, 3.5 * k, t + 3.7 * k, 2 * k, 0.26);
      v.send(ag, 0.5);
      // Stars glinting in the depths.
      const stars = groups(v, [-0.6, 0.6], 0.8, 0.3);
      [86, 93, 100].forEach((m, i) => {
        glass(v, stars[i % 2], t + (2.4 + i * 0.45) * k, mtof(m), 0.03, 2.5, 0.6);
      });
      v.send(v.out, 0.5);
    },
  },
};

