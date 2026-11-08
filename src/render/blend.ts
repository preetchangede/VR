import {
  AddEquation,
  CustomBlending,
  Material,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ZeroFactor,
} from '@iwsdk/core';

/**
 * Pure additive light: rgb is added, destination alpha is left untouched.
 * Over passthrough this *adds light to the real world* without darkening it,
 * because the compositor shows `rgb + (1 - a) * passthrough`.
 */
export function additive<T extends Material>(m: T): T {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendEquation = AddEquation;
  m.blendSrc = OneFactor;
  m.blendDst = OneFactor;
  m.blendEquationAlpha = AddEquation;
  m.blendSrcAlpha = ZeroFactor;
  m.blendDstAlpha = OneFactor;
  return m;
}

/**
 * Premultiplied "over" blending: the shader outputs premultiplied rgb and a
 * coverage alpha. Coverage also darkens passthrough behind it (it is opaque-ish
 * matter, e.g. dust lanes, planet rings).
 */
export function premultipliedOver<T extends Material>(m: T): T {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendEquation = AddEquation;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = AddEquation;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  return m;
}
