import { seat } from './lib.mjs';
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  for (const [name, q] of [['identity', [0, 0, 0, 1]], ['yaw90', [0, Math.SQRT1_2, 0, Math.SQRT1_2]], ['roll90', [0, 0, Math.SQRT1_2, Math.SQRT1_2]]]) {
    await sim.dev((d, a) => { d.controlMode = 'programmatic'; for (const s of ['left', 'right']) { const h = d.hands[s]; h.poseId = 'open'; h.quaternion.set(...a.q); h.position.set(s === 'left' ? -0.6 : -0.6, 1.0, s === 'left' ? 1.5 : 1.2); } }, { q });
    await sim.wait(2500);
    const r = await sim.eval(() => window.sunsmith.hands.both.map((h) => ({ side: h.side, n: h.normal.toArray().map((v) => +v.toFixed(2)), f: h.forward.toArray().map((v) => +v.toFixed(2)), palm: h.palm.toArray().map((v) => +v.toFixed(2)), curl: +h.curl.toFixed(2) })));
    console.log(name, JSON.stringify(r));
  }
}
