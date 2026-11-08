// Shared helpers for trailer shots (tools/film.mjs).
import { handQuat, yawPitch } from '../scenarios/lib.mjs';

/** Forge center on the sunlit living room's dining table, and the seat facing it. */
export const F = [-0.78, 0.74, 1.35];
export const FWD = [-1, 0, 0]; // from the seat toward the forge
export const RIGHT = [0, 0, -1]; // the seated player's right
/** Point in forge space: fwd (away from player), up, right. */
export const at = (fwd, up, right) => [F[0] + FWD[0] * fwd + RIGHT[0] * right, F[1] + up, F[2] + FWD[2] * fwd + RIGHT[2] * right];

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const smooth = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
export const ease = (t) => {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
/** Map t in [a, b] to 0..1. */
export const span = (t, a, b) => clamp((t - a) / (b - a));

/** Gentle handheld breathing on top of a camera pose. */
export function breathe(t, amp = 1) {
  return [Math.sin(t * 0.7) * 0.004 * amp, Math.sin(t * 0.9 + 1) * 0.003 * amp, Math.cos(t * 0.6) * 0.004 * amp];
}

/** Set the emulated headset: position + look-at target. */
export async function cam(film, pos, target, roll = 0) {
  const dx = target[0] - pos[0];
  const dy = target[1] - pos[1];
  const dz = target[2] - pos[2];
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  let q = yawPitch(yaw, pitch);
  if (roll) {
    const r = [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)];
    q = [
      q[3] * r[0] + q[0] * r[3] + q[1] * r[2] - q[2] * r[1],
      q[3] * r[1] - q[0] * r[2] + q[1] * r[3] + q[2] * r[0],
      q[3] * r[2] + q[0] * r[1] - q[1] * r[0] + q[2] * r[3],
      q[3] * r[3] - q[0] * r[0] - q[1] * r[1] - q[2] * r[2],
    ];
  }
  await film.dev(
    (d, a) => {
      d.controlMode = 'programmatic';
      d.position.set(a.p[0], a.p[1], a.p[2]);
      d.quaternion.set(a.q[0], a.q[1], a.q[2], a.q[3]);
    },
    { p: pos, q },
  );
}

/** Pose both hands. Each: { pos, F (finger dir), N (palm normal), pose, pinch }. */
export async function hands(film, h) {
  const arg = {};
  for (const side of ['left', 'right']) {
    const s = h[side];
    if (!s) continue;
    arg[side] = { pos: s.pos, q: s.F ? handQuat(s.F, s.N) : null, pose: s.pose ?? null, pinch: s.pinch ?? null, hide: !!s.hide };
  }
  await film.dev((d, a) => {
    d.controlMode = 'programmatic';
    for (const side of ['left', 'right']) {
      const s = a[side];
      if (!s) continue;
      const hd = d.hands[side];
      if (s.hide) {
        hd.position.set(0, -5, 0);
        continue;
      }
      if (s.pose && hd.poseId !== s.pose) hd.poseId = s.pose;
      if (s.pos) hd.position.set(s.pos[0], s.pos[1], s.pos[2]);
      if (s.q) hd.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
      if (s.pinch !== null && s.pinch !== undefined) hd.updatePinchValue(s.pinch);
    }
  }, arg);
}

/** Rest both hands low near the table edge (out of the way). */
export const REST = {
  left: { pos: at(-0.36, -0.02, -0.26), F: FWD, N: [0, -1, 0], pose: 'default' },
  right: { pos: at(-0.36, -0.02, 0.26), F: FWD, N: [0, -1, 0], pose: 'default' },
};

/** Seat, enter XR, hide the vase and dev UI, set a cinematic field of view. */
export async function enter(film, { fov = 64, seat = null } = {}) {
  const head = seat ?? [-0.36, 1.16, 1.35];
  await cam(film, head, at(0, 0.12, 0));
  await film.dev((d) => {
    d.primaryInputMode = 'hand';
    if (d.devui) {
      d.devui.devUIContainer.style.display = 'none';
      d.devui.devUICanvas.style.display = 'none';
    }
  });
  await tidyRoom(film);
  await film.page.waitForFunction(() => window.IWER_DEVICE.sessionOffered, null, { timeout: 90000 });
  await film.dev((d, f) => {
    d.stereoEnabled = false;
    d.fovy = (f * Math.PI) / 180;
    d.grantOfferedSession();
  }, fov);
  await film.page.waitForFunction(() => !!window.IWER_DEVICE.activeSession, null, { timeout: 90000 });
  await cam(film, head, at(0, 0.12, 0));
  await hands(film, REST);
  const removed = await tidyRoom(film);
  console.log('[film] set dressing removed triangles:', removed);
}

/** Film set dressing: remove the vase from the dining table (render + scan). */
export const VASE_BOX = { min: [-1.09, 0.745, 1.21], max: [-0.81, 1.15, 1.49] };
export async function tidyRoom(film) {
  return film.dev((d, b) => {
    window.__sunsmithExclude = [b];
    const scene = d.sem && d.sem.scene;
    if (!scene) return 0;
    let removed = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const g = o.geometry;
      const pos = g.attributes.position;
      const v = new (o.position.constructor)();
      const m = o.matrixWorld;
      const inside = (i) => {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        return v.x > b.min[0] && v.x < b.max[0] && v.y > b.min[1] && v.y < b.max[1] && v.z > b.min[2] && v.z < b.max[2];
      };
      const n = g.index ? g.index.count : pos.count;
      const get = (k) => (g.index ? g.index.getX(k) : k);
      const keep = [];
      for (let t = 0; t < n; t += 3) {
        const a = get(t), bb = get(t + 1), c = get(t + 2);
        if (inside(a) && inside(bb) && inside(c)) { removed++; continue; }
        keep.push(a, bb, c);
      }
      if (keep.length < n) g.setIndex(keep);
    });
    return removed;
  }, VASE_BOX);
}
