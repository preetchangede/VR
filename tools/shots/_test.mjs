import { seat } from '../scenarios/lib.mjs';
export const url = '?beat=firstlight';
export const frames = 5;
export async function setup(film) {
  await seat(film);
  await film.page.waitForFunction(() => window.IWER_DEVICE.sessionOffered, null, { timeout: 60000 });
  await film.dev((d) => d.grantOfferedSession());
  await film.page.waitForFunction(() => !!window.IWER_DEVICE.activeSession, null, { timeout: 60000 });
  await seat(film);
  await film.wait(3000);
}
export async function frame(film, i) {
  const t = await film.eval(() => window.sunsmith.clock.time.toFixed(3));
  film.log('frame', i, 'game time', t);
}
