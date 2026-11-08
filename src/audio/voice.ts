/**
 * A Voice owns every node of one sound event, so it can be stolen (faded) or disposed
 * (disconnected) as a unit. Builder methods create, schedule and register nodes.
 *
 * Outputs (all scaled by the voice level and faded together on kill):
 *  - `out`  mono, through an HRTF panner when the voice is spatial
 *  - `wide` stereo, straight to the bus (musical blooms, sub-panners)
 *  - `wet`  reverb send
 *  - `dly`  echo send
 */
import type { Bank } from './dsp';
import type { Vec3 } from './types';
import { glide, hold, type Rand } from './util';

export interface Sends {
  dry: AudioNode;
  rev: AudioNode;
  echo: AudioNode;
}

export interface Host {
  readonly ctx: BaseAudioContext;
  readonly bank: Bank;
  readonly rand: Rand;
}

export const REF_DISTANCE = 0.3;

export function createPanner(ctx: BaseAudioContext, pos: Vec3, ref = REF_DISTANCE): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.maxDistance = 100;
  p.rolloffFactor = 1;
  placePanner(p, pos);
  return p;
}

/** Set a panner position immediately (`tau` = 0) or with smoothing. */
export function placePanner(p: PannerNode, v: Vec3, t?: number, tau = 0): void {
  if (p.positionX) {
    if (tau > 0 && t !== undefined) {
      p.positionX.setTargetAtTime(v.x, t, tau);
      p.positionY.setTargetAtTime(v.y, t, tau);
      p.positionZ.setTargetAtTime(v.z, t, tau);
    } else {
      p.positionX.value = v.x;
      p.positionY.value = v.y;
      p.positionZ.value = v.z;
    }
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(v.x, v.y, v.z);
  }
}

export class Voice {
  readonly ctx: BaseAudioContext;
  readonly bank: Bank;
  readonly r: Rand;
  readonly t0: number;
  readonly out: GainNode;
  readonly panner: PannerNode | null;
  end: number;
  priority: number;
  tag: string;
  dead = false;
  private readonly level: number;
  private scaleBy = 1;
  private readonly outLevel: GainNode;
  private readonly sends: Sends;
  private _wide: GainNode | null = null;
  private _wet: GainNode | null = null;
  private _dly: GainNode | null = null;
  private readonly nodes: AudioNode[] = [];
  private readonly srcs: AudioScheduledSourceNode[] = [];

  constructor(host: Host, t0: number, sends: Sends, level = 1, pos: Vec3 | null = null, priority = 1, tag = '', ref = REF_DISTANCE) {
    this.ctx = host.ctx;
    this.bank = host.bank;
    this.r = host.rand;
    this.t0 = t0;
    this.end = t0;
    this.level = level;
    this.sends = sends;
    this.priority = priority;
    this.tag = tag;
    // `out` is a unity input so designs can also send it (v.send(v.out, …)) without the
    // level being applied twice; the level lives in `outLevel`, `wide`, `wet` and `dly`.
    this.out = this.gain(1);
    this.outLevel = this.gain(level);
    this.out.connect(this.outLevel);
    if (pos) {
      this.panner = createPanner(this.ctx, pos, ref);
      this.nodes.push(this.panner);
      this.outLevel.connect(this.panner).connect(sends.dry);
    } else {
      this.panner = null;
      this.outLevel.connect(sends.dry);
    }
  }

  /** Rescale every output to level × x (loops use it for their `gain` param). */
  scale(x: number, t: number, tau = 0.08): void {
    if (this.dead) return;
    this.scaleBy = x;
    for (const g of [this.outLevel, this._wide, this._wet, this._dly]) if (g) glide(g.gain, this.level * x, t, tau);
  }

  get wide(): GainNode {
    if (!this._wide) {
      this._wide = this.gain(this.level * this.scaleBy);
      this._wide.connect(this.sends.dry);
    }
    return this._wide;
  }

  get wet(): GainNode {
    if (!this._wet) {
      this._wet = this.gain(this.level * this.scaleBy);
      this._wet.connect(this.sends.rev);
    }
    return this._wet;
  }

  get dly(): GainNode {
    if (!this._dly) {
      this._dly = this.gain(this.level * this.scaleBy);
      this._dly.connect(this.sends.echo);
    }
    return this._dly;
  }

  /** Route `node` to the reverb and/or echo sends at the given amounts. */
  send(node: AudioNode, rev: number, echo = 0): void {
    if (rev > 0) node.connect(this.gain(rev)).connect(this.wet);
    if (echo > 0) node.connect(this.gain(echo)).connect(this.dly);
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private source<T extends AudioScheduledSourceNode>(s: T, t0: number, t1: number, offset?: number): T {
    if (offset !== undefined && s instanceof AudioBufferSourceNode) s.start(t0, offset);
    else s.start(t0);
    s.stop(t1);
    this.srcs.push(s);
    this.nodes.push(s);
    if (t1 > this.end) this.end = t1;
    return s;
  }

  osc(type: OscillatorType | PeriodicWave, freq: number, t0: number, t1: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    return this.source(o, t0, t1);
  }

  /** Looping noise from a random point in the buffer. */
  noise(buf: AudioBuffer, t0: number, t1: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    return this.source(s, t0, t1, this.r() * buf.duration * 0.95);
  }

  /** The shared smooth-random signal, scaled to ±depth (connect it to an AudioParam). */
  mod(t0: number, t1: number, rate: number, depth: number): GainNode {
    const s = this.noise(this.bank.mod, t0, t1, rate);
    const g = this.gain(depth);
    s.connect(g);
    return g;
  }

  /** Sine LFO scaled to ±depth. */
  lfo(t0: number, t1: number, rate: number, depth: number, type: OscillatorType = 'sine'): GainNode {
    const o = this.osc(type, rate, t0, t1);
    const g = this.gain(depth);
    o.connect(g);
    return g;
  }

  gain(v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return this.track(g);
  }

  bq(type: BiquadFilterType, f: number, q = 0.707, gainDb = 0): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (gainDb) b.gain.value = gainDb;
    return this.track(b);
  }

  shaper(curve: Float32Array<ArrayBuffer>): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    return this.track(s);
  }

  pan(v: number): StereoPannerNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, v));
    return this.track(p);
  }

  delay(seconds: number, max = 1): DelayNode {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = seconds;
    return this.track(d);
  }

  /** An extra HRTF panner inside this voice (sparkles around the listener, moving shockwaves). */
  panner3d(pos: Vec3, ref = REF_DISTANCE): PannerNode {
    return this.track(createPanner(this.ctx, pos, ref));
  }

  /** Live node count (diagnostics). */
  get size(): number {
    return this.nodes.length;
  }

  /** HRTF panners owned by this voice (diagnostics). */
  get panners(): number {
    let n = 0;
    for (const x of this.nodes) if (x instanceof PannerNode) n++;
    return n;
  }

  /** Extend the voice lifetime (for tails that outlive every source). */
  until(t: number): void {
    if (t > this.end) this.end = t;
  }

  /** Fade everything out from `t` and stop all sources (voice stealing, mood changes). */
  kill(t: number, fade = 0.04): void {
    if (this.dead) return;
    this.dead = true;
    const outs = [this.outLevel, this._wide, this._wet, this._dly];
    for (const g of outs) {
      if (!g) continue;
      hold(g.gain, t);
      try {
        g.gain.setTargetAtTime(0, t, fade / 4);
      } catch {
        /* ignore */
      }
    }
    const stopAt = t + fade * 1.5 + 0.01;
    for (const s of this.srcs) {
      try {
        s.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    this.end = Math.min(this.end, stopAt + 0.05);
  }

  dispose(): void {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    this._wide = this._wet = this._dly = null;
    this.dead = true;
  }
}
