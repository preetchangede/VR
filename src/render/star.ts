import { Color, Group, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import { blackbody } from '../core/math';
import { NOISE } from './glsl';
import { Glow } from './sprites';

const sphere = new SphereGeometry(1, 64, 40);

/**
 * Display palette for a star of temperature `kelvin`: a hot center, a glow
 * color and a deep limb, pushed warmer and more saturated than a literal
 * blackbody so suns read golden and dwarfs ember-red.
 */
export function starPalette(kelvin: number, glow: Color, limb: Color, hot: Color) {
  blackbody(kelvin * 0.78, glow);
  blackbody(kelvin * 0.6, limb);
  limb.setRGB(Math.pow(limb.r, 1.7), Math.pow(limb.g, 2.2), Math.pow(limb.b, 2.4));
  if (kelvin > 12000) {
    // Hot stars: keep blue saturated at the limb.
    limb.setRGB(limb.r * 0.55, limb.g * 0.75, 1.0);
  }
  hot.copy(glow).lerp(new Color(1, 1, 1), 0.6);
}

/**
 * A living star: boiling granulation, sunspots, limb darkening and a flare
 * that leaps toward a nearby fingertip; plus a corona with slowly turning rays.
 */
export class StarVisual {
  readonly group = new Group();
  readonly core: Mesh;
  readonly corona: Glow;
  readonly haze: Glow;
  private readonly mat: ShaderMaterial;
  /** Light / glow color. */
  readonly color = new Color(1, 0.85, 0.6);
  /** Deep, saturated color at the limb. */
  readonly limb = new Color(1, 0.5, 0.2);
  /** Hot center color. */
  readonly hot = new Color(1, 0.97, 0.9);
  radius = 0.02;
  /** 0..1 brightness multiplier (birth fade, collapse). */
  brightness = 1;
  /** Convective violence (red supergiants boil). */
  boil = 0.3;
  coronaScale = 6;

  constructor(seed = Math.random() * 100) {
    this.mat = new ShaderMaterial({
      uniforms: {
        uColor: { value: this.color },
        uLimb: { value: this.limb },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uBoil: { value: 0.3 },
        uHot: { value: new Color(1, 0.97, 0.9) },
        uBright: { value: 1 },
        uFlareDir: { value: new Vector3(0, 1, 0) },
        uFlare: { value: 0 },
        uGran: { value: 7 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vObj;
        varying vec3 vN;
        varying vec3 vWorld;
        void main() {
          vObj = position;
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        uniform vec3 uColor;
        uniform vec3 uLimb;
        uniform vec3 uHot;
        uniform float uTime;
        uniform float uSeed;
        uniform float uBoil;
        uniform float uBright;
        uniform vec3 uFlareDir;
        uniform float uFlare;
        uniform float uGran;
        varying vec3 vObj;
        varying vec3 vN;
        varying vec3 vWorld;
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vN);
          float mu = clamp(dot(N, V), 0.0, 1.0);
          vec3 p = normalize(vObj);
          float t = uTime * (0.08 + uBoil * 0.25);
          // Granulation: cells of hot rising plasma with dark lanes.
          float g1 = fbm3(p * uGran + vec3(uSeed, t, -t));
          float g2 = vnoise(p * uGran * 2.7 + vec3(t * 1.7, uSeed, t));
          float gran = mix(g1, g2, 0.35);
          // Large-scale convection (supergiants have a few huge cells).
          float big = fbm3(p * 1.6 + vec3(t * 0.6, uSeed * 0.3, 0.0));
          // Sunspots.
          float spots = smoothstep(0.66, 0.74, fbm3(p * 2.3 + vec3(uSeed * 2.0, t * 0.2, 0.0)));
          // Incandescent body: hot white-gold center falling to a deep, saturated limb.
          float center = pow(mu, 0.5);
          vec3 col = mix(uLimb, uColor, smoothstep(0.0, 0.55, center));
          col = mix(col, uHot, smoothstep(0.45, 1.0, center) * 0.85);
          // Texture: subtle granulation, big convection cells when boiling, rare spots.
          float tex = 1.0 + (gran - 0.5) * (0.28 + uBoil * 0.25) + uBoil * (big - 0.5) * 0.7;
          tex *= 1.0 - spots * 0.45 * (1.0 - uBoil);
          // Faculae: bright filigree near the limb.
          tex += smoothstep(0.62, 0.8, g2) * (1.0 - mu) * 0.35;
          col *= tex;
          // Flare reaching toward a touch.
          float f = pow(max(dot(p, normalize(uFlareDir)), 0.0), 18.0) * uFlare;
          col += uHot * f * 1.6;
          col *= uBright * 1.15;
          gl_FragColor = vec4(min(col, vec3(1.6)), 1.0);
        }`,
    });
    this.core = new Mesh(sphere, this.mat);
    this.core.renderOrder = 5;
    this.corona = new Glow({ color: this.color, rays: 1, core: 0.12, renderOrder: 31 });
    this.haze = new Glow({ color: this.color, rays: 0, core: 0.0, renderOrder: 30 });
    this.group.add(this.core, this.corona.mesh, this.haze.mesh);
  }

  /** Reach a flare toward a world-space point with strength 0..1. */
  flareToward(worldPoint: Vector3, strength: number) {
    const d = this.mat.uniforms.uFlareDir.value as Vector3;
    d.copy(worldPoint).sub(this.group.position);
    this.mat.uniforms.uFlare.value = strength;
  }

  update(time: number) {
    const r = this.radius;
    this.core.scale.setScalar(r);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uBoil.value = this.boil;
    this.mat.uniforms.uBright.value = this.brightness;
    this.mat.uniforms.uHot.value = this.hot;
    this.mat.uniforms.uGran.value = 7 + 9 * Math.min(1, 0.03 / Math.max(r, 0.001));
    this.corona.material.uniforms.uColor.value = this.color;
    this.corona.set(null, r * this.coronaScale, 0.9 * this.brightness);
    this.corona.tick(time);
    this.haze.set(null, r * this.coronaScale * 2.6, 0.22 * this.brightness);
  }

  dispose() {
    this.mat.dispose();
    this.corona.material.dispose();
    this.haze.material.dispose();
  }
}
