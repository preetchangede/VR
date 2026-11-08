import { seat, hand, yawPitch } from './lib.mjs';
// Enter XR seated at the dining table; verify forge placement, well, relighting.
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await hand(sim, 'left', [-0.5, 0.95, 1.5], 'open', yawPitch(Math.PI / 2, -0.3));
  await hand(sim, 'right', [-0.5, 0.95, 1.2], 'open', yawPitch(Math.PI / 2, -0.3));
  await sim.wait(4000);
  const s = await sim.eval(() => {
    const g = window.sunsmith;
    return { surface: g.surface && { label: g.surface.label, source: g.surface.source, p: g.surface.point.toArray() },
      planes: [...g.room.planes.values()].map((r) => r.label + ':' + r.center.toArray().map((v) => v.toFixed(2)).join(',')),
      meshes: [...g.room.meshes.values()].map((r) => r.label), hasGlobal: g.room.hasGlobalMesh,
      hands: g.hands.both.map((h) => ({ tracked: h.tracked, palm: h.palm.toArray().map((v) => +v.toFixed(3)), n: h.normal.toArray().map((v) => +v.toFixed(2)), curl: +h.curl.toFixed(2), pinch: +h.pinchStrength.toFixed(2) })) };
  });
  console.log(JSON.stringify(s, null, 1));
  await sim.shot('01-placed');
  await sim.wait(6000);
  await sim.shot('02-open');
}
