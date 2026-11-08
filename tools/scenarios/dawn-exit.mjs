// Dawn ends when the player looks at the ember and pinches (a pinch anywhere: gaze picks the target).
import { seat, hands, yawPitch, beat } from './lib.mjs';
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.page.waitForFunction(() => window.sunsmith?.director?.beat === 'dawn' && window.sunsmith.director.t > 52, null, { timeout: 900000, polling: 500 });
  const st = await sim.eval(() => ({ head: window.sunsmith.head.toArray(), ember: window.sunsmith.ember.position.toArray(), dev: [window.IWER_DEVICE.position.x, window.IWER_DEVICE.position.y, window.IWER_DEVICE.position.z] }));
  const d = st.ember.map((v, i) => v - st.head[i]);
  const len = Math.hypot(...d);
  const yaw = Math.atan2(-d[0], -d[2]);
  const pitch = Math.asin(d[1] / len);
  await sim.dev((dev, q) => dev.quaternion.set(q[0], q[1], q[2], q[3]), yawPitch(yaw, pitch));
  await sim.wait(1500);
  const rest = { pos: [st.dev[0] - 0.25, st.dev[1] - 0.45, st.dev[2] + 0.2], F: [-1, 0, 0], N: [0, -1, 0] };
  await hands(sim, { right: { ...rest, pose: 'open', pinch: 0 } });
  await sim.wait(800);
  await hands(sim, { right: { ...rest, pose: 'pinch', pinch: 1 } });
  await sim.wait(1500);
  sim.log(`after look-and-pinch: beat=${await beat(sim)} (ember ${len.toFixed(2)} m away)`);
  await hands(sim, { right: { ...rest, pose: 'open', pinch: 0 } });
}
