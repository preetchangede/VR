// Renders transparent 1920x1080 title-card PNGs with HTML/CSS typography.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'film-out/titles';
mkdirSync(out, { recursive: true });

const style = `
  html,body{margin:0;width:1920px;height:1080px;background:transparent;overflow:hidden;font-family:'Avenir Next','Segoe UI','Helvetica Neue',Inter,sans-serif;}
  .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#f7eddd;}
  .line{font-weight:300;font-size:58px;letter-spacing:0.04em;text-shadow:0 0 30px rgba(0,0,0,.65),0 0 60px rgba(255,170,90,.25);}
  .small{font-weight:300;font-size:30px;letter-spacing:.32em;text-transform:uppercase;color:#e9d8bf;margin-top:26px;text-shadow:0 0 20px rgba(0,0,0,.7);}
  .logo{font-weight:200;font-size:150px;letter-spacing:.42em;padding-left:.42em;text-shadow:0 0 40px rgba(255,180,90,.55),0 0 120px rgba(255,120,60,.35);}
  .low{justify-content:flex-end;padding-bottom:120px;}
  .sun{width:120px;height:120px;border-radius:50%;margin-bottom:40px;background:radial-gradient(circle at 45% 42%,#fffaf0 0%,#ffe3a3 22%,#ffb25a 48%,#ff6a3d 72%,rgba(255,90,40,0) 74%);box-shadow:0 0 70px 24px rgba(255,160,80,.45),0 0 180px 70px rgba(255,110,50,.22);}
  .end{font-weight:300;font-size:30px;letter-spacing:.18em;color:#e8dcc8;margin-top:34px;}
  .tiny{font-weight:300;font-size:22px;letter-spacing:.2em;color:#bdb2a2;margin-top:20px;text-transform:uppercase;}
`;
const cards = {
  'atom': `<div class="c"><div class="line">Every atom in your hand was forged in a star.</div></div>`,
  'yourturn': `<div class="c"><div class="line">Now it's your turn.</div></div>`,
  'logo': `<div class="c"><div class="logo">SUNSMITH</div></div>`,
  'forge': `<div class="c low"><div class="line">Forge suns between your palms.</div></div>`,
  'build': `<div class="c low"><div class="line">Build a world from their ashes.</div></div>`,
  'stand': `<div class="c low"><div class="line">Then stand on it.</div></div>`,
  'mr': `<div class="c low"><div class="small">On your real table · With your bare hands</div></div>`,
  'end': `<div class="c"><div class="sun"></div><div class="logo" style="font-size:120px">SUNSMITH</div><div class="end">Hands-only mixed reality for Meta Quest 3</div><div class="tiny">Built with the Immersive Web SDK · Captured in Meta's IWER emulator</div></div>`,
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, body] of Object.entries(cards)) {
  await page.setContent(`<html><head><style>${style}</style></head><body>${body}</body></html>`);
  await page.screenshot({ path: `${out}/${name}.png`, omitBackground: true });
  console.log('title', name);
}
await browser.close();
