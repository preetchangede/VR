/**
 * Stellar classes as a function of squeezed mass (in "hydrogen units": one
 * unit is what the first gather offers). Tuned for readability at tabletop
 * scale, inspired by the real main sequence.
 */
export type StarClass = 'red-dwarf' | 'sun' | 'white' | 'blue-giant';

export interface StarSpec {
  cls: StarClass;
  name: string;
  temperature: number; // K, for color
  radius: number; // m
  luminosity: number; // relative, drives light + habitable zone
  mu: number; // gravitational parameter m^3/s^2
}

export const GAS_GIANT_MAX = 0.32;

export function classify(mass: number): StarSpec {
  const mu = 0.0013 * Math.max(0.4, Math.min(mass, 3.5));
  if (mass < 0.7) return { cls: 'red-dwarf', name: 'Red dwarf', temperature: 3100, radius: 0.017, luminosity: 0.4, mu };
  if (mass < 1.6) return { cls: 'sun', name: 'Yellow sun', temperature: 5700, radius: 0.024, luminosity: 1.0, mu };
  if (mass < 2.6) return { cls: 'white', name: 'White star', temperature: 9500, radius: 0.03, luminosity: 1.7, mu };
  return { cls: 'blue-giant', name: 'Blue giant', temperature: 21000, radius: 0.036, luminosity: 3.0, mu };
}

/** Habitable zone center radius (m) for a luminosity. */
export const hzRadius = (luminosity: number) => 0.155 * Math.sqrt(luminosity);
