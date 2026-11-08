import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from '@iwsdk/core';
import { Noise, periodicFbm, rng } from './noise';

/** Contrast-stretch an fbm sample so channels use the full 8-bit range. */
function stretch(v: number, lo: number, hi: number) {
  const t = (v - lo) / (hi - lo);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * 256x256 tileable RGBA noise, mipmapped. Every surface shader samples it at
 * several scales instead of evaluating hash noise per pixel (much cheaper on
 * the Quest's tiled GPU).
 *   r, g, b: independent 5-octave fbm (base period 8 cells)
 *   a:       finer 4-octave fbm (base period 32 cells)
 */
export function makeNoiseTexture(noise: Noise): DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const ch = [
    periodicFbm(noise, N, 8, 5, 1),
    periodicFbm(noise, N, 8, 5, 40),
    periodicFbm(noise, N, 8, 5, 80),
    periodicFbm(noise, N, 32, 4, 120),
  ];
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = 255 * stretch(ch[0][i], 0.22, 0.78);
    data[i * 4 + 1] = 255 * stretch(ch[1][i], 0.22, 0.78);
    data[i * 4 + 2] = 255 * stretch(ch[2][i], 0.22, 0.78);
    data[i * 4 + 3] = 255 * stretch(ch[3][i], 0.22, 0.78);
  }
  const tex = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable ocean detail texture.
 *   r, g: slope (dh/dx, dh/dy) of a sum of directional capillary/chop waves
 *   b:    cellular foam pattern (Worley F2 - F1 edges)
 *   a:    second foam/streak noise
 */
export function makeOceanTexture(noise: Noise, seed: number): DataTexture {
  const N = 256;
  const r = rng(seed * 31 + 5);
  const waves: { kx: number; ky: number; a: number; p: number }[] = [];
  for (let i = 0; i < 28; i++) {
    // Integer wave numbers keep it tileable; spread around the wind (+y).
    const ang = (r() - 0.5) * 2.4;
    const k = 2 + Math.floor(Math.pow(r(), 1.6) * 22);
    const kx = Math.round(Math.sin(ang) * k);
    const ky = Math.round(Math.cos(ang) * k);
    if (kx === 0 && ky === 0) continue;
    const kl = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: 1 / Math.pow(kl, 1.5), p: r() * Math.PI * 2 });
  }
  const sx = new Float32Array(N * N);
  const sy = new Float32Array(N * N);
  // cos(a(x) + b(y)) = cos a cos b - sin a sin b: per-axis tables per wave
  const cx = new Float32Array(N);
  const snx = new Float32Array(N);
  const cy = new Float32Array(N);
  const sny = new Float32Array(N);
  for (const w of waves) {
    for (let i = 0; i < N; i++) {
      const ax = ((w.kx * i) / N) * Math.PI * 2 + w.p;
      const by = ((w.ky * i) / N) * Math.PI * 2;
      cx[i] = Math.cos(ax);
      snx[i] = Math.sin(ax);
      cy[i] = Math.cos(by);
      sny[i] = Math.sin(by);
    }
    const ax = w.a * w.kx;
    const ay = w.a * w.ky;
    for (let y = 0; y < N; y++) {
      const c1 = cy[y];
      const s1 = sny[y];
      const row = y * N;
      for (let x = 0; x < N; x++) {
        const c = cx[x] * c1 - snx[x] * s1;
        sx[row + x] += c * ax;
        sy[row + x] += c * ay;
      }
    }
  }
  let maxS = 0;
  for (let i = 0; i < N * N; i++) maxS = Math.max(maxS, Math.abs(sx[i]), Math.abs(sy[i]));
  // Worley cells (periodic) for foam.
  const C = 12;
  const pts = new Float32Array(C * C * 2);
  for (let i = 0; i < C * C; i++) {
    pts[i * 2] = r();
    pts[i * 2 + 1] = r();
  }
  const data = new Uint8Array(N * N * 4);
  const streak = periodicFbm(noise, N, 16, 4, 200);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const fx = (x / N) * C;
      const fy = (y / N) * C;
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      let f1 = 9;
      let f2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const wx = ((gx % C) + C) % C;
          const wy = ((gy % C) + C) % C;
          const px = gx + pts[(wy * C + wx) * 2];
          const py = gy + pts[(wy * C + wx) * 2 + 1];
          const ddx = px - fx;
          const ddy = py - fy;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      const edge = Math.min(1, (f2 - f1) * 2.2);
      data[i * 4] = Math.round(127.5 + 127.5 * (sx[i] / maxS));
      data[i * 4 + 1] = Math.round(127.5 + 127.5 * (sy[i] / maxS));
      data[i * 4 + 2] = Math.round(255 * edge);
      data[i * 4 + 3] = Math.round(255 * stretch(streak[i], 0.2, 0.8));
    }
  }
  const tex = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
