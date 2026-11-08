import { seat } from '../scenarios/lib.mjs';
export const url = '?beat=firstlight';
export const frames = 4;
export async function setup(film) {
  await seat(film);
  await film.page.waitForFunction(() => window.IWER_DEVICE.sessionOffered, null, { timeout: 60000 });
  await film.dev((d) => d.grantOfferedSession());
  await film.page.waitForFunction(() => !!window.IWER_DEVICE.activeSession, null, { timeout: 60000 });
  await film.wait(2000);
  await film.eval(() => {
    const g = window.sunsmith; const orig = g.update.bind(g);
    window.__calls = [];
    g.update = (d, f) => { window.__calls.push([+d.toFixed(4), !!f, new Error().stack.split('\n').slice(2, 6).map((s) => s.trim().slice(0, 80))]); return orig(d, f); };
  });
}
export async function frame(film, i) {
  const c = await film.eval(() => { const c = window.__calls; window.__calls = []; return c; });
  film.log('frame', i, JSON.stringify(c).slice(0, 900));
}
