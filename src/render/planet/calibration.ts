/**
 * Coverage -> threshold maps, so `ocean: 0.6` really floods ~60% of the
 * surface and `clouds: 0.5` really covers about half of it.
 *
 * Sea level is calibrated per world: the terrain's low octaves differ a lot
 * between seeds (a fixed threshold would flood anywhere from 38% to 80%), so
 * a JS mirror of the shader's terrain height is sampled once per seed
 * (~400 points, < 1 ms). KEEP `terrainHeight` IN SYNC WITH body.ts.
 * Cloud coverage varies little between seeds, so it uses a measured table
 * (tools/preview/planet/calibrate.mjs).
 */

const fract = (x: number) => x - Math.floor(x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function ph4(x: number, y: number, z: number) {
  const d = x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32);
  return fract((x + y + 2 * d) * (z + d));
}

/** JS mirror of GLSL `pnoise` (value noise, Hoskins hash). */
function pnoise(x: number, y: number, z: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const hx0 = fract(ix * 0.1031);
  const hx1 = fract((ix + 1) * 0.1031);
  const hy0 = fract(iy * 0.1031);
  const hy1 = fract((iy + 1) * 0.1031);
  const hz0 = fract(iz * 0.1031);
  const hz1 = fract((iz + 1) * 0.1031);
  const c0 = mix(ph4(hx0, hy0, hz0), ph4(hx0, hy0, hz1), uz);
  const c1 = mix(ph4(hx1, hy0, hz0), ph4(hx1, hy0, hz1), uz);
  const c2 = mix(ph4(hx0, hy1, hz0), ph4(hx0, hy1, hz1), uz);
  const c3 = mix(ph4(hx1, hy1, hz0), ph4(hx1, hy1, hz1), uz);
  return mix(mix(c0, c1, ux), mix(c2, c3, ux), uy);
}

/** JS mirror of the rocky terrain height in body.ts (first `oct` octaves). */
function terrainHeight(px: number, py: number, pz: number, ox: number, oy: number, oz: number, oct: number) {
  let qx = px * 1.45 + ox;
  let qy = py * 1.45 + oy;
  let qz = pz * 1.45 + oz;
  const w1 = pnoise(qx * 0.9 + 3.7, qy * 0.9 + 3.7, qz * 0.9 + 3.7);
  qx += (w1 - 0.5) * 1.25;
  qy += (w1 - 0.5) * 0.95;
  qz += (w1 - 0.5) * -1.15;
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * (pnoise(qx, qy, qz) - 0.5);
    // PROT * q * 2.03 + (1.7, -3.1, 2.3)
    const rx = -0.8 * qy - 0.6 * qz;
    const ry = 0.8 * qx + 0.36 * qy - 0.48 * qz;
    const rz = 0.6 * qx - 0.48 * qy + 0.64 * qz;
    qx = rx * 2.03 + 1.7;
    qy = ry * 2.03 - 3.1;
    qz = rz * 2.03 + 2.3;
    a *= 0.5;
  }
  return s + 0.1 * (w1 - 0.5);
}

const SAMPLES = 400;
const scratch = new Float32Array(SAMPLES);

/** Height quantiles (p = 0, 0.05, ..., 1) of one world's terrain. */
export function seaTable(ox: number, oy: number, oz: number, out = new Float32Array(21)) {
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SAMPLES; i++) {
    const y = 1 - ((i + 0.5) * 2) / SAMPLES;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    scratch[i] = terrainHeight(Math.cos(ga * i) * r, y, Math.sin(ga * i) * r, ox, oy, oz, 3);
  }
  scratch.sort();
  for (let k = 0; k <= 20; k++) out[k] = scratch[Math.min(SAMPLES - 1, Math.round((k / 20) * (SAMPLES - 1)))];
  // Open the ends a little: the shader adds two more octaves of detail.
  out[0] -= 0.05;
  out[20] += 0.05;
  return out;
}

// Measured quantiles of the cloud field at p = 0, 0.05, ..., 1 (40 seeds).
const CLOUD_Q = [
  -0.44, -0.186, -0.1437, -0.1143, -0.0912, -0.0706, -0.0527, -0.0356, -0.0192, -0.0032, 0.0122, 0.0276, 0.0437,
  0.0601, 0.0771, 0.0951, 0.1153, 0.138, 0.1658, 0.2069, 0.4448,
];

function quantile(table: ArrayLike<number>, p: number) {
  const x = Math.min(Math.max(p, 0), 1) * (table.length - 1);
  const i = Math.min(Math.floor(x), table.length - 2);
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

/** Height threshold below which the surface is sea, for an ocean coverage 0..1. */
export function seaLevel(table: ArrayLike<number>, ocean: number) {
  return quantile(table, ocean);
}

/** Cloud-field threshold for a coverage 0..1 (the shader's visible edge sits 0.045 above it). */
export function cloudThreshold(clouds: number) {
  return quantile(CLOUD_Q, 1 - clouds) - 0.045;
}
