// Checks two late polish items in one run:
//  1. the supernova's held breath (implosion, then silence, then the blast) timing;
//  2. the codex card, rendered straight from its canvas to a PNG.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seat } from './lib.mjs';
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'giant-life', null, { timeout: 600000 });
  await sim.wait(2000);
  await sim.eval(() => window.sunsmith.cheat.supergiant(0.3));
  await sim.wait(2000);
  const t0 = await sim.eval(() => {
    window.sunsmith.cheat.go('collapse');
    return window.sunsmith.clock.time;
  });
  let shotHold = false;
  for (let k = 0; k < 400; k++) {
    const s = await sim.eval(() => ({ t: window.sunsmith.clock.time, nova: window.sunsmith.director.flags.has('supernova') }));
    if (!shotHold && s.t - t0 > 1.2) {
      shotHold = true;
      await sim.shot('collapse-hold');
    }
    if (s.nova) {
      sim.log(`supernova fired ${(s.t - t0).toFixed(2)} s after collapse began`);
      break;
    }
    await sim.wait(100);
  }
  await sim.wait(1500);
  await sim.shot('supernova-blast');
  const url = await sim.eval(() => {
    const g = window.sunsmith;
    for (const id of ['first-light', 'blue-giant', 'supernova', 'pulsar', 'molten-world', 'ocean-world', 'living-world', 'homecoming']) g.codex.found.add(id);
    g.showCodex();
    return g.panel.canvas.toDataURL('image/png');
  });
  const out = join(sim.outDir ?? '.', 'codex-card.png');
  writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  sim.log(`wrote ${out}`);
}
