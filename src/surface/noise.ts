/**
 * CPU-side procedural noise for the dawn scene (dependency-free so offline
 * tools can run it under Node). Everything the GPU samples is generated from
 * this once at construction: no textures are downloaded.
 */

/** Small fast seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(a: number, b: number, v: number) {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
export class Noise {
  /** 256x256 lattice of random values in [0,1). */
  readonly t: Float32Array;

  constructor(seed: number) {
    this.t = new Float32Array(256 * 256);
    const r = rng(seed * 7919 + 13);
    for (let i = 0; i < this.t.length; i++) this.t[i] = r();
  }

  /**
   * Value noise in [0,1] with quintic interpolation. `period` (a power of two
   * up to 256) makes the lattice wrap so textures tile; `o` decorrelates
   * channels/octaves by shifting into another part of the lattice table.
   */
  v2(x: number, y: number, period = 256, o = 0): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const m = period - 1;
    const ox = (o * 37) & 255;
    const oy = (o * 91) & 255;
    const x0 = ((xi & m) + ox) & 255;
    const x1 = (((xi + 1) & m) + ox) & 255;
    const y0 = (((yi & m) + oy) & 255) << 8;
    const y1 = ((((yi + 1) & m) + oy) & 255) << 8;
    const t = this.t;
    const a = t[y0 + x0];
    const b = t[y0 + x1];
    const c = t[y1 + x0];
    const d = t[y1 + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  /** 3D value noise in [0,1] (for rock shapes). */
  v3(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fy = y - yi;
    const fz = z - zi;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const t = this.t;
    // lattice hash inlined (no per-call closure): t[(y + 57z) * 256 + (x + 13z)]
    const r0 = ((yi + zi * 57) & 255) << 8;
    const r1 = ((yi + 1 + zi * 57) & 255) << 8;
    const r2 = ((yi + (zi + 1) * 57) & 255) << 8;
    const r3 = ((yi + 1 + (zi + 1) * 57) & 255) << 8;
    const x0 = xi + zi * 13;
    const x1 = xi + (zi + 1) * 13;
    const a0 = t[r0 | (x0 & 255)];
    const b0 = t[r0 | ((x0 + 1) & 255)];
    const c0 = t[r1 | (x0 & 255)];
    const d0 = t[r1 | ((x0 + 1) & 255)];
    const a1 = t[r2 | (x1 & 255)];
    const b1 = t[r2 | ((x1 + 1) & 255)];
    const c1 = t[r3 | (x1 & 255)];
    const d1 = t[r3 | ((x1 + 1) & 255)];
    const l0 = a0 + (b0 - a0) * ux + (c0 - a0) * uy + (a0 - b0 - c0 + d0) * ux * uy;
    const l1 = a1 + (b1 - a1) * ux + (c1 - a1) * uy + (a1 - b1 - c1 + d1) * ux * uy;
    return l0 + (l1 - l0) * uz;
  }

  fbm3(x: number, y: number, z: number, octaves = 3): number {
    let s = 0;
    let a = 0.5;
    let n = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * this.v3(x, y, z);
      n += a;
      x = x * 2.03 + 1.7;
      y = y * 2.03 - 3.1;
      z = z * 2.03 + 0.9;
      a *= 0.5;
    }
    return s / n;
  }

  /** Fractal sum, normalized to roughly [0,1]. */
  fbm(x: number, y: number, octaves = 4, period = 256, o = 0): number {
    let s = 0;
    let a = 0.5;
    let n = 0;
    let p = period;
    for (let i = 0; i < octaves; i++) {
      s += a * this.v2(x, y, p, o + i * 3);
      n += a;
      x *= 2;
      y *= 2;
      p = Math.min(256, p * 2);
      a *= 0.5;
    }
    return s / n;
  }

  /** Ridged fractal (sharp crests), roughly [0,1]. */
  ridged(x: number, y: number, octaves = 4, o = 0): number {
    let s = 0;
    let a = 0.5;
    let n = 0;
    for (let i = 0; i < octaves; i++) {
      const v = 1 - Math.abs(this.v2(x, y, 256, o + i * 5) * 2 - 1);
      s += a * v * v;
      n += a;
      x = x * 2.03 + 3.1;
      y = y * 2.03 - 1.7;
      a *= 0.5;
    }
    return s / n;
  }
}


/**
 * Tileable fbm image (N x N, N a power of two) by separable lattice
 * interpolation: per texel and octave just 4 lookups + 3 lerps, ~10x faster
 * than calling v2() per sample. Returns values roughly in [0,1].
 */
export function periodicFbm(noise: Noise, N: number, period: number, octaves: number, o: number) {
  const out = new Float32Array(N * N);
  const t = noise.t;
  const i0 = new Int32Array(N);
  const i1 = new Int32Array(N);
  const w = new Float32Array(N);
  let amp = 0.5;
  let norm = 0;
  let P = period;
  for (let k = 0; k < octaves; k++) {
    const oo = o + k * 3;
    const ox = (oo * 37) & 255;
    const oy = (oo * 91) & 255;
    for (let x = 0; x < N; x++) {
      const f = (x / N) * P;
      const c = Math.floor(f);
      const u = f - c;
      i0[x] = c % P;
      i1[x] = (c + 1) % P;
      w[x] = u * u * u * (u * (u * 6 - 15) + 10);
    }
    for (let y = 0; y < N; y++) {
      const r0 = ((i0[y] + oy) & 255) << 8;
      const r1 = ((i1[y] + oy) & 255) << 8;
      const wy = w[y];
      const row = y * N;
      for (let x = 0; x < N; x++) {
        const a0 = (i0[x] + ox) & 255;
        const a1 = (i1[x] + ox) & 255;
        const wx = w[x];
        const top = t[r0 + a0] + (t[r0 + a1] - t[r0 + a0]) * wx;
        const bot = t[r1 + a0] + (t[r1 + a1] - t[r1 + a0]) * wx;
        out[row + x] += amp * (top + (bot - top) * wy);
      }
    }
    norm += amp;
    amp *= 0.5;
    P = Math.min(256, P * 2);
  }
  for (let i = 0; i < N * N; i++) out[i] /= norm;
  return out;
}
