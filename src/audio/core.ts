/**
 * AudioCore: the whole engine on any BaseAudioContext (live AudioContext or an
 * OfflineAudioContext for audition renders). AudioEngine wraps it with unlock / null-safety.
 *
 * Signal flow
 *   moods ─▶ music (vol, duck) ─┐
 *   sfx + loops ─▶ sfx (duck) ──┼─▶ mix ─▶ HPF 24 Hz ─▶ glue comp ─▶ limiter ─▶ soft ceiling ─▶ master ─▶ mute ─▶ out
 *   hero sfx ───────────────────┤
 *   reverb / echo returns (fx duck) ┘
 * Every group also feeds the shared convolution reverb and ping-pong echo.
 */
import { type Bank, createBank } from './dsp';
import { glass } from './instruments';
import { createLoop, type Loop } from './loops';
import { MOOD_DEFS, type MoodOptions, MoodPlayer, Tension } from './score';
import { SFX } from './sfx';
import { mtof, PLUCK_NOTES } from './theory';
import type { LoopHandle, LoopName, Mood, PlayOptions, SfxName, Vec3 } from './types';
import { clamp, db, glide, hold, mulberry32, num, type Rand } from './util';
import { createPanner, placePanner, type Sends, Voice } from './voice';

export interface CoreOptions {
  /** PRNG seed (fixed seeds make offline renders reproducible). */
  seed?: number;
  /** Simultaneous one-shot voices before stealing (default 24). */
  maxVoices?: number;
  /** Scheduling lookahead in seconds (default 0.35). */
  lookahead?: number;
  /** Delay between a play() call and its sound, for safe scheduling (default 0.01). */
  lead?: number;
  /** Gain into the master bus in dB (offline mixes such as the trailer push the limiter harder). */
  trimDb?: number;
  /** Extra score level in dB (a trailer wants the music more forward than the game does). */
  musicTrimDb?: number;
}

interface Group {
  dry: GainNode;
  rev: GainNode;
  echo: GainNode;
  sends: Sends;
}

/** Compressors in Web Audio add automatic makeup gain; these pre-trims cancel it (measured in Chromium). */
const GLUE = { threshold: -18, knee: 12, ratio: 1.6, attack: 0.03, release: 0.35, makeupDb: 2.59 };
const LIMIT = { threshold: -5, knee: 0, ratio: 20, attack: 0.001, release: 0.12, makeupDb: 2.85 };

const MAX_TICKS = 6;
const TICK_INTERVAL = 1 / 25;

const finiteVec = (p: Vec3 | null | undefined): Vec3 | null =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? { x: p.x, y: p.y, z: p.z } : null;

export class AudioCore {
  readonly ctx: BaseAudioContext;
  readonly bank: Bank;
  readonly rand: Rand;
  readonly listenerPos: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly maxVoices: number;
  private readonly lookahead: number;
  private readonly lead: number;

  private readonly mix: GainNode;
  private readonly master: GainNode;
  private readonly muteGain: GainNode;
  private readonly musicVol: GainNode[];
  private readonly musicTrim: number;
  private readonly musicDuck: GainNode[];
  private readonly sfxDuck: GainNode[];
  private readonly fxDuck: GainNode;
  readonly music: Group;
  readonly sfx: Group;
  readonly hero: Group;
  private readonly tickPanners: PannerNode[] = [];
  private tickIdx = 0;
  private lastTick = -1;

  private voices: Voice[] = [];
  private dying: Voice[] = [];
  private loops: Loop[] = [];
  private mood: MoodPlayer | null = null;
  private moodName: Mood = 'silence';
  private retiring: MoodPlayer[] = [];
  private tension: Tension | null = null;
  private tensionDying: Tension | null = null;
  private intensity = 0;
  private silenceUntil = -1;
  private masterVolume = 1;
  private musicVolume = 1;
  private muted = false;

  constructor(ctx: BaseAudioContext, destination: AudioNode, opts: CoreOptions = {}) {
    this.ctx = ctx;
    this.rand = mulberry32(opts.seed ?? (Math.random() * 4294967296) >>> 0);
    this.maxVoices = opts.maxVoices ?? 24;
    this.lookahead = opts.lookahead ?? 0.35;
    this.lead = opts.lead ?? 0.01;
    this.bank = createBank(ctx, this.rand);
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };

    // Master chain.
    this.mix = g(db(opts.trimDb ?? 0));
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 24;
    hpf.Q.value = 0.6;
    const comp = (c: typeof GLUE) => {
      const d = ctx.createDynamicsCompressor();
      d.threshold.value = c.threshold;
      d.knee.value = c.knee;
      d.ratio.value = c.ratio;
      d.attack.value = c.attack;
      d.release.value = c.release;
      return d;
    };
    const glueTrim = g(db(-GLUE.makeupDb));
    const glue = comp(GLUE);
    const limTrim = g(db(-LIMIT.makeupDb));
    const limiter = comp(LIMIT);
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = this.bank.ceiling;
    this.master = g(1);
    this.muteGain = g(1);
    this.mix.connect(hpf).connect(glueTrim).connect(glue).connect(limTrim).connect(limiter).connect(ceiling).connect(this.master).connect(this.muteGain).connect(destination);

    // Reverb.
    this.fxDuck = g(1);
    this.fxDuck.connect(this.mix);
    const revIn = g(1);
    const revHp = ctx.createBiquadFilter();
    revHp.type = 'highpass';
    revHp.frequency.value = 160;
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = this.bank.ir;
    const revOut = g(1);
    revIn.connect(revHp).connect(conv).connect(revOut).connect(this.fxDuck);

    // Ping-pong echo (mono in, stereo out), darkening with every repeat.
    const echoIn = g(1);
    echoIn.channelCount = 1;
    echoIn.channelCountMode = 'explicit';
    const echoHp = ctx.createBiquadFilter();
    echoHp.type = 'highpass';
    echoHp.frequency.value = 260;
    const dL = ctx.createDelay(2);
    dL.delayTime.value = 0.43;
    const dR = ctx.createDelay(2);
    dR.delayTime.value = 0.61;
    const toneL = ctx.createBiquadFilter();
    toneL.frequency.value = 3400;
    const toneR = ctx.createBiquadFilter();
    toneR.frequency.value = 3000;
    const fbLR = g(0.42);
    const fbRL = g(0.42);
    const merger = ctx.createChannelMerger(2);
    const echoOut = g(1);
    echoIn.connect(echoHp).connect(dL);
    dL.connect(toneL).connect(fbLR).connect(dR);
    dR.connect(toneR).connect(fbRL).connect(dL);
    dL.connect(merger, 0, 0);
    dR.connect(merger, 0, 1);
    merger.connect(echoOut).connect(this.fxDuck);
    echoOut.connect(g(0.22)).connect(revIn);

    // Groups.
    const group = (dests: [AudioNode, AudioNode, AudioNode], stages: GainNode[][]): Group => {
      const heads: GainNode[] = [];
      for (let i = 0; i < 3; i++) {
        let node: AudioNode = dests[i];
        for (let s = stages.length - 1; s >= 0; s--) {
          stages[s][i].connect(node);
          node = stages[s][i];
        }
        heads.push(node as GainNode);
      }
      return { dry: heads[0], rev: heads[1], echo: heads[2], sends: { dry: heads[0], rev: heads[1], echo: heads[2] } };
    };
    const triple = () => [g(1), g(1), g(1)];
    this.musicTrim = db(opts.musicTrimDb ?? 0);
    this.musicVol = [g(this.musicTrim), g(this.musicTrim), g(this.musicTrim)];
    this.musicDuck = triple();
    this.sfxDuck = triple();
    this.music = group([this.mix, revIn, echoIn], [this.musicVol, this.musicDuck]);
    this.sfx = group([this.mix, revIn, echoIn], [this.sfxDuck]);
    this.hero = group([this.mix, revIn, echoIn], [triple()]);

    // Shared panners for gather ticks (also warms up the HRTF database early).
    for (let i = 0; i < 2; i++) {
      const p = createPanner(ctx, { x: 0, y: 0, z: -0.4 });
      p.connect(this.sfx.dry);
      this.tickPanners.push(p);
    }
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  // ─── Listener & volumes ────────────────────────────────────────────────────────
  setListener(p: Vec3, f: Vec3, u: Vec3): void {
    const pos = finiteVec(p);
    const fwd = finiteVec(f);
    const up = finiteVec(u);
    if (!pos || !fwd || !up) return;
    const fl = Math.hypot(fwd.x, fwd.y, fwd.z);
    const ul = Math.hypot(up.x, up.y, up.z);
    if (fl < 1e-6 || ul < 1e-6) return;
    this.listenerPos.x = pos.x;
    this.listenerPos.y = pos.y;
    this.listenerPos.z = pos.z;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos.x;
      L.positionY.value = pos.y;
      L.positionZ.value = pos.z;
      L.forwardX.value = fwd.x / fl;
      L.forwardY.value = fwd.y / fl;
      L.forwardZ.value = fwd.z / fl;
      L.upX.value = up.x / ul;
      L.upY.value = up.y / ul;
      L.upZ.value = up.z / ul;
    } else {
      const legacy = L as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(pos.x, pos.y, pos.z);
      legacy.setOrientation(fwd.x / fl, fwd.y / fl, fwd.z / fl, up.x / ul, up.y / ul, up.z / ul);
    }
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp(num(v, 1));
    glide(this.master.gain, this.masterVolume * this.masterVolume, this.now, 0.04);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = clamp(num(v, 1));
    const g = this.musicVolume * this.musicVolume * this.musicTrim;
    for (const n of this.musicVol) glide(n.gain, g, this.now, 0.08);
  }

  setMuted(m: boolean): void {
    this.muted = !!m;
    glide(this.muteGain.gain, this.muted ? 0 : 1, this.now, 0.04);
  }

  // ─── Score ─────────────────────────────────────────────────────────────────────
  get currentMood(): Mood {
    return this.moodName;
  }

  setMood(mood: Mood, opts?: MoodOptions): void {
    if (!(mood in MOOD_DEFS)) return;
    if (mood === this.moodName && (this.mood || mood === 'silence')) return;
    const now = this.now;
    if (this.mood) {
      this.mood.retire(now, mood === 'supernova' ? 1.2 : 4);
      this.retiring.push(this.mood);
      this.mood = null;
    }
    this.moodName = mood;
    if (mood !== 'silence') {
      this.mood = new MoodPlayer(this, mood, this.music.sends, now + this.lead, opts);
      this.mood.setIntensity(this.intensity, now);
      this.mood.advance(now, now + this.lookahead);
    }
  }

  setIntensity(v: number): void {
    const x = clamp(num(v, 0));
    this.intensity = x;
    const now = this.now;
    if (x > 0.01 && !this.tension) this.tension = new Tension(this, this.music.sends, now + this.lead);
    if (this.tension) {
      this.tension.set(x, now);
      this.tension.idleSince = x > 0.01 ? -1 : this.tension.idleSince < 0 ? now : this.tension.idleSince;
    }
    this.mood?.setIntensity(x, now);
  }

  // ─── One-shots ─────────────────────────────────────────────────────────────────
  play(name: SfxName, pos?: Vec3 | null, opts?: PlayOptions): void {
    const def = SFX[name];
    if (!def) return;
    const now = this.now;
    const t = now + this.lead;
    const level = clamp(num(opts?.gain, 1), 0, 2) * def.level;
    if (level <= 0) return;
    const at = finiteVec(pos);
    const size = clamp(num(opts?.size, 0.5));
    const pitch = clamp(num(opts?.pitch, 1), 0.25, 4);
    this.reap(now);

    let sends: Sends = def.hero ? this.hero.sends : this.sfx.sends;
    let spatial = at;
    if (name === 'gather-tick') {
      if (t - this.lastTick < TICK_INTERVAL) return;
      this.lastTick = t;
      const ticks = this.voices.filter((v) => v.tag === 'gather-tick');
      if (ticks.length >= MAX_TICKS) this.steal(ticks[0], now);
      if (at) {
        const p = this.tickPanners[this.tickIdx++ % this.tickPanners.length];
        placePanner(p, at);
        sends = { dry: p, rev: this.sfx.rev, echo: this.sfx.echo };
        spatial = null;
      }
    }
    if (!this.makeRoom(def.priority, now)) return;
    const v = new Voice(this, t, sends, level, spatial, def.priority, name);
    try {
      def.build({ v, t, size, pitch, pos: at, listener: { ...this.listenerPos }, r: this.rand });
    } catch (e) {
      v.kill(now, 0.01);
      this.dying.push(v);
      throw e;
    }
    this.voices.push(v);
    if (def.hero && now < this.silenceUntil) {
      hold(this.fxDuck.gain, now);
      glide(this.fxDuck.gain, 1, now, 0.01);
    }
  }

  /** Music of the spheres: a glass bell for an orbiting world. */
  pluck(pos: Vec3 | null | undefined, degree: number, brightness = 0.6): void {
    const now = this.now;
    const t = now + this.lead;
    this.reap(now);
    if (!this.makeRoom(1, now)) return;
    const b = clamp(num(brightness, 0.6));
    const m = PLUCK_NOTES[clamp(Math.round(num(degree, 0)), 0, PLUCK_NOTES.length - 1)];
    const v = new Voice(this, t, this.sfx.sends, 1, finiteVec(pos), 1, 'pluck');
    glass(v, v.out, t, mtof(m), 0.1, 2.6 + 1.6 * (1 - b), 0.25 + 0.7 * b);
    v.send(v.out, 0.5, 0.3);
    this.voices.push(v);
  }

  /** A dramatic silence: score, loops and ordinary SFX duck to nothing for `seconds`. */
  silence(seconds: number): void {
    const s = clamp(num(seconds, 1), 0.05, 30);
    const now = this.now;
    const back = now + s;
    this.silenceUntil = back;
    const all: [GainNode, number][] = [
      ...this.musicDuck.map((n) => [n, 0.6] as [GainNode, number]),
      ...this.sfxDuck.map((n) => [n, 0.05] as [GainNode, number]),
      [this.fxDuck, 0.25],
    ];
    for (const [n, release] of all) {
      hold(n.gain, now);
      glide(n.gain, 0, now, 0.025);
      glide(n.gain, 1, back, release);
    }
  }

  // ─── Loops ─────────────────────────────────────────────────────────────────────
  loop(name: LoopName, pos?: Vec3 | null, params?: Record<string, number>): LoopHandle | null {
    const l = createLoop(name, this, this.now + this.lead, this.sfx.sends, finiteVec(pos), params);
    if (l) this.loops.push(l);
    return l;
  }

  // ─── Scheduler ─────────────────────────────────────────────────────────────────
  /** Schedule ahead and clean up. Call often (the live engine does every ~50 ms). */
  update(): void {
    const now = this.now;
    const horizon = now + this.lookahead;
    this.mood?.advance(now, horizon);
    for (let i = this.retiring.length - 1; i >= 0; i--) {
      const m = this.retiring[i];
      m.advance(now, horizon);
      if (now >= m.retireEnd) {
        this.dying.push(...m.kill(now));
        this.retiring.splice(i, 1);
      }
    }
    for (let i = this.loops.length - 1; i >= 0; i--) {
      if (!this.loops[i].tick(now, horizon)) this.loops.splice(i, 1);
    }
    if (this.tension && this.tension.idleSince >= 0 && now - this.tension.idleSince > 5) {
      this.tension.kill(now);
      this.tensionDying?.dispose();
      this.tensionDying = this.tension;
      this.tension = null;
    }
    if (this.tensionDying && this.tensionDying.end < now) {
      this.tensionDying.dispose();
      this.tensionDying = null;
    }
    this.reap(now);
  }

  private reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.end < now) {
        v.dispose();
        this.voices.splice(i, 1);
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const v = this.dying[i];
      if (v.end < now) {
        v.dispose();
        this.dying.splice(i, 1);
      }
    }
  }

  private steal(v: Voice, now: number): void {
    v.kill(now, 0.03);
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    this.dying.push(v);
  }

  /** Free a slot for a voice of `priority`; false if every active voice outranks it. */
  private makeRoom(priority: number, now: number): boolean {
    if (this.voices.length < this.maxVoices) return true;
    let victim: Voice | null = null;
    for (const v of this.voices) {
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.t0 < victim.t0)) victim = v;
    }
    if (!victim || victim.priority > priority) return false;
    this.steal(victim, now);
    return true;
  }

  /** Nodes currently owned by the engine (excluding the fixed master/reverb/echo graph). */
  nodeCount(): number {
    let n = 0;
    for (const v of this.voices) n += v.size;
    for (const v of this.dying) n += v.size;
    for (const l of this.loops) n += l.size;
    if (this.mood) n += this.mood.size;
    for (const m of this.retiring) n += m.size;
    if (this.tension) n += this.tension.size;
    return n;
  }

  /** HRTF panners alive right now (the costliest node on Quest). */
  pannerCount(): number {
    let n = this.tickPanners.length;
    for (const v of this.voices) n += v.panners;
    for (const v of this.dying) n += v.panners;
    for (const l of this.loops) n += l.v.panners;
    return n;
  }

  stats() {
    return {
      nodes: this.nodeCount(),
      panners: this.pannerCount(),
      voices: this.voices.length,
      dying: this.dying.length,
      loops: this.loops.length,
      mood: this.moodName,
      moodVoices: this.mood?.voiceCount ?? 0,
      retiring: this.retiring.length,
      intensity: this.intensity,
      tension: !!this.tension,
      muted: this.muted,
      masterVolume: this.masterVolume,
      musicVolume: this.musicVolume,
    };
  }

  /** Stop everything (e.g. before closing the context). */
  dispose(): void {
    const now = this.now;
    for (const v of this.voices) v.kill(now, 0.02);
    for (const l of this.loops) l.stop(0.05);
    this.mood?.retire(now, 0.1);
    for (const m of this.retiring) m.kill(now);
    this.mood?.kill(now);
    this.tension?.kill(now);
  }
}
