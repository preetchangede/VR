import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { clamp, smoothstep } from '../core/math';

/** WebXR hand joint names in spec order (25 joints). */
export const JOINT_NAMES: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
];

export const J = {
  wrist: 0,
  thumbTip: 4,
  indexMeta: 5,
  indexProx: 6,
  indexTip: 9,
  middleMeta: 10,
  middleProx: 11,
  middleTip: 14,
  ringTip: 19,
  pinkyMeta: 20,
  pinkyProx: 21,
  pinkyTip: 24,
} as const;

/** Bones as joint index pairs, used to build the hand occluder. */
export const BONES: [number, number][] = [];
for (let f = 0; f < 5; f++) {
  const base = f === 0 ? 1 : 5 * f;
  if (f > 0) BONES.push([0, base]);
  else BONES.push([0, 1]);
  for (let k = 0; k < (f === 0 ? 3 : 4); k++) BONES.push([base + k, base + k + 1]);
}
// Palm webbing between metacarpal bases and knuckles.
BONES.push([5, 10], [10, 15], [15, 20], [6, 11], [11, 16], [16, 21], [2, 6]);

const HISTORY = 8;
const _m = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _cq = new Quaternion();
const _co = new Vector3();

export class Hand {
  readonly side: 'left' | 'right';
  tracked = false;
  /** True when driven by a controller rather than articulated hand tracking. */
  isController = false;
  /** Seconds the hand has been continuously tracked (or lost, if negative). */
  trackedFor = 0;
  readonly joints: Vector3[] = JOINT_NAMES.map(() => new Vector3());
  readonly radii = new Float32Array(25).fill(0.008);
  /** Center of the palm, slightly in front of the palm skin. */
  readonly palm = new Vector3();
  /** Unit normal pointing out of the palm. */
  readonly normal = new Vector3(0, -1, 0);
  /** Unit vector from the wrist toward the fingers. */
  readonly forward = new Vector3(0, 0, -1);
  readonly indexTip = new Vector3();
  readonly thumbTip = new Vector3();
  /** Point between thumb and index tips (where a pinch grabs). */
  readonly pinchPoint = new Vector3();
  /** 0 (open) .. 1 (tips touching). */
  pinchStrength = 0;
  pinching = false;
  /** Set by the forge while this hand carries a body (it then gathers nothing). */
  holding = false;
  pinchStarted = false;
  pinchEnded = false;
  /** 0 = flat open hand, 1 = fist. */
  curl = 0;
  /** Smoothed palm velocity (m/s). */
  readonly velocity = new Vector3();
  speed = 0;
  private readonly hist: { p: Vector3; t: number }[] = Array.from({ length: HISTORY }, () => ({
    p: new Vector3(),
    t: 0,
  }));
  private histIdx = 0;
  private readonly prevPalm = new Vector3();
  private hasPrev = false;
  private readonly poseBuf = new Float32Array(25 * 16);
  private readonly radBuf = new Float32Array(25);

  constructor(side: 'left' | 'right') {
    this.side = side;
  }

  /** Throw velocity estimated over the last ~0.1 s of samples. */
  throwVelocity(out: Vector3, now: number) {
    let newest = this.hist[(this.histIdx + HISTORY - 1) % HISTORY];
    let oldest = newest;
    for (let i = 2; i <= HISTORY; i++) {
      const h = this.hist[(this.histIdx + HISTORY - i) % HISTORY];
      if (now - h.t > 0.12 || h.t === 0) break;
      oldest = h;
    }
    const dt = newest.t - oldest.t;
    if (dt < 1e-3) return out.set(0, 0, 0);
    return out.subVectors(newest.p, oldest.p).divideScalar(dt);
  }

  readFromJoints(frame: XRFrame, hand: XRHand, refSpace: XRReferenceSpace, origin: Matrix4) {
    const spaces = this.jointSpaces(hand);
    let ok = false;
    const f = frame as XRFrame & {
      fillPoses?: (s: Iterable<XRSpace>, b: XRSpace, out: Float32Array) => boolean;
      fillJointRadii?: (s: Iterable<XRJointSpace>, out: Float32Array) => boolean;
    };
    if (f.fillPoses && f.fillJointRadii) {
      try {
        ok = f.fillPoses(spaces, refSpace, this.poseBuf) && f.fillJointRadii(spaces, this.radBuf);
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      ok = true;
      for (let i = 0; i < 25; i++) {
        const p = frame.getJointPose?.(spaces[i], refSpace);
        if (!p) {
          ok = false;
          break;
        }
        this.poseBuf.set(p.transform.matrix, i * 16);
        this.radBuf[i] = p.radius ?? 0.008;
      }
    }
    if (!ok) return false;
    for (let i = 0; i < 25; i++) {
      _m.fromArray(this.poseBuf, i * 16).premultiply(origin);
      this.joints[i].setFromMatrixPosition(_m);
      this.radii[i] = this.radBuf[i] || 0.008;
    }
    return true;
  }

  private spaceCache = new WeakMap<XRHand, XRJointSpace[]>();
  private jointSpaces(hand: XRHand) {
    let s = this.spaceCache.get(hand);
    if (!s) {
      s = JOINT_NAMES.map((n) => hand.get(n)!);
      this.spaceCache.set(hand, s);
    }
    return s;
  }

  /** Synthesize a plausible hand skeleton from a controller grip pose. */
  readFromController(frame: XRFrame, source: XRInputSource, refSpace: XRReferenceSpace, origin: Matrix4) {
    const space = source.gripSpace ?? source.targetRaySpace;
    const pose = frame.getPose(space, refSpace);
    if (!pose) return false;
    _m.fromArray(pose.transform.matrix).premultiply(origin);
    const q = _cq.setFromRotationMatrix(_m);
    const origin3 = _co.setFromMatrixPosition(_m);
    const sx = this.side === 'right' ? -1 : 1;
    // A relaxed open hand around the grip: fingers along -Z, palm facing inward.
    for (let i = 0; i < 25; i++) {
      const finger = i === 0 ? -1 : Math.floor((i - 1) / 5) + (i >= 5 ? 0 : 0);
      const fi = i === 0 ? 0 : i < 5 ? 0 : Math.floor((i - 5) / 5) + 1;
      const k = i === 0 ? 0 : i < 5 ? i : ((i - 5) % 5) + 1;
      void finger;
      const spread = (fi - 2) * 0.018;
      _a.set(spread * -sx * 0, spread, -0.03 - k * 0.022);
      if (fi === 0) _a.set(sx * 0.03, 0.01, -0.02 - k * 0.012);
      _a.applyQuaternion(q).add(origin3);
      this.joints[i].copy(_a);
      this.radii[i] = 0.009;
    }
    const gp = source.gamepad;
    this.controllerPinch = gp ? gp.buttons[0]?.value ?? 0 : 0;
    this.controllerSqueeze = gp ? gp.buttons[1]?.value ?? 0 : 0;
    // Palm normal faces inward (toward the other hand).
    this.controllerNormal.set(sx, 0, 0).applyQuaternion(q);
    return true;
  }
  private controllerPinch = 0;
  private controllerSqueeze = 0;
  private readonly controllerNormal = new Vector3();

  /** Derive palm frame, pinch, curl and velocity from the joints. */
  derive(dt: number, now: number) {
    const j = this.joints;
    // Palm center: between wrist and the middle knuckle, nudged out of the palm.
    _a.copy(j[J.wrist]).lerp(j[J.middleProx], 0.55);
    // Palm axes.
    this.forward.subVectors(j[J.middleProx], j[J.wrist]);
    const handLen = this.forward.length() || 0.08;
    this.forward.divideScalar(handLen);
    if (this.isController) {
      this.normal.copy(this.controllerNormal);
    } else {
      _b.subVectors(j[J.pinkyMeta], j[J.indexMeta]); // index -> pinky
      _c.crossVectors(this.forward, _b);
      if (this.side === 'left') _c.negate();
      if (_c.lengthSq() > 1e-8) this.normal.copy(_c.normalize());
    }
    this.palm.copy(_a).addScaledVector(this.normal, 0.012);
    this.indexTip.copy(j[J.indexTip]);
    this.thumbTip.copy(j[J.thumbTip]);
    this.pinchPoint.copy(this.indexTip).lerp(this.thumbTip, 0.5);

    // Pinch with hysteresis (select at 0.9, release at 0.7 — matches Quest feel).
    const pinchDist = this.indexTip.distanceTo(this.thumbTip);
    const raw = this.isController ? this.controllerPinch : 1 - smoothstep(0.012, 0.045, pinchDist);
    this.pinchStrength = raw;
    const was = this.pinching;
    if (!this.pinching && raw > 0.9) this.pinching = true;
    else if (this.pinching && raw < 0.7) this.pinching = false;
    this.pinchStarted = !was && this.pinching;
    this.pinchEnded = was && !this.pinching;

    // Curl: how close the fingertips are to the palm, normalized by hand size.
    if (this.isController) {
      this.curl = this.controllerSqueeze;
    } else {
      let d = 0;
      d += j[J.indexTip].distanceTo(_a);
      d += j[J.middleTip].distanceTo(_a);
      d += j[J.ringTip].distanceTo(_a);
      d += j[J.pinkyTip].distanceTo(_a);
      d /= 4 * handLen;
      this.curl = 1 - smoothstep(0.75, 1.55, d);
    }

    // Velocity.
    if (this.hasPrev && dt > 0) {
      _b.subVectors(this.palm, this.prevPalm).divideScalar(dt);
      const k = 1 - Math.exp(-18 * dt);
      this.velocity.lerp(_b, k);
    } else this.velocity.set(0, 0, 0);
    this.speed = this.velocity.length();
    this.prevPalm.copy(this.palm);
    this.hasPrev = true;
    // Throw history: the pinch point, only while pinching. The release frame is
    // not sampled: as the fingers part, the pinch midpoint (or the palm) jumps,
    // which would add a fake flick to every throw.
    if (this.pinching) {
      const h = this.hist[this.histIdx];
      h.p.copy(this.pinchPoint);
      h.t = now;
      this.histIdx = (this.histIdx + 1) % HISTORY;
    }
  }

  markLost(dt: number) {
    if (this.tracked) this.trackedFor = 0;
    this.tracked = false;
    this.trackedFor -= dt;
    this.hasPrev = false;
    this.pinching = false;
    this.pinchStarted = false;
    this.pinchEnded = false;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
  }
}

/** Reads both hands from the XR frame every frame. */
export class HandTracker {
  readonly left = new Hand('left');
  readonly right = new Hand('right');
  readonly both = [this.left, this.right];
  /** Head pose in world space. */
  readonly head = new Vector3(0, 1.2, 0.5);
  readonly headForward = new Vector3(0, 0, -1);

  update(frame: XRFrame | null, refSpace: XRReferenceSpace | null, origin: Matrix4, dt: number, now: number) {
    const seen = { left: false, right: false };
    if (frame && refSpace) {
      for (const source of frame.session.inputSources) {
        const side = source.handedness;
        if (side !== 'left' && side !== 'right') continue;
        const hand = side === 'left' ? this.left : this.right;
        let ok = false;
        if (source.hand) {
          hand.isController = false;
          ok = hand.readFromJoints(frame, source.hand, refSpace, origin);
        } else if (source.gripSpace) {
          hand.isController = true;
          ok = hand.readFromController(frame, source, refSpace, origin);
        }
        if (ok) {
          seen[side] = true;
          if (!hand.tracked) hand.trackedFor = 0;
          hand.tracked = true;
          hand.trackedFor += dt;
          hand.derive(dt, now);
        }
      }
    }
    if (!seen.left) this.left.markLost(dt);
    if (!seen.right) this.right.markLost(dt);
  }

  /** Distance between palms, or Infinity if either hand is missing. */
  palmGap() {
    if (!this.left.tracked || !this.right.tracked) return Infinity;
    return this.left.palm.distanceTo(this.right.palm);
  }

  /** How much the palms face each other (1 = perfectly facing). */
  palmsFacing() {
    if (!this.left.tracked || !this.right.tracked) return 0;
    _a.subVectors(this.right.palm, this.left.palm).normalize();
    const l = this.left.normal.dot(_a);
    const r = -this.right.normal.dot(_a);
    return clamp((l + r) * 0.5, -1, 1);
  }
}
