import { seat } from './lib.mjs';
// No Space Setup: no planes, no mesh. The forge must still appear, on a conjured plinth.
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.surface, null, { timeout: 300000 });
  await sim.wait(9000);
  const s = await sim.eval(() => ({ source: window.sunsmith.surface.source, label: window.sunsmith.surface.label, p: window.sunsmith.surface.point.toArray().map((v) => +v.toFixed(2)), beat: window.sunsmith.director.beat }));
  console.log('placement:', JSON.stringify(s));
  await sim.shot('plinth');
}
