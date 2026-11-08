import { Noise, rng, smoothstep } from './noise';

/**
 * The shore the player wakes up on (dependency-free generator).
 *
 * Group-local frame: origin = ground under the seated player, -Z = toward
 * the sunrise. The player sits on a low rock outcrop jutting into the sea;
 * the island rises behind them to a grassy crest, a rocky headland reaches
 * out on the left, a sand cove and tall cliffs open on the right, and sea
 * stacks and islets stand in the water ahead.
 *
 * Besides the analytic height function, the generator bakes a 256² map over
 * 160 m (ground height incl. rocks, distance from land across the water, and
 * the terrain's horizon angle toward the sun for soft shadows) that the
 * ocean, rock and plant shaders sample.
 */

export const SEA = -2.4;
export const MAP_SIZE = 160;
export const MAP_RES = 256;
/** Sun azimuth used for baked shadows (the sun drifts -15°..-8°). */
export const SHADOW_AZ = (-11.5 * Math.PI) / 180;

interface Blob {
  x: number;
  z: number;
  rx: number;
  rz: number;
  c: number;
  s: number;
  top: number;
  k: number;
  slope: number;
  sand: number;
}

export interface Rock {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rot: number;
  kind: 0 | 1 | 2; // 0 boulder, 1 sea stack, 2 islet
  seed: number;
}

function blob(x: number, z: number, rx: number, rz: number, rot: number, top: number, k: number, slope: number, sand = 0): Blob {
  return { x, z, rx, rz, c: Math.cos(rot), s: Math.sin(rot), top, k, slope, sand };
}

function smax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

export class Land {
  readonly noise: Noise;
  readonly blobs: Blob[];
  readonly rocks: Rock[] = [];
  /** Ground height including rocks (m), MAP_RES², row-major z then x. */
  readonly grid = new Float32Array(MAP_RES * MAP_RES);
  /** Distance from land across water (m); 0 on land. */
  readonly dist = new Float32Array(MAP_RES * MAP_RES);
  /** Terrain horizon angle toward the sun (rad). */
  readonly horizon = new Float32Array(MAP_RES * MAP_RES);
  private seatCorr = 0;
  private readonly sandBlob: Blob;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.noise = new Noise(seed + 101);
    const r = rng(seed * 17 + 3);
    const j = (a: number) => (r() - 0.5) * 2 * a;
    this.sandBlob = blob(25 + j(3), 3 + j(2), 17, 9, 0.15, -1.5, 1.25, 0.07, 1);
    this.blobs = [
      // the island body rising behind the player to a crest ~18 m high
      blob(j(6), 58 + j(4), 96, 60, j(0.08), 18 + j(3), 1.4, 0.25),
      // the low rock outcrop the player sits on
      blob(0.3, -1.6, 5.2, 5.8, 0.1, 0.25, 1.7, 1.1),
      // saddle tying the outcrop to the island
      blob(0, 5, 8, 8, 0, -0.6, 2, 0.6),
      // rocky headland reaching out front-left
      blob(-25 + j(2), -13 + j(3), 7.5, 21, -0.5 + j(0.1), 6.5 + j(1.5), 1.9, 0.65),
      // smaller rib between outcrop and headland
      blob(-11, -3, 4.5, 6, -0.3, 1.0, 2.2, 0.8),
      // sand cove on the right
      this.sandBlob,
      // the right headland's base (its cliffs are columnar rock formations)
      blob(60 + j(4), -14 + j(4), 17, 30, 0.35 + j(0.1), 7 + j(2), 1.6, 0.9),
    ];
    this.seatCorr = -this.raw(0, 0);
    this.placeRocks(r);
    this.bakeMaps();
  }

  /** Sand amount at a point (beach cove), 0..1. */
  sandAt(x: number, z: number) {
    const b = this.sandBlob;
    const dx = x - b.x;
    const dz = z - b.z;
    const lx = (dx * b.c + dz * b.s) / (b.rx * 1.15);
    const lz = (-dx * b.s + dz * b.c) / (b.rz * 1.25);
    return 1 - smoothstep(0.55, 1.0, Math.sqrt(lx * lx + lz * lz));
  }

  private raw(x: number, z: number) {
    let h = -40;
    for (const b of this.blobs) {
      const dx = x - b.x;
      const dz = z - b.z;
      const lx = (dx * b.c + dz * b.s) / b.rx;
      const lz = (-dx * b.s + dz * b.c) / b.rz;
      const d = Math.sqrt(lx * lx + lz * lz);
      const hb = d < 1 ? SEA + (b.top - SEA) * (1 - Math.pow(d, b.k)) : SEA - (d - 1) * b.slope * Math.min(b.rx, b.rz);
      h = smax(h, hb, 2.2);
    }
    const n = this.noise;
    h += (n.fbm(x * 0.03 + 11, z * 0.03 - 7, 3) - 0.5) * 5;
    const sand = this.sandAt(x, z);
    const crag = n.ridged(x * 0.15 + 3, z * 0.15 + 9, 3);
    const seatClear = smoothstep(2.0, 6.0, Math.sqrt(x * x + z * z));
    const rocky = (1 - sand) * smoothstep(SEA - 7, SEA + 1, h) * (0.3 + 0.7 * seatClear);
    h += (crag - 0.4) * 1.9 * rocky;
    h += (n.fbm(x * 0.6, z * 0.6, 3, 256, 50) - 0.5) * 0.3 * (1 - 0.8 * sand);
    return Math.max(h, -16);
  }

  /** Analytic ground height (without rocks). */
  height(x: number, z: number) {
    const r2 = x * x + z * z;
    let h = this.raw(x, z) + this.seatCorr * Math.exp(-r2 / 28);
    // the rock shelf ahead tips toward the sea so the surf below stays in view
    h -= Math.max(0, -z - 0.8) * 0.22 * Math.exp(-(x * x) / 30) * Math.exp(-r2 / 60);
    // a natural, slightly dished seat right under the player
    const seat = Math.exp(-r2 / 1.6);
    h = h * (1 - seat) + (0.02 - 0.05 * Math.exp(-r2 / 0.4)) * seat;
    return h;
  }

  /** Bilinear lookup in the baked map (local coords). */
  sample(map: Float32Array, x: number, z: number) {
    const fx = ((x / MAP_SIZE + 0.5) * MAP_RES) - 0.5;
    const fz = ((z / MAP_SIZE + 0.5) * MAP_RES) - 0.5;
    const x0 = Math.max(0, Math.min(MAP_RES - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(MAP_RES - 2, Math.floor(fz)));
    const ax = Math.min(1, Math.max(0, fx - x0));
    const az = Math.min(1, Math.max(0, fz - z0));
    const i = z0 * MAP_RES + x0;
    return (
      (map[i] * (1 - ax) + map[i + 1] * ax) * (1 - az) + (map[i + MAP_RES] * (1 - ax) + map[i + MAP_RES + 1] * ax) * az
    );
  }

  /** Height of rocks + ground at a point (rocks as ellipsoid caps). */
  groundWithRocks(x: number, z: number) {
    let h = this.height(x, z);
    for (const k of this.rocks) {
      const dx = x - k.x;
      const dz = z - k.z;
      const c = Math.cos(k.rot);
      const s = Math.sin(k.rot);
      const lx = (dx * c + dz * s) / k.sx;
      const lz = (-dx * s + dz * c) / k.sz;
      const q = 1 - lx * lx - lz * lz;
      if (q > 0) h = Math.max(h, k.y + k.sy * Math.sqrt(q) * 0.92);
    }
    return h;
  }

  private placeRocks(r: () => number) {
    const add = (x: number, z: number, size: number, kind: 0 | 1 | 2, sink: number, tall = 1) => {
      const g = this.height(x, z);
      const sy = size * tall * (0.55 + r() * 0.35);
      this.rocks.push({
        x,
        y: Math.max(g, kind === 1 ? -9 : g) - sink * sy,
        z,
        sx: size * (0.8 + r() * 0.5),
        sy,
        sz: size * (0.8 + r() * 0.5),
        rot: r() * Math.PI,
        kind,
        seed: Math.floor(r() * 1e6),
      });
    };
    // Surf boulders along the waterline ahead and to the sides.
    for (let i = 0; i < 16; i++) {
      const a = (-0.62 + (i / 15) * 1.24) * Math.PI + (r() - 0.5) * 0.12;
      const dx = Math.sin(a);
      const dz = -Math.cos(a);
      let d = 2;
      while (d < 30 && this.height(dx * d, dz * d) > SEA) d += 0.25;
      // keep the view ahead clear: boulders there sit out in the surf
      const ahead = Math.abs(a) < 0.7;
      const off = ahead ? 0.8 + r() * 3.5 : (r() - 0.35) * 4.5;
      const dd = Math.max(ahead ? 7 : 4, d + off);
      if (dd > 22) continue;
      const size = (0.55 + Math.pow(r(), 1.6) * 1.9 * Math.min(1, dd / 8)) * (ahead ? 0.8 : 1);
      add(dx * dd, dz * dd, size, 0, 0.35);
    }
    // A few rocks right beside the seat (presence: something to almost touch).
    add(-1.75, 0.55, 0.62, 0, 0.45);
    add(2.05, 1.1, 0.78, 0, 0.45);
    add(-0.7, 2.6, 1.05, 0, 0.45);
    add(3.6, -1.6, 0.55, 0, 0.4);
    // Islets and sea stacks in the bay.
    add(-7.5 + (r() - 0.5) * 3, -21 - r() * 4, 1.9, 2, 0.4, 1.4);
    add(-5.5 + (r() - 0.5) * 3, -23 - r() * 4, 1.2, 2, 0.4, 1.2);
    add(17 + (r() - 0.5) * 4, -17 - r() * 4, 1.6, 2, 0.4, 1.5);
    // The right headland's cliff: a crowd of tall columnar formations.
    const hx = this.blobs[6].x;
    const hz = this.blobs[6].z;
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const x = hx - 9 + t * 12 + (r() - 0.5) * 5;
      const z = hz - 22 + t * 30 + (r() - 0.5) * 6;
      const H = 16 + r() * 14 - Math.abs(t - 0.35) * 10;
      const sy = 0.75 * (H + 8);
      this.rocks.push({
        x,
        y: SEA + H - 0.71 * sy,
        z,
        sx: 5 + r() * 3,
        sy,
        sz: 5 + r() * 3,
        rot: r() * Math.PI,
        kind: 1,
        seed: Math.floor(r() * 1e6),
      });
    }
    // Sea stacks: [x, z, radius, height above the sea]
    const stacks: [number, number, number, number][] = [
      [-15, -37, 4.0, 19],
      [9, -55, 3.3, 26],
      [33, -42, 4.6, 15],
      [-44, -66, 5.5, 22],
    ];
    for (const [x0, z0, rad, H] of stacks) {
      const x = x0 + (r() - 0.5) * 6;
      const z = z0 + (r() - 0.5) * 6;
      const sy = 0.75 * (H + 8);
      this.rocks.push({
        x,
        y: SEA + H - 0.71 * sy,
        z,
        sx: rad * (0.85 + r() * 0.3),
        sy,
        sz: rad * (0.85 + r() * 0.3),
        rot: r() * Math.PI,
        kind: 1,
        seed: Math.floor(r() * 1e6),
      });
    }
  }

  private bakeMaps() {
    const N = MAP_RES;
    const cell = MAP_SIZE / N;
    const grid = this.grid;
    // Analytic terrain at half resolution (it is smooth at this scale; the
    // fine crags live in the mesh), upsampled; rocks are rasterized at full res.
    const H2 = N / 2;
    const c2 = MAP_SIZE / H2;
    const coarse = new Float32Array(H2 * H2);
    for (let iz = 0; iz < H2; iz++) {
      const z = (iz + 0.5) * c2 - MAP_SIZE / 2;
      for (let ix = 0; ix < H2; ix++) coarse[iz * H2 + ix] = this.height((ix + 0.5) * c2 - MAP_SIZE / 2, z);
    }
    for (let iz = 0; iz < N; iz++) {
      const fz = Math.min(H2 - 1.001, Math.max(0, (iz + 0.5) / 2 - 0.5));
      const z0 = Math.floor(fz);
      const az = fz - z0;
      for (let ix = 0; ix < N; ix++) {
        const fx = Math.min(H2 - 1.001, Math.max(0, (ix + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx);
        const ax = fx - x0;
        const i = z0 * H2 + x0;
        grid[iz * N + ix] =
          (coarse[i] * (1 - ax) + coarse[i + 1] * ax) * (1 - az) + (coarse[i + H2] * (1 - ax) + coarse[i + H2 + 1] * ax) * az;
      }
    }
    // rasterize rocks (ellipsoid caps)
    for (const k of this.rocks) {
      const rad = Math.max(k.sx, k.sz);
      const i0 = Math.max(0, Math.floor(((k.x - rad) / MAP_SIZE + 0.5) * N));
      const i1 = Math.min(N - 1, Math.ceil(((k.x + rad) / MAP_SIZE + 0.5) * N));
      const j0 = Math.max(0, Math.floor(((k.z - rad) / MAP_SIZE + 0.5) * N));
      const j1 = Math.min(N - 1, Math.ceil(((k.z + rad) / MAP_SIZE + 0.5) * N));
      const c = Math.cos(k.rot);
      const s = Math.sin(k.rot);
      for (let iz = j0; iz <= j1; iz++) {
        const z = (iz + 0.5) * cell - MAP_SIZE / 2;
        for (let ix = i0; ix <= i1; ix++) {
          const x = (ix + 0.5) * cell - MAP_SIZE / 2;
          const dx = x - k.x;
          const dz = z - k.z;
          const lx = (dx * c + dz * s) / k.sx;
          const lz = (-dx * s + dz * c) / k.sz;
          const q = 1 - lx * lx - lz * lz;
          if (q > 0) {
            const i = iz * N + ix;
            grid[i] = Math.max(grid[i], k.y + k.sy * Math.sqrt(q) * 0.92);
          }
        }
      }
    }
    // distance from land across the water (two-pass chamfer, in cells)
    const dist = this.dist;
    const INF = 1e6;
    for (let i = 0; i < N * N; i++) dist[i] = grid[i] > SEA - 0.15 ? 0 : INF;
    const A = 1;
    const B = Math.SQRT2;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        let d = dist[i];
        if (d === 0) continue;
        if (ix > 0) d = Math.min(d, dist[i - 1] + A);
        if (iz > 0) {
          d = Math.min(d, dist[i - N] + A);
          if (ix > 0) d = Math.min(d, dist[i - N - 1] + B);
          if (ix < N - 1) d = Math.min(d, dist[i - N + 1] + B);
        }
        dist[i] = d;
      }
    }
    for (let iz = N - 1; iz >= 0; iz--) {
      for (let ix = N - 1; ix >= 0; ix--) {
        const i = iz * N + ix;
        let d = dist[i];
        if (d === 0) continue;
        if (ix < N - 1) d = Math.min(d, dist[i + 1] + A);
        if (iz < N - 1) {
          d = Math.min(d, dist[i + N] + A);
          if (ix < N - 1) d = Math.min(d, dist[i + N + 1] + B);
          if (ix > 0) d = Math.min(d, dist[i + N - 1] + B);
        }
        dist[i] = d;
      }
    }
    for (let i = 0; i < N * N; i++) dist[i] = Math.min(dist[i] * cell, 120);

    // horizon angle toward the sun on a half-res grid, then upsample
    const H = N / 2;
    const hc = MAP_SIZE / H;
    const half = new Float32Array(H * H);
    const sdx = Math.sin(SHADOW_AZ);
    const sdz = -Math.cos(SHADOW_AZ);
    for (let iz = 0; iz < H; iz++) {
      const z = (iz + 0.5) * hc - MAP_SIZE / 2;
      for (let ix = 0; ix < H; ix++) {
        const x = (ix + 0.5) * hc - MAP_SIZE / 2;
        const h0 = Math.max(this.sample(grid, x, z), SEA);
        let best = -0.3;
        let st = 0.6;
        for (let d = 0.6; d < 130; d += st) {
          const px = x + sdx * d;
          const pz = z + sdz * d;
          if (Math.abs(px) > MAP_SIZE / 2 || Math.abs(pz) > MAP_SIZE / 2) break;
          const a = (this.sample(grid, px, pz) - h0) / d;
          if (a > best) best = a;
          st *= 1.12;
        }
        half[iz * H + ix] = Math.atan(best);
      }
    }
    const hz = this.horizon;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const fx = Math.min(H - 1.001, Math.max(0, (ix + 0.5) / 2 - 0.5));
        const fz = Math.min(H - 1.001, Math.max(0, (iz + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx);
        const z0 = Math.floor(fz);
        const ax = fx - x0;
        const az = fz - z0;
        const i = z0 * H + x0;
        hz[iz * N + ix] =
          (half[i] * (1 - ax) + half[i + 1] * ax) * (1 - az) + (half[i + H] * (1 - ax) + half[i + H + 1] * ax) * az;
      }
    }
  }
}
