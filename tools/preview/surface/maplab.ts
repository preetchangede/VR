/**
 * Offline map of the generated shore (top-down), for layout tuning.
 *   node --experimental-strip-types tools/preview/surface/maplab.ts [out.png] [seed]
 * North-up = -Z (toward the sunrise). Player at the center cross.
 */
import { Land, MAP_RES, MAP_SIZE, SEA } from '../../../src/surface/land.ts';
import sharp from 'sharp';

const out = process.argv[2] || 'maplab.png';
const seed = +(process.argv[3] || 7);
const t0 = performance.now();
const land = new Land(seed);
console.log('land ms', (performance.now() - t0).toFixed(1), 'rocks', land.rocks.length, 'h(0,0)', land.height(0, 0).toFixed(3));
const S = 640;
const img = Buffer.alloc(S * S * 3);
for (let py = 0; py < S; py++) {
  for (let px = 0; px < S; px++) {
    const x = (px / S - 0.5) * MAP_SIZE;
    const z = (py / S - 0.5) * MAP_SIZE; // top row = -Z
    const h = land.sample(land.grid, x, z);
    const d = land.sample(land.dist, x, z);
    const hz = land.sample(land.horizon, x, z);
    let c: number[];
    if (h < SEA) {
      const depth = SEA - h;
      c = [20, 60 + 80 * Math.exp(-depth * 0.4), 110 + 90 * Math.exp(-depth * 0.4)];
      if (d < 6 && Math.sin(d * 2.2) > 0.85) c = [200, 230, 255];
    } else {
      const t = Math.min(1, (h - SEA) / 22);
      c = [90 + 120 * t, 110 + 70 * t, 60 + 40 * t];
      const sand = land.sandAt(x, z);
      c = c.map((v, i) => v * (1 - sand) + [225, 205, 150][i] * sand);
      if (Math.abs(((h - SEA) % 2) - 0) < 0.08) c = c.map((v) => v * 0.7);
      // shadow at sun elevation 4°
      if (Math.atan(1) * 0 + hz > 0.07) c = c.map((v) => v * 0.6);
    }
    const i = (py * S + px) * 3;
    img[i] = c[0];
    img[i + 1] = c[1];
    img[i + 2] = c[2];
  }
}
const mark = (x: number, z: number, col: number[], r = 2) => {
  const px = Math.round((x / MAP_SIZE + 0.5) * S);
  const py = Math.round((z / MAP_SIZE + 0.5) * S);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const X = px + dx, Y = py + dy;
    if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
    const i = (Y * S + X) * 3;
    img[i] = col[0]; img[i + 1] = col[1]; img[i + 2] = col[2];
  }
};
for (const k of land.rocks) mark(k.x, k.z, k.kind === 1 ? [255, 60, 60] : k.kind === 2 ? [255, 160, 0] : [40, 40, 40], k.kind ? 3 : 1);
mark(0, 0, [255, 0, 255], 3);
await sharp(img, { raw: { width: S, height: S, channels: 3 } }).png().toFile(out);
// profile along x = 0 (forward)
const prof = [];
for (let z = -12; z <= 12; z += 1) prof.push(`${z}:${land.height(0, z).toFixed(2)}`);
console.log('profile x=0', prof.join(' '));
const side = [];
for (let x = -14; x <= 14; x += 2) side.push(`${x}:${land.height(x, 0).toFixed(2)}`);
console.log('profile z=0', side.join(' '));
console.log('wrote', out, 'res', MAP_RES);
