// Dawn on the world you made: your sun rises over your ocean.
import { at, cam, hands, ease, span, enter, lerp3, REST, F } from './common.mjs';
export const url = '?beat=dawn&fresh';
export const frames = 330;
export async function setup(film) {
  await enter(film, { fov: 70 });
  await hands(film, { left: { ...REST.left, hide: true }, right: { ...REST.right, hide: true } });
  await film.wait(8000);
  await film.eval(() => { window.sunsmith.ember.subtitle.mesh.scale.setScalar(0.0001); window.sunsmith.cheat.dawn(4.5); });
}
export async function frame(film, i, t) {
  const head = [-0.36, 1.16, 1.35];
  // Look at the horizon where the sun rises, then drift up toward the nebula.
  const up = ease(span(t, 6.5, 11));
  const look = lerp3([head[0] - 3, head[1] + 0.05, head[2] + 0.4], [head[0] - 2, head[1] + 1.8, head[2] - 0.6], up);
  await cam(film, head, look);
}
