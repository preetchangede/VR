import { seat, hands } from './lib.mjs';
const F = [-0.78, 0.74, 1.35];
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await hands(sim, { left: { pos: [F[0] + 0.05, F[1] + 0.18, F[2] + 0.12], F: [-1, 0.2, 0], N: [0, 0, -1], pose: 'open' }, right: { pos: [F[0] + 0.05, F[1] + 0.18, F[2] - 0.12], F: [-1, 0.2, 0], N: [0, 0, 1], pose: 'open' } });
  await sim.wait(5000);
  await sim.shot('a-hands');
  await sim.eval(() => { const va = window.sunsmith.world.input.xr.visualAdapters; va.hand.left.toggleVisual(false); va.hand.right.toggleVisual(false); });
  await sim.wait(2500);
  await sim.shot('b-no-iwsdk-hands');
  await sim.eval(() => { window.sunsmith.handReceivers.mesh.visible = false; });
  await sim.wait(2500);
  await sim.shot('c-no-receivers');
}
