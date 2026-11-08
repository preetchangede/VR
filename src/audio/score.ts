/**
 * The generative score. Each mood is a MoodPlayer: a chord progression plus layers (pads,
 * drones, choir, arpeggios, felt-piano melody, glass shimmer, pulses, noise beds, blooms).
 * Layers schedule ahead with a lookahead horizon, so the same code runs live and offline.
 * Players crossfade; a retired player is disposed once silent.
 */
import { chordSwell, choir, felt, glass, pluck, thump, type Vowel } from './instruments';
import type { Waves } from './dsp';
import { type Chord, chord, mtof, nearestPent, note, pent } from './theory';
import type { Mood } from './types';
import { clamp, db, glide, hold, pad, perc, type Rand, rr, swell } from './util';
import { type Host, type Sends, Voice } from './voice';

type WaveName = keyof Waves | 'sine' | 'triangle';

interface Common {
  /** Layer level (linear). */
  level?: number;
  rev?: number;
  echo?: number;
  /** Mood-time (seconds, before pace scaling) at which the layer enters. */
  from?: number;
}

interface PadSpec extends Common {
  kind: 'pad';
  pick?: 'notes' | 'bass' | 'top' | 'all';
  wave?: WaveName;
  oscs?: 1 | 2;
  detune?: number;
  transpose?: number;
  gain: number;
  xfade?: number;
  cutoff: number;
  q?: number;
  /** Filter LFO [rate Hz, depth Hz]. */
  lfo?: [number, number];
  /** Cutoff multiplier per unit of intensity. */
  bright?: number;
  /** Filter follows the macro swell. */
  macroBright?: boolean;
  vibrato?: [number, number];
  spread?: number;
  /** Amplitude LFO [rate Hz, depth 0..1] (slow swells or tremolo). */
  amp?: [number, number];
  formant?: Vowel;
}

interface ArpSpec extends Common {
  kind: 'arp';
  bpm: number;
  div: number;
  pattern: 'up' | 'down' | 'updown' | 'random' | 'walk';
  source: 'chord' | 'penta';
  octave?: number;
  range?: [number, number];
  timbre: 'pluck' | 'glass' | 'felt';
  gain: number;
  decay: number;
  prob?: number;
  accent?: number;
  cutoff?: number;
  spread?: number;
}

interface MelodySpec extends Common {
  kind: 'melody';
  timbre: 'felt' | 'glass';
  range: [number, number];
  gain: number;
  decay: number;
  gap: [number, number];
  beat: number;
}

interface ShimmerSpec extends Common {
  kind: 'shimmer';
  gap: [number, number];
  source: 'penta' | 'top';
  range: [number, number];
  gain: number;
  decay: [number, number];
  bright?: number;
}

interface NoiseSpec extends Common {
  kind: 'noise';
  buf: 'pinkSt' | 'brownSt' | 'whiteSt';
  type: BiquadFilterType;
  f: number;
  q: number;
  gain: number;
  mod?: [number, number];
  amp?: [number, number];
}

interface PulseSpec extends Common {
  kind: 'pulse';
  bpm: number;
  accents: number[];
  gain: number;
  decay: number;
}

interface BloomSpec extends Common {
  kind: 'bloom';
  at: number;
  notes: string;
  top?: string;
  attack: number;
  hold: number;
  release: number;
  gain: number;
}

type LayerSpec = PadSpec | ArpSpec | MelodySpec | ShimmerSpec | NoiseSpec | PulseSpec | BloomSpec;

interface MoodDef {
  /** Output level in dB. */
  level: number;
  fadeIn?: number;
  chords: [string, string, string?][];
  durs: number[];
  loopFrom?: number;
  /** Macro dynamics [mood-time, gain] (dawn's long swell). */
  macro?: [number, number][];
  layers: LayerSpec[];
}

interface Seg {
  k: number;
  chord: Chord;
  start: number;
  dur: number;
}

class Progression {
  readonly chords: Chord[];
  readonly durs: number[];
  readonly loopFrom: number;
  private readonly cum: number[] = [];
  private readonly total: number;
  private readonly loopLen: number;

  constructor(chords: Chord[], durs: number[], loopFrom = 0) {
    this.chords = chords;
    this.durs = durs;
    this.loopFrom = Math.min(loopFrom, chords.length - 1);
    let acc = 0;
    for (const d of durs) {
      this.cum.push(acc);
      acc += d;
    }
    this.total = acc;
    this.loopLen = acc - this.cum[this.loopFrom];
  }

  seg(k: number): Seg {
    const n = this.chords.length;
    if (k < n) return { k, chord: this.chords[k], start: this.cum[k], dur: this.durs[k] };
    const m = n - this.loopFrom;
    const j = (k - n) % m;
    const cycles = Math.floor((k - n) / m);
    const i = this.loopFrom + j;
    return { k, chord: this.chords[i], start: this.total + cycles * this.loopLen + this.cum[i] - this.cum[this.loopFrom], dur: this.durs[i] };
  }

  at(e: number): Seg {
    if (e < this.total) {
      for (let i = this.chords.length - 1; i >= 0; i--) if (e >= this.cum[i]) return this.seg(i);
      return this.seg(0);
    }
    const m = this.chords.length - this.loopFrom;
    const cycles = Math.floor((e - this.total) / this.loopLen);
    const rem = e - this.total - cycles * this.loopLen + this.cum[this.loopFrom];
    for (let i = this.chords.length - 1; i >= this.loopFrom; i--) {
      if (rem >= this.cum[i]) return this.seg(this.chords.length + cycles * m + (i - this.loopFrom));
    }
    return this.seg(this.chords.length + cycles * m);
  }
}

const uniq = (a: number[]) => [...new Set(a)].sort((x, y) => x - y);

function pentRange(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = -20; n < 40; n++) {
    const m = pent(n);
    if (m >= lo && m <= hi) out.push(m);
  }
  return out;
}

/** Chord tones (pad voicing + colour) folded into [lo, hi]. */
function chordTonesIn(c: Chord, lo: number, hi: number): number[] {
  const pcs = new Set([...c.notes, ...c.top, ...c.bass].map((m) => ((m % 12) + 12) % 12));
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

abstract class Layer {
  readonly sends: Sends;
  protected readonly input: GainNode;
  protected readonly lvl: GainNode;
  protected readonly from: number;

  constructor(protected readonly p: MoodPlayer, spec: Common) {
    const v = p.persist;
    this.input = v.gain(1);
    this.lvl = v.gain(spec.level ?? 1);
    this.lvl.connect(p.dryIn);
    if (spec.rev) this.lvl.connect(v.gain(spec.rev)).connect(p.revIn);
    if (spec.echo) this.lvl.connect(v.gain(spec.echo)).connect(p.echoIn);
    this.sends = { dry: this.input, rev: p.revIn, echo: p.echoIn };
    this.from = p.real(spec.from ?? 0);
  }

  abstract schedule(now: number, horizon: number): void;
  intensity(_x: number, _t: number): void {}

  private readonly mine: Voice[] = [];

  protected voice(t: number, tag: string): Voice {
    const v = new Voice(this.p.host, t, this.sends, 1, null, 0, tag);
    this.p.track(v);
    this.mine.push(v);
    return v;
  }

  /** Polyphony cap: true when `cap` of this layer's notes are still sounding at time t. */
  protected busy(t: number, cap: number): boolean {
    for (let i = this.mine.length - 1; i >= 0; i--) if (this.mine[i].end < t || this.mine[i].dead) this.mine.splice(i, 1);
    return this.mine.length >= cap;
  }
}

class PadLayer extends Layer {
  private readonly s: PadSpec;
  private readonly left: StereoPannerNode;
  private readonly right: StereoPannerNode;
  private readonly center: GainNode;
  private readonly filter: BiquadFilterNode | null;
  private readonly vib: GainNode | null;
  private k = 0;

  constructor(p: MoodPlayer, s: PadSpec) {
    super(p, s);
    this.s = s;
    const v = p.persist;
    const t = p.t0;
    const T = t + 1e7;
    const spread = s.spread ?? 0.6;
    this.left = v.pan(-spread);
    this.right = v.pan(spread);
    this.center = v.gain(1);
    this.left.connect(this.input);
    this.right.connect(this.input);
    this.center.connect(this.input);
    let tail: AudioNode;
    if (s.formant) {
      const bank = v.gain(1);
      const fm: Record<Vowel, number[]> = { a: [800, 1150, 2900], o: [450, 800, 2830], u: [325, 700, 2530], e: [400, 1600, 2700] };
      const fq = [7, 9, 11];
      const fg = [1.8, 1, 0.55];
      fm[s.formant].forEach((f, i) => {
        this.input.connect(v.bq('bandpass', f, fq[i])).connect(v.gain(fg[i])).connect(bank);
      });
      this.input.connect(v.bq('lowpass', 600, 0.7)).connect(v.gain(0.12)).connect(bank);
      this.filter = null;
      tail = bank;
    } else {
      this.filter = v.bq('lowpass', s.cutoff, s.q ?? 0.6);
      if (s.lfo) v.lfo(t, T, s.lfo[0], s.lfo[1]).connect(this.filter.frequency);
      this.input.connect(this.filter);
      tail = this.filter;
      if (s.macroBright && p.macroPts) {
        const fp = this.filter.frequency;
        fp.setValueAtTime(s.cutoff * (0.45 + 0.7 * p.macroPts[0][1]), t);
        for (const [mt, g] of p.macroPts) fp.linearRampToValueAtTime(s.cutoff * (0.45 + 0.7 * g), p.real(mt));
      }
    }
    if (s.amp) {
      const a = v.gain(1);
      v.lfo(t, T, s.amp[0], s.amp[1]).connect(a.gain);
      tail.connect(a);
      tail = a;
    }
    tail.connect(this.lvl);
    this.vib = s.vibrato ? v.lfo(t, T, s.vibrato[0], s.vibrato[1]) : null;
  }

  private pickNotes(c: Chord): number[] {
    const tr = this.s.transpose ?? 0;
    const pk = this.s.pick ?? 'notes';
    const n = pk === 'bass' ? c.bass : pk === 'top' ? c.top : pk === 'all' ? [...c.bass, ...c.notes, ...c.top] : c.notes;
    return n.map((m) => m + tr);
  }

  schedule(now: number, horizon: number) {
    const p = this.p;
    for (;;) {
      const seg = p.prog.seg(this.k);
      const start = p.real(seg.start);
      const dur = seg.dur / p.pace;
      const xf = Math.min(this.s.xfade ?? 4, dur * 0.7);
      const noteStart = Math.max(start - xf / 2, p.t0);
      if (noteStart >= horizon) return;
      this.k++;
      const end = start + dur;
      if (end <= now || end <= this.from || start < this.from - 0.01) continue;
      const t0 = Math.max(noteStart, now);
      const attack = Math.max(start + xf / 2 - t0, 0.05);
      this.notes(seg.chord, t0, attack, end - xf / 2, xf);
    }
  }

  private notes(c: Chord, t0: number, attack: number, holdUntil: number, release: number) {
    const s = this.s;
    const midi = this.pickNotes(c);
    if (!midi.length) return;
    const wave = s.wave ?? 'warm';
    const oscs = s.oscs ?? 2;
    const det = s.detune ?? 7;
    const v = this.voice(t0, 'pad');
    const r = this.p.r;
    const end = Math.max(holdUntil, t0 + attack) + release + 0.05;
    midi.forEach((m, i) => {
      const f = mtof(m);
      const gain = (s.gain * rr(r, 0.85, 1.1)) / Math.sqrt(1 + 0.12 * i);
      for (let o = 0; o < oscs; o++) {
        const side = oscs === 1 ? 0 : o === 0 ? -1 : 1;
        const type = wave === 'sine' || wave === 'triangle' ? wave : v.bank.waves[wave];
        const osc = v.osc(type, f, t0, end, side * det + rr(r, -1.5, 1.5));
        if (this.vib) this.vib.connect(osc.detune);
        const g = v.gain(0);
        osc.connect(g).connect(side < 0 ? this.left : side > 0 ? this.right : this.center);
        pad(g.gain, t0, attack, holdUntil, release, gain);
      }
    });
  }

  intensity(x: number, t: number) {
    if (!this.filter || !this.s.bright || this.s.macroBright) return;
    glide(this.filter.frequency, this.s.cutoff * (1 + this.s.bright * x), t, 0.6);
  }
}

class ArpLayer extends Layer {
  private readonly s: ArpSpec;
  private next: number;
  private step = 0;
  private idx = 0;
  private readonly lp: BiquadFilterNode;

  constructor(p: MoodPlayer, s: ArpSpec) {
    super(p, s);
    this.s = s;
    this.lp = p.persist.bq('lowpass', s.cutoff ?? 6000, 0.5);
    this.input.connect(this.lp).connect(this.lvl);
    this.next = Math.max(this.from, p.t0 + 0.05);
  }

  private pool(t: number): number[] {
    const s = this.s;
    const c = this.p.chordAt(t);
    if (s.source === 'penta') return pentRange(s.range?.[0] ?? 74, s.range?.[1] ?? 93);
    const oct = 12 * (s.octave ?? 1);
    const lo = s.range?.[0] ?? 57 + oct;
    const hi = s.range?.[1] ?? 76 + oct;
    const tones = chordTonesIn(c, lo, hi);
    return tones.length ? tones : uniq(c.notes.map((m) => m + oct));
  }

  schedule(now: number, horizon: number) {
    const s = this.s;
    const r = this.p.r;
    const stepDur = 60 / s.bpm / s.div;
    if (this.next < now - 0.05) this.next = now + 0.01;
    while (this.next < horizon) {
      const t = this.next;
      this.next += stepDur;
      const step = this.step++;
      if (r() > (s.prob ?? 1) || this.busy(t, 8)) continue;
      const pool = this.pool(t);
      const n = pool.length;
      if (!n) continue;
      let i: number;
      switch (s.pattern) {
        case 'up':
          i = step % n;
          break;
        case 'down':
          i = n - 1 - (step % n);
          break;
        case 'updown': {
          const per = Math.max(1, 2 * n - 2);
          const ph = step % per;
          i = ph < n ? ph : per - ph;
          break;
        }
        case 'walk':
          this.idx += r() < 0.5 ? -1 : 1;
          if (r() < 0.2) this.idx += r() < 0.5 ? -1 : 1;
          if (this.idx < 0) this.idx = 1;
          if (this.idx >= n) this.idx = n - 2;
          i = clamp(this.idx, 0, n - 1);
          break;
        default:
          i = Math.floor(r() * n);
      }
      const m = pool[clamp(i, 0, n - 1)];
      const beatPos = step % (s.div * 4);
      const accent = beatPos === 0 ? 1 + (s.accent ?? 0.3) : beatPos % s.div === 0 ? 1 : 0.8;
      const gain = s.gain * accent * rr(r, 0.85, 1.05);
      const tt = t + rr(r, 0, 0.008);
      const v = this.voice(tt, 'arp');
      const pn = v.pan(rr(r, -(s.spread ?? 0.4), s.spread ?? 0.4));
      pn.connect(v.out);
      const f = mtof(m);
      if (s.timbre === 'pluck') pluck(v, pn, tt, f, gain, s.decay, s.cutoff ?? 2400);
      else if (s.timbre === 'felt') felt(v, pn, tt, f, gain, s.decay, 0.45);
      else glass(v, pn, tt, f, gain, s.decay, 0.5);
    }
  }
}

class MelodyLayer extends Layer {
  private readonly s: MelodySpec;
  private next: number;
  private last: number;

  constructor(p: MoodPlayer, s: MelodySpec) {
    super(p, s);
    this.s = s;
    this.input.connect(this.lvl);
    this.next = Math.max(this.from, p.t0 + rr(p.r, 0.5, 2));
    this.last = Math.round((s.range[0] + s.range[1]) / 2);
  }

  schedule(now: number, horizon: number) {
    const s = this.s;
    const r = this.p.r;
    if (this.next < now - 0.1) this.next = now + 0.05;
    if (this.next >= horizon) return;
    // Write a whole phrase: 3–6 notes, an arch, landing on a chord tone.
    const pool = pentRange(s.range[0], s.range[1]);
    let i = pool.indexOf(nearestPent(this.last));
    if (i < 0) i = Math.floor(pool.length / 2);
    const len = 3 + Math.floor(r() * 4);
    const up = r() < 0.55 ? 1 : -1;
    let t = this.next;
    for (let n = 0; n < len; n++) {
      const dir = n < len / 2 ? up : -up;
      i = clamp(i + dir * (r() < 0.7 ? 1 : 2) * (r() < 0.15 ? -1 : 1), 0, pool.length - 1);
      let m = pool[i];
      if (n === len - 1) {
        const tones = chordTonesIn(this.p.chordAt(t), s.range[0], s.range[1]);
        if (tones.length) m = tones.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), tones[0]);
      }
      const vel = s.gain * (0.75 + 0.35 * Math.sin((Math.PI * (n + 0.5)) / len)) * rr(r, 0.9, 1.05);
      if (this.busy(t, 8)) {
        t += s.beat;
        continue;
      }
      const v = this.voice(t, 'mel');
      const pn = v.pan(rr(r, -0.25, 0.25));
      pn.connect(v.out);
      if (s.timbre === 'felt') felt(v, pn, t, mtof(m), vel, s.decay * (n === len - 1 ? 1.4 : 1), 0.4);
      else glass(v, pn, t, mtof(m), vel, s.decay, 0.4);
      this.last = m;
      const beats = n === len - 2 ? 2 : r() < 0.6 ? 1 : r() < 0.5 ? 2 : 1.5;
      t += beats * s.beat * rr(r, 0.97, 1.03);
    }
    this.next = t + rr(r, s.gap[0], s.gap[1]);
  }
}

class ShimmerLayer extends Layer {
  private readonly s: ShimmerSpec;
  private next: number;

  constructor(p: MoodPlayer, s: ShimmerSpec) {
    super(p, s);
    this.s = s;
    this.input.connect(this.lvl);
    this.next = Math.max(this.from, p.t0 + rr(p.r, 0.5, s.gap[0]));
  }

  schedule(now: number, horizon: number) {
    const s = this.s;
    const r = this.p.r;
    if (this.next < now - 0.1) this.next = now + 0.05;
    while (this.next < horizon) {
      const t = this.next;
      this.next += rr(r, s.gap[0], s.gap[1]);
      if (this.busy(t, 6)) continue;
      const pool = s.source === 'top' ? chordTonesIn(this.p.chordAt(t), s.range[0], s.range[1]) : pentRange(s.range[0], s.range[1]);
      if (!pool.length) continue;
      const m = pool[Math.floor(r() * pool.length)];
      const v = this.voice(t, 'shimmer');
      const pn = v.pan(rr(r, -0.85, 0.85));
      pn.connect(v.out);
      glass(v, pn, t, mtof(m), s.gain * rr(r, 0.7, 1.1), rr(r, s.decay[0], s.decay[1]), s.bright ?? 0.6);
      if (r() < 0.35) glass(v, pn, t + rr(r, 0.12, 0.3), mtof(m + (r() < 0.5 ? 7 : 12)), s.gain * 0.5, rr(r, s.decay[0], s.decay[1]) * 0.7, 0.5);
    }
  }
}

class NoiseLayer extends Layer {
  constructor(p: MoodPlayer, s: NoiseSpec) {
    super(p, s);
    const v = p.persist;
    const t = Math.max(this.from, p.t0);
    const T = t + 1e7;
    const n = v.noise(v.bank[s.buf], t, T);
    const f = v.bq(s.type, s.f, s.q);
    if (s.mod) v.mod(t, T, s.mod[0], s.mod[1]).connect(f.frequency);
    const a = v.gain(1);
    if (s.amp) v.mod(t, T, s.amp[0], s.amp[1]).connect(a.gain);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    swell(g.gain, t, 3, 0, s.gain);
    n.connect(f).connect(a).connect(g).connect(this.input);
    this.input.connect(this.lvl);
  }

  schedule() {}
}

class PulseLayer extends Layer {
  private readonly s: PulseSpec;
  private next: number;
  private step = 0;

  constructor(p: MoodPlayer, s: PulseSpec) {
    super(p, s);
    this.s = s;
    const lp = p.persist.bq('lowpass', 420, 0.7);
    this.input.connect(lp).connect(this.lvl);
    this.next = Math.max(this.from, p.t0 + 0.1);
  }

  schedule(now: number, horizon: number) {
    const s = this.s;
    const beat = 60 / s.bpm;
    if (this.next < now - 0.05) this.next = now + 0.01;
    while (this.next < horizon) {
      const t = this.next;
      this.next += beat;
      const a = s.accents[this.step++ % s.accents.length];
      if (a <= 0) continue;
      const c = this.p.chordAt(t);
      let m = c.bass[0] ?? 38;
      while (m < 38) m += 12;
      const f = mtof(m);
      const v = this.voice(t, 'pulse');
      thump(v, v.out, t, f * 1.06, f, 0.05, s.decay, s.gain * a, 0.25);
      const h = v.osc('sine', f * 2, t, t + s.decay * 0.6 + 0.05);
      const hg = v.gain(0);
      h.connect(hg).connect(v.out);
      perc(hg.gain, t, 0.012, s.decay * 0.6, s.gain * a * 0.3);
    }
  }
}

class BloomLayer extends Layer {
  private done = false;
  private readonly s: BloomSpec;

  constructor(p: MoodPlayer, s: BloomSpec) {
    super(p, s);
    this.s = s;
    this.input.connect(this.lvl);
  }

  schedule(now: number, horizon: number) {
    if (this.done) return;
    const s = this.s;
    const t = Math.max(this.p.real(s.at), now);
    if (t >= horizon) return;
    this.done = true;
    const v = this.voice(t, 'bloom');
    const notes = s.notes.split(/\s+/).map(note);
    const top = s.top ? s.top.split(/\s+/).map(note) : [];
    const upper = notes.filter((m) => m >= 50);
    choir(v, v.out, t, upper, { attack: s.attack, hold: s.hold, release: s.release, gain: s.gain * 0.7, vowel: 'a', spread: 0.8, stagger: 0.06 });
    const sw = chordSwell(v, v.out, t, notes.slice(1), { wave: v.bank.waves.string, attack: s.attack * 0.8, hold: s.hold, release: s.release, gain: s.gain, detune: 9, spread: 0.85, cutoff: 600, q: 0.6 });
    const fq = sw.filter.frequency;
    fq.setValueAtTime(500, t);
    fq.exponentialRampToValueAtTime(4200, t + s.attack);
    fq.exponentialRampToValueAtTime(1800, t + s.attack + s.hold);
    fq.exponentialRampToValueAtTime(600, t + s.attack + s.hold + s.release);
    const sub = v.osc('sine', mtof(notes[0]), t, t + s.attack + s.hold + s.release + 0.1);
    const sg = v.gain(0);
    sub.connect(sg).connect(v.out);
    pad(sg.gain, t, s.attack, t + s.attack + s.hold * 0.5, s.release * 0.8, s.gain * 3.2);
    top.forEach((m, i) => {
      const tt = t + s.attack * 0.7 + i * 0.4;
      glass(v, v.out, tt, mtof(m), s.gain * 0.7, 4.5, 0.6);
    });
  }
}

const SILENT: MoodDef = { level: -60, chords: [['D2', '']], durs: [60], layers: [] };

/** Beats at a tempo → seconds. */
const beats = (n: number, bpm: number) => (n * 60) / bpm;

export const MOOD_DEFS: Record<Mood, MoodDef> = {
  silence: SILENT,

  void: {
    level: -13.5,
    chords: [['D1 D2', 'A2']],
    durs: [40],
    layers: [
      { kind: 'pad', pick: 'all', wave: 'soft', oscs: 2, detune: 4, gain: 0.05, xfade: 8, cutoff: 280, q: 0.5, lfo: [0.03, 80], spread: 0.3, rev: 0.6, amp: [1 / 17, 0.5] },
      { kind: 'noise', buf: 'pinkSt', type: 'bandpass', f: 380, q: 0.8, gain: 0.02, mod: [0.08, 150], amp: [0.06, 0.6], rev: 0.5 },
      { kind: 'shimmer', gap: [6, 16], source: 'penta', range: [86, 100], gain: 0.02, decay: [3, 5], rev: 1, echo: 0.4 },
    ],
  },

  nebula: {
    level: -7.7,
    chords: [
      ['D2 A2', 'F#3 C#4 E4 A4'],
      ['D2 A2', 'G#3 B3 E4 F#4'],
      ['B1 F#2', 'F#3 A3 D4 E4'],
      ['D2 A2', 'E3 A3 C#4 F#4'],
    ],
    durs: [14, 14, 14, 14],
    layers: [
      { kind: 'pad', wave: 'warm', gain: 0.03, xfade: 6, cutoff: 900, q: 0.5, lfo: [0.05, 300], spread: 0.7, rev: 0.7, echo: 0.05, bright: 1.2 },
      { kind: 'pad', pick: 'bass', wave: 'soft', oscs: 1, gain: 0.07, xfade: 6, cutoff: 300, rev: 0.25 },
      { kind: 'noise', buf: 'pinkSt', type: 'bandpass', f: 600, q: 0.7, gain: 0.015, mod: [0.1, 250], amp: [0.07, 0.5], rev: 0.6 },
      { kind: 'shimmer', gap: [4, 10], source: 'top', range: [81, 98], gain: 0.022, decay: [2.5, 4.5], rev: 0.9, echo: 0.35 },
    ],
  },

  forge: {
    level: -4.4,
    chords: [
      ['D2 A2', 'F#3 C#4 E4 A4'],
      ['B1 F#2', 'F#3 B3 D4 A4'],
      ['E2 B2', 'G#3 B3 E4 F#4'],
      ['A1 E2', 'E3 A3 C#4 E4'],
    ],
    durs: [beats(8, 76), beats(8, 76), beats(8, 76), beats(8, 76)],
    layers: [
      { kind: 'pad', wave: 'warm', gain: 0.022, xfade: 3, cutoff: 1300, q: 0.6, lfo: [0.07, 350], spread: 0.75, rev: 0.6, echo: 0.05, bright: 1.2 },
      { kind: 'pad', pick: 'bass', wave: 'soft', oscs: 1, gain: 0.07, xfade: 3, cutoff: 320, rev: 0.2 },
      // The forge's heartbeat: a muted low string ostinato in eighths, chord tones D3–F#4.
      { kind: 'arp', bpm: 76, div: 2, pattern: 'up', source: 'chord', range: [50, 66], timbre: 'pluck', gain: 0.2, decay: 0.3, prob: 1, cutoff: 1900, rev: 0.25, accent: 0.5, spread: 0.25 },
      { kind: 'arp', bpm: 76, div: 2, pattern: 'updown', source: 'chord', octave: 1, timbre: 'pluck', gain: 0.04, decay: 0.75, prob: 0.5, cutoff: 2400, rev: 0.4, echo: 0.15, accent: 0.4, spread: 0.6 },
      { kind: 'pulse', bpm: 76, accents: [1, 0, 0.6, 0], gain: 0.14, decay: 0.6, rev: 0.1 },
      { kind: 'shimmer', gap: [5, 12], source: 'top', range: [81, 98], gain: 0.018, decay: [2.5, 4], rev: 0.9, echo: 0.35 },
    ],
  },

  giant: {
    level: -5.5,
    chords: [
      ['D2 A2', 'F#3 B3 D4', 'G#5'],
      ['D2 A2', 'G#3 B3 D4 F#4', 'G#5'],
      ['D2 A2', 'F#3 A3 C#4', 'A5'],
      ['D2 A2', 'E3 G#3 B3 D4', 'G#5'],
    ],
    durs: [10, 10, 10, 10],
    layers: [
      { kind: 'pad', wave: 'string', gain: 0.032, xfade: 5, cutoff: 650, q: 0.9, lfo: [0.06, 200], spread: 0.6, rev: 0.6, amp: [0.1, 0.55], bright: 1.5 },
      { kind: 'pad', pick: 'bass', wave: 'soft', oscs: 2, detune: 5, transpose: -12, gain: 0.09, xfade: 5, cutoff: 220, rev: 0.15 },
      { kind: 'pad', pick: 'top', wave: 'glass', oscs: 2, detune: 6, gain: 0.012, xfade: 5, cutoff: 3000, vibrato: [5.2, 9], spread: 0.8, rev: 0.8, amp: [6.5, 0.45] },
      { kind: 'noise', buf: 'brownSt', type: 'lowpass', f: 170, q: 0.7, gain: 0.07, mod: [0.4, 60], amp: [0.15, 0.6], rev: 0.2 },
      { kind: 'pulse', bpm: 40, accents: [1, 0, 0.55, 0], gain: 0.13, decay: 0.8, rev: 0.25 },
    ],
  },

  supernova: {
    level: -1.4,
    fadeIn: 0.05,
    chords: [
      ['D2 A2', 'E4 F#4 A4 C#5'],
      ['E2 B2', 'G#4 B4 E5 F#5'],
      ['D2 A2', 'F#4 A4 C#5 E5'],
    ],
    durs: [16, 12, 12],
    loopFrom: 1,
    layers: [
      { kind: 'bloom', at: 0.1, notes: 'D1 D2 A2 D3 F#3 A3 C#4 E4 F#4 A4', top: 'G#5 C#6 E6', attack: 2.6, hold: 3.5, release: 9, gain: 0.03, rev: 0.85, echo: 0.05 },
      { kind: 'pad', wave: 'glass', gain: 0.022, xfade: 6, cutoff: 3200, spread: 0.9, rev: 0.9, echo: 0.15, amp: [0.25, 0.2], from: 6 },
      { kind: 'pad', pick: 'bass', wave: 'soft', oscs: 1, gain: 0.05, xfade: 6, cutoff: 250, rev: 0.2, from: 6 },
      { kind: 'shimmer', gap: [0.6, 2.2], source: 'penta', range: [81, 100], gain: 0.03, decay: [2.5, 5], rev: 1, echo: 0.4, from: 1.5 },
      { kind: 'noise', buf: 'whiteSt', type: 'bandpass', f: 5200, q: 0.6, gain: 0.012, mod: [0.2, 1500], amp: [0.1, 0.5], rev: 0.8 },
    ],
  },

  remnant: {
    level: -6.0,
    chords: [
      ['D2 A2', 'E4 F#4 A4 C#5'],
      ['E2 B2', 'G#4 B4 E5 F#5'],
      ['F#2 C#3', 'A4 C#5 E5 F#5'],
      ['D2 A2', 'G#4 B4 C#5 E5'],
    ],
    durs: [12, 12, 12, 12],
    layers: [
      { kind: 'pad', wave: 'glass', gain: 0.022, xfade: 6, cutoff: 3200, spread: 0.9, rev: 0.9, echo: 0.15, amp: [0.25, 0.2], bright: 0.6 },
      { kind: 'pad', pick: 'bass', wave: 'soft', oscs: 1, gain: 0.05, xfade: 6, cutoff: 250, rev: 0.2 },
      { kind: 'arp', bpm: 48, div: 1, pattern: 'walk', source: 'penta', range: [74, 93], timbre: 'glass', gain: 0.035, decay: 3, prob: 0.65, rev: 0.9, echo: 0.45, spread: 0.7 },
      { kind: 'noise', buf: 'whiteSt', type: 'bandpass', f: 5000, q: 0.6, gain: 0.008, mod: [0.15, 1200], amp: [0.08, 0.5], rev: 0.8 },
      { kind: 'shimmer', gap: [5, 11], source: 'penta', range: [88, 103], gain: 0.016, decay: [3, 5], rev: 1, echo: 0.4 },
    ],
  },

  world: {
    level: -5.3,
    chords: [
      ['D2 A2', 'F#3 A3 C#4 E4'],
      ['C#2 A2', 'E3 A3 C#4 E4'],
      ['B1 F#2', 'F#3 A3 D4 E4'],
      ['E2 B2', 'G#3 B3 E4 F#4'],
      ['A1 E2', 'E3 A3 C#4 E4'],
      ['D2 A2', 'F#3 A3 D4 E4'],
    ],
    durs: [7, 7, 7, 7, 7, 7],
    layers: [
      { kind: 'pad', wave: 'string', gain: 0.024, xfade: 3, cutoff: 1500, q: 0.5, vibrato: [4.8, 6], spread: 0.8, rev: 0.6, bright: 1 },
      { kind: 'pad', wave: 'warm', oscs: 1, gain: 0.025, xfade: 3, cutoff: 800, spread: 0.4, rev: 0.4 },
      { kind: 'pad', pick: 'bass', wave: 'soft', oscs: 1, gain: 0.07, xfade: 3, cutoff: 300, rev: 0.2 },
      { kind: 'melody', timbre: 'felt', range: [62, 81], gain: 0.08, decay: 3.2, gap: [2, 5], beat: 0.62, rev: 0.5, echo: 0.25 },
      { kind: 'arp', bpm: 84, div: 2, pattern: 'up', source: 'chord', octave: 1, timbre: 'felt', gain: 0.032, decay: 1.6, prob: 0.6, rev: 0.5, echo: 0.2, spread: 0.5 },
      { kind: 'shimmer', gap: [6, 14], source: 'top', range: [84, 98], gain: 0.016, decay: [2.5, 4], rev: 0.9, echo: 0.35 },
    ],
  },

  dawn: {
    level: -0.9,
    chords: [
      ['D2 A2', 'F#3 A3 D4 E4'],
      ['B1 F#2', 'F#3 B3 D4 E4'],
      ['G1 D2', 'F#3 B3 D4 C#5'],
      ['A1 E2', 'E3 A3 C#4 E4'],
      ['D2 A2', 'F#3 A3 C#4 E4', 'G#4 A4'],
    ],
    durs: [9, 9, 9, 7.5, 24],
    loopFrom: 0,
    macro: [
      [0, 0.45],
      [9, 0.6],
      [27, 0.85],
      [34.5, 1],
      [52, 1],
      [70, 0.72],
    ],
    layers: [
      { kind: 'pad', wave: 'string', gain: 0.03, xfade: 3.5, cutoff: 1500, q: 0.5, vibrato: [5, 7], spread: 0.85, rev: 0.65, macroBright: true },
      { kind: 'pad', wave: 'warm', oscs: 1, gain: 0.03, xfade: 3.5, cutoff: 700, spread: 0.4, rev: 0.4 },
      { kind: 'pad', pick: 'bass', wave: 'soft', oscs: 1, gain: 0.11, xfade: 3.5, cutoff: 300, rev: 0.2 },
      { kind: 'pad', pick: 'notes', wave: 'reed', formant: 'a', gain: 0.02, xfade: 4, cutoff: 0, vibrato: [5.2, 9], spread: 0.7, rev: 0.8, from: 18 },
      { kind: 'pad', pick: 'top', wave: 'glass', gain: 0.016, xfade: 4, cutoff: 4000, spread: 0.9, rev: 0.9, echo: 0.2 },
      { kind: 'melody', timbre: 'felt', range: [62, 83], gain: 0.09, decay: 3.5, gap: [1.5, 3.5], beat: 0.58, rev: 0.5, echo: 0.25, from: 6 },
      { kind: 'arp', bpm: 66, div: 2, pattern: 'updown', source: 'chord', octave: 1, timbre: 'felt', gain: 0.03, decay: 1.8, prob: 0.7, rev: 0.5, echo: 0.2, spread: 0.5, from: 27 },
      { kind: 'shimmer', gap: [1.5, 4], source: 'penta', range: [86, 100], gain: 0.02, decay: [3, 5], rev: 1, echo: 0.4, from: 34 },
      { kind: 'noise', buf: 'pinkSt', type: 'bandpass', f: 2400, q: 0.5, gain: 0.006, mod: [0.1, 800], amp: [0.07, 0.5], rev: 0.5 },
    ],
  },

  sandbox: {
    level: -6.9,
    chords: [
      ['D2 A2', 'F#3 C#4 E4 A4'],
      ['B1 F#2', 'F#3 A3 D4 E4'],
      ['D2 A2', 'G#3 B3 E4 F#4'],
      ['A1 E2', 'E3 A3 C#4 F#4'],
    ],
    durs: [12, 12, 12, 12],
    layers: [
      { kind: 'pad', wave: 'warm', gain: 0.026, xfade: 5, cutoff: 1100, q: 0.5, lfo: [0.04, 250], spread: 0.75, rev: 0.7, bright: 1 },
      { kind: 'pad', pick: 'bass', wave: 'soft', oscs: 1, gain: 0.06, xfade: 5, cutoff: 300, rev: 0.2 },
      { kind: 'melody', timbre: 'felt', range: [66, 86], gain: 0.06, decay: 3.2, gap: [5, 11], beat: 0.7, rev: 0.6, echo: 0.3 },
      { kind: 'shimmer', gap: [6, 14], source: 'top', range: [84, 98], gain: 0.016, decay: [2.5, 4], rev: 0.9, echo: 0.35 },
      { kind: 'noise', buf: 'pinkSt', type: 'bandpass', f: 700, q: 0.7, gain: 0.008, mod: [0.08, 250], amp: [0.06, 0.5], rev: 0.6 },
    ],
  },
};

export interface MoodOptions {
  /** Time compression for previews and the trailer (2 = twice as fast harmonic rhythm). */
  pace?: number;
  /** Override the crossfade-in time. */
  fadeIn?: number;
  /** Extra level in dB (offline mixes, e.g. the trailer's dawn). */
  gainDb?: number;
}

export class MoodPlayer {
  readonly mood: Mood;
  readonly host: Host;
  readonly r: Rand;
  readonly t0: number;
  readonly pace: number;
  readonly prog: Progression;
  readonly persist: Voice;
  readonly dryIn: GainNode;
  readonly revIn: GainNode;
  readonly echoIn: GainNode;
  readonly macroPts: [number, number][] | null;
  private readonly fades: GainNode[] = [];
  private readonly layers: Layer[] = [];
  private readonly voices: Voice[] = [];
  retired = false;
  retireEnd = Infinity;

  constructor(host: Host, mood: Mood, sends: Sends, t0: number, opts: MoodOptions = {}) {
    const def = MOOD_DEFS[mood];
    this.mood = mood;
    this.host = host;
    this.r = host.rand;
    this.t0 = t0;
    this.pace = clamp(opts.pace ?? 1, 0.25, 8);
    this.prog = new Progression(
      def.chords.map(([b, n, top]) => chord(b, n, top ?? '')),
      def.durs,
      def.loopFrom ?? 0,
    );
    this.macroPts = def.macro ?? null;
    this.persist = new Voice(host, t0, sends, 1, null, 0, `mood:${mood}`);
    this.persist.until(t0 + 1e7);
    const v = this.persist;
    const level = db(def.level + (opts.gainDb ?? 0));
    const fadeIn = opts.fadeIn ?? def.fadeIn ?? 4;
    const chain = (dest: AudioNode) => {
      const macro = v.gain(1);
      const fade = v.gain(0);
      macro.connect(fade).connect(dest);
      if (this.macroPts) {
        macro.gain.setValueAtTime(this.macroPts[0][1], t0);
        for (const [mt, g] of this.macroPts) macro.gain.linearRampToValueAtTime(g, this.real(mt));
      }
      fade.gain.setValueAtTime(0, t0);
      if (fadeIn <= 0.06) fade.gain.linearRampToValueAtTime(level, t0 + Math.max(fadeIn, 0.01));
      else swell(fade.gain, t0, fadeIn, 0, level);
      this.fades.push(fade);
      return macro;
    };
    // The persistent voice's own outputs are unused; layers route into these chains.
    this.dryIn = chain(sends.dry);
    this.revIn = chain(sends.rev);
    this.echoIn = chain(sends.echo);
    for (const s of def.layers) this.layers.push(this.make(s));
  }

  private make(s: LayerSpec): Layer {
    switch (s.kind) {
      case 'pad':
        return new PadLayer(this, s);
      case 'arp':
        return new ArpLayer(this, s);
      case 'melody':
        return new MelodyLayer(this, s);
      case 'shimmer':
        return new ShimmerLayer(this, s);
      case 'noise':
        return new NoiseLayer(this, s);
      case 'pulse':
        return new PulseLayer(this, s);
      case 'bloom':
        return new BloomLayer(this, s);
    }
  }

  /** Mood-time (seconds of the composition) → context time. */
  real(moodTime: number): number {
    return this.t0 + moodTime / this.pace;
  }

  chordAt(t: number): Chord {
    return this.prog.at(Math.max(0, (t - this.t0) * this.pace)).chord;
  }

  track(v: Voice): void {
    this.voices.push(v);
  }

  advance(now: number, horizon: number): void {
    if (!this.retired) for (const l of this.layers) l.schedule(now, horizon);
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.end < now) {
        v.dispose();
        this.voices.splice(i, 1);
      }
    }
  }

  setIntensity(x: number, t: number): void {
    for (const l of this.layers) l.intensity(x, t);
  }

  retire(t: number, fade: number): void {
    if (this.retired) return;
    this.retired = true;
    for (const g of this.fades) {
      hold(g.gain, t);
      glide(g.gain, 0, t, Math.max(fade, 0.05) / 6);
    }
    this.retireEnd = t + Math.max(fade, 0.05) + 0.25;
  }

  /** Stop everything now; returns the voices to disconnect once the stops have run. */
  kill(now: number): Voice[] {
    for (const v of this.voices) v.kill(now, 0.02);
    this.persist.kill(now, 0.02);
    const all = [...this.voices, this.persist];
    this.voices.length = 0;
    return all;
  }

  get voiceCount(): number {
    return this.voices.length;
  }

  /** Live node count (diagnostics). */
  get size(): number {
    let n = this.persist.size;
    for (const v of this.voices) n += v.size;
    return n;
  }
}

// ─── Tension: setIntensity() layers this over any mood ────────────────────────────
export class Tension {
  private readonly v: Voice;
  private readonly strLvl: GainNode;
  private readonly pulseLvl: GainNode;
  private readonly airLvl: GainNode;
  private readonly trem: OscillatorNode;
  idleSince = -1;

  constructor(host: Host, sends: Sends, t: number) {
    const v = new Voice(host, t, sends, 1, null, 0, 'tension');
    this.v = v;
    v.until(t + 1e7);
    const T = t + 1e7;
    const strings = v.gain(1);
    const bp = v.bq('bandpass', 2200, 0.5);
    const tremG = v.gain(0.6);
    this.trem = v.osc('sine', 6, t, T);
    const tremDepth = v.gain(0.4);
    this.trem.connect(tremDepth).connect(tremG.gain);
    this.strLvl = v.gain(0);
    strings.connect(bp).connect(tremG).connect(this.strLvl).connect(v.out);
    v.send(this.strLvl, 0.6, 0.1);
    for (const m of [69, 76, 80]) {
      for (const d of [-8, 8]) v.osc(v.bank.waves.string, mtof(m), t, T, d).connect(strings);
    }
    const pulseAmp = v.gain(0.5);
    v.lfo(t, T, 1.8, 0.5).connect(pulseAmp.gain);
    this.pulseLvl = v.gain(0);
    v.osc('sine', mtof(38), t, T).connect(pulseAmp);
    v.osc('sine', mtof(50), t, T).connect(v.gain(0.4)).connect(pulseAmp);
    pulseAmp.connect(this.pulseLvl).connect(v.out);
    const n = v.noise(v.bank.pinkSt, t, T);
    const hp = v.bq('highpass', 3500, 0.7);
    this.airLvl = v.gain(0);
    n.connect(hp).connect(this.airLvl).connect(v.out);
    v.send(this.airLvl, 0.5);
  }

  set(x: number, t: number): void {
    glide(this.strLvl.gain, 0.03 * Math.pow(x, 1.5), t, 0.25);
    glide(this.pulseLvl.gain, 0.1 * x * x, t, 0.25);
    glide(this.airLvl.gain, 0.03 * x * x, t, 0.25);
    glide(this.trem.frequency, 5 + 5 * x, t, 0.3);
  }

  get end(): number {
    return this.v.end;
  }

  get size(): number {
    return this.v.size;
  }

  kill(t: number): void {
    this.v.kill(t, 0.3);
  }

  dispose(): void {
    this.v.dispose();
  }
}
