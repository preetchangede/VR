// Pinch the hovering world, carry it into the habitable zone, let go: it must
// leave the hand, settle into a stable orbit, and move the story to 'cooling'.
import { seat, hands, beat } from './lib.mjs';
const F = [-0.78, 0.74, 1.35];
const FWD = [-1, 0, 0];
const RIGHT = [0, 0, -1];
const at = (fwd, up, right) => [F[0] + FWD[0] * fwd + RIGHT[0] * right, F[1] + up, F[2] + FWD[2] * fwd + RIGHT[2] * right];
const REST = { pos: at(-0.36, -0.02, -0.26), F: FWD, N: [0, -1, 0], pose: 'default' };
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'throw' && window.sunsmith.director.world, null, { timeout: 300000 });
  await sim.wait(1500);
  const w = await sim.eval(() => window.sunsmith.director.world.pos.toArray());
  const target = at(0.0, 0.17, 0.155);
  let grabbed = false;
  for (let i = 0; i <= 24; i++) {
    const k = Math.min(1, Math.max(0, (i - 4) / 16));
    const p = [w[0] + (target[0] - w[0]) * k, w[1] + (target[1] - w[1]) * k, w[2] + (target[2] - w[2]) * k];
    const pinch = i >= 3 && i < 22 ? 1 : 0;
    await hands(sim, { left: REST, right: { pos: [p[0] + 0.07, p[1] + 0.03, p[2] - 0.02], F: [-1, -0.3, 0.1], N: [0, -0.4, 1], pose: pinch ? 'pinch' : 'open', pinch } });
    await sim.wait(200);
    if (i === 12) grabbed = await sim.eval(() => window.sunsmith.forgeHands.grabbed.some((b) => b === window.sunsmith.director.world));
  }
  await hands(sim, { left: REST, right: { ...REST, pos: at(-0.36, -0.02, 0.26) } });
  const sample = () =>
    sim.eval(() => {
      const g = window.sunsmith;
      const wd = g.director.world;
      const sun = g.cosmos.mainStar();
      return { beat: g.director.beat, kinematic: wd.kinematic, heldBy: wd.heldBy, r: sun ? +wd.pos.distanceTo(sun.pos).toFixed(3) : -1, speed: +wd.vel.length().toFixed(3) };
    });
  const s0 = await sample();
  await sim.wait(4000);
  const s1 = await sample();
  await sim.wait(4000);
  const s2 = await sample();
  sim.log(`grabbed mid-carry: ${grabbed}`);
  sim.log(`after release: ${JSON.stringify(s0)}`);
  sim.log(`+4 s: ${JSON.stringify(s1)}`);
  sim.log(`+8 s: ${JSON.stringify(s2)}`);
  sim.log(`beat now: ${await beat(sim)}`);
  await sim.shot('orbit');
}
