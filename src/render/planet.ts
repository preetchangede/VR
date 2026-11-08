import {
  Color,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  NoBlending,
  RingGeometry,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from '@iwsdk/core';
import { additive, premultipliedOver } from './blend';
import { PLANET_VERT } from './planet/common';
import { BODY_FRAG } from './planet/body';
import { ATMO_FRAG, CLOUD_FRAG, RING_FRAG } from './planet/shells';
import { cloudThreshold, seaLevel, seaTable } from './planet/calibration';

export type PlanetKind = 'rocky' | 'gas' | 'moon';

export interface PlanetLook {
  kind: PlanetKind;
  seed: number; // continents/bands/craters pattern
  radius: number; // meters (0.012 .. 0.05)
  molten: number; // 0..1 (1 = freshly formed, glowing lava cracks over dark crust; fades as it cools)
  ocean: number; // 0..1 sea level / coverage (0 = dry)
  ice: number; // 0..1 polar caps / frozen world (1 = fully frozen white-blue)
  clouds: number; // 0..1 cloud coverage
  life: number; // 0..1 vegetation over land, plus subtle bioluminescence on the night side at high life
  atmosphere: Color; // rim/scatter color (blue for earthlike, orange haze for hot, pale for icy)
  bands: Color[]; // gas giant band palette (used when kind === 'gas')
  rings: number; // 0..1 ring opacity (0 = none); rings lie in the planet's equatorial plane
  dustTint: Color; // tint of the original stardust (gives each world some identity)
}

/*
 * COLOR CONVENTIONS
 *  - `atmosphere`, `dustTint` and the star color are read as display-space
 *    values (as written with `setRGB`, like the rest of SUNSMITH); only their
 *    hue matters, brightness is art-directed here.
 *  - `bands` are read as three.js-managed colors: `new Color('#e8c9a0')`
 *    displays as #e8c9a0 (three linearizes hex input on construction).
 * Shading is done in linear space; shaders write display values directly.
 */

const MAX_BANDS = 6;
const CLOUD_SCALE = 1.022;
const ATMO_SHELL = 1.2;
const RING_INNER = 1.2;
const RING_OUTER = 2.45;

// ---------------------------------------------------------------- shared geometry
interface SharedGeo {
  body: SphereGeometry;
  bodyLo: SphereGeometry;
  cloud: SphereGeometry;
  atmo: SphereGeometry;
  ring: RingGeometry;
  users: number;
}
let shared: SharedGeo | null = null;
function acquireGeometry(): SharedGeo {
  if (!shared) {
    shared = {
      body: new SphereGeometry(1, 64, 44),
      bodyLo: new SphereGeometry(1, 44, 30),
      cloud: new SphereGeometry(1, 48, 32),
      atmo: new SphereGeometry(1, 40, 24),
      ring: new RingGeometry(RING_INNER, RING_OUTER, 128, 2),
      users: 0,
    };
    // Exact, shared bounds: the transparent layers then have identical sort
    // depth, so three keeps their creation order (clouds, atmosphere, rings).
    for (const g of [shared.body, shared.bodyLo, shared.cloud, shared.atmo]) g.boundingSphere = new Sphere(new Vector3(), 1);
    shared.ring.boundingSphere = new Sphere(new Vector3(), RING_OUTER);
  }
  shared.users++;
  return shared;
}
function releaseGeometry() {
  if (!shared) return;
  shared.users--;
  if (shared.users <= 0) {
    shared.body.dispose();
    shared.bodyLo.dispose();
    shared.cloud.dispose();
    shared.atmo.dispose();
    shared.ring.dispose();
    shared = null;
  }
}

// ---------------------------------------------------------------- helpers
function rng(seed: number) {
  let a = (Math.floor(Math.abs(seed) * 7919.123) ^ 0x9e3779b9) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Copy a display-space color to linear and normalize it to a max channel of 1 (hue only). */
function hueOf(src: Color, out: Color, fallback: Color) {
  out.setRGB(srgbToLinear(clamp01(src.r)), srgbToLinear(clamp01(src.g)), srgbToLinear(clamp01(src.b)));
  const m = Math.max(out.r, out.g, out.b);
  if (m < 1e-4) return out.copy(fallback);
  return out.multiplyScalar(1 / m);
}

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpC = new Color();
const WHITE = new Color(1, 1, 1);
const SKY = new Color(0.25, 0.55, 1);

type U<T> = { value: T };

/**
 * A little procedural world: opaque body + cloud shell + additive atmosphere +
 * rings (at most 4 draw calls, unused layers are hidden).
 */
export class PlanetVisual {
  readonly group = new Group();
  /** Pixels per radian of the display, for detail LOD (Quest 3 is ~25 px/deg). */
  static pixelsPerRadian = 1430;
  /** Faint fill (linear) that keeps night sides readable against dimmed passthrough. */
  static readonly ambient = new Color(0.006, 0.007, 0.01);

  private readonly tilt = new Group();
  private readonly geo: SharedGeo;
  private readonly bodyMat: ShaderMaterial;
  private readonly cloudMat: ShaderMaterial;
  private readonly atmoMat: ShaderMaterial;
  private readonly ringMat: ShaderMaterial;
  private readonly body: Mesh;
  private readonly cloud: Mesh;
  private readonly atmo: Mesh;
  private readonly ring: Mesh;

  // Target look (copied, never aliased: callers mutate and re-pass their object).
  private kind: PlanetKind = 'rocky';
  private seed = NaN;
  private radius = 0.03;
  private target = { molten: 0, ocean: 0, ice: 0, clouds: 0, life: 0, rings: 0 };
  private shown = { molten: 0, ocean: 0, ice: 0, clouds: 0, life: 0, rings: 0, highlight: 0 };
  private highlightTarget = 0;
  private readonly atmoHue = new Color(0.25, 0.55, 1);
  private readonly atmoHueTarget = new Color(0.25, 0.55, 1);
  private readonly dustHue = new Color(1, 0.6, 0.4);
  private readonly bandCols: Color[] = [];
  private bandCount = 4;
  private primed = false;
  private readonly seaQ = new Float32Array(21);

  // Seed-derived motion.
  private spinRate = 0.12;
  private spinPhase = 0;
  private cloudRate = 0.14;

  private readonly u: {
    uStarPos: U<Vector3>;
    uLightCol: U<Color>;
    uAmbient: U<Color>;
    uSpinCS: U<Vector2>;
    uCloudCS: U<Vector2>;
    uSeedOff: U<Vector3>;
    uTime: U<number>;
    uOct: U<number>;
    uMolten: U<number>;
    uOcean: U<number>;
    uIce: U<number>;
    uClouds: U<number>;
    uLife: U<number>;
    uRings: U<number>;
    uHighlight: U<number>;
    uSeaLevel: U<number>;
    uRefLevel: U<number>;
    uCloudThr: U<number>;
    uAtmo: U<Color>;
    uSunset: U<Color>;
    uAtmoAmt: U<number>;
    uDust: U<Color>;
    uSoft: U<number>;
    uRing: U<Vector4>;
    uVort0: U<Vector4>;
    uVort1: U<Vector4>;
    uBands: U<Color[]>;
    uBandCount: U<number>;
    uBandP: U<Vector4>;
    uStormDir: U<Vector3>;
    uStormE: U<Vector3>;
    uStormN: U<Vector3>;
    uStorm: U<Vector4>;
    uStormCol: U<Color>;
    uShell: U<number>;
    uThick: U<number>;
    uLava: U<Color>;
    uRim: U<Color>;
    uRingCol: U<Color>;
    uLinN: U<Vector4[]>;
    uLinM: U<Vector4[]>;
  };

  constructor(look: PlanetLook) {
    for (let i = 0; i < MAX_BANDS; i++) this.bandCols.push(new Color(0.8, 0.7, 0.55));
    this.u = {
      uStarPos: { value: new Vector3(0, 0, 0) },
      uLightCol: { value: new Color(1, 1, 1) },
      uAmbient: { value: new Color(0.006, 0.007, 0.01) },
      uSpinCS: { value: new Vector2(1, 0) },
      uCloudCS: { value: new Vector2(1, 0) },
      uSeedOff: { value: new Vector3() },
      uTime: { value: 0 },
      uOct: { value: 4 },
      uMolten: { value: 0 },
      uOcean: { value: 0 },
      uIce: { value: 0 },
      uClouds: { value: 0 },
      uLife: { value: 0 },
      uRings: { value: 0 },
      uHighlight: { value: 0 },
      uSeaLevel: { value: -1 },
      uRefLevel: { value: 0 },
      uCloudThr: { value: 1 },
      uAtmo: { value: new Color(0.25, 0.55, 1) },
      uSunset: { value: new Color(1, 0.45, 0.2) },
      uAtmoAmt: { value: 1 },
      uDust: { value: new Color(1, 0.6, 0.4) },
      uSoft: { value: 0.12 },
      uRing: { value: new Vector4(1.45, 2.3, 0, 0) },
      uVort0: { value: new Vector4(0, 1, 0, 0) },
      uVort1: { value: new Vector4(0, 1, 0, 0) },
      uBands: { value: this.bandCols },
      uBandCount: { value: 4 },
      uBandP: { value: new Vector4(3.5, 0, 0.9, 0) },
      uStormDir: { value: new Vector3(1, 0, 0) },
      uStormE: { value: new Vector3(0, 0, 1) },
      uStormN: { value: new Vector3(0, 1, 0) },
      uStorm: { value: new Vector4(0.3, 0.16, 1, 0) },
      uStormCol: { value: new Color(0.55, 0.2, 0.1) },
      uShell: { value: ATMO_SHELL },
      uThick: { value: 0.045 },
      uLava: { value: new Color(0, 0, 0) },
      uRim: { value: new Color(0, 0, 0) },
      uRingCol: { value: new Color(0.6, 0.55, 0.48) },
      uLinN: { value: Array.from({ length: 8 }, () => new Vector4(0, 1, 0, 0)) },
      uLinM: { value: Array.from({ length: 8 }, () => new Vector4(1, 0, 0, 0)) },
    };
    this.geo = acquireGeometry();

    const uniforms = this.u as unknown as Record<string, U<unknown>>;
    this.bodyMat = new ShaderMaterial({
      uniforms,
      vertexShader: PLANET_VERT,
      fragmentShader: BODY_FRAG,
      defines: { KIND_ROCKY: 1 },
      side: FrontSide,
      blending: NoBlending,
    });
    this.cloudMat = premultipliedOver(
      new ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: CLOUD_FRAG, side: FrontSide }),
    );
    this.atmoMat = additive(
      new ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: ATMO_FRAG, side: FrontSide }),
    );
    this.ringMat = premultipliedOver(
      new ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: RING_FRAG, side: DoubleSide }),
    );

    this.body = new Mesh(this.geo.body, this.bodyMat);
    this.cloud = new Mesh(this.geo.cloud, this.cloudMat);
    this.atmo = new Mesh(this.geo.atmo, this.atmoMat);
    this.ring = new Mesh(this.geo.ring, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    // Transparent layers share the planet center (identical sort depth), so
    // three falls back to creation order: clouds, atmosphere, then rings.
    this.tilt.rotation.order = 'YZX';
    this.tilt.add(this.body, this.cloud, this.atmo, this.ring);
    this.group.add(this.tilt);

    this.setLook(look);
    this.snap();
    this.layout(PlanetVisual.pixelsPerRadian * 0.1);
  }

  /** Smoothly changes look (the caller may animate values; sudden jumps are eased here). */
  setLook(look: Partial<PlanetLook>): void {
    let reseed = false;
    if (look.kind !== undefined && look.kind !== this.kind) {
      this.kind = look.kind;
      this.bodyMat.defines = this.kind === 'gas' ? { KIND_GAS: 1 } : this.kind === 'moon' ? { KIND_MOON: 1 } : { KIND_ROCKY: 1 };
      this.bodyMat.needsUpdate = true;
      reseed = true;
    }
    let seed = this.seed;
    if (look.seed !== undefined) {
      seed = Number.isFinite(look.seed) ? look.seed : 0;
      if (seed !== this.seed) reseed = true;
    }
    if (reseed) this.applySeed(seed);
    if (look.radius !== undefined) this.radius = Math.max(0.002, look.radius);
    const t = this.target;
    if (look.molten !== undefined) t.molten = clamp01(look.molten);
    if (look.ocean !== undefined) t.ocean = clamp01(look.ocean);
    if (look.ice !== undefined) t.ice = clamp01(look.ice);
    if (look.clouds !== undefined) t.clouds = clamp01(look.clouds);
    if (look.life !== undefined) t.life = clamp01(look.life);
    if (look.rings !== undefined) t.rings = clamp01(look.rings);
    if (look.atmosphere) hueOf(look.atmosphere, this.atmoHueTarget, SKY);
    if (look.dustTint) hueOf(look.dustTint, this.dustHue, WHITE);
    if (look.bands && look.bands.length > 0) {
      const n = Math.min(MAX_BANDS, look.bands.length);
      // Sorted light -> dark: the shader alternates light zones and dark belts.
      for (let i = 0; i < n; i++) this.bandCols[i].copy(look.bands[i]);
      sortByLuma(this.bandCols, n);
      for (let i = n; i < MAX_BANDS; i++) this.bandCols[i].copy(this.bandCols[i % n]);
      this.bandCount = n;
      this.u.uBandCount.value = n;
      // Storm: the palette's most saturated tone pushed toward brick red.
      let best = 0;
      let bestSat = -1;
      for (let i = 0; i < n; i++) {
        const c = this.bandCols[i];
        const mx = Math.max(c.r, c.g, c.b);
        const sat = mx > 0 ? (mx - Math.min(c.r, c.g, c.b)) / mx : 0;
        if (sat > bestSat) {
          bestSat = sat;
          best = i;
        }
      }
      this.u.uStormCol.value.copy(this.bandCols[best]).lerp(tmpC.setRGB(0.72, 0.2, 0.1), 0.6);
    }
  }

  /** Extra emissive pulse 0..1 when touched/hovered by the player's hand. */
  setHighlight(v: number): void {
    this.highlightTarget = clamp01(v);
  }

  /** Jump displayed values to their targets (no easing), e.g. right after construction. */
  snap(): void {
    const s = this.shown;
    const t = this.target;
    s.molten = t.molten;
    s.ocean = t.ocean;
    s.ice = t.ice;
    s.clouds = t.clouds;
    s.life = t.life;
    s.rings = t.rings;
    s.highlight = this.highlightTarget;
    this.atmoHue.copy(this.atmoHueTarget);
    this.primed = true;
  }

  /** Call every frame. starPos/starColor/starIntensity = the light (world space); camPos = viewer. */
  update(dt: number, time: number, starPos: Vector3, starColor: Color, starIntensity: number, camPos: Vector3): void {
    if (!this.primed) this.snap();
    const u = this.u;
    const s = this.shown;
    const t = this.target;
    // Ease sudden jumps (an impact re-melting a world, rings appearing).
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 2.5);
    const kFast = 1 - Math.exp(-Math.min(dt, 0.1) * 8);
    s.molten += (t.molten - s.molten) * (t.molten > s.molten ? kFast : k);
    s.ocean += (t.ocean - s.ocean) * k;
    s.ice += (t.ice - s.ice) * k;
    s.clouds += (t.clouds - s.clouds) * k;
    s.life += (t.life - s.life) * k;
    s.rings += (t.rings - s.rings) * (1 - Math.exp(-Math.min(dt, 0.1) * 1.2));
    s.highlight += (this.highlightTarget - s.highlight) * kFast;
    this.atmoHue.lerp(this.atmoHueTarget, k);

    const kind = this.kind;
    const rocky = kind === 'rocky';
    const gas = kind === 'gas';
    const R = this.radius;

    // ---- uniforms from look
    u.uTime.value = time;
    u.uMolten.value = rocky ? s.molten : 0;
    u.uOcean.value = rocky ? s.ocean : 0;
    u.uIce.value = rocky ? s.ice : 0;
    u.uClouds.value = rocky ? s.clouds : 0;
    u.uLife.value = rocky ? s.life : 0;
    u.uRings.value = s.rings;
    u.uHighlight.value = s.highlight * (0.8 + 0.2 * Math.sin(time * 5.0));
    u.uSeaLevel.value = rocky && s.ocean > 0.002 ? seaLevel(this.seaQ, s.ocean) : -1;
    u.uCloudThr.value = cloudThreshold(s.clouds);
    u.uDust.value.copy(this.dustHue);
    u.uAmbient.value.copy(PlanetVisual.ambient);

    // Atmosphere: thin on young dry worlds, full once there is water and weather.
    const atmo = u.uAtmo.value;
    if (gas) {
      // Haze tinted by the bands themselves.
      tmpC.setRGB(0, 0, 0);
      for (let i = 0; i < this.bandCount; i++) tmpC.add(this.bandCols[i]);
      const m = Math.max(tmpC.r, tmpC.g, tmpC.b, 1e-4);
      tmpC.multiplyScalar(1 / m);
      atmo.copy(tmpC).lerp(this.atmoHue, 0.3).lerp(WHITE, 0.3);
      u.uAtmoAmt.value = 0.7;
      u.uThick.value = 0.045;
    } else if (rocky) {
      atmo.copy(this.atmoHue).lerp(WHITE, 0.12);
      u.uAtmoAmt.value = 0.25 + 0.75 * clamp01(Math.max(s.ocean * 1.6, s.clouds * 1.6, s.ice * 0.8, s.molten * 0.5));
      u.uThick.value = 0.028 + 0.012 * s.molten;
    } else {
      atmo.copy(this.atmoHue);
      u.uAtmoAmt.value = 0;
      u.uThick.value = 0.03;
    }
    u.uSunset.value.setRGB(1.0, 0.36, 0.12).lerp(atmo, 0.12);
    // Lava halo.
    const glow = rocky ? s.molten * s.molten : 0;
    u.uLava.value.setRGB(0.9, 0.24, 0.04).multiplyScalar(glow * 0.22);
    u.uRim.value.copy(this.dustHue).multiplyScalar(u.uHighlight.value * 0.6);
    // Rings: icy grey with a hint of the world's (or the shattered moon's) dust.
    u.uRingCol.value.setRGB(0.52, 0.48, 0.42).lerp(tmpC.copy(this.dustHue).multiplyScalar(0.45), 0.18);

    // ---- light
    u.uStarPos.value.copy(starPos);
    this.group.getWorldPosition(tmpV);
    const worldScale = this.worldScale();
    const dStar = Math.max(tmpV.distanceTo(starPos), 0.02);
    // Gentle falloff so inner worlds are bright and outer ones still readable.
    const fall = Math.min(1.6, Math.max(0.55, Math.sqrt(0.16 / dStar)));
    const lc = u.uLightCol.value;
    lc.setRGB(srgbToLinear(clamp01(starColor.r)), srgbToLinear(clamp01(starColor.g)), srgbToLinear(clamp01(starColor.b)));
    lc.multiplyScalar(Math.max(0, starIntensity) * fall * 1.55);
    // Terminator softness from the star's apparent size (assume ~2 cm stars).
    u.uSoft.value = Math.min(0.28, Math.max(0.06, 0.022 / dStar));

    // ---- spin (deterministic in time: previews and replays match)
    const a = this.spinPhase + time * this.spinRate;
    u.uSpinCS.value.set(Math.cos(a), Math.sin(a));
    const ca = this.spinPhase * 1.7 + time * this.cloudRate;
    u.uCloudCS.value.set(Math.cos(ca), Math.sin(ca));

    // ---- detail LOD from projected size
    const dCam = Math.max(tmpV2.copy(camPos).distanceTo(tmpV), 0.01);
    const rpx = ((R * worldScale) / dCam) * PlanetVisual.pixelsPerRadian;
    // ~4 octaves at typical viewing distance, 5 when held close, fewer when small.
    u.uOct.value = Math.min(5, Math.max(2.5, Math.log2(Math.max(rpx, 1)) - 2.4));

    this.layout(rpx);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.bodyMat.dispose();
    this.cloudMat.dispose();
    this.atmoMat.dispose();
    this.ringMat.dispose();
    releaseGeometry();
  }

  // ------------------------------------------------------------------ internals

  /** Mesh scales, LOD geometry and which layers draw at all (unused layers cost nothing). */
  private layout(rpx: number) {
    const R = this.radius;
    const s = this.shown;
    const rocky = this.kind === 'rocky';
    // Sub-pixel silhouette error either way (44 segments up to ~140 px radius).
    this.body.geometry = rpx < 140 ? this.geo.bodyLo : this.geo.body;
    this.body.scale.setScalar(R);
    this.cloud.scale.setScalar(R * CLOUD_SCALE);
    this.atmo.scale.setScalar(R * ATMO_SHELL);
    this.ring.scale.setScalar(R);
    this.cloud.visible = rocky && s.clouds > 0.003;
    this.ring.visible = s.rings > 0.003;
    this.atmo.visible = this.kind !== 'moon' || s.highlight > 0.003;
  }

  private worldScale() {
    const e = this.group.matrixWorld.elements;
    return Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) || 1;
  }

  private applySeed(seed: number) {
    if (!Number.isFinite(seed)) seed = 0;
    this.seed = seed;
    const r = rng(seed);
    const u = this.u;
    const so = u.uSeedOff.value.set(r() * 40 - 20, r() * 40 - 20, r() * 40 - 20);
    if (this.kind === 'rocky') {
      seaTable(so.x, so.y, so.z, this.seaQ);
      // Land colors are keyed to height above the lowest 30% (dry worlds) or the coast.
      u.uRefLevel.value = seaLevel(this.seaQ, 0.3);
    }
    const gas = this.kind === 'gas';
    const moon = this.kind === 'moon';
    // Axial tilt and spin.
    const tiltDeg = gas ? 6 + r() * 22 : moon ? 3 + r() * 10 : 10 + r() * 20;
    this.tilt.rotation.set(0, r() * Math.PI * 2, (tiltDeg * Math.PI) / 180 * (r() < 0.5 ? -1 : 1));
    const period = gas ? 28 + r() * 12 : moon ? 70 + r() * 40 : 40 + r() * 30;
    this.spinRate = (Math.PI * 2) / period;
    this.spinPhase = r() * Math.PI * 2;
    this.cloudRate = this.spinRate * (1.12 + r() * 0.12);
    // Two cyclones, one per hemisphere, counter-rotating.
    const v0 = randDir(r, 0.35, 0.75);
    const v1 = randDir(r, -0.75, -0.35);
    u.uVort0.value.set(v0.x, v0.y, v0.z, 2.2 + r() * 1.2);
    u.uVort1.value.set(v1.x, v1.y, v1.z, -(2.0 + r() * 1.2));
    // Ice lineae: great circles (plane normal + half-width) masked into arcs.
    for (let i = 0; i < 8; i++) {
      const n = randDir(r, -1, 1);
      const m = randDir(r, -1, 1);
      m.addScaledVector(n, -m.dot(n)).normalize();
      u.uLinN.value[i].set(n.x, n.y, n.z, 0.006 + r() * 0.014);
      u.uLinM.value[i].set(m.x, m.y, m.z, 0.35 + r() * 0.65);
    }
    // Rings.
    const inner = 1.38 + r() * 0.25;
    u.uRing.value.set(inner, Math.min(RING_OUTER - 0.02, inner + 0.65 + r() * 0.35), r() * 100, 0);
    // Gas giant bands and storm.
    u.uBandP.value.set(5.0 + r() * 2.5, r() * 10, 0.6 + r() * 0.4, r() * 100);
    const sLat = (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.2);
    const sLon = r() * Math.PI * 2;
    const cl = Math.cos(sLat);
    const sd = u.uStormDir.value.set(cl * Math.cos(sLon), Math.sin(sLat), cl * Math.sin(sLon));
    const east = u.uStormE.value.set(-Math.sin(sLon), 0, Math.cos(sLon));
    u.uStormN.value.crossVectors(sd, east).normalize();
    if (u.uStormN.value.y < 0) u.uStormN.value.multiplyScalar(-1);
    const big = 0.18 + r() * 0.12;
    u.uStorm.value.set(big, big * 0.55, 0.75 + r() * 0.25, 0);
  }
}

function sortByLuma(cols: Color[], n: number) {
  const luma = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  for (let i = 1; i < n; i++) {
    for (let j = i; j > 0 && luma(cols[j]) > luma(cols[j - 1]); j--) {
      tmpC.copy(cols[j]);
      cols[j].copy(cols[j - 1]);
      cols[j - 1].copy(tmpC);
    }
  }
}

function randDir(r: () => number, yMin: number, yMax: number) {
  const y = yMin + (yMax - yMin) * r();
  const a = r() * Math.PI * 2;
  const s = Math.sqrt(1 - y * y);
  return new Vector3(s * Math.cos(a), y, s * Math.sin(a));
}

