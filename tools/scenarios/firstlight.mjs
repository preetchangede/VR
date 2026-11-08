import { seat, hands, waitBeat, beat } from './lib.mjs';
// Wake -> gather (sweeping both hands) -> squeeze -> first light.
const F = [-0.78, 0.74, 1.35]; // forge center (dining table)
const FWD = [-1, 0, 0], RIGHT = [0, 0, -1];
const at = (fwd, up, right) => [F[0] + FWD[0] * fwd + RIGHT[0] * right, F[1] + up, F[2] + FWD[2] * fwd + RIGHT[2] * right];
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await hands(sim, { left: { pos: at(-0.34, 0.02, -0.24), F: FWD, N: [0, -1, 0], pose: 'default' }, right: { pos: at(-0.34, 0.02, 0.24), F: FWD, N: [0, -1, 0], pose: 'default' } });
  const t0 = Date.now();
  await waitBeat(sim, 'gather');
  sim.log('fps', (await sim.fps(2000)).toFixed(2));
  await sim.shot('01-gather-start');
  // Let the gas rise for a moment, then sweep.
  await sim.wait(4000);
  await sim.shot('02-gas');
  let k = 0;
  while ((await beat(sim)) === 'gather' && k < 400) {
    const a = k * 0.35;
    const r = 0.09;
    const lp = at(Math.cos(a) * r, 0.17 + Math.sin(a * 0.7) * 0.06, -0.06 + Math.sin(a) * r);
    const rp = at(Math.cos(a + 3.1) * r, 0.19 + Math.cos(a * 0.6) * 0.06, 0.06 + Math.sin(a + 3.1) * r);
    await hands(sim, { left: { pos: lp, F: FWD, N: [0, -1, 0], pose: 'open' }, right: { pos: rp, F: FWD, N: [0, -1, 0], pose: 'open' } });
    await sim.wait(120);
    if (k === 30) await sim.shot('03-gathering');
    k++;
  }
  sim.log('gather done after', k, 'steps;', (await sim.eval(() => window.sunsmith.motes.heldCount)).join(','));
  await sim.shot('04-held');
  // Squeeze: palms facing, close in, hold.
  for (let i = 0; i <= 60; i++) {
    // Hand origins sit ~3.5 cm outside the palm centers; aim the palms ~8 cm apart.
    const gap = 0.34 - 0.3 * Math.min(1, i / 30);
    await hands(sim, {
      left: { pos: at(0.06, 0.19, -gap / 2), F: [-1, 0.2, 0], N: [0, 0, -1], pose: 'cup' },
      right: { pos: at(0.06, 0.19, gap / 2), F: [-1, 0.2, 0], N: [0, 0, 1], pose: 'cup' },
    });
    await sim.wait(150);
    if (i === 15) await sim.shot('05-squeeze-mid');
    if (i === 32) await sim.shot('06-squeeze-full');
    if ((await beat(sim)) === 'firstlight') break;
  }
  const st = await sim.eval(() => ({ beat: window.sunsmith.director.beat, comp: window.sunsmith.forgeHands.compress.active, prog: window.sunsmith.forgeHands.compress.progress, pressure: window.sunsmith.forgeHands.pressure, facing: window.sunsmith.hands.palmsFacing(), gap: window.sunsmith.hands.palmGap() }));
  sim.log(JSON.stringify(st));
  await sim.wait(1500);
  await sim.shot('07-ignition');
  // Pull hands apart, let the star glide home.
  await hands(sim, { left: { pos: at(-0.2, 0.1, -0.3), F: FWD, N: [0, -1, 0], pose: 'default' }, right: { pos: at(-0.2, 0.1, 0.3), F: FWD, N: [0, -1, 0], pose: 'default' } });
  await sim.wait(8000);
  await sim.shot('08-sun');
  sim.log('total wall s', ((Date.now() - t0) / 1000).toFixed(0));
}
