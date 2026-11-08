import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from '@iwsdk/core';
import { additive } from './blend';
import { NOISE } from './glsl';

/**
 * Camera-facing glow billboard. Billboarding happens in view space inside the
 * vertex shader, so it is correct per eye under multiview.
 */
export class Glow {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  constructor(opts: { color?: Color; size?: number; rays?: number; core?: number; renderOrder?: number } = {}) {
    this.material = additive(
      new ShaderMaterial({
        uniforms: {
          uColor: { value: opts.color ?? new Color(1, 0.8, 0.5) },
          uSize: { value: opts.size ?? 0.1 },
          uIntensity: { value: 1 },
          uRays: { value: opts.rays ?? 0 },
          uCore: { value: opts.core ?? 0.15 },
          uTime: { value: 0 },
          uSeed: { value: Math.random() * 100 },
        },
        vertexShader: /* glsl */ `
          uniform float uSize;
          varying vec2 vUv;
          void main() {
            vUv = position.xy * 2.0;
            vec4 mv = viewMatrix * vec4(modelMatrix[3].xyz, 1.0);
            mv.xy += position.xy * uSize * 2.0;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          ${NOISE}
          uniform vec3 uColor;
          uniform float uIntensity;
          uniform float uRays;
          uniform float uCore;
          uniform float uTime;
          uniform float uSeed;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            float a = atan(vUv.y, vUv.x);
            float halo = exp(-r * 5.0) * 0.6 + exp(-r * 14.0) * 0.8;
            float core = uCore > 0.0 ? 1.0 - smoothstep(0.0, uCore, r) : 0.0;
            float rays = 0.0;
            if (uRays > 0.0) {
              float n = vnoise(vec3(a * 4.0 + uSeed, uTime * 0.15, uSeed)) * 0.6 + vnoise(vec3(a * 11.0, uTime * 0.3, uSeed + 3.0)) * 0.4;
              rays = pow(n, 3.0) * exp(-r * 3.2) * uRays * 1.6;
            }
            float fade = smoothstep(1.0, 0.7, r);
            vec3 col = uColor * (halo + rays) + mix(uColor, vec3(1.0), 0.75) * core * 1.5;
            gl_FragColor = vec4(col * uIntensity * fade, 0.0);
          }`,
      }),
    );
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 30;
  }
  /** Position (null keeps the current local position), world size and intensity. */
  set(position: Vector3 | null, size: number, intensity: number) {
    if (position) this.mesh.position.copy(position);
    this.material.uniforms.uSize.value = size;
    this.material.uniforms.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.002 && size > 0;
  }
  tick(time: number) {
    this.material.uniforms.uTime.value = time;
  }
}
