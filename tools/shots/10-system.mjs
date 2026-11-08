// Back on the table: the system you made keeps turning, and keeps singing.
import { at, cam, hands, enter, ease, span, lerp3, REST, F } from './common.mjs';
export const url = '?beat=sandbox&fresh';
export const frames = 240;
export async function setup(film) {
  await enter(film);
  await film.wait(5000);
  await film.eval(() => window.sunsmith.ember.subtitle.mesh.scale.setScalar(0.0001));
}
export async function frame(film, i, t) {
  // A slow orbit around the table, from over the shoulder to the side.
  const a = -0.35 + ease(span(t, 0, 8)) * 0.9;
  const r = 0.62;
  const p = [F[0] + Math.cos(a) * r, F[1] + 0.38 - t * 0.008, F[2] + Math.sin(a) * r];
  await cam(film, p, at(0, 0.14, 0));
  if (i === 0) await hands(film, { left: { ...REST.left, hide: true }, right: { ...REST.right, hide: true } });
}
