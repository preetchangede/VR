// Hydrogen rises from the well; open hands sweep through it and it clings.
import { at, cam, hands, enter, ease, span, lerp3, breathe, FWD } from './common.mjs';
export const url = '?beat=gather&fresh';
export const frames = 240;
export async function setup(film) {
  await enter(film);
  // The trailer captions this shot itself; keep the guide's subtitles out of frame.
  await film.eval(() => window.sunsmith.ember.subtitle.mesh.scale.setScalar(0.0001));
  await film.step(0);
}
export async function frame(film, i, t) {
  const p = at(-0.42, 0.44, 0.0).map((v, j) => v + breathe(t, 1.2)[j]);
  await cam(film, p, at(0, 0.13, 0));
  // Hands drift in after the gas rises, then sweep in slow lazy arcs.
  const enterK = ease(span(t, 1.5, 3.2));
  const a = t * 1.25;
  const r = 0.085;
  const L = lerp3(at(-0.34, 0.0, -0.25), at(Math.cos(a) * r, 0.16 + Math.sin(a * 0.8) * 0.05, -0.07 + Math.sin(a) * r), enterK);
  const R = lerp3(at(-0.34, 0.0, 0.25), at(Math.cos(a + 2.6) * r, 0.18 + Math.cos(a * 0.7) * 0.05, 0.07 + Math.sin(a + 2.6) * r), enterK);
  const dirL = [-Math.sin(a), 0, Math.cos(a)];
  await hands(film, {
    left: { pos: L, F: [FWD[0] * 0.8 + dirL[0] * 0.3, 0.15, dirL[2] * 0.3], N: [0.2 * dirL[0], -0.6, 0.6], pose: 'open' },
    right: { pos: R, F: [FWD[0] * 0.8 - dirL[0] * 0.3, 0.15, -dirL[2] * 0.3], N: [-0.2 * dirL[0], -0.6, -0.6], pose: 'open' },
  });
}
