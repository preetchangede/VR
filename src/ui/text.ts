import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { premultipliedOver } from '../render/blend';

const FONT = `'Inter', 'Avenir Next', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`;

/**
 * A floating text panel rendered from a canvas. It carries its own soft dark
 * plate so it stays legible over any passthrough background.
 */
export class TextPanel {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private readonly mat: ShaderMaterial;
  private text = '';
  opacity = 0;
  targetOpacity = 0;
  readonly worldWidth: number;
  private readonly px = 1024;
  private readonly py: number;

  constructor(opts: { width?: number; aspect?: number; size?: number; weight?: number; plate?: number; tracking?: number } = {}) {
    this.tracking = opts.tracking ?? 0;
    this.worldWidth = opts.width ?? 0.34;
    const aspect = opts.aspect ?? 4;
    this.py = Math.round(this.px / aspect);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.px;
    this.canvas.height = this.py;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    // The material blends premultiplied color: upload the canvas premultiplied too,
    // or every soft glow edge turns into a full-brightness halo.
    this.tex.premultiplyAlpha = true;
    this.tex.minFilter = LinearMipmapLinearFilter;
    this.tex.magFilter = LinearFilter;
    this.tex.anisotropy = 4;
    this.fontSize = opts.size ?? 54;
    this.weight = opts.weight ?? 400;
    this.plate = opts.plate ?? 0.42;
    this.mat = premultipliedOver(
      new ShaderMaterial({
        uniforms: { uMap: { value: this.tex }, uOpacity: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            gl_FragColor = vec4(t.rgb * uOpacity, t.a * uOpacity);
          }`,
        depthTest: false,
      }),
    );
    this.mesh = new Mesh(new PlaneGeometry(this.worldWidth, this.worldWidth / aspect), this.mat);
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
  }
  private readonly fontSize: number;
  private readonly weight: number;
  private readonly plate: number;
  /** Letter spacing in em. */
  private readonly tracking: number;

  setText(text: string) {
    if (text === this.text) return;
    this.text = text;
    const { ctx, px, py } = this;
    ctx.clearRect(0, 0, px, py);
    if (!text) {
      this.tex.needsUpdate = true;
      return;
    }
    ctx.font = `${this.weight} ${this.fontSize}px ${FONT}`;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${this.tracking * this.fontSize}px`;
    // Word wrap.
    const maxW = px * 0.86;
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      lines.push(line);
    }
    const lh = this.fontSize * 1.32;
    const blockH = lines.length * lh;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    // Soft dark plate: a stretched radial gradient behind the block.
    const cx = px / 2;
    const cy = py / 2;
    const plateW = widest / 2 + this.fontSize * 1.4;
    const plateH = blockH / 2 + this.fontSize * 0.9;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(plateW, plateH);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(4, 4, 10, ${this.plate})`);
    g.addColorStop(0.6, `rgba(4, 4, 10, ${this.plate * 0.75})`);
    g.addColorStop(1, 'rgba(4, 4, 10, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 190, 120, 0.55)';
    ctx.shadowBlur = this.fontSize * 0.35;
    ctx.fillStyle = '#fbf1e1';
    lines.forEach((l, i) => ctx.fillText(l, cx, cy - blockH / 2 + lh * (i + 0.5)));
    this.tex.needsUpdate = true;
  }

  /** Draw arbitrary content (canvas is px × py, already cleared). */
  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    this.text = '';
    this.ctx.clearRect(0, 0, this.px, this.py);
    fn(this.ctx, this.px, this.py);
    this.tex.needsUpdate = true;
  }

  /** Face the viewer (full billboard) and fade. */
  update(dt: number, head: Vector3) {
    const k = 1 - Math.exp(-dt * 6);
    this.opacity += (this.targetOpacity - this.opacity) * k;
    this.mat.uniforms.uOpacity.value = this.opacity;
    this.mesh.visible = this.opacity > 0.01;
    if (this.mesh.visible) this.mesh.lookAt(head);
  }
}
