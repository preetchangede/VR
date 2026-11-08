import { seat } from './lib.mjs';
// Persistent anchors end to end: session 1 reaches the sandbox (saves, pins the forge);
// session 2 reloads and must come back to the same spot with its table outline,
// with no plinth on the real table, and the forge must not drift or relocate in either.
export default async function (sim) {
  const watch = () =>
    sim.eval(() => {
      const g = window.sunsmith;
      if (!window.__relocs) {
        window.__relocs = 0;
        const orig = g.relocateForge.bind(g);
        g.relocateForge = (...a) => {
          window.__relocs++;
          return orig(...a);
        };
      }
      return {
        beat: g.director.beat,
        forge: g.forge.position.toArray().map((v) => +v.toFixed(3)),
        yaw: +g.forge.rotation.y.toFixed(3),
        relocs: window.__relocs,
        surface: g.surface && { label: g.surface.label, source: g.surface.source, outline: !!g.surface.outline },
        plinth: !!g.well.plinth?.visible,
        restoredPose: !!g.persist.restoredPose,
        bodies: g.cosmos.bodies.length,
      };
    });
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'sandbox', null, { timeout: 300000 });
  console.log('s1 a:', JSON.stringify(await watch()));
  await sim.wait(6000);
  console.log('s1 b:', JSON.stringify(await watch()));
  console.log('stored:', JSON.stringify(await sim.eval(() => ({ saved: !!localStorage.getItem('sunsmith.system.v1'), anchor: localStorage.getItem('sunsmith.anchor.v1') }))));
  await sim.page.goto('https://localhost:8081/?fixed=20&debug', { waitUntil: 'domcontentloaded' });
  await sim.page.waitForFunction(() => !!window.IWER_DEVICE, null, { timeout: 60000 });
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.surface, null, { timeout: 300000 });
  console.log('s2 a:', JSON.stringify(await watch()));
  await sim.wait(7000);
  console.log('s2 b:', JSON.stringify(await watch()));
  await sim.shot('welcome-back');
}
