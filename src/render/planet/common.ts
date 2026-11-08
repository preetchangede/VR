/**
 * GLSL shared by every planet layer. All lighting is done in the planet's
 * (non-spinning, tilted) object space, in units of the planet radius, with
 * linear colors; `toDisplay` encodes the final value for the framebuffer.
 */

/** One vertex shader for body, clouds, atmosphere and rings. */
export const PLANET_VERT = /* glsl */ `
uniform vec3 uStarPos;
varying vec3 vPos;
varying vec3 vL;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // Eye position of THIS view: viewMatrix is per-eye under OCULUS_multiview,
  // cameraPosition is not.
  vec3 eye = -(transpose(mat3(viewMatrix)) * viewMatrix[3].xyz);
  mat3 m = mat3(modelMatrix);
  // v * m == transpose(m) * v: world -> object for directions (uniform scale).
  vL = (uStarPos - wp.xyz) * m;
  vV = (eye - wp.xyz) * m;
  vPos = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PLANET_COMMON = /* glsl */ `
#define PI 3.14159265
uniform vec3 uLightCol;
uniform vec3 uAmbient;
uniform vec2 uSpinCS;
uniform vec2 uCloudCS;
uniform vec3 uSeedOff;
uniform float uTime;
uniform float uOct;
uniform float uMolten;
uniform float uOcean;
uniform float uIce;
uniform float uClouds;
uniform float uLife;
uniform float uRings;
uniform float uHighlight;
uniform float uSeaLevel;
uniform float uRefLevel;
uniform float uCloudThr;
uniform vec3 uAtmo;
uniform vec3 uSunset;
uniform float uAtmoAmt;
uniform vec3 uDust;
uniform float uSoft;
uniform vec4 uRing;
uniform vec4 uVort0;
uniform vec4 uVort1;
varying vec3 vPos;
varying vec3 vL;
varying vec3 vV;

// Rotate about the spin axis (+Y) by a precomputed (cos, sin).
vec3 spinY(vec3 p, vec2 cs) { return vec3(cs.x * p.x - cs.y * p.z, p.y, cs.y * p.x + cs.x * p.z); }

// Linear -> display. Gentle shoulder first so lava and glints don't clip flat.
vec3 toDisplay(vec3 c) {
  vec3 x = max(c - 0.62, 0.0);
  c = min(c, 0.62) + x / (1.0 + x * 2.6);
  return pow(max(c, 0.0), vec3(0.4545));
}

// Diffuse from a spherical light of angular radius asin(s): a soft, physically
// shaped terminator (the star is big as seen from a world 15 cm away).
float sphereLight(float ndl, float s) {
  float t = clamp(ndl + s, 0.0, 2.0 * s);
  return ndl > s ? ndl : t * t / (4.0 * s);
}

// Cloud field shared by the cloud shell and the shadows it casts on the body.
vec3 cloudSwirl(vec3 p, vec4 v) {
  float d = 1.0 - dot(p, v.xyz);
  float ang = v.w * exp(-d * 30.0);
  float c = cos(ang);
  float s = sin(ang);
  return p * c + cross(v.xyz, p) * s + v.xyz * dot(v.xyz, p) * (1.0 - c);
}
float cloudField(vec3 p, float oct) {
  p = cloudSwirl(p, uVort0);
  p = cloudSwirl(p, uVort1);
  vec3 q = p * vec3(3.0, 4.6, 3.0) + uSeedOff.zxy;
  float w = pnoise(q * 0.6 + vec3(uTime * 0.011, 0.0, -uTime * 0.008));
  q += (w - 0.5) * vec3(1.9, 0.7, 1.9);
  // Higher-gain fBm than the terrain: cloud decks are mostly mid-scale structure.
  float n = 0.0;
  float a = 0.5;
  for (int i = 0; i < 7; i++) {
    float k = clamp(oct - float(i), 0.0, 1.0);
    if (k <= 0.0) break;
    n += a * k * (pnoise(q) - 0.5);
    q = PROT * q * 2.07 + vec3(-2.1, 1.3, 0.7);
    a *= 0.6;
  }
  float lat = abs(p.y);
  // Wet tropics and stormy mid-latitudes, dry subtropics.
  n += 0.07 * exp(-lat * lat * 55.0) + 0.05 * exp(-(lat - 0.7) * (lat - 0.7) * 36.0)
     - 0.05 * exp(-(lat - 0.4) * (lat - 0.4) * 64.0);
  return n;
}

// Ring optical density at radius r (planet radii). uRing = (inner, outer, seed, 0).
float ringDensity(float r, float aa) {
  float x = (r - uRing.x) / (uRing.y - uRing.x);
  if (x <= 0.0 || x >= 1.0) return 0.0;
  float s = uRing.z;
  float d = smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.94, x);
  // Faint inner "C ring", dense "B ring", Cassini-like gap, medium outer "A ring".
  float gap = 0.62 + 0.1 * fract(s * 7.31);
  d *= mix(0.28, 1.0, smoothstep(0.16, 0.3, x));
  d *= mix(1.0, 0.62, smoothstep(gap, gap + 0.02, x));
  d *= smoothstep(0.012, 0.03, abs(x - gap - 0.01));
  float g2 = 0.86 + 0.06 * fract(s * 3.17);
  d *= mix(1.0, smoothstep(0.003, 0.009, abs(x - g2)), 0.8);
  // Ringlets: two scales of 1D value noise; the fine ones fade out when they
  // get smaller than a pixel.
  float n1 = mix(ph11(floor(x * 23.0) + s), ph11(floor(x * 23.0) + 1.0 + s), smoothstep(0.0, 1.0, fract(x * 23.0)));
  float n2 = mix(ph11(floor(x * 97.0) + s * 1.7), ph11(floor(x * 97.0) + 1.0 + s * 1.7), smoothstep(0.0, 1.0, fract(x * 97.0)));
  float fine = 1.0 - smoothstep(0.004, 0.012, aa);
  d *= 0.62 + 0.38 * n1;
  d *= mix(1.0, 0.7 + 0.3 * n2, fine);
  return clamp(d * 1.25, 0.0, 1.0);
}
`;
