import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineSegments,
  Points,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { clamp, easeInOut, smoothstep } from '../core/math';
import poses from '../data/hand-poses.json';
import { additive } from '../render/blend';
import { BONES } from '../xr/hands';

type PoseId = keyof typeof poses;
type Joints = number[][];

const _s = new Vector3();
const _n = new Vector3();
const _f = new Vector3();
const _p = new Vector3();

/**
 * A hand drawn as a constellation: a star at every joint, faint lines along
 * the bones. Joint data was captured from real hand-tracking poses, so the
 * demonstrations move like real hands.
 */
class GhostHand {
  readonly group = new Group();
  private readonly pts: Float32Array;
  private readonly segs: Float32Array;
  private readonly pGeo = new BufferGeometry();
  private readonly lGeo = new BufferGeometry();
  readonly mat: ShaderMaterial;
  readonly lineMat: ShaderMaterial;
  readonly side: 'left' | 'right';
  constructor(side: 'left' | 'right') {
    this.side = side;
    this.pts = new Float32Array(25 * 3);
    this.segs = new Float32Array(BONES.length * 6);
    this.pGeo.setAttribute('position', new BufferAttribute(this.pts, 3));
    this.lGeo.setAttribute('position', new BufferAttribute(this.segs, 3));
    this.mat = additive(
      new ShaderMaterial({
        uniforms: { uOpacity: { value: 0 }, uScale: { value: 800 } },
        vertexShader: /* glsl */ `
          uniform float uScale;
          void main() {
            vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(0.012 * uScale * projectionMatrix[1][1] / -mv.z, 2.0, 40.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          void main() {
            vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard;
            float a = exp(-r2 * 6.0) + exp(-r2 * 30.0);
            gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a * uOpacity, 0.0);
          }`,
      }),
    );
    this.lineMat = additive(
      new ShaderMaterial({
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: `void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uOpacity; void main() { gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * 0.35 * uOpacity, 0.0); }`,
      }),
    );
    const p = new Points(this.pGeo, this.mat);
    const l = new LineSegments(this.lGeo, this.lineMat);
    p.frustumCulled = l.frustumCulled = false;
    p.renderOrder = l.renderOrder = 70;
    this.group.add(l, p);
  }

  /** Pose the hand: wrist position, finger direction and palm normal (world). */
  pose(wrist: Vector3, forward: Vector3, normal: Vector3, a: PoseId, b: PoseId, t: number, opacity: number) {
    _f.copy(forward).normalize();
    _n.copy(normal).normalize();
    _s.crossVectors(_n, _f).normalize();
    const mirror = this.side === 'left' ? -1 : 1;
    const A = poses[a] as Joints;
    const B = poses[b] as Joints;
    for (let i = 0; i < 25; i++) {
      const x = (A[i][0] + (B[i][0] - A[i][0]) * t) * mirror;
      const y = A[i][1] + (B[i][1] - A[i][1]) * t;
      const z = A[i][2] + (B[i][2] - A[i][2]) * t;
      _p.copy(wrist).addScaledVector(_s, x).addScaledVector(_n, y).addScaledVector(_f, z);
      this.pts.set([_p.x, _p.y, _p.z], i * 3);
    }
    BONES.forEach(([i, j], k) => {
      this.segs.set(this.pts.subarray(i * 3, i * 3 + 3), k * 6);
      this.segs.set(this.pts.subarray(j * 3, j * 3 + 3), k * 6 + 3);
    });
    (this.pGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.lGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.mat.uniforms.uOpacity.value = opacity;
    this.lineMat.uniforms.uOpacity.value = opacity;
    this.group.visible = opacity > 0.01;
  }
}

export type Demo = 'none' | 'sweep' | 'squeeze' | 'pinch' | 'touch' | 'palm';

/**
 * Looping gesture demonstrations positioned relative to the forge. The
 * director picks a demo; it fades out the moment the player starts doing it.
 */
export class GhostHands {
  readonly group = new Group();
  readonly left = new GhostHand('left');
  readonly right = new GhostHand('right');
  demo: Demo = 'none';
  private t = 0;
  private fade = 0;
  /** Forge frame (world) — set each frame by the game. */
  readonly origin = new Vector3();
  readonly right3 = new Vector3(1, 0, 0);
  readonly toward = new Vector3(0, 0, 1);
  /** Optional target (e.g. the planet for pinch/touch demos). */
  readonly target = new Vector3();
  readonly target2 = new Vector3();
  suppressed = false;
  private readonly up = new Vector3(0, 1, 0);
  private readonly pool = Array.from({ length: 8 }, () => new Vector3());

  constructor() {
    this.group.add(this.left.group, this.right.group);
  }

  show(demo: Demo) {
    if (demo !== this.demo) this.t = 0;
    this.demo = demo;
  }

  setScale(px: number) {
    this.left.mat.uniforms.uScale.value = px;
    this.right.mat.uniforms.uScale.value = px;
  }

  update(dt: number) {
    this.t += dt;
    const on = this.demo !== 'none' && !this.suppressed;
    this.fade += ((on ? 1 : 0) - this.fade) * (1 - Math.exp(-dt * (on ? 1.5 : 4)));
    if (this.fade < 0.01) {
      this.left.group.visible = this.right.group.visible = false;
      return;
    }
    const O = this.origin;
    const X = this.right3;
    const Z = this.toward;
    const up = this.up;
    let k = 0;
    const pool = this.pool;
    const pt = (x: number, y: number, z: number) =>
      pool[k++ % pool.length].copy(O).addScaledVector(X, x).addScaledVector(up, y).addScaledVector(Z, z);
    const base = 0.55 * this.fade;
    switch (this.demo) {
      case 'sweep': {
        // A right hand sweeps through the gas, palm leading, then lifts away.
        const T = (this.t % 3.6) / 3.6;
        const k = easeInOut(clamp(T / 0.7));
        const env = smoothstep(0, 0.12, T) * (1 - smoothstep(0.75, 0.95, T));
        const wrist = pt(0.16 - 0.32 * k, 0.12 + Math.sin(k * Math.PI) * 0.05, 0.13 - Math.sin(k * Math.PI) * 0.06);
        const fwd = pt(0, 0, 0).sub(O).addScaledVector(Z, -1).addScaledVector(X, -0.4).normalize();
        const nrm = X.clone().multiplyScalar(-1).addScaledVector(up, -0.2).normalize();
        this.right.pose(wrist, fwd, nrm, 'open', 'cup', 0.3 * k, base * env);
        this.left.pose(wrist, fwd, nrm, 'open', 'open', 0, 0);
        break;
      }
      case 'squeeze': {
        // Two cupped hands press together around the gas, hold, release.
        const T = (this.t % 3.8) / 3.8;
        const close = easeInOut(clamp(T / 0.45)) * (1 - easeInOut(clamp((T - 0.75) / 0.25)));
        const gap = 0.3 - 0.21 * close;
        const env = smoothstep(0, 0.1, T) * (1 - smoothstep(0.85, 1, T));
        const c = pt(0, 0.17, 0.05);
        const fwd = new Vector3().copy(Z).multiplyScalar(-1).addScaledVector(up, 0.35).normalize();
        const lw = c.clone().addScaledVector(X, -gap / 2 - 0.02).addScaledVector(Z, 0.07).addScaledVector(up, -0.03);
        const rw = c.clone().addScaledVector(X, gap / 2 + 0.02).addScaledVector(Z, 0.07).addScaledVector(up, -0.03);
        this.left.pose(lw, fwd, X, 'open', 'cup', close, base * env);
        this.right.pose(rw, fwd, X.clone().negate(), 'open', 'cup', close, base * env);
        break;
      }
      case 'pinch': {
        // Pinch at the target, carry to target2, let go.
        const T = (this.t % 4.2) / 4.2;
        const grab = smoothstep(0.1, 0.25, T) * (1 - smoothstep(0.7, 0.8, T));
        const carry = easeInOut(clamp((T - 0.25) / 0.45));
        const env = smoothstep(0, 0.08, T) * (1 - smoothstep(0.85, 1, T));
        const p = this.target.clone().lerp(this.target2, carry);
        const fwd = new Vector3().copy(Z).multiplyScalar(-1).addScaledVector(up, -0.3).normalize();
        const nrm = X.clone().multiplyScalar(-1).addScaledVector(up, -0.6).normalize();
        const wrist = p.clone().addScaledVector(fwd, -0.085).addScaledVector(nrm, -0.02);
        this.right.pose(wrist, fwd, nrm, 'open', 'pinch', grab, base * env);
        this.left.pose(wrist, fwd, nrm, 'open', 'open', 0, 0);
        break;
      }
      case 'touch': {
        const T = (this.t % 3.0) / 3.0;
        const reach = easeInOut(clamp(T / 0.5)) * (1 - easeInOut(clamp((T - 0.7) / 0.3)));
        const env = smoothstep(0, 0.1, T) * (1 - smoothstep(0.85, 1, T));
        const fwd = new Vector3().subVectors(this.target, pt(0.05, 0.25, 0.32)).normalize();
        const nrm = X.clone().multiplyScalar(-1).addScaledVector(up, -0.5).normalize();
        const tip = this.target.clone().addScaledVector(fwd, -0.03 - (1 - reach) * 0.12);
        const wrist = tip.clone().addScaledVector(fwd, -0.17);
        this.right.pose(wrist, fwd, nrm, 'open', 'point', 0.4 + 0.6 * reach, base * env);
        this.left.pose(wrist, fwd, nrm, 'open', 'open', 0, 0);
        break;
      }
      case 'palm': {
        // Turn the left palm up toward the face.
        const T = (this.t % 3.0) / 3.0;
        const turn = easeInOut(clamp(T / 0.4));
        const env = smoothstep(0, 0.1, T) * (1 - smoothstep(0.85, 1, T));
        const wrist = pt(-0.16, 0.12, 0.2);
        const fwd = new Vector3().copy(Z).multiplyScalar(-1).addScaledVector(X, 0.3).normalize();
        const nrm = new Vector3(0, -1, 0).lerp(new Vector3().copy(Z).addScaledVector(up, 1).normalize(), turn).normalize();
        this.left.pose(wrist, fwd, nrm, 'flat', 'open', turn, base * env);
        this.right.pose(wrist, fwd, nrm, 'open', 'open', 0, 0);
        break;
      }
    }
  }
}
