#!/usr/bin/env node
// Measures the distribution of the planet shaders' terrain height and cloud
// field (a JS mirror of the GLSL in src/render/planet/{noise,common,body}.ts)
// and prints the quantile tables used by src/render/planet/calibration.ts.
//
//   node tools/preview/planet/calibrate.mjs
const fract = (x) => x - Math.floor(x);
const mix = (a, b, t) => a + (b - a) * t;

function ph4(x, y, z) {
  const d = x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32);
  return fract((x + y + 2 * d) * (z + d));
}
function pnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const hx0 = fract(ix * 0.1031), hx1 = fract((ix + 1) * 0.1031);
  const hy0 = fract(iy * 0.1031), hy1 = fract((iy + 1) * 0.1031);
  const hz0 = fract(iz * 0.1031), hz1 = fract((iz + 1) * 0.1031);
  const c0 = mix(ph4(hx0, hy0, hz0), ph4(hx0, hy0, hz1), uz);
  const c1 = mix(ph4(hx1, hy0, hz0), ph4(hx1, hy0, hz1), uz);
  const c2 = mix(ph4(hx0, hy1, hz0), ph4(hx0, hy1, hz1), uz);
  const c3 = mix(ph4(hx1, hy1, hz0), ph4(hx1, hy1, hz1), uz);
  return mix(mix(c0, c1, ux), mix(c2, c3, ux), uy);
}
// PROT * p (column-major mat3 as in GLSL)
function prot(p) {
  return [
    0.0 * p[0] - 0.8 * p[1] - 0.6 * p[2],
    0.8 * p[0] + 0.36 * p[1] - 0.48 * p[2],
    0.6 * p[0] - 0.48 * p[1] + 0.64 * p[2],
  ];
}
function fbm(p, oct, gain, scale, off) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 7; i++) {
    const k = Math.min(Math.max(oct - i, 0), 1);
    if (k <= 0) break;
    s += a * k * (pnoise(p[0], p[1], p[2]) - 0.5);
    const r = prot(p);
    p = [r[0] * scale + off[0], r[1] * scale + off[1], r[2] * scale + off[2]];
    a *= gain;
  }
  return s;
}
function terrain(P, seed) {
  let q = [P[0] * 1.45 + seed[0], P[1] * 1.45 + seed[1], P[2] * 1.45 + seed[2]];
  const w1 = pnoise(q[0] * 0.9 + 3.7, q[1] * 0.9 + 3.7, q[2] * 0.9 + 3.7);
  q = [q[0] + (w1 - 0.5) * 1.25, q[1] + (w1 - 0.5) * 0.95, q[2] + (w1 - 0.5) * -1.15];
  return fbm(q, 5, 0.5, 2.03, [1.7, -3.1, 2.3]) + 0.1 * (w1 - 0.5);
}
function cloud(p, seed) {
  // seed.zxy
  let q = [p[0] * 3.0 + seed[2], p[1] * 4.6 + seed[0], p[2] * 3.0 + seed[1]];
  const w = pnoise(q[0] * 0.6, q[1] * 0.6, q[2] * 0.6);
  q = [q[0] + (w - 0.5) * 1.9, q[1] + (w - 0.5) * 0.7, q[2] + (w - 0.5) * 1.9];
  let n = fbm(q, 5, 0.6, 2.07, [-2.1, 1.3, 0.7]);
  const lat = Math.abs(p[1]);
  n += 0.07 * Math.exp(-lat * lat * 55) + 0.05 * Math.exp(-(lat - 0.7) * (lat - 0.7) * 36) - 0.05 * Math.exp(-(lat - 0.4) * (lat - 0.4) * 64);
  return n;
}

let s = 12345;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const H = [], C = [];
for (let k = 0; k < 40; k++) {
  const seed = [rnd() * 40 - 20, rnd() * 40 - 20, rnd() * 40 - 20];
  for (let i = 0; i < 3000; i++) {
    let v = [gauss(), gauss(), gauss()];
    const l = Math.hypot(...v);
    v = v.map((x) => x / l);
    H.push(terrain(v, seed));
    C.push(cloud(v, seed));
  }
}
const q = (arr) => {
  arr.sort((a, b) => a - b);
  return Array.from({ length: 21 }, (_, i) => +arr[Math.min(arr.length - 1, Math.floor((i / 20) * (arr.length - 1)))].toFixed(4));
};
console.log('SEA_Q  =', JSON.stringify(q(H)));
console.log('CLOUD_Q=', JSON.stringify(q(C)));
