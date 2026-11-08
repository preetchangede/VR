import type { Camera, Color, Group, Vector3, WebGLRenderer } from '@iwsdk/core';

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
type SurfaceModule = {
  SurfaceScene: (new (o: SurfaceOptions) => SurfaceScene) & { warmup(renderer?: WebGLRenderer, camera?: Camera): void };
};

let mod: Promise<SurfaceModule> | null = null;
/** The dawn scene is code-split: it loads after the first frame, never delaying cold start. */
export function loadSurface(): Promise<SurfaceModule> {
  if (!mod) mod = import('../surface/surface') as Promise<SurfaceModule>;
  return mod;
}
