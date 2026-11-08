// Stardust pressed into a molten world, carried to the green zone, and set free.
import { at, cam, hands, enter, ease, span, lerp, lerp3, breathe, REST } from './common.mjs';
export const url = '?beat=world-squeeze&fresh';
export const frames = 360;
export async function setup(film) {
  await enter(film);
  await hands(film, {
    left: { pos: at(0.0, 0.19, -0.19), F: [-1, 0.2, 0], N: [0, 0, -1], pose: 'open' },
    right: { pos: at(0.0, 0.19, 0.19), F: [-1, 0.2, 0], N: [0, 0, 1], pose: 'open' },
  });
  await film.wait(4000);
  await film.eval(() => {
    const c = window.sunsmith.cheat;
    for (const k of [1, 2, 3, 4]) { c.hold(0, k, 110); c.hold(1, k, 110); }
    window.sunsmith.ember.subtitle.mesh.scale.setScalar(0.0001);
  });
  await film.wait(1500);
}
export async function frame(film, i, t) {
  const p = at(-0.42, 0.44, 0.02).map((v, j) => v + breathe(t)[j]);
  await cam(film, p, lerp3(at(0.0, 0.17, 0), at(0.06, 0.15, -0.06), ease(span(t, 5, 9))));
  const close = ease(span(t, 0.2, 2.2));
  const apart = ease(span(t, 3.4, 4.4));
  const gap = lerp(0.36, 0.035, close) + apart * 0.4;
  if (t < 4.4) {
    await hands(film, {
      left: { pos: at(0.0 - apart * 0.1, 0.19, -gap / 2), F: [-1, 0.2, 0], N: [0, 0, -1], pose: close > 0.5 && apart < 0.3 ? 'cup' : 'open' },
      right: { pos: at(0.0, 0.19, gap / 2), F: [-1, 0.2, 0], N: [0, 0, 1], pose: close > 0.5 && apart < 0.3 ? 'cup' : 'open' },
    });
    return;
  }
  // Pinch the world, carry it out to the habitable zone, release.
  const w = await film.eval(() => window.sunsmith.director.world?.pos.toArray());
  const grab = span(t, 4.6, 5.4);
  const carry = ease(span(t, 5.4, 8.2));
  const target = at(0.06, 0.17, 0.155);
  const start = w ?? at(0.0, 0.19, 0);
  const tip = lerp3(start, target, carry);
  const pinch = t < 8.4 ? (grab > 0.5 ? 1 : 0) : 0;
  await hands(film, {
    left: { pos: lerp3(at(-0.1, 0.12, -0.22), REST.left.pos, ease(span(t, 4.4, 5.5))), F: [-1, 0, 0], N: [0, -1, 0], pose: 'default' },
    right: { pos: [tip[0] + 0.07, tip[1] + 0.03, tip[2] - 0.02], F: [-1, -0.3, 0.1], N: [0, -0.4, 1], pose: pinch ? 'pinch' : 'open', pinch },
  });
}
