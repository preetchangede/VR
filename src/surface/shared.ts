import {
  ClampToEdgeWrapping,
  Color,
  Data3DTexture,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  Quaternion,
  RGBAFormat,
  Vector3,
  Vector4,
} from '@iwsdk/core';
import { toHalfArray } from './half';
import { bakeSky, computeDawn, DawnState, LUT_NU, LUT_NV, LUT_NW, lutW, makeDawnState, SkyBake } from './atmosphere';

const DEG = Math.PI / 180;

function lutTexture(src: Float32Array) {
  const half = toHalfArray(src);
  const tex = new Data3DTexture(half, LUT_NU, LUT_NV, LUT_NW);
  tex.format = RGBAFormat;
  tex.type = HalfFloatType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Uniforms shared (by reference) across every material of the dawn scene,
 * plus the mapping from dawn progress to sun, sky and exposure. Directions
 * are kept in the group's local frame and pushed to world space each frame,
 * so the integrator may rotate/translate the group freely.
 */
export class Shared {
  readonly bake: SkyBake;
  readonly dawn: DawnState = makeDawnState();
  readonly sunLocal = new Vector3(0, 0, -1);
  readonly sunHLocal = new Vector3(0, 0, -1);
  readonly lutR: Data3DTexture;
  readonly lutM: Data3DTexture;
  readonly sunRadius: number;

  readonly uniforms: {
    uTime: { value: number };
    uUp: { value: Vector3 };
    uSunDir: { value: Vector3 };
    uSunH: { value: Vector3 };
    uSunLight: { value: Vector3 };
    uSunDisk: { value: Vector3 };
    uAmb0: { value: Vector3 };
    uAmbX: { value: Vector3 };
    uAmbY: { value: Vector3 };
    uLutR: { value: Data3DTexture };
    uLutM: { value: Data3DTexture };
    uLutW: { value: number };
    uExposure: { value: number };
    uFade: { value: number };
    uNight: { value: number };
    uGlow: { value: number };
    uDawn: { value: number };
    uFog: { value: Vector4 };
    uGlare: { value: Vector3 };
    uSeaY: { value: number };
    uNoise: { value: DataTexture };
    uSunRadius: { value: number };
    uNightSky: { value: Vector3 };
    uCloudLight: { value: Vector3 };
    uGrade: { value: Vector3 };
    /** group-local -> world rotation */
    uLocalRot: { value: Matrix3 };
  };
  private readonly m4 = new Matrix4();

  constructor(sunColor: Color, sunSize: number, noise: DataTexture, readonly seaLevel: number) {
    // Colors in this project hold display-space (sRGB-encoded) numbers.
    const c = (v: number) => Math.min(1, Math.max(0, v));
    this.bake = bakeSky([c(sunColor.r), c(sunColor.g), c(sunColor.b)]);
    this.lutR = lutTexture(this.bake.ray);
    this.lutM = lutTexture(this.bake.mie);
    this.sunRadius = 0.85 * DEG * Math.min(2.2, Math.max(0.4, sunSize));
    this.uniforms = {
      uTime: { value: 0 },
      uUp: { value: new Vector3(0, 1, 0) },
      uSunDir: { value: new Vector3(0, 0, -1) },
      uSunH: { value: new Vector3(0, 0, -1) },
      uSunLight: { value: new Vector3() },
      uSunDisk: { value: new Vector3() },
      uAmb0: { value: new Vector3() },
      uAmbX: { value: new Vector3() },
      uAmbY: { value: new Vector3() },
      uLutR: { value: this.lutR },
      uLutM: { value: this.lutM },
      uLutW: { value: 0.5 },
      uExposure: { value: 1 },
      uFade: { value: 1 },
      uNight: { value: 1 },
      uGlow: { value: 1 },
      uDawn: { value: 0 },
      // x: haze /m, y: sea-mist density /m, z: mist falloff /m, w: fog color gain
      uFog: { value: new Vector4(0.0016, 0.006, 0.45, 1.0) },
      uGlare: { value: new Vector3() },
      uSeaY: { value: seaLevel },
      uNoise: { value: noise },
      uSunRadius: { value: this.sunRadius },
      uNightSky: { value: new Vector3() },
      uCloudLight: { value: new Vector3() },
      uGrade: { value: new Vector3(1, 1, 1) },
      uLocalRot: { value: new Matrix3() },
    };
  }

  setDawn(t: number) {
    const s = computeDawn(this.bake, t, this.sunRadius, this.dawn);
    const u = this.uniforms;
    u.uDawn.value = s.t;
    this.sunLocal.set(Math.sin(s.az) * Math.cos(s.elev), Math.sin(s.elev), -Math.cos(s.az) * Math.cos(s.elev));
    this.sunHLocal.set(Math.sin(s.az), 0, -Math.cos(s.az));
    u.uLutW.value = lutW(s.elev);
    u.uSunLight.value.fromArray(s.sunLight);
    u.uSunDisk.value.fromArray(s.sunDisk);
    u.uGlare.value.fromArray(s.glare);
    u.uAmb0.value.fromArray(s.amb0);
    u.uAmbX.value.fromArray(s.ambX);
    u.uAmbY.value.fromArray(s.ambY);
    u.uNightSky.value.fromArray(s.nightSky);
    u.uCloudLight.value.fromArray(s.cloudLight);
    // grade: a touch cool in twilight, warm and golden by morning
    const w = Math.min(1, Math.max(0, (s.t - 0.3) / 0.7));
    const k = w * w * (3 - 2 * w);
    u.uGrade.value.set(0.97 + 0.1 * k, 0.99 + 0.02 * k, 1.04 - 0.14 * k);
    u.uExposure.value = s.exposure;
    u.uNight.value = s.night;
    u.uGlow.value = s.glow;
  }

  /** Push local-frame directions to world space (group rotation). */
  updateWorld(q: Quaternion, seaWorldY: number) {
    const u = this.uniforms;
    u.uUp.value.set(0, 1, 0).applyQuaternion(q);
    u.uSunDir.value.copy(this.sunLocal).applyQuaternion(q);
    u.uSunH.value.copy(this.sunHLocal).applyQuaternion(q);
    u.uSeaY.value = seaWorldY;
    u.uLocalRot.value.setFromMatrix4(this.m4.makeRotationFromQuaternion(q));
  }

  dispose() {
    this.lutR.dispose();
    this.lutM.dispose();
  }
}

export { DEG };
