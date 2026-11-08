// A world released in the habitable zone (as the cooling skip / auto-orbit do) must settle
// into a circular orbit there and become an ocean world, then come alive.
import { seat } from './lib.mjs';
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'cooling' && window.sunsmith.director.world, null, { timeout: 300000 });
  await sim.eval(() => {
    const g = window.sunsmith;
    const w = g.director.world;
    w.cooled = 0; w.look.molten = 1; w.look.life = 0; w.living = false; w.flags.delete('cooled');
    window.__found = [];
    const orig = g.codex.onDiscover;
    g.codex.onDiscover = (d) => { window.__found.push(d.id); orig(d); };
    g.cheat.evolve(1.9);
  });
  const rs = [];
  for (let k = 0; k < 24; k++) {
    const s = await sim.eval(() => {
      const g = window.sunsmith;
      const w = g.director.world;
      const sun = g.cosmos.mainStar();
      return { t: +g.clock.time.toFixed(1), r: +w.pos.distanceTo(sun.pos).toFixed(3), climate: +(w.climate ?? 0).toFixed(2), cooled: +(w.cooled ?? 0).toFixed(2), living: w.living, beat: g.director.beat, found: window.__found.slice() };
    });
    rs.push(s);
    if (s.living) break;
    await sim.wait(2500);
  }
  for (const s of rs) sim.log(JSON.stringify(s));
}
