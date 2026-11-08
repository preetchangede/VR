/**
 * Shared GLSL. Everything is procedural: no textures are downloaded, so the
 * app cold-starts instantly and stays tiny.
 */

export const NOISE = /* glsl */ `
// Hash and value noise (cheap, stable on mobile GPUs).
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float fbm5(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

/**
 * Procedural deep sky by direction: a few layers of hashed stars, a faint
 * galactic band and colored nebula haze. `uSkySeed` rotates it so the well,
 * the burn-away and the surface sky can share one look but not one pattern.
 */
export const STARFIELD = /* glsl */ `
vec3 starLayer(vec3 dir, float scale, float density, float size) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  vec3 h = hash33(cell);
  if (h.x > density) return vec3(0.0);
  vec3 center = cell + 0.2 + 0.6 * hash33(cell + 7.7);
  float d = length(p - center);
  float b = smoothstep(size, 0.0, d);
  b *= b;
  float t = h.y;
  vec3 col = t < 0.33 ? vec3(0.75, 0.82, 1.0) : t < 0.8 ? vec3(1.0, 0.97, 0.9) : vec3(1.0, 0.78, 0.55);
  return col * b * (0.4 + 1.6 * h.z * h.z);
}
vec3 deepSky(vec3 dir, float nebulaAmount) {
  vec3 c = vec3(0.004, 0.006, 0.016);
  // Galactic band.
  float band = exp(-pow(dot(dir, normalize(vec3(0.3, 0.85, 0.42))) * 3.2, 2.0));
  float dust = fbm3(dir * 4.0 + 3.0);
  c += vec3(0.05, 0.045, 0.06) * band * (0.4 + dust);
  // Nebula haze.
  float n1 = fbm3(dir * 2.2 + 11.0);
  float n2 = fbm3(dir * 3.1 - 5.0);
  c += nebulaAmount * (vec3(0.16, 0.03, 0.08) * smoothstep(0.45, 0.8, n1) + vec3(0.02, 0.07, 0.12) * smoothstep(0.5, 0.85, n2));
  c += starLayer(dir, 90.0, 0.10, 0.22);
  c += starLayer(dir, 180.0, 0.16, 0.18) * 0.7;
  c += starLayer(dir, 360.0, 0.22, 0.16) * 0.45 * (0.5 + band);
  return c;
}
`;
