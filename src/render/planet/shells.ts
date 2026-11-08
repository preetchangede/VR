import { PLANET_NOISE } from './noise';
import { PLANET_COMMON } from './common';

/**
 * Cloud shell: premultiplied "over" (clouds are matter: they hide the night-side
 * lights beneath them and dim passthrough at the limb).
 */
export const CLOUD_FRAG = /* glsl */ `
${PLANET_NOISE}
${PLANET_COMMON}
void main() {
  vec3 N = normalize(vPos);
  vec3 L = normalize(vL);
  vec3 V = normalize(vV);
  float ndl = dot(N, L);
  float ndv = dot(N, V);
  vec3 cp = spinY(N, uCloudCS);
  float d = cloudField(cp, min(uOct + 0.4, 5.0));
  float fw = fwidth(d);
  float cov = smoothstep(uCloudThr + 0.02 - fw, uCloudThr + 0.07 + fw, d);
  float thick = smoothstep(uCloudThr, uCloudThr + 0.22, d);
  // Thin the deck right at its own silhouette (no hard, aliased cloud edge).
  float limb = smoothstep(0.0, 0.18, ndv);
  float a = cov * mix(0.62, 0.97, thick) * limb * min(uClouds * 4.0, 1.0);
  // Volcanic worlds: thinner, ashier veils. Frozen worlds: thin icy haze.
  a *= (1.0 - 0.6 * smoothstep(0.3, 1.0, uMolten)) * (1.0 - 0.45 * uIce);
  // Lit like a scattering layer: soft terminator, sunset-colored edge.
  float day = sphereLight(ndl, uSoft + 0.08);
  vec3 tint = mix(mix(uSunset, vec3(1.0), 0.45), vec3(1.0), smoothstep(-0.04, 0.18, ndl));
  // Thick cores are brighter; thin edges let more color through.
  vec3 albC = mix(vec3(0.74, 0.77, 0.82), vec3(0.95, 0.96, 0.97), thick);
  albC = mix(albC, vec3(0.13, 0.115, 0.105), smoothstep(0.45, 1.0, uMolten) * 0.9);
  vec3 c = albC * (uLightCol * tint * day + uAmbient * 0.6);
  // Lava light from below on ash clouds.
  c += vec3(0.5, 0.12, 0.02) * uMolten * uMolten * (0.35 + 0.65 * (1.0 - thick)) * 0.5;
  gl_FragColor = vec4(toDisplay(c) * a, a);
}
`;

/**
 * Atmosphere: an additive shell (never touches destination alpha). For each
 * pixel the view ray is intersected analytically with the planet; the optical
 * depth comes from a thin exponential atmosphere, lit at the scattering point
 * with a sunset tint near the terminator and a forward-scattering lobe, so a
 * backlit world shows a bright thin crescent. Molten worlds add a lava halo.
 */
export const ATMO_FRAG = /* glsl */ `
${PLANET_NOISE}
${PLANET_COMMON}
uniform float uShell;     // shell radius (planet radii)
uniform float uThick;     // scale height (planet radii)
uniform vec3 uLava;       // lava halo color (linear, premultiplied by strength)
uniform vec3 uRim;        // highlight rim color (linear, premultiplied by strength)
void main() {
  vec3 P = vPos * uShell;
  vec3 D = -normalize(vV);
  vec3 L = normalize(vL);
  float b = dot(P, D);
  vec3 C = P - D * b;
  float dmin = length(C);
  // Profiles are evaluated in display space (this layer is added to the
  // framebuffer), so the halo keeps its intended thickness after encoding.
  vec3 sp;
  float prof;
  float lavaP;
  float rimP;
  if (dmin < 1.0) {
    float tHit = -b - sqrt(max(1.0 - dmin * dmin, 0.0));
    sp = P + D * tHit;
    float mu = max(dot(sp, -D), 0.0);
    prof = uThick / (mu + uThick);
    lavaP = uThick * 1.8 / (mu + uThick * 1.8);
    rimP = pow(1.0 - mu, 4.0);
  } else {
    sp = C / dmin;
    float x = (dmin - 1.0) / uThick;
    prof = exp(-x);
    lavaP = exp(-x / 1.8);
    rimP = exp(-x * 1.3);
  }
  vec3 n = normalize(sp);
  float nl = dot(n, L);
  float lit = smoothstep(-0.2, 0.18, nl);
  float cosT = dot(D, L);
  float g = 0.72;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
  float phase = 0.55 + 0.45 * cosT * cosT + hg * 0.1;
  vec3 scat = mix(uSunset, uAtmo, smoothstep(-0.1, 0.16, nl));
  vec3 col = toDisplay(uLightCol * scat * 0.55) * (prof * lit * phase * uAtmoAmt);
  col += toDisplay(uLava) * lavaP;
  col += toDisplay(uRim) * rimP;
  col *= smoothstep(uShell, uShell - 0.05, dmin);
  gl_FragColor = vec4(col, 0.0);
}
`;

/**
 * Rings: a flat annulus in the equatorial plane, double-sided, premultiplied
 * "over". Lit on the face toward the star, translucent glow from behind,
 * and shadowed by the planet. The same density drives the shadow band the
 * rings cast on the body.
 */
export const RING_FRAG = /* glsl */ `
${PLANET_NOISE}
${PLANET_COMMON}
uniform vec3 uRingCol;
void main() {
  vec2 xy = vPos.xy;
  float r = length(xy);
  float aa = fwidth(r) / max(uRing.y - uRing.x, 1e-3);
  float dens = ringDensity(r, aa);
  if (dens <= 0.001) discard;
  vec3 L = normalize(vL);
  vec3 V = normalize(vV);
  vec3 Q = vec3(xy, 0.0);
  // Planet shadow: does the ray toward the star pass through the planet?
  float tc = -dot(Q, L);
  float sh = 1.0;
  if (tc > 0.0) {
    float dc = length(Q + L * tc);
    sh = smoothstep(0.94, 1.04, dc);
  }
  float nl = L.z;
  float nv = V.z;
  float x = clamp((r - uRing.x) / (uRing.y - uRing.x), 0.0, 1.0);
  vec3 base = uRingCol * mix(0.7, 1.25, smoothstep(0.1, 0.6, x));
  base *= 0.85 + 0.3 * ph11(floor(x * 41.0) + uRing.z);
  float lit;
  if (nl * nv > 0.0) {
    lit = 0.25 + 0.75 * sqrt(abs(nl));   // sunlit face
  } else {
    float fwd = pow(max(dot(-V, L), 0.0), 6.0);
    lit = (0.3 + 0.7 * fwd) * (1.0 - dens * 0.45);   // light through the ring
  }
  vec3 c = base * (uLightCol * lit * sh + uAmbient);
  float a = min(dens * 1.15, 1.0) * uRings * 0.92;
  // Very edge-on rings are thin: fade to avoid a hard aliased line.
  a *= smoothstep(0.0, 0.05, abs(nv));
  gl_FragColor = vec4(toDisplay(c) * a, a);
}
`;
