import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  RGBAFormat,
  ShaderMaterial,
} from '@iwsdk/core';
import { toHalfArray } from './half';
import { Land, MAP_RES, MAP_SIZE, Rock, SEA } from './land';
import { Noise, rng, smoothstep } from './noise';
import { COMMON } from './shaders';
import type { Shared } from './shared';

/** Shore data texture: r = ground height, g = distance from land across water,
 *  b = horizon angle toward the sun, a = sand amount. */
export function makeShoreTexture(land: Land): DataTexture {
  const N = MAP_RES;
  const f = new Float32Array(N * N * 4);
  const cell = MAP_SIZE / N;
  for (let iz = 0; iz < N; iz++) {
    const z = (iz + 0.5) * cell - MAP_SIZE / 2;
    for (let ix = 0; ix < N; ix++) {
      const x = (ix + 0.5) * cell - MAP_SIZE / 2;
      const i = iz * N + ix;
      f[i * 4] = land.grid[i];
      f[i * 4 + 1] = land.dist[i];
      f[i * 4 + 2] = land.horizon[i];
      f[i * 4 + 3] = land.sandAt(x, z);
    }
  }
  const data = toHalfArray(f);
  const tex = new DataTexture(data, N, N, RGBAFormat, HalfFloatType);
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Geometry

class Builder {
  pos: number[] = [];
  aux: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  vert(x: number, y: number, z: number, ao: number, kind: number, sand: number) {
    this.pos.push(x, y, z);
    this.aux.push(ao, kind, sand);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
}

/** Indexed icosphere (unit radius). */
function icosphere(level: number) {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  });
  let f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const cache = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 100000 + b : b * 100000 + a;
      const c = cache.get(key);
      if (c !== undefined) return c;
      const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
      const len = Math.hypot(p[0], p[1], p[2]);
      v.push([p[0] / len, p[1] / len, p[2] / len]);
      cache.set(key, v.length - 1);
      return v.length - 1;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    f = nf;
  }
  return { v, f };
}

const ICO2 = icosphere(2);
const ICO3 = icosphere(3);

function addRock(b: Builder, n: Noise, k: Rock, detail: 2 | 3) {
  const ico = detail === 3 ? ICO3 : ICO2;
  const base = b.count;
  const s = (k.seed % 997) * 0.37;
  const c = Math.cos(k.rot);
  const si = Math.sin(k.rot);
  for (const p of ico.v) {
    let [x, y, z] = p;
    let r = 1 + (n.fbm3(x * 1.2 + s, y * 1.2 - s, z * 1.2 + s * 0.5, 3) - 0.5) * (k.kind === 2 ? 0.9 : 0.62);
    r += (n.fbm3(x * 3.7 - s, y * 3.7 + 2.1, z * 3.7 + s, 2) - 0.5) * 0.2;
    // sedimentary ledges
    r += Math.sin(y * (k.kind === 1 ? 13 : 7) + n.v3(x * 2 + s, y * 2, z * 2) * 5) * 0.035;
    if (k.kind === 1) {
      // sea stack: basalt-like vertical ribs, wider base, flat-ish crown
      r += Math.sin(Math.atan2(z, x) * 11 + n.v3(x * 1.5, y * 0.6 + s, z * 1.5) * 4) * 0.045;
      const wide = 1 + 0.35 * Math.pow((1 - y) / 2, 2);
      x *= wide;
      z *= wide;
      if (y > 0.55) y = 0.55 + (y - 0.55) * 0.35;
    } else if (y < -0.25) {
      y = -0.25 + (y + 0.25) * 0.45; // flattened base, settles into the ground
    }
    const ao = Math.min(1, Math.max(0.25, 0.62 + (r - 1) * 1.6)) * (0.55 + 0.45 * smoothstep(-0.5, 0.5, p[1]));
    const lx = x * r * k.sx;
    const ly = y * r * k.sy;
    const lz = z * r * k.sz;
    const wx = k.x + lx * c - lz * si;
    const wz = k.z + lx * si + lz * c;
    const wy = k.y + ly;
    b.vert(wx, wy, wz, ao, k.kind === 1 ? 2 : 1, 0);
  }
  for (const [a, bb, cc] of ico.f) b.tri(base + a, base + bb, base + cc);
}

/** A distant island: radial cone with ridges, sunk into the sea. */
function addIsland(b: Builder, n: Noise, az: number, dist: number, R: number, H: number, elong: number, seed: number) {
  const cx = Math.sin(az) * dist;
  const cz = -Math.cos(az) * dist;
  const tx = Math.cos(az); // tangent (along the horizon)
  const tz = Math.sin(az);
  const NA = 28;
  const NRg = 6;
  const base = b.count;
  const top = b.vert(cx, SEA + H, cz, 1, 3, 0);
  for (let i = 1; i <= NRg; i++) {
    const f = i / NRg;
    for (let a = 0; a < NA; a++) {
      const th = (a / NA) * Math.PI * 2;
      const u = Math.cos(th);
      const v = Math.sin(th);
      const ridge = n.fbm(u * 2 + seed, v * 2 - seed, 3, 256, 7);
      const rr = R * f * (0.75 + 0.5 * ridge);
      // u runs along the horizon (tangent), v away from the player (radial)
      const px = cx + tx * u * rr * elong + Math.sin(az) * v * rr * 0.6;
      const pz = cz + tz * u * rr * elong - Math.cos(az) * v * rr * 0.6;
      let h = H * Math.pow(1 - Math.pow(f, 1.25), 1.15) * (0.75 + 0.5 * n.fbm(u * 3 - seed, v * 3 + f * 2, 3, 256, 9));
      if (i === NRg) h = -6;
      // cliff faces toward the open sea
      h += (n.ridged(u * 4 + seed, v * 4, 2, 21) - 0.4) * H * 0.18 * (1 - f);
      b.vert(px, SEA + h, pz, 0.8, 3, 0);
    }
  }
  for (let a = 0; a < NA; a++) {
    const a1 = (a + 1) % NA;
    b.tri(top, base + 1 + a, base + 1 + a1);
  }
  for (let i = 1; i < NRg; i++) {
    const r0 = base + 1 + (i - 1) * NA;
    const r1 = base + 1 + i * NA;
    for (let a = 0; a < NA; a++) {
      const a1 = (a + 1) % NA;
      b.tri(r0 + a, r1 + a1, r0 + a1);
      b.tri(r0 + a, r1 + a, r1 + a1);
    }
  }
}

/** Everything solid: terrain, rocks, sea stacks and far islands, merged. */
export function buildLandGeometry(land: Land, seed: number): BufferGeometry {
  const b = new Builder();
  const n = land.noise;
  // Terrain: polar grid around the player, dense near, sparse far.
  const NA = 128;
  const NR = 64;
  const R0 = 0.22;
  const R1 = 130;
  const q = Math.pow(R1 / R0, 1 / (NR - 1));
  const center = b.vert(0, land.height(0, 0), 0, 1, 0, 0);
  const ringStart = b.count;
  const keep: boolean[] = [];
  for (let i = 0; i < NR; i++) {
    const r = R0 * Math.pow(q, i);
    for (let a = 0; a < NA; a++) {
      // stagger alternate rings to avoid radial streaks
      const th = ((a + (i & 1) * 0.5) / NA) * Math.PI * 2;
      const x = Math.sin(th) * r;
      const z = -Math.cos(th) * r;
      const h = land.height(x, z);
      const g = land.sample(land.grid, x, z);
      // ambient occlusion from local concavity (map vs. neighborhood)
      const nb =
        (land.sample(land.grid, x + 2.2, z) + land.sample(land.grid, x - 2.2, z) +
          land.sample(land.grid, x, z + 2.2) + land.sample(land.grid, x, z - 2.2)) * 0.25;
      const ao = Math.min(1, Math.max(0.35, 1 - (Math.max(nb, g) - h) * 0.35));
      b.vert(x, h, z, ao, 0, land.sandAt(x, z));
      keep.push(h > SEA - 3.2);
    }
  }
  const at = (i: number, a: number) => ringStart + i * NA + (((a % NA) + NA) % NA);
  const ok = (...v: number[]) => v.some((k) => keep[k - ringStart] !== false);
  for (let a = 0; a < NA; a++) b.tri(center, at(0, a + 1), at(0, a));
  for (let i = 0; i < NR - 1; i++) {
    for (let a = 0; a < NA; a++) {
      // stagger-aware diagonal
      const a0 = at(i, a);
      const a1 = at(i, a + 1);
      const b0 = at(i + 1, a + (i & 1));
      const b1 = at(i + 1, a + 1 + (i & 1));
      if (ok(a0, a1, b0)) b.tri(a0, a1, b0);
      if (ok(a1, b1, b0)) b.tri(a1, b1, b0);
    }
  }
  // Rocks: close ones get more detail.
  for (const k of land.rocks) {
    const d = Math.hypot(k.x, k.z);
    addRock(b, n, k, k.kind === 1 || d < 4.5 ? 3 : 2);
  }
  // Far islands give the sea its scale.
  const r = rng(seed * 13 + 77);
  const D = Math.PI / 180;
  // [azimuth°, distance, radius, height, elongation]; every point stays
  // inside the 352 m sky dome (max ~320 m from the player)
  const isl: [number, number, number, number, number][] = [
    [-38, 240, 58, 40, 1.6],
    [-25, 290, 24, 13, 1.4],
    [17, 280, 38, 20, 1.7],
    [41, 205, 30, 27, 1.3],
    [68, 280, 48, 17, 1.9],
    [-68, 190, 26, 11, 1.5],
  ];
  for (const [az, dist, R, H, el] of isl) {
    addIsland(b, n, (az + (r() - 0.5) * 6) * D, dist + (r() - 0.5) * 16, R * (0.85 + r() * 0.2), H * (0.8 + r() * 0.4), el, r() * 50);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
  geo.setAttribute('aux', new BufferAttribute(new Float32Array(b.aux), 3));
  const big = b.count > 65535;
  geo.setIndex(new BufferAttribute(big ? new Uint32Array(b.idx) : new Uint16Array(b.idx), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// Material

export const SHORE_GLSL = /* glsl */ `
uniform sampler2D uShore;
uniform float uSeaLocal;
vec4 shoreAt(vec2 localXZ) {
  return texture(uShore, localXZ * ${(1 / MAP_SIZE).toFixed(8)} + 0.5);
}
float inMap(vec2 localXZ) {
  vec2 a = abs(localXZ) * ${(2 / MAP_SIZE).toFixed(8)};
  return 1.0 - smoothstep(0.9, 1.0, max(a.x, a.y));
}
/** Soft terrain shadow from the baked horizon angle. */
float sunVisibility(vec2 localXZ, float sunElev) {
  float hz = shoreAt(localXZ).b;
  float v = smoothstep(hz - 0.05, hz + 0.06, sunElev);
  return mix(1.0, v, inMap(localXZ));
}
`;

export function linear(c: Color) {
  return new Color().copy(c).convertSRGBToLinear();
}

export function createRockMaterial(shared: Shared, shore: DataTexture, landColor: Color, lifeColor: Color, lifeAmount: number) {
  const life = linear(lifeColor);
  const glow = new Color().copy(lifeColor);
  // bioluminescence: a brighter, more saturated cousin of the life tint
  glow.offsetHSL(0, 0.4, 0.0);
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared.uniforms,
      uShore: { value: shore },
      uSeaLocal: { value: SEA },
      uLand: { value: linear(landColor) },
      uLife: { value: life },
      uLifeGlow: { value: linear(glow) },
      uLifeAmt: { value: lifeAmount },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aux;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vL;
      varying vec3 vAux;
      void main() {
        vL = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = mat3(modelMatrix) * normal;
        vAux = aux;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SHORE_GLSL}
      uniform vec3 uLand;
      uniform vec3 uLife;
      uniform vec3 uLifeGlow;
      uniform float uLifeAmt;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vL;
      varying vec3 vAux;

      void main() {
        // texture/bump work happens in group-local space (stable if the group
        // is rotated); lighting in world space
        vec3 Nl = normalize(vN) * uLocalRot;
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        float kind = vAux.y;
        float far = smoothstep(60.0, 140.0, dist);

        // triplanar noise at three scales; the fine one only up close
        vec3 an = abs(Nl);
        an *= an * an;
        an /= an.x + an.y + an.z;
        vec4 n1 = texture(uNoise, vL.zy * 0.09) * an.x + texture(uNoise, vL.xz * 0.09) * an.y + texture(uNoise, vL.xy * 0.09) * an.z;
        vec4 n2 = vec4(0.5);
        vec4 n3 = vec4(0.5);
        if (far < 0.99) {
          n2 = texture(uNoise, vL.zy * 0.43 + 0.3) * an.x + texture(uNoise, vL.xz * 0.43 + 0.3) * an.y + texture(uNoise, vL.xy * 0.43 + 0.3) * an.z;
          n2 = mix(n2, vec4(0.5), far);
          float nearF = 1.0 - smoothstep(4.0, 14.0, dist);
          if (nearF > 0.0) {
            n3 = texture(uNoise, vL.zy * 2.3 + 0.7) * an.x + texture(uNoise, vL.xz * 2.3 + 0.7) * an.y + texture(uNoise, vL.xy * 2.3 + 0.7) * an.z;
            n3 = mix(vec4(0.5), n3, nearF);
          }
        }
        // crevices: thin dark lines where the mid noise crosses 0.5 (ridged)
        float crack = 1.0 - smoothstep(0.0, 0.06 + 0.1 * far, abs(n2.r - 0.5)) * (1.0 - far);
        float crackFine = 1.0 - smoothstep(0.0, 0.05, abs(n3.g - 0.5));
        // bump from mid + fine noise
        vec3 bump = (n2.rgb - 0.5) * 0.5 * (1.0 - far) + (n3.rgb - 0.5) * 0.6;
        Nl = normalize(Nl + bump - Nl * dot(bump, Nl));
        vec3 N = uLocalRot * Nl;

        float hAbove = vL.y - uSeaLocal;
        float up = dot(N, uUp);
        vec3 alb = uLand * (0.62 + 0.55 * n1.r) * (0.85 + 0.3 * n2.g) * (0.9 + 0.2 * n3.b);
        // sedimentary banding
        alb *= 0.88 + 0.12 * sin(vL.y * 2.7 + n1.g * 5.0);
        // ochre/iron streaks
        alb = mix(alb, alb * vec3(1.3, 0.95, 0.72), smoothstep(0.58, 0.8, n1.b) * 0.55);
        alb *= 1.0 - 0.55 * crack * smoothstep(0.35, 0.65, n1.a);
        alb *= 1.0 - 0.35 * crackFine * smoothstep(0.4, 0.6, n2.a);
        // pale crusty lichen on exposed tops (coastal rocks wear it like frost)
        float lichen = smoothstep(0.8, 0.9, n3.a + n2.b * 0.25) * smoothstep(0.3, 0.8, up) * smoothstep(0.8, 1.8, hAbove);
        alb = mix(alb, alb * 1.6 + vec3(0.05, 0.05, 0.03), lichen * 0.45);
        // beach sand (terrain only)
        float sand = vAux.z * smoothstep(0.35, 0.8, up);
        vec3 sandCol = mix(uLand, vec3(0.5, 0.42, 0.31), 0.6) * (0.85 + 0.25 * n2.r) * (0.92 + 0.16 * n3.r);
        alb = mix(alb, sandCol, sand);
        // moss / living carpet on gentle slopes above the splash zone
        float mossMask = smoothstep(0.62, 0.9, up + (n1.b - 0.5) * 0.6) * smoothstep(0.8, 2.0, hAbove + n2.a);
        float moss = mossMask * uLifeAmt * (1.0 - sand) * (kind < 0.5 ? 0.9 : 0.55);
        vec3 lifeMuted = mix(vec3(luma(uLife)), uLife, 0.5);
        vec3 mossCol = lifeMuted * (0.07 + 0.07 * n2.b) * (0.8 + 0.4 * n3.g) + uLand * 0.18;
        alb = mix(alb, mossCol, moss);
        // splash zone: wet, darker, barnacle-black near the waterline
        float wet = (1.0 - smoothstep(0.0, 0.9 + 0.5 * n1.a, hAbove)) * (1.0 - far);
        alb *= 1.0 - 0.55 * wet;
        alb *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.35, hAbove)) * smoothstep(0.45, 0.6, n3.b);
        float ao = vAux.x * (0.75 + 0.25 * (1.0 - crack));

        float sunElev = asin(clamp(dot(uSunDir, uUp), -1.0, 1.0));
        float vis = kind < 0.5 ? sunVisibility(vL.xz, sunElev) : mix(sunVisibility(vL.xz, sunElev), 1.0, 0.35);
        float ndl = dot(N, uSunDir);
        float diff = max(ndl, 0.0);
        // moss is soft and slightly translucent: wrap the light
        diff = mix(diff, max((ndl + 0.4) / 1.4, 0.0), moss);
        vec3 col = alb * (uSunLight * diff * vis + ambient(N) * ao * (1.0 + 0.35 * (1.0 - vis))) * (1.0 / PI);
        // wet sheen reflects the sky
        vec3 R = reflect(-V, N);
        float F = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        col += wet * F * skyLutSoft(R) * 0.8;
        // backlit rim: low sun behind rocks outlines them in gold
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * smoothstep(0.2, 1.0, dot(-V, uSunDir));
        col += rim * uSunLight * vis * (alb * 1.6 + 0.04) * (1.0 - far * 0.7) * (1.0 / PI);
        // silhouettes pick up the bright sky behind them (sheen + haze at the edge)
        col += pow(1.0 - max(dot(N, V), 0.0), 4.0) * skyLutSoft(-V) * 0.18;
        // bioluminescent lichen speckles, brightest in twilight
        if (uGlow > 0.01 && far < 0.5) {
          vec4 n4 = texture(uNoise, vL.xz * 1.7 + vL.y * 0.9);
          float spots = smoothstep(0.9, 0.95, n4.a) * smoothstep(0.6, 0.85, n1.b + moss * 0.3) * (kind > 0.5 ? 1.0 : 0.45) *
                        smoothstep(1.8, 4.5, length(vL.xz));
          // display-relative so the glow reads the same at any exposure
          col += uLifeGlow * spots * uLifeAmt * uGlow * (0.3 / uExposure) *
                 (0.7 + 0.3 * sin(uTime * 1.3 + n1.r * 20.0));
        }
        gl_FragColor = finalize(col, vW);
      }`,
  });
  return mat;
}

export function createLandMesh(geo: BufferGeometry, mat: ShaderMaterial) {
  const mesh = new Mesh(geo, mat);
  mesh.name = 'surface-land';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
