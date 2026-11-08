import { additive } from './blend';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  CylinderGeometry,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { NOISE, STARFIELD } from './glsl';
import { createReceiverMaterial, receiverUniforms } from './receiver';

/**
 * The Well: the table opens like an iris onto deep space.
 *
 *  - a receiver "cap" covering the table (real outline when known) with a hole,
 *    so the table hides everything below its surface except through the hole;
 *  - an inverted sphere below the tabletop rendering infinite deep sky by view
 *    direction, with crimson hydrogen haze swirling in its depths;
 *  - an ember rim where the table "burned" open.
 */
export class Well {
  readonly group = new Group();
  readonly cap: Mesh;
  private readonly interior: Mesh;
  private readonly rim: Mesh;
  private readonly interiorMat: ShaderMaterial;
  private readonly rimMat: ShaderMaterial;
  /** 0 = closed, 1 = fully open. */
  open = 0;
  readonly maxRadius = 0.105;
  readonly center = new Vector3();

  constructor() {
    this.cap = new Mesh(new BufferGeometry(), createReceiverMaterial('surface'));
    this.cap.renderOrder = -99;
    this.cap.frustumCulled = false;

    this.interiorMat = new ShaderMaterial({
      uniforms: {
        uCenter: { value: this.center },
        uTime: receiverUniforms.uTime,
        uOpen: { value: 0 },
        uHeat: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${STARFIELD}
        uniform vec3 uCenter;
        uniform float uTime;
        uniform float uOpen;
        uniform float uHeat;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos - cameraPosition);
          vec3 col = deepSky(dir, 1.6) * 2.4;
          vec3 rel = vWorldPos - uCenter;
          float depth = clamp(-rel.y / 0.3, 0.0, 1.0);
          float r = length(rel.xz);
          float ang = atan(rel.z, rel.x);
          // Seamless swirl: sample noise on a circle instead of the raw angle.
          float sa = ang + uTime * 0.15 + r * 9.0;
          float swirl = fbm3(vec3(cos(sa) * 1.4, depth * 2.5 - uTime * 0.05, sin(sa) * 1.4) + r * 2.0);
          vec3 haze = mix(vec3(0.55, 0.06, 0.18), vec3(0.9, 0.25, 0.35), swirl);
          col += haze * smoothstep(0.3, 0.8, swirl) * (0.35 + 0.65 * depth) * (0.9 + uHeat);
          // A glowing core far below: where the hydrogen comes from.
          col += vec3(1.0, 0.35, 0.45) * pow(depth, 4.0) * 0.9;
          col += vec3(0.25, 0.05, 0.12) * 0.35;
          col *= uOpen;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: BackSide,
    });
    // A tight open-topped cylinder: it must never poke out past the table's
    // edge. The sky inside is evaluated by view direction, so it still reads
    // as infinitely deep.
    const tube = new CylinderGeometry(this.maxRadius + 0.012, this.maxRadius + 0.012, 0.3, 48, 1, false);
    this.interior = new Mesh(tube, this.interiorMat);
    this.interior.position.set(0, -0.15, 0);
    this.interior.renderOrder = -50;

    this.rimMat = new ShaderMaterial({
      uniforms: {
        uTime: receiverUniforms.uTime,
        uRadius: { value: 0 },
        uOpen: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          vLocal = position.xy;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        uniform float uTime;
        uniform float uRadius;
        uniform float uOpen;
        varying vec2 vLocal;
        void main() {
          float r = length(vLocal);
          float a = atan(vLocal.y, vLocal.x);
          float n = fbm3(vec3(a * 3.0, r * 40.0, uTime * 0.6));
          float edge = r - uRadius;
          float glow = exp(-max(edge, 0.0) * 160.0) * step(-0.002, edge);
          float embers = smoothstep(0.55, 0.85, n) * exp(-max(edge, 0.0) * 60.0);
          vec3 col = mix(vec3(1.0, 0.35, 0.12), vec3(1.0, 0.85, 0.55), glow) * (glow * 1.3 + embers * 0.8);
          col *= uOpen;
          gl_FragColor = vec4(col, 0.0);
        }`,
    });
    additive(this.rimMat);
    this.rim = new Mesh(new RingGeometry(0.02, 0.2, 96, 1), this.rimMat);
    this.rim.rotation.x = -Math.PI / 2;
    this.rim.position.y = 0.0015;
    this.rim.renderOrder = 20;

    this.group.add(this.interior, this.rim);
    this.group.visible = false;
  }

  /**
   * With no real table, the forge rests on a small conjured obsidian plinth
   * (with the well's opening cut through it).
   */
  private plinth: Mesh | null = null;
  private makePlinth() {
    const mat = new ShaderMaterial({
      uniforms: { uTime: receiverUniforms.uTime },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main() {
          vec3 V = normalize(cameraPosition - vW);
          float f = pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
          vec3 col = vec3(0.025, 0.022, 0.035) + vec3(0.55, 0.32, 0.18) * f * 0.6;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const top = new Mesh(new RingGeometry(this.maxRadius, 0.26, 64, 1), mat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.001;
    const side = new Mesh(new CylinderGeometry(0.26, 0.22, 0.03, 64, 1, true), mat);
    side.position.y = -0.014;
    const g = new Mesh();
    g.add(top, side);
    g.renderOrder = -40;
    this.plinth = g;
    this.group.add(g);
  }

  /** Place the forge on a surface; builds the table cap from its outline. */
  place(point: Vector3, outline: Vector3[] | null) {
    if (!outline && !this.plinth) this.makePlinth();
    if (this.plinth) this.plinth.visible = !outline;
    this.group.position.copy(point);
    this.center.copy(point);
    this.group.visible = true;
    const geo = this.cap.geometry;
    let pts: Vector3[];
    if (outline && outline.length >= 3) {
      pts = outline.map((p) => new Vector3(p.x, point.y + 0.0005, p.z));
    } else {
      pts = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push(new Vector3(point.x + Math.cos(a) * 0.55, point.y + 0.0005, point.z + Math.sin(a) * 0.55));
      }
    }
    // Fan from the forge point (inside the polygon) so concave-ish outlines still work.
    const n = pts.length;
    const pos = new Float32Array((n + 1) * 3);
    const nor = new Float32Array((n + 1) * 3);
    pos.set([point.x, point.y + 0.0005, point.z], 0);
    for (let i = 0; i < n; i++) pos.set([pts[i].x, pts[i].y, pts[i].z], (i + 1) * 3);
    for (let i = 0; i <= n; i++) nor[i * 3 + 1] = 1;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(0, 1 + ((i + 1) % n), 1 + i, 0, 1 + i, 1 + ((i + 1) % n));
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.cap.visible = true;
  }

  update(heat = 0) {
    const r = this.maxRadius * this.open;
    const hole = receiverUniforms.uHole.value;
    hole.set(this.center.x, this.center.y, this.center.z, r);
    this.interiorMat.uniforms.uOpen.value = Math.min(1, this.open * 1.5);
    this.interiorMat.uniforms.uHeat.value = heat;
    this.rimMat.uniforms.uRadius.value = r;
    this.rimMat.uniforms.uOpen.value = this.open > 0.001 ? 1 : 0;
    this.interior.visible = this.open > 0.001;
  }
}
