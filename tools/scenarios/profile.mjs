import { seat } from './lib.mjs';
// Measures JS cost of Game.update in the heaviest states (desktop CPU; Quest is ~3-5x slower).
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'giant-life', null, { timeout: 300000 });
  await sim.eval(() => {
    const g = window.sunsmith;
    const orig = g.update.bind(g);
    window.__prof = [];
    g.update = (d, f) => { const t0 = performance.now(); const r = orig(d, f); if (f) window.__prof.push(performance.now() - t0); return r; };
    g.cheat.supergiant(0.2);
  });
  await sim.page.waitForFunction(() => window.sunsmith.director.giant?.phase === 'supergiant', null, { timeout: 600000 });
  await sim.eval(() => window.sunsmith.cheat.go('collapse'));
  await sim.page.waitForFunction(() => window.sunsmith.motes.remnantCount > 1500, null, { timeout: 600000 });
  await sim.eval(() => { window.__prof = []; });
  await sim.page.waitForFunction(() => window.__prof.length >= 40, null, { timeout: 600000 });
  const r = await sim.eval(() => {
    const p = window.__prof.slice(-40).sort((a, b) => a - b);
    const g = window.sunsmith;
    const info = g.renderer.info.render;
    return { n: window.__prof.length, median: p[p.length >> 1]?.toFixed(2), p90: p[Math.floor(p.length * 0.9)]?.toFixed(2), motes: g.motes.aliveCount, remnant: g.motes.remnantCount, calls: info.calls, tris: info.triangles };
  });
  console.log('profile:', JSON.stringify(r));
}
