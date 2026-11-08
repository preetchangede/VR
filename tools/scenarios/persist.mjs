import { seat } from './lib.mjs';
// Session 1: jump to the sandbox (a full system) so it saves; session 2: reload and expect a welcome back.
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'sandbox', null, { timeout: 300000 });
  await sim.wait(6000);
  const s1 = await sim.eval(() => ({ saved: !!localStorage.getItem('sunsmith.system.v1'), anchor: localStorage.getItem('sunsmith.anchor.v1'), bodies: window.sunsmith.cosmos.bodies.map((b) => b.type) }));
  console.log('session 1:', JSON.stringify(s1));
  await sim.page.goto('https://localhost:8081/?fixed=20&debug', { waitUntil: 'domcontentloaded' });
  await sim.page.waitForFunction(() => !!window.IWER_DEVICE, null, { timeout: 60000 });
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.surface, null, { timeout: 300000 });
  await sim.wait(5000);
  const s2 = await sim.eval(() => ({ beat: window.sunsmith.director.beat, surface: window.sunsmith.surface?.label, bodies: window.sunsmith.cosmos.bodies.map((b) => b.type), restoredPose: !!window.sunsmith.persist.restoredPose }));
  console.log('session 2:', JSON.stringify(s2));
  await sim.shot('welcome-back');
}
