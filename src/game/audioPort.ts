import type { Vector3 } from '@iwsdk/core';

/** The audio contract the game talks to (implemented by src/audio). */
export type Mood = 'silence' | 'void' | 'nebula' | 'forge' | 'giant' | 'supernova' | 'remnant' | 'world' | 'dawn' | 'sandbox';
export type SfxName =
  | 'well-open'
  | 'gather-tick'
  | 'ignite'
  | 'star-born'
  | 'collapse'
  | 'supernova'
  | 'pulsar-tick'
  | 'planet-form'
  | 'throw'
  | 'orbit-settle'
  | 'ocean-form'
  | 'life-bloom'
  | 'chime'
  | 'ember-speak'
  | 'burn-away'
  | 'return'
  | 'impact'
  | 'ring-shatter'
  | 'discovery'
  | 'gas-giant'
  | 'poke'
  | 'menu-open'
  | 'menu-close';
export type LoopName = 'gather-wind' | 'compress' | 'star-hum' | 'pulsar' | 'surf' | 'wind' | 'giant-boil';

export interface LoopHandle {
  set(params: Record<string, number>): void;
  setPosition(p: Vector3): void;
  stop(fadeSeconds?: number): void;
}

export interface AudioPort {
  unlock(): void;
  readonly ready: boolean;
  setListener(position: Vector3, forward: Vector3, up: Vector3): void;
  setMasterVolume(v: number): void;
  setMusicVolume(v: number): void;
  setMuted(m: boolean): void;
  setMood(mood: Mood): void;
  setIntensity(v: number): void;
  play(name: SfxName, pos?: Vector3, opts?: { gain?: number; pitch?: number; size?: number }): void;
  loop(name: LoopName, pos?: Vector3, params?: Record<string, number>): LoopHandle;
  pluck(pos: Vector3, degree: number, brightness?: number): void;
  silence(seconds: number): void;
}

const nullLoop: LoopHandle = { set() {}, setPosition() {}, stop() {} };

export const nullAudio: AudioPort = {
  unlock() {},
  ready: false,
  setListener() {},
  setMasterVolume() {},
  setMusicVolume() {},
  setMuted() {},
  setMood() {},
  setIntensity() {},
  play() {},
  loop: () => nullLoop,
  pluck() {},
  silence() {},
};
