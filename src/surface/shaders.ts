import { LUT_NU, LUT_NV, MIE_G } from './atmosphere';

const f = (n: number) => n.toFixed(6);

/**
 * GLSL shared by every material of the dawn scene. All lighting happens in
 * world space in linear HDR; `finalize()` applies aerial perspective, the
 * sun's veiling glare, exposure, a filmic curve, sRGB encoding, dither and the
 * global fade, and every material writes alpha = 1.
 */
export const COMMON = /* glsl */ `
#define PI 3.14159265
uniform float uTime;
uniform vec3 uUp;
uniform vec3 uSunDir;
uniform vec3 uSunH;
uniform vec3 uSunLight;
uniform vec3 uSunDisk;
uniform vec3 uAmb0;
uniform vec3 uAmbX;
uniform vec3 uAmbY;
uniform highp sampler3D uLutR;
uniform highp sampler3D uLutM;
uniform float uLutW;
uniform float uExposure;
uniform float uFade;
uniform float uNight;
uniform float uGlow;
uniform float uDawn;
uniform vec4 uFog;
uniform vec3 uGlare;
uniform float uSeaY;
uniform sampler2D uNoise;
uniform vec3 uNightSky;
uniform mat3 uLocalRot;
uniform float uSunRadius;
uniform vec3 uCloudLight;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float phaseMie(float mu) {
  const float g = ${f(MIE_G)};
  const float g2 = g * g;
  return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu * mu)) /
         ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

/** In-scattered sky radiance looking along d (elevation clamped at the horizon). */
vec3 skyLut(vec3 d) {
  float y = clamp(dot(d, uUp), 0.0, 1.0);
  float v = sqrt(asin(y) / (0.5 * PI));
  vec3 h = d - uUp * dot(d, uUp);
  float hl = dot(h, h);
  float ca = hl > 1e-8 ? dot(h, uSunH) * inversesqrt(hl) : 0.0;
  float u = acos(clamp(ca, -1.0, 1.0)) / PI;
  vec3 uvw = vec3((0.5 + u * ${f(LUT_NU - 1)}) / ${f(LUT_NU)}, (0.5 + v * ${f(LUT_NV - 1)}) / ${f(LUT_NV)}, uLutW);
  vec3 r = texture(uLutR, uvw).rgb;
  vec3 m = texture(uLutM, uvw).rgb;
  return r + m * min(phaseMie(dot(d, uSunDir)), 40.0) + uNightSky;
}

/** Same without the Mie phase peak (for broad fog / ambient use). */
vec3 skyLutSoft(vec3 d) {
  float y = clamp(dot(d, uUp), 0.0, 1.0);
  float v = sqrt(asin(y) / (0.5 * PI));
  vec3 h = d - uUp * dot(d, uUp);
  float hl = dot(h, h);
  float ca = hl > 1e-8 ? dot(h, uSunH) * inversesqrt(hl) : 0.0;
  float u = acos(clamp(ca, -1.0, 1.0)) / PI;
  vec3 uvw = vec3((0.5 + u * ${f(LUT_NU - 1)}) / ${f(LUT_NU)}, (0.5 + v * ${f(LUT_NV - 1)}) / ${f(LUT_NV)}, uLutW);
  return texture(uLutR, uvw).rgb + texture(uLutM, uvw).rgb * min(phaseMie(dot(d, uSunDir)), 6.0) + uNightSky;
}

/** Sky ambient irradiance for a surface normal (L1 SH, includes sea bounce). */
vec3 ambient(vec3 n) {
  return max(uAmb0 + uAmbX * dot(n, uSunH) + uAmbY * dot(n, uUp), vec3(0.0));
}

/** Veiling glare of the sun (eye / lens), added over everything in view. */
vec3 sunGlare(vec3 dir) {
  float c = dot(dir, uSunDir);
  float a = sqrt(max(2.0 - 2.0 * c, 0.0));
  return uGlare * (1.6 * exp(-a * 34.0) + 0.32 * exp(-a * 9.0) + 0.07 * exp(-a * 3.0));
}

/** Aerial perspective + low sea mist. */
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float d = length(v);
  vec3 dir = v / max(d, 1e-4);
  float dy = dot(v, uUp);
  float hc = dot(cameraPosition, uUp) - uSeaY;
  float k = uFog.z;
  float fh = abs(dy) > 0.05 ? (exp(-k * hc) - exp(-k * (hc + dy))) / (k * dy) : exp(-k * hc);
  float tau = d * (uFog.x + uFog.y * fh);
  float T = exp(-tau);
  vec3 fd = dir;
  float fy = dot(fd, uUp);
  fd = normalize(fd - uUp * (fy - max(fy, 0.015)));
  vec3 fogCol = skyLutSoft(fd) * uFog.w;
  return col * T + fogCol * (1.0 - T);
}

uniform vec3 uGrade;
vec3 tonemap(vec3 c) {
  c *= uExposure * uGrade;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}

float dither() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
}

vec4 outColor(vec3 hdr) {
  vec3 c = tonemap(hdr) * uFade;
  c += dither() / 255.0;
  return vec4(c, 1.0);
}

/** Fog + glare + display mapping for a surface point. */
vec4 finalize(vec3 col, vec3 wp) {
  vec3 dir = normalize(wp - cameraPosition);
  col = applyFog(col, wp);
  col += sunGlare(dir);
  return outColor(col);
}
`;
