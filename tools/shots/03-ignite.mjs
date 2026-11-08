// The squeeze: palms close on the glowing cloud... first light.
import { at, cam, hands, enter, ease, span, lerp, lerp3, breathe } from './common.mjs';
export const url = '?beat=squeeze&fresh';
export const frames = 330;
export async function setup(film) {
  await enter(film);
  // Start with gas already gathered in both palms.
  await hands(film, {
    left: { pos: at(0.04, 0.19, -0.2), F: [-1, 0.2, 0], N: [0, 0, -1], pose: 'open' },
    right: { pos: at(0.04, 0.19, 0.2), F: [-1, 0.2, 0], N: [0, 0, 1], pose: 'open' },
  });
  await film.wait(2500);
  await film.eval(() => { window.sunsmith.cheat.hold(0, 0, 330); window.sunsmith.cheat.hold(1, 0, 330); });
  await film.wait(1500);
}
export async function frame(film, i, t) {
  // Lean in as the squeeze builds, settle back after ignition.
  const lean = ease(span(t, 0, 3.5)) * (1 - 0.6 * ease(span(t, 6.0, 9.0)));
  const p = lerp3(at(-0.44, 0.44, 0.02), at(-0.33, 0.36, 0.0), lean).map((v, j) => v + breathe(t)[j]);
  await cam(film, p, at(0, 0.17, 0));
  const close = ease(span(t, 0.4, 3.0));
  const apart = ease(span(t, 5.6, 7.2));
  const gap = lerp(0.36, 0.035, close) + apart * 0.42;
  const cup = close > 0.5 ? 'cup' : 'open';
  await hands(film, {
    left: { pos: at(0.04 - apart * 0.12, 0.19 - apart * 0.08, -gap / 2), F: [-1, 0.25, 0], N: [0, 0, -1], pose: apart > 0.3 ? 'default' : cup },
    right: { pos: at(0.04 - apart * 0.12, 0.19 - apart * 0.08, gap / 2), F: [-1, 0.25, 0], N: [0, 0, 1], pose: apart > 0.3 ? 'default' : cup },
  });
}
