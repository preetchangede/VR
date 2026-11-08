import type { Vector3 } from '@iwsdk/core';

export type Mood =
  | 'silence'
  | 'void'
  | 'nebula'
  | 'forge'
  | 'giant'
  | 'supernova'
  | 'remnant'
  | 'world'
  | 'dawn'
  | 'sandbox';

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

/** Structural 3-vector. A three.js `Vector3` satisfies it, and so does `{ x, y, z }`. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayOptions {
  /** 0..2, default 1. */
  gain?: number;
  /** Pitch multiplier, default 1. */
  pitch?: number;
  /** 0..1, default 0.5. Bigger = deeper and longer. */
  size?: number;
}

export const MOODS: readonly Mood[] = [
  'silence',
  'void',
  'nebula',
  'forge',
  'giant',
  'supernova',
  'remnant',
  'world',
  'dawn',
  'sandbox',
];

export const SFX_NAMES: readonly SfxName[] = [
  'well-open',
  'gather-tick',
  'ignite',
  'star-born',
  'collapse',
  'supernova',
  'pulsar-tick',
  'planet-form',
  'throw',
  'orbit-settle',
  'ocean-form',
  'life-bloom',
  'chime',
  'ember-speak',
  'burn-away',
  'return',
  'impact',
  'ring-shatter',
  'discovery',
  'gas-giant',
  'poke',
  'menu-open',
  'menu-close',
];

export const LOOP_NAMES: readonly LoopName[] = [
  'gather-wind',
  'compress',
  'star-hum',
  'pulsar',
  'surf',
  'wind',
  'giant-boil',
];
