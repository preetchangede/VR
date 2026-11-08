import { BackSide, Color, Mesh, Quaternion, ShaderMaterial, SphereGeometry, Vector2, Vector3 } from '@iwsdk/core';
import { rng } from './noise';
import { COMMON } from './shaders';
import type { Shared } from './shared';
import { linear } from './terrain';

const DEG = Math.PI / 180;

export interface SkyOptions {
  nebulaColors: Color[];
  hasMoon: boolean;
  moonPhase: number;
  hasRings: boolean;
  landColor: Color;
  oceanColor: Color;
  seed: number;
}

/** Unit vector from azimuth (from -Z toward +X) and elevation, group-local. */
function dirAzEl(az: number, el: number, out = new Vector3()) {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/**
 * The sky dome: per-fragment atmosphere (from the baked LUT), sun disk,
 * stars, the player's supernova remnant and its pulsar, the moon, the ring
 * arc and a thin dawn cloud deck. Rendered last among opaques so the depth
 * test rejects every pixel the land and sea already cover.
 */
export class Sky {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  // local-frame directions (pushed to world each frame)
  private readonly nebC: Vector3;
  private readonly nebR: Vector3;
  private readonly nebU: Vector3;
  private readonly moonD: Vector3;
  private readonly moonR: Vector3;
  private readonly moonU: Vector3;
  private readonly ringA: Vector3;
  private readonly phaseCos: number;
  private readonly u: Record<string, { value: unknown }>;
  private readonly shared: Shared;
  /** Uniform objects other materials can share (ocean reflections). */
  get reflectUniforms() {
    const u = this.u;
    return {
      uNebC: u.uNebC, uNebR: u.uNebR, uNebU: u.uNebU, uNebCol: u.uNebCol, uNebSeed: u.uNebSeed, uNebVis: u.uNebVis,
      uMoonOn: u.uMoonOn, uMoonD: u.uMoonD, uMoonL: u.uMoonL,
    };
  }

  constructor(shared: Shared, radius: number, opts: SkyOptions) {
    this.shared = shared;
    const r = rng(opts.seed * 3 + 1);
    // The remnant hangs high ahead-right, ~70° across; the moon floats low on
    // the left above the sea; the ring arc climbs out of the sea on the right.
    this.nebC = dirAzEl((8 + (r() - 0.5) * 10) * DEG, (47 + (r() - 0.5) * 6) * DEG);
    const tilt = (r() - 0.5) * 1.2;
    const up0 = new Vector3(0, 1, 0);
    this.nebR = new Vector3().crossVectors(up0, this.nebC).multiplyScalar(-1).normalize();
    this.nebU = new Vector3().crossVectors(this.nebR, this.nebC).multiplyScalar(-1).normalize();
    this.nebR.applyAxisAngle(this.nebC, tilt);
    this.nebU.applyAxisAngle(this.nebC, tilt);
    this.moonD = dirAzEl((-44 + (r() - 0.5) * 6) * DEG, (19 + (r() - 0.5) * 4) * DEG);
    this.moonR = new Vector3().crossVectors(up0, this.moonD).multiplyScalar(-1).normalize();
    this.moonU = new Vector3().crossVectors(this.moonR, this.moonD).multiplyScalar(-1).normalize();
    // ring plane normal: the spin axis at latitude ~30°, "south" to the right
    const lat = (30 + (r() - 0.5) * 6) * DEG;
    const southAz = (92 + (r() - 0.5) * 10) * DEG;
    const north = new Vector3(-Math.sin(southAz), 0, Math.cos(southAz));
    this.ringA = north.multiplyScalar(Math.cos(lat)).add(new Vector3(0, Math.sin(lat), 0)).normalize();
    const k = (1 - Math.cos(Math.PI * 2 * opts.moonPhase)) / 2; // illuminated fraction
    this.phaseCos = Math.min(0.999, Math.max(-0.999, 2 * k - 1));

    const neb = opts.nebulaColors.length ? opts.nebulaColors : [new Color(0.25, 0.9, 0.78)];
    const cols: Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const c = linear(neb[i % neb.length]);
      // boost saturation a touch: emission nebulae are vivid
      const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      cols.push(new Vector3(l + (c.r - l) * 1.25, l + (c.g - l) * 1.25, l + (c.b - l) * 1.25).max(new Vector3()));
    }
    const ringTint = linear(new Color().copy(opts.landColor).lerp(new Color(0.95, 0.9, 0.82), 0.65));
    const shine = linear(new Color().copy(opts.oceanColor).lerp(new Color(0.4, 0.6, 0.9), 0.5));

    this.u = {
      uNebC: { value: new Vector3() },
      uNebR: { value: new Vector3() },
      uNebU: { value: new Vector3() },
      uNebCol: { value: cols },
      uNebSeed: { value: new Vector2(r() * 10, r() * 10) },
      uMoonOn: { value: opts.hasMoon ? 1 : 0 },
      uMoonD: { value: new Vector3() },
      uMoonR: { value: new Vector3() },
      uMoonU: { value: new Vector3() },
      uMoonL: { value: new Vector3(0, 0, 1) },
      uMoonRad: { value: 1.75 * DEG },
      uPlanetShine: { value: new Vector3(shine.r, shine.g, shine.b) },
      uRingOn: { value: opts.hasRings ? 1 : 0 },
      uRingA: { value: new Vector3() },
      uRingTint: { value: new Vector3(ringTint.r, ringTint.g, ringTint.b) },
      uSunSpace: { value: new Vector3(...shared.bake.sun) },
      uNebVis: { value: 1 },
    };
    this.material = new ShaderMaterial({
      uniforms: { ...shared.uniforms, ...this.u },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = mat3(modelMatrix) * position;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        ${SKY_BODY}
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          gl_FragColor = outColor(skyColor(d));
        }`,
      side: BackSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'surface-sky';
  }

  /** Per frame: push local directions to world and update the moon's phase lighting. */
  update(q: Quaternion) {
    const u = this.u;
    // the remnant outlasts the stars: vivid before dawn, a ghost by morning
    const t = this.shared.dawn.t;
    const f = Math.min(1, Math.max(0, (t - 0.08) / 0.62));
    u.uNebVis.value = 1 - 0.92 * f * f * (3 - 2 * f);
    (u.uNebC.value as Vector3).copy(this.nebC).applyQuaternion(q);
    (u.uNebR.value as Vector3).copy(this.nebR).applyQuaternion(q);
    (u.uNebU.value as Vector3).copy(this.nebU).applyQuaternion(q);
    (u.uMoonD.value as Vector3).copy(this.moonD).applyQuaternion(q);
    (u.uMoonR.value as Vector3).copy(this.moonR).applyQuaternion(q);
    (u.uMoonU.value as Vector3).copy(this.moonU).applyQuaternion(q);
    (u.uRingA.value as Vector3).copy(this.ringA).applyQuaternion(q);
    // Moon lighting in its disk frame (x right, y up, z toward the viewer):
    // the lit limb faces the sun, the phase sets how much is lit.
    const s = this.shared.sunLocal;
    let sx = s.dot(this.moonR);
    let sy = s.dot(this.moonU);
    const l = Math.hypot(sx, sy) || 1;
    sx /= l;
    sy /= l;
    const c = this.phaseCos;
    const sn = Math.sqrt(1 - c * c);
    (u.uMoonL.value as Vector3).set(sx * sn, sy * sn, c);
  }
}

/** Sky radiance along a world direction. */
export const SKY_BODY = /* glsl */ `
uniform vec3 uNebC;
uniform vec3 uNebR;
uniform vec3 uNebU;
uniform vec3 uNebCol[4];
uniform vec2 uNebSeed;
uniform float uMoonOn;
uniform vec3 uMoonD;
uniform vec3 uMoonR;
uniform vec3 uMoonU;
uniform vec3 uMoonL;
uniform float uMoonRad;
uniform vec3 uPlanetShine;
uniform float uRingOn;
uniform vec3 uRingA;
uniform vec3 uRingTint;
uniform vec3 uSunSpace;
uniform float uNebVis;

vec3 hash33s(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

/** One layer of hashed stars, anti-aliased against the pixel footprint pa. */
vec3 starLayer(vec3 d, float scale, float density, float pa, float tw) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  vec3 h = hash33s(cell);
  if (h.x > density) return vec3(0.0);
  vec3 c = cell + 0.2 + 0.6 * hash33s(cell + 7.7);
  vec3 dp = p - c;
  dp -= d * dot(dp, d);
  float r = length(dp) / scale;           // angular distance (rad)
  float size = max(pa * 0.9, 0.00035);
  float core = exp(-r * r / (size * size));
  float mag = pow(h.z, 12.0) * 5.0 + pow(h.y, 4.0) * 0.1 + 0.006;
  float twinkle = 1.0 + tw * sin(uTime * (3.0 + 9.0 * h.y) + h.z * 40.0);
  float t = fract(h.y * 7.31);
  vec3 col = t < 0.25 ? vec3(0.62, 0.74, 1.0) : t < 0.7 ? vec3(1.0, 0.96, 0.9) : t < 0.9 ? vec3(1.0, 0.82, 0.6) : vec3(1.0, 0.62, 0.42);
  return col * core * mag * twinkle * (0.00035 * 0.00035) / (size * size);
}

/** Atmospheric transmittance looking up through the atmosphere (Kasten-Young airmass). */
vec3 viewTransmittance(float y) {
  float e = degrees(asin(clamp(y, 0.0, 1.0)));
  float am = 1.0 / (max(y, 0.0) + 0.50572 * pow(e + 6.07995, -1.6364));
  return exp(-vec3(0.11, 0.17, 0.31) * am);
}

float ridge(float v, float k) { return pow(1.0 - abs(v * 2.0 - 1.0), k); }

/**
 * The supernova remnant, ~70° across: a limb-brightened, irregular shell
 * whose rim breaks into braided filament arcs (like the Veil), each element
 * glowing at its own depth: oxygen teal on the outer shock, iron ember just
 * inside, a violet silicon haze, sparse carbon-gold knots. The interior is
 * mostly dark, crossed by a few faint wisps and dust lanes, with a small
 * blue-white synchrotron glow around the pulsar.
 * Returns emission (rgb, roughly 0..1) and dust absorption (a).
 */
vec4 nebula(vec3 d) {
  float cz = dot(d, uNebC);
  if (cz < 0.3) return vec4(0.0);
  vec2 p = vec2(dot(d, uNebR), dot(d, uNebU)) * 1.75;
  vec4 w = texture(uNoise, p * 0.17 + uNebSeed);
  vec2 q = p + (w.xy - 0.5) * 0.45;
  float r = length(q);
  float x = r / (1.0 + (w.z - 0.5) * 0.32);
  float th = atan(q.y, q.x);
  // gradients of the polar coordinate without the atan wrap (no mip seam)
  float dthx = dFdx(th);
  float dthy = dFdy(th);
  dthx -= sign(dthx) * step(3.14159, abs(dthx)) * 6.2831853;
  dthy -= sign(dthy) * step(3.14159, abs(dthy)) * 6.2831853;
  vec2 dxx = vec2(dthx * 0.63662, dFdx(x) * 4.5);
  vec2 dyy = vec2(dthy * 0.63662, dFdy(x) * 4.5);
  // limb-brightened shell, peaking just inside the shock front
  float sh = (sqrt(max(1.0 - x * x, 0.0)) - sqrt(max(0.72 - x * x, 0.0))) / 0.53;
  float rim = sh * sh;
  // only some arcs of the rim are bright (periodic in angle: seamless)
  // heavily blurred (coarse mips) so bright arcs change slowly around the rim
  vec2 sgx = vec2(max(abs(dthx * 0.3183), 0.004) * 24.0, 0.0);
  vec2 sgy = vec2(max(abs(dthy * 0.3183), 0.004) * 24.0, 0.0);
  float sector = smoothstep(0.38, 0.72, textureGrad(uNoise, vec2(th * 0.3183 + uNebSeed.x, 0.21), sgx, sgy).g);
  float sector2 = smoothstep(0.42, 0.7, textureGrad(uNoise, vec2(th * 0.3183 - uNebSeed.y, 0.63), sgx, sgy).b);
  // braided filaments running along the rim (polar, 4 texture periods per turn)
  vec2 pc = vec2(th * 0.63662, x * 4.5);
  // coarser mips (bias) keep the filaments long and smooth, not crumpled
  vec4 b1 = textureGrad(uNoise, pc + w.zw * 0.35, dxx * 3.0, dyy * 3.0);
  vec4 b2 = textureGrad(uNoise, pc * vec2(2.0, 2.7) + b1.xy * 0.18 + 0.4, dxx * vec2(2.0, 2.7) * 2.3, dyy * vec2(2.0, 2.7) * 2.3);
  vec4 tq = texture(uNoise, q * 2.4 + b1.zw * 0.25, 1.0);
  // soft-cored filaments whose brightness swells and fades along their length,
  // each wrapped in a faint glow
  // one sharp shock-front strand, one fainter companion, wrapped in soft glow
  float along = 0.2 + 0.8 * smoothstep(0.3, 0.75, b2.a);
  float along2 = smoothstep(0.45, 0.8, b1.a);
  float braid = ridge(b2.g, 34.0) * 0.95 * along + ridge(b1.r, 26.0) * 0.45 * along2;
  braid += (ridge(b2.g, 5.0) * 0.16 + ridge(b1.r, 3.0) * 0.1) * (0.4 + 0.6 * along);
  float glow = smoothstep(0.35, 0.85, b1.b) * 0.45;
  // element layers
  float wO = smoothstep(0.84, 0.97, x) * (1.0 - smoothstep(1.0, 1.1, x));
  float wFe = smoothstep(0.6, 0.84, x) * (1.0 - smoothstep(0.9, 0.99, x));
  vec3 e = vec3(0.0);
  e += uNebCol[0] * (braid + glow * 0.4) * wO * sector * 1.15;
  e += uNebCol[1] * (braid * 0.9 + glow * 0.3) * wFe * sector2 * (0.6 + 0.4 * sh);
  e += uNebCol[2] * (rim * 0.16 + glow * 0.1 * sh) * (0.5 + 0.5 * sector);
  float knots = smoothstep(0.78, 0.95, tq.a) * smoothstep(0.5, 0.8, x) * (1.0 - smoothstep(0.95, 1.05, x));
  e += uNebCol[3] * knots * 0.9;
  // faint interior wisps
  float wisp = (ridge(tq.g, 18.0) + ridge(tq.g, 3.0) * 0.25) * smoothstep(0.55, 0.75, w.a) * (1.0 - smoothstep(0.4, 0.85, x));
  e += mix(uNebCol[1], uNebCol[2], 0.5) * wisp * 0.16;
  // outer blast-wave halo
  e += uNebCol[0] * exp(-max(x - 1.0, 0.0) * 9.0) * step(1.0, x) * 0.05 * sector;
  // pulsar wind nebula: small blue-white synchrotron glow
  float rc = length(p);
  e += vec3(0.45, 0.6, 1.0) * (exp(-rc * rc * 700.0) * 0.3 + exp(-rc * 26.0) * 0.05) * (0.7 + 0.6 * tq.a);
  // dust lanes (none over the pulsar's own glow)
  float dust = smoothstep(0.6, 0.8, texture(uNoise, q * 1.1 + 5.3).a) * smoothstep(1.2, 0.7, x) * 0.7 * smoothstep(0.1, 0.3, rc);
  e *= 1.0 - dust * 0.8;
  // the hottest filament cores burn toward white
  float lum = dot(e, vec3(0.3, 0.5, 0.2));
  e = mix(e, vec3(lum * 1.15), smoothstep(0.3, 1.1, lum) * 0.45);
  float edge = smoothstep(0.3, 0.55, cz);
  return vec4(e * edge, dust * edge);
}

/** The pulsar: a tiny blue-white point with a sharp main pulse and interpulse. */
vec3 pulsar(vec3 d, float pa) {
  float s = length(cross(d, uNebC));
  if (dot(d, uNebC) < 0.0 || s > 0.03) return vec3(0.0);
  float ph = fract(uTime * 0.71);
  float pulse = pow(max(cos(ph * 6.2831853), 0.0), 40.0) + 0.45 * pow(max(cos(ph * 6.2831853 + 3.14159), 0.0), 60.0);
  float size = max(pa * 1.1, 0.0006);
  float core = exp(-s * s / (size * size));
  float halo = exp(-s / 0.0025) * 0.25;
  // faint diffraction cross in the nebula frame
  vec2 q = vec2(dot(d, uNebR), dot(d, uNebU));
  float spikes = (exp(-abs(q.x) / (size * 0.8)) * exp(-abs(q.y) / 0.01) + exp(-abs(q.y) / (size * 0.8)) * exp(-abs(q.x) / 0.01)) * 0.4;
  return vec3(0.75, 0.88, 1.0) * (core * (0.35 + 2.4 * pulse) + (halo + spikes) * (0.25 + pulse));
}

vec3 skyColor(vec3 d) {
  float y = dot(d, uUp);
  vec3 col = skyLut(d);
  float pa = length(fwidth(d));
  // display-relative scale for emissive night features (eye adaptation)
  float nightK = 40.0 / uExposure;
  float sunEl = dot(uSunDir, uUp);

  // ---- space behind the atmosphere ----
  vec3 space = vec3(0.0);
  if (y > -0.03) {
    if (uNight > 0.002) {
      float tw = 0.25 + 0.5 * (1.0 - saturate(y * 3.0));
      vec3 ds = d * uLocalRot;              // the star field belongs to this world
      space += starLayer(ds, 55.0, 0.05, pa, tw);
      space += starLayer(ds, 130.0, 0.035, pa, tw) * 0.45;
      space += starLayer(ds, 280.0, 0.03, pa, tw) * 0.22;
      space *= uNight;
    }
    float nebVis = uNebVis;
    vec4 nb = nebVis > 0.003 ? nebula(d) : vec4(0.0);
    space = space * (1.0 - nb.a * 0.85) + nb.rgb * 0.045 * nebVis;
    space += pulsar(d, pa) * 0.04 * nebVis;
    space *= nightK;

    // moon (occludes what lies behind it)
    if (uMoonOn > 0.5) {
      float mc = dot(d, uMoonD);
      if (mc > cos(uMoonRad * 1.5)) {
        vec2 mp = vec2(dot(d, uMoonR), dot(d, uMoonU)) / sin(uMoonRad);
        float rr = length(mp);
        float aa = 1.5 * pa / uMoonRad;
        float disk = 1.0 - smoothstep(1.0 - aa, 1.0, rr);
        if (disk > 0.0) {
          vec3 n = vec3(mp, sqrt(max(1.0 - rr * rr, 0.0)));
          float lit = dot(n, uMoonL);
          vec4 mn = texture(uNoise, mp * 0.32 + 0.37);
          vec4 mf = texture(uNoise, mp * 1.3 + 0.11);
          float alb = 0.62 - 0.3 * smoothstep(0.45, 0.7, mn.r) + 0.12 * (mf.g - 0.5);
          alb *= 0.85 + 0.15 * smoothstep(0.3, 0.7, mf.b);
          float day = smoothstep(-0.02, 0.12, lit);
          float shade = day * (0.35 + 0.65 * saturate(lit));
          vec3 moon = vec3(1.0, 0.96, 0.9) * alb * shade;
          moon += uPlanetShine * alb * 0.035 * (1.0 - day);   // planetshine on the night side
          // physical radiance, capped so the face never clips at night
          vec3 mrad = moon * min(0.12, 1.4 / uExposure);
          space = mix(space, mrad, disk);
        }
      }
    }

    // ring arc: real geometry of an equatorial ring seen from the surface
    if (uRingOn > 0.5 && y > 0.0) {
      float da = dot(d, uRingA);
      float ua = dot(uUp, uRingA);
      float t = -ua / da;
      if (t > 0.0) {
        vec3 Y = uUp + t * d;               // hit point from the planet center (planet radii)
        float rr = length(Y);
        if (rr > 1.42 && rr < 2.2) {
          float u1 = texture(uNoise, vec2(rr * 0.9, 0.31)).r;
          float u2 = texture(uNoise, vec2(rr * 13.0, 0.77)).g;
          // faint inner C ring, dense B ring, the great gap, then the A ring
          float dens = smoothstep(1.42, 1.52, rr) * 0.25 + smoothstep(1.56, 1.62, rr) * 0.75;
          dens *= 1.0 - smoothstep(2.1, 2.2, rr);
          dens *= 0.7 + 0.3 * u1;
          dens *= 0.85 + 0.3 * u2;
          dens *= 1.0 - 0.9 * (smoothstep(1.88, 1.89, rr) - smoothstep(1.93, 1.94, rr));
          dens *= 1.0 - 0.5 * (smoothstep(2.05, 2.055, rr) - smoothstep(2.065, 2.07, rr));
          float alpha = saturate(dens * 0.75);
          // planet's shadow on the rings
          float ys = dot(Y, uSunDir);
          float lit = (ys < 0.0 && length(Y - uSunDir * ys) < 1.0) ? 0.0 : 1.0;
          float ph = 0.5 + 1.1 * pow(saturate(dot(d, uSunDir) * 0.5 + 0.5), 5.0);
          vec3 ring = uRingTint * (uSunSpace / PI) * ph * lit * dens + uRingTint * uPlanetShine * 0.02 * dens;
          vec3 rrad = ring * min(0.05, 0.5 / uExposure);
          space = mix(space, rrad, alpha);
        }
      }
    }
  }
  col += space * viewTransmittance(y);

  // ---- sun disk ----
  vec3 toSun = d - uSunDir;
  float dv = dot(toSun, uUp);
  vec3 hv = toSun - uUp * dv;
  float squash = 1.0 + 0.22 * (1.0 - smoothstep(0.0, 0.07, sunEl));
  float rs = sqrt(dot(hv, hv) + dv * dv * squash * squash) / uSunRadius;
  if (rs < 1.25) {
    float edge = 1.0 - smoothstep(1.0 - 1.5 * pa / uSunRadius, 1.0, rs);
    float mu = sqrt(max(0.0, 1.0 - rs * rs));
    float limb = 0.35 + 0.65 * pow(mu, 0.6);
    col += uSunDisk * limb * edge;
  }

  // ---- thin dawn cloud deck, catching the light before the sea does ----
  if (y > 0.008 && y < 0.3) {
    vec3 dl = d * uLocalRot;                  // to group-local
    float tc = 2.6 / y;                       // km to a deck 2.6 km up
    vec2 cp = dl.xz * tc;
    vec2 cuv = cp * vec2(0.03, 0.065) + vec2(uTime * 0.0006, 0.0) + uNebSeed;
    float c1 = texture(uNoise, cuv).r;
    float c2 = texture(uNoise, cuv * 3.1 + c1 * 0.25).g;
    float c0 = texture(uNoise, cp * 0.004 + uNebSeed.yx).b;
    float dens = smoothstep(0.6, 0.85, c1 * 0.7 + c2 * 0.4) * smoothstep(0.35, 0.65, c0);
    dens *= smoothstep(0.008, 0.035, y) * (1.0 - smoothstep(0.1, 0.28, y));
    if (dens > 0.001) {
      float fwd = dot(d, uSunDir);
      // lit from below by a sun the sea has not seen yet; bright silver
      // lining toward the sun (forward scattering)
      vec3 light = uCloudLight * (0.25 + 1.6 * pow(saturate(fwd * 0.5 + 0.5), 5.0));
      vec3 amb = ambient(uUp) * 0.3;
      vec3 cloud = (light * (0.45 + 0.55 * c2) * 0.22 + amb);
      // far clouds melt into the horizon haze
      float haze = 1.0 - exp(-tc / 45.0);
      cloud = mix(cloud, skyLutSoft(d), haze);
      col = mix(col, cloud, dens * 0.85);
    }
  }

  // below the visual horizon: sea haze (normally hidden by the ocean skirt)
  if (y < 0.0) col = mix(col, skyLutSoft(d) * 0.7, saturate(-y * 40.0));
  col += sunGlare(d);
  return col;
}
`;

/** Cheap reflections of the remnant's glow and the moon (for the sea). */
export const SKY_REFLECT = /* glsl */ `
uniform vec3 uNebC;
uniform vec3 uNebR;
uniform vec3 uNebU;
uniform vec3 uNebCol[4];
uniform vec2 uNebSeed;
uniform float uNebVis;
uniform float uMoonOn;
uniform vec3 uMoonD;
uniform vec3 uMoonL;

/** Blurred shell glow of the remnant along a reflected direction. */
vec3 nebulaReflect(vec3 R) {
  float cz = dot(R, uNebC);
  if (cz < 0.3 || uNebVis < 0.01) return vec3(0.0);
  vec2 p = vec2(dot(R, uNebR), dot(R, uNebU)) * 1.75;
  vec4 w = texture(uNoise, p * 0.17 + uNebSeed);
  vec2 q = p + (w.xy - 0.5) * 0.45;
  float x = length(q) / (1.0 + (w.z - 0.5) * 0.32);
  float sh = (sqrt(max(1.0 - x * x, 0.0)) - sqrt(max(0.72 - x * x, 0.0))) / 0.53;
  vec3 e = uNebCol[0] * smoothstep(0.84, 0.97, x) * (1.0 - smoothstep(1.0, 1.12, x)) * 0.32
         + uNebCol[1] * smoothstep(0.6, 0.84, x) * (1.0 - smoothstep(0.9, 0.99, x)) * 0.22
         + uNebCol[2] * sh * sh * 0.12;
  return e * smoothstep(0.3, 0.55, cz) * uNebVis;
}
`;
