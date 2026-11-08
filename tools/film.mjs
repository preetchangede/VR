#!/usr/bin/env node
// SUNSMITH film harness: deterministic, frame-stepped capture from the IWER
// emulator. Each rendered frame advances the app exactly 1/fps seconds, so the
// footage is perfectly smooth no matter how slow software rendering is.
//
// Usage: node tools/film.mjs <shot.mjs> --out dir [--w 1280 --h 720 --fps 30]
//
// A shot module exports:
//   export const url = '?beat=...';          // query appended to the app URL
//   export const frames = 150;               // number of frames to capture
//   export async function setup(film) {}     // before capture (enter XR, seat...)
//   export async function frame(film, i, t) {} // per frame: move head/hands, trigger beats
import { chromium } from 'playwright';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const shotPath = args.find((a) => a.endsWith('.mjs'));
const W = +opt('w', 1280);
const H = +opt('h', 720);
const FPS = +opt('fps', 30);
const start = +opt('start', 0);
const outDir = resolve(opt('out', `film-out/${basename(shotPath, '.mjs')}`));
mkdirSync(outDir, { recursive: true });
const shot = await import(pathToFileURL(resolve(shotPath)).href);
const frames = +opt('frames', shot.frames);
const base = opt('base', 'https://localhost:8081/');
const url = `${base}${shot.url ?? ''}${(shot.url ?? '').includes('?') ? '&' : '?'}fixed=${FPS}&cine`;

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-certificate-errors', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
// Manual frame clock: rAF callbacks queue up and only run when we step.
await ctx.addInitScript((fps) => {
  let queue = [];
  let now = 1000;
  let manual = false;
  const realRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    if (!manual) return realRAF(cb);
    queue.push(cb);
    return queue.length;
  };
  window.cancelAnimationFrame = () => {};
  const realNow = performance.now.bind(performance);
  let offset = 0;
  performance.now = () => (manual ? now : realNow() + offset);
  window.__film = {
    manual(on) {
      manual = on;
      now = realNow();
    },
    async step() {
      now += 1000 / fps;
      const q = queue;
      queue = [];
      for (const cb of q) cb(now);
      // Let microtasks / promise-based XR callbacks settle.
      await new Promise((r) => setTimeout(r, 0));
      return q.length;
    },
  };
}, FPS);
const page = await ctx.newPage();
const logFile = `${outDir}/console.log`;
writeFileSync(logFile, '');
page.on('console', (m) => appendFileSync(logFile, `[${m.type()}] ${m.text()}\n`));
page.on('pageerror', (e) => {
  appendFileSync(logFile, `[pageerror] ${e.message}\n`);
  console.log('[pageerror]', e.message);
});

const film = {
  page,
  W,
  H,
  FPS,
  dev: (fn, arg) =>
    page.evaluate(([src, a]) => new Function('return ' + src)()(window.IWER_DEVICE, a), [fn.toString(), arg]),
  eval: (fn, arg) => page.evaluate(fn, arg),
  wait: (ms) => page.waitForTimeout(ms),
  async step(n = 1) {
    for (let i = 0; i < n; i++) await page.evaluate(() => window.__film.step());
  },
  log: (...a) => console.log(`[film]`, ...a),
};

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.IWER_DEVICE && !!window.sunsmith, null, { timeout: 90000 });
await shot.setup(film);
await page.evaluate(() => window.__film.manual(true));
const t0 = Date.now();
for (let i = start; i < frames; i++) {
  const t = i / FPS;
  await shot.frame(film, i, t);
  await film.step();
  await page.screenshot({ path: `${outDir}/f${String(i).padStart(5, '0')}.png`, timeout: 180000 });
  if (i % 15 === 0) {
    const el = (Date.now() - t0) / 1000;
    console.log(`[film] ${basename(shotPath)} frame ${i}/${frames}  ${(el / (i - start + 1)).toFixed(2)} s/frame`);
  }
}
console.log(`[film] done ${frames - start} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outDir}`);
await browser.close();
