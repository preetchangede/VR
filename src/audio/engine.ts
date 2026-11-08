/**
 * AudioEngine: the public, never-throwing façade over AudioCore.
 *
 * - Nothing happens until unlock() (call it inside the Begin click handler, and again when
 *   the XR session starts). Every method is safe before that: state (volumes, mood,
 *   intensity, listener, loops) is remembered and applied on unlock; one-shots are dropped.
 * - A 50 ms timer (plus setListener() calls) drives the lookahead scheduler.
 */
import type { Vector3 } from '@iwsdk/core';
import { AudioCore } from './core';
import type { LoopHandle, LoopName, Mood, PlayOptions, SfxName, Vec3 } from './types';
import { num } from './util';

type Ctor = typeof AudioContext;

const copy = (v: Vec3 | null | undefined): Vec3 | null =>
  v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: v.x, y: v.y, z: v.z } : null;

function warn(where: string, e: unknown) {
  // One line, never a throw: audio must not take the experience down.
  console.warn(`[audio] ${where}:`, e instanceof Error ? e.message : e);
}

/** A loop handle that works before unlock (materialized later) and never throws. */
class SafeLoop implements LoopHandle {
  real: LoopHandle | null = null;
  stopped = false;
  readonly params: Record<string, number> = {};
  pos: Vec3 | null;

  constructor(
    readonly name: LoopName,
    pos: Vec3 | null,
    params: Record<string, number> | undefined,
  ) {
    this.pos = pos;
    if (params) this.merge(params);
  }

  private merge(p: Record<string, number>) {
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (typeof v === 'number' && Number.isFinite(v)) this.params[k] = v;
    }
  }

  set(params: Record<string, number>): void {
    if (this.stopped || !params) return;
    try {
      if (this.real) this.real.set(params);
      else this.merge(params);
    } catch (e) {
      warn(`loop ${this.name}.set`, e);
    }
  }

  setPosition(p: Vector3): void {
    if (this.stopped) return;
    const c = copy(p);
    if (!c) return;
    try {
      if (this.real) this.real.setPosition(c as Vector3);
      else this.pos = c;
    } catch (e) {
      warn(`loop ${this.name}.setPosition`, e);
    }
  }

  stop(fadeSeconds?: number): void {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.real?.stop(fadeSeconds);
    } catch (e) {
      warn(`loop ${this.name}.stop`, e);
    }
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private core: AudioCore | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPump = 0;
  private master = 1;
  private music = 1;
  private muted = false;
  private mood: Mood | null = null;
  private intensity = 0;
  private listener: { p: Vec3; f: Vec3; u: Vec3 } | null = null;
  private pending: SafeLoop[] = [];
  private gestureHooked = false;

  constructor() {
    /* Nothing touches Web Audio until unlock(). */
  }

  /** True once the AudioContext exists and is running. */
  get ready(): boolean {
    return !!this.core && !!this.ctx && this.ctx.state === 'running';
  }

  /** The underlying context (null before unlock), for diagnostics. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Create/resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
  unlock(): void {
    try {
      if (typeof window === 'undefined') return;
      if (!this.ctx) {
        const C: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
        if (!C) return;
        this.ctx = new C({ latencyHint: 'interactive' });
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      if (!this.core) this.boot(this.ctx);
    } catch (e) {
      warn('unlock', e);
    }
  }

  private boot(ctx: AudioContext) {
    const core = new AudioCore(ctx, ctx.destination);
    this.core = core;
    core.setMasterVolume(this.master);
    core.setMusicVolume(this.music);
    core.setMuted(this.muted);
    if (this.listener) core.setListener(this.listener.p, this.listener.f, this.listener.u);
    if (this.mood) core.setMood(this.mood);
    if (this.intensity > 0) core.setIntensity(this.intensity);
    for (const h of this.pending) {
      if (h.stopped) continue;
      h.real = core.loop(h.name, h.pos, h.params);
    }
    this.pending.length = 0;
    this.timer = setInterval(() => this.pump(), 50);
    this.hookGestures();
  }

  /** Resume after the browser suspends audio (headset sleep, tab switch) on the next gesture. */
  private hookGestures() {
    if (this.gestureHooked || typeof window === 'undefined') return;
    this.gestureHooked = true;
    const resume = () => {
      if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, resume, { capture: true, passive: true });
  }

  private pump() {
    if (!this.core) return;
    this.lastPump = performance.now();
    try {
      this.core.update();
    } catch (e) {
      warn('update', e);
    }
  }

  /** Call every frame with the head pose (world space). */
  setListener(position: Vector3, forward: Vector3, up: Vector3): void {
    const p = copy(position);
    const f = copy(forward);
    const u = copy(up);
    if (!p || !f || !u) return;
    this.listener = { p, f, u };
    if (!this.core) return;
    try {
      this.core.setListener(p, f, u);
    } catch (e) {
      warn('setListener', e);
    }
    if (performance.now() - this.lastPump > 40) this.pump();
  }

  setMasterVolume(v: number): void {
    this.master = Math.min(1, Math.max(0, num(v, 1)));
    try {
      this.core?.setMasterVolume(this.master);
    } catch (e) {
      warn('setMasterVolume', e);
    }
  }

  setMusicVolume(v: number): void {
    this.music = Math.min(1, Math.max(0, num(v, 1)));
    try {
      this.core?.setMusicVolume(this.music);
    } catch (e) {
      warn('setMusicVolume', e);
    }
  }

  setMuted(m: boolean): void {
    this.muted = !!m;
    try {
      this.core?.setMuted(this.muted);
    } catch (e) {
      warn('setMuted', e);
    }
  }

  /** Generative score: crossfade (~4 s) to a mood. */
  setMood(mood: Mood): void {
    this.mood = mood;
    try {
      this.core?.setMood(mood);
    } catch (e) {
      warn(`setMood ${mood}`, e);
    }
  }

  /** 0..1 extra tension/energy layered on the current mood. */
  setIntensity(v: number): void {
    this.intensity = Math.min(1, Math.max(0, num(v, 0)));
    try {
      this.core?.setIntensity(this.intensity);
    } catch (e) {
      warn('setIntensity', e);
    }
  }

  /** One-shot, spatialized at pos (or non-spatial without pos). */
  play(name: SfxName, pos?: Vector3, opts?: { gain?: number; pitch?: number; size?: number }): void {
    if (!this.ready) return;
    try {
      this.core!.play(name, copy(pos), opts as PlayOptions | undefined);
    } catch (e) {
      warn(`play ${name}`, e);
    }
  }

  /** Continuous spatial loop. */
  loop(name: LoopName, pos?: Vector3, params?: Record<string, number>): LoopHandle {
    const h = new SafeLoop(name, copy(pos), params);
    if (!this.core) {
      this.pending.push(h);
      return h;
    }
    try {
      h.real = this.core.loop(name, h.pos, h.params);
    } catch (e) {
      warn(`loop ${name}`, e);
    }
    return h;
  }

  /** Music of the spheres: a glass bell for an orbiting world (degree 0..9, D4…B5 pentatonic). */
  pluck(pos: Vector3, degree: number, brightness?: number): void {
    if (!this.ready) return;
    try {
      this.core!.pluck(copy(pos), degree, brightness ?? 0.6);
    } catch (e) {
      warn('pluck', e);
    }
  }

  /** Duck score, loops and SFX for a dramatic silence (hero SFX — ignite, collapse, supernova — still sound). */
  silence(seconds: number): void {
    if (!this.ready) return;
    try {
      this.core!.silence(seconds);
    } catch (e) {
      warn('silence', e);
    }
  }

  /** Diagnostics for a debug overlay. */
  stats(): Record<string, unknown> {
    return { state: this.ctx?.state ?? 'none', ...(this.core?.stats() ?? {}) };
  }

  /** Stop all sound and release the context. */
  dispose(): void {
    try {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.core?.dispose();
      this.ctx?.close().catch(() => {});
    } catch (e) {
      warn('dispose', e);
    }
    this.core = null;
    this.ctx = null;
  }
}
