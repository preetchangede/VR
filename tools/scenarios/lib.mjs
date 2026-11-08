// Shared helpers for SUNSMITH emulator scenarios.

/** Quaternion [x,y,z,w] from yaw (about +Y) then pitch (about local +X), radians. */
export function yawPitch(yaw, pitch) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  // q = qYaw * qPitch
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/** Seat the emulated player at the sunlit living room's dining table. */
export const SEAT = {
  head: [-0.36, 1.16, 1.35],
  yaw: Math.PI / 2, // facing -X, toward the table
  pitch: -0.5,
  table: [-0.95, 0.74, 1.35],
};

export async function seat(sim, s = SEAT) {
  await sim.dev((d, a) => {
    d.controlMode = 'programmatic';
    if (d.devui) { d.devui.devUIContainer.style.display = 'none'; d.devui.devUICanvas.style.display = 'none'; }
    d.primaryInputMode = 'hand';
    d.position.set(a.head[0], a.head[1], a.head[2]);
    d.quaternion.set(a.q[0], a.q[1], a.q[2], a.q[3]);
  }, { head: s.head, q: yawPitch(s.yaw, s.pitch) });
}

/** Place a hand (world/XR-origin coords) with a pose. */
export async function hand(sim, side, pos, poseId = 'open', q = null) {
  await sim.dev((d, a) => {
    d.controlMode = 'programmatic';
    const h = d.hands[a.side];
    h.connected = true;
    if (a.poseId) h.poseId = a.poseId;
    h.position.set(a.pos[0], a.pos[1], a.pos[2]);
    if (a.q) h.quaternion.set(a.q[0], a.q[1], a.q[2], a.q[3]);
  }, { side, pos, poseId, q });
}

/** Read app state exposed on window.sunsmith. */
export async function state(sim, fn) {
  return sim.eval(fn);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a) => a.map((x) => -x);

/** Quaternion orienting an IWER hand: fingers along F, palm facing N (world). */
export function handQuat(F, N) {
  const f = norm(F);
  let n = norm(N);
  // Orthogonalize n against f.
  const d = n[0] * f[0] + n[1] * f[1] + n[2] * f[2];
  n = norm(sub(n, f.map((x) => x * d)));
  const Z = neg(f);
  const Y = neg(n);
  const X = cross(Y, Z);
  // Rotation matrix columns X, Y, Z -> quaternion.
  const m00 = X[0], m01 = Y[0], m02 = Z[0], m10 = X[1], m11 = Y[1], m12 = Z[1], m20 = X[2], m21 = Y[2], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  return [x, y, z, w];
}

/** Set both hands in one call. h = {left:{pos,F,N,pose,pinch}, right:{...}} */
export async function hands(sim, h) {
  const arg = {};
  for (const side of ['left', 'right']) {
    if (!h[side]) continue;
    const s = h[side];
    arg[side] = { pos: s.pos, q: s.F ? handQuat(s.F, s.N) : null, pose: s.pose ?? null, pinch: s.pinch ?? null };
  }
  await sim.dev((d, a) => {
    d.controlMode = 'programmatic';
    for (const side of ['left', 'right']) {
      const s = a[side];
      if (!s) continue;
      const hd = d.hands[side];
      hd.connected = true;
      if (s.pose) hd.poseId = s.pose;
      if (s.pos) hd.position.set(s.pos[0], s.pos[1], s.pos[2]);
      if (s.q) hd.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
      if (s.pinch !== null && s.pinch !== undefined) hd.updatePinchValue(s.pinch);
    }
  }, arg);
}

export const beat = (sim) => sim.eval(() => window.sunsmith?.director?.beat);
export async function waitBeat(sim, name, timeoutMs = 600000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const b = await beat(sim);
    if (b === name) return true;
    await sim.wait(500);
  }
  throw new Error(`timeout waiting for beat ${name}`);
}

/** Put a hand's index fingertip on `target` (world), correcting from the measured tip. */
export async function touch(sim, side, targetOrFn, F = [-1, 0.1, 0.05], N = [0, -0.4, 1]) {
  const get = typeof targetOrFn === 'function' ? targetOrFn : async () => targetOrFn;
  let target = await get();
  let pos = [target[0] - F[0] * 0.08, target[1] - F[1] * 0.08, target[2] - F[2] * 0.08];
  for (let k = 0; k < 6; k++) {
    target = await get();
    await hands(sim, { [side]: { pos, F, N, pose: 'point' } });
    await sim.wait(1200);
    const tip = await sim.eval((s) => window.sunsmith.hands[s].indexTip.toArray(), side);
    const err = [target[0] - tip[0], target[1] - tip[1], target[2] - tip[2]];
    if (Math.hypot(...err) < 0.006) break;
    pos = [pos[0] + err[0], pos[1] + err[1], pos[2] + err[2]];
  }
}
