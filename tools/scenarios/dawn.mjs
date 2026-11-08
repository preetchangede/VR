import { seat } from './lib.mjs';
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'dawn' && window.sunsmith.inSurface, null, { timeout: 400000 });
  await sim.page.waitForFunction(() => window.sunsmith.director.t > 5, null, { timeout: 600000 });
  const s = await sim.eval(() => ({ beat: window.sunsmith.director.beat, t: window.sunsmith.director.t.toFixed(1), fader: window.sunsmith.fader.level.toFixed(2), calls: window.sunsmith.renderer.info.render.calls, tris: window.sunsmith.renderer.info.render.triangles }));
  console.log('dawn:', JSON.stringify(s));
  await sim.shot('dawn');
}
