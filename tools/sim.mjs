#!/usr/bin/env node
// SUNSMITH simulator harness.
//
// Drives the app inside IWER (Meta's Immersive Web Emulation Runtime, injected
// by @iwsdk/vite-plugin-dev on localhost) with headless Chromium, so every
// interaction can be scripted and screenshotted without a headset.
//
// Usage:
//   node tools/sim.mjs <scenario.mjs> [--out dir] [--w 1024] [--h 768]
//                      [--url https://localhost:8081/] [--stereo] [--headed]
//
// A scenario exports `default async function (sim)`; see tools/scenarios/.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const scenarioPath = args.find((a) => !a.startsWith('--') && a.endsWith('.mjs'));
if (!scenarioPath) {
  console.error('usage: node tools/sim.mjs <scenario.mjs> [--out dir]');
  process.exit(1);
}
const W = +opt('w', 1024);
const H = +opt('h', 768);
const outDir = resolve(opt('out', `sim-out/${basename(scenarioPath, '.mjs')}`));
const url = opt('url', 'https://localhost:8081/');
mkdirSync(outDir, { recursive: true });
const logFile = `${outDir}/console.log`;
writeFileSync(logFile, '');

const browser = await chromium.launch({
  headless: !flag('headed'),
  args: [
    '--ignore-certificate-errors',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();
let errorCount = 0;
page.on('console', (m) => {
  const line = `[${m.type()}] ${m.text()}`;
  if (m.type() === 'error') errorCount++;
  appendFileSync(logFile, line + '\n');
  if (flag('verbose') || m.type() === 'error') console.log(line.slice(0, 400));
});
page.on('pageerror', (e) => {
  errorCount++;
  const line = `[pageerror] ${e.message}\n${e.stack}`;
  appendFileSync(logFile, line + '\n');
  console.log(line.slice(0, 600));
});
page.on('crash', () => console.log('[sim] PAGE CRASHED'));

const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const log = (...a) => console.log(`[sim ${elapsed()}]`, ...a);

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.IWER_DEVICE, null, { timeout: 60000 });
log('IWER device ready');

const sim = {
  page,
  outDir,
  log,
  wait: (ms) => page.waitForTimeout(ms),
  /** Evaluate fn(device, arg) in the page. */
  dev: (fn, arg) =>
    page.evaluate(
      ([src, a]) => {
        // eslint-disable-next-line no-new-func
        const f = new Function('return ' + src)();
        return f(window.IWER_DEVICE, a);
      },
      [fn.toString(), arg],
    ),
  /** Evaluate fn(arg) in the page with access to window. */
  eval: (fn, arg) => page.evaluate(fn, arg),
  async shot(name) {
    const path = `${outDir}/${name}.png`;
    await page.screenshot({ path, timeout: 120000 });
    log('shot', path);
    return path;
  },
  async enterXR({ stereo = flag('stereo') } = {}) {
    await page.waitForFunction(() => window.IWER_DEVICE.sessionOffered, null, {
      timeout: 60000,
    });
    await sim.dev(
      (d, s) => {
        d.stereoEnabled = s;
        d.grantOfferedSession();
      },
      stereo,
    );
    await page.waitForFunction(() => !!window.IWER_DEVICE.activeSession, null, {
      timeout: 60000,
    });
    log('XR session active');
  },
  /** Measure rendered frames per second over `ms` of wall time. */
  async fps(ms = 3000) {
    return page.evaluate(
      (dur) =>
        new Promise((res) => {
          const s = window.IWER_DEVICE.activeSession;
          let n = 0;
          const start = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - start < dur) {
              s ? s.requestAnimationFrame(tick) : requestAnimationFrame(tick);
            } else res((n * 1000) / (performance.now() - start));
          };
          s ? s.requestAnimationFrame(tick) : requestAnimationFrame(tick);
        }),
      ms,
    );
  },
};

try {
  const mod = await import(pathToFileURL(resolve(scenarioPath)).href);
  await mod.default(sim);
} catch (e) {
  console.error('[sim] scenario failed:', e);
  process.exitCode = 1;
} finally {
  log(`done, ${errorCount} console errors (log: ${logFile})`);
  await browser.close();
}
