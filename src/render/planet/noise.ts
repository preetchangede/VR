/**
 * GLSL noise for the little worlds. Everything is evaluated on the sphere's
 * object-space direction, so nothing stretches or seams.
 *
 * Costs (scalar ALU ops, roughly): pnoise ~110, pvoronoi ~330 (2x2x2 cells).
 * Hashes avoid sin() so they stay stable in highp on mobile GPUs.
 */
export const PLANET_NOISE = /* glsl */ `
// Hoskins "hash without sine".
float ph11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec3 ph33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// hash13 for four lattice points at once; x/y/z are already fract(i * 0.1031).
vec4 ph4(vec4 x, vec4 y, vec4 z) {
  vec4 d = x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32);
  return fract((x + y + 2.0 * d) * (z + d));
}
// 3D value noise in [0, 1].
float pnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = x - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  vec2 hx = fract(vec2(i.x, i.x + 1.0) * 0.1031);
  vec2 hy = fract(vec2(i.y, i.y + 1.0) * 0.1031);
  vec2 hz = fract(vec2(i.z, i.z + 1.0) * 0.1031);
  vec4 X = hx.xyxy;
  vec4 Y = hy.xxyy;
  vec4 a = ph4(X, Y, hz.xxxx);
  vec4 b = ph4(X, Y, hz.yyyy);
  vec4 c = mix(a, b, u.z);
  vec2 d = mix(c.xz, c.yw, u.x);
  return mix(d.x, d.y, u.y);
}
// Octave rotation (orthonormal) hides the value-noise lattice.
const mat3 PROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
// Signed fBm (mean 0) with a fractional octave count, so detail can fade in and
// out with screen size without popping or shifting the mean (sea level).
float pfbm(vec3 p, float oct) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 7; i++) {
    float k = clamp(oct - float(i), 0.0, 1.0);
    if (k <= 0.0) break;
    s += a * k * (pnoise(p) - 0.5);
    p = PROT * p * 2.03 + vec3(1.7, -3.1, 2.3);
    a *= 0.5;
  }
  return s;
}
// Cellular noise over the 2x2x2 block of cells nearest x (jitter <= ~0.8 keeps
// it artifact-free in practice). Returns:
//   x = F1 distance, y = distance to the bisector of the two nearest features
//   (a true, uniform-width "crack" distance), z = nearest cell hash, w = F2.
vec4 pvoronoi(vec3 x, float jitter) {
  vec3 p = floor(x - 0.5);
  vec3 f = x - p;
  float d1 = 1e9;
  float d2 = 1e9;
  vec3 r1 = vec3(0.0);
  vec3 r2 = vec3(1.0);
  float id = 0.0;
  for (int k = 0; k < 2; k++)
  for (int j = 0; j < 2; j++)
  for (int i = 0; i < 2; i++) {
    vec3 b = vec3(float(i), float(j), float(k));
    vec3 h = ph33(p + b);
    vec3 r = b + 0.5 + (h - 0.5) * jitter - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; id = h.z; }
    else if (d < d2) { d2 = d; r2 = r; }
  }
  vec3 dr = r2 - r1;
  float edge = dot(0.5 * (r1 + r2), dr) * inversesqrt(max(dot(dr, dr), 1e-6));
  return vec4(sqrt(d1), edge, id, sqrt(d2));
}
`;
