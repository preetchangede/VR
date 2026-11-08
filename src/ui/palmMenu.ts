import {
  CanvasTexture,
  CircleGeometry,
  Group,
  Mesh,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { premultipliedOver } from '../render/blend';
import type { Hand, HandTracker } from '../xr/hands';

export interface MenuItem {
  id: string;
  label: () => string;
  icon: string;
  /** Requires a hold (e.g. restart). */
  hold?: boolean;
  action: () => void;
}

const FONT = `'Inter', 'Avenir Next', 'Segoe UI', Roboto, sans-serif`;
const R = 0.022;

class Button {
  readonly mesh: Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly tex: CanvasTexture;
  private readonly mat: ShaderMaterial;
  private drawn = '';
  hover = 0;
  press = 0;
  holdT = 0;
  constructor(readonly item: MenuItem) {
    this.canvas.width = this.canvas.height = 256;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = premultipliedOver(
      new ShaderMaterial({
        uniforms: { uMap: { value: this.tex }, uOpacity: { value: 0 }, uHover: { value: 0 }, uHold: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; uniform float uOpacity; uniform float uHover; uniform float uHold;
          varying vec2 vUv;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            vec2 c = vUv * 2.0 - 1.0;
            float r = length(c);
            float ang = atan(c.x, c.y) / 6.28318 + 0.5;
            float ring = smoothstep(0.03, 0.0, abs(r - 0.93)) * step(ang, uHold);
            vec3 glow = vec3(1.0, 0.75, 0.4) * (uHover * 0.35 * smoothstep(1.0, 0.6, r) + ring);
            gl_FragColor = vec4((t.rgb + glow * t.a) * uOpacity, t.a * uOpacity);
          }`,
        depthTest: false,
      }),
    );
    this.mesh = new Mesh(new CircleGeometry(R, 40), this.mat);
    this.mesh.renderOrder = 110;
  }
  draw() {
    const label = this.item.label();
    if (label === this.drawn) return;
    this.drawn = label;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 256);
    const g = c.createRadialGradient(128, 128, 20, 128, 128, 128);
    g.addColorStop(0, 'rgba(30, 24, 40, 0.92)');
    g.addColorStop(1, 'rgba(14, 10, 22, 0.85)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(128, 128, 124, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255, 196, 120, 0.7)';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(128, 128, 118, 0, Math.PI * 2);
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffd89a';
    c.font = `300 92px ${FONT}`;
    c.fillText(this.item.icon, 128, 108);
    c.fillStyle = '#f6ecda';
    c.font = `500 30px ${FONT}`;
    c.fillText(label, 128, 186);
    this.tex.needsUpdate = true;
  }
  setOpacity(o: number) {
    this.mat.uniforms.uOpacity.value = o;
    this.mat.uniforms.uHover.value = this.hover;
    this.mat.uniforms.uHold.value = this.holdT;
    this.mesh.visible = o > 0.01;
  }
}

/**
 * Look at an open palm to summon a small ring of buttons above it; poke them
 * with the other hand's index finger. Fully hands-only.
 */
export class PalmMenu {
  readonly group = new Group();
  private readonly buttons: Button[];
  private openness = 0;
  private side: 0 | 1 | -1 = -1;
  private gazeT = 0;
  enabled = false;
  onToggle: (open: boolean) => void = () => {};
  private wasOpen = false;
  private readonly _v = new Vector3();
  private readonly _c = new Vector3();
  private cooldown = 0;

  constructor(items: MenuItem[]) {
    this.buttons = items.map((it) => new Button(it));
    for (const b of this.buttons) this.group.add(b.mesh);
  }

  get isOpen() {
    return this.openness > 0.5;
  }

  update(dt: number, ht: HandTracker, head: Vector3) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    // Which palm (if any) is held up, open, facing the eyes?
    let cand = -1 as 0 | 1 | -1;
    if (this.enabled) {
      for (let k = 0; k < 2; k++) {
        const h: Hand = ht.both[k];
        if (!h.tracked || h.isController) continue;
        const to = this._v.subVectors(head, h.palm);
        const d = to.length();
        if (d > 0.6 || d < 0.15) continue;
        to.divideScalar(d);
        if (h.normal.dot(to) > 0.72 && h.curl < 0.35 && cand === -1) cand = k as 0 | 1;
      }
    }
    if (cand !== -1 && (this.side === -1 || this.side === cand)) {
      this.gazeT += dt;
      if (this.gazeT > 0.35) this.side = cand;
    } else if (this.side !== -1 && cand !== this.side) {
      this.gazeT -= dt * 2;
      if (this.gazeT <= 0) this.side = -1;
    } else this.gazeT = Math.max(0, this.gazeT - dt);
    const target = this.side !== -1 ? 1 : 0;
    this.openness += (target - this.openness) * (1 - Math.exp(-dt * 8));
    const open = this.openness > 0.5;
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      this.onToggle(open);
    }
    if (this.openness < 0.01 || this.side === -1) {
      for (const b of this.buttons) b.setOpacity(0);
      if (this.openness < 0.01) return;
    }
    const hand = this.side !== -1 ? ht.both[this.side] : null;
    if (!hand) {
      for (const b of this.buttons) b.setOpacity(this.openness * 0);
      return;
    }
    const other = ht.both[this.side === 0 ? 1 : 0];
    // Lay buttons in an arc above the palm, facing the eyes.
    const center = this._c.copy(hand.palm).addScaledVector(hand.normal, 0.07);
    const toHead = this._v.subVectors(head, center).normalize();
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), toHead).normalize();
    const up = new Vector3().crossVectors(toHead, right).normalize();
    const n = this.buttons.length;
    this.buttons.forEach((b, i) => {
      const a = ((i - (n - 1) / 2) / Math.max(n - 1, 1)) * 2.1;
      const pos = center
        .clone()
        .addScaledVector(right, Math.sin(a) * 0.075 * this.openness)
        .addScaledVector(up, (Math.cos(a) * 0.075 - 0.035) * this.openness);
      b.mesh.position.copy(pos);
      b.mesh.lookAt(head);
      b.draw();
      // Poke detection with the other hand's index tip.
      let hover = 0;
      if (other.tracked) {
        const d = other.indexTip.distanceTo(pos);
        hover = Math.max(0, 1 - d / 0.05);
        if (d < R * 0.9 && this.cooldown <= 0) {
          if (b.item.hold) {
            b.holdT += dt / 1.2;
            if (b.holdT >= 1) {
              b.item.action();
              b.holdT = 0;
              this.cooldown = 1;
            }
          } else {
            b.item.action();
            b.press = 1;
            this.cooldown = 0.6;
          }
        } else b.holdT = Math.max(0, b.holdT - dt);
      }
      b.hover += (hover - b.hover) * (1 - Math.exp(-dt * 12));
      b.press = Math.max(0, b.press - dt * 3);
      b.mesh.scale.setScalar(1 + b.press * 0.25 + b.hover * 0.08);
      b.setOpacity(this.openness);
    });
  }
}
