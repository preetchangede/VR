import { params } from '../core/params';

export interface Discovery {
  id: string;
  title: string;
  fact: string;
}

export const DISCOVERIES: Discovery[] = [
  { id: 'first-light', title: 'First Light', fact: 'The first stars lit up about 100 million years after the Big Bang.' },
  { id: 'red-dwarf', title: 'Red Dwarf', fact: 'Red dwarfs sip their fuel so slowly they can shine for trillions of years.' },
  { id: 'blue-giant', title: 'Blue Giant', fact: 'Blue giants burn so fiercely they die within a few million years.' },
  { id: 'failed-star', title: 'Failed Star', fact: 'Too little hydrogen to ignite: a gas giant, like Jupiter.' },
  { id: 'supernova', title: 'Supernova', fact: 'For a few weeks, one dying star can outshine its entire galaxy.' },
  { id: 'pulsar', title: 'Pulsar', fact: 'A city-sized neutron star spinning many times a second, sweeping beams like a lighthouse.' },
  { id: 'molten-world', title: 'Molten World', fact: 'Young planets glow with the heat of the collisions that built them.' },
  { id: 'ocean-world', title: 'Ocean World', fact: 'Liquid water needs just the right distance from a star: the habitable zone.' },
  { id: 'lava-world', title: 'Lava World', fact: 'Too close to its star, a world stays molten forever.' },
  { id: 'ice-world', title: 'Ice World', fact: 'Too far from its star, a world freezes solid.' },
  { id: 'moon', title: 'Moon', fact: "Earth's Moon was likely born from a giant impact." },
  { id: 'rings', title: 'Rings', fact: 'Inside the Roche limit, tides tear a moon into a ring.' },
  { id: 'living-world', title: 'Living World', fact: 'Every living thing you know is made of atoms forged in stars.' },
  { id: 'binary', title: 'Binary Stars', fact: 'Most stars in the galaxy have a companion.' },
  { id: 'homecoming', title: 'Homecoming', fact: 'You stood on a world you built from the ashes of a star you made.' },
];

const KEY = 'sunsmith.codex.v1';

export class Codex {
  readonly found = new Set<string>();
  onDiscover: (d: Discovery) => void = () => {};

  constructor() {
    if (params.fresh) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.found.add(id);
    } catch {
      /* private mode */
    }
  }

  discover(id: string) {
    if (this.found.has(id)) return false;
    const d = DISCOVERIES.find((x) => x.id === id);
    if (!d) return false;
    this.found.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.found]));
    } catch {
      /* ignore */
    }
    this.onDiscover(d);
    return true;
  }

  get count() {
    return this.found.size;
  }
}
