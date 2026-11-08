/**
 * Offline sky lab: renders panorama strips of the baked dawn sky across dawn
 * values, mirroring the shader's LUT lookup and tone curve. Much faster to
 * iterate on than a software-rendered WebGL screenshot.
 *
 *   node --experimental-strip-types tools/preview/surface/skylab.ts [out.png] [star=#ffe6b8]
 */
import {
  bakeSky,
  computeDawn,
  LUT_NU,
  LUT_NV,
  LUT_NW,
  makeDawnState,
  phaseM,

} from '../../../src/surface/atmosphere.ts';
import type { SkyBake } from '../../../src/surface/atmosphere.ts';
import sharp from 'sharp';

const out = process.argv[2] || 'skylab.png';
const hex = (process.argv[3] || '#ffe6b8').replace('#', '');
const n = parseInt(hex, 16);
const sunDisp: [number, number, number] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];

const t0 = performance.now();
const bake = bakeSky(sunDisp);
console.log('bake ms', (performance.now() - t0).toFixed(1), 'spectrum', bake.sun.map((v) => (v / Math.PI).toFixed(3)));

const W = 900;
const H = 300;
const dawns = [0, 0.1, 0.2, 0.3, 0.35, 0.45, 0.6, 0.8, 1.0];
const img = Buffer.alloc(W * H * dawns.length * 3);
const sunRadius = (0.85 * Math.PI) / 180;

function lut(tex: Float32Array, u: number, v: number, w: number, o: number[]) {
  const fx = Math.min(Math.max(u * (LUT_NU - 1), 0), LUT_NU - 1);
  const fy = Math.min(Math.max(v * (LUT_NV - 1), 0), LUT_NV - 1);
  const fz = Math.min(Math.max(w * (LUT_NW - 1), 0), LUT_NW - 1);
  const x0 = Math.min(LUT_NU - 2, fx | 0);
  const y0 = Math.min(LUT_NV - 2, fy | 0);
  const z0 = Math.min(LUT_NW - 2, fz | 0);
  const ax = fx - x0;
  const ay = fy - y0;
  const az = fz - z0;
  o[0] = o[1] = o[2] = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1;
    const dy = (k >> 1) & 1;
    const dz = (k >> 2) & 1;
    const wgt = (dx ? ax : 1 - ax) * (dy ? ay : 1 - ay) * (dz ? az : 1 - az);
    const i = (((z0 + dz) * LUT_NV + (y0 + dy)) * LUT_NU + (x0 + dx)) * 4;
    o[0] += tex[i] * wgt;
    o[1] += tex[i + 1] * wgt;
    o[2] += tex[i + 2] * wgt;
  }
}

const aces = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
const st = makeDawnState();
const r = [0, 0, 0];
const m = [0, 0, 0];
for (let s = 0; s < dawns.length; s++) {
  computeDawn(bake as SkyBake, dawns[s], sunRadius, st);
  const sx = Math.sin(st.az) * Math.cos(st.elev);
  const sy = Math.sin(st.elev);
  const sz = -Math.cos(st.az) * Math.cos(st.elev);
  const shx = Math.sin(st.az);
  const shz = -Math.cos(st.az);
  const w = (Math.min(1, Math.max(0, (st.elev - (-11 * Math.PI) / 180) / ((34 * Math.PI) / 180))));
  console.log(
    `dawn ${dawns[s].toFixed(2)} elev ${((st.elev * 180) / Math.PI).toFixed(1)} exposure ${st.exposure.toFixed(1)} sunLight ${st.sunLight.map((v) => v.toFixed(3))} amb0 ${st.amb0.map((v) => v.toExponential(2))}`,
  );
  for (let y = 0; y < H; y++) {
    const el = ((88 - (y / (H - 1)) * 92) * Math.PI) / 180; // 88° .. -4°
    for (let x = 0; x < W; x++) {
      const azi = ((-110 + (x / (W - 1)) * 220) * Math.PI) / 180;
      const dx = Math.sin(azi) * Math.cos(el);
      const dy = Math.sin(el);
      const dz = -Math.cos(azi) * Math.cos(el);
      const yc = Math.max(0, dy);
      const v = Math.sqrt(Math.asin(yc) / (Math.PI / 2));
      const hl = Math.hypot(dx, dz);
      const ca = hl > 1e-6 ? (dx * shx + dz * shz) / hl : 0;
      const u = Math.acos(Math.min(1, Math.max(-1, ca))) / Math.PI;
      lut(bake.ray, u, v, w, r);
      lut(bake.mie, u, v, w, m);
      const mu = dx * sx + dy * sy + dz * sz;
      const pm = Math.min(phaseM(mu), 40);
      const ang = Math.acos(Math.min(1, mu));
      const disk = ang < sunRadius && dy > 0 ? 1 : 0;
      const a = Math.sqrt(Math.max(2 - 2 * mu, 0));
      const gl = 1.6 * Math.exp(-a * 34) + 0.32 * Math.exp(-a * 9) + 0.07 * Math.exp(-a * 3);
      const i = ((s * H + y) * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        let L = r[c] + m[c] * pm + st.nightSky[c];
        if (dy < 0) L *= 0.6;
        L += disk * st.sunDisk[c] + st.glare[c] * gl;
        img[i + c] = Math.round(255 * Math.pow(aces(L * st.exposure), 1 / 2.2));
      }
    }
  }
}
await sharp(img, { raw: { width: W, height: H * dawns.length, channels: 3 } }).png().toFile(out);
console.log('wrote', out);
