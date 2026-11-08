import { seat, hands, beat } from './lib.mjs';
const F = [-0.78, 0.74, 1.35];
// Jump to the blue giant; watch it swell, collapse and explode; capture the remnant.
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await hands(sim, { left: { pos: [F[0] + 0.36, F[1] + 0.0, F[2] + 0.26], F: [-1, 0, 0], N: [0, -1, 0], pose: 'default' }, right: { pos: [F[0] + 0.36, F[1] + 0.0, F[2] - 0.26], F: [-1, 0, 0], N: [0, -1, 0], pose: 'default' } });
  const t0 = Date.now();
  let n = 0;
  let last = '';
  while (Date.now() - t0 < 1500 * 1000) {
    const b = await beat(sim);
    const gt = await sim.eval(() => window.sunsmith.clock.time.toFixed(1));
    if (b !== last) { sim.log('beat', b, 'game t', gt); last = b; }
    await sim.shot(`${String(n).padStart(3, '0')}-${b}-${gt}`);
    n++;
    if (b === 'world-gather') break;
    await sim.wait(b === 'collapse' ? 2500 : 9000);
  }
}
