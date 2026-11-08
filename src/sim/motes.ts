import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { additive } from '../render/blend';
import type { Hand } from '../xr/hands';

/**
 * MOTES — the raw matter of SUNSMITH.
 *
 * A CPU-simulated pool of glowing particles: primordial hydrogen rising from
 * the well, element dust from supernovae, sparks. Motes drift in a gentle
 * swirling flow above the forge, cling to open palms that sweep through them,
 * swirl into a hot spinning disk when squeezed between two palms, and collapse
 * into whatever is born.
 */
export enum Kind {
  Hydrogen = 0,
  Oxygen = 1,
  Carbon = 2,
  Silicon = 3,
  Iron = 4,
  Spark = 5,
}

export enum State {
  Dead = 0,
  Free = 1,
  Held = 2,
  Compress = 3,
  Absorb = 4,
  Burst = 5,
  Remnant = 6,
}

/** Emission-inspired colors (display space). */
export const KIND_COLOR: [number, number, number][] = [
  [1.0, 0.3, 0.47], // hydrogen: H-alpha crimson-rose
  [0.25, 0.92, 0.8], // oxygen: OIII teal
  [1.0, 0.78, 0.4], // carbon: gold
  [0.68, 0.55, 1.0], // silicon: violet
  [1.0, 0.47, 0.22], // iron: ember
  [1.0, 0.86, 0.62], // spark
];

export interface CompressState {
  active: boolean;
  center: Vector3;
  /** Unit axis between the palms (disk normal). */
  axis: Vector3;
  radius: number;
  /** 0..1 how compressed (drives heat, spin, flattening). */
  progress: number;
  /** Which hands feed the squeeze. */
  hands: [boolean, boolean];
}

const _v = new Vector3();
const _w = new Vector3();
const _u = new Vector3();
const _t = new Vector3();

export class Motes {
  readonly capacity: number;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly slot: Float32Array;
  readonly kind: Uint8Array;
  readonly state: Uint8Array;
  readonly owner: Int8Array;
  readonly phase: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly wisp: Uint8Array;
  readonly points: Points;
  private readonly geo: BufferGeometry;
  private readonly aPos: BufferAttribute;
  private readonly aCol: BufferAttribute;
  private readonly aSize: BufferAttribute;
  readonly material: ShaderMaterial;

  /** Forge volume (world space). */
  readonly center = new Vector3();
  floorY = 0;
  volumeRadius = 0.2;
  volumeTop = 0.36;
  /** Which kinds hands may currently gather (bitmask of 1 << Kind). */
  gatherMask = 0;
  /** Live counts, recomputed every frame. */
  readonly heldCount = [0, 0];
  readonly heldMass = [0, 0];
  compressCount = 0;
  freeCount = 0;
  remnantCount = 0;
  aliveCount = 0;
  /** Per-kind held counts for both hands (for element bookkeeping). */
  readonly heldKinds = new Float32Array(6);
  /** Motes captured this frame (for sparkle audio). */
  capturedThisFrame = 0;
  /** Where the remnant settles back to, once called home. */
  homeward = 0;
  private cursor = 0;

  constructor(capacity = 5200) {
    this.capacity = capacity;
    const n = capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.slot = new Float32Array(n * 3);
    this.kind = new Uint8Array(n);
    this.state = new Uint8Array(n);
    this.owner = new Int8Array(n).fill(-1);
    this.phase = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.wisp = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.phase[i] = Math.random() * 1000;
      this.pos[i * 3 + 1] = -1000;
    }

    this.geo = new BufferGeometry();
    this.aPos = new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    this.aCol = new BufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage);
    this.aSize = new BufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('aColor', this.aCol);
    this.geo.setAttribute('aSize', this.aSize);
    this.geo.setDrawRange(0, 0);

    this.material = additive(
      new ShaderMaterial({
        uniforms: { uScale: { value: 800 }, uMaxPx: { value: 72 } },
        vertexShader: /* glsl */ `
          attribute vec4 aColor;
          attribute float aSize;
          uniform float uScale;
          uniform float uMaxPx;
          varying vec4 vColor;
          varying float vSharp;
          void main() {
            vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float px = aSize * uScale * projectionMatrix[1][1] / max(-mv.z, 0.02);
            // Sub-pixel motes fade instead of shimmering.
            vColor = aColor * clamp(px / 2.0, 0.0, 1.0);
            vSharp = aSize < 0.012 ? 1.0 : 0.0;
            gl_PointSize = clamp(px, 1.5, uMaxPx);
          }`,
        fragmentShader: /* glsl */ `
          varying vec4 vColor;
          varying float vSharp;
          void main() {
            vec2 c = gl_PointCoord * 2.0 - 1.0;
            float r2 = dot(c, c);
            if (r2 > 1.0) discard;
            float soft = exp(-r2 * 3.2) * (1.0 - r2);
            float core = exp(-r2 * 14.0);
            float a = mix(soft, soft * 0.55 + core, vSharp);
            gl_FragColor = vec4(vColor.rgb * vColor.a * a, 0.0);
          }`,
      }),
    );
    this.points = new Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 40;
  }

  setForge(center: Vector3, floorY: number) {
    this.center.copy(center);
    this.floorY = floorY;
  }

  private alloc(): number {
    for (let k = 0; k < this.capacity; k++) {
      const i = (this.cursor + k) % this.capacity;
      if (this.state[i] === State.Dead) {
        this.cursor = (i + 1) % this.capacity;
        return i;
      }
    }
    // Pool full: recycle the oldest spark/free mote.
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    return i;
  }

  private init(i: number, kind: Kind, state: State) {
    this.kind[i] = kind;
    this.state[i] = state;
    this.owner[i] = -1;
    this.age[i] = 0;
    this.life[i] = 0;
    this.wisp[i] = kind <= Kind.Iron && Math.random() < 0.14 ? 1 : 0;
    // Random point in a unit ball, slightly flattened.
    let x = 0,
      y = 0,
      z = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    this.slot[i * 3] = x;
    this.slot[i * 3 + 1] = y * 0.7;
    this.slot[i * 3 + 2] = z;
  }

  /** Hydrogen (or dust) welling up out of the table, over `seconds`. */
  private wellQueue: { kind: Kind; remaining: number; rate: number }[] = [];
  emitFromWell(kind: Kind, count: number, seconds: number) {
    this.wellQueue.push({ kind, remaining: count, rate: count / Math.max(seconds, 0.1) });
  }

  /** Burst of sparks from a point. */
  sparks(at: Vector3, count: number, speed: number, kind = Kind.Spark) {
    for (let n = 0; n < count; n++) {
      const i = this.alloc();
      this.init(i, kind, State.Burst);
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const s = speed * (0.35 + Math.random() * 0.9);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([_v.x * s, _v.y * s, _v.z * s], i * 3);
      this.life[i] = 0.5 + Math.random() * 1.1;
      this.wisp[i] = 0;
    }
  }

  /**
   * Supernova ejecta: element motes thrown outward from `at` into the room.
   * They coast, slow, hang glowing in the air, then drift home when
   * `homeward` rises.
   */
  ejecta(at: Vector3, count: number) {
    const kinds = [Kind.Oxygen, Kind.Carbon, Kind.Silicon, Kind.Iron];
    for (let n = 0; n < count; n++) {
      const i = this.alloc();
      const k = kinds[n % 4];
      this.init(i, k, State.Remnant);
      // Filamentary shell: cluster directions around a few "jets".
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const lobe = Math.sin(_v.x * 3.1 + _v.y * 2.3) * Math.cos(_v.z * 2.7 - _v.y);
      const s = 1.1 + Math.random() * 1.6 + lobe * 0.6;
      this.pos.set([at.x + _v.x * 0.02, at.y + _v.y * 0.02, at.z + _v.z * 0.02], i * 3);
      this.vel.set([_v.x * s, _v.y * s * 0.8, _v.z * s], i * 3);
      this.life[i] = 0;
      this.wisp[i] = Math.random() < 0.18 ? 1 : 0;
    }
  }

  /** Release everything held/compressing by hand `side` (or both) to free drift. */
  release(side?: 0 | 1) {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.state[i];
      if ((s === State.Held || s === State.Compress) && (side === undefined || this.owner[i] === side)) {
        this.state[i] = State.Free;
        this.owner[i] = -1;
      }
    }
  }

  /** Turn every compressing mote into absorbing motes collapsing on `at`. */
  absorbCompress(at: Vector3) {
    this.absorbTarget.copy(at);
    for (let i = 0; i < this.capacity; i++) {
      if (this.state[i] === State.Compress) {
        this.state[i] = State.Absorb;
        this.life[i] = 0.12 + Math.random() * 0.18;
        this.age[i] = 0;
      }
    }
  }
  private readonly absorbTarget = new Vector3();

  /** Move compressing motes back to the hand nearest them (squeeze aborted). */
  uncompress(hands: Hand[]) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.state[i] !== State.Compress) continue;
      _v.fromArray(this.pos, i * 3);
      let best = -1;
      let bd = Infinity;
      hands.forEach((h, k) => {
        if (!h.tracked) return;
        const d = h.palm.distanceToSquared(_v);
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      if (best >= 0) {
        this.state[i] = State.Held;
        this.owner[i] = best;
      } else {
        this.state[i] = State.Free;
        this.owner[i] = -1;
      }
    }
  }

  /** Kill all motes of a state (e.g. clear remnant). */
  kill(filter: (i: number) => boolean) {
    for (let i = 0; i < this.capacity; i++) if (this.state[i] !== State.Dead && filter(i)) this.state[i] = State.Dead;
  }

  update(dt: number, time: number, hands: Hand[], compress: CompressState | null, heat: number) {
    // Emission from the well.
    for (const q of this.wellQueue) {
      if (q.remaining <= 0) continue;
      let n = Math.min(q.remaining, Math.ceil(q.rate * dt + Math.random()));
      q.remaining -= n;
      while (n-- > 0) {
        const i = this.alloc();
        this.init(i, q.kind, State.Free);
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 0.075;
        this.pos.set([this.center.x + Math.cos(a) * r, this.floorY - 0.03, this.center.z + Math.sin(a) * r], i * 3);
        const up = 0.1 + Math.random() * 0.16;
        this.vel.set([Math.cos(a) * 0.05 - Math.sin(a) * 0.05, up, Math.sin(a) * 0.05 + Math.cos(a) * 0.05], i * 3);
      }
    }
    this.wellQueue = this.wellQueue.filter((q) => q.remaining > 0);

    const P = this.pos;
    const V = this.vel;
    const S = this.slot;
    const cx = this.center.x;
    const cz = this.center.z;
    const floor = this.floorY;
    const R = this.volumeRadius;
    const damp = Math.exp(-1.6 * dt);
    const gatherMask = this.gatherMask;
    const lh = hands[0];
    const rh = hands[1];
    const handsArr = [lh, rh];
    this.heldCount[0] = this.heldCount[1] = 0;
    this.compressCount = 0;
    this.freeCount = 0;
    this.remnantCount = 0;
    this.capturedThisFrame = 0;
    this.heldKinds.fill(0);
    let alive = 0;
    let maxIndex = 0;

    // Per-hand held-cloud radius from last frame's counts.
    const cloudR = [0.03 + 0.04 * Math.sqrt(this.heldMass[0]), 0.03 + 0.04 * Math.sqrt(this.heldMass[1])];

    for (let i = 0; i < this.capacity; i++) {
      const st = this.state[i];
      if (st === State.Dead) continue;
      alive++;
      maxIndex = i;
      const i3 = i * 3;
      let px = P[i3],
        py = P[i3 + 1],
        pz = P[i3 + 2];
      let vx = V[i3],
        vy = V[i3 + 1],
        vz = V[i3 + 2];
      const ph = this.phase[i];
      this.age[i] += dt;

      if (st === State.Free) {
        this.freeCount++;
        // Swirl around the forge axis + slow undulation.
        const dx = px - cx;
        const dz = pz - cz;
        const r = Math.sqrt(dx * dx + dz * dz) + 1e-4;
        const swirl = 0.05 * (1.2 - Math.min(r / R, 1.2));
        let ax = (-dz / r) * swirl * 2.0;
        let az = (dx / r) * swirl * 2.0;
        let ay = Math.sin(time * 0.7 + ph) * 0.03;
        // Cheap turbulence.
        ax += Math.sin(py * 23.0 + time * 0.9 + ph) * 0.05;
        az += Math.cos(px * 21.0 - time * 0.8 + ph) * 0.05;
        ay += Math.sin(pz * 19.0 + time * 0.6) * 0.03;
        // Containment: soft cylinder above the forge.
        if (r > R) {
          ax -= (dx / r) * (r - R) * 6;
          az -= (dz / r) * (r - R) * 6;
        }
        const h = py - floor;
        if (h < 0.05) ay += (0.05 - h) * 8;
        if (h > this.volumeTop) ay -= (h - this.volumeTop) * 6;
        // Hands: attraction, stirring, capture.
        const canGather = (gatherMask >> this.kind[i]) & 1;
        for (let k = 0; k < 2; k++) {
          const hd = handsArr[k];
          if (!hd.tracked) continue;
          const hx = hd.palm.x - px;
          const hy = hd.palm.y - py;
          const hz = hd.palm.z - pz;
          const d2 = hx * hx + hy * hy + hz * hz;
          if (d2 > 0.06) continue;
          const d = Math.sqrt(d2) + 1e-4;
          // Stir: the hand's motion drags nearby gas along.
          const stir = Math.max(0, 1 - d / 0.16) * 2.2;
          ax += hd.velocity.x * stir;
          ay += hd.velocity.y * stir;
          az += hd.velocity.z * stir;
          if (canGather && hd.curl < 0.85) {
            const pull = Math.max(0, 1 - d / 0.2) * 0.9;
            ax += (hx / d) * pull;
            ay += (hy / d) * pull;
            az += (hz / d) * pull;
            const capture = 0.08 + Math.min(hd.speed, 1) * 0.04;
            if (d < capture) {
              this.state[i] = State.Held;
              this.owner[i] = k;
              this.capturedThisFrame++;
            }
          }
        }
        vx = vx * damp + ax * dt;
        vy = vy * damp + ay * dt;
        vz = vz * damp + az * dt;
      } else if (st === State.Held) {
        const k = this.owner[i];
        const hd = handsArr[k];
        if (!hd || !hd.tracked) {
          if (hd && hd.trackedFor < -0.6) {
            this.state[i] = State.Free;
            this.owner[i] = -1;
          }
        } else {
          this.heldCount[k]++;
          this.heldKinds[this.kind[i]]++;
          const cr = cloudR[k];
          // Orbit around the palm in a lazy swirl, cloud sitting off the palm.
          const ang = time * (1.4 + (ph % 1) * 0.8) + ph;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const sx = S[i3] * ca - S[i3 + 2] * sa;
          const sz = S[i3] * sa + S[i3 + 2] * ca;
          const tx = hd.palm.x + hd.normal.x * cr * 0.7 + sx * cr;
          const ty = hd.palm.y + hd.normal.y * cr * 0.7 + S[i3 + 1] * cr;
          const tz = hd.palm.z + hd.normal.z * cr * 0.7 + sz * cr;
          const kSpring = 70;
          const kDamp = 11;
          vx += ((tx - px) * kSpring - vx * kDamp) * dt;
          vy += ((ty - py) * kSpring - vy * kDamp) * dt;
          vz += ((tz - pz) * kSpring - vz * kDamp) * dt;
        }
      } else if (st === State.Compress && compress) {
        this.compressCount++;
        this.heldKinds[this.kind[i]]++;
        const c = compress.center;
        const ax = compress.axis;
        // Build an orthonormal basis around the axis.
        _u.set(ax.y, ax.z, -ax.x).cross(ax).normalize();
        _w.crossVectors(ax, _u);
        const flat = 1 - 0.85 * compress.progress;
        const spin = (1.5 + 9 * compress.progress * compress.progress) * time + ph;
        const cs = Math.cos(spin);
        const sn = Math.sin(spin);
        const a = S[i3] * cs - S[i3 + 2] * sn;
        const b = S[i3] * sn + S[i3 + 2] * cs;
        const rr = compress.radius * (0.55 + 0.45 * Math.abs(S[i3 + 1]) + 0.2);
        const tx = c.x + (_u.x * a + _w.x * b) * rr + ax.x * S[i3 + 1] * rr * flat;
        const ty = c.y + (_u.y * a + _w.y * b) * rr + ax.y * S[i3 + 1] * rr * flat;
        const tz = c.z + (_u.z * a + _w.z * b) * rr + ax.z * S[i3 + 1] * rr * flat;
        const kSpring = 90;
        const kDamp = 12;
        vx += ((tx - px) * kSpring - vx * kDamp) * dt;
        vy += ((ty - py) * kSpring - vy * kDamp) * dt;
        vz += ((tz - pz) * kSpring - vz * kDamp) * dt;
      } else if (st === State.Compress) {
        this.state[i] = State.Free;
      } else if (st === State.Absorb) {
        const t = this.absorbTarget;
        const k = 1 - Math.exp(-dt * 22);
        px += (t.x - px) * k;
        py += (t.y - py) * k;
        pz += (t.z - pz) * k;
        vx = vy = vz = 0;
        if (this.age[i] > this.life[i]) this.state[i] = State.Dead;
      } else if (st === State.Burst) {
        const drag = Math.exp(-2.4 * dt);
        vx *= drag;
        vy = vy * drag - 0.05 * dt;
        vz *= drag;
        if (this.age[i] > this.life[i]) this.state[i] = State.Dead;
      } else if (st === State.Remnant) {
        this.remnantCount++;
        // Coast outward with strong drag, then hang and slowly churn.
        const drag = Math.exp(-(1.3 + this.age[i] * 0.2) * dt);
        vx *= drag;
        vy *= drag;
        vz *= drag;
        vx += Math.sin(py * 3.0 + time * 0.3 + ph) * 0.01 * dt;
        vy += Math.cos(pz * 3.0 + time * 0.25 + ph) * 0.008 * dt;
        vz += Math.sin(px * 3.0 - time * 0.2 + ph) * 0.01 * dt;
        if (this.homeward > 0) {
          // Fall back toward the forge along a spiral.
          const dx = cx - px;
          const dy = floor + 0.16 - py;
          const dz = cz - pz;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
          const g = this.homeward * (0.6 + 0.5 * Math.min(d, 1.5));
          vx += ((dx / d) * g - (dz / d) * g * 0.6) * dt;
          vy += (dy / d) * g * dt;
          vz += ((dz / d) * g + (dx / d) * g * 0.6) * dt;
          if (d < R * 0.9) {
            this.state[i] = State.Free;
          }
        }
      }

      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;
      P[i3] = px;
      P[i3 + 1] = py;
      P[i3 + 2] = pz;
      V[i3] = vx;
      V[i3 + 1] = vy;
      V[i3 + 2] = vz;
    }
    this.aliveCount = alive;
    this.heldMass[0] = this.heldCount[0] / 600;
    this.heldMass[1] = this.heldCount[1] / 600;
    this.writeRender(maxIndex + 1, time, compress, heat);
  }

  private writeRender(n: number, time: number, compress: CompressState | null, heat: number) {
    const ap = this.aPos.array as Float32Array;
    const ac = this.aCol.array as Float32Array;
    const as = this.aSize.array as Float32Array;
    ap.set(this.pos.subarray(0, n * 3));
    const prog = compress?.progress ?? 0;
    for (let i = 0; i < n; i++) {
      const st = this.state[i];
      const i4 = i * 4;
      if (st === State.Dead) {
        ac[i4 + 3] = 0;
        as[i] = 0;
        continue;
      }
      const kc = KIND_COLOR[this.kind[i]];
      let r = kc[0],
        g = kc[1],
        b = kc[2];
      const tw = 0.75 + 0.25 * Math.sin(time * 3.0 + this.phase[i] * 7.0);
      let a = 0.95 * tw;
      let size = this.wisp[i] ? 0.034 : 0.0055 + (this.phase[i] % 1) * 0.003;
      if (this.wisp[i]) a = 0.07;
      if (st === State.Held) {
        a *= 1.25;
      } else if (st === State.Compress) {
        // Heat: rose -> orange -> yellow-white as the cloud compresses.
        const h = Math.min(1, prog * 1.15 + heat * 0.3);
        const hr = 1.0;
        const hg = 0.45 + 0.5 * h;
        const hb = 0.2 + 0.7 * h * h;
        r = r + (hr - r) * h;
        g = g + (hg - g) * h;
        b = b + (hb - b) * h;
        a *= 1.0 + 1.6 * h;
        size *= this.wisp[i] ? 1 - 0.6 * prog : 1 - 0.35 * prog;
      } else if (st === State.Absorb) {
        r = 1;
        g = 0.95;
        b = 0.85;
        a = 2.0;
        size *= 0.8;
      } else if (st === State.Burst) {
        const lifeT = 1 - this.age[i] / this.life[i];
        a = 1.6 * lifeT * lifeT;
        size = 0.003;
      } else if (st === State.Remnant) {
        // Far-flung ejecta: larger so they read across the room; bright early.
        const glow = 1.4 * Math.exp(-this.age[i] * 0.5) + 0.55;
        a = (this.wisp[i] ? 0.09 : 0.85) * glow * tw;
        size = this.wisp[i] ? 0.07 : 0.011;
      }
      ac[i4] = r;
      ac[i4 + 1] = g;
      ac[i4 + 2] = b;
      ac[i4 + 3] = a;
      as[i] = size;
    }
    this.geo.setDrawRange(0, n);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    // Only upload what's used.
    this.aPos.clearUpdateRanges();
    this.aPos.addUpdateRange(0, n * 3);
    this.aCol.clearUpdateRanges();
    this.aCol.addUpdateRange(0, n * 4);
    this.aSize.clearUpdateRanges();
    this.aSize.addUpdateRange(0, n);
  }

  setPixelScale(halfViewportHeightPx: number) {
    this.material.uniforms.uScale.value = halfViewportHeightPx;
  }
}
