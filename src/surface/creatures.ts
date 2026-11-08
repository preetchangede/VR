import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial } from '@iwsdk/core';
import { rng } from './noise';
import { COMMON } from './shaders';
import type { Shared } from './shared';
import { linear } from './terrain';

/**
 * A few great gliders riding the dawn air over the bay: manta-winged
 * silhouettes on slow circling paths, flapping now and then. Eight triangles
 * each, all animated in the vertex shader from per-creature constants; their
 * membranes glow when backlit and their wingtips shimmer before sunrise.
 */
export function createCreatures(shared: Shared, lifeColor: Color, lifeAmount: number, seed: number) {
  if (lifeAmount < 0.15) return null;
  const r = rng(seed * 43 + 17);
  const count = lifeAmount > 0.6 ? 9 : 5;
  // creature-local outline (x right, y up, z forward), wing weight per vertex
  const V: [number, number, number, number][] = [
    [0, 0, 0.55, 0], // 0 nose
    [0.13, 0.02, 0.15, 0], // 1 body r
    [0, 0, -0.75, 0], // 2 tail
    [-0.13, 0.02, 0.15, 0], // 3 body l
    [0.62, 0, 0.12, 0.5], // 4 wing r mid-front
    [1.35, 0, -0.38, 1], // 5 wing r tip
    [0.5, 0, -0.3, 0.5], // 6 wing r mid-back
    [-0.62, 0, 0.12, 0.5], // 7
    [-1.35, 0, -0.38, 1], // 8
    [-0.5, 0, -0.3, 0.5], // 9
  ];
  const T = [
    [0, 1, 2], [0, 2, 3],
    [1, 4, 6], [4, 5, 6], [1, 6, 2],
    [3, 9, 7], [7, 9, 8], [3, 2, 9],
  ];
  const pos: number[] = [];
  const path: number[] = [];
  const path2: number[] = [];
  const idx: number[] = [];
  for (let c = 0; c < count; c++) {
    const az = (r() - 0.5) * 2.2; // spread across the view ahead
    const dist = 55 + r() * 85;
    const cx = Math.sin(az) * dist;
    const cz = -Math.cos(az) * dist;
    const cy = 12 + r() * 30;
    const rad = 12 + r() * 26;
    const speed = (r() < 0.5 ? -1 : 1) * (5 + r() * 5) / rad; // rad/s
    const span = 1.0 + r() * 0.8; // scale (wingspan ~2.7x)
    const base = pos.length / 3;
    for (const [x, y, z, w] of V) {
      pos.push(x, y, z);
      path.push(cx, cy, cz, rad);
      path2.push(speed, r() * Math.PI * 2 + 0 * w, span, w);
    }
    // phase must be per creature, not per vertex
    const ph = r() * Math.PI * 2;
    for (let k = 0; k < V.length; k++) path2[(base + k) * 4 + 1] = ph;
    for (const [a, b, d] of T) idx.push(base + a, base + b, base + d);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aPath', new BufferAttribute(new Float32Array(path), 4));
  geo.setAttribute('aPath2', new BufferAttribute(new Float32Array(path2), 4));
  geo.setIndex(idx);
  const glow = new Color().copy(lifeColor);
  glow.offsetHSL(0.05, 0.4, 0.02);
  const mat = new ShaderMaterial({
    uniforms: { ...shared.uniforms, uGlowCol: { value: linear(glow) } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec4 aPath;
      attribute vec4 aPath2;
      varying vec3 vW;
      varying float vWing;
      varying vec3 vN;
      void main() {
        float speed = aPath2.x;
        float th = aPath2.y + speed * uTime;
        vec3 c = aPath.xyz + vec3(cos(th) * aPath.w, sin(uTime * 0.21 + aPath2.y) * 2.0, sin(th) * aPath.w);
        vec3 fwd = normalize(vec3(-sin(th), 0.0, cos(th)) * sign(speed));
        vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
        float bank = -sign(speed) * 0.32;
        vec3 up = vec3(0.0, 1.0, 0.0) * cos(bank) + side * sin(bank);
        side = normalize(cross(fwd, up));
        // glide, with a few slow wingbeats every so often
        float beat = smoothstep(0.55, 0.9, sin(uTime * 0.37 + aPath2.y * 3.0));
        float flap = sin(uTime * 4.2 + aPath2.y) * 0.55 * beat + 0.12 * sin(uTime * 0.8 + aPath2.y);
        vec3 p = position;
        float w = aPath2.w;
        p.y += abs(p.x) * sin(flap) * w;
        p.x *= 1.0 - 0.15 * abs(sin(flap)) * w;
        p *= aPath2.z;
        vec3 lp = c + side * -p.x + up * p.y + fwd * p.z;
        vec4 wp = modelMatrix * vec4(lp, 1.0);
        vW = wp.xyz;
        vWing = w;
        vN = mat3(modelMatrix) * up;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uGlowCol;
      varying vec3 vW;
      varying float vWing;
      varying vec3 vN;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN);
        if (dot(N, V) < 0.0) N = -N;
        vec3 alb = vec3(0.05, 0.045, 0.05);
        vec3 col = alb * (ambient(N) + uSunLight * max(dot(N, uSunDir), 0.0)) * (1.0 / PI);
        // thin membranes glow when the sun is behind them
        float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
        col += vec3(1.0, 0.55, 0.3) * uSunLight * back * 0.02 * vWing;
        // wingtip shimmer before sunrise
        col += uGlowCol * smoothstep(0.7, 1.0, vWing) * uGlow * (0.4 / uExposure) * (0.6 + 0.4 * sin(uTime * 2.0 + vW.x));
        gl_FragColor = finalize(col, vW);
      }`,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'surface-creatures';
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  return mesh;
}
