/**
 * Harmony: everything is in D Lydian (D E F# G# A B C#), the mode of wonder.
 * Plucks and sparkles use its pentatonic subset (D E F# A B), which can never clash.
 */

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export const LYDIAN = [0, 2, 4, 6, 7, 9, 11] as const;
export const PENTA = [0, 2, 4, 7, 9] as const;
export const D4 = 62;

/** MIDI note of scale degree `n` (any integer) of a scale rooted at `root`. */
export function degree(steps: readonly number[], n: number, root = D4): number {
  const len = steps.length;
  const i = Math.round(n);
  const oct = Math.floor(i / len);
  return root + oct * 12 + steps[i - oct * len];
}

export const lyd = (n: number, root = D4) => degree(LYDIAN, n, root);
export const pent = (n: number, root = D4) => degree(PENTA, n, root);

/** Music of the spheres: 10 degrees, D4 … B5. */
export const PLUCK_NOTES = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83] as const;

const PC: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

/** 'F#3' → 54. */
export function note(name: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[2]) + 1) + PC[m[1]];
}

const notes = (s: string) => (s.trim() ? s.trim().split(/\s+/).map(note) : []);

export interface Chord {
  /** Bass voices (drones / sub). */
  bass: number[];
  /** Pad voicing. */
  notes: number[];
  /** Optional colour tones on top (e.g. the Lydian #11). */
  top: number[];
}

export const chord = (bass: string, voicing: string, top = ''): Chord => ({
  bass: notes(bass),
  notes: notes(voicing),
  top: notes(top),
});

/** Nearest D-pentatonic MIDI note at or around `m`. */
export function nearestPent(m: number): number {
  let best = m;
  let bestD = 99;
  for (let k = Math.floor(m) - 3; k <= Math.ceil(m) + 3; k++) {
    const pc = (((k - 2) % 12) + 12) % 12;
    if (pc !== 0 && pc !== 2 && pc !== 4 && pc !== 7 && pc !== 9) continue;
    const d = Math.abs(k - m);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}
