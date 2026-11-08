import { Camera, Color, DataTexture, Group, Mesh, Quaternion, Vector3, WebGLRenderer } from '@iwsdk/core';
import { createCreatures } from './creatures';
import { buildFlora, createFloraMesh } from './flora';
import { Land, SEA } from './land';
import { Noise } from './noise';
import { Ocean } from './ocean';
import { createParticles } from './particles';
import { Shared } from './shared';
import { Sky } from './sky';
import { buildLandGeometry, createLandMesh, createRockMaterial, makeShoreTexture } from './terrain';
import { makeNoiseTexture, makeOceanTexture } from './textures';

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

const SKY_RADIUS = 352;

let sharedTextures: { noise: DataTexture; ocean: DataTexture } | null = null;

/**
 * SUNSMITH's dawn: the player sits on the shore of the world they made.
 *
 * Everything is procedural and lives under `group` (origin = ground under the
 * seated player, -Z toward the sunrise). Colors in `SurfaceOptions` are
 * display-space numbers, like the rest of the game.
 */
export class SurfaceScene {
  /** Throwaway instance kept alive by warmup() so its compiled programs stay cached. */
  private static warm: SurfaceScene | null = null;

  /**
   * Optional: call once at app load (outside XR). Builds a throwaway scene so
   * the generators are JIT-compiled, and (given a renderer + camera)
   * precompiles all six shader programs. Every instance shares the same
   * shader source, so the real scene later builds faster and shows its first
   * frame without a compile hitch. The throwaway is released automatically
   * once the real scene has rendered.
   */
  static warmup(renderer?: WebGLRenderer, camera?: Camera) {
    if (SurfaceScene.warm) return;
    const c = (r: number, g: number, b: number) => new Color(r, g, b);
    const s = new SurfaceScene({
      sunColor: c(1, 0.9, 0.72),
      sunSize: 1,
      oceanColor: c(0.04, 0.23, 0.29),
      landColor: c(0.35, 0.29, 0.26),
      lifeColor: c(0.18, 0.84, 0.63),
      lifeAmount: 0.5,
      hasMoon: true,
      moonPhase: 0.25,
      nebulaColors: [c(0.25, 0.9, 0.78)],
      hasRings: true,
      seed: 1,
    });
    if (renderer && camera) renderer.compile(s.group, camera);
    SurfaceScene.warm = s;
  }

  readonly group = new Group();
  /** Construction cost breakdown in ms (for profiling on device). */
  readonly buildTimes: Record<string, number> = {};
  private readonly shared: Shared;
  private readonly sky: Sky;
  private readonly ocean: Ocean;
  private readonly land: Mesh;
  private readonly textures: DataTexture[] = [];
  private frames = 0;
  private readonly headLocal = new Vector3();
  private readonly q = new Quaternion();
  private readonly tmp = new Vector3();

  constructor(opts: SurfaceOptions) {
    this.group.name = 'surface';
    let t0 = performance.now();
    const lap = (k: string) => {
      const t = performance.now();
      this.buildTimes[k] = Math.round((t - t0) * 10) / 10;
      t0 = t;
    };
    const seed = Math.floor(opts.seed) || 1;
    // The two detail textures are world-independent: built once, shared by
    // every instance (and by warmup()), never disposed by an instance.
    if (!sharedTextures) {
      const noise = new Noise(4242);
      sharedTextures = { noise: makeNoiseTexture(noise), ocean: makeOceanTexture(noise, 4242) };
    }
    const noiseTex = sharedTextures.noise;
    const oceanTex = sharedTextures.ocean;
    lap('textures');
    this.shared = new Shared(opts.sunColor, opts.sunSize, noiseTex, SEA);
    lap('sky');
    const land = new Land(seed);
    const shore = makeShoreTexture(land);
    this.textures.push(shore);
    lap('land');

    this.sky = new Sky(this.shared, SKY_RADIUS, {
      nebulaColors: opts.nebulaColors,
      hasMoon: opts.hasMoon,
      moonPhase: opts.moonPhase,
      hasRings: opts.hasRings,
      landColor: opts.landColor,
      oceanColor: opts.oceanColor,
      seed,
    });
    this.ocean = new Ocean(
      this.shared,
      shore,
      oceanTex,
      { oceanColor: opts.oceanColor, landColor: opts.landColor, seed },
      this.sky.reflectUniforms,
    );
    const rockMat = createRockMaterial(this.shared, shore, opts.landColor, opts.lifeColor, opts.lifeAmount);
    this.land = createLandMesh(buildLandGeometry(land, seed), rockMat);
    this.group.add(this.land, this.ocean.mesh, this.sky.mesh);
    lap('meshes');
    const life = Math.min(1, Math.max(0, opts.lifeAmount));
    const floraGeo = buildFlora(land, life, seed);
    if (floraGeo) this.group.add(createFloraMesh(this.shared, shore, floraGeo, opts.lifeColor, opts.landColor));
    this.group.add(createParticles(this.shared, land, opts.lifeColor, life, seed));
    const gliders = createCreatures(this.shared, opts.lifeColor, life, seed);
    if (gliders) this.group.add(gliders);
    lap('life');

    this.headLocal.set(0, 1.15, 0);
    this.sky.mesh.position.copy(this.headLocal);
    this.ocean.follow(0, 1.15, 0);
    this.setDawn(0);
    this.setFade(1);
  }

  /**
   * Dawn progress 0..1: 0 = deep twilight (sun 8° below the horizon, stars
   * and nebula vivid), 0.35 = sun on the horizon, 1 = sun 18° up, golden
   * morning. Cheap; call every frame while animating.
   */
  setDawn(t: number): void {
    this.shared.setDawn(t);
    // keep world-space directions in sync even if update() already ran
    this.shared.updateWorld(this.q, this.shared.uniforms.uSeaY.value);
    this.sky.update(this.q);
  }

  update(dt: number, time: number, head: Vector3): void {
    void dt;
    // release the warmup instance once our own programs are in use
    // (i.e. after we have actually been rendered a few times)
    if (this.group.visible) this.frames++;
    if (this.frames === 3 && SurfaceScene.warm && SurfaceScene.warm !== this) {
      SurfaceScene.warm.dispose();
      SurfaceScene.warm = null;
    }
    const u = this.shared.uniforms;
    u.uTime.value = time;
    this.group.updateWorldMatrix(true, false);
    this.headLocal.copy(head);
    this.group.worldToLocal(this.headLocal);
    const h = this.headLocal;
    this.sky.mesh.position.copy(h);
    this.ocean.follow(h.x, h.y, h.z);
    this.group.getWorldQuaternion(this.q);
    this.sky.update(this.q);
    this.tmp.set(0, SEA, 0);
    this.group.localToWorld(this.tmp);
    this.shared.updateWorld(this.q, this.tmp.dot(u.uUp.value));
  }

  setFade(v: number): void {
    const f = Math.min(1, Math.max(0, v));
    this.shared.uniforms.uFade.value = f;
    this.group.visible = f > 0.001;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as { dispose(): void }).dispose();
      }
    });
    for (const t of this.textures) t.dispose(); // per-instance (shore map)
    this.shared.dispose();
    this.group.removeFromParent();
  }
}
