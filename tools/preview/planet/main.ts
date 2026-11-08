/**
 * Planet look-dev page. Served by the dev server at
 *   https://localhost:8081/tools/preview/planet/index.html
 *
 * URL params:
 *   mode=grid            all showcase worlds (default)
 *   mode=close&p=living  one world up close (p = molten|cooling|living|lava|ice|gas|moon|...)
 *   mode=strip           the cooling transition as a row of 6 (same seed)
 *   mode=cool&f=0.4      one cooling-sequence frame up close (f = 0..1)
 *   t=12                 time in seconds (spin, flow, drift)
 *   dist=0.16            camera distance for close modes
 *   nostar               hide the star (for per-planet renderer.info)
 *   dim                  darken the "passthrough" like the in-game room dim
 *   star=x,y,z           star position
 *   hl=0.8               highlight amount
 *   mv                   render both eyes through the real OVR_multiview2 path
 *                        (the program variant Quest uses) and show them side by side
 */
import {
  ArrayCamera,
  Color,
  DepthFormat,
  DepthTexture,
  Group,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  UnsignedIntType,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from '@iwsdk/core';
import { PlanetVisual, type PlanetLook } from '../../../src/render/planet';
import { StarVisual } from '../../../src/render/star';
import { blackbody } from '../../../src/core/math';

const q = new URLSearchParams(location.search);
const T = Number(q.get('t') ?? 9);
const mode = q.get('mode') ?? 'grid';
const W = window.innerWidth;
const H = window.innerHeight;
if (q.has('dim')) document.body.classList.add('dim');

if (q.has('mv')) {
  // Desktop Chrome exposes OVR_multiview2; three (like Quest Browser) asks for
  // OCULUS_multiview. Alias it so three takes its real multiview code path.
  const proto = WebGL2RenderingContext.prototype;
  const orig = proto.getExtension;
  proto.getExtension = function (this: WebGL2RenderingContext, name: string) {
    return orig.call(this, name === 'OCULUS_multiview' ? 'OVR_multiview2' : name);
  } as typeof proto.getExtension;
}
const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = NoToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);
PlanetVisual.pixelsPerRadian = H / 2 / Math.tan((35 * Math.PI) / 180);

const scene = new Scene();
const camera = new PerspectiveCamera(70, W / H, 0.005, 10);

// ------------------------------------------------------------------ looks
const jupiter = () => [new Color('#e9d2b0'), new Color('#c0814f'), new Color('#f4e6cc'), new Color('#9b5f3a')];
function look(o: Partial<PlanetLook>): PlanetLook {
  return {
    kind: 'rocky',
    seed: 1,
    radius: 0.034,
    molten: 0,
    ocean: 0,
    ice: 0,
    clouds: 0,
    life: 0,
    atmosphere: new Color(0.45, 0.7, 1.0),
    bands: jupiter(),
    rings: 0,
    dustTint: new Color(1, 0.6, 0.4),
    ...o,
  };
}
const HOT = () => new Color(1.0, 0.55, 0.3);
const COLD = () => new Color(0.75, 0.88, 1.0);
const presets: Record<string, PlanetLook> = {
  molten: look({ seed: 11, molten: 1, atmosphere: HOT(), dustTint: new Color(1, 0.5, 0.25) }),
  cooling: look({ seed: 23, molten: 0.4, ocean: 0.2, clouds: 0.12, atmosphere: new Color(0.6, 0.65, 0.9) }),
  living: look({ seed: 37, ocean: 0.6, clouds: 0.5, life: 0.8, ice: 0.12, dustTint: new Color(0.25, 0.9, 0.8) }),
  lava: look({ seed: 41, molten: 0.85, clouds: 0.3, atmosphere: HOT(), dustTint: new Color(1, 0.48, 0.24) }),
  ice: look({ seed: 53, ocean: 0.35, ice: 1, clouds: 0.15, atmosphere: COLD(), dustTint: new Color(0.66, 0.55, 1) }),
  gas: look({ kind: 'gas', seed: 61, radius: 0.044, rings: 0.9, bands: jupiter(), atmosphere: new Color('#c0814f') }),
  gasblue: look({
    kind: 'gas',
    seed: 67,
    radius: 0.04,
    bands: [new Color('#bfe0ef'), new Color('#6aa3c9'), new Color('#e6f3f8'), new Color('#4b7aa6')],
  }),
  moon: look({ kind: 'moon', seed: 71, radius: 0.016, molten: 0, atmosphere: new Color(0, 0, 0) }),
  dry: look({ seed: 83, ocean: 0, clouds: 0, dustTint: new Color(1, 0.79, 0.42) }),
};
const coolLook = (f: number, seed = 29) =>
  look({
    seed,
    molten: 1 - f,
    ocean: 0.6 * f,
    clouds: 0.5 * f,
    life: 0.8 * f,
    atmosphere: new Color().setRGB(1.0 + (0.42 - 1.0) * f, 0.55 + (0.68 - 0.55) * f, 0.3 + (1.0 - 0.3) * f),
  });

// ------------------------------------------------------------------ layout
interface Item {
  p: PlanetVisual;
  name: string;
}
const items: Item[] = [];
function add(name: string, l: PlanetLook, x: number, y: number, z = 0) {
  const p = new PlanetVisual(l);
  p.group.position.set(x, y, z);
  scene.add(p.group);
  items.push({ p, name });
  return p;
}

const starPos = new Vector3(-0.4, 0.09, 0.06);
let showStar = !q.has('nostar');
const dist = Number(q.get('dist') ?? 0.1);
if (mode === 'grid') {
  camera.position.set(0, 0.03, 0.36);
  camera.lookAt(0, 0, 0);
  add('molten', presets.molten, -0.2, 0.1);
  add('cooling', presets.cooling, -0.02, 0.11);
  add('living', presets.living, 0.16, 0.1);
  add('lava', presets.lava, 0.33, 0.1);
  add('ice', presets.ice, -0.22, -0.1);
  add('gas', presets.gas, 0.03, -0.1);
  add('moon', presets.moon, 0.27, -0.09);
} else if (mode === 'system') {
  // As seated at the table: the sun at the forge, worlds on game-like orbits.
  document.body.classList.add('table');
  camera.position.set(0, 0.19, 0.33);
  camera.lookAt(0, -0.015, -0.02);
  starPos.set(0, 0, 0);
  const at = (r: number, deg: number, y = 0): [number, number, number] => [
    r * Math.cos((deg * Math.PI) / 180),
    y,
    -r * Math.sin((deg * Math.PI) / 180),
  ];
  add('living', { ...presets.living, radius: 0.03 }, ...at(0.16, 212));
  add('lava', { ...presets.lava, radius: 0.022 }, ...at(0.085, 35));
  add('ice', { ...presets.ice, radius: 0.026 }, ...at(0.25, 118));
  add('gas', { ...presets.gas, radius: 0.04, rings: 0.95 }, ...at(0.3, -8));
  const g = at(0.3, -8);
  add('moon', { ...presets.moon, radius: 0.011 }, g[0] - 0.02, 0.012, g[2] + 0.085);
  add('cooling', { ...presets.cooling, radius: 0.026 }, ...at(0.21, 160));
  add('molten', { ...presets.molten, radius: 0.027 }, ...at(0.13, 300));
} else if (mode === 'churn') {
  // Integration smoke test: the integrator's usage pattern (same mutated look
  // object every frame, setLook({}) for gas, dispose/re-create, kind/seed swaps).
  camera.position.set(0, 0.05, 0.42);
  camera.lookAt(0, 0, 0);
  const looks = [presets.molten, presets.cooling, presets.gas, presets.moon].map((l) => ({ ...l }));
  looks.forEach((l, i) => add(`c${i}`, l, -0.27 + i * 0.18, 0));
  const shared = looks[1];
  const sc = blackbody(5900);
  let tt = 0;
  for (let f = 0; f < 90; f++) {
    tt += 1 / 30;
    shared.molten = Math.max(0, 0.4 - f / 90);
    shared.ocean = Math.min(0.6, f / 90);
    shared.clouds = Math.min(0.5, f / 120);
    shared.atmosphere.setRGB(0.42, 0.68, 1.0);
    items[1].p.setLook(shared);
    items[2].p.setLook({});
    if (f === 30) items[0].p.setLook({ molten: 1, radius: 0.04 }); // impact re-melt
    if (f === 45) items[2].p.setLook({ rings: 0.85 }); // moon shattered into rings
    if (f === 60) items[3].p.setLook({ kind: 'rocky', seed: 123.4, molten: 0.6 });
    for (const it of items) it.p.update(1 / 30, tt, starPos, sc, f < 50 ? 1 : 0.2, camera.position);
  }
  // Dispose two and make two more (shared geometry is ref-counted).
  for (const it of items.splice(0, 2)) {
    scene.remove(it.p.group);
    it.p.dispose();
  }
  add('n0', { ...presets.living, seed: 5 }, -0.27, 0);
  add('n1', { ...presets.ice, seed: 6 }, -0.09, 0);
  (window as unknown as { __churn: string }).__churn = 'ok';
} else if (mode === 'strip') {
  camera.position.set(0, 0.0, 0.36);
  camera.lookAt(0, 0, 0);
  starPos.set(-1.0, 0.25, 0.75);
  showStar = false;
  for (let i = 0; i < 6; i++) add(`f${i}`, coolLook(i / 5), -0.34 + i * 0.136, 0, 0);
} else {
  const name = q.get('p') ?? 'living';
  const l = mode === 'cool' ? coolLook(Number(q.get('f') ?? 0.5)) : presets[name] ?? presets.living;
  for (const key of ['seed', 'radius', 'molten', 'ocean', 'ice', 'clouds', 'life', 'rings'] as const) {
    if (q.has(key)) l[key] = Number(q.get(key));
  }
  const p = add(name, l, 0, 0, 0);
  if (q.has('hl')) p.setHighlight(Number(q.get('hl')));
  const r = l.radius;
  camera.position.set(0, r * 1.2, dist + (l.kind === 'gas' ? 0.05 : 0));
  camera.lookAt(0, 0, 0);
  starPos.set(-0.13, 0.06, 0.13);
}
const sp = q.get('star');
if (sp) {
  const [x, y, z] = sp.split(',').map(Number);
  starPos.set(x, y, z);
}

const star = new StarVisual(3.3);
const starColor = blackbody(5900);
star.color.copy(starColor);
star.radius = mode === 'system' ? 0.022 : 0.016;
star.coronaScale = Number(q.get('corona') ?? (mode === 'system' ? 1.6 : 2.2));
star.group.position.copy(starPos);
const starGroup = new Group();
starGroup.add(star.group);
if (showStar) scene.add(starGroup);

// ------------------------------------------------------------------ render
const camPos = new Vector3();
let frame = 0;

/**
 * Stereo through OVR_multiview2, exactly like the WebXR path: a 2-layer
 * multiview target, an ArrayCamera, and xr.isMultiview so three compiles the
 * multiview program variants and renders both eyes in one pass.
 */
function renderMultiview() {
  const ipd = 0.064;
  const hw = Math.floor(W / 2);
  const eyes = [-1, 1].map((sgn) => {
    const c = new PerspectiveCamera(70, hw / H, 0.005, 10);
    c.position.copy(camera.position);
    c.quaternion.copy(camera.quaternion);
    c.translateX((sgn * ipd) / 2);
    c.updateMatrixWorld();
    c.viewport = new Vector4(0, 0, hw, H);
    return c;
  });
  const arr = new ArrayCamera(eyes);
  arr.position.copy(camera.position);
  arr.quaternion.copy(camera.quaternion);
  arr.projectionMatrix.copy(eyes[0].projectionMatrix);
  arr.projectionMatrixInverse.copy(eyes[0].projectionMatrixInverse);
  arr.updateMatrixWorld();
  // Like WebXRManager: a 2-view target whose textures come from the "layer".
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const colorTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, colorTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, hw, H, 2);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  // resolveDepthBuffer: false -> three allocates its own multiview depth array.
  const rt = new WebGLRenderTarget(hw, H, {
    depthTexture: new DepthTexture(hw, H, UnsignedIntType, undefined, undefined, undefined, undefined, undefined, undefined, DepthFormat),
    samples: 0,
    colorSpace: SRGBColorSpace,
    resolveDepthBuffer: false,
  }) as WebGLRenderTarget & { isWebGLMultiviewRenderTarget: boolean; numViews: number; isXRRenderTarget: boolean };
  rt.isWebGLMultiviewRenderTarget = true;
  rt.numViews = 2;
  rt.isXRRenderTarget = true;
  (renderer as unknown as { setRenderTargetTextures(r: unknown, c: WebGLTexture, d?: WebGLTexture): void }).setRenderTargetTextures(rt, colorTex);
  const xr = renderer.xr as unknown as { enabled: boolean; isMultiview: boolean };
  xr.enabled = true;
  xr.isMultiview = true;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, arr);
  const { calls, triangles } = renderer.info.render;
  renderer.setRenderTarget(null);
  xr.enabled = false;
  xr.isMultiview = false;
  // Read back both eye layers side by side and present them exactly like the
  // compositor: display = rgb + (1 - a) * passthrough. One layer darkens the
  // background by alpha, a second (plus-lighter) adds the premultiplied rgb.
  const tex = colorTex;
  const fb = gl.createFramebuffer();
  const px = new Uint8Array(hw * H * 4);
  const mk = (blend: string) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.style.cssText = `position:fixed;inset:0;mix-blend-mode:${blend}`;
    return c;
  };
  const cDark = mk('normal');
  const cLight = mk('plus-lighter');
  const gDark = cDark.getContext('2d')!;
  const gLight = cLight.getContext('2d')!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  for (let layer = 0; layer < 2; layer++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, layer);
    gl.readPixels(0, 0, hw, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const dark = gDark.createImageData(hw, H);
    const light = gLight.createImageData(hw, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < hw; x++) {
        const i = ((H - 1 - y) * hw + x) * 4;
        const o = (y * hw + x) * 4;
        dark.data[o + 3] = px[i + 3];
        light.data[o] = px[i];
        light.data[o + 1] = px[i + 1];
        light.data[o + 2] = px[i + 2];
        light.data[o + 3] = 255;
      }
    }
    gDark.putImageData(dark, layer * hw, 0);
    gLight.putImageData(light, layer * hw, 0);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const err = gl.getError();
  renderer.domElement.style.display = 'none';
  document.body.append(cDark, cLight);
  return { err, calls, triangles };
}

function render() {
  camera.getWorldPosition(camPos);
  star.update(T);
  for (const it of items) it.p.update(1 / 60, T, starPos, starColor, Number(q.get('si') ?? 1), camPos);
  scene.updateMatrixWorld();
  let info = { calls: 0, triangles: 0, err: 0 };
  if (q.has('mv')) info = renderMultiview();
  else {
    renderer.render(scene, camera);
    info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, err: 0 };
  }
  (window as unknown as { __info: unknown }).__info = info;
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `${mode}${q.has('mv') ? ' [OVR_multiview2 L|R]' : ''} t=${T}  calls=${info.calls} tris=${info.triangles}`;
  frame++;
  if (frame < (q.has('mv') ? 1 : 3)) requestAnimationFrame(render);
  else (window as unknown as { __done: boolean }).__done = true;
}
requestAnimationFrame(render);
