// A blue giant, a million years in a breath: it swells past your fingers.
import { at, cam, hands, enter, ease, span, lerp3, breathe, REST } from './common.mjs';
export const url = '?beat=giant-life&fresh';
export const frames = 345;
export async function setup(film) {
  await enter(film);
  await film.wait(4000);
  await film.eval(() => { window.sunsmith.cheat.speed(1.08); window.sunsmith.cheat.swell(); window.sunsmith.ember.subtitle.mesh.scale.setScalar(0.0001); });
}
export async function frame(film, i, t) {
  const k = ease(span(t, 0, 11.5));
  const p = lerp3(at(-0.46, 0.4, 0.05), at(-0.4, 0.33, -0.04), k).map((v, j) => v + breathe(t)[j]);
  await cam(film, p, lerp3(at(-0.1, 0.18, 0), at(-0.2, 0.24, 0.02), k));
  // A hand reaches toward the swelling giant.
  const reach = ease(span(t, 6.0, 9.5));
  await hands(film, {
    left: REST.left,
    right: { pos: lerp3(REST.right.pos, at(-0.12, 0.2, 0.06), reach), F: [-1, 0.25, -0.15], N: [0.1, -0.3, 1], pose: 'open' },
  });
}
