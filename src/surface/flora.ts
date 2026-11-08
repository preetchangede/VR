import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, Mesh, ShaderMaterial } from '@iwsdk/core';
import { Land, SEA } from './land';
import { rng, smoothstep } from './noise';
import { COMMON } from './shaders';
import type { Shared } from './shared';
import { linear, SHORE_GLSL } from './terrain';

/**
 * Alien vegetation: four plant types merged into ONE static mesh (one draw
 * call) and swayed in the vertex shader. Each vertex knows its plant root,
 * how far along the frond it sits (sway weight) and how much it glows.
 *
 *  - rosettes of V-folded fronds that arc up and droop (the hero plants)
 *  - tall whip stalks ending in luminous pods
 *  - tufts of grass blades as ground cover
 *  - clusters of glowing pods on short stems near rocks
 *
 * The fronds are translucent: with the sun low and ahead, the plants between
 * the player and the sunrise light up from behind. Their tips glow with a
 * slow bioluminescent pulse in twilight, fading by morning.
 */

class Geo {
  pos: number[] = [];
  root: number[] = [];
  info: number[] = [];
  leaf: number[] = [];
  idx: number[] = [];
  /** across-leaf coordinate (-1..1) for the next vertices */
  across = 0;
  get n() {
    return this.pos.length / 3;
  }
  v(x: number, y: number, z: number, rx: number, ry: number, rz: number, ph: number, s: number, glow: number, type: number, shade: number) {
    this.pos.push(x, y, z);
    this.root.push(rx, ry, rz, ph);
    this.info.push(s, glow, type, shade);
    this.leaf.push(this.across);
    return this.n - 1;
  }
  t(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
}

interface Ctx {
  g: Geo;
  r: () => number;
  rx: number;
  ry: number;
  rz: number;
  ph: number;
  shade: number;
}

/** A V-folded frond: centerline arcs up then droops; width swells then tapers. */
function frond(c: Ctx, az: number, tilt: number, len: number, width: number, droop: number, segs: number, type: number, glowTip: number) {
  const { g } = c;
  let px = c.rx;
  let py = c.ry;
  let pz = c.rz;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const base = g.n;
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const ang = tilt + droop * s * s; // from vertical
    const dx = Math.sin(ang) * ca;
    const dy = Math.cos(ang);
    const dz = Math.sin(ang) * sa;
    // side vector (horizontal, perpendicular to the frond's heading)
    const sx = -sa;
    const sz = ca;
    const w = width * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * s)), 0.7);
    const fold = w * 0.55; // V-fold: midrib raised
    const glow = glowTip * smoothstep(0.55, 1.0, s);
    // up-of-the-leaf vector (perpendicular to direction and side)
    const ux = dy * sz - dz * 0;
    const uy = dz * sx - dx * sz;
    const uz = dx * 0 - dy * sx;
    g.across = -1;
    g.v(px - sx * w, py, pz - sz * w, c.rx, c.ry, c.rz, c.ph, s, glow, type, c.shade);
    g.across = 0;
    g.v(px + ux * fold, py + uy * fold, pz + uz * fold, c.rx, c.ry, c.rz, c.ph, s, glow * 1.15, type, c.shade);
    g.across = 1;
    g.v(px + sx * w, py, pz + sz * w, c.rx, c.ry, c.rz, c.ph, s, glow, type, c.shade);
    g.across = 0;
    const step = len / segs;
    px += dx * step;
    py += dy * step;
    pz += dz * step;
  }
  for (let i = 0; i < segs; i++) {
    const a = base + i * 3;
    const b = a + 3;
    g.t(a, a + 1, b + 1);
    g.t(a, b + 1, b);
    g.t(a + 1, a + 2, b + 2);
    g.t(a + 1, b + 2, b + 1);
  }
}

/** Thin blade (grass): a 2-segment strip ending in a point. */
function blade(c: Ctx, az: number, tilt: number, len: number, width: number) {
  const { g } = c;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const sx = -sa * width;
  const sz = ca * width;
  const b = g.n;
  const pts: number[][] = [];
  let px = c.rx;
  let py = c.ry;
  let pz = c.rz;
  for (let i = 0; i <= 2; i++) {
    pts.push([px, py, pz]);
    const ang = tilt + 0.5 * (i / 2) * (i / 2);
    px += Math.sin(ang) * ca * (len / 2);
    py += Math.cos(ang) * (len / 2);
    pz += Math.sin(ang) * sa * (len / 2);
  }
  pts.push([px, py, pz]);
  const glow = 0.35;
  g.across = -1;
  g.v(pts[0][0] - sx, pts[0][1], pts[0][2] - sz, c.rx, c.ry, c.rz, c.ph, 0, 0, 1, c.shade);
  g.across = 1;
  g.v(pts[0][0] + sx, pts[0][1], pts[0][2] + sz, c.rx, c.ry, c.rz, c.ph, 0, 0, 1, c.shade);
  g.across = -1;
  g.v(pts[1][0] - sx * 0.7, pts[1][1], pts[1][2] - sz * 0.7, c.rx, c.ry, c.rz, c.ph, 0.5, 0.1, 1, c.shade);
  g.across = 1;
  g.v(pts[1][0] + sx * 0.7, pts[1][1], pts[1][2] + sz * 0.7, c.rx, c.ry, c.rz, c.ph, 0.5, 0.1, 1, c.shade);
  g.across = 0;
  g.v(pts[3][0], pts[3][1], pts[3][2], c.rx, c.ry, c.rz, c.ph, 1, glow, 1, c.shade);
  g.t(b, b + 1, b + 3);
  g.t(b, b + 3, b + 2);
  g.t(b + 2, b + 3, b + 4);
}

// unit icosahedron (12 verts, 20 faces) for round-looking pods
const IT = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  [-1, IT, 0], [1, IT, 0], [-1, -IT, 0], [1, -IT, 0],
  [0, -1, IT], [0, 1, IT], [0, -1, -IT], [0, 1, -IT],
  [IT, 0, -1], [IT, 0, 1], [-IT, 0, -1], [-IT, 0, 1],
].map((p) => p.map((v) => v / Math.hypot(1, IT)));
const ICO_F = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** Glowing pod: an icosahedron shaded as a sphere (normals rebuilt in the shader). */
function pod(c: Ctx, x: number, y: number, z: number, r: number, s: number, type: number) {
  const { g } = c;
  const b = g.n;
  g.across = 9; // marks pod vertices
  for (const p of ICO_V) g.v(x + p[0] * r, y + p[1] * r * 1.15, z + p[2] * r, x, y, z, c.ph, s, 1, type, c.shade);
  g.across = 0;
  for (const f of ICO_F) g.t(b + f[0], b + f[1], b + f[2]);
}

/** Thin stalk as two crossed ribbons, with a pod at the tip. */
function stalk(c: Ctx, az: number, len: number, lean: number) {
  const segs = 6;
  const pts: number[][] = [];
  let px = c.rx;
  let py = c.ry;
  let pz = c.rz;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  for (let i = 0; i <= segs; i++) {
    pts.push([px, py, pz]);
    const s = i / segs;
    const ang = lean * s * s;
    px += Math.sin(ang) * ca * (len / segs);
    py += Math.cos(ang) * (len / segs);
    pz += Math.sin(ang) * sa * (len / segs);
  }
  const { g } = c;
  for (let k = 0; k < 2; k++) {
    const ox = k === 0 ? 1 : 0;
    const oz = k === 0 ? 0 : 1;
    const b = g.n;
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      const w = 0.018 * (1 - s * 0.55);
      const p = pts[i];
      g.across = -1;
      g.v(p[0] - ox * w, p[1], p[2] - oz * w, c.rx, c.ry, c.rz, c.ph, s, 0, 3, c.shade);
      g.across = 1;
      g.v(p[0] + ox * w, p[1], p[2] + oz * w, c.rx, c.ry, c.rz, c.ph, s, 0, 3, c.shade);
      g.across = 0;
    }
    for (let i = 0; i < segs; i++) {
      const a = b + i * 2;
      g.t(a, a + 1, a + 3);
      g.t(a, a + 3, a + 2);
    }
  }
  const tip = pts[segs];
  pod(c, tip[0], tip[1], tip[2], 0.016 + c.r() * 0.014, 1, 2);
}

export function buildFlora(land: Land, lifeAmount: number, seed: number): BufferGeometry | null {
  if (lifeAmount < 0.02) return null;
  const r = rng(seed * 101 + 9);
  const g = new Geo();
  const n = land.noise;
  // placement tests use the baked height map (cheap); only the final root
  // height comes from the analytic terrain
  const grid = land.grid;
  const slopeAt = (x: number, z: number) => {
    const e = 0.7;
    const hx = land.sample(grid, x + e, z) - land.sample(grid, x - e, z);
    const hz = land.sample(grid, x, z + e) - land.sample(grid, x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  };
  const rockNear = (x: number, z: number) => {
    for (const k of land.rocks) {
      const dx = x - k.x;
      const dz = z - k.z;
      const rr = Math.max(k.sx, k.sz) * 1.05;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  };
  /** Find a spot: polar sample around the player, biased near. */
  const spot = (rMin: number, rMax: number, tries = 12): [number, number, number] | null => {
    for (let t = 0; t < tries; t++) {
      const rad = rMin + Math.pow(r(), 1.6) * (rMax - rMin);
      const az = (r() - 0.5) * Math.PI * 2;
      const x = Math.sin(az) * rad;
      const z = -Math.cos(az) * rad;
      // keep the near view to the sea open: nothing tall right ahead
      if (rad < 7 && Math.abs(az) < 0.55) continue;
      if (land.sample(grid, x, z) < SEA + 0.7) continue;
      // patchy, lusher where the noise says so
      const lush = n.fbm(x * 0.09 + 5, z * 0.09 - 3, 3);
      if (lush < 0.62 - lifeAmount * 0.35) continue;
      if (slopeAt(x, z) > 0.75) continue;
      if (land.sandAt(x, z) > 0.4) continue;
      if (rockNear(x, z)) continue;
      const h = land.height(x, z);
      if (h < SEA + 0.7) continue;
      return [x, h - 0.03, z];
    }
    return null;
  };
  const ctx = (x: number, y: number, z: number): Ctx => ({ g, r, rx: x, ry: y, rz: z, ph: r() * 100, shade: r() });

  const L = lifeAmount;
  // Rosettes of fronds — hero plants, several right beside the player.
  const nRos = Math.round(75 * L);
  for (let i = 0; i < nRos; i++) {
    const near = i < 12;
    const p = near ? spot(0.9, 4.5, 30) : spot(2, 45);
    if (!p) continue;
    const c = ctx(p[0], p[1], p[2]);
    const leaves = 7 + Math.floor(r() * 6);
    const size = (0.5 + r() * 0.7) * (near ? 1.0 : 1.15);
    const a0 = r() * Math.PI * 2;
    const slender = r() < 0.6;
    for (let k = 0; k < leaves; k++) {
      const az = a0 + (k / leaves) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const w = slender ? 0.022 + 0.022 * size * (0.6 + r() * 0.6) : 0.04 + 0.04 * size * (0.6 + r() * 0.6);
      frond(c, az, 0.2 + r() * 0.55, size * (0.7 + r() * 0.55), w, 0.9 + r() * 1.1, 7, 0, 1);
    }
    // a luminous pod nestled in the heart of some rosettes
    if (r() < 0.45) pod(c, c.rx, c.ry + 0.05, c.rz, 0.018 + r() * 0.012, 0.8, 2);
  }
  // Whip stalks with luminous pods.
  const nWhip = Math.round(14 * L);
  for (let i = 0; i < nWhip; i++) {
    const p = spot(1.5, 26);
    if (!p) continue;
    const c = ctx(p[0], p[1], p[2]);
    const k = 3 + Math.floor(r() * 3);
    for (let j = 0; j < k; j++) stalk(c, r() * Math.PI * 2, 0.7 + r() * 1.0, 0.15 + r() * 0.45);
  }
  // Grass tufts.
  const nTuft = Math.round(330 * L);
  for (let i = 0; i < nTuft; i++) {
    const p = spot(1.1, 38);
    if (!p) continue;
    const c = ctx(p[0], p[1], p[2]);
    const k = 6 + Math.floor(r() * 6);
    const hgt = 0.14 + r() * 0.28;
    for (let j = 0; j < k; j++) {
      const ox = (r() - 0.5) * 0.12;
      const oz = (r() - 0.5) * 0.12;
      const cc = { ...c, rx: c.rx + ox, rz: c.rz + oz };
      blade(cc, r() * Math.PI * 2, 0.1 + r() * 0.45, hgt * (0.6 + r() * 0.6), 0.008 + r() * 0.01);
    }
  }
  // Pod clusters tucked against the rocks near the player.
  const nPods = Math.round(26 * L);
  for (let i = 0; i < nPods; i++) {
    const p = spot(1.0, 14, 20);
    if (!p) continue;
    const c = ctx(p[0], p[1], p[2]);
    const k = 3 + Math.floor(r() * 5);
    for (let j = 0; j < k; j++) {
      const ox = (r() - 0.5) * 0.25;
      const oz = (r() - 0.5) * 0.25;
      const h = 0.03 + r() * 0.1;
      pod(c, c.rx + ox, c.ry + h, c.rz + oz, 0.012 + r() * 0.014, 0.6, 2);
    }
  }
  if (g.n === 0) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(g.pos), 3));
  geo.setAttribute('aRoot', new BufferAttribute(new Float32Array(g.root), 4));
  geo.setAttribute('aInfo', new BufferAttribute(new Float32Array(g.info), 4));
  geo.setAttribute('aLeaf', new BufferAttribute(new Float32Array(g.leaf), 1));
  geo.setIndex(new BufferAttribute(g.n > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function createFloraMesh(shared: Shared, shore: DataTexture, geo: BufferGeometry, lifeColor: Color, landColor: Color) {
  const glow = new Color().copy(lifeColor);
  glow.offsetHSL(0.0, 0.4, -0.02);
  const tipGlow = new Color().copy(lifeColor);
  tipGlow.offsetHSL(-0.05, 0.45, 0.04);
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared.uniforms,
      uShore: { value: shore },
      uSeaLocal: { value: SEA },
      uLife: { value: linear(lifeColor) },
      uGlowA: { value: linear(glow) },
      uGlowB: { value: linear(tipGlow) },
      uLand: { value: linear(landColor) },
    },
    vertexShader: /* glsl */ `
      ${SHORE_GLSL}
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uUp;
      uniform mat3 uLocalRot;
      uniform sampler2D uNoise;
      attribute vec4 aRoot;
      attribute vec4 aInfo;
      attribute float aLeaf;
      varying vec3 vW;
      varying vec3 vN;
      varying vec4 vInfo;
      varying float vVis;
      varying float vPh;
      varying float vLeaf;
      void main() {
        vLeaf = aLeaf;
        float s = aInfo.x;
        float type = aInfo.z;
        // gusts travel across the island; each plant answers with its own phase
        float gust = texture(uNoise, aRoot.xz * 0.025 + vec2(uTime * 0.035, uTime * 0.02)).r;
        float sway = sin(uTime * 0.9 + aRoot.w + aRoot.x * 0.21) * 0.6 + sin(uTime * 2.3 + aRoot.w * 1.7) * 0.25;
        float amp = (type < 0.5 ? 0.16 : type < 1.5 ? 0.07 : 0.22) * (0.5 + gust);
        vec2 wind = normalize(vec2(0.45, 0.9));
        float bend = s * s * amp;
        vec3 p = position;
        p.xz += wind * (sway + gust * 1.2 - 0.4) * bend;
        // flutter across the wind on fronds
        p.xz += vec2(-wind.y, wind.x) * sin(uTime * 3.1 + aRoot.w * 3.0 + s * 4.0) * 0.02 * s * step(type, 0.5);
        p.y -= bend * bend * 2.0;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vW = wp.xyz;
        vN = uLocalRot * (aLeaf > 5.0 ? normalize(position - aRoot.xyz) : normal);
        vInfo = aInfo;
        vPh = aRoot.w;
        float sunElev = asin(clamp(dot(uSunDir, uUp), -1.0, 1.0));
        vVis = mix(sunVisibility(aRoot.xz, sunElev + 0.01), 1.0, 0.25);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uLife;
      uniform vec3 uGlowA;
      uniform vec3 uGlowB;
      uniform vec3 uLand;
      varying vec3 vW;
      varying vec3 vN;
      varying vec4 vInfo;
      varying float vVis;
      varying float vPh;
      varying float vLeaf;
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        float s = vInfo.x;
        float type = vInfo.z;
        float shade = vInfo.w;
        float pods = step(1.5, type) * step(type, 2.5);
        float v = vLeaf > 5.0 ? 0.0 : vLeaf;
        // leaf look: darker edges, a pale midrib, deepening toward the base
        vec3 lifeMuted = mix(vec3(luma(uLife)), uLife, 0.7);
        vec3 tint = mix(lifeMuted, lifeMuted.gbr * 0.6 + lifeMuted * 0.4, shade * 0.35);
        vec3 alb = mix(uLand * 0.35, tint * (0.16 + 0.12 * shade), smoothstep(0.0, 0.55, s));
        alb *= (1.0 - 0.3 * v * v) * (1.0 + 0.5 * exp(-v * v * 40.0) * (1.0 - pods));
        alb = mix(alb, alb * vec3(1.2, 1.1, 0.65), step(0.5, type) * step(type, 1.5) * shade * 0.6);
        // curved cross-section: tilt the normal toward the leaf edge
        float ndl = dot(N, uSunDir);
        float wrap = max((ndl + 0.35) / 1.35, 0.0);
        float trans = pow(max(dot(-V, uSunDir), 0.0), 2.5) * (0.5 + 0.5 * s);
        vec3 lit = uSunLight * vVis * (wrap * 0.85 + trans * 1.6 * (0.4 + 0.6 * abs(ndl)));
        vec3 col = alb * (lit + ambient(N) * (0.45 + 0.55 * s)) * (1.0 / PI);
        // backlit leaves glow in their own color
        col += tint * uSunLight * vVis * trans * 0.05 * s * (1.0 - pods);
        // sheen: waxy leaves catch the sky at grazing angles
        float F = pow(1.0 - abs(dot(N, V)), 4.0);
        col += skyLutSoft(reflect(-V, N)) * F * 0.25 * (1.0 - pods);
        // bioluminescence: glowing tips, edge veins and pods, with a slow
        // wave of light climbing each frond
        float wave = 0.6 + 0.4 * sin(uTime * 1.6 - s * 5.0 + vPh);
        float edge = exp(-(1.0 - abs(v)) * (1.0 - abs(v)) * 60.0) * smoothstep(0.3, 0.95, s) * step(type, 0.5);
        float tipG = vInfo.y * (smoothstep(0.82, 1.0, s) * 0.9 + edge * 0.4);
        vec3 gcol = mix(uGlowA, uGlowB, pods * 0.6 + shade * 0.3);
        // pods read as spheres: hot core facing the eye, softer limb
        float NdV = abs(dot(N, V));
        float ball = 0.35 + 0.65 * NdV * NdV;
        float g = (pods > 0.5 ? 1.8 * ball : tipG) * wave;
        // display-relative: reads the same at any exposure, fades by morning
        col += gcol * g * uGlow * (0.9 / uExposure);
        // pods stay faintly luminous in daylight: translucent berries
        col += gcol * pods * ball * (uSunLight * vVis * 0.012 + 0.002) * (1.0 - uGlow);
        gl_FragColor = finalize(col, vW);
      }`,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'surface-flora';
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}
