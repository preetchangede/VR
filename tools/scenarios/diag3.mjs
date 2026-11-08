import { seat, hands, waitBeat } from './lib.mjs';
const F = [-0.78, 0.74, 1.35];
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await hands(sim, { left: { pos: [F[0] + 0.34, F[1] + 0.02, F[2] + 0.24], F: [-1, 0, 0], N: [0, -1, 0], pose: 'default' }, right: { pos: [F[0] + 0.34, F[1] + 0.02, F[2] - 0.24], F: [-1, 0, 0], N: [0, -1, 0], pose: 'default' } });
  await waitBeat(sim, 'gather');
  await sim.wait(6000);
  const r = await sim.eval(() => {
    const g = window.sunsmith; const m = g.motes; const cam = g.camera;
    const out = []; const v = new g.head.constructor();
    for (let i = 0; i < m.capacity; i++) {
      if (m.state[i] === 0) continue;
      v.fromArray(m.pos, i * 3);
      const p = v.clone().project(cam);
      if (p.y < -0.85 && Math.abs(p.x) < 0.5 && p.z < 1) out.push({ i, st: m.state[i], own: m.owner[i], pos: v.toArray().map((x) => +x.toFixed(3)), ndc: [p.x.toFixed(2), p.y.toFixed(2)], dHead: +v.distanceTo(g.head).toFixed(3) });
    }
    return { count: out.length, sample: out.slice(0, 8), head: g.head.toArray(), hands: g.hands.both.map((h) => h.palm.toArray().map((x) => +x.toFixed(3))), held: [...m.heldCount] };
  });
  console.log(JSON.stringify(r, null, 1));
  await sim.shot('x');
}
