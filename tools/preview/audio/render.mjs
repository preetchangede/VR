#!/usr/bin/env node
// Render SUNSMITH audio offline in headless Chromium and save 16-bit stereo WAVs.
//
//   node tools/preview/audio/render.mjs                 # everything
//   node tools/preview/audio/render.mjs ignite trailer   # jobs whose name contains any filter
//   node tools/preview/audio/render.mjs --list
//   [--url https://localhost:8081/tools/preview/audio/index.html] [--out tools/preview/audio/out]
//
// Needs the Vite dev server (npm run dev) on https://localhost:8081.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const valued = new Set(['--url', '--out']);
const filters = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const url = opt('url', 'https://localhost:8081/tools/preview/audio/index.html');
const outDir = resolve(opt('out', resolve(here, 'out')));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  // --expose-gc: Chromium wedges after a few uncollected OfflineAudioContexts in one page, so we
  // collect garbage after every render.
  args: ['--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--js-flags=--expose-gc'],
});
let context = await browser.newContext({ ignoreHTTPSErrors: true });
let page = await context.newPage();
let errors = 0;
function watch(p) {
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      if (m.type() === 'error') errors++;
      console.log(`[page ${m.type()}] ${m.text().slice(0, 400)}`);
    }
  });
  p.on('pageerror', (e) => {
    errors++;
    console.log(`[pageerror] ${e.message}`);
  });
}
watch(page);

// Other people edit the repo while renders run: never let a Vite HMR full-reload kill a render.
const viteClientStub = `
const hot = { data: {}, accept() {}, acceptExports() {}, dispose() {}, prune() {}, invalidate() {}, decline() {}, on() {}, off() {}, send() {} };
export const createHotContext = () => hot;
export const updateStyle = (id, css) => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
export const removeStyle = () => {};
export const injectQuery = (u) => u;
export class ErrorOverlay {}
`;
async function stubs(ctx) {
  await ctx.route('**/@vite/client', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: viteClientStub }));
  // The IWSDK dev plugin injects its XR emulator into every page; the audio harness needs none of it.
  await ctx.route('**/@iwer-injection-runtime', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export {}' }));
}
await stubs(context);

async function load(fresh = false) {
  if (fresh) {
    // A wedged renderer cannot even navigate: abandon it and start over in a new
    // browser context (which guarantees a new renderer process).
    context.close().catch(() => {});
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    await stubs(context);
    page = await context.newPage();
    watch(page);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.auditionReady === true, null, { timeout: 90000 });
  if (args.includes('--verbose')) await page.evaluate(() => (window.auditionVerbose = true));
}
await load();
const jobs = await page.evaluate(() => window.audition.jobs());

/** Render one job; on a hang or a lost page, reload and retry once. */
async function renderJob(j) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const limit = 30000 + j.seconds * 4000;
      return await Promise.race([
        page.evaluate((n) => window.audition.render(n), j.name),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${limit / 1000}s`)), limit)),
      ]);
    } catch (e) {
      console.log(`[render] ${j.name} attempt ${attempt + 1} failed: ${e.message}`);
      await load(true);
    }
  }
  throw new Error(`${j.name} failed three times`);
}
if (args.includes('--list')) {
  for (const j of jobs) console.log(`${j.name.padEnd(32)} ${j.seconds}s`);
  await browser.close();
  process.exit(0);
}
const selected = filters.length ? jobs.filter((j) => filters.some((f) => j.name.includes(f))) : jobs;
const all = [];
const t0 = Date.now();
for (const j of selected) {
  const s = await renderJob(j);
  const parts = [];
  const CH = 3 * 1024 * 1024;
  for (let i = 0; i * CH < s.bytes; i++) {
    parts.push(Buffer.from(await page.evaluate((k) => window.audition.chunk(k), i), 'base64'));
  }
  writeFileSync(resolve(outDir, `${j.name}.wav`), Buffer.concat(parts));
  if (s.cues) {
    const lines = s.cues.map(([t, label]) => `${t.toFixed(3).padStart(8)} s  ${label}`);
    writeFileSync(resolve(outDir, `${j.name}_cues.txt`), `# ${j.name}.wav — scheduled hit times (48 kHz, sample-accurate)\n${lines.join('\n')}\n`);
    delete s.cues;
  }
  await page.evaluate(() => {
    window.audition.release();
    window.gc?.();
  });
  all.push(s);
  console.log(
    `${j.name.padEnd(30)} peak ${s.peakDb.toFixed(1).padStart(6)} dBFS  rms ${s.rmsDb.toFixed(1).padStart(6)} dBFS  ` +
      `nan ${s.nonFinite}  clip ${s.clipped}  nodes≤${s.maxNodes} hrtf≤${s.maxPanners} voices≤${s.maxVoices}  ` +
      `(${(s.renderMs / 1000).toFixed(1)} s render for ${s.seconds.toFixed(0)} s)`,
  );
}
writeFileSync(resolve(outDir, filters.length ? 'render-stats.partial.json' : 'render-stats.json'), JSON.stringify(all, null, 2));
console.log(`rendered ${all.length} files to ${outDir} in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${errors} page errors`);
await browser.close();
process.exit(errors ? 1 : 0);
