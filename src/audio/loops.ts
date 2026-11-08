/**
 * Continuous spatial loops. Each loop owns one persistent Voice (its drones, filters and
 * modulators) and spawns short-lived child Voices for rhythmic events (heartbeats, pulsar
 * beams, waves), which are disposed as soon as they finish so long sessions never grow.
 */
import { thump } from './instruments';
import { pulsarEvent } from './sfx';
import { mtof, nearestPent } from './theory';
import type { LoopHandle, LoopName, Vec3 } from './types';
import { clamp, glide, hold, num, perc, rr } from './util';
import { type Host, placePanner, type Sends, Voice } from './voice';

const FOREVER = 1e7;

/** Output trims, calibrated offline to sit under the hero SFX (see tools/preview/audio). */
const LOOP_LEVEL: Partial<Record<LoopName, number>> = {
  'gather-wind': 2.25,
  compress: 0.6,
  'star-hum': 0.62,
  pulsar: 5.4,
  'giant-boil': 0.65,
  surf: 1.6,
  wind: 0.45,
};

export abstract class Loop implements LoopHandle {
  readonly name: LoopName;
  readonly v: Voice;
  /** Everything a design produces goes into `bus` (faded on start/stop). */
  protected readonly bus: GainNode;
  protected readonly revIn: GainNode;
  protected readonly echoIn: GainNode;
  protected readonly p: Record<string, number> = {};
  protected readonly t0: number;
  stopped = false;
  private readonly events: Voice[] = [];
  private readonly evSends: Sends;
  private readonly last = new Map<AudioParam, number>();
  protected lastTick: number;

  constructor(name: LoopName, protected readonly host: Host, t: number, sends: Sends, pos: Vec3 | null, params: Record<string, number> | undefined, ref?: number) {
    this.name = name;
    this.t0 = t;
    this.lastTick = t;
    this.v = new Voice(host, t, sends, LOOP_LEVEL[name] ?? 1, pos, 2, `loop:${name}`, ref);
    this.v.until(t + FOREVER);
    this.bus = this.v.gain(0);
    this.bus.connect(this.v.out);
    this.revIn = this.v.gain(1);
    this.revIn.connect(this.v.wet);
    this.echoIn = this.v.gain(1);
    this.echoIn.connect(this.v.dly);
    this.evSends = { dry: this.bus, rev: this.revIn, echo: this.echoIn };
    if (params) this.merge(params);
  }

  /**
   * Second construction phase (subclass fields are initialized only after the base
   * constructor returns, so building there would be overwritten).
   */
  init(): this {
    const t = this.t0;
    this.build(t);
    this.apply(t);
    this.applyGain(t);
    this.bus.gain.setValueAtTime(0, t);
    this.bus.gain.setTargetAtTime(1, t, 0.12);
    return this;
  }

  protected abstract build(t: number): void;
  protected abstract apply(t: number): void;
  /** Schedule rhythmic events up to `horizon`. */
  protected schedule(_now: number, _horizon: number, _dt: number): void {}

  private merge(params: Record<string, number>) {
    for (const k of Object.keys(params)) {
      const val = params[k];
      if (typeof val === 'number' && Number.isFinite(val)) this.p[k] = val;
    }
  }

  protected get now(): number {
    return this.v.ctx.currentTime;
  }

  protected param(name: string, fallback: number, lo = 0, hi = 1): number {
    return clamp(num(this.p[name], fallback), lo, hi);
  }

  /** Glide a param, skipping redundant automation when the value barely changed. */
  protected to(p: AudioParam, value: number, tau = 0.08): void {
    const prev = this.last.get(p);
    if (prev !== undefined && Math.abs(prev - value) <= Math.abs(value) * 0.003 + 1e-6) return;
    this.last.set(p, value);
    glide(p, value, this.now, tau);
  }

  /** A short-lived voice for one rhythmic event, routed through this loop. */
  protected event(t: number): Voice {
    const ev = new Voice(this.host, t, this.evSends, 1, null, 0, `loop-ev:${this.name}`);
    this.events.push(ev);
    return ev;
  }

  set(params: Record<string, number>): void {
    if (this.stopped || !params) return;
    this.merge(params);
    this.apply(this.now);
    if ('gain' in params) this.applyGain(this.now);
  }

  /** Every loop also takes `gain` (0..2, default 1): an overall level trim. */
  private applyGain(t: number) {
    if (this.p.gain === undefined) return;
    this.v.scale(this.param('gain', 1, 0, 2), t, 0.08);
  }

  setPosition(p: Vec3): void {
    if (this.stopped || !p || !this.v.panner) return;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    placePanner(this.v.panner, p, this.now, 0.02);
  }

  stop(fadeSeconds = 0.5): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.now;
    const fade = clamp(num(fadeSeconds, 0.5), 0.02, 30);
    for (const g of [this.bus, this.revIn, this.echoIn]) {
      hold(g.gain, t);
      glide(g.gain, 0, t, fade / 4);
    }
    this.v.kill(t + fade, 0.05);
    for (const ev of this.events) if (ev.t0 > t + fade) ev.kill(t, 0.01);
  }

  /** Live node count (diagnostics). */
  get size(): number {
    let n = this.v.size;
    for (const ev of this.events) n += ev.size;
    return n;
  }

  /** Called by the engine's scheduler. Returns false once the loop can be disposed. */
  tick(now: number, horizon: number): boolean {
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (!this.stopped) this.schedule(now, horizon, dt);
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i];
      if (ev.end < now) {
        ev.dispose();
        this.events.splice(i, 1);
      }
    }
    if (this.stopped && this.v.end < now) {
      for (const ev of this.events) ev.dispose();
      this.events.length = 0;
      this.v.dispose();
      return false;
    }
    return true;
  }
}

// ─── gather-wind: an airy whoosh driven by hand speed ───────────────────────────────
class GatherWind extends Loop {
  private bp1!: BiquadFilterNode;
  private bp2!: BiquadFilterNode;
  private g2!: GainNode;
  private level!: GainNode;
  private air!: GainNode;
  private lastLevel = 0;

  protected build(t: number) {
    const v = this.v;
    const n = v.noise(v.bank.pink, t, t + FOREVER);
    this.bp1 = v.bq('bandpass', 900, 1.1);
    this.bp2 = v.bq('bandpass', 2200, 3.2);
    const flutter = v.gain(1);
    v.mod(t, t + FOREVER, 3.4, 0.32).connect(flutter.gain);
    this.g2 = v.gain(0);
    this.level = v.gain(0);
    n.connect(this.bp1).connect(flutter);
    n.connect(this.bp2).connect(this.g2).connect(flutter);
    flutter.connect(this.level).connect(this.bus);
    const w = v.noise(v.bank.white, t, t + FOREVER);
    const hp = v.bq('highpass', 6500, 0.7);
    this.air = v.gain(0);
    w.connect(hp).connect(this.air).connect(this.bus);
    v.send(this.level, 0.25);
  }

  protected apply() {
    const i = this.param('intensity', 0);
    const pitch = this.param('pitch', 0.5);
    const f = (350 + 2200 * pitch) * (0.75 + 0.6 * i);
    this.to(this.bp1.frequency, f, 0.06);
    this.to(this.bp2.frequency, f * 2.4, 0.06);
    const lvl = 0.62 * Math.pow(i, 1.3);
    this.to(this.level.gain, lvl, lvl > this.lastLevel ? 0.035 : 0.16);
    this.lastLevel = lvl;
    this.to(this.g2.gain, 0.32 * i * i, 0.08);
    this.to(this.air.gain, 0.05 * i * i, 0.08);
  }
}

// ─── compress: holding something about to explode ─────────────────────────────────
class Compress extends Loop {
  private drone: OscillatorNode[] = [];
  private droneBase: number[] = [];
  private droneLp!: BiquadFilterNode;
  private droneLvl!: GainNode;
  private b1!: OscillatorNode;
  private b2!: OscillatorNode;
  private beatLvl!: GainNode;
  private crackle!: AudioBufferSourceNode;
  private crLvl!: GainNode;
  private rumbleLp!: BiquadFilterNode;
  private rumbleLvl!: GainNode;
  private hissBp!: BiquadFilterNode;
  private hissLvl!: GainNode;
  private nextBeat = 0;
  private holdTime = 0;

  protected build(t: number) {
    const v = this.v;
    const T = t + FOREVER;
    // Tension drone: A2 / E3 / A3, two detuned saws each, rising with progress.
    this.droneLp = v.bq('lowpass', 300, 1.6);
    this.droneLvl = v.gain(0);
    this.droneLp.connect(this.droneLvl).connect(this.bus);
    v.send(this.droneLvl, 0.35);
    const tones: [number, number][] = [
      [110, 1],
      [164.81, 0.7],
      [220, 0.45],
    ];
    for (const [f, a] of tones) {
      for (const d of [-9, 8]) {
        const o = v.osc(v.bank.waves.string, f, t, T, d);
        const g = v.gain(a * 0.5);
        o.connect(g).connect(this.droneLp);
        this.drone.push(o);
        this.droneBase.push(f);
      }
    }
    // Beating pair: a nervous shimmer that speeds up.
    this.b1 = v.osc('sine', 659.26, t, T);
    this.b2 = v.osc('sine', 660, t, T);
    this.beatLvl = v.gain(0);
    this.b1.connect(this.beatLvl);
    this.b2.connect(this.beatLvl);
    this.beatLvl.connect(this.bus);
    v.send(this.beatLvl, 0.4, 0.1);
    // Crackle.
    this.crackle = v.noise(v.bank.crackle, t, T, 0.7);
    const chp = v.bq('highpass', 1200, 0.7);
    this.crLvl = v.gain(0);
    this.crackle.connect(chp).connect(this.crLvl).connect(this.bus);
    // Pressure rumble.
    const br = v.noise(v.bank.brown, t, T);
    this.rumbleLp = v.bq('lowpass', 120, 0.9);
    this.rumbleLvl = v.gain(0);
    br.connect(this.rumbleLp).connect(this.rumbleLvl).connect(this.bus);
    // The last-moment hiss.
    const w = v.noise(v.bank.white, t, T);
    this.hissBp = v.bq('bandpass', 1500, 0.9);
    this.hissLvl = v.gain(0);
    w.connect(this.hissBp).connect(this.hissLvl).connect(this.bus);
    v.send(this.hissLvl, 0.3);
    this.nextBeat = t + 0.15;
  }

  private creep() {
    return clamp(this.holdTime / 1.2);
  }

  protected apply() {
    const p = this.param('progress', 0);
    const h = this.param('heat', p);
    const c = this.creep();
    const semis = 12 * Math.pow(p, 1.4) + 2 * c;
    const k = Math.pow(2, semis / 12);
    this.drone.forEach((o, i) => this.to(o.frequency, this.droneBase[i] * k, 0.12));
    this.to(this.droneLp.frequency, 250 + 3200 * p * p + 1500 * h + 1200 * c, 0.1);
    this.to(this.droneLvl.gain, 0.05 + 0.2 * p + 0.04 * c, 0.1);
    const f1 = 659.26 * Math.pow(2, (semis * 0.5) / 12);
    this.to(this.b1.frequency, f1, 0.1);
    this.to(this.b2.frequency, f1 + 0.4 + 9 * p * p + 4 * c, 0.1);
    this.to(this.beatLvl.gain, 0.012 + 0.035 * p, 0.1);
    this.to(this.crackle.playbackRate, 0.6 + 1.0 * h + 0.6 * p, 0.1);
    this.to(this.crLvl.gain, 0.02 + 0.3 * h * (0.3 + 0.7 * p), 0.08);
    this.to(this.rumbleLp.frequency, 90 + 260 * p, 0.1);
    this.to(this.rumbleLvl.gain, 0.04 + 0.3 * p * p, 0.1);
    const x = clamp((p - 0.8) / 0.2);
    this.to(this.hissBp.frequency, 1500 + 5000 * x + 1500 * c, 0.1);
    this.to(this.hissLvl.gain, 0.1 * x * x + 0.04 * c, 0.08);
  }

  protected schedule(now: number, horizon: number, dt: number) {
    const p = this.param('progress', 0);
    const before = this.creep();
    this.holdTime = p > 0.88 ? this.holdTime + dt : Math.max(0, this.holdTime - 2 * dt);
    if (Math.abs(this.creep() - before) > 0.01) this.apply();
    const c = this.creep();
    if (this.nextBeat < now - 0.1) this.nextBeat = now + 0.02;
    while (this.nextBeat < horizon) {
      const bpm = 50 + 95 * Math.pow(p, 2.2) + 25 * c;
      const period = 60 / bpm;
      const t = this.nextBeat;
      const lub = 0.08 + 0.5 * Math.pow(p, 1.4) + 0.12 * c;
      const ev = this.event(t);
      thump(ev, ev.out, t, 72, 42, 0.07, 0.24, lub, 0.45);
      const dub = t + clamp(period * 0.3, 0.12, 0.26);
      thump(ev, ev.out, dub, 64, 40, 0.07, 0.2, lub * 0.65, 0.45);
      if (p > 0.3) {
        const n = ev.noise(ev.bank.brown, t, t + 0.3);
        const lp = ev.bq('lowpass', 220, 0.8);
        const g = ev.gain(0);
        n.connect(lp).connect(g).connect(ev.out);
        perc(g.gain, t, 0.02, 0.22, 0.25 * p);
      }
      this.nextBeat += period;
    }
  }
}

// ─── star-hum: each star's quiet voice ────────────────────────────────────────────
class StarHum extends Loop {
  private oscs: { o: OscillatorNode; k: number }[] = [];
  private gs: GainNode[] = [];
  private lp!: BiquadFilterNode;
  private level!: GainNode;
  private plasma!: GainNode;
  private plasmaBp!: BiquadFilterNode;

  protected build(t: number) {
    const v = this.v;
    const T = t + FOREVER;
    this.lp = v.bq('lowpass', 800, 0.7);
    const breath = v.gain(1);
    v.mod(t, T, 0.35, 0.25).connect(breath.gain);
    this.level = v.gain(0);
    this.lp.connect(breath).connect(this.level).connect(this.bus);
    v.send(this.level, 0.3);
    const parts: [OscillatorType | PeriodicWave, number, number][] = [
      ['sine', 1, 0],
      [v.bank.waves.warm, 2, 4],
      [v.bank.waves.warm, 3, -5],
      ['sine', 4, 3],
    ];
    for (const [w, k, d] of parts) {
      const o = v.osc(w, 110 * k, t, T, d);
      const g = v.gain(0);
      o.connect(g).connect(this.lp);
      this.oscs.push({ o, k });
      this.gs.push(g);
    }
    const n = v.noise(v.bank.pink, t, T);
    this.plasmaBp = v.bq('bandpass', 3000, 1.2);
    this.plasma = v.gain(0);
    n.connect(this.plasmaBp).connect(this.plasma).connect(this.bus);
  }

  protected apply() {
    const m = this.param('mass', 1, 0, 3);
    const size = this.param('size', 0.5);
    const x = m / 3;
    const f0 = mtof(nearestPent(38 + 26 * x));
    for (const { o, k } of this.oscs) this.to(o.frequency, f0 * k, 0.4);
    const amps = [0.5, 0.3 + 0.2 * x, 0.12 + 0.2 * x, 0.04 + 0.12 * x];
    this.gs.forEach((g, i) => this.to(g.gain, amps[i], 0.3));
    this.to(this.lp.frequency, f0 * (2.5 + 7 * x) + 300 * size, 0.3);
    this.to(this.level.gain, 0.085 * (0.6 + 0.4 * size), 0.3);
    this.to(this.plasmaBp.frequency, 2200 + 2500 * x, 0.3);
    this.to(this.plasma.gain, 0.01 + 0.02 * size, 0.3);
  }
}

// ─── pulsar: a lighthouse beam sweeping past ──────────────────────────────────────
class Pulsar extends Loop {
  private next = 0;

  protected build(t: number) {
    this.next = t + 0.2;
    this.v.send(this.bus, 0.25, 0.08);
  }

  protected apply() {}

  protected schedule(now: number, horizon: number) {
    const rate = this.param('rate', 1, 0.1, 30);
    const period = 1 / rate;
    if (this.next < now) this.next = now + 0.15;
    while (this.next < horizon + 0.12) {
      const lead = Math.min(0.12, period * 0.4);
      const t = this.next;
      const ev = this.event(Math.max(now, t - lead));
      pulsarEvent(ev, ev.out, t, period, Math.min(lead, t - now), rate > 6 ? 0.7 : 1);
      this.next += period;
    }
  }
}

// ─── giant-boil: the roiling surface of a red supergiant ──────────────────────────
class GiantBoil extends Loop {
  private level!: GainNode;
  private rumLp!: BiquadFilterNode;
  private bub!: GainNode;

  protected build(t: number) {
    const v = this.v;
    const T = t + FOREVER;
    this.level = v.gain(0);
    this.level.connect(this.bus);
    v.send(this.level, 0.35);
    const br = v.noise(v.bank.brown, t, T);
    this.rumLp = v.bq('lowpass', 220, 0.9);
    v.mod(t, T, 0.5, 80).connect(this.rumLp.frequency);
    const rg = v.gain(0.7);
    br.connect(this.rumLp).connect(rg).connect(this.level);
    const pk = v.noise(v.bank.pink, t, T);
    const bp = v.bq('bandpass', 320, 2.2);
    v.mod(t, T, 0.8, 90).connect(bp.frequency);
    const amp = v.gain(1);
    v.mod(t, T, 5.5, 0.85).connect(amp.gain);
    this.bub = v.gain(0);
    pk.connect(bp).connect(amp).connect(this.bub).connect(this.level);
    const dbus = v.gain(1);
    const dlp = v.bq('lowpass', 240, 0.8);
    const sh = v.shaper(v.bank.drive);
    const dg = v.gain(0.22);
    dbus.connect(dlp).connect(sh).connect(dg).connect(this.level);
    for (const [f, d] of [[36.71, -6], [36.71, 5], [55, -4], [73.42, 7]] as const) {
      const o = v.osc(v.bank.waves.warm, f, t, T, d);
      o.connect(dbus);
    }
  }

  protected apply() {
    const i = this.param('intensity', 0.7);
    this.to(this.level.gain, 0.62 * Math.pow(i, 0.8), 0.25);
    this.to(this.rumLp.frequency, 160 + 220 * i, 0.3);
    this.to(this.bub.gain, 0.3 * i, 0.3);
  }
}

// ─── surf: an ocean breathing on the shore ────────────────────────────────────────
class Surf extends Loop {
  private bed!: GainNode;
  private next = 0;

  protected build(t: number) {
    const v = this.v;
    const T = t + FOREVER;
    const n = v.noise(v.bank.brownSt, t, T);
    const hp = v.bq('highpass', 55, 0.7);
    const lp = v.bq('lowpass', 380, 0.7);
    v.mod(t, T, 0.12, 120).connect(lp.frequency);
    this.bed = v.gain(0);
    n.connect(hp).connect(lp).connect(this.bed).connect(this.bus);
    v.send(this.bus, 0.18);
    this.next = t + 0.3;
  }

  protected apply() {
    const i = this.param('intensity', 0.7);
    this.to(this.bed.gain, 0.16 * (0.3 + 0.7 * i), 0.5);
  }

  protected schedule(now: number, horizon: number) {
    const i = this.param('intensity', 0.7);
    if (this.next < now - 0.5) this.next = now + 0.1;
    while (this.next < horizon) {
      const t0 = this.next;
      const r = this.host.rand;
      const ev = this.event(t0);
      const rise = rr(r, 1.8, 3.2);
      const crash = t0 + rise;
      const decay = rr(r, 2.8, 4.4);
      const end = crash + decay;
      const peak = rr(r, 0.2, 0.34) * (0.4 + 0.6 * i);
      const pan = ev.pan(rr(r, -0.65, 0.65));
      pan.connect(ev.out);
      const n = ev.noise(ev.bank.pinkSt, t0, end + 0.1);
      const whp = ev.bq('highpass', 70, 0.6);
      const lp = ev.bq('lowpass', 300, 0.5);
      lp.frequency.setValueAtTime(260, t0);
      lp.frequency.exponentialRampToValueAtTime(2600 * (0.6 + 0.4 * i), crash);
      lp.frequency.exponentialRampToValueAtTime(420, end);
      const g = ev.gain(0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak * 0.35, t0 + rise * 0.6);
      g.gain.linearRampToValueAtTime(peak, crash);
      g.gain.exponentialRampToValueAtTime(peak * 0.002, end);
      g.gain.setValueAtTime(0, end + 0.01);
      n.connect(whp).connect(lp).connect(g).connect(pan);
      const f = ev.noise(ev.bank.whiteSt, crash - 0.2, end);
      const hp = ev.bq('highpass', 4200, 0.6);
      const fg = ev.gain(0);
      f.connect(hp).connect(fg).connect(pan);
      fg.gain.setValueAtTime(0, crash - 0.2);
      fg.gain.linearRampToValueAtTime(peak * 0.3, crash + 0.15);
      fg.gain.exponentialRampToValueAtTime(peak * 0.0005, end - 0.2);
      fg.gain.setValueAtTime(0, end - 0.19);
      const c = ev.noise(ev.bank.crackle, crash + 0.4, crash + 2.6, 2.3);
      const chp = ev.bq('highpass', 3000, 0.7);
      const cg = ev.gain(0);
      c.connect(chp).connect(cg).connect(pan);
      cg.gain.setValueAtTime(0, crash + 0.4);
      cg.gain.linearRampToValueAtTime(peak * 0.12, crash + 1.1);
      cg.gain.linearRampToValueAtTime(0, crash + 2.6);
      this.next += rr(r, 5.5, 9.5) / (0.7 + 0.5 * i);
    }
  }
}

// ─── wind: the dawn air ───────────────────────────────────────────────────────────
class Wind extends Loop {
  private level!: GainNode;
  private bp1!: BiquadFilterNode;
  private whistle!: GainNode;

  protected build(t: number) {
    const v = this.v;
    const T = t + FOREVER;
    this.level = v.gain(0);
    this.level.connect(this.bus);
    v.send(this.level, 0.3);
    const n = v.noise(v.bank.pinkSt, t, T);
    this.bp1 = v.bq('bandpass', 700, 0.7);
    v.mod(t, T, 0.13, 320).connect(this.bp1.frequency);
    const gust = v.gain(1);
    v.mod(t, T, 0.09, 0.6).connect(gust.gain);
    n.connect(this.bp1).connect(gust).connect(this.level);
    const w = v.noise(v.bank.whiteSt, t, T);
    const bp2 = v.bq('bandpass', 2500, 5);
    v.mod(t, T, 0.2, 900).connect(bp2.frequency);
    this.whistle = v.gain(0);
    const wgust = v.gain(1);
    v.mod(t, T, 0.11, 0.8).connect(wgust.gain);
    w.connect(bp2).connect(wgust).connect(this.whistle).connect(this.level);
    const b = v.noise(v.bank.brownSt, t, T);
    const hp = v.bq('highpass', 60, 0.7);
    const lp = v.bq('lowpass', 220, 0.7);
    const bg = v.gain(0.35);
    b.connect(hp).connect(lp).connect(bg).connect(gust);
  }

  protected apply() {
    const i = this.param('intensity', 0.6);
    this.to(this.level.gain, 0.5 * Math.pow(i, 0.9), 0.4);
    this.to(this.bp1.frequency, 420 + 650 * i, 0.4);
    this.to(this.whistle.gain, 0.06 + 0.12 * i, 0.4);
  }
}

const LOOPS: Record<LoopName, new (name: LoopName, host: Host, t: number, sends: Sends, pos: Vec3 | null, params: Record<string, number> | undefined, ref?: number) => Loop> = {
  'gather-wind': GatherWind,
  compress: Compress,
  'star-hum': StarHum,
  pulsar: Pulsar,
  'giant-boil': GiantBoil,
  surf: Surf,
  wind: Wind,
};

/** Reference distance per loop: a supergiant engulfs your hands, ambiences are broad. */
const REF: Partial<Record<LoopName, number>> = { 'giant-boil': 0.6, surf: 1.5, wind: 1.5 };

export function createLoop(name: LoopName, host: Host, t: number, sends: Sends, pos: Vec3 | null, params?: Record<string, number>): Loop | null {
  const C = LOOPS[name];
  if (!C) return null;
  return new C(name, host, t, sends, pos, params, REF[name]).init();
}

