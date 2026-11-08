// Touch your world... and your room burns away into space.
import { at, cam, hands, enter, ease, span, lerp3, breathe, REST } from './common.mjs';
export const url = '?beat=visit-prompt&fresh';
export const frames = 270;
export async function setup(film) {
  await enter(film);
  await film.wait(3000);
  await film.eval(() => window.sunsmith.ember.subtitle.mesh.scale.setScalar(0.0001));
}
export async function frame(film, i, t) {
  const w = await film.eval(() => window.sunsmith.director.world?.pos.toArray());
  const head = at(-0.42, 0.44, 0.0).map((v, j) => v + breathe(t)[j]);
  const beat = await film.eval(() => window.sunsmith.director.beat);
  const look = beat === 'visit-prompt' && w ? lerp3(at(0, 0.17, 0), w, 0.6) : lerp3(at(0, 0.2, 0.06), at(-0.6, 0.6, 0.1), ease(span(t, 3.5, 9)));
  await cam(film, head, look);
  // Reach out and touch the world with an index finger.
  const reach = ease(span(t, 0.3, 1.6));
  if (beat === 'visit-prompt' && w) {
    const tip = lerp3(REST.right.pos, w, reach);
    await hands(film, { left: REST.left, right: { pos: [tip[0] + 0.15, tip[1] + 0.02, tip[2] - 0.02], F: [-1, -0.15, 0.1], N: [0, -0.5, 1], pose: 'point' } });
  } else {
    await hands(film, { left: REST.left, right: { ...REST.right, pos: lerp3(at(0, 0.2, 0.12), REST.right.pos, ease(span(t, 1.8, 3.5))) } });
  }
}
