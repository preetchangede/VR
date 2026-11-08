import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Line,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { additive, premultipliedOver } from './blend';
import { NOISE } from './glsl';
import { Glow } from './sprites';

/** A head-locked sphere drawn over everything: fades the whole view to a color. */
export class Fader {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  level = 0;
  constructor(color = new Color(1, 0.97, 0.92)) {
    this.mat = premultipliedOver(
      new ShaderMaterial({
        uniforms: { uColor: { value: color }, uLevel: { value: 0 } },
        vertexShader: `void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uLevel; void main() { gl_FragColor = vec4(uColor * uLevel, uLevel); }`,
        side: BackSide,
        depthTest: false,
      }),
    );
    this.mesh = new Mesh(new SphereGeometry(0.25, 16, 12), this.mat);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  setColor(r: number, g: number, b: number) {
    (this.mat.uniforms.uColor.value as Color).setRGB(r, g, b);
  }
  update(head: Vector3) {
    this.mesh.position.copy(head);
    this.mat.uniforms.uLevel.value = this.level;
    this.mesh.visible = this.level > 0.002;
  }
}

/** Expanding supernova shock shell: bright filamentary rim, transparent face. */
export class Shockwave {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private t = -1;
  duration = 2.6;
  maxRadius = 3.6;
  readonly origin = new Vector3();
  constructor() {
    this.mat = additive(
      new ShaderMaterial({
        uniforms: { uT: { value: 0 }, uTime: { value: 0 }, uIntensity: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW; varying vec3 vObj;
          void main() {
            vObj = position;
            vN = normalize(mat3(modelMatrix) * normal);
            vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          ${NOISE}
          uniform float uT; uniform float uTime; uniform float uIntensity;
          varying vec3 vN; varying vec3 vW; varying vec3 vObj;
          void main() {
            vec3 V = normalize(cameraPosition - vW);
            float rim = 1.0 - abs(dot(normalize(vN), V));
            float fil = fbm3(normalize(vObj) * 5.0 + uTime * 0.2);
            float fil2 = vnoise(normalize(vObj) * 13.0 - uTime * 0.3);
            float lines = smoothstep(0.45, 0.75, fil) * (0.6 + 0.8 * fil2);
            vec3 hot = vec3(1.0, 0.95, 0.85);
            vec3 c1 = vec3(0.25, 0.92, 0.8);
            vec3 c2 = vec3(1.0, 0.45, 0.22);
            vec3 c3 = vec3(0.68, 0.55, 1.0);
            vec3 col = mix(mix(c1, c2, fil2), c3, smoothstep(0.5, 0.8, fil));
            col = mix(hot, col, smoothstep(0.0, 0.35, uT));
            float a = (pow(rim, 3.0) * 1.4 + lines * rim * 0.9) * (1.0 - uT) * (1.0 - uT);
            gl_FragColor = vec4(col * a * uIntensity, 0.0);
          }`,
        side: DoubleSide,
      }),
    );
    this.mesh = new Mesh(new SphereGeometry(1, 48, 32), this.mat);
    this.mesh.renderOrder = 45;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  fire(at: Vector3) {
    this.origin.copy(at);
    this.t = 0;
  }
  /** Current shell radius (m), or -1 when idle. */
  get radius() {
    if (this.t < 0) return -1;
    const k = this.t / this.duration;
    return this.maxRadius * (1 - Math.pow(1 - k, 2.2));
  }
  update(dt: number, time: number) {
    if (this.t < 0) {
      this.mesh.visible = false;
      return;
    }
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.mesh.visible = k < 1;
    this.mesh.position.copy(this.origin);
    this.mesh.scale.setScalar(Math.max(0.01, this.radius));
    this.mat.uniforms.uT.value = k;
    this.mat.uniforms.uTime.value = time;
    if (k >= 1) this.t = -1;
  }
}

/** A pulsar: a tiny blinding core and two sweeping beams. */
export class Pulsar {
  readonly group = new Group();
  private readonly core = new Glow({ color: new Color(0.7, 0.85, 1.0), core: 0.4, rays: 0.6, renderOrder: 50 });
  private readonly beams = new Group();
  private readonly beamMat: ShaderMaterial;
  readonly axis = new Vector3(0, 1, 0);
  /** Rotations per second. */
  rate = 0.42;
  intensity = 0;
  private angle = 0;
  /** Tilt of the magnetic axis from the spin axis. */
  tilt = 0.85;
  constructor() {
    this.beamMat = additive(
      new ShaderMaterial({
        uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying float vAlong; varying vec3 vN; varying vec3 vW;
          void main() {
            vAlong = position.y / 2.5 + 0.5;
            vN = normalize(mat3(modelMatrix) * normal);
            vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uIntensity; uniform float uTime;
          varying float vAlong; varying vec3 vN; varying vec3 vW;
          void main() {
            vec3 V = normalize(cameraPosition - vW);
            float edge = pow(abs(dot(normalize(vN), V)), 1.6);
            float fall = pow(1.0 - vAlong, 1.4);
            float a = edge * fall * uIntensity * (0.85 + 0.15 * sin(uTime * 40.0 + vAlong * 30.0));
            gl_FragColor = vec4(vec3(0.62, 0.8, 1.0) * a, 0.0);
          }`,
        side: DoubleSide,
      }),
    );
    for (const s of [1, -1]) {
      const cone = new Mesh(new ConeGeometry(0.16, 2.5, 24, 1, true), this.beamMat);
      cone.position.y = s * 1.25;
      cone.rotation.x = s > 0 ? Math.PI : 0;
      cone.renderOrder = 46;
      this.beams.add(cone);
    }
    this.group.add(this.core.mesh, this.beams);
    this.group.visible = false;
  }
  update(dt: number, time: number) {
    this.group.visible = this.intensity > 0.002;
    this.angle += dt * this.rate * Math.PI * 2;
    // Spin about vertical; beam axis tilted, so it sweeps a cone across the room.
    this.beams.rotation.set(this.tilt * Math.cos(this.angle * 0.0), this.angle, this.tilt);
    this.beams.updateMatrix();
    this.axis.set(0, 1, 0).applyEuler(this.beams.rotation).normalize();
    this.beamMat.uniforms.uIntensity.value = this.intensity * 0.7;
    this.beamMat.uniforms.uTime.value = time;
    this.core.set(null, 0.012, this.intensity * 1.6);
    this.core.tick(time);
  }
}

/** The habitable zone: a soft green-teal band around a star. */
export class ZoneRing {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  opacity = 0;
  target = 0;
  constructor() {
    this.mat = additive(
      new ShaderMaterial({
        uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uInner: { value: 0.8 }, uOuter: { value: 1.2 } },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() { vP = position.xy; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          ${NOISE}
          uniform float uOpacity; uniform float uTime; uniform float uInner; uniform float uOuter;
          varying vec2 vP;
          void main() {
            float r = length(vP);
            float mid = (uInner + uOuter) * 0.5;
            float w = (uOuter - uInner) * 0.5;
            float band = 1.0 - smoothstep(0.0, w, abs(r - mid));
            float edges = exp(-pow((r - uInner) / (w * 0.08), 2.0)) + exp(-pow((r - uOuter) / (w * 0.08), 2.0));
            float a = atan(vP.y, vP.x);
            float shimmer = 0.7 + 0.3 * vnoise(vec3(a * 6.0, r * 30.0 - uTime * 0.6, uTime * 0.2));
            vec3 col = vec3(0.35, 1.0, 0.7) * (band * 0.16 * shimmer + edges * 0.35);
            gl_FragColor = vec4(col * uOpacity, 0.0);
          }`,
        side: DoubleSide,
      }),
    );
    this.mesh = new Mesh(new RingGeometry(0.05, 0.5, 128, 1), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 22;
    this.mesh.visible = false;
  }
  update(dt: number, time: number, center: Vector3 | null, hz: number) {
    this.opacity += (this.target - this.opacity) * (1 - Math.exp(-dt * 3));
    this.mesh.visible = this.opacity > 0.01 && !!center;
    if (!center) return;
    this.mesh.position.copy(center);
    const inner = hz * 0.8;
    const outer = hz * 1.25;
    this.mesh.scale.setScalar(1);
    this.mat.uniforms.uInner.value = inner;
    this.mat.uniforms.uOuter.value = outer;
    this.mat.uniforms.uOpacity.value = this.opacity;
    this.mat.uniforms.uTime.value = time;
  }
}

/** A fading light trail behind an orbiting body. */
export class Trail {
  readonly line: Line;
  private readonly pts: Float32Array;
  private readonly alpha: Float32Array;
  private readonly n: number;
  private count = 0;
  private acc = 0;
  readonly color: Color;
  constructor(color: Color, n = 90) {
    this.n = n;
    this.color = color;
    this.pts = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pts, 3));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    const mat = additive(
      new ShaderMaterial({
        uniforms: { uColor: { value: color }, uIntensity: { value: 0.6 } },
        vertexShader: /* glsl */ `
          attribute float aAlpha; varying float vA;
          void main() { vA = aAlpha; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uIntensity; varying float vA;
          void main() { gl_FragColor = vec4(uColor * vA * vA * uIntensity, 0.0); }`,
      }),
    );
    this.line = new Line(geo, mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 21;
  }
  push(p: Vector3, dt: number) {
    this.acc += dt;
    if (this.acc < 0.04) {
      // Keep the head glued to the body.
      if (this.count > 0) this.pts.set([p.x, p.y, p.z], 0);
    } else {
      this.acc = 0;
      this.pts.copyWithin(3, 0, (this.n - 1) * 3);
      this.pts.set([p.x, p.y, p.z], 0);
      this.count = Math.min(this.n, this.count + 1);
    }
    for (let i = 0; i < this.n; i++) this.alpha[i] = i < this.count ? 1 - i / this.n : 0;
    const g = this.line.geometry;
    g.setDrawRange(0, this.count);
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as BufferAttribute).needsUpdate = true;
  }
  reset() {
    this.count = 0;
  }
}
