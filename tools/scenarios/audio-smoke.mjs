import { seat } from './lib.mjs';
export default async function (sim) {
  await seat(sim);
  // A trusted click on Begin = the user gesture that unlocks audio.
  await sim.page.click('#begin').catch(() => {});
  await sim.enterXR();
  await seat(sim);
  await sim.wait(8000);
  const r = await sim.eval(() => ({ ready: window.sunsmith.audio.ready, beat: window.sunsmith.director.beat, ctx: window.sunsmith.audio.ctx?.state ?? 'n/a' }));
  console.log('audio:', JSON.stringify(r));
}
