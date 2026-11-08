/**
 * SUNSMITH audio audition harness.
 *
 * Offline: every job renders the real engine graph (AudioCore) into an OfflineAudioContext,
 * stepping time with suspend() so the live lookahead scheduler runs exactly as in the
 * headset. Results are 16-bit stereo WAVs (pulled out by render.mjs via window.audition).
 *
 * Live: the page also has buttons to audition everything through the real AudioEngine.
 */
import { AudioCore } from '../../../src/audio/core';
import { AudioEngine } from '../../../src/audio/engine';
import type { MoodOptions } from '../../../src/audio/score';
import { LOOP_NAMES, type LoopHandle, type LoopName, type Mood, MOODS, SFX_NAMES, type SfxName, type Vec3 } from '../../../src/audio/types';

const SR = 48000;
const TABLE: Vec3 = { x: 0.06, y: -0.32, z: -0.42 };
const LEFT_HAND: Vec3 = { x: -0.14, y: -0.22, z: -0.36 };
const RIGHT_HAND: Vec3 = { x: 0.14, y: -0.22, z: -0.36 };

type Step = (core: AudioCore, t: number) => void;
interface Event {
  t: number;
  fn: Step;
}
interface Job {
  name: string;
  seconds: number;
  trimDb?: number;
  musicTrimDb?: number;
  /** Fade the very end (seconds) — for the trailer. */
  fadeOut?: number;
  /** 'linear' (default) or 'cos' (equal-power: holds, then sinks to silence). */
  fadeShape?: 'linear' | 'cos';
  /** Named hit points [scheduled time, label], written next to the WAV. */
  cues?: [number, string][];
  seed?: number;
  events: () => Event[];
}

// ─── Timeline helpers ───────────────────────────────────────────────────────────────
const at = (t: number, fn: Step): Event => ({ t, fn });

/** Call `fn(core, u)` every `dt` from t0 to t1 with u going 0 → 1. */
function sweep(t0: number, t1: number, fn: (core: AudioCore, u: number, t: number) => void, dt = 0.05): Event[] {
  const out: Event[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) out.push(at(t, (c, tt) => fn(c, (t - t0) / Math.max(t1 - t0, 1e-6), tt)));
  return out;
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

/** A loop whose handle later events can reach. */
function loopEvents(name: LoopName, pos: Vec3 | null, t0: number, t1: number, params: (u: number) => Record<string, number>, stopFade = 0.4): Event[] {
  let h: LoopHandle | null = null;
  return [
    at(t0, (c) => {
      h = c.loop(name, pos, params(0));
    }),
    ...sweep(t0 + 0.05, t1, (_c, u) => h?.set(params(u))),
    at(t1, () => h?.stop(stopFade)),
  ];
}

function ticks(t0: number, t1: number, rate: number, seedPos: Vec3): Event[] {
  const out: Event[] = [];
  let k = 0;
  for (let t = t0; t < t1; t += 1 / rate) {
    const j = (Math.sin(k * 12.9898) * 43758.5453) % 1;
    const jitter = Math.abs(j) * 0.6 / rate;
    const p = { x: seedPos.x + 0.06 * Math.sin(k * 1.7), y: seedPos.y + 0.04 * Math.cos(k * 2.3), z: seedPos.z };
    out.push(at(t + jitter, (c) => c.play('gather-tick', p, { gain: 0.8 + 0.4 * Math.abs(j) })));
    k++;
  }
  return out;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────────
const SFX_SECONDS: Partial<Record<SfxName, number>> = {
  ignite: 12,
  supernova: 18,
  'burn-away': 18,
  'well-open': 11,
  'star-born': 10,
  'ocean-form': 10,
  'life-bloom': 10,
  collapse: 5,
  return: 7,
  'gas-giant': 9,
  'planet-form': 8,
  'ring-shatter': 7,
  discovery: 6,
  'orbit-settle': 6,
  chime: 5,
  'ember-speak': 4,
  throw: 4,
  impact: 4,
  poke: 4,
  'menu-open': 3,
  'menu-close': 3,
  'pulsar-tick': 4,
  'gather-tick': 3,
};
const NON_SPATIAL: SfxName[] = ['discovery'];

function sfxJob(name: SfxName, suffix = '', opts?: { gain?: number; pitch?: number; size?: number }): Job {
  return {
    name: `sfx_${name}${suffix}`,
    seconds: SFX_SECONDS[name] ?? 8,
    events: () => [at(0.1, (c) => c.play(name, NON_SPATIAL.includes(name) ? null : TABLE, opts))],
  };
}

const LOOP_JOBS: Record<LoopName, Job> = {
  'gather-wind': {
    name: 'loop_gather-wind',
    seconds: 9,
    events: () =>
      loopEvents('gather-wind', RIGHT_HAND, 0.1, 8.2, (u) => {
        const t = u * 8;
        const i = t < 2 ? t / 2 : t < 4 ? 1 - 0.4 * (t - 2) : t < 6 ? 0.2 + 0.35 * (t - 4) : Math.max(0, 0.9 - 0.45 * (t - 6));
        return { intensity: i, pitch: u };
      }),
  },
  compress: {
    name: 'loop_compress',
    seconds: 10,
    events: () =>
      loopEvents(
        'compress',
        TABLE,
        0.1,
        9.2,
        (u) => {
          const t = u * 9.1;
          const p = t < 7 ? ease(t / 7) * 0.95 : 0.95;
          return { progress: p, heat: Math.pow(p, 0.8) };
        },
        0.08,
      ),
  },
  'star-hum': {
    name: 'loop_star-hum',
    seconds: 13,
    events: () =>
      loopEvents('star-hum', TABLE, 0.1, 12.2, (u) => {
        const m = [0.4, 1, 2, 3][Math.min(3, Math.floor(u * 4))];
        return { mass: m, size: m / 3 };
      }),
  },
  pulsar: {
    name: 'loop_pulsar',
    seconds: 9,
    events: () => loopEvents('pulsar', TABLE, 0.1, 8.5, (u) => ({ rate: 1 + 3 * u })),
  },
  'giant-boil': {
    name: 'loop_giant-boil',
    seconds: 9,
    events: () => loopEvents('giant-boil', TABLE, 0.1, 8.5, (u) => ({ intensity: 0.3 + 0.7 * u }), 0.8),
  },
  surf: {
    name: 'loop_surf',
    seconds: 24,
    events: () => loopEvents('surf', null, 0.1, 23, (u) => ({ intensity: 0.6 + 0.4 * u }), 1),
  },
  wind: {
    name: 'loop_wind',
    seconds: 13,
    events: () => loopEvents('wind', null, 0.1, 12.2, (u) => ({ intensity: u < 0.5 ? 0.2 + 1.6 * u : 1 - 1.2 * (u - 0.5) }), 0.8),
  },
};

function moodJob(mood: Mood, seconds = 15, opts?: MoodOptions, suffix = ''): Job {
  return { name: `mood_${mood}${suffix}`, seconds, events: () => [at(0, (c) => c.setMood(mood, opts))] };
}

/** The trailer: void → nebula → ignite → forge → giant → collapse/silence/supernova → remnant → world → dawn. */
const TRAILER: Job = {
  name: 'trailer_bed',
  seconds: 76,
  fadeOut: 2.5,
  trimDb: -0.75,
  musicTrimDb: 2.5,
  seed: 7,
  events: () => {
    const ev: Event[] = [];
    let star: LoopHandle | null = null;
    let boil: LoopHandle | null = null;
    let pulsar: LoopHandle | null = null;
    // (gainDb keeps this mix as reviewed after the in-game void/remnant/dawn trims.)
    ev.push(at(0, (c) => c.setMood('void', { fadeIn: 1.2, gainDb: 1.9 })));
    ev.push(at(1.2, (c) => c.play('well-open', TABLE, { size: 0.6 })));
    ev.push(at(5, (c) => c.setMood('nebula')));
    // Gather the first hydrogen.
    ev.push(...loopEvents('gather-wind', RIGHT_HAND, 5.2, 9.2, (u) => ({ intensity: 0.25 + 0.6 * Math.sin(Math.PI * u), pitch: 0.3 + 0.4 * u })));
    ev.push(...ticks(5.6, 8.8, 9, RIGHT_HAND));
    ev.push(at(6.4, (c) => c.play('ember-speak', { x: -0.25, y: 0.05, z: -0.6 })));
    // First Light: squeeze…
    ev.push(...loopEvents('compress', TABLE, 8.6, 11.72, (u) => ({ progress: 0.95 * ease(Math.min(1, u * 1.15)), heat: Math.min(1, u * 1.1) }), 0.05));
    ev.push(...sweep(8.6, 11.7, (c, u) => c.setIntensity(0.75 * u)));
    ev.push(at(11.72, (c) => c.silence(0.28)));
    // …ignite.
    ev.push(at(12, (c) => {
      c.setIntensity(0);
      c.play('ignite', TABLE, { size: 0.5 });
    }));
    ev.push(at(13.6, (c) => {
      c.play('star-born', TABLE, { size: 0.5 });
      star = c.loop('star-hum', TABLE, { mass: 1, size: 0.4 });
    }));
    ev.push(at(15, (c) => c.setMood('forge')));
    ev.push(at(16.2, (c) => c.play('discovery', null)));
    // Gather three times the gas…
    ev.push(...loopEvents('gather-wind', LEFT_HAND, 17.5, 21.8, (u) => ({ intensity: 0.4 + 0.5 * Math.sin(Math.PI * u), pitch: 0.5 + 0.3 * u })));
    ev.push(...ticks(17.8, 21.5, 12, LEFT_HAND));
    ev.push(...loopEvents('compress', TABLE, 22.2, 27.25, (u) => ({ progress: 0.96 * ease(Math.min(1, u * 1.1)), heat: Math.min(1, u * 1.2) }), 0.05));
    ev.push(...sweep(22.2, 27.2, (c, u) => c.setIntensity(0.9 * u)));
    ev.push(at(27.25, (c) => c.silence(0.3)));
    ev.push(at(27.55, (c) => {
      c.setIntensity(0);
      c.play('ignite', TABLE, { size: 1 });
      star?.set({ mass: 3, size: 1 });
    }));
    // The giant swells red.
    ev.push(at(28.2, (c) => {
      c.setMood('giant');
      boil = c.loop('giant-boil', TABLE, { intensity: 0.3 });
    }));
    ev.push(...sweep(28.4, 36.4, (_c, u) => boil?.set({ intensity: 0.3 + 0.7 * u }), 0.1));
    ev.push(at(32.5, (c) => c.play('poke', { x: 0.1, y: -0.2, z: -0.35 })));
    // Collapse → silence → supernova.
    ev.push(at(36.6, (c) => {
      c.play('collapse', TABLE, { size: 0.8 });
      boil?.stop(1.1);
      star?.stop(0.6);
    }));
    ev.push(at(37.85, (c) => c.silence(0.95)));
    ev.push(at(38.8, (c) => {
      c.play('supernova', TABLE, { size: 1 });
      c.setMood('supernova');
    }));
    ev.push(at(41.2, (c) => {
      pulsar = c.loop('pulsar', TABLE, { rate: 1.4 });
    }));
    ev.push(at(45, (c) => c.setMood('remnant', { gainDb: 1.8 })));
    // Stardust into a world.
    ev.push(...loopEvents('gather-wind', RIGHT_HAND, 45.8, 48.2, (u) => ({ intensity: 0.3 + 0.5 * Math.sin(Math.PI * u), pitch: 0.7 })));
    ev.push(...ticks(46, 48, 10, RIGHT_HAND));
    ev.push(at(48.4, (c) => c.play('planet-form', TABLE, { size: 0.5 })));
    ev.push(at(50, (c) => c.play('throw', RIGHT_HAND, { size: 0.4 })));
    ev.push(at(51.1, (c) => c.play('orbit-settle', { x: 0.15, y: -0.3, z: -0.5 })));
    ev.push(at(52, (c) => c.setMood('world')));
    // Music of the spheres: two worlds plucking their own polyrhythm.
    for (let t = 52.6, k = 0; t < 59.5; t += 1.45, k++) ev.push(at(t, (c) => c.pluck({ x: 0.15 * Math.cos(k), y: -0.3, z: -0.5 }, [5, 7, 6, 8][k % 4], 0.6)));
    for (let t = 53.3, k = 0; t < 59.5; t += 2.3, k++) ev.push(at(t, (c) => c.pluck({ x: -0.2, y: -0.28, z: -0.45 }, [2, 4, 3][k % 3], 0.45)));
    ev.push(at(54.2, (c) => c.play('ocean-form', { x: 0.15, y: -0.3, z: -0.5 })));
    ev.push(at(56.4, (c) => c.play('life-bloom', { x: 0.15, y: -0.3, z: -0.5 })));
    ev.push(at(57.2, () => pulsar?.stop(2)));
    ev.push(at(57.4, (c) => c.play('burn-away', null, { size: 0.3 })));
    // Dawn: D – Bm – G – A – D, swelling to the end.
    ev.push(at(59, (c) => c.setMood('dawn', { pace: 3, fadeIn: 2.5, gainDb: 4 })));
    ev.push(...loopEvents('surf', null, 59.5, 76, (u) => ({ intensity: 0.45 + 0.4 * u }), 2));
    ev.push(...loopEvents('wind', null, 60, 76, (u) => ({ intensity: 0.25 + 0.15 * u }), 2));
    // The sun clears the horizon on the final D.
    ev.push(at(70.3, (c) => c.play('star-born', null, { size: 0.9, gain: 1.2 })));
    [71.1, 71.45, 71.9, 72.6].forEach((t, i) => ev.push(at(t, (c) => c.pluck({ x: -0.3 + 0.2 * i, y: 0.1, z: -0.8 }, [5, 7, 9, 8][i], 0.7))));
    return ev;
  },
};

// ─── Trailer v2: re-timed to the 91 s picture edit (cue sheet from the edit) ─────────
const ORBIT: Vec3 = { x: 0.15, y: -0.3, z: -0.5 };
const LEAD = 0.005;
const Q = 128 / SR;
/** When an event scheduled at `t` actually sounds (suspend quantum + scheduling lead). */
const sounds = (t: number) => Math.ceil(t / Q) * Q + LEAD;
const V2 = {
  wellOpen: 6.0,
  gatherFrom: 9.0,
  compressFrom: 12.5,
  compressTo: 15.4,
  ignite: 15.5,
  titleShimmerLand: 18.5,
  giant: 21.5,
  collapse: 33.0,
  collapseLen: 0.8,
  silenceTo: 34.6,
  supernova: 34.6,
  pulsarPeriod: 2.4,
  pulsarFrom: 36.95,
  planetForm: 45.0,
  throw: 49.5,
  orbitSettle: 50.5,
  ocean: 56.0,
  lifeBloom: 58.5,
  burnAway: 61.5,
  crest: 67.5,
  dawn: 68.0,
  dawnPace: 2.46,
  endCard: 86.0,
  end: 91.0,
};
/** Reverse shimmer ("return") swells for 1.7 s and lands: start it this much early. */
const RETURN_LAND = 1.7;
/** Burn-away's airy pad crests 2.4·k + 3 s after the call, k = 1 + 0.3·size. */
const BURN_SIZE = (V2.crest - V2.burnAway - LEAD - 3) / 2.4 / 0.3 - 1 / 0.3;

const TRAILER_V2: Job = {
  name: 'trailer_bed_v2',
  seconds: V2.end,
  fadeOut: V2.end - (V2.endCard + 1),
  fadeShape: 'cos',
  trimDb: -0.65,
  musicTrimDb: 2.5,
  seed: 11,
  cues: (() => {
    const c: [number, string][] = [
      [0, 'void: deep sub drone (title card)'],
      [sounds(V2.wellOpen), 'well-open'],
      [sounds(V2.gatherFrom), 'nebula pad + gathering (wind, sparkles)'],
      [sounds(V2.compressFrom), 'compress: tension + heartbeat rising'],
      [sounds(V2.compressTo), 'heartbeat-length silence'],
      [sounds(V2.ignite), 'IGNITE'],
      [sounds(V2.titleShimmerLand - RETURN_LAND - LEAD) + RETURN_LAND, 'title-drop shimmer lands (reverse shimmer from 16.8)'],
      [sounds(V2.giant), 'GIANT: deep choir swell, boil + tension building'],
      [sounds(V2.collapse), 'collapse (implosion start)'],
      [sounds(V2.collapse) + V2.collapseLen, 'collapse cuts to dead silence'],
      [sounds(V2.supernova), 'SUPERNOVA'],
    ];
    for (let t = sounds(V2.pulsarFrom) + 0.2; t < 61; t += V2.pulsarPeriod) c.push([t, 'pulsar tick']);
    c.push(
      [sounds(V2.planetForm), 'planet-form'],
      [sounds(V2.throw), 'throw'],
      [sounds(V2.orbitSettle), 'orbit-settle'],
      [sounds(V2.ocean), 'ocean-form'],
      [sounds(V2.lifeBloom), 'life-bloom'],
      [sounds(V2.burnAway), 'burn-away (fire)'],
      [sounds(V2.crest - RETURN_LAND - LEAD) + RETURN_LAND, 'swell crest / whiteout (reverse shimmer lands)'],
      [sounds(V2.dawn), 'DAWN: D'],
    );
    const durs = [9, 9, 9, 7.5];
    const names = ['Bm', 'G', 'A', 'D (resolution)'];
    let mt = 0;
    durs.forEach((d, i) => {
      mt += d;
      c.push([sounds(V2.dawn) + mt / V2.dawnPace, `dawn: ${names[i]}`]);
    });
    c.push([sounds(V2.endCard - 1), 'dawn sinks away'], [sounds(V2.endCard), 'end card: soft final chord'], [V2.endCard + 1, 'fade to silence begins'], [V2.end, 'silence']);
    return c.sort((a, b) => a[0] - b[0]);
  })(),
  events: () => {
    const ev: Event[] = [];
    let star: LoopHandle | null = null;
    let boil: LoopHandle | null = null;
    let pulsar: LoopHandle | null = null;
    // 0–3.6 s: the void under the title card.
    ev.push(at(0, (c) => c.setMood('void', { fadeIn: 1.2, gainDb: 5.9 })));
    ev.push(at(1.1, (c) => c.play('chime', { x: -0.9, y: 0.4, z: -1.2 }, { gain: 0.16 })));
    ev.push(at(2.5, (c) => c.play('chime', { x: 0.9, y: 0.3, z: -1.3 }, { gain: 0.11, pitch: 1.5 })));
    ev.push(at(V2.wellOpen, (c) => c.play('well-open', TABLE, { size: 0.5 })));
    ev.push(at(8.0, (c) => c.setMood('nebula', { fadeIn: 2.5 })));
    // 9–12.5: gathering the first hydrogen.
    ev.push(...loopEvents('gather-wind', RIGHT_HAND, V2.gatherFrom, 12.45, (u) => ({ intensity: 0.25 + 0.6 * Math.sin(Math.PI * u), pitch: 0.3 + 0.4 * u })));
    ev.push(...ticks(V2.gatherFrom + 0.3, 12.3, 9, RIGHT_HAND));
    // 12.5–15.4: squeeze. The heartbeat starts already quick enough to accelerate audibly.
    ev.push(...loopEvents('compress', TABLE, V2.compressFrom, V2.compressTo, (u) => {
      const p = 0.18 + 0.79 * ease(Math.min(1, u * 1.05));
      return { progress: p, heat: Math.min(1, 0.2 + u) };
    }, 0.04));
    ev.push(...sweep(V2.compressFrom, V2.compressTo - 0.05, (c, u) => c.setIntensity(0.8 * u)));
    ev.push(at(V2.compressTo, (c) => c.silence(V2.ignite - V2.compressTo)));
    // 15.5: IGNITE.
    ev.push(at(V2.ignite, (c) => {
      c.setIntensity(0);
      c.play('ignite', TABLE, { size: 0.5 });
    }));
    ev.push(at(16.0, (c) => {
      c.setMood('forge', { fadeIn: 3 });
      star = c.loop('star-hum', TABLE, { mass: 1, size: 0.4 });
    }));
    // 18.5: title drop, a reverse shimmer landing on it.
    ev.push(at(V2.titleShimmerLand - RETURN_LAND - LEAD, (c) => c.play('return', null, { gain: 0.9 })));
    // 21.5–33: the giant.
    ev.push(at(V2.giant - 0.6, (c) => c.setMood('giant', { fadeIn: 3 })));
    ev.push(at(V2.giant, (c) => {
      c.play('star-born', TABLE, { size: 0.9 });
      star?.set({ mass: 3, size: 1 });
    }));
    ev.push(at(22.2, (c) => {
      boil = c.loop('giant-boil', TABLE, { intensity: 0.25 });
    }));
    ev.push(...sweep(22.3, 32.8, (_c, u) => boil?.set({ intensity: 0.25 + 0.75 * Math.pow(u, 1.3), gain: 0.6 + 1.2 * Math.pow(u, 1.6) }), 0.1));
    ev.push(...sweep(25.0, 32.9, (c, u) => c.setIntensity(Math.pow(u, 1.6)), 0.1));
    ev.push(at(29.8, (c) => c.play('poke', { x: 0.1, y: -0.2, z: -0.35 }, { gain: 0.8 })));
    // 33.0 collapse → 33.8 dead silence → 34.6 SUPERNOVA.
    ev.push(at(V2.collapse, (c) => {
      c.setIntensity(0);
      c.play('collapse', TABLE, { size: 0 });
      boil?.stop(0.6);
      star?.stop(0.4);
    }));
    ev.push(at(V2.collapse + V2.collapseLen, (c) => c.silence(V2.silenceTo - V2.collapse - V2.collapseLen)));
    ev.push(at(V2.supernova, (c) => {
      c.play('supernova', TABLE, { size: 1, gain: 1.1 });
      c.setMood('supernova');
    }));
    // The pulsar's lighthouse beam, softly, every 2.4 s.
    ev.push(at(V2.pulsarFrom, (c) => {
      pulsar = c.loop('pulsar', TABLE, { rate: 1 / V2.pulsarPeriod, gain: 0.55 });
    }));
    ev.push(at(39.5, (c) => c.setMood('remnant', { fadeIn: 4, gainDb: 1.8 })));
    // Stardust into a world.
    ev.push(...loopEvents('gather-wind', RIGHT_HAND, 42.6, 44.8, (u) => ({ intensity: 0.25 + 0.45 * Math.sin(Math.PI * u), pitch: 0.7 })));
    ev.push(...ticks(42.8, 44.6, 9, RIGHT_HAND));
    ev.push(at(V2.planetForm, (c) => c.play('planet-form', TABLE, { size: 0.5 })));
    ev.push(at(V2.throw, (c) => c.play('throw', RIGHT_HAND, { size: 0.4 })));
    ev.push(at(V2.orbitSettle, (c) => c.play('orbit-settle', ORBIT)));
    ev.push(at(50.8, (c) => c.setMood('world', { fadeIn: 2.5, gainDb: 3 })));
    for (let t = 51.6, k = 0; t < 60.2; t += 1.45, k++) ev.push(at(t, (c) => c.pluck({ x: 0.15 * Math.cos(k), y: -0.3, z: -0.5 }, [5, 7, 6, 8][k % 4], 0.6)));
    ev.push(at(V2.ocean, (c) => c.play('ocean-form', ORBIT)));
    ev.push(at(V2.lifeBloom, (c) => c.play('life-bloom', ORBIT)));
    // Homecoming: the world fades, the room burns away into a vast swell cresting at the whiteout.
    ev.push(at(60.6, (c) => c.setMood('silence')));
    ev.push(at(61.0, () => pulsar?.stop(2)));
    ev.push(at(V2.burnAway, (c) => c.play('burn-away', null, { size: BURN_SIZE, gain: 1.5 })));
    ev.push(...sweep(63.6, V2.crest - 0.05, (c, u) => c.setIntensity(Math.pow(u, 1.5)), 0.1));
    ev.push(...loopEvents('gather-wind', null, 63.4, V2.crest - 0.02, (u) => ({ intensity: Math.pow(u, 1.8), pitch: 0.2 + 0.8 * u, gain: 1.3 }), 0.12));
    ev.push(at(V2.crest - RETURN_LAND - LEAD, (c) => c.play('return', null, { gain: 1.1 })));
    ev.push(at(V2.crest, (c) => c.setIntensity(0)));
    // 68: dawn, resolving to D at ~82.
    ev.push(at(V2.dawn, (c) => c.setMood('dawn', { pace: V2.dawnPace, fadeIn: 3, gainDb: 4.8 })));
    ev.push(...loopEvents('surf', null, V2.dawn, V2.endCard, (u) => ({ intensity: 0.4 + 0.35 * u }), 3.5));
    ev.push(...loopEvents('wind', null, V2.dawn + 1, V2.endCard, (u) => ({ intensity: 0.2 + 0.15 * u }), 3.5));
    // A deep choir swelling into the resolution.
    ev.push(at(V2.dawn + 34.5 / V2.dawnPace - 1.2, (c) => c.play('star-born', null, { size: 0.9, gain: 1.1 })));
    // 86: end card. The dawn sinks away under a soft final chord; silence by 91.
    ev.push(at(V2.endCard - 1, (c) => c.setMood('silence')));
    ev.push(at(V2.endCard - 0.2, (c) => c.play('star-born', null, { size: 0.5, gain: 0.7 })));
    [0, 0.13, 0.27].forEach((d, i) => ev.push(at(V2.endCard + d, (c) => c.pluck({ x: -0.25 + 0.25 * i, y: 0.1, z: -0.9 }, [5, 7, 8][i], 0.35))));
    return ev;
  },
};

function allJobs(): Job[] {
  const jobs: Job[] = [];
  for (const n of SFX_NAMES) jobs.push(sfxJob(n));
  jobs.push(sfxJob('ignite', '_small', { size: 0.1 }));
  jobs.push(sfxJob('ignite', '_giant', { size: 1 }));
  jobs.push(sfxJob('supernova', '_max', { size: 1, gain: 2 }));
  jobs.push({
    name: 'sfx_gather-tick_burst',
    seconds: 3,
    events: () => {
      const out: Event[] = [];
      for (let i = 0; i < 80; i++) out.push(at(0.1 + i * 0.02, (c) => c.play('gather-tick', RIGHT_HAND)));
      return out;
    },
  });
  jobs.push({
    name: 'sfx_pluck_scale',
    seconds: 9,
    events: () => Array.from({ length: 10 }, (_, d) => at(0.1 + d * 0.55, (c) => c.pluck({ x: -0.3 + d * 0.06, y: -0.3, z: -0.45 }, d, d / 9))),
  });
  for (const n of LOOP_NAMES) jobs.push(LOOP_JOBS[n]);
  for (const m of MOODS) if (m !== 'silence') jobs.push(moodJob(m));
  jobs.push(moodJob('dawn', 64, undefined, '_full'));
  jobs.push({
    name: 'mood_forge_intensity',
    seconds: 15,
    events: () => [at(0, (c) => c.setMood('forge')), ...sweep(2, 13, (c, u) => c.setIntensity(Math.sin(Math.PI * u)), 0.1)],
  });
  jobs.push({
    name: 'mood_crossfades',
    seconds: 30,
    events: () => [at(0, (c) => c.setMood('nebula')), at(10, (c) => c.setMood('forge')), at(20, (c) => c.setMood('sandbox'))],
  });
  jobs.push({
    name: 'silence_duck',
    seconds: 12,
    events: () => {
      let s: LoopHandle | null = null;
      return [
        at(0, (c) => {
          c.setMood('giant');
          s = c.loop('giant-boil', TABLE, { intensity: 0.9 });
        }),
        at(6, (c) => {
          c.play('collapse', TABLE);
          s?.stop(1);
        }),
        at(7.25, (c) => c.silence(1)),
        at(8.25, (c) => {
          c.play('supernova', TABLE, { size: 0.6 });
          c.setMood('supernova');
        }),
      ];
    },
  });
  // The in-game pattern (director.ts): collapse + silence(2.2) together, detonation when the
  // 0.9 s visual implosion completes — the supernova must cut the still-rising collapse.
  jobs.push({
    name: 'game_supernova',
    seconds: 12,
    events: () => {
      let boil: LoopHandle | null = null;
      return [
        at(0, (c) => {
          c.setMood('giant', { fadeIn: 0.5 });
          boil = c.loop('giant-boil', TABLE, { intensity: 0.9 });
        }),
        at(3, (c) => {
          c.play('collapse', TABLE, { size: 1 });
          c.silence(2.2);
          boil?.stop(0.3);
        }),
        at(3.9, (c) => c.play('supernova', TABLE, { size: 1 })),
        at(9, (c) => c.setMood('remnant')),
      ];
    },
  });
  jobs.push(TRAILER);
  jobs.push(TRAILER_V2);
  // CPU benchmarks: render time vs audio time (realtime factor), worst case vs idle.
  jobs.push({
    name: 'bench_worst',
    seconds: 20,
    events: () => [
      at(0, (c) => {
        c.setMood('dawn');
        c.setIntensity(0.8);
        for (const [i, name] of (['compress', 'giant-boil', 'pulsar', 'gather-wind', 'surf'] as LoopName[]).entries()) {
          c.loop(name, { x: -0.3 + 0.15 * i, y: -0.3, z: -0.45 }, { intensity: 0.9, progress: 0.8, heat: 0.8, rate: 2 });
        }
        for (let i = 0; i < 3; i++) c.loop('star-hum', { x: -0.2 + 0.2 * i, y: -0.25, z: -0.5 }, { mass: i, size: 0.5 });
      }),
      at(2, (c) => c.play('supernova', TABLE, { size: 1 })),
      at(2.5, (c) => c.play('ignite', TABLE, { size: 1 })),
      ...ticks(3, 12, 20, RIGHT_HAND),
      ...Array.from({ length: 12 }, (_, k) => at(4 + k * 0.7, (c: AudioCore) => c.pluck({ x: 0.1, y: -0.3, z: -0.5 }, k % 10, 0.6))),
    ],
  });
  jobs.push({ name: 'bench_idle', seconds: 20, events: () => [at(0, (c) => c.setMood('void'))] });
  return jobs;
}

// ─── Offline renderer ─────────────────────────────────────────────────────────────
const peaks = { nodes: 0, panners: 0, voices: 0 };

async function renderJob(job: Job): Promise<AudioBuffer> {
  peaks.nodes = peaks.panners = peaks.voices = 0;
  const length = Math.ceil(job.seconds * SR);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: SR });
  const out = ctx.createGain();
  out.connect(ctx.destination);
  if (job.fadeOut) {
    const t0 = job.seconds - job.fadeOut;
    if (job.fadeShape === 'cos') {
      const n = 64;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.cos(((i / (n - 1)) * Math.PI) / 2);
      out.gain.setValueAtTime(1, t0);
      out.gain.setValueCurveAtTime(c, t0, job.fadeOut - 0.02);
    } else {
      out.gain.setValueAtTime(1, t0);
      out.gain.linearRampToValueAtTime(0, job.seconds - 0.05);
    }
  }
  const core = new AudioCore(ctx, out, { seed: job.seed ?? 1234, lead: 0.005, trimDb: job.trimDb ?? 0, musicTrimDb: job.musicTrimDb ?? 0 });
  core.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  const events = job.events().sort((a, b) => a.t - b.t);
  const q = 128 / SR;
  const quanta = new Set<number>();
  for (let t = 0.05; t < job.seconds; t += 0.05) quanta.add(Math.ceil(t / q));
  for (const e of events) if (e.t > 0) quanta.add(Math.ceil(e.t / q));
  let ei = 0;
  let lastLog = 0;
  const due = () => {
    const now = ctx.currentTime;
    const st = core.stats();
    peaks.nodes = Math.max(peaks.nodes, st.nodes);
    peaks.panners = Math.max(peaks.panners, st.panners);
    peaks.voices = Math.max(peaks.voices, st.voices + st.dying);
    if (window.auditionVerbose && now - lastLog >= 1) {
      lastLog = now;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      console.warn(`[audition] ${job.name} t=${now.toFixed(2)} heap=${mem ? (mem.usedJSHeapSize / 1e6).toFixed(0) + 'MB' : '?'} ${JSON.stringify(core.stats())}`);
    }
    while (ei < events.length && events[ei].t <= now + 1e-7) {
      events[ei].fn(core, now);
      ei++;
    }
    core.update();
  };
  due();
  for (const k of [...quanta].sort((a, b) => a - b)) {
    const t = k * q;
    if (t >= job.seconds - q) continue;
    ctx.suspend(t).then(() => {
      try {
        due();
      } catch (e) {
        console.error(`[audition] ${job.name} @${t.toFixed(2)}:`, e);
      }
      ctx.resume();
    });
  }
  return ctx.startRendering();
}

interface Stats {
  name: string;
  seconds: number;
  peak: number;
  peakDb: number;
  rmsDb: number;
  dc: [number, number];
  nonFinite: number;
  clipped: number;
  renderMs: number;
}

function stats(name: string, b: AudioBuffer, renderMs: number): Stats {
  let peak = 0;
  let sum = 0;
  let nonFinite = 0;
  let clipped = 0;
  const dc: [number, number] = [0, 0];
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    let s = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) {
        nonFinite++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a > 0.966) clipped++;
      sum += x * x;
      s += x;
    }
    dc[ch] = s / d.length;
  }
  const rms = Math.sqrt(sum / (b.length * b.numberOfChannels));
  return {
    name,
    seconds: b.duration,
    peak,
    peakDb: 20 * Math.log10(peak || 1e-12),
    rmsDb: 20 * Math.log10(rms || 1e-12),
    dc,
    nonFinite,
    clipped,
    renderMs,
  };
}

/** 16-bit PCM WAV with TPDF dither (quiet reverb tails stay smooth). */
function wav(b: AudioBuffer): Uint8Array {
  const ch = b.numberOfChannels;
  const n = b.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, b.sampleRate, true);
  dv.setUint32(28, b.sampleRate * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  let seed = 22222;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let x = data[c][i];
      if (!Number.isFinite(x)) x = 0;
      const v = Math.round(x * 32767 + (rnd() - rnd()));
      dv.setInt16(o, v < -32768 ? -32768 : v > 32767 ? 32767 : v, true);
      o += 2;
    }
  }
  return bytes;
}

function b64(u8: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
}

let lastWav: Uint8Array | null = null;
let lastBuffer: AudioBuffer | null = null;

const audition = {
  jobs: () => allJobs().map((j) => ({ name: j.name, seconds: j.seconds })),
  async render(name: string): Promise<Stats & { bytes: number; maxNodes: number; maxPanners: number; maxVoices: number; cues: [number, string][] | null }> {
    const job = allJobs().find((j) => j.name === name);
    if (!job) throw new Error(`no job ${name}`);
    const t0 = performance.now();
    const buf = await renderJob(job);
    const s = stats(name, buf, performance.now() - t0);
    lastBuffer = buf;
    lastWav = wav(buf);
    return { ...s, ...{ maxNodes: peaks.nodes, maxPanners: peaks.panners, maxVoices: peaks.voices }, cues: job.cues ?? null, bytes: lastWav.length };
  },
  /** Drop the last render (so the next garbage collection can free its context). */
  release(): void {
    lastWav = null;
    lastBuffer = null;
  },
  /** Base64 slice of the last render's WAV (chunked so huge files cross the bridge). */
  chunk(i: number, size = 3 * 1024 * 1024): string {
    if (!lastWav) return '';
    return b64(lastWav.subarray(i * size, Math.min(lastWav.length, (i + 1) * size)));
  },
};

declare global {
  interface Window {
    audition: typeof audition;
    auditionReady: boolean;
    auditionVerbose?: boolean;
    gc?: () => void;
  }
}
window.audition = audition;
window.auditionReady = true;

// ─── Live audition UI ─────────────────────────────────────────────────────────────
const engine = new AudioEngine();
const live: Partial<Record<LoopName, LoopHandle>> = {};
const ui = document.getElementById('ui');
if (ui) {
  const section = (title: string) => {
    const h = document.createElement('h2');
    h.textContent = title;
    ui.appendChild(h);
    const div = document.createElement('div');
    div.className = 'row';
    ui.appendChild(div);
    return div;
  };
  const button = (parent: HTMLElement, label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      engine.unlock();
      engine.setListener({ x: 0, y: 0, z: 0 } as never, { x: 0, y: 0, z: -1 } as never, { x: 0, y: 1, z: 0 } as never);
      fn();
    };
    parent.appendChild(b);
    return b;
  };
  const moods = section('Moods');
  for (const m of MOODS) button(moods, m, () => engine.setMood(m));
  const sfx = section('SFX');
  for (const n of SFX_NAMES) button(sfx, n, () => engine.play(n, TABLE as never));
  const loops = section('Loops (toggle; intensity / progress / mass follow the slider)');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = '0.6';
  const setAll = () => {
    const x = Number(slider.value);
    for (const h of Object.values(live)) h?.set({ intensity: x, progress: x, heat: x, mass: x * 3, size: x, rate: 0.5 + 3 * x, pitch: x });
    engine.setIntensity(x);
  };
  slider.oninput = setAll;
  for (const n of LOOP_NAMES) {
    button(loops, n, () => {
      if (live[n]) {
        live[n]!.stop(0.5);
        delete live[n];
      } else {
        live[n] = engine.loop(n, TABLE as never, {});
        setAll();
      }
    });
  }
  ui.appendChild(slider);
  const misc = section('Other');
  button(misc, 'pluck scale', () => {
    for (let d = 0; d < 10; d++) setTimeout(() => engine.pluck({ x: -0.3 + d * 0.06, y: -0.3, z: -0.45 } as never, d, d / 9), d * 450);
  });
  button(misc, 'silence 1.5 s', () => engine.silence(1.5));
  button(misc, 'render trailer offline & play', async () => {
    await audition.render('trailer_bed');
    const ctx = engine.context;
    if (!ctx || !lastBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = lastBuffer;
    src.connect(ctx.destination);
    src.start();
  });
}
