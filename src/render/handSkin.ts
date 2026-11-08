import { Mesh, NoBlending, Object3D, ShaderMaterial, SkinnedMesh } from '@iwsdk/core';
import { params } from '../core/params';
import { MAX_LIGHTS, receiverUniforms } from './receiver';

/**
 * IWSDK's hand visual is a skinned hand mesh drawn as an invisible depth
 * stencil (so real passthrough hands occlude virtual content) plus a white
 * outline. We swap in our own materials:
 *
 *  - in mixed reality: a skinned *receiver* — the exact hand shape occludes
 *    virtual content and relights the real hand with nearby stars;
 *  - in cine mode (emulator footage, where there is no real camera feed): a
 *    lit skin material, so the trailer shows believable hands.
 */
const SKIN_VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    vec3 transformed = vec3(position);
    #include <skinning_vertex>
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * objectNormal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const LIGHT_FN = /* glsl */ `
  uniform vec4 uLightPos[${MAX_LIGHTS}];
  uniform vec4 uLightCol[${MAX_LIGHTS}];
  uniform int uLightCount;
  uniform float uDim;
  uniform vec3 uFlash;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  vec3 starLight(vec3 P, vec3 N, out float lum) {
    vec3 light = vec3(0.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uLightCount) break;
      vec3 L = uLightPos[i].xyz - P;
      float d2 = max(dot(L, L), 1e-5);
      vec3 Ld = L * inversesqrt(d2);
      float ndl = clamp(dot(N, Ld) * 0.7 + 0.3, 0.0, 1.0);
      float r = uLightPos[i].w;
      light += uLightCol[i].rgb * (uLightCol[i].a / (1.0 + d2 / (r * r))) * ndl;
    }
    lum = 1.0 - exp(-1.3 * max(light.r, max(light.g, light.b)));
    return light;
  }`;

function skinnedReceiver() {
  return new ShaderMaterial({
    uniforms: { ...receiverUniforms },
    vertexShader: SKIN_VERT,
    fragmentShader: /* glsl */ `
      ${LIGHT_FN}
      uniform vec3 uTint;
      void main() {
        float lum;
        vec3 light = starLight(vWorldPos, normalize(vNormal), lum);
        float alpha = uDim * (1.0 - lum);
        vec3 rgb = uTint * uDim * (1.0 - lum) + light * 0.07 + uFlash;
        gl_FragColor = vec4(rgb, alpha);
      }`,
    blending: NoBlending,
    depthWrite: true,
    depthTest: true,
  });
}

function skinShaded() {
  return new ShaderMaterial({
    uniforms: { ...receiverUniforms },
    vertexShader: SKIN_VERT,
    fragmentShader: /* glsl */ `
      ${LIGHT_FN}
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float lum;
        vec3 light = starLight(vWorldPos, N, lum);
        // Room ambient that dims with the room, plus star light with a
        // reddish subsurface wrap and a soft rim.
        vec3 albedo = vec3(0.78, 0.58, 0.48);
        float amb = (0.55 + 0.25 * N.y) * (1.0 - uDim * 0.85);
        float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        vec3 col = albedo * amb + albedo * light * 1.3 + vec3(0.9, 0.35, 0.25) * light * 0.35 * (1.0 - abs(dot(N, V)));
        col += rim * (0.06 + light * 0.4);
        gl_FragColor = vec4(col + uFlash, 1.0);
      }`,
    blending: NoBlending,
  });
}

export class HandSkins {
  private readonly applied = new WeakSet<Object3D>();
  private readonly receiver = skinnedReceiver();
  private readonly skin = skinShaded();
  /** True once IWSDK's skinned hands are in use (sphere occluders can retire). */
  active = false;

  update(models: (Object3D | undefined)[]) {
    let any = false;
    for (const model of models) {
      if (!model) continue;
      any = true;
      if (this.applied.has(model)) continue;
      this.applied.add(model);
      model.traverse((o) => {
        if (!(o as SkinnedMesh).isSkinnedMesh) return;
        const m = o as Mesh;
        if (m.renderOrder === 999) {
          // IWSDK's white outline: hidden; our look is the light on your skin.
          m.visible = false;
          return;
        }
        m.material = params.cine ? this.skin : this.receiver;
        m.renderOrder = params.cine ? 10 : -100;
      });
    }
    this.active = any;
  }
}
