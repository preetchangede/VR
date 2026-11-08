import type { Color, Group, Vector3 } from '@iwsdk/core';

/** Contract of the dawn scene (src/surface/surface.ts). */
export interface SurfaceOptions {
  sunColor: Color;
  sunSize: number;
  oceanColor: Color;
  landColor: Color;
  lifeColor: Color;
  lifeAmount: number;
  hasMoon: boolean;
  moonPhase: number;
  nebulaColors: Color[];
  hasRings: boolean;
  seed: number;
}
export interface SurfaceScene {
  readonly group: Group;
  setDawn(t: number): void;
  update(dt: number, time: number, head: Vector3): void;
  setFade(v: number): void;
  dispose(): void;
}
type SurfaceModule = { SurfaceScene: new (o: SurfaceOptions) => SurfaceScene };

/** Lazy-loads the dawn scene so it never delays cold start. */
export function loadSurface(): Promise<SurfaceModule> {
  const path = '../surface/surface';
  return import(/* @vite-ignore */ path) as Promise<SurfaceModule>;
}
