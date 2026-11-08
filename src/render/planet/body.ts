import { PLANET_NOISE } from './noise';
import { PLANET_COMMON } from './common';

/**
 * The opaque planet body. One shader, three variants by define:
 * KIND_ROCKY (molten -> lava/ocean/ice/living world), KIND_GAS, KIND_MOON.
 * Layers that are switched off by their uniform are skipped with uniform
 * branches, so a cooled ocean world never pays for lava and vice versa.
 */
export const BODY_FRAG = /* glsl */ `
${PLANET_NOISE}
${PLANET_COMMON}
uniform vec3 uBands[6];
uniform int uBandCount;
uniform vec4 uBandP;      // x = band frequency, y = phase, z = turbulence, w = seed
uniform vec3 uStormDir;   // storm center (body frame)
uniform vec3 uStormE;     // local east
uniform vec3 uStormN;     // local north
uniform vec4 uStorm;      // x,y = half size, z = strength
uniform vec3 uStormCol;
uniform vec4 uLinN[8];    // great-circle lineae: plane normal, half-width
uniform vec4 uLinM[8];    // arc mask axis, strength

// Bump mapping from screen-space derivatives of a procedural height (Mikkelsen):
// relief without extra noise taps.
vec3 bumpN(vec3 n, float hgt) {
  vec3 dpx = dFdx(vPos);
  vec3 dpy = dFdy(vPos);
  float dhx = dFdx(hgt);
  float dhy = dFdy(hgt);
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  vec3 b = abs(det) * n - g;
  return dot(b, b) > 1e-24 ? normalize(b) : n;
}

// Incandescence by temperature 0..1.5: dull red -> orange -> yellow-white.
vec3 lavaRamp(float t) {
  t = clamp(t, 0.0, 1.6);
  float t2 = t * t;
  return vec3(1.9 * t2, 0.95 * t2 * t2 + 0.015 * t, 0.4 * t2 * t2 * t2 * t);
}

#ifdef KIND_GAS
// Palette is sorted light -> dark on the CPU; zones (even) take light tones,
// belts (odd) take dark ones, so neighbors always contrast.
vec3 pickBand(float xi) {
  float n = float(uBandCount);
  float lightN = max(ceil(n * 0.5), 1.0);
  float darkN = n - lightN;
  float r = ph11(xi * 1.37 + uBandP.w);
  bool zone = mod(xi, 2.0) < 0.5 || darkN < 0.5;
  int idx = zone ? int(floor(r * lightN)) : int(lightN + floor(r * darkN));
  return uBands[idx];
}
vec3 bandColor(float x) {
  float xi = floor(x);
  float f = x - xi;
  return mix(pickBand(xi), pickBand(xi + 1.0), smoothstep(0.36, 0.64, f));
}
#endif

void main() {
  vec3 N0 = normalize(vPos);
  vec3 L = normalize(vL);
  vec3 V = normalize(vV);
  vec3 P = spinY(N0, uSpinCS);
  float ndl0 = dot(N0, L);
  float ndv = clamp(dot(N0, V), 0.0, 1.0);
  float lat = abs(P.y);
  float pxw = length(fwidth(P)) + 1e-5;   // surface footprint of a pixel (planet radii)

  vec3 alb = vec3(0.1);
  vec3 emit = vec3(0.0);
  float hB = 0.0;        // bump height (planet radii)
  float wet = 0.0;       // open water (specular)
  float iceM = 0.0;
  float veg = 0.0;
  float land = 1.0;
  float lsMix = 0.0;     // Lommel-Seeliger share (dusty, airless look)

#if defined(KIND_ROCKY)
  // ---------------------------------------------------------------- terrain
  // KEEP IN SYNC with terrainHeight() in calibration.ts (per-seed sea level).
  vec3 q = P * 1.45 + uSeedOff;
  float w1 = pnoise(q * 0.9 + 3.7);
  q += (w1 - 0.5) * vec3(1.25, 0.95, -1.15);
  float h = pfbm(q, uOct) + 0.1 * (w1 - 0.5);
  float e = h - uSeaLevel;
  float fw = max(fwidth(h), 1e-4);
  if (uOcean > 0.002) land = smoothstep(-fw, fw, e);

  // ---------------------------------------------------------------- heat
  // A dry world keeps its lava pooled in the basins; once rain arrives the
  // basins quench first, so heat stops favoring the lowlands.
  float heat = 0.0;
  float tw = 0.5;
  if (uMolten > 0.002) {
    tw = pnoise(P * 1.6 + vec3(0.0, uTime * 0.016, uTime * 0.011) + uSeedOff.yzx);
    float dry = 1.0 - smoothstep(0.0, 0.12, uOcean);
    heat = clamp(uMolten * 1.25 - 0.28 - h * 2.3 * dry + (tw - 0.5) * 0.4, 0.0, 1.25);
    // No sea can stand on glowing rock: it boils away.
    land = max(land, smoothstep(0.3, 0.55, heat));
  }
  float elev = max(e, 0.0);
  // Mountain ranges: ridged noise along the warped terrain, rising with height.
  float ridge = 0.0;
  if (e > -0.005) {
    float rn = 1.0 - abs(pnoise(q * 2.7 + 5.3) * 2.0 - 1.0);
    ridge = rn * rn * rn * smoothstep(0.0, 0.14, e);
  }

  // Barren rock by height above the coast (or above the basin floor on a dry
  // world): dark basalt lowlands, rusty uplands, pale peaks; each world's
  // stardust gives it a hint of identity.
  float ec = h - max(uSeaLevel, uRefLevel);
  vec3 rock = mix(vec3(0.045, 0.038, 0.033), vec3(0.16, 0.1, 0.062), smoothstep(-0.005, 0.045, ec + (w1 - 0.5) * 0.06));
  rock = mix(rock, vec3(0.23, 0.2, 0.17), smoothstep(0.12, 0.26, ec));
  rock = mix(rock, uDust * dot(rock, vec3(0.4)), 0.25);
  rock *= 0.88 + 0.24 * w1;
  rock = mix(rock, vec3(0.26, 0.24, 0.22), ridge * 0.45);
  vec3 landC = rock;
  float beach = 0.0;
  if (uOcean > 0.002) {
    beach = (1.0 - smoothstep(0.0, 0.014, elev)) * step(0.0, e);
    landC = mix(landC, vec3(0.30, 0.25, 0.17), beach * 0.85);
  }
  hB = elev * 0.07 + ridge * 0.012;

  // ---------------------------------------------------------------- life
  if (uLife > 0.002) {
    float moist = w1 * 0.55 + pnoise(P * 4.7 + uSeedOff.yzx) * 0.45;
    float desert = exp(-(lat - 0.36) * (lat - 0.36) * 30.0);
    float fert = moist - desert * 0.32 - smoothstep(0.1, 0.24, elev) * 0.6 - ridge * 0.35
               + (1.0 - smoothstep(0.0, 0.06, elev)) * 0.16 - smoothstep(0.62, 0.9, lat) * 0.5;
    float spread = uLife * 1.3;
    veg = smoothstep(1.02 - spread, 1.18 - spread, fert) * (1.0 - beach * 0.7) * (1.0 - smoothstep(0.05, 0.3, heat));
    vec3 forest = vec3(0.022, 0.085, 0.020);
    vec3 grass = vec3(0.075, 0.140, 0.030);
    vec3 teal = vec3(0.012, 0.090, 0.075);
    vec3 vc = mix(forest, grass, smoothstep(0.35, 0.75, moist));
    vc = mix(vc, teal, smoothstep(0.5, 0.8, w1) * 0.65);
    vc = mix(vc, uDust * dot(vc, vec3(0.4)), 0.15);
    // Deserts read as warm sand on a living world.
    landC = mix(landC, vec3(0.30, 0.21, 0.11), desert * smoothstep(0.0, 0.5, uLife) * (1.0 - veg) * 0.6);
    landC = mix(landC, vc, veg);
  }

  // ---------------------------------------------------------------- ocean
  float depth = max(-e, 0.0);
  vec3 sea = mix(vec3(0.012, 0.115, 0.135), vec3(0.003, 0.02, 0.058), smoothstep(0.0, 0.075, depth));
  sea = mix(sea, vec3(0.008, 0.075, 0.062), uLife * 0.35 * (1.0 - smoothstep(0.0, 0.05, depth)));
  // Young seas steam where they meet hot rock.
  sea = mix(sea, vec3(0.2, 0.24, 0.26), smoothstep(0.1, 0.36, heat) * 0.45);
  wet = 1.0 - land;
  alb = mix(sea, landC, land);

  // ---------------------------------------------------------------- ice
  if (uIce > 0.002) {
    float line = 1.0 - uIce * 1.12;
    float m = lat + (w1 - 0.5) * 0.2 + h * 0.22 + (elev * 1.1 + ridge * 0.12) * land;
    iceM = smoothstep(line - 0.012, line + 0.012, m) * (1.0 - smoothstep(0.1, 0.4, heat));
    vec3 snow = vec3(0.78, 0.82, 0.86);
    vec3 seaIce = vec3(0.50, 0.64, 0.74);
    vec3 ic = mix(seaIce, snow, land);
    if (uIce > 0.25) {
      // Europa-like lineae: long crisscrossing great-circle fractures, slightly
      // wandering, some double-ridged, stained with the world's dust.
      float pw = pxw;
      float lin = 0.0;
      float ridge = 0.0;
      float wob = (w1 - 0.5) * 0.06 + h * 0.05;
      for (int i = 0; i < 8; i++) {
        vec4 ln = uLinN[i];
        vec4 lm = uLinM[i];
        float along = dot(P, lm.xyz);
        float dd = abs(dot(P, ln.xyz) + wob * (0.4 + fract(lm.w * 3.0)) + 0.025 * sin(along * 9.0 + lm.w * 20.0));
        float arc = smoothstep(-0.35, 0.25, along);
        float wv = ln.w * (0.55 + 0.9 * w1);
        lin = max(lin, smoothstep(wv + pw, wv - pw, dd) * arc * lm.w);
        ridge = max(ridge, smoothstep(ln.w * 0.35 + pw, ln.w * 0.35 - pw, dd) * arc * step(0.55, lm.w));
      }
      lin *= smoothstep(0.25, 0.7, uIce);
      // Chaos terrain: mottled, slightly darker patches of refrozen ice.
      float chaos = smoothstep(0.08, 0.2, pfbm(P * 3.3 + uSeedOff.yxz, 3.0));
      vec3 stain = mix(vec3(0.24, 0.13, 0.07), uDust * 0.22, 0.3);
      ic *= 0.9 + 0.16 * w1;
      ic = mix(ic, ic * vec3(0.7, 0.86, 1.0), smoothstep(0.08, -0.1, h));
      ic = mix(ic, mix(ic, stain, 0.35), chaos * smoothstep(0.25, 0.7, uIce));
      ic = mix(ic, stain, lin * 0.62);
      ic = mix(ic, vec3(0.62, 0.66, 0.7), ridge * 0.6 * smoothstep(0.25, 0.7, uIce));
    }
    alb = mix(alb, ic, iceM);
    wet *= 1.0 - iceM;
    hB *= 1.0 - 0.75 * iceM;   // snow and ice smooth the relief
  }

  // ---------------------------------------------------------------- molten
  if (uMolten > 0.002) {
    // Crust plates drift and shear; glowing lava wells up between them. As the
    // world cools the cracks narrow and redden into thin veins, then close.
    vec3 lp = P * 3.0 + uSeedOff.yxz;
    lp += (vec3(w1, tw, w1 + tw) - vec3(0.5, 0.5, 1.0)) * 1.35;
    vec4 vo = pvoronoi(lp, 0.78);
    float jag = pnoise(lp * 4.7 + 3.3) - 0.5;
    float edge = max(vo.y + jag * 0.055, 0.0);
    float fwE = fwidth(edge) * 0.7 + 1e-4;
    float wid = (0.012 + 0.12 * heat * heat) * (0.45 + 1.1 * tw);
    float crack = smoothstep(wid + fwE, wid - fwE, edge) * smoothstep(0.0, 0.06, heat);
    float cw = clamp(1.0 - edge / wid, 0.0, 1.0);
    float flow = pnoise(lp * 2.6 + vec3(uTime * 0.21, -uTime * 0.13, uTime * 0.17));
    // Sub-plates: the big plates are cracked again, finer and cooler.
    float crack2 = 0.0;
    if (uMolten > 0.35) {
      vec4 vo2 = pvoronoi(lp * 2.4 + 7.1 + jag * 0.5, 0.78);
      float edge2 = max(vo2.y + jag * 0.03, 0.0);
      float fwE2 = fwidth(edge2) * 0.7 + 1e-4;
      float wid2 = (0.008 + 0.06 * heat * heat) * (0.25 + 1.3 * vo.z);
      crack2 = smoothstep(wid2 + fwE2, wid2 - fwE2, edge2) * smoothstep(0.25, 0.7, heat) * smoothstep(0.35, 0.5, uMolten);
    }
    float plateT = heat * (0.12 + 0.14 * vo.z) * smoothstep(0.9, 1.25, heat);
    // Crack cores run hottest; the flow noise makes the light crawl.
    float T = crack * (0.3 + 0.7 * heat) * (0.5 + 0.45 * sqrt(cw)) * (0.78 + 0.36 * flow);
    T = max(T, plateT);
    T = max(T, crack2 * (0.25 + 0.55 * heat) * (0.75 + 0.4 * flow));
    T += exp(-edge / (0.02 + wid)) * heat * 0.1;
    emit += lavaRamp(T) * (1.0 - wet) * (1.0 - iceM);
    vec3 crust = vec3(0.03, 0.026, 0.024) * (0.65 + 0.6 * vo.z) * (0.85 + 0.3 * jag) + uDust * 0.005;
    float crustM = smoothstep(0.15, 0.75, uMolten) * (1.0 - wet);
    alb = mix(alb, crust, crustM);
    hB += (1.0 - max(crack, crack2 * 0.6)) * 0.006 * crustM;
  }

#elif defined(KIND_GAS)
  // ---------------------------------------------------------------- gas giant
  float latA = asin(clamp(P.y, -1.0, 1.0)) * 0.63662;
  float bx0 = latA * uBandP.x + uBandP.y;
  // Zonal jets: neighboring bands flow in opposite directions, shearing the
  // turbulence into streaks and festoons. The shear breathes slowly (~26 min)
  // so long sessions never wind the bands up into hairlines.
  float ja = sin(bx0 * PI + uBandP.w) * (0.28 + 0.24 * sin(uTime * 0.004));
  float cj = cos(ja);
  float sj = sin(ja);
  vec3 Pj = vec3(cj * P.x - sj * P.z, P.y, sj * P.x + cj * P.z);
  vec3 tq = Pj * vec3(2.4, 6.5, 2.4) + uSeedOff;
  float tw = pnoise(tq * 0.8 + vec3(0.0, 0.0, uTime * 0.012));
  vec3 tq2 = tq * 1.6 + (tw - 0.5) * vec3(2.2, 0.8, 2.2);
  float turb = pfbm(tq2, uOct);
  float bx = bx0 + 0.32 * sin(latA * 5.1 + uBandP.w) + 0.18 * sin(latA * 11.7 + uBandP.w * 2.3);
  float edgeness = 1.0 - abs(fract(bx) - 0.5) * 2.0;
  bx += turb * uBandP.z * (0.8 + 0.8 * edgeness);
  vec3 base = bandColor(bx);
  // Zonal striations.
  float stri = pnoise(vec3(Pj.x * 5.0, latA * 64.0, Pj.z * 5.0) + uSeedOff.zyx);
  base *= 0.84 + 0.32 * stri;
  // Small white ovals scattered through the belts.
  vec3 oc = Pj * 7.0 + uSeedOff.yzx;
  vec3 oi = floor(oc);
  vec3 oh = ph33(oi);
  vec3 od = (oc - oi - 0.5 - (oh - 0.5) * 0.4) * vec3(1.0, 2.3, 1.0);
  float oval = smoothstep(0.24, 0.13, length(od)) * step(0.7, oh.z);
  base = mix(base, max(base, uBands[0]) * 1.1, oval * 0.75);
  // Great storm.
  vec3 sd = P - uStormDir;
  vec2 su = vec2(dot(sd, uStormE), dot(sd, uStormN)) / uStorm.xy;
  float sr = length(su);
  if (sr < 1.8 && dot(P, uStormDir) > 0.0) {
    float ang = 2.6 * exp(-sr * sr * 1.2);
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 sw = vec2(ca * su.x - sa * su.y, sa * su.x + ca * su.y);
    float sn = pnoise(vec3(sw * 2.6, uTime * 0.04) + uSeedOff);
    float core = smoothstep(1.0, 0.55, sr + (sn - 0.5) * 0.35);
    float collar = smoothstep(1.5, 1.05, sr) * (1.0 - core);
    base = mix(base, uBands[0] * (0.95 + 0.1 * sn), collar * 0.75 * uStorm.z);
    base = mix(base, uStormCol * (0.75 + 0.5 * sn), core * uStorm.z);
  }
  // Hazy, slightly bluish poles.
  base = mix(base, base * vec3(0.72, 0.78, 0.9), smoothstep(0.72, 0.96, lat));
  alb = base * 0.72;
  hB = turb * 0.0025;

#else
  // ---------------------------------------------------------------- moon
  // Three sizes of craters (bowl, raised rim, bright young ejecta) over
  // highlands and dark, smoother maria.
  vec3 cq = P * 1.7 + uSeedOff;
  float craters = 0.0;
  float rimB = 0.0;
  float fresh = 0.0;
  for (int s = 0; s < 3; s++) {
    float fs = s == 0 ? 1.0 : (s == 1 ? 2.1 : 4.6);
    vec3 x = cq * fs + float(s) * 11.3;
    vec3 cp = floor(x - 0.5);
    vec3 cf = x - cp;
    for (int k = 0; k < 2; k++)
    for (int j = 0; j < 2; j++)
    for (int i = 0; i < 2; i++) {
      vec3 b = vec3(float(i), float(j), float(k));
      vec3 hh = ph33(cp + b + float(s) * 17.0);
      vec3 r = b + 0.5 + (hh - 0.5) * 0.5 - cf;
      float rad = 0.1 + 0.15 * hh.y;
      float d = length(r) / rad;
      float exist = step(s == 0 ? 0.55 : 0.3, hh.z);
      float bowl = d < 1.0 ? (d * d - 1.0) : 0.0;
      float rim = exp(-(d - 1.0) * (d - 1.0) * 12.0);
      float amp = rad / fs;
      craters += (bowl * 0.9 + rim * 0.3) * exist * amp;
      rimB += (rim * 0.6 + bowl * 0.35) * exist * (1.0 - float(s) * 0.25);
      fresh += exist * step(0.8, hh.x) * exp(-d * d * 0.35) * (1.0 - float(s) * 0.3);
    }
  }
  float mw = pnoise(P * 2.2 + uSeedOff.zxy);
  float grit = pfbm(P * 14.0 + uSeedOff.zxy, min(uOct, 3.0));
  float mare = smoothstep(0.035, 0.075, pfbm(P * 1.6 + uSeedOff.yzx + (mw - 0.5) * 0.9, 4.0) + grit * 0.25);
  vec3 high = vec3(0.26, 0.255, 0.245);
  vec3 low = vec3(0.075, 0.075, 0.08);
  alb = mix(high, low * (0.9 + 0.25 * mw), mare);
  alb *= clamp(0.88 + 0.6 * grit + 0.3 * rimB * (1.0 - mare * 0.5), 0.5, 1.4);
  alb += vec3(0.1) * min(fresh, 1.0) * 0.6;
  alb = mix(alb, uDust * dot(alb, vec3(0.4)), 0.08);
  hB = craters * mix(0.12, 0.06, mare) + grit * 0.004;
  lsMix = 0.7;
#endif

  // ================================================================ lighting
  vec3 N = bumpN(N0, hB);
  float ndl = dot(N, L);
  float diff = sphereLight(ndl, uSoft) * smoothstep(-uSoft * 1.5, uSoft, ndl0);
#ifdef KIND_MOON
  float ls = max(ndl, 0.0) / (max(ndl, 0.0) + max(dot(N, V), 0.05)) * 2.0;
  diff = mix(diff, ls * smoothstep(-0.02, 0.05, ndl), lsMix);
#endif
#ifdef KIND_GAS
  diff *= mix(0.62, 1.0, pow(ndv, 0.35));
#endif

  float shadow = 1.0;
#ifdef KIND_ROCKY
  if (uClouds > 0.002) {
    vec3 cs = normalize(N0 + L * 0.035);
    float cd = cloudField(spinY(cs, uCloudCS), 2.0);
    float cov = smoothstep(uCloudThr + 0.02, uCloudThr + 0.07, cd);
    shadow -= cov * 0.38 * min(uClouds * 4.0, 1.0) * (1.0 - 0.6 * uIce) * smoothstep(-0.05, 0.25, ndl0);
  }
#endif
  if (uRings > 0.002 && abs(L.y) > 1e-3) {
    float t = -N0.y / L.y;
    if (t > 0.0) {
      vec3 hp = N0 + L * t;
      shadow *= 1.0 - ringDensity(length(hp.xz), 1.0) * uRings * 0.75;
    }
  }

  // Light skimming the terminator crosses more air: warm it.
  vec3 sunT = mix(mix(uSunset, vec3(1.0), 0.3), vec3(1.0), smoothstep(-0.04, 0.2, ndl0));
  sunT = mix(vec3(1.0), sunT, uAtmoAmt);
  vec3 Li = uLightCol * sunT * shadow;
  vec3 col = alb * (Li * diff + uAmbient);

#ifdef KIND_ROCKY
  if (wet > 0.001) {
    // Sun glint: GGX on a gently rippled sea.
    float wa = 0.06 * (1.0 - smoothstep(0.004, 0.012, pxw));
    vec3 Nw = N0;
    if (wa > 0.0) Nw = normalize(N0 + (vec3(pnoise(P * 60.0 + uTime * 0.3), pnoise(P * 60.0 + 7.0 - uTime * 0.25), 0.5) - 0.5) * wa);
    vec3 H = normalize(L + V);
    float nh = max(dot(Nw, H), 0.0);
    float a2 = 0.04;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float vh = max(dot(V, H), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
    float spec = D * F / (4.0 * max(vh * vh, 0.1)) * max(dot(Nw, L), 0.0);
    col += Li * spec * wet * 0.8;
    // Sky reflected at grazing angles.
    float Fv = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    col += uAtmo * uLightCol * Fv * 0.12 * smoothstep(-0.1, 0.3, ndl0) * wet * uAtmoAmt;
  }
  // Glossy ice.
  if (iceM > 0.001) {
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(N, H), 0.0), 40.0) * 0.12;
    col += Li * sp * iceM * max(ndl, 0.0);
  }
  // Bioluminescent life on the night side: glowing coastal shallows and a
  // sparse scatter of living lights inland. Very subtle.
  if (uLife > 0.45) {
    float night = smoothstep(0.06, -0.2, ndl0);
    float bio = smoothstep(0.45, 1.0, uLife) * night;
    vec3 gp = P * 64.0;
    vec3 gi = floor(gp);
    vec3 rh = ph33(gi + uSeedOff);
    vec3 gf = gp - gi - (0.25 + 0.5 * rh);
    float pxs = length(fwidth(gp));
    float dots = exp(-dot(gf, gf) / (0.006 + pxs * pxs * 0.12)) * step(0.82, rh.z);
    dots *= 0.012 / (0.012 + pxs * pxs * 0.03);
    float tw = 0.6 + 0.4 * sin(uTime * (0.6 + 1.2 * rh.x) + rh.y * 6.283);
    emit += vec3(0.05, 0.42, 0.34) * dots * tw * veg * land * bio * 0.45;
    float shore = (1.0 - smoothstep(0.0, 0.03, depth)) * wet;
    emit += vec3(0.0, 0.03, 0.027) * shore * bio * (0.5 + 0.5 * w1);
  }
#endif

  col += emit;
  // Touch / hover: a soft glow in the world's own stardust color.
  float fres = 1.0 - ndv;
  col += uDust * uHighlight * (0.03 + 0.3 * fres * fres);
  gl_FragColor = vec4(toDisplay(col), 1.0);
}
`;
