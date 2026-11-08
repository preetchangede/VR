import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector4,
} from '@iwsdk/core';
import { SEA } from './land';
import { rng } from './noise';
import { COMMON } from './shaders';
import { SKY_REFLECT } from './sky';
import type { Shared } from './shared';
import { linear, SHORE_GLSL } from './terrain';

const NWAVES = 6;

/**
 * Radial ocean grid centered under the viewer: rings spaced geometrically so
 * vertices are dense at the shore below and sparse at the horizon (~15k
 * verts). The outermost ring is a "skirt" lifted to eye height, so the sea
 * meets the sky exactly at the horizon line instead of 0.6° below it.
 */
function oceanGeometry(segments: number, rings: number, r0: number, r1: number, skirt: number) {
  const n = segments * rings;
  const pos = new Float32Array(n * 3);
  const q = Math.pow(r1 / r0, 1 / (rings - 2));
  for (let i = 0; i < rings; i++) {
    const last = i === rings - 1;
    const r = last ? skirt : r0 * Math.pow(q, i);
    for (let a = 0; a < segments; a++) {
      const th = ((a + (i & 1) * 0.5) / segments) * Math.PI * 2;
      const k = (i * segments + a) * 3;
      pos[k] = Math.sin(th) * r;
      pos[k + 1] = last ? 1 : 0;
      pos[k + 2] = -Math.cos(th) * r;
    }
  }
  const idx = new Uint16Array((rings - 1) * segments * 6);
  let o = 0;
  const at = (i: number, a: number) => i * segments + (((a % segments) + segments) % segments);
  for (let i = 0; i < rings - 1; i++) {
    for (let a = 0; a < segments; a++) {
      const a0 = at(i, a);
      const a1 = at(i, a + 1);
      const b0 = at(i + 1, a + (i & 1));
      const b1 = at(i + 1, a + 1 + (i & 1));
      idx[o++] = a0;
      idx[o++] = a1;
      idx[o++] = b0;
      idx[o++] = a1;
      idx[o++] = b1;
      idx[o++] = b0;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  return geo;
}

export interface OceanOptions {
  oceanColor: Color;
  landColor: Color;
  seed: number;
}

export class Ocean {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly off: Vector2;

  constructor(
    shared: Shared,
    shore: DataTexture,
    oceanTex: DataTexture,
    opts: OceanOptions,
    skyReflect: Record<string, { value: unknown }>,
  ) {
    const r = rng(opts.seed * 5 + 11);
    const waveA: Vector4[] = [];
    const waveB: Vector4[] = [];
    // A long swell rolling in from the open sea (from -Z toward the shore),
    // plus shorter wind waves fanning around it.
    const specs: [number, number, number][] = [
      // wavelength m, amplitude m, direction deg (0 = straight at the shore)
      [44, 0.32, 4],
      [26, 0.17, -15],
      [15.5, 0.095, 24],
      [8.7, 0.05, -33],
      [4.9, 0.026, 43],
      [2.7, 0.013, -9],
    ];
    const steep = 0.85;
    for (const [lam, amp, deg] of specs) {
      const k = (2 * Math.PI) / lam;
      const w = Math.sqrt(9.81 * k);
      const d = ((deg + (r() - 0.5) * 8) * Math.PI) / 180;
      const Q = steep / (k * amp * specs.length);
      waveA.push(new Vector4(Math.sin(d), Math.cos(d), k, amp));
      waveB.push(new Vector4(w, Q, r() * Math.PI * 2, lam));
    }
    this.off = new Vector2();
    const deep = linear(opts.oceanColor);
    // Subsurface glow: the ocean's own color lifted toward luminous teal.
    const sss = new Color().copy(opts.oceanColor);
    sss.offsetHSL(0, 0.15, 0.25);
    this.material = new ShaderMaterial({
      uniforms: {
        ...shared.uniforms,
        ...skyReflect,
        uShore: { value: shore },
        uSeaLocal: { value: SEA },
        uOcean: { value: oceanTex },
        uOff: { value: this.off },
        uHeadY: { value: 1.15 },
        uWaveA: { value: waveA },
        uWaveB: { value: waveB },
        uDeep: { value: deep },
        uSSS: { value: linear(sss) },
        uSeabed: { value: linear(opts.landColor) },
      },
      vertexShader: /* glsl */ `
        ${SHORE_GLSL}
        uniform float uTime;
        uniform vec2 uOff;
        uniform float uHeadY;
        uniform vec4 uWaveA[${NWAVES}];
        uniform vec4 uWaveB[${NWAVES}];
        uniform mat3 uLocalRot;
        varying vec3 vW;
        varying vec3 vL;
        varying vec3 vN;
        varying vec4 vWave; // x: crest height, y: jacobian, z: surf crest, w: surf envelope

        void main() {
          vec2 g = position.xz + uOff;
          float dist = length(position.xz);
          vec4 sh = shoreAt(g);
          float inside = inMap(g);
          float depth = mix(30.0, uSeaLocal - sh.r, inside);
          float shoreD = mix(200.0, sh.g, inside);
          vec3 p = vec3(g.x, uSeaLocal, g.y);
          vec3 nrm = vec3(0.0, 1.0, 0.0);
          float calm = clamp(depth * 0.22, 0.0, 1.0);
          float jac = 1.0;
          float crest = 0.0;
          for (int i = 0; i < ${NWAVES}; i++) {
            vec4 A = uWaveA[i];
            vec4 B = uWaveB[i];
            float lod = 1.0 - smoothstep(B.w * 2.5, B.w * 4.5, dist);
            float a = A.w * lod * calm;
            float th = A.z * dot(A.xy, g) - B.x * uTime + B.z;
            float s = sin(th);
            float c = cos(th);
            p.xz += B.y * a * A.xy * c;
            p.y += a * s;
            nrm.xz -= A.xy * (A.z * a * c);
            nrm.y -= B.y * A.z * a * s;
            jac -= B.y * A.z * a * s;
            crest += a * s;
          }
          // Surf: crest lines parallel to the coast, running in and rising
          // as the water shoals, then spilling into foam at the rocks.
          float env = smoothstep(18.0, 6.0, shoreD) * smoothstep(-0.2, 1.4, shoreD) * inside;
          float ph = shoreD * 0.62 + uTime * 1.05;
          float sw = 0.5 + 0.5 * sin(ph);
          float shape = sw * sw * sw;
          float amp = 0.5 * env * smoothstep(20.0, 4.0, shoreD);
          p.y += (shape - 0.3) * amp;
          // slope of the surf along the shore-distance gradient
          float e = 0.7;
          float gx = shoreAt(g + vec2(e, 0.0)).g - shoreAt(g - vec2(e, 0.0)).g;
          float gz = shoreAt(g + vec2(0.0, e)).g - shoreAt(g - vec2(0.0, e)).g;
          vec2 grad = vec2(gx, gz) / (2.0 * e);
          float dsh = 3.0 * sw * sw * 0.5 * cos(ph) * 0.62 * amp;
          nrm.xz -= grad * dsh;
          if (position.y > 0.5) {
            // horizon skirt
            p = vec3(g.x, uHeadY - 0.03, g.y);
            nrm = vec3(0.0, 1.0, 0.0);
          }
          vL = p;
          vec4 wp = modelMatrix * vec4(p.x - uOff.x, p.y, p.z - uOff.y, 1.0);
          vW = wp.xyz;
          vN = uLocalRot * normalize(nrm);
          vWave = vec4(crest, jac, shape * env, env);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        ${SHORE_GLSL}
        ${SKY_REFLECT}
        uniform sampler2D uOcean;
        uniform vec3 uDeep;
        uniform vec3 uSSS;
        uniform vec3 uSeabed;
        varying vec3 vW;
        varying vec3 vL;
        varying vec3 vN;
        varying vec4 vWave;

        void main() {
          vec3 V = cameraPosition - vW;
          float dist = length(V);
          V /= dist;
          vec2 g = vL.xz;
          vec4 sh = shoreAt(g);
          float inside = inMap(g);
          float ground = mix(-40.0, sh.r, inside);
          float shoreD = mix(200.0, sh.g, inside);
          float sand = sh.a * inside;

          // detail normals: two scrolling layers, fading with distance
          float fade = 1.0 - smoothstep(25.0, 220.0, dist);
          vec2 s1 = texture(uOcean, g * 0.105 + vec2(0.013, -0.041) * uTime).rg * 2.0 - 1.0;
          vec2 s2 = texture(uOcean, g * 0.27 + vec2(-0.03, -0.022) * uTime).rg * 2.0 - 1.0;
          vec2 slope = (s1 * 0.19 + s2 * 0.11) * (0.35 + 0.65 * fade);
          vec3 N = normalize(normalize(vN) + uLocalRot * vec3(-slope.x, 0.0, -slope.y));
          float NdV = clamp(dot(N, V), 0.001, 1.0);
          float F = 0.02 + 0.98 * pow(clamp(1.0 - NdV, 0.0, 1.0), 5.0);

          // sky reflection (never below the horizon)
          vec3 R = reflect(-V, N);
          float ry = dot(R, uUp);
          R = normalize(R + uUp * max(0.004 - ry, 0.0));
          vec3 refl = skyLut(R);
          // the remnant's colors smeared across the water (display-relative,
          // like the sky itself), strongest on the steep near facets
          refl += nebulaReflect(R) * 0.045 * (40.0 / uExposure);

          // water body: deep color, or the seabed through shallow water
          vec3 Ldown = ambient(uUp) + uSunLight * max(dot(uSunDir, uUp), 0.0);
          vec3 body = uDeep * Ldown * 0.32;
          float wdepth = max(vL.y - ground, 0.0);
          float path = wdepth * (1.0 + 1.0 / max(NdV, 0.18));
          vec3 absorb = exp(-path * vec3(0.42, 0.075, 0.05));
          vec3 bedAlb = mix(uSeabed * 0.6, vec3(0.62, 0.55, 0.42), sand);
          vec3 bed = bedAlb * Ldown * (0.22 + 0.78 * smoothstep(0.0, 1.5, wdepth)) * (1.0 / PI);
          body = mix(body, bed, absorb);

          // light through the backlit crests of the swell
          vec3 L = uSunDir;
          float back = pow(max(dot(-V, L), 0.0), 3.0);
          float thick = smoothstep(-0.05, 0.35, vWave.x) + vWave.z * 1.5;
          vec3 sss = (uSSS * uSunLight * back * thick * 0.6 + uSSS * ambient(uUp) * thick * 0.05) * (1.0 / PI);

          vec3 col = mix(body + sss, refl, F);

          // sun glitter: Beckmann lobe widened with distance (keeps the path
          // continuous far away instead of aliasing into noise)
          vec3 H = normalize(V + L);
          float NdH = dot(N, H);
          if (NdH > 0.2 && dot(N, L) > 0.0) {
            float near = 1.0 - smoothstep(15.0, 120.0, dist);
            float m = 0.05 + 0.07 * smoothstep(20.0, 300.0, dist) + uSunRadius + 0.04 * near;
            float c2 = NdH * NdH;
            float t2 = (1.0 - c2) / c2;
            float D = exp(-t2 / (m * m)) / (PI * m * m * c2 * c2);
            float Fs = 0.02 + 0.98 * pow(clamp(1.0 - dot(V, H), 0.0, 1.0), 5.0);
            // glitter: tiny wave facets flashing the sun, so the path sparkles
            // instead of mirroring one smooth blob
            float f1 = texture(uOcean, g * 0.83 + vec2(uTime * 0.05, -uTime * 0.07)).b;
            float f2 = texture(uOcean, g * 1.61 - vec2(uTime * 0.04, uTime * 0.035)).b;
            float spark = pow(f1 * f2, 5.0) * 22.0;
            float glit = mix(1.0, 0.15 + spark, near * 0.85);
            col += uSunLight * Fs * D * 0.25 / max(NdV, 0.12) * glit;
          }

          // moon glade: a soft silver road toward the moon before sunrise
          if (uMoonOn > 0.5 && uNight > 0.01) {
            vec3 Hm = normalize(V + uMoonD);
            float nh = dot(N, Hm);
            if (nh > 0.6) {
              float mm = 0.07 + 0.05 * smoothstep(20.0, 300.0, dist);
              float c2 = nh * nh;
              float Dm = exp(-((1.0 - c2) / c2) / (mm * mm)) / (PI * mm * mm * c2 * c2);
              float lit = 0.5 + 0.5 * uMoonL.z;   // illuminated fraction
              col += vec3(0.9, 0.93, 1.0) * Dm * F * lit * uNight * (0.03 / uExposure);
            }
          }

          // foam: waterline, breaking surf, and lingering patches
          // big slow patches decide where the surf is breaking right now
          float brkN = texture(uNoise, g * 0.018 + vec2(uTime * 0.004, -uTime * 0.006)).g;
          float breaking = smoothstep(0.35, 0.65, brkN);
          float wl = 1.0 - smoothstep(0.0, 0.4, vL.y - ground);
          float surf = smoothstep(0.62, 1.0, vWave.z) * smoothstep(0.0, 5.0, 8.0 - shoreD) * (0.35 + 0.65 * breaking);
          float linger = vWave.w * smoothstep(0.45, 1.0, 1.0 - shoreD / 9.0) * 0.35 * breaking;
          float caps = smoothstep(0.45, 0.22, vWave.y) * 0.3;
          float amt = clamp(max(max(wl, surf), max(linger, caps)), 0.0, 1.0) * inside;
          vec2 fuv = g * 0.21 + (texture(uNoise, g * 0.03 + uTime * 0.01).rg - 0.5) * 0.6;
          float pat = texture(uOcean, fuv + vec2(0.0, uTime * 0.02)).b;
          float pat2 = texture(uOcean, fuv * 2.3 - vec2(uTime * 0.03, 0.0)).b;
          float cell = 1.0 - pat * 0.65 - pat2 * 0.35;
          float foam = smoothstep(1.0 - amt * 0.85, 1.0 - amt * 0.85 + 0.12, cell) * min(amt * 1.4, 1.0);
          foam = max(foam, wl * smoothstep(0.22, 0.0, vL.y - ground) * 0.9);
          vec3 foamLit = vec3(0.8) * (uSunLight * max(dot(N, L) * 0.5 + 0.5, 0.0) * 0.8 + ambient(uUp)) * (1.0 / PI);
          col = mix(col, foamLit, foam * 0.92);

          gl_FragColor = finalize(col, vW);
        }`,
    });
    this.mesh = new Mesh(oceanGeometry(160, 96, 0.8, 330, 345), this.material);
    this.mesh.name = 'surface-ocean';
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
  }

  /** Keep the grid centered under the viewer (group-local head position). */
  follow(headLocalX: number, headLocalY: number, headLocalZ: number) {
    this.mesh.position.set(headLocalX, 0, headLocalZ);
    this.off.set(headLocalX, headLocalZ);
    (this.material.uniforms.uHeadY as { value: number }).value = headLocalY;
  }
}
