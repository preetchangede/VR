import type { World } from '@iwsdk/core';

/**
 * The 2D page judges see first in Meta Quest Browser: one big pinchable
 * button. Also paints a slow starfield behind it.
 */
export function setupLanding(world: World) {
  const landing = document.getElementById('landing')!;
  const begin = document.getElementById('begin') as HTMLButtonElement;
  const status = document.getElementById('status')!;
  paintStars(document.getElementById('stars') as HTMLCanvasElement);

  const xr = navigator.xr;
  let arSupported = false;
  if (!xr) {
    status.textContent = 'Open this page in the Meta Quest Browser to begin.';
  } else {
    xr.isSessionSupported('immersive-ar')
      .then((ok) => {
        if (ok) {
          arSupported = true;
          begin.disabled = false;
        } else {
          status.textContent = 'Mixed reality is not available here. Open this page in the Meta Quest Browser.';
        }
      })
      .catch(() => {
        status.textContent = 'Could not query XR support.';
      });
  }

  begin.addEventListener('click', () => {
    begin.disabled = true;
    status.textContent = '';
    window.dispatchEvent(new Event('sunsmith:gesture'));
    try {
      world.launchXR();
    } catch (e) {
      status.textContent = `Could not start: ${(e as Error).message}`;
      begin.disabled = false;
    }
  });

  const sync = () => {
    const inXR = !!world.session;
    landing.classList.toggle('hidden', inXR);
    if (!inXR) begin.disabled = !arSupported || world.sessionRequestPending;
  };
  setInterval(sync, 500);
}

function paintStars(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const stars = Array.from({ length: 220 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.3 + 0.2,
    p: Math.random() * Math.PI * 2,
    s: 0.3 + Math.random() * 1.2,
  }));
  const draw = (t: number) => {
    const w = (canvas.width = canvas.clientWidth);
    const h = (canvas.height = canvas.clientHeight);
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = 0.35 + 0.35 * Math.sin(t * 0.001 * s.s + s.p);
      ctx.fillStyle = `rgba(255, 240, 220, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!document.hidden && document.getElementById('landing')?.classList.contains('hidden') === false) {
      requestAnimationFrame(draw);
    } else setTimeout(() => requestAnimationFrame(draw), 1000);
  };
  requestAnimationFrame(draw);
}
