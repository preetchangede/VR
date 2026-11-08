// Screenshot the dawn surface preview with headless Chromium (SwiftShader).
//
//   node tools/preview/surface/shoot.mjs [name:query ...] [--out dir] [--w 1280 --h 720]
//   e.g. node tools/preview/surface/shoot.mjs fwd35:"dawn=0.35" up:"dawn=0.1&pitch=60"
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const outDir = resolve(opt('out', 'tools/preview/surface/shots'));
const W = +opt('w', 1280), H = +opt('h', 720);
const base = opt('url', 'https://localhost:8081/tools/preview/surface/index.html');
const jobs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--ignore-certificate-errors', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
for (const job of jobs.length ? jobs : ['default:dawn=0.35']) {
  const [name, query = ''] = job.split(/:(.*)/s);
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[surface]')) console.log(`[${name}] ${m.type()}: ${m.text().slice(0, 1500)}`); });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto(`${base}?${query}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  } catch (e) {
    console.log(`[${name}] timeout waiting for render`);
  }
  // hide any injected emulator overlay
  await page.addStyleTag({ content: 'body > *:not(canvas):not(#hud){display:none!important} #hud{display:none!important}' }).catch(() => {});
  await page.waitForTimeout(300);
  const path = `${outDir}/${name}.png`;
  await page.locator('canvas').first().screenshot({ path, timeout: 120000 });
  console.log(`[${name}] ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path}`);
  await page.close();
}
await browser.close();
