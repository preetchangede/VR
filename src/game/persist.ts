import { Color, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { params } from '../core/params';
import type { Body } from '../sim/cosmos';
import type { Game } from './game';

const KEY = 'sunsmith.system.v1';
const ANCHOR_KEY = 'sunsmith.anchor.v1';

interface SavedBody {
  type: Body['type'];
  rel: number[];
  vel: number[];
  mass?: number;
  radius: number;
  look?: Record<string, unknown>;
  cooled?: number;
  living?: boolean;
  phase?: string;
  flags: string[];
}

export interface SavedSystem {
  v: 1;
  savedAt: number;
  arcDone: boolean;
  bodies: SavedBody[];
  pulsar: number[] | null;
  remnant: number[][];
}

const _m = new Matrix4();
const _inv = new Matrix4();
const _v = new Vector3();
const _q = new Quaternion();

/** Saves the system relative to the forge, and pins the forge to the real table. */
export class Persistence {
  private readonly g: Game;
  private timer = 0;
  saved: SavedSystem | null = null;
  private anchor: XRAnchor | null = null;
  private restoring = false;
  /** Pose recovered from a persistent anchor (world space). */
  restoredPose: { position: Vector3; yaw: number } | null = null;

  constructor(game: Game) {
    this.g = game;
    if (params.fresh) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.saved = JSON.parse(raw) as SavedSystem;
    } catch {
      this.saved = null;
    }
  }

  get hasFinishedArc() {
    return !!this.saved?.arcDone && this.saved.bodies.length > 0;
  }

  /** Called every frame. Saves every few seconds once the arc is complete. */
  update(dt: number) {
    if (this.g.director.beat !== 'sandbox' || !this.g.surface) return;
    this.timer += dt;
    if (this.timer > 4) {
      this.timer = 0;
      this.save();
    }
  }

  save() {
    const g = this.g;
    if (!g.surface) return;
    g.forge.updateMatrixWorld(true);
    _inv.copy(g.forge.matrixWorld).invert();
    _q.setFromRotationMatrix(_inv);
    const bodies: SavedBody[] = [];
    for (const b of g.cosmos.bodies) {
      if (b.phase === 'dead' || b.phase === 'collapse') continue;
      const rel = _v.copy(b.pos).applyMatrix4(_inv).toArray();
      const vel = b.vel.clone().applyQuaternion(_q).toArray();
      const sb: SavedBody = {
        type: b.type,
        rel,
        vel,
        radius: b.radius,
        mass: b.spec ? b.mu / 0.0013 : undefined,
        cooled: b.cooled,
        living: b.living,
        phase: b.phase,
        flags: [...b.flags],
      };
      if (b.look) {
        const l = b.look;
        sb.look = {
          kind: l.kind,
          seed: l.seed,
          radius: l.radius,
          molten: l.molten,
          ocean: l.ocean,
          ice: l.ice,
          clouds: l.clouds,
          life: l.life,
          rings: l.rings,
          atmosphere: l.atmosphere.getHex(),
          dustTint: l.dustTint.getHex(),
          bands: l.bands.map((c) => c.getHex()),
        };
      }
      bodies.push(sb);
    }
    const pulsar = g.pulsarOn ? g.pulsar.group.position.clone().applyMatrix4(_inv).toArray() : null;
    const data: SavedSystem = {
      v: 1,
      savedAt: Date.now(),
      arcDone: true,
      bodies,
      pulsar,
      remnant: g.director.remnantPalette().map((c) => [c.r, c.g, c.b]),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      this.saved = data;
    } catch {
      /* storage full or private mode */
    }
  }

  /** Rebuild a saved system around the (already placed) forge. */
  restore(): number {
    const g = this.g;
    const s = this.saved;
    if (!s) return 0;
    g.forge.updateMatrixWorld(true);
    const M = g.forge.matrixWorld;
    _q.setFromRotationMatrix(M);
    let n = 0;
    for (const sb of s.bodies) {
      const pos = new Vector3().fromArray(sb.rel).applyMatrix4(M);
      if (sb.type === 'star') {
        const b = g.cosmos.addStar(pos, sb.mass ?? 1, true);
        b.phase = 'main';
        b.star!.radius = b.spec!.radius;
        b.star!.brightness = 1;
        sb.flags.forEach((f) => b.flags.add(f));
        if (!g.director.sun) g.director.sun = b;
        n++;
      } else if (sb.type === 'planet' || sb.type === 'moon' || sb.type === 'gas') {
        const l = sb.look ?? {};
        const b = g.cosmos.addPlanet(pos, 1, sb.type);
        const look = b.look!;
        Object.assign(look, {
          seed: l.seed ?? look.seed,
          radius: l.radius ?? look.radius,
          molten: l.molten ?? 0,
          ocean: l.ocean ?? 0,
          ice: l.ice ?? 0,
          clouds: l.clouds ?? 0,
          life: l.life ?? 0,
          rings: l.rings ?? 0,
        });
        if (typeof l.atmosphere === 'number') look.atmosphere.setHex(l.atmosphere);
        if (typeof l.dustTint === 'number') look.dustTint.setHex(l.dustTint);
        if (Array.isArray(l.bands)) look.bands = (l.bands as number[]).map((h) => new Color(h));
        b.radius = look.radius;
        b.planet!.setLook(look);
        b.cooled = sb.cooled ?? 1;
        b.living = !!sb.living;
        if (b.cooled > 0.55) b.flags.add('cooled');
        sb.flags.forEach((f) => b.flags.add(f));
        b.vel.fromArray(sb.vel).applyQuaternion(_q);
        b.kinematic = false;
        if (b.living && !g.director.world) g.director.world = b;
        n++;
      }
    }
    if (s.pulsar) {
      g.pulsar.group.position.fromArray(s.pulsar).applyMatrix4(M);
      g.pulsarOn = true;
    }
    if (s.remnant?.length) g.director.setRemnantPalette(s.remnant.map((c) => new Color(c[0], c[1], c[2])));
    return n;
  }

  /** Seconds since the system was last saved. */
  get awaySeconds() {
    return this.saved ? (Date.now() - this.saved.savedAt) / 1000 : 0;
  }

  // ------------------------------------------------------------ anchors

  /** Try to restore last session's forge anchor. Resolves to a pose or null. */
  async tryRestoreAnchor(session: XRSession): Promise<void> {
    if (params.fresh || this.restoring) return;
    const s = session as XRSession & { restorePersistentAnchor?: (uuid: string) => Promise<XRAnchor> };
    let uuid: string | null = null;
    try {
      uuid = localStorage.getItem(ANCHOR_KEY);
    } catch {
      uuid = null;
    }
    if (!uuid || !s.restorePersistentAnchor) return;
    this.restoring = true;
    try {
      this.anchor = await s.restorePersistentAnchor(uuid);
    } catch {
      this.anchor = null;
    }
    this.restoring = false;
  }

  /** Poll the restored anchor's pose (call each frame until it resolves). */
  pollAnchor(frame: XRFrame | null, ref: XRReferenceSpace | null, origin: Matrix4) {
    if (!this.anchor || !frame || !ref || this.restoredPose) return;
    const pose = frame.getPose(this.anchor.anchorSpace, ref);
    if (!pose) return;
    _m.fromArray(pose.transform.matrix).premultiply(origin);
    const position = new Vector3().setFromMatrixPosition(_m);
    _q.setFromRotationMatrix(_m);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(_q);
    this.restoredPose = { position, yaw: Math.atan2(fwd.x, fwd.z) };
  }

  /** Create a persistent anchor at the forge's pose. */
  async pinForge(frame: XRFrame | null, ref: XRReferenceSpace | null, position: Vector3, yaw: number) {
    if (!frame || !ref || this.anchor) return;
    const f = frame as XRFrame & { createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<XRAnchor> };
    if (!f.createAnchor) return;
    try {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      const t = new XRRigidTransform({ x: position.x, y: position.y, z: position.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
      const anchor = await f.createAnchor(t, ref);
      this.anchor = anchor;
      const a = anchor as XRAnchor & { requestPersistentHandle?: () => Promise<string> };
      if (a.requestPersistentHandle) {
        const uuid = await a.requestPersistentHandle();
        try {
          const old = localStorage.getItem(ANCHOR_KEY);
          const sess = frame.session as XRSession & { deletePersistentAnchor?: (u: string) => Promise<void> };
          if (old && old !== uuid) sess.deletePersistentAnchor?.(old).catch(() => {});
          localStorage.setItem(ANCHOR_KEY, uuid);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* anchors unsupported: positions still persist relative to the table */
    }
  }

  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    this.saved = null;
  }
}
