// Collapse. Silence. Supernova: the room fills with newborn elements and a pulsar.
import { at, cam, hands, enter, ease, span, lerp3, breathe, REST, F } from './common.mjs';
export const url = '?beat=giant-life&fresh';
export const frames = 330;
export async function setup(film) {
  await enter(film);
  await film.wait(4000);
  await film.eval(() => {
    const g = window.sunsmith;
    g.cheat.supergiant(0.3);
    g.ember.subtitle.mesh.scale.setScalar(0.0001);
    // Clear the stale "blue giant" toast; the supernova's own toast may show.
    g.toasts.length = 0;
    g.panelTimer = 0;
    g.panel.targetOpacity = 0;
    g.panel.opacity = 0;
  });
  await film.wait(3000);
}
export async function frame(film, i, t) {
  if (i === 40) await film.eval(() => window.sunsmith.cheat.go('collapse'));
  // Hold on the dying giant, then turn to watch the room fill with stardust.
  const turn = ease(span(t, 2.6, 8.5));
  const head = at(-0.42, 0.44, 0.0).map((v, j) => v + breathe(t, 1.5)[j]);
  const look = lerp3(at(-0.2, 0.24, 0.02), [F[0] - 0.6, F[1] + 0.95, F[2] + 1.1], turn);
  await cam(film, head, look);
  if (i === 0) await hands(film, REST);
}
