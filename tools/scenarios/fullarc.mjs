// End-to-end: play the whole guided arc with scripted hands, logging every
// beat. Assists (auto-ignite / auto-orbit) are allowed to rescue the script,
// and the log says when they did.
import { seat, hands, beat } from './lib.mjs';

const F = [-0.78, 0.74, 1.35];
const FWD = [-1, 0, 0];
const RIGHT = [0, 0, -1];
const at = (fwd, up, right) => [F[0] + FWD[0] * fwd + RIGHT[0] * right, F[1] + up, F[2] + FWD[2] * fwd + RIGHT[2] * right];
const REST = {
  left: { pos: at(-0.36, -0.02, -0.26), F: FWD, N: [0, -1, 0], pose: 'default' },
  right: { pos: at(-0.36, -0.02, 0.26), F: FWD, N: [0, -1, 0], pose: 'default' },
};

// SLOW=n stretches every time limit (for a contended machine running ?fixed time).
const SLOW = +(process.env.SLOW ?? 1);

export default async function (sim) {
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const g = (fn) => sim.eval(fn);
  const shots = new Set();
  let current = '';
  const until = async (pred, act, limitMs) => {
    limitMs *= SLOW;
    const start = Date.now();
    let k = 0;
    while (Date.now() - start < limitMs) {
      if (await pred()) return true;
      if (act) await act(k++);
      else await sim.wait(400);
    }
    return false;
  };
  const onBeat = async () => {
    const b = await beat(sim);
    if (b !== current) {
      current = b;
      const gt = await g(() => window.sunsmith.clock.time.toFixed(1));
      sim.log(`[${stamp()}] beat -> ${b} (game ${gt}s)`);
      if (!shots.has(b)) {
        shots.add(b);
        await sim.shot(`beat-${String(shots.size).padStart(2, '0')}-${b}`);
      }
    }
    return b;
  };

  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await hands(sim, REST);

  const sweep = async (k) => {
    const a = k * 0.4;
    const r = 0.09;
    await hands(sim, {
      left: { pos: at(Math.cos(a) * r, 0.17 + Math.sin(a * 0.7) * 0.06, -0.06 + Math.sin(a) * r), F: FWD, N: [0, -1, 0], pose: 'open' },
      right: { pos: at(Math.cos(a + 3.1) * r, 0.19 + Math.cos(a * 0.6) * 0.06, 0.06 + Math.sin(a + 3.1) * r), F: FWD, N: [0, -1, 0], pose: 'open' },
    });
    await sim.wait(150);
    await onBeat();
  };
  const squeeze = async (k) => {
    const gap = Math.max(0.035, 0.34 - k * 0.012);
    await hands(sim, {
      left: { pos: at(0.06, 0.19, -gap / 2), F: [-1, 0.2, 0], N: [0, 0, -1], pose: 'cup' },
      right: { pos: at(0.06, 0.19, gap / 2), F: [-1, 0.2, 0], N: [0, 0, 1], pose: 'cup' },
    });
    await sim.wait(150);
    await onBeat();
  };
  const rest = async () => {
    await hands(sim, REST);
    await sim.wait(600);
    await onBeat();
  };
  const is = (...names) => async () => names.includes(await onBeat());

  const plan = [
    ['wake', null, 120],
    ['gather', sweep, 400],
    ['squeeze', squeeze, 300],
    ['firstlight', rest, 300],
    ['giant-gather', sweep, 500],
    ['giant-squeeze', squeeze, 300],
    ['giant-life', rest, 600],
    ['collapse', rest, 400],
    ['remnant', rest, 400],
    ['world-gather', sweep, 500],
    ['world-squeeze', squeeze, 300],
  ];
  const ORDER = ['wait-surface', 'wake', 'gather', 'squeeze', 'firstlight', 'giant-gather', 'giant-squeeze', 'giant-life', 'collapse', 'remnant', 'world-gather', 'world-squeeze', 'throw', 'cooling', 'life', 'visit-prompt', 'homecoming', 'dawn', 'return', 'sandbox'];
  const reached = async (name) => ORDER.indexOf(await onBeat()) >= ORDER.indexOf(name);
  for (const [name, act, limitS] of plan) {
    // Arrive at the beat first (it may take a while), then act until it moves on.
    await until(() => reached(name), null, 900 * 1000);
    const ok = await until(async () => (await onBeat()) !== name, act, limitS * 1000);
    if (!ok) sim.log(`[${stamp()}] STUCK in ${name}`);
  }

  // Throw: pinch the hovering world, carry it to the zone, release.
  await until(() => reached('throw'), null, 900 * 1000);
  if ((await onBeat()) === 'throw') {
    const w = await g(() => window.sunsmith.director.world?.pos.toArray());
    if (w) {
      const target = at(0.0, 0.17, 0.155);
      for (let i = 0; i <= 24; i++) {
        const k = Math.min(1, Math.max(0, (i - 4) / 16));
        const p = [w[0] + (target[0] - w[0]) * k, w[1] + (target[1] - w[1]) * k, w[2] + (target[2] - w[2]) * k];
        const pinch = i >= 3 && i < 22 ? 1 : 0;
        await hands(sim, { left: REST.left, right: { pos: [p[0] + 0.07, p[1] + 0.03, p[2] - 0.02], F: [-1, -0.3, 0.1], N: [0, -0.4, 1], pose: pinch ? 'pinch' : 'open', pinch } });
        await sim.wait(200);
        await onBeat();
      }
      const grabbed = await g(() => window.sunsmith.director.world?.kinematic === false);
      sim.log(`[${stamp()}] throw: world released into orbit = ${grabbed}`);
    }
    await hands(sim, REST);
  }
  for (const [name, limitS] of [['throw', 240], ['cooling', 600], ['life', 200]]) {
    await until(() => reached(name), null, 900 * 1000);
    const ok = await until(async () => (await onBeat()) !== name, rest, limitS * 1000);
    if (!ok) sim.log(`[${stamp()}] STUCK in ${name}`);
  }
  // Visit: touch the world.
  await until(() => reached('visit-prompt'), null, 900 * 1000);
  await until(
    async () => (await onBeat()) !== 'visit-prompt',
    async () => {
      const w = await g(() => window.sunsmith.director.world?.pos.toArray());
      if (w) await hands(sim, { left: REST.left, right: { pos: [w[0] + 0.15, w[1] + 0.02, w[2] - 0.02], F: [-1, -0.15, 0.1], N: [0, -0.5, 1], pose: 'point' } });
      await sim.wait(300);
    },
    300 * 1000,
  );
  await hands(sim, REST);
  for (const [name, limitS] of [['homecoming', 200], ['dawn', 600], ['return', 200]]) {
    await until(() => reached(name), null, 900 * 1000);
    const ok = await until(async () => (await onBeat()) !== name, async () => { await sim.wait(1500); if ((await onBeat()) === 'dawn' && current === 'dawn') { const e = await g(() => window.sunsmith.ember.position.toArray()); await hands(sim, { left: REST.left, right: { pos: [e[0] + 0.07, e[1] + 0.03, e[2] - 0.02], F: [-1, -0.3, 0.1], N: [0, -0.4, 1], pose: 'pinch', pinch: 1 } }); await sim.wait(400); await hands(sim, { left: REST.left, right: { ...REST.right, pose: 'open', pinch: 0 } }); } }, limitS * 1000);
    if (!ok) sim.log(`[${stamp()}] STUCK in ${name}`);
  }
  await onBeat();
  const codex = await g(() => [...window.sunsmith.codex.found]);
  sim.log(`[${stamp()}] finished in beat ${current}; codex: ${codex.join(', ')}`);
  await sim.shot('final');
}
