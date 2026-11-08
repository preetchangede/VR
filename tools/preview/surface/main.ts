/**
 * Standalone preview of the dawn surface scene (no XR, no IWSDK world).
 *
 *   /tools/preview/surface/?dawn=0.35&yaw=0&pitch=8&fov=90&t=12
 *     dawn   0..1 sunrise progress
 *     yaw    degrees, + = look right
 *     pitch  degrees, + = look up
 *     fov    vertical field of view
 *     t      scene time (s) for animated waves/particles
 *     seed, rings=0|1, moon=0|1, life=0..1, phase=0..1, star=sun|red|blue
 *     anim   keep rendering (interactive: drag to look, wheel = dawn)
 */
import { Color, NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from '@iwsdk/core';
import { SurfaceScene } from '../../../src/surface/surface';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? parseFloat(q.get(k) as string) : d);
const D = Math.PI / 180;

let dawn = num('dawn', 0.3);
let yaw = num('yaw', 0);
let pitch = num('pitch', 8);
const fov = num('fov', 90);
let time = num('t', 12);
const anim = q.has('anim');

const stars: Record<string, string> = { sun: '#ffe6b8', red: '#ff9a52', blue: '#cfe0ff', white: '#f4f6ff' };
const sunHex = stars[q.get('star') || 'sun'] || '#ffe6b8';
/** The game stores display-space numbers in Color (see core/math blackbody()). */
const disp = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return new Color().setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// ?alphacheck: render into an alpha canvas cleared to alpha 0 and verify every
// pixel ends at alpha 1 (anything less would let passthrough show in MR)
const alphaCheck = q.has('alphacheck');
const renderer = new WebGLRenderer({ antialias: true, alpha: alphaCheck, premultipliedAlpha: false, preserveDrawingBuffer: true });
if (alphaCheck) renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = NoToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(fov, innerWidth / innerHeight, 0.01, 400);
camera.position.set(0, 1.15, 0);
camera.rotation.order = 'YXZ';

const opts = () => ({
  sunColor: disp(sunHex),
  sunSize: num('size', 1),
  oceanColor: disp('#0b3a4a'),
  landColor: disp('#5a4a42'),
  lifeColor: disp(q.get('lifec') ? '#' + q.get('lifec') : '#2fd6a0'),
  lifeAmount: num('life', 0.85),
  hasMoon: num('moon', 1) > 0,
  moonPhase: num('phase', 0.22),
  nebulaColors: q.has('neb')
    ? (q.get('neb') as string).split(',').map((h) => disp('#' + h))
    : [disp('#3fe6c8'), disp('#ff7a3d'), disp('#a98bff'), disp('#ffc96b')],
  hasRings: num('rings', 1) > 0,
  seed: num('seed', 7),
});
// ?bench=N: construct N extra times first (cold vs warm JIT cost)
const benches: unknown[] = [];
for (let i = 0; i < num('bench', 0); i++) {
  const tb = performance.now();
  const s = new SurfaceScene(opts());
  benches.push({ ms: Math.round(performance.now() - tb), ...s.buildTimes });
  s.dispose();
}
if (benches.length) console.log('[surface] bench', JSON.stringify(benches));
const t0 = performance.now();
const surface = new SurfaceScene(opts());
const buildMs = performance.now() - t0;
scene.add(surface.group);
surface.setFade(1);
// ?rot=deg&tx=m&tz=m: place the group like an integrator would (rotated and
// moved); the camera follows so the frame should look identical.
const rot = num('rot', 0) * D;
surface.group.rotation.y = rot;
surface.group.position.set(num('tx', 0), num('ty', 0), num('tz', 0));

const head = new Vector3();
const hud = document.getElementById('hud') as HTMLDivElement;
function frame(dt: number) {
  camera.rotation.set(pitch * D, -yaw * D + rot, 0);
  camera.position.set(0, 1.15, 0).applyAxisAngle(new Vector3(0, 1, 0), rot).add(surface.group.position);
  camera.updateMatrixWorld();
  camera.getWorldPosition(head);
  surface.setDawn(dawn);
  surface.update(dt, time, head);
  renderer.render(scene, camera);
}

let frames = 0;
const breakdown = () => {
  const out: Record<string, number> = {};
  surface.group.traverse((o) => {
    const m = o as unknown as { isMesh?: boolean; name: string; geometry: { index: { count: number } | null; attributes: { position: { count: number } }; instanceCount?: number } };
    if (!m.isMesh) return;
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    out[m.name] = Math.round(tris * (g.instanceCount && g.instanceCount !== Infinity ? g.instanceCount : 1));
  });
  return out;
};
const info = () => ({ ...renderer.info.render, buildMs: Math.round(buildMs), programs: renderer.info.programs?.length, build: surface.buildTimes, tris: breakdown() });
function tick() {
  frame(1 / 72);
  frames++;
  if (anim) {
    time += 1 / 60;
    hud.textContent = `dawn ${dawn.toFixed(3)}  yaw ${yaw.toFixed(0)}  pitch ${pitch.toFixed(0)}  calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`;
    requestAnimationFrame(tick);
  } else if (frames < 3) {
    requestAnimationFrame(tick);
  } else {
    const i = info();
    console.log('[surface] renderer.info.render', JSON.stringify(i));
    if (alphaCheck) {
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let minA = 255;
      let below = 0;
      for (let k = 3; k < px.length; k += 4) {
        if (px[k] < minA) minA = px[k];
        if (px[k] < 255) below++;
      }
      console.log('[surface] alphacheck min alpha', minA, 'pixels below 255:', below, 'of', w * h);
    }
    (window as unknown as { __surfaceInfo: unknown }).__surfaceInfo = i;
    (window as unknown as { __ready: boolean }).__ready = true;
  }
}
requestAnimationFrame(tick);

if (anim) {
  let drag = false;
  let lx = 0;
  let ly = 0;
  addEventListener('pointerdown', (e) => ((drag = true), (lx = e.clientX), (ly = e.clientY)));
  addEventListener('pointerup', () => (drag = false));
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - lx) * 0.15;
    pitch += (e.clientY - ly) * 0.15;
    lx = e.clientX;
    ly = e.clientY;
  });
  addEventListener('wheel', (e) => (dawn = Math.min(1, Math.max(0, dawn + e.deltaY * 0.0005))));
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
