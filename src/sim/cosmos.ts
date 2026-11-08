import { Color, Group, Vector3 } from '@iwsdk/core';
import { blackbody, clamp, damp, lerp, smoothstep } from '../core/math';
import { PlanetVisual, type PlanetLook } from '../render/planet';
import { StarVisual, starPalette } from '../render/star';
import { classify, hzRadius, StarSpec } from './stellar';

export type BodyType = 'star' | 'planet' | 'gas' | 'moon' | 'pulsar';

export type StarPhase = 'birth' | 'main' | 'swelling' | 'supergiant' | 'collapse' | 'dead';

export interface Body {
  id: number;
  type: BodyType;
  pos: Vector3;
  vel: Vector3;
  radius: number;
  /** Gravitational parameter (m^3/s^2). Planets have small values that only affect moons. */
  mu: number;
  /** Hand holding it (0 left, 1 right) or -1. */
  heldBy: number;
  /** Kinematic bodies are moved by script, not gravity. */
  kinematic: boolean;
  age: number;
  /** Body this one orbits (cached each frame). */
  primary: Body | null;
  // Stars
  spec?: StarSpec;
  phase?: StarPhase;
  phaseT?: number;
  star?: StarVisual;
  luminosity?: number;
  color?: Color;
  // Planets / moons / gas giants
  planet?: PlanetVisual;
  look?: PlanetLook;
  climate?: number; // flux relative to habitable-zone center (1 = temperate)
  cooled?: number; // 0..1 cooling progress
  orbitAge?: number;
  inHZ?: boolean;
  living?: boolean;
  elementMix?: number[]; // O, C, Si, Fe fractions
  /** Highlight 0..1 (visit prompt). */
  highlight?: number;
  /** Flags for one-time events. */
  flags: Set<string>;
}

export interface CosmosEvents {
  onEvent(kind: string, body: Body, extra?: unknown): void;
}

let nextId = 1;
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const UP = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);
const COLLAPSE_BLUE = new Color(0.85, 0.92, 1.0);
/** Seconds of implosion, then of held silence before the supernova (the audio is timed to match). */
export const COLLAPSE_IN = 0.9;
export const COLLAPSE_HOLD = 0.7;

/**
 * All celestial bodies on the table, their simulation and their visuals.
 */
export class Cosmos {
  readonly group = new Group();
  readonly bodies: Body[] = [];
  /** Forge center (world) and table height. */
  readonly center = new Vector3();
  floorY = 0;
  /** How strongly releases are steered into circular orbits (0..1). */
  orbitAssist = 0.75;
  /** Whether stars may swallow planets (sandbox) or gently repel them (arc). */
  protectPlanets = true;
  events: CosmosEvents = { onEvent: () => {} };
  /** Global time multiplier for evolution/cooling (time-lapse). */
  evolutionRate = 1;

  setForge(center: Vector3, floorY: number) {
    this.center.copy(center);
    this.floorY = floorY;
  }

  get stars() {
    return this.bodies.filter((b) => b.type === 'star');
  }

  /** The brightest living star (the system's sun). */
  mainStar(): Body | null {
    let best: Body | null = null;
    for (const b of this.bodies) {
      if (b.type !== 'star' || b.phase === 'dead' || b.phase === 'collapse') continue;
      if (!best || (b.luminosity ?? 0) > (best.luminosity ?? 0)) best = b;
    }
    return best;
  }

  addStar(at: Vector3, mass: number, kinematic = true): Body {
    const spec = classify(mass);
    const star = new StarVisual();
    starPalette(spec.temperature, star.color, star.limb, star.hot);
    const color = star.color.clone();
    star.radius = 0.004;
    star.brightness = 0;
    star.boil = spec.cls === 'blue-giant' ? 0.45 : 0.25;
    star.group.position.copy(at);
    this.group.add(star.group);
    const body: Body = {
      id: nextId++,
      type: 'star',
      pos: star.group.position,
      vel: new Vector3(),
      radius: spec.radius,
      mu: spec.mu,
      heldBy: -1,
      kinematic,
      age: 0,
      primary: null,
      spec,
      phase: 'birth',
      phaseT: 0,
      star,
      luminosity: spec.luminosity,
      color,
      flags: new Set(),
    };
    this.bodies.push(body);
    this.events.onEvent('star-born', body);
    return body;
  }

  addPlanet(at: Vector3, mass: number, type: 'planet' | 'gas' | 'moon', elementMix?: number[], dustTint?: Color): Body {
    const radius =
      type === 'gas' ? 0.026 + mass * 0.03 : type === 'moon' ? 0.009 + mass * 0.02 : clamp(0.02 + mass * 0.018, 0.022, 0.04);
    const seed = Math.random() * 1000;
    const look: PlanetLook = {
      kind: type === 'gas' ? 'gas' : type === 'moon' ? 'moon' : 'rocky',
      seed,
      radius,
      molten: type === 'gas' ? 0 : 1,
      ocean: 0,
      ice: 0,
      clouds: 0,
      life: 0,
      atmosphere: new Color(0.45, 0.7, 1.0),
      bands: [new Color('#e8c9a0'), new Color('#b5764a'), new Color('#f2e3c6'), new Color('#8a5a3c')],
      rings: 0,
      dustTint: dustTint ?? new Color(1, 0.6, 0.4),
    };
    if (type === 'gas') {
      const hue = Math.random();
      look.bands =
        hue < 0.33
          ? [new Color('#e9d2b0'), new Color('#c0814f'), new Color('#f4e6cc'), new Color('#9b5f3a')]
          : hue < 0.66
            ? [new Color('#bfe0ef'), new Color('#6aa3c9'), new Color('#e6f3f8'), new Color('#4b7aa6')]
            : [new Color('#f0d9ef'), new Color('#b07bb8'), new Color('#fbeefa'), new Color('#7c4f8f')];
      look.atmosphere = look.bands[1].clone();
    }
    const planet = new PlanetVisual(look);
    planet.group.position.copy(at);
    this.group.add(planet.group);
    const body: Body = {
      id: nextId++,
      type,
      pos: planet.group.position,
      vel: new Vector3(),
      radius,
      mu: type === 'gas' ? 3.5e-4 : type === 'planet' ? 2.4e-4 : 0,
      heldBy: -1,
      kinematic: false,
      age: 0,
      primary: null,
      planet,
      look,
      climate: 1,
      cooled: 0,
      orbitAge: 0,
      inHZ: false,
      living: false,
      elementMix,
      highlight: 0,
      flags: new Set(),
    };
    this.bodies.push(body);
    this.events.onEvent(type === 'gas' ? 'gas-born' : type === 'moon' ? 'moon-born' : 'planet-born', body);
    return body;
  }

  remove(body: Body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    if (body.star) {
      this.group.remove(body.star.group);
      body.star.dispose();
    }
    if (body.planet) {
      this.group.remove(body.planet.group);
      body.planet.dispose();
    }
  }

  /** The body whose gravity dominates at a point (excluding `self`). */
  dominant(p: Vector3, self?: Body): Body | null {
    let best: Body | null = null;
    let bestG = 0;
    for (const b of this.bodies) {
      if (b === self || b.mu <= 0 || b.phase === 'dead') continue;
      if (self && self.type !== 'moon' && b.type !== 'star' && b.type !== 'pulsar') continue;
      const d2 = Math.max(b.pos.distanceToSquared(p), 1e-5);
      const g = b.mu / d2;
      if (g > bestG) {
        bestG = g;
        best = b;
      }
    }
    return best;
  }

  /**
   * Release a held body with a throw velocity: steer it into a pleasing orbit
   * around whatever dominates gravity there.
   */
  release(body: Body, throwVel: Vector3) {
    body.heldBy = -1;
    const prim = this.dominant(body.pos, body);
    body.vel.copy(throwVel);
    if (!prim) return;
    const r = _a.subVectors(body.pos, prim.pos);
    if (prim.type === 'star') r.y = 0; // orbits live in the star's horizontal plane
    let dist = r.length();
    const minR = prim.radius * 3 + body.radius * 1.5;
    if (dist < minR) {
      r.setLength(minR);
      dist = minR;
      body.pos.copy(prim.pos).add(r);
    }
    const rh = r.clone().normalize();
    const tangent = _b.crossVectors(UP, rh).normalize();
    // Respect the direction the player threw; default counter-clockwise.
    const sign = throwVel.dot(tangent) < -0.02 ? -1 : 1;
    const vc = Math.sqrt(prim.mu / dist);
    const assisted = tangent.multiplyScalar(vc * sign).add(prim.vel);
    body.vel.lerp(assisted, this.orbitAssist);
    body.primary = prim;
    body.orbitAge = 0;
    this.events.onEvent('released', body, prim);
  }

  update(dt: number, time: number, camPos: Vector3) {
    const evo = dt * this.evolutionRate;
    for (const b of this.bodies) {
      b.age += dt;
      if (b.type === 'star' || b.type === 'pulsar') this.updateStar(b, dt, evo, time);
    }
    // Gravity for free bodies (semi-implicit Euler, substeps).
    const steps = 4;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const b of this.bodies) {
        if (b.kinematic || b.heldBy >= 0 || b.type === 'star' || b.type === 'pulsar') continue;
        const acc = _c.set(0, 0, 0);
        for (const o of this.bodies) {
          if (o === b || o.mu <= 0 || o.heldBy >= 0) continue;
          // Planets only pull moons.
          if ((o.type === 'planet' || o.type === 'gas') && b.type !== 'moon') continue;
          _a.subVectors(o.pos, b.pos);
          const d2 = _a.lengthSq() + 0.0004;
          const d = Math.sqrt(d2);
          acc.addScaledVector(_a, o.mu / (d2 * d));
        }
        b.vel.addScaledVector(acc, h);
        b.pos.addScaledVector(b.vel, h);
      }
    }
    for (const b of this.bodies) {
      if (b.type === 'star' || b.type === 'pulsar') continue;
      this.updateOrbitAssist(b, dt);
      this.tether(b, dt);
      this.updateClimate(b, dt, evo);
    }
    this.collisions();
    const ms = this.mainStar();
    for (const b of this.bodies) {
      if (!b.planet) continue;
      const light = ms ?? this.bodies.find((x) => x.type === 'pulsar') ?? null;
      b.planet.setHighlight(b.highlight ?? 0);
      b.planet.update(dt, time, light ? light.pos : this.center, light?.color ?? WHITE, light ? 1 : 0.2, camPos);
    }
  }

  private updateStar(b: Body, dt: number, evo: number, time: number) {
    const sv = b.star!;
    b.phaseT = (b.phaseT ?? 0) + dt;
    const spec = b.spec!;
    switch (b.phase) {
      case 'birth': {
        const t = clamp(b.phaseT / 1.6);
        sv.radius = lerp(0.004, spec.radius, 1 - Math.pow(1 - t, 3));
        sv.brightness = lerp(2.2, 1, t);
        b.luminosity = spec.luminosity * (0.4 + 0.6 * t);
        if (t >= 1) {
          b.phase = 'main';
          b.phaseT = 0;
        }
        break;
      }
      case 'main':
        sv.radius = damp(sv.radius, spec.radius, 3, dt);
        sv.brightness = damp(sv.brightness, 1, 3, dt);
        break;
      case 'swelling': {
        // Blue giant exhausts its core and balloons into a red supergiant.
        const T = clamp((b.phaseT ?? 0) / 11);
        const e = smoothstep(0, 1, T);
        sv.radius = lerp(spec.radius, 0.13, e * e);
        starPalette(lerp(spec.temperature, 3200, smoothstep(0, 0.45, T)), sv.color, sv.limb, sv.hot);
        b.color!.copy(sv.color);
        sv.boil = lerp(0.45, 1.0, e);
        sv.coronaScale = lerp(6, 2.4, e);
        sv.brightness = lerp(1, 0.85, e);
        b.radius = sv.radius;
        b.luminosity = lerp(spec.luminosity, 3.6, e);
        if (T >= 1) {
          b.phase = 'supergiant';
          b.phaseT = 0;
          this.events.onEvent('supergiant', b);
        }
        break;
      }
      case 'supergiant': {
        // Shudders before the end.
        const shudder = Math.sin(time * 38) * 0.004 * clamp((b.phaseT ?? 0) / 6);
        sv.radius = 0.13 + shudder + Math.sin(time * 2.3) * 0.003;
        b.radius = sv.radius;
        break;
      }
      case 'collapse': {
        // Implosion (COLLAPSE_IN), then a held breath: a flickering pinprick in a
        // darkening room (COLLAPSE_HOLD), then 'collapsed' fires the supernova.
        const p = b.phaseT ?? 0;
        const T = clamp(p / COLLAPSE_IN);
        const H = clamp((p - COLLAPSE_IN) / COLLAPSE_HOLD);
        sv.radius = lerp(0.13, 0.003, T * T * T);
        sv.color.lerp(COLLAPSE_BLUE, T);
        if (H <= 0) sv.brightness = lerp(0.85, 3.5, T * T);
        else {
          const flicker = 0.7 + 0.3 * Math.sin(time * 61) * Math.sin(time * 23);
          sv.brightness = lerp(3.5, 0.45, Math.sqrt(H)) * flicker;
          b.luminosity = damp(b.luminosity ?? 0, 0.15, 7, dt);
        }
        b.radius = sv.radius;
        if (p >= COLLAPSE_IN + COLLAPSE_HOLD) {
          b.phase = 'dead';
          this.events.onEvent('collapsed', b);
        }
        break;
      }
      case 'dead':
        sv.brightness = damp(sv.brightness, 0, 8, dt);
        sv.group.visible = sv.brightness > 0.01;
        b.luminosity = 0;
        break;
    }
    void evo;
    sv.update(time);
  }

  /** Over time, gently round orbits so the system stays beautiful forever. */
  private updateOrbitAssist(b: Body, dt: number) {
    if (b.heldBy >= 0 || b.kinematic) return;
    const prim = this.dominant(b.pos, b);
    b.primary = prim;
    if (!prim) {
      b.vel.multiplyScalar(Math.exp(-0.8 * dt));
      return;
    }
    b.orbitAge = (b.orbitAge ?? 0) + dt;
    const r = _a.subVectors(b.pos, prim.pos);
    if (prim.type === 'star' || prim.type === 'pulsar') {
      // Ease into the star's horizontal plane.
      const dy = r.y;
      b.vel.y += (-dy * 2.2 - b.vel.y * 1.4) * dt;
      r.y = 0;
    }
    const dist = Math.max(r.length(), 1e-3);
    const rh = r.multiplyScalar(1 / dist);
    const tangent = _b.crossVectors(UP, rh).normalize();
    const rel = _c.subVectors(b.vel, prim.vel);
    const sign = rel.dot(tangent) < 0 ? -1 : 1;
    const vc = Math.sqrt(prim.mu / dist);
    const target = tangent.multiplyScalar(vc * sign).add(prim.vel);
    const k = 1 - Math.exp(-0.35 * dt);
    b.vel.x += (target.x - b.vel.x) * k;
    b.vel.z += (target.z - b.vel.z) * k;
    if (prim.type === 'moon' || prim.type === 'planet' || prim.type === 'gas') b.vel.y += (target.y - b.vel.y) * k;
  }

  /** Nothing is ever lost: a soft spring pulls strays back to the forge. */
  private tether(b: Body, dt: number) {
    // Scripted (kinematic) bodies go exactly where the director puts them.
    if (b.heldBy >= 0 || b.kinematic) return;
    _a.subVectors(b.pos, this.center);
    _a.y -= 0.17;
    const d = _a.length();
    if (d > 0.42) {
      b.vel.addScaledVector(_a, (-(d - 0.42) / d) * 6 * dt);
      b.vel.multiplyScalar(Math.exp(-1.5 * dt));
    }
    const minY = this.floorY + b.radius + 0.01;
    if (b.pos.y < minY) {
      b.pos.y = minY;
      if (b.vel.y < 0) b.vel.y *= -0.3;
    }
  }

  private updateClimate(b: Body, dt: number, evo: number) {
    if (!b.look || !b.planet) return;
    const ms = this.mainStar();
    const look = b.look;
    if (b.type === 'gas') {
      b.planet.setLook({});
      return;
    }
    let flux = 0.4;
    if (ms) {
      const r = Math.max(b.pos.distanceTo(ms.pos), 0.01);
      const hz = hzRadius(ms.luminosity ?? 1);
      flux = (hz / r) * (hz / r);
    }
    b.climate = damp(b.climate ?? flux, flux, 1.2, dt);
    const c = b.climate;
    const settled = b.heldBy < 0 && (b.orbitAge ?? 0) > 1.2;
    b.inHZ = c > 0.62 && c < 1.55;
    if (b.type === 'moon') {
      look.molten = damp(look.molten, 0, 0.6, evo);
      b.planet.setLook(look);
      return;
    }
    if (settled) b.cooled = clamp((b.cooled ?? 0) + evo / 11);
    const cool = b.cooled ?? 0;
    const hot = smoothstep(1.55, 2.4, c);
    const cold = smoothstep(0.62, 0.35, c);
    // Molten glow fades as it cools; hot worlds stay molten.
    look.molten = Math.max(1 - smoothstep(0.0, 0.6, cool), hot * 0.85);
    const water = smoothstep(0.35, 0.8, cool) * (1 - hot);
    look.ocean = water * (cold > 0.5 ? 0.35 : 0.62);
    look.ice = Math.max(cold * smoothstep(0.3, 0.8, cool), smoothstep(0.85, 1.4, c) * 0 + (b.inHZ ? 0.12 * water : 0));
    look.clouds = smoothstep(0.45, 0.9, cool) * (hot > 0.5 ? 0.9 : 0.5) * (cold > 0.8 ? 0.3 : 1);
    look.atmosphere.setRGB(lerp(0.42, 1.0, hot), lerp(0.68, 0.55, hot), lerp(1.0, 0.3, hot));
    if (cold > 0.5) look.atmosphere.setRGB(0.75, 0.88, 1.0);
    // Life: needs a temperate, watery world and some time.
    if (b.inHZ && cool > 0.95) {
      look.life = clamp(look.life + evo / 7);
      if (look.life > 0.6 && !b.living) {
        b.living = true;
        this.events.onEvent('life', b);
      }
    } else {
      look.life = damp(look.life, 0, 0.3, dt);
    }
    if (cool > 0.55 && !b.flags.has('cooled')) {
      b.flags.add('cooled');
      this.events.onEvent(hot > 0.5 ? 'lava-world' : cold > 0.5 ? 'ice-world' : 'ocean-world', b);
    }
    b.planet.setLook(look);
  }

  private collisions() {
    const bs = this.bodies;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        if (a.phase === 'dead' || b.phase === 'dead') continue;
        if ((a.kinematic && a.type !== 'star') || (b.kinematic && b.type !== 'star')) continue;
        const d = a.pos.distanceTo(b.pos);
        const isStarA = a.type === 'star';
        const isStarB = b.type === 'star';
        if (isStarA && isStarB) continue;
        if (isStarA || isStarB) {
          const star = isStarA ? a : b;
          const other = isStarA ? b : a;
          if (other.heldBy >= 0) continue;
          if (d < star.radius + other.radius * 0.6) {
            if (this.protectPlanets) {
              _a.subVectors(other.pos, star.pos).setLength(star.radius * 3 + other.radius);
              other.pos.copy(star.pos).add(_a);
            } else {
              this.events.onEvent('swallowed', star, other);
              this.remove(other);
              return;
            }
          }
          continue;
        }
        // Planet/moon pairs.
        const heavy = a.radius >= b.radius ? a : b;
        const light = heavy === a ? b : a;
        if (heavy.heldBy >= 0 || light.heldBy >= 0) continue;
        if (light.type === 'moon' && heavy.type !== 'moon') {
          const roche = heavy.radius * 2.0;
          if (d < roche && d > heavy.radius + light.radius * 0.5 && heavy.look) {
            heavy.look.rings = Math.min(1, heavy.look.rings + 0.85);
            heavy.planet!.setLook({ rings: heavy.look.rings });
            this.events.onEvent('rings', heavy, light);
            this.remove(light);
            return;
          }
        }
        if (d < (a.radius + b.radius) * 0.85) {
          this.events.onEvent('impact', heavy, light);
          // Merge: the heavy body grows; a big impact can throw off a moon.
          if (heavy.look && light.type !== 'moon' && heavy.type === 'planet') {
            heavy.look.molten = 1;
            heavy.cooled = 0;
            heavy.flags.delete('cooled');
            heavy.radius = Math.min(0.045, Math.cbrt(heavy.radius ** 3 + light.radius ** 3));
            heavy.look.radius = heavy.radius;
            heavy.planet!.setLook({ radius: heavy.radius, molten: 1 });
            this.remove(light);
            this.events.onEvent('impact-moon', heavy);
          } else {
            this.remove(light);
          }
          return;
        }
      }
    }
  }
}
