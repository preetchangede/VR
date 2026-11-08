/**
 * CPU atmosphere model for the dawn scene (dependency-free, so tools can run it
 * under plain Node for offline tuning).
 *
 * Single scattering (Rayleigh + Mie + ozone absorption) over a spherical
 * planet is integrated once at construction into a small 3D look-up table
 * indexed by (azimuth from the sun, view elevation, sun elevation). Light
 * transmittance comes from a precomputed (altitude, sun angle) table built with
 * Schüler's analytic Chapman approximation, so the bake costs ~20 ms. A cheap
 * multiple-scattering term keeps deep twilight a luminous blue.
 *
 * At runtime every shader (sky, ocean reflection, fog, ambient) reads the same
 * table, which keeps the scene cohesive: the haze on a distant island *is* the
 * sky behind it.
 *
 * The star's color tints the light before scattering, relative to a reference
 * yellow-white sun (which gives an Earth-like sky): a red dwarf yields a
 * coppery sky, a blue-white star a deep, saturated blue.
 *
 * Units: km. Irradiance is normalized so a white Lambertian surface facing the
 * (unattenuated) sun has radiance 1.
 */

const RG = 6360;
const RT = 6420;
const HR = 8.0;
const HM = 1.2;
const BR = [5.802e-3, 13.558e-3, 33.1e-3];
/** Aerosol load relative to Earth: a slightly hazy, luminous dawn. */
const HAZE = 1.5;
const BMS = 3.996e-3 * HAZE;
const BME = BMS * 1.11;
const BO = [0.65e-3, 1.881e-3, 0.085e-3];
const OZONE_COLUMN = 9; // km-equivalent at peak density
const CHAPMAN_FIX = 1.08;
/** Multiple scattering gain (isotropic re-scatter of the average sky). */
const MS_GAIN = 1.6;
/** Reference star (display sRGB) that produces an Earth-like sky. */
const REF_SUN = [1.0, 0xe6 / 255, 0xb8 / 255];

export const LUT_NU = 24; // azimuth from the sun, 0..pi
export const LUT_NV = 40; // view elevation 0..pi/2, sqrt-mapped (dense at the horizon)
export const LUT_NW = 16; // sun elevation slices
export const SUN_MIN = (-11 * Math.PI) / 180;
export const SUN_MAX = (23 * Math.PI) / 180;
export const MIE_G = 0.76;

const PI = Math.PI;

function chapman(H: number, z: number, mu: number) {
  // Schüler (GPU Pro 3), half-height units; returns optical depth / rho0 (km).
  const H2 = H * Math.LN2;
  const X = RG / H2;
  const h = z / H2;
  const c = Math.sqrt(X + h);
  let ch: number;
  if (mu >= 0) ch = (c / (c * mu + 1)) * Math.pow(2, -h);
  else {
    const x0 = Math.sqrt(1 - mu * mu) * (X + h);
    const c0 = Math.sqrt(x0);
    ch = 2 * c0 * Math.pow(2, X - x0) - (c / (1 - c * mu)) * Math.pow(2, -h);
  }
  return H * ch * CHAPMAN_FIX;
}

/** Ozone path factor (secant at the 25 km shell), clamped for grazing rays. */
function ozonePath(r: number, mu: number) {
  const ro = RG + 25;
  const s = Math.min((r / ro) * Math.sqrt(Math.max(0, 1 - mu * mu)), 0.9995);
  let sec = 1 / Math.sqrt(1 - s * s);
  if (mu < 0 && r < ro) sec *= 1 + Math.min(1, -mu * 8);
  return Math.min(sec, 36);
}

/** Visibility of the sun from radius r at cos-zenith mu (soft planet shadow). */
function sunVis(r: number, mu: number) {
  const muH = -Math.sqrt(Math.max(0, 1 - (RG / r) * (RG / r)));
  const x = (mu - muH) / 0.012 + 0.5;
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}

function transmit(zKm: number, mu: number, out: number[] | Float32Array, o = 0) {
  const r = RG + zKm;
  const vis = sunVis(r, mu);
  if (vis <= 0) {
    out[o] = out[o + 1] = out[o + 2] = 0;
    return;
  }
  const tR = chapman(HR, zKm, mu);
  const tM = chapman(HM, zKm, mu);
  const tO = OZONE_COLUMN * ozonePath(r, mu) * (zKm < 40 ? 1 : Math.max(0, 1 - (zKm - 40) / 20));
  for (let c = 0; c < 3; c++) out[o + c] = vis * Math.exp(-(BR[c] * tR + BME * tM + BO[c] * tO));
}

/** Transmittance toward the sun from altitude zKm with sun elevation `elev` (rad). */
export function sunTransmittance(elev: number, zKm: number, out: number[] | Float32Array) {
  transmit(zKm, Math.sin(elev), out, 0);
}

// Light transmittance table T(h, mu): h quadratic in [0, 60] km, mu = -0.25 + 1.25 x^2.
const TH = 48;
const TM = 192;
const ZMAX = 60;
const MU0 = -0.25;
let lightTable: Float32Array | null = null;
function getLightTable() {
  if (lightTable) return lightTable;
  const t = new Float32Array(TH * TM * 3);
  for (let i = 0; i < TH; i++) {
    const h = ZMAX * (i / (TH - 1)) ** 2;
    for (let j = 0; j < TM; j++) {
      const x = j / (TM - 1);
      transmit(h, MU0 + (1 - MU0) * x * x, t, (i * TM + j) * 3);
    }
  }
  lightTable = t;
  return t;
}
export function lookupLight(t: Float32Array, h: number, mu: number, out: number[]) {
  const fh = Math.sqrt(Math.min(1, Math.max(0, h / ZMAX))) * (TH - 1);
  const fm = Math.sqrt(Math.min(1, Math.max(0, (mu - MU0) / (1 - MU0)))) * (TM - 1);
  const i0 = Math.min(TH - 2, fh | 0);
  const j0 = Math.min(TM - 2, fm | 0);
  const a = fh - i0;
  const b = fm - j0;
  const k00 = (i0 * TM + j0) * 3;
  const k01 = k00 + 3;
  const k10 = k00 + TM * 3;
  const k11 = k10 + 3;
  for (let c = 0; c < 3; c++) {
    out[c] =
      (t[k00 + c] * (1 - b) + t[k01 + c] * b) * (1 - a) + (t[k10 + c] * (1 - b) + t[k11 + c] * b) * a;
  }
}

function smooth(a: number, b: number, v: number) {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function srgbToLinear(x: number) {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function phaseR(mu: number) {
  return (3 / (16 * PI)) * (1 + mu * mu);
}
export function phaseM(mu: number) {
  const g = MIE_G;
  const g2 = g * g;
  const x = 1 + g2 - 2 * g * mu;
  return ((3 / (8 * PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * x * Math.sqrt(x));
}

export interface SkyBake {
  /** NU*NV*NW*4 floats: rgb = Rayleigh (phase applied) + multiple scattering. */
  ray: Float32Array;
  /** NU*NV*NW*4 floats: rgb = Mie in-scatter without phase. */
  mie: Float32Array;
  /** Linear light spectrum (max channel 1) times pi (normalized irradiance). */
  sun: [number, number, number];
  /** Per-slice ambient irradiance as L1 SH in the sun frame:
   *  E(n) = c0 + cx * dot(n, sunHorizontal) + cy * dot(n, up)   (rgb each). */
  shC0: Float32Array;
  shCx: Float32Array;
  shCy: Float32Array;
  /** Per-slice mean horizon radiance (rgb). */
  horizon: Float32Array;
  /** Per-slice zenith luminance (x3, rgb-compatible layout: lum, lum, lum). */
  zenith: Float32Array;
}

/**
 * Bake the sky for a star whose color is given in display sRGB (0..1).
 */
export function bakeSky(sunDisplay: [number, number, number]): SkyBake {
  // Spectrum relative to the reference sun, exaggerated a little so the hue reads.
  const rel = [0, 1, 2].map((c) => srgbToLinear(sunDisplay[c]) / srgbToLinear(REF_SUN[c]));
  const mx = Math.max(rel[0], rel[1], rel[2], 1e-4);
  const spec = rel.map((v) => Math.pow(Math.max(v / mx, 0.003), 1.35));
  const m2 = Math.max(spec[0], spec[1], spec[2]);
  const sun: [number, number, number] = [(spec[0] / m2) * PI, (spec[1] / m2) * PI, (spec[2] / m2) * PI];

  const LT = getLightTable();
  const NU = LUT_NU;
  const NV = LUT_NV;
  const NW = LUT_NW;
  const N = NU * NV * NW;
  const ray = new Float32Array(N * 4);
  const mie = new Float32Array(N * 4);
  const odR = new Float32Array(NV); // view optical depths per elevation (sun independent)
  const odM = new Float32Array(NV);
  const STEPS = 16;
  const r0 = RG + 0.004;

  // The planet is symmetric about the observer's vertical, so sample
  // altitudes, densities and view transmittance depend only on the view
  // elevation: compute them once per elevation row, reuse for every azimuth
  // and sun slice. The inner loop is then just a table lookup per sample.
  const sT = new Float32Array(STEPS);
  const sR = new Float32Array(STEPS);
  const sRdt = new Float32Array(STEPS);
  const sMdt = new Float32Array(STEPS);
  const sTv = new Float32Array(STEPS * 3);
  const sFh = new Int32Array(STEPS);
  const sAh = new Float32Array(STEPS);
  for (let v = 0; v < NV; v++) {
    const fv = v / (NV - 1);
    const e = (PI / 2) * fv * fv;
    const ce = Math.cos(e);
    const se = Math.sin(e);
    const b = r0 * se;
    const tmax = -b + Math.sqrt(b * b - r0 * r0 + RT * RT);
    let tvR = 0;
    let tvM = 0;
    let tvO = 0;
    for (let i = 0; i < STEPS; i++) {
      const t = tmax * ((i + 0.5) / STEPS) ** 2;
      const dt = (tmax * (2 * i + 1)) / (STEPS * STEPS);
      const py = r0 + t * se;
      const px = t * ce;
      const r = Math.sqrt(px * px + py * py);
      const h = r - RG > 0 ? r - RG : 0;
      const dR = Math.exp(-h / HR);
      const dM = Math.exp(-h / HM);
      const dO = h > 10 && h < 40 ? 1 - Math.abs(h - 25) / 15 : 0;
      tvR += dR * dt * 0.5;
      tvM += dM * dt * 0.5;
      tvO += dO * dt * 0.5;
      sT[i] = t;
      sR[i] = r;
      sRdt[i] = dR * dt;
      sMdt[i] = dM * dt;
      for (let c = 0; c < 3; c++) sTv[i * 3 + c] = Math.exp(-(BR[c] * tvR + BME * tvM + BO[c] * tvO));
      const fh = Math.sqrt(Math.min(1, h / ZMAX)) * (TH - 1);
      const i0 = Math.min(TH - 2, fh | 0);
      sFh[i] = i0;
      sAh[i] = fh - i0;
      tvR += dR * dt * 0.5;
      tvM += dM * dt * 0.5;
      tvO += dO * dt * 0.5;
    }
    odR[v] = tvR;
    odM[v] = tvM;
    for (let w = 0; w < NW; w++) {
      const es = SUN_MIN + (w / (NW - 1)) * (SUN_MAX - SUN_MIN);
      const sx = Math.cos(es);
      const sy = Math.sin(es);
      for (let u = 0; u < NU; u++) {
        const az = (u / (NU - 1)) * PI;
        const dx = ce * Math.cos(az);
        const mu = dx * sx + se * sy;
        let sR0 = 0;
        let sR1 = 0;
        let sR2 = 0;
        let sM0 = 0;
        let sM1 = 0;
        let sM2 = 0;
        for (let i = 0; i < STEPS; i++) {
          const t = sT[i];
          const mus = (t * dx * sx + (r0 + t * se) * sy) / sR[i];
          const q = (mus - MU0) / (1 - MU0);
          if (q <= 0) continue;
          const fm = Math.sqrt(q < 1 ? q : 1) * (TM - 1);
          const j0 = fm < TM - 2 ? fm | 0 : TM - 2;
          const bb = fm - j0;
          const a = sAh[i];
          const k00 = (sFh[i] * TM + j0) * 3;
          const k10 = k00 + TM * 3;
          const w00 = (1 - a) * (1 - bb);
          const w01 = (1 - a) * bb;
          const w10 = a * (1 - bb);
          const w11 = a * bb;
          const T0 = (LT[k00] * w00 + LT[k00 + 3] * w01 + LT[k10] * w10 + LT[k10 + 3] * w11) * sTv[i * 3];
          const T1 = (LT[k00 + 1] * w00 + LT[k00 + 4] * w01 + LT[k10 + 1] * w10 + LT[k10 + 4] * w11) * sTv[i * 3 + 1];
          const T2 = (LT[k00 + 2] * w00 + LT[k00 + 5] * w01 + LT[k10 + 2] * w10 + LT[k10 + 5] * w11) * sTv[i * 3 + 2];
          const rd = sRdt[i];
          const md = sMdt[i];
          sR0 += T0 * rd;
          sR1 += T1 * rd;
          sR2 += T2 * rd;
          sM0 += T0 * md;
          sM1 += T1 * md;
          sM2 += T2 * md;
        }
        const pr = phaseR(mu);
        const k = ((w * NV + v) * NU + u) * 4;
        ray[k] = sun[0] * BR[0] * sR0 * pr;
        ray[k + 1] = sun[1] * BR[1] * sR1 * pr;
        ray[k + 2] = sun[2] * BR[2] * sR2 * pr;
        ray[k + 3] = 1;
        mie[k] = sun[0] * BMS * sM0;
        mie[k + 1] = sun[1] * BMS * sM1;
        mie[k + 2] = sun[2] * BMS * sM2;
        mie[k + 3] = 1;
      }
    }
  }

  // Per slice: mean sky radiance -> isotropic multiple scattering along each
  // view path, then ambient irradiance (L1 SH) for surfaces.
  const shC0 = new Float32Array(NW * 3);
  const shCx = new Float32Array(NW * 3);
  const shCy = new Float32Array(NW * 3);
  const horizon = new Float32Array(NW * 3);
  const Y0 = 0.282095;
  const Y1 = 0.488603;
  const tr = [0, 0, 0];
  const integrate = (w: number, sx: number, sy: number, L00: number[], L1x: number[], L1y: number[], hor: number[]) => {
    L00.fill(0);
    L1x.fill(0);
    L1y.fill(0);
    hor.fill(0);
    let horW = 0;
    for (let v = 0; v < NV; v++) {
      const fv0 = Math.max(0, (v - 0.5) / (NV - 1));
      const fv1 = Math.min(1, (v + 0.5) / (NV - 1));
      const e0 = (PI / 2) * fv0 * fv0;
      const e1 = (PI / 2) * fv1 * fv1;
      const e = 0.5 * (e0 + e1);
      const dE = e1 - e0;
      for (let u = 0; u < NU; u++) {
        const az = (u / (NU - 1)) * PI;
        const dAz = (u === 0 || u === NU - 1 ? 0.5 : 1) * (PI / (NU - 1)) * 2; // both sides
        const dOmega = Math.cos(e) * dE * dAz;
        const dx = Math.cos(e) * Math.cos(az);
        const dy = Math.sin(e);
        const pm = Math.min(phaseM(dx * sx + dy * sy), 4);
        const k = ((w * NV + v) * NU + u) * 4;
        for (let c = 0; c < 3; c++) {
          const L = ray[k + c] + mie[k + c] * pm;
          L00[c] += L * Y0 * dOmega;
          L1x[c] += L * Y1 * dx * dOmega;
          L1y[c] += L * Y1 * dy * dOmega;
          if (v <= 2) hor[c] += L * dAz;
        }
        if (v <= 2) horW += dAz;
      }
    }
    for (let c = 0; c < 3; c++) hor[c] /= Math.max(horW, 1e-6);
  };
  const L00 = [0, 0, 0];
  const L1x = [0, 0, 0];
  const L1y = [0, 0, 0];
  const hor = [0, 0, 0];
  const msCol = [0, 0, 0];
  for (let w = 0; w < NW; w++) {
    const es = SUN_MIN + (w / (NW - 1)) * (SUN_MAX - SUN_MIN);
    const sx = Math.cos(es);
    const sy = Math.sin(es);
    integrate(w, sx, sy, L00, L1x, L1y, hor);
    // Mean upper-hemisphere luminance, re-scattered isotropically. After a few
    // Rayleigh bounces the light takes the color of the star's spectrum times
    // the Rayleigh coefficients (blue for a sun, copper for a red dwarf).
    const avgL = (0.2126 * L00[0] + 0.7152 * L00[1] + 0.0722 * L00[2]) / (Y0 * 2 * PI);
    // twilight boost: deep twilight is almost entirely multiply-scattered light
    const boost = 1 + 2.2 * (1 - smooth(-0.05, 0.12, sy));
    for (let c = 0; c < 3; c++) msCol[c] = (sun[c] * BR[c]) / PI;
    const msLum = 0.2126 * msCol[0] + 0.7152 * msCol[1] + 0.0722 * msCol[2];
    for (let v = 0; v < NV; v++) {
      const fv = v / (NV - 1);
      // keep the horizon warm: low paths are dominated by direct (single) light
      const lowFade = 0.35 + 0.65 * smooth(0, 0.35, (PI / 2) * fv * fv);
      for (let c = 0; c < 3; c++) {
        const tau = BR[c] * odR[v] + BME * odM[v];
        const ms =
          MS_GAIN * boost * lowFade * avgL * (msCol[c] / msLum) * (1 - Math.exp(-tau)) *
          ((BR[c] * odR[v] + BMS * odM[v] * 0.3) / Math.max(tau, 1e-6));
        for (let u = 0; u < NU; u++) ray[((w * NV + v) * NU + u) * 4 + c] += ms;
      }
    }
    integrate(w, sx, sy, L00, L1x, L1y, hor);
    transmit(0.004, sy, tr, 0);
    const sinE = Math.max(0, sy);
    for (let c = 0; c < 3; c++) {
      // Lower hemisphere: the sea and rocks bounce ~9% of horizon sky + glints.
      const ground = 0.09 * hor[c] + 0.03 * sun[c] * tr[c] * sinE;
      L00[c] += ground * Y0 * 2 * PI;
      L1y[c] -= ground * Y1 * PI;
      shC0[w * 3 + c] = PI * Y0 * L00[c];
      shCx[w * 3 + c] = ((2 * PI) / 3) * Y1 * L1x[c];
      shCy[w * 3 + c] = ((2 * PI) / 3) * Y1 * L1y[c];
      horizon[w * 3 + c] = hor[c];
    }
  }
  const zenith = new Float32Array(NW * 3);
  for (let w = 0; w < NW; w++) {
    const es = SUN_MIN + (w / (NW - 1)) * (SUN_MAX - SUN_MIN);
    const k = ((w * NV + (NV - 1)) * NU) * 4;
    const pm = phaseM(Math.sin(es));
    const lum =
      0.2126 * (ray[k] + mie[k] * pm) + 0.7152 * (ray[k + 1] + mie[k + 1] * pm) + 0.0722 * (ray[k + 2] + mie[k + 2] * pm);
    zenith[w * 3] = zenith[w * 3 + 1] = zenith[w * 3 + 2] = lum;
  }
  return { ray, mie, sun, shC0, shCx, shCy, horizon, zenith };
}

/** Linear interpolation of a per-slice rgb table at sun elevation `elev`. */
export function sampleSlices(table: Float32Array, elev: number, out: { x: number; y: number; z: number }) {
  const f = Math.min(1, Math.max(0, (elev - SUN_MIN) / (SUN_MAX - SUN_MIN))) * (LUT_NW - 1);
  const i0 = Math.min(LUT_NW - 2, Math.floor(f));
  const t = f - i0;
  out.x = table[i0 * 3] * (1 - t) + table[i0 * 3 + 3] * t;
  out.y = table[i0 * 3 + 1] * (1 - t) + table[i0 * 3 + 4] * t;
  out.z = table[i0 * 3 + 2] * (1 - t) + table[i0 * 3 + 5] * t;
  return out;
}

/** Texture w coordinate (texel-center mapped) for a sun elevation. */
export function lutW(elev: number) {
  const f = Math.min(1, Math.max(0, (elev - SUN_MIN) / (SUN_MAX - SUN_MIN)));
  return (0.5 + f * (LUT_NW - 1)) / LUT_NW;
}

/** Sun elevation (degrees) for dawn progress t: -8° → 0° at 0.35 → 18° at 1. */
export function sunElevationDeg(t: number) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t < 0.35 ? -8 + (8 * t) / 0.35 : (18 * (t - 0.35)) / 0.65;
}

/** Everything the shaders need for one dawn value (plain numbers, no allocation). */
export interface DawnState {
  t: number;
  elev: number; // rad
  az: number; // rad, from -Z toward +X
  sunLight: number[]; // rgb radiance factor for sunlit surfaces
  sunDisk: number[]; // rgb radiance of the disk center
  glare: number[]; // rgb veiling glare strength
  cloudLight: number[]; // sunlight reaching a cloud deck a few km up (lit before sunrise)
  amb0: number[];
  ambX: number[];
  ambY: number[];
  exposure: number;
  night: number; // stars / nebula visibility
  glow: number; // bioluminescence
  nightSky: number[]; // airglow floor (rgb)
}

export function makeDawnState(): DawnState {
  return {
    t: 0,
    elev: 0,
    az: 0,
    sunLight: [0, 0, 0],
    sunDisk: [0, 0, 0],
    glare: [0, 0, 0],
    cloudLight: [0, 0, 0],
    amb0: [0, 0, 0],
    ambX: [0, 0, 0],
    ambY: [0, 0, 0],
    exposure: 1,
    night: 1,
    glow: 1,
    nightSky: [0, 0, 0],
  };
}

const tmp3 = [0, 0, 0];
const tmpV = { x: 0, y: 0, z: 0 };

const EXPO_KEYS: [number, number][] = [
  [1e-6, 900],
  [1.75e-5, 170],
  [2.2e-4, 44],
  [1.5e-3, 13],
  [9.7e-3, 4.2],
  [2.0e-2, 3.4],
  [1, 3.2],
];
export function exposureFor(zenithLum: number) {
  const x = Math.log10(Math.max(zenithLum, 1e-7));
  const k = EXPO_KEYS;
  if (x <= Math.log10(k[0][0])) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    const x1 = Math.log10(k[i][0]);
    if (x <= x1) {
      const x0 = Math.log10(k[i - 1][0]);
      const f = (x - x0) / (x1 - x0);
      return Math.pow(10, Math.log10(k[i - 1][1]) * (1 - f) + Math.log10(k[i][1]) * f);
    }
  }
  return k[k.length - 1][1];
}

/** Map dawn progress to sun, light and exposure. `sunRadius` in radians. */
export function computeDawn(bake: SkyBake, t: number, sunRadius: number, s: DawnState) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  s.t = t;
  const el = (sunElevationDeg(t) * PI) / 180;
  s.elev = el;
  // The sun rises ahead and a little left, drifting right as it climbs.
  s.az = ((-15 + 7 * t) * PI) / 180;
  const sun = bake.sun;
  const frac = smooth(-sunRadius, sunRadius, el);
  sunTransmittance(Math.max(el, (0.25 * PI) / 180), 0.004, tmp3);
  for (let c = 0; c < 3; c++) s.sunLight[c] = sun[c] * tmp3[c] * frac;
  // Disk radiance kept modest so the filmic curve keeps its hue: a red-gold
  // sunrise, not a white hole. (Scaled for the disk's solid angle.)
  const diskK = 0.9 / Math.max(sunRadius * 60, 0.3);
  for (let c = 0; c < 3; c++) s.sunDisk[c] = sun[c] * tmp3[c] * diskK * 40;
  sunTransmittance(Math.max(el, (0.6 * PI) / 180), 0.004, tmp3);
  const gk = 0.06 * smooth(-2.2 * sunRadius, sunRadius, el);
  for (let c = 0; c < 3; c++) s.glare[c] = sun[c] * tmp3[c] * gk;
  // a high deck (~6 km) sees the sun ~2.5° before the sea does
  sunTransmittance(el, 6, tmp3);
  for (let c = 0; c < 3; c++) s.cloudLight[c] = sun[c] * tmp3[c];

  sampleSlices(bake.shC0, el, tmpV);
  s.amb0[0] = tmpV.x;
  s.amb0[1] = tmpV.y;
  s.amb0[2] = tmpV.z;
  sampleSlices(bake.shCx, el, tmpV);
  s.ambX[0] = tmpV.x;
  s.ambX[1] = tmpV.y;
  s.ambX[2] = tmpV.z;
  sampleSlices(bake.shCy, el, tmpV);
  s.ambY[0] = tmpV.x;
  s.ambY[1] = tmpV.y;
  s.ambY[2] = tmpV.z;

  // Exposure: eye adaptation keyed to the zenith sky (log-log keyframes tuned
  // so the zenith reads deep indigo before dawn and luminous blue by morning).
  sampleSlices(bake.zenith, el, tmpV);
  s.exposure = exposureFor(tmpV.x);
  s.night = 1 - smooth(0.06, 0.42, t);
  s.glow = 1 - smooth(0.28, 0.85, t);
  const ns = 0.00022;
  s.nightSky[0] = ns * 0.32;
  s.nightSky[1] = ns * 0.42;
  s.nightSky[2] = ns * 1.0;
  return s;
}
