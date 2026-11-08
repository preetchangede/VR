// A molten world cools: steam, oceans, clouds... and life spreads.
import { at, cam, hands, enter, ease, span, lerp3, breathe, REST } from './common.mjs';
export const url = '?beat=cooling&fresh';
export const frames = 270;
export async function setup(film) {
  await enter(film);
  await film.wait(3000);
  await film.eval(() => {
    const g = window.sunsmith;
    const w = g.director.world;
    if (w) { w.cooled = 0; w.look.molten = 1; w.look.life = 0; w.living = false; w.flags.delete('cooled'); }
    g.cheat.evolve(1.9);
    g.ember.subtitle.mesh.scale.setScalar(0.0001);
  });
}
export async function frame(film, i, t) {
  // Follow the orbiting world closely as it changes.
  const w = await film.eval(() => window.sunsmith.director.world?.pos.toArray());
  const k = ease(span(t, 0, 3));
  const head = lerp3(at(-0.42, 0.42, 0.0), at(-0.3, 0.32, 0.0), k).map((v, j) => v + breathe(t)[j]);
  await cam(film, head, w ? lerp3(at(0, 0.17, 0), w, 0.75) : at(0, 0.17, 0));
  if (i === 0) await hands(film, REST);
}
