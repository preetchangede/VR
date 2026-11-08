#!/usr/bin/env node
// Screenshots of the planet look-dev page (software GL, so be patient).
//
//   node tools/preview/planet/shoot.mjs                 # the standard set
//   node tools/preview/planet/shoot.mjs grid close-living
//   node tools/preview/planet/shoot.mjs "my=mode=close&p=ice&t=4"   # ad hoc
//   --out <dir>  (default tools/preview/planet/shots)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const STANDARD = {
  grid: 'mode=grid&t=9',
  'grid-dim': 'mode=grid&t=9&dim',
  system: 'mode=system&t=9',
  'system-dim': 'mode=system&t=9&dim',
  strip: 'mode=strip&t=9',
  'close-molten': 'mode=close&p=molten&t=9',
  'close-cooling': 'mode=close&p=cooling&t=9',
  'close-living': 'mode=close&p=living&t=9',
  'close-lava': 'mode=close&p=lava&t=9',
  'close-ice': 'mode=close&p=ice&t=9',
  'close-gas': 'mode=close&p=gas&t=25&dist=0.16',
  'close-gasblue': 'mode=close&p=gasblue&t=12&dist=0.12',
  'close-moon': 'mode=close&p=moon&t=9&dist=0.05',
  'close-dry': 'mode=close&p=dry&t=9',
  'night-living': 'mode=close&p=living&t=9&star=0.06,0.03,-0.2&nostar&dim',
  'night-lava': 'mode=close&p=lava&t=9&star=0.2,0.0,-0.1&nostar&dim',
  highlight: 'mode=close&p=living&t=9&hl=1',
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`cool-${i}`, `mode=cool&f=${(i / 5).toFixed(2)}&t=9`])),
  'mv-living': 'mode=close&p=living&t=9&mv&dist=0.12',
  'mv-system': 'mode=system&t=9&mv&dim',
};

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : 'tools/preview/planet/shots');
const toIdx = args.indexOf('--timeout');
const timeoutMs = toIdx >= 0 ? Number(args[toIdx + 1]) * 1000 : 240000;
const names = args.filter(
  (a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1) && (toIdx < 0 || i !== toIdx + 1),
);
mkdirSync(outDir, { recursive: true });

const jobs = [];
if (names.length === 0) for (const [n, qs] of Object.entries(STANDARD)) jobs.push([n, qs]);
for (const n of names) {
  const eq = n.indexOf('=');
  if (eq > 0 && !STANDARD[n]) jobs.push([n.slice(0, eq), n.slice(eq + 1)]);
  else if (STANDARD[n]) jobs.push([n, STANDARD[n]]);
  else console.warn('unknown shot', n);
}

const browser = await chromium.launch({
  args: ['--ignore-certificate-errors', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text().slice(0, 2000)}`);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

for (const [name, qs] of jobs) {
  const t0 = Date.now();
  await page.goto(`https://localhost:8081/tools/preview/planet/index.html?${qs}`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__done === true, null, { timeout: timeoutMs, polling: 250 });
  } catch (e) {
    console.log(name, 'TIMEOUT', e.message);
  }
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  const info = await page.evaluate(() => window.__info);
  console.log(`${name.padEnd(16)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(info)} -> ${path}`);
}
await browser.close();
