// Opening: a quiet room, a table... and the tabletop opens onto deep space.
import { at, cam, enter, hands, REST, ease, span, lerp3, breathe } from './common.mjs';
export const url = '?fresh';
export const frames = 210;
export async function setup(film) {
  await enter(film);
}
export async function frame(film, i, t) {
  const k = ease(span(t, 0, 7));
  const p = lerp3(at(-0.78, 0.66, 0.12), at(-0.44, 0.43, 0.02), k).map((v, j) => v + breathe(t)[j]);
  await cam(film, p, lerp3(at(0, 0.1, 0), at(0, 0.02, 0), k));
  if (i === 0) await hands(film, REST);
}
