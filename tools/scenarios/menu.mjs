import { seat, hands, touch } from './lib.mjs';
// Palm-up menu: open it with the left palm, poke "codex" with the right index finger.
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'sandbox', null, { timeout: 600000 });
  const head = [-0.36, 1.16, 1.35];
  // Left palm 35 cm in front of the eyes, a bit low, facing the face (+X), fingers up.
  const palm = [head[0] - 0.33, head[1] - 0.12, head[2] + 0.06];
  await hands(sim, { left: { pos: palm, F: [0, 1, 0.15], N: [1, 0.2, 0], pose: 'open' }, right: { pos: [head[0] - 0.2, head[1] - 0.4, head[2] - 0.2], F: [-1, 0, 0], N: [0, -1, 0], pose: 'default' } });
  await sim.page.waitForFunction(() => window.sunsmith.menu.isOpen, null, { timeout: 300000 }).catch(() => {});
  await sim.wait(3000);
  const st = await sim.eval(() => {
    const g = window.sunsmith;
    const b = g.menu.buttons?.map((x) => x.mesh.getWorldPosition(new g.head.constructor()).toArray().map((v) => +v.toFixed(3)));
    return { open: g.menu.isOpen, buttons: b, palm: g.hands.left.palm.toArray().map((v) => +v.toFixed(3)), n: g.hands.left.normal.toArray().map((v) => +v.toFixed(2)), curl: +g.hands.left.curl.toFixed(2) };
  });
  console.log('menu:', JSON.stringify(st));
  await sim.shot('menu-open');
  if (st.buttons) {
    // Poke the first button (codex) with the right index fingertip.
    // Clear any discovery toast so we can see the codex panel open.
    await sim.eval(() => { const g = window.sunsmith; g.toasts.length = 0; g.panelTimer = 0; g.panel.targetOpacity = 0; g.panel.opacity = 0; });
    await touch(sim, 'right', () => sim.eval(() => window.sunsmith.menu.buttons[0].mesh.getWorldPosition(new window.sunsmith.head.constructor()).toArray()));
    const dbg = await sim.eval(() => {
      const m = window.sunsmith.menu;
      const b0 = m.buttons[0];
      const p = b0.mesh.getWorldPosition(new window.sunsmith.head.constructor());
      const tip = window.sunsmith.hands.right.indexTip;
      return { open: m.isOpen, side: m.side, cooldown: m.cooldown, hover: +b0.hover.toFixed(2), d: +tip.distanceTo(p).toFixed(4), rTracked: window.sunsmith.hands.right.tracked, enabled: m.enabled };
    });
    console.log('debug:', JSON.stringify(dbg));
    await sim.wait(3000);
    const r = await sim.eval(() => ({ panel: +window.sunsmith.panel.opacity.toFixed(2), timer: +window.sunsmith.panelTimer.toFixed(1), tip: window.sunsmith.hands.right.indexTip.toArray().map((v) => +v.toFixed(3)) }));
    console.log('after poke:', JSON.stringify(r));
    await sim.shot('menu-codex');
  }
}
