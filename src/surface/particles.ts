import {
  BufferAttribute,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
} from '@iwsdk/core';
import { additive } from '../render/blend';
import { Land, SEA } from './land';
import { rng } from './noise';
import { COMMON } from './shaders';
import type { Shared } from './shared';
import { linear } from './terrain';

/**
 * GPU-only motes in one instanced draw:
 *  - pollen: glowing spores drifting around the player (bioluminescent before
 *    dawn, catching the sunlight like dust in a beam after it);
 *  - spray: bursts thrown up where the surf hits the boulders below.
 * Additive light that never touches destination alpha (render/blend.ts).
 */
export function createParticles(shared: Shared, land: Land, lifeColor: Color, lifeAmount: number, seed: number) {
  const r = rng(seed * 71 + 5);
  const nPollen = Math.round(260 + 520 * lifeAmount);
  // spray emitters: boulders at the waterline, ahead and to the sides
  const emitters: [number, number, number][] = [];
  const cands = land.rocks
    .filter((k) => k.kind === 0 && Math.hypot(k.x, k.z) > 3.5 && Math.hypot(k.x, k.z) < 24)
    .map((k) => ({ k, d: Math.abs(land.height(k.x, k.z) - SEA) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 10);
  for (const { k } of cands) {
    // the seaward face of the rock (away from the player)
    const len = Math.hypot(k.x, k.z) || 1;
    emitters.push([k.x + (k.x / len) * k.sx * 0.5, SEA + 0.1, k.z + (k.z / len) * k.sz * 0.5]);
  }
  const perEmitter = 34;
  const nSpray = emitters.length * perEmitter;
  const N = nPollen + nSpray;
  const seedA = new Float32Array(N * 4);
  const dataA = new Float32Array(N * 4);
  for (let i = 0; i < nPollen; i++) {
    const rad = 1.2 + Math.pow(r(), 1.3) * 22;
    const az = r() * Math.PI * 2;
    const x = Math.sin(az) * rad;
    const z = -Math.cos(az) * rad;
    const g = Math.max(land.height(x, z), SEA + 0.2);
    seedA.set([r(), r(), r(), r()], i * 4);
    dataA.set([0, x, z, g + 0.25 + Math.pow(r(), 1.5) * 4.5], i * 4);
  }
  for (let e = 0; e < emitters.length; e++) {
    const [x, y, z] = emitters[e];
    const ph = r();
    const period = 5 + r() * 2.5;
    for (let j = 0; j < perEmitter; j++) {
      const i = nPollen + e * perEmitter + j;
      seedA.set([period, ph + (r() - 0.5) * 0.05, r(), r()], i * 4);
      dataA.set([1, x + (r() - 0.5) * 1.2, z + (r() - 0.5) * 1.2, y], i * 4);
    }
  }
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seedA, 4));
  geo.setAttribute('aData', new InstancedBufferAttribute(dataA, 4));
  geo.instanceCount = N;

  const glow = new Color().copy(lifeColor);
  glow.offsetHSL(0, 0.4, 0.02);
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared.uniforms,
      uGlowCol: { value: linear(glow) },
      uLifeAmt: { value: lifeAmount },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uUp;
      uniform float uSeaY;
      attribute vec4 aSeed;
      attribute vec4 aData;
      varying vec2 vC;
      varying float vKind;
      varying float vA;
      varying vec3 vW;
      varying float vSeed;
      void main() {
        vec3 c;
        float size;
        float a = 1.0;
        if (aData.x < 0.5) {
          // pollen: lazy orbits plus a slow drift on the breeze, wrapping around
          float t = uTime * (0.08 + 0.07 * aSeed.x);
          vec3 home = vec3(aData.y, aData.w, aData.z);
          c = home + vec3(sin(t * 1.3 + aSeed.y * 6.28) * 1.4, sin(t * 0.8 + aSeed.z * 6.28) * 0.45, cos(t * 1.1 + aSeed.w * 6.28) * 1.4);
          float drift = fract(uTime * 0.012 * (0.5 + aSeed.y) + aSeed.z);
          c.xz += vec2(0.45, 0.9) * (drift - 0.5) * 6.0;
          a = smoothstep(0.0, 0.15, drift) * (1.0 - smoothstep(0.85, 1.0, drift));
          size = 0.01 + 0.018 * aSeed.x * aSeed.x;
        } else {
          // spray: ballistic bursts on the surf's rhythm
          float period = aSeed.x;
          float ph = fract(uTime / period + aSeed.y);
          float age = ph * period;
          float life = 1.1 + 0.9 * aSeed.z;
          float k = clamp(age / life, 0.0, 1.0);
          vec3 v0 = vec3((aSeed.z - 0.5) * 2.2, 1.6 + aSeed.w * 3.4, (aSeed.w - 0.5) * 2.2);
          float tt = min(age, life);
          c = vec3(aData.y, aData.w, aData.z) + v0 * tt + vec3(0.0, -4.0, 0.0) * tt * tt;
          a = (1.0 - k) * smoothstep(0.0, 0.06, k) * step(age, life);
          size = 0.05 + 0.22 * k * (0.5 + aSeed.z);
        }
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec4 wc = modelMatrix * vec4(c, 1.0);
        vec3 wp = wc.xyz + (right * position.x + up * position.y) * size;
        vC = position.xy;
        vKind = aData.x;
        vA = a;
        vW = wc.xyz;
        vSeed = aSeed.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uGlowCol;
      uniform float uLifeAmt;
      varying vec2 vC;
      varying float vKind;
      varying float vA;
      varying vec3 vW;
      varying float vSeed;
      void main() {
        float r2 = dot(vC, vC);
        if (r2 > 1.0) discard;
        vec3 V = normalize(cameraPosition - vW);
        float fwd = pow(max(dot(-V, uSunDir), 0.0), 6.0);
        vec3 col;
        float shape;
        if (vKind < 0.5) {
          shape = exp(-r2 * 4.0) + exp(-r2 * 18.0) * 0.6;
          float tw = 0.6 + 0.4 * sin(uTime * (1.5 + vSeed * 3.0) + vSeed * 40.0);
          // bioluminescent before dawn; sunlit glints after
          col = uGlowCol * uGlow * tw * (0.5 / uExposure) * uLifeAmt;
          col += uSunLight * (0.008 + 0.12 * fwd) * (1.0 - uGlow * 0.7);
        } else {
          shape = exp(-r2 * 2.5);
          col = (uSunLight * (0.03 + 0.6 * fwd) + ambient(uUp) * 0.12) * 0.5;
        }
        float d = length(vW - cameraPosition);
        float fogFade = exp(-d * 0.012);
        vec3 c = tonemap(col) * shape * vA * fogFade * uFade;
        gl_FragColor = vec4(c, 0.0);
      }`,
  });
  additive(mat);
  const mesh = new Mesh(geo, mat);
  mesh.name = 'surface-particles';
  mesh.renderOrder = 30;
  mesh.frustumCulled = false;
  return mesh;
}
