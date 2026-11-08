import {
  BackSide,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  NoBlending,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
} from '@iwsdk/core';
import { NOISE, STARFIELD } from './glsl';
import { BONES, Hand } from '../xr/hands';

/**
 * THE RELIGHTING MODEL
 *
 * On Quest, WebXR immersive-ar content is composited over passthrough with
 * premultiplied alpha:  display = rgb + (1 - alpha) * passthrough.
 *
 * So for anything that stands for a *real* surface (room mesh, table, the
 * user's own hands) we can write:
 *   alpha = how much of the real world we take away (darkness)
 *   rgb   = light we add on top (colored glow)
 * Drawing real geometry this way lets virtual stars light the real room,
 * pulsar beams sweep real walls, and the room "burn away" into space. Because
 * these receivers also write depth, real objects occlude virtual ones.
 */
export const MAX_LIGHTS = 6;

export const receiverUniforms = {
  uDim: { value: 0 },
  uTint: { value: new Color(0.0, 0.006, 0.02) },
  uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4(0, -100, 0, 0.2)) },
  uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4(0, 0, 0, 0)) },
  uLightCount: { value: 0 },
  /** xyz = pulsar position, w = intensity. */
  uBeam: { value: new Vector4(0, 0, 0, 0) },
  uBeamAxis: { value: new Vector3(0, 1, 0) },
  uBeamColor: { value: new Color(0.55, 0.75, 1.0) },
  /** xyz = center, w = radius of the burn-away (0 = none). */
  uBurn: { value: new Vector4(0, 0, 0, 0) },
  /** xyz = center of the well opening on the table, w = radius (0 = none). */
  uHole: { value: new Vector4(0, 0, 0, 0) },
  /** Global flash (additive white), for ignition / supernova. */
  uFlash: { value: new Color(0, 0, 0) },
  uTime: { value: 0 },
  uSpaceNebula: { value: 0.6 },
};

const RECEIVER_FRAG = /* glsl */ `
${NOISE}
${STARFIELD}
uniform float uDim;
uniform vec3 uTint;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec4 uLightCol[${MAX_LIGHTS}];
uniform int uLightCount;
uniform vec4 uBeam;
uniform vec3 uBeamAxis;
uniform vec3 uBeamColor;
uniform vec4 uBurn;
uniform vec4 uHole;
uniform vec3 uFlash;
uniform float uTime;
uniform float uSpaceNebula;
uniform float uIsHand;
uniform float uIsSky;
varying vec3 vWorldPos;
varying vec3 vNormal;

vec3 gatherLight(vec3 P, vec3 N) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 L = uLightPos[i].xyz - P;
    float d2 = max(dot(L, L), 1e-5);
    vec3 Ld = L * inversesqrt(d2);
    // Wrap lighting: receivers are approximate surfaces, keep falloff soft.
    float ndl = clamp(dot(N, Ld) * 0.7 + 0.3, 0.0, 1.0);
    float r = uLightPos[i].w;
    float att = uLightCol[i].a / (1.0 + d2 / (r * r));
    light += uLightCol[i].rgb * att * ndl;
  }
  if (uBeam.w > 0.0) {
    vec3 d = normalize(P - uBeam.xyz);
    float c = abs(dot(d, uBeamAxis));
    float beam = smoothstep(0.985, 0.9995, c) * 0.9 + smoothstep(0.93, 0.99, c) * 0.12;
    light += uBeamColor * beam * uBeam.w;
  }
  return light;
}

void main() {
  if (uIsSky < 0.5 && uHole.w > 0.0) {
    vec3 h = vWorldPos - uHole.xyz;
    if (length(h.xz) < uHole.w && abs(h.y) < 0.06) discard;
  }
  vec3 N = normalize(vNormal);
  vec3 light = uIsSky > 0.5 ? vec3(0.0) : gatherLight(vWorldPos, N);
  float lum = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  // Real-world visibility: dimmed overall, restored where virtual light falls.
  float alpha = uDim * (1.0 - lum);
  // Hands get a gentler additive tint: the alpha relight does the real work,
  // and strong additive light would outline the (inflated) occluder.
  float addK = uIsHand > 0.5 ? 0.07 : 0.22 + 0.25 * uDim;
  vec3 rgb = uTint * uDim * (1.0 - lum) + light * addK + uFlash;

  if (uBurn.w > 0.0 && uIsHand < 0.5) {
    float dist = uIsSky > 0.5 ? 3.2 : distance(vWorldPos, uBurn.xyz);
    float wobble = (fbm3(vWorldPos * 6.0 + uTime * 0.3) - 0.5) * 0.35;
    float edge = uBurn.w - dist + wobble * min(uBurn.w, 1.0);
    if (edge > 0.0) {
      vec3 dir = normalize(vWorldPos - cameraPosition);
      vec3 space = deepSky(dir, uSpaceNebula);
      float ember = smoothstep(0.12, 0.0, edge);
      vec3 emberCol = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.92, 0.7), smoothstep(0.06, 0.0, edge));
      rgb = mix(space, emberCol * 1.6, ember * ember);
      alpha = 1.0;
    } else {
      float glow = smoothstep(-0.25, 0.0, edge);
      rgb += vec3(1.0, 0.45, 0.12) * glow * glow * 0.6;
    }
  }
  gl_FragColor = vec4(rgb, alpha);
}
`;

const RECEIVER_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * local;
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export function createReceiverMaterial(kind: 'surface' | 'hand' | 'sky' = 'surface') {
  return new ShaderMaterial({
    uniforms: {
      ...receiverUniforms,
      uIsHand: { value: kind === 'hand' ? 1 : 0 },
      uIsSky: { value: kind === 'sky' ? 1 : 0 },
    },
    vertexShader: RECEIVER_VERT,
    fragmentShader: RECEIVER_FRAG,
    blending: NoBlending,
    transparent: false,
    depthWrite: kind !== 'sky',
    depthTest: true,
    side: kind === 'sky' ? BackSide : 0,
  });
}

/**
 * Dims the parts of the real world not covered by any receiver (or all of it
 * when there is no room mesh). A big sphere centered on the viewer, drawn after
 * the room receivers with depth testing, so it only fills the gaps.
 */
export class Dimmer {
  readonly mesh: Mesh;
  constructor() {
    this.mesh = new Mesh(new SphereGeometry(60, 32, 16), createReceiverMaterial('sky'));
    this.mesh.renderOrder = -90;
    this.mesh.frustumCulled = false;
  }
  follow(head: Vector3) {
    this.mesh.position.copy(head);
  }
}

/**
 * The user's real hands as receivers: spheres along every bone. They occlude
 * virtual content behind the hands and are relit by virtual stars, so your
 * real palms glow with the star you are holding.
 */
export class HandReceivers {
  readonly mesh: InstancedMesh;
  private readonly perHand: number;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private static readonly STEPS = 3;

  constructor() {
    this.perHand = 25 + BONES.length * (HandReceivers.STEPS - 1);
    const geo = new IcosahedronGeometry(1, 1);
    this.mesh = new InstancedMesh(geo, createReceiverMaterial('hand'), this.perHand * 2);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(hands: Hand[]) {
    let i = 0;
    const inflate = 1.12;
    for (const h of hands) {
      if (!h.tracked || h.isController) continue;
      for (let k = 0; k < 25; k++) {
        const r = h.radii[k] * inflate + 0.002;
        this.m.makeScale(r, r, r).setPosition(h.joints[k]);
        this.mesh.setMatrixAt(i++, this.m);
      }
      for (const [a, b] of BONES) {
        for (let s = 1; s < HandReceivers.STEPS; s++) {
          const t = s / HandReceivers.STEPS;
          this.p.copy(h.joints[a]).lerp(h.joints[b], t);
          const r = (h.radii[a] * (1 - t) + h.radii[b] * t) * inflate + 0.003;
          this.m.makeScale(r, r, r).setPosition(this.p);
          this.mesh.setMatrixAt(i++, this.m);
        }
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
