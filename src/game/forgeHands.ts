import { Vector3 } from '@iwsdk/core';
import { clamp, invLerp } from '../core/math';
import type { Body, Cosmos } from '../sim/cosmos';
import { CompressState, Kind, Motes } from '../sim/motes';
import type { Hand, HandTracker } from '../xr/hands';

export interface FormResult {
  at: Vector3;
  /** Mass in hydrogen units (600 motes = 1). */
  mass: number;
  /** Fraction of hydrogen in what was squeezed. */
  hydrogen: number;
  /** Counts of [O, C, Si, Fe]. */
  elements: number[];
  oneHanded: boolean;
}

const MIN_MOTES = 30;
const GAP_START = 0.36;
const GAP_FULL = 0.095;
const IGNITE_HOLD = 1.0;

/**
 * The hand verbs of SUNSMITH: gather (handled by Motes), squeeze, ignite,
 * pinch-grab and throw, poke.
 */
export class ForgeHands {
  readonly compress: CompressState = {
    active: false,
    center: new Vector3(),
    axis: new Vector3(1, 0, 0),
    radius: 0.1,
    progress: 0,
    hands: [false, false],
  };
  /** Seconds held near full compression. */
  pressure = 0;
  /** 0..1 how close we are to ignition (for audio/visual tension). */
  tension = 0;
  oneHandMode = false;
  allowSqueeze = true;
  allowGrab = true;
  /** Extra hold time multiplier (giants are harder to ignite). */
  holdScale = 1;
  readonly grabbed: (Body | null)[] = [null, null];
  /** Last poke (fingertip touched a body) this frame. */
  poked: { body: Body; hand: number } | null = null;
  onForm: (r: FormResult) => void = () => {};
  onGrab: (b: Body, hand: number) => void = () => {};
  onRelease: (b: Body, hand: number) => void = () => {};
  private abortTimer = 0;
  /** Seconds before another squeeze may begin (after a birth). */
  private cooldown = 0;
  private readonly _v = new Vector3();
  private readonly grabOffset = [new Vector3(), new Vector3()];
  /** Seconds each hand has been untracked while holding a body. */
  private readonly lostFor = [0, 0];

  update(dt: number, now: number, ht: HandTracker, motes: Motes, cosmos: Cosmos) {
    this.updateSqueeze(dt, ht, motes);
    this.updateGrab(dt, now, ht, cosmos);
    this.updatePoke(ht, cosmos);
  }

  private updateSqueeze(dt: number, ht: HandTracker, motes: Motes) {
    const L = ht.left;
    const R = ht.right;
    const c = this.compress;
    const held = motes.heldCount;
    if (!this.allowSqueeze) {
      if (c.active) this.abort(ht, motes);
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!c.active && this.cooldown > 0) return;
    if (!c.active) {
      // Two-handed squeeze: palms facing, closing in, with gas in at least one hand.
      const gap = ht.palmGap();
      const facing = ht.palmsFacing();
      const total = held[0] + held[1];
      const free = !this.grabbed[0] && !this.grabbed[1] && !L.pinching && !R.pinching;
      if (free && L.tracked && R.tracked && total >= MIN_MOTES && gap < GAP_START && facing > 0.15) {
        this.begin(false, [true, true], motes);
      } else {
        // One-handed: slowly close a gas-holding hand into a fist.
        for (const [k, h] of [L, R].entries()) {
          // A pinch also curls the hand: never mistake it (or a hand carrying a world) for a fist.
          if (h.tracked && held[k] >= MIN_MOTES && h.curl > 0.62 && !h.isController && !h.pinching && !this.grabbed[k]) {
            this.begin(true, [k === 0, k === 1], motes);
            break;
          }
        }
      }
      this.pressure = Math.max(0, this.pressure - dt);
      this.tension = Math.max(0, this.tension - dt * 2);
      return;
    }

    // Active squeeze.
    if (!this.oneHandMode) {
      if (!L.tracked || !R.tracked) return this.maybeAbort(dt, ht, motes, true);
      const gap = ht.palmGap();
      const facing = ht.palmsFacing();
      c.center.copy(L.palm).lerp(R.palm, 0.5);
      c.axis.subVectors(R.palm, L.palm).normalize();
      c.radius = Math.max(0.011, gap * 0.4);
      c.progress = clamp(invLerp(GAP_START, GAP_FULL, gap));
      if (gap > GAP_START + 0.08 || facing < -0.2) return this.maybeAbort(dt, ht, motes, false);
    } else {
      const k = c.hands[0] ? 0 : 1;
      const h = k === 0 ? L : R;
      if (!h.tracked) return this.maybeAbort(dt, ht, motes, true);
      const p = clamp(invLerp(0.55, 0.93, h.curl));
      c.center.copy(h.palm).addScaledVector(h.normal, 0.035);
      c.axis.copy(h.forward);
      c.radius = 0.012 + (1 - p) * 0.05;
      c.progress = p;
      if (h.curl < 0.38) return this.maybeAbort(dt, ht, motes, false);
    }
    this.abortTimer = 0;
    // Pressure builds only near full compression; it bleeds off otherwise.
    if (c.progress > 0.8) this.pressure += dt;
    else this.pressure = Math.max(0, this.pressure - dt * 0.6);
    const need = IGNITE_HOLD * this.holdScale;
    this.tension = clamp(c.progress * 0.6 + (this.pressure / need) * 0.4);
    if (this.pressure >= need && motes.compressCount >= MIN_MOTES) this.ignite(motes);
  }

  private begin(oneHand: boolean, hands: [boolean, boolean], motes: Motes) {
    const c = this.compress;
    c.active = true;
    c.hands = hands;
    c.progress = 0;
    this.oneHandMode = oneHand;
    this.pressure = 0;
    this.abortTimer = 0;
    // Pull held gas from the participating hands into the squeeze cloud.
    for (let i = 0; i < motes.capacity; i++) {
      const s = motes.state[i];
      if (s === 2 /* Held */ && hands[motes.owner[i]]) motes.state[i] = 3 /* Compress */;
    }
  }

  private maybeAbort(dt: number, ht: HandTracker, motes: Motes, lost: boolean) {
    this.abortTimer += dt;
    if (this.abortTimer > (lost ? 0.6 : 0.22)) this.abort(ht, motes);
  }

  private abort(ht: HandTracker, motes: Motes) {
    motes.uncompress(ht.both);
    this.compress.active = false;
    this.compress.progress = 0;
    this.pressure = 0;
    this.abortTimer = 0;
  }

  private ignite(motes: Motes) {
    const c = this.compress;
    const k = motes.heldKinds;
    const total = k[0] + k[1] + k[2] + k[3] + k[4];
    const result: FormResult = {
      at: c.center.clone(),
      mass: total / 600,
      hydrogen: total > 0 ? k[Kind.Hydrogen] / total : 1,
      elements: [k[Kind.Oxygen], k[Kind.Carbon], k[Kind.Silicon], k[Kind.Iron]],
      oneHanded: this.oneHandMode,
    };
    // Everything the participating hands still hold goes into the newborn too.
    for (let i = 0; i < motes.capacity; i++) {
      if (motes.state[i] === 2 /* Held */ && c.hands[motes.owner[i]]) motes.state[i] = 3 /* Compress */;
    }
    motes.absorbCompress(c.center);
    this.cooldown = 1.5;
    c.active = false;
    c.progress = 0;
    this.pressure = 0;
    this.tension = 0;
    this.onForm(result);
  }

  /**
   * Accessibility assist: ignite whatever the hands hold (or the free cloud)
   * without the gesture, so no one is ever stuck.
   */
  forceIgnite(ht: HandTracker, motes: Motes, fallbackCenter: Vector3) {
    const c = this.compress;
    const held = motes.heldCount[0] + motes.heldCount[1];
    if (held < MIN_MOTES) {
      // Pull free matter straight into a virtual squeeze above the forge.
      for (let i = 0; i < motes.capacity; i++) {
        if (motes.state[i] === 1 /* Free */ && (motes.gatherMask >> motes.kind[i]) & 1) {
          motes.state[i] = 2;
          motes.owner[i] = 0;
        }
      }
    }
    c.hands = [true, true];
    if (ht.left.tracked && ht.right.tracked) c.center.copy(ht.left.palm).lerp(ht.right.palm, 0.5);
    else c.center.copy(fallbackCenter);
    for (let i = 0; i < motes.capacity; i++) if (motes.state[i] === 2) motes.state[i] = 3;
    // heldKinds is rebuilt by Motes.update; count kinds directly here.
    motes.heldKinds.fill(0);
    for (let i = 0; i < motes.capacity; i++) if (motes.state[i] === 3) motes.heldKinds[motes.kind[i]]++;
    this.ignite(motes);
  }

  /** Let go of anything held, without a throw (a cutscene is taking over). */
  dropAll() {
    for (let k = 0; k < 2; k++) {
      const b = this.grabbed[k];
      if (b) {
        b.heldBy = -1;
        b.vel.set(0, 0, 0);
      }
      this.grabbed[k] = null;
    }
  }

  private updateGrab(dt: number, now: number, ht: HandTracker, cosmos: Cosmos) {
    ht.both.forEach((h: Hand, k) => {
      const held = this.grabbed[k];
      h.holding = !!held;
      if (held) {
        if (!cosmos.bodies.includes(held)) {
          this.grabbed[k] = null;
          return;
        }
        // A brief tracking dropout must not drop the world: hold it still for a moment.
        if (!h.tracked) {
          this.lostFor[k] += dt;
          if (this.lostFor[k] < 0.2) {
            held.vel.set(0, 0, 0);
            return;
          }
          cosmos.release(held, this._v.set(0, 0, 0));
          this.onRelease(held, k);
          this.grabbed[k] = null;
          return;
        }
        this.lostFor[k] = 0;
        if (h.pinchEnded || !h.pinching) {
          const v = h.throwVelocity(this._v, now);
          if (v.length() > 3) v.setLength(3);
          cosmos.release(held, v);
          this.onRelease(held, k);
          this.grabbed[k] = null;
          return;
        }
        // Follow the pinch point (keeping the grab offset), lightly smoothed.
        const target = this._v.copy(h.pinchPoint).add(this.grabOffset[k]);
        const s = 1 - Math.exp(-30 * dt);
        held.pos.lerp(target, s);
        held.vel.set(0, 0, 0);
        return;
      }
      if (!this.allowGrab || !h.tracked || !h.pinchStarted || this.compress.active) return;
      let best: Body | null = null;
      let bestD = 0.04;
      for (const b of cosmos.bodies) {
        if (b.heldBy >= 0 || b.phase === 'dead' || b.type === 'pulsar') continue;
        if (b.type === 'star' && b.phase !== 'main') continue;
        const d = b.pos.distanceTo(h.pinchPoint) - b.radius;
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (best) {
        best.heldBy = k;
        this.grabbed[k] = best;
        // Keep a small offset so the body sits just beyond the fingertips.
        this.grabOffset[k].subVectors(best.pos, h.pinchPoint).clampLength(0, best.radius * 0.6);
        this.onGrab(best, k);
      }
    });
  }

  private updatePoke(ht: HandTracker, cosmos: Cosmos) {
    this.poked = null;
    for (const [k, h] of ht.both.entries()) {
      if (!h.tracked || h.isController) continue;
      for (const b of cosmos.bodies) {
        if (b.heldBy >= 0) continue;
        const d = b.pos.distanceTo(h.indexTip) - b.radius;
        if (b.star) {
          // Prominences reach toward an approaching fingertip.
          const reach = clamp(1 - d / 0.07);
          b.star.flareToward(h.indexTip, reach * reach);
        }
        if (d < 0.008) this.poked = { body: b, hand: k };
      }
    }
  }
}
