import {
  Color,
  Group,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  World,
} from '@iwsdk/core';
import { Clock, clock } from '../core/clock';
import { clamp, damp, smoothstep } from '../core/math';
import { params } from '../core/params';
import { Pulsar, Shockwave, Trail, ZoneRing } from '../render/fx';
import { Glow } from '../render/sprites';
import { HandSkins } from '../render/handSkin';
import { Dimmer, HandReceivers, MAX_LIGHTS, receiverUniforms } from '../render/receiver';
import { Well } from '../render/well';
import { Body, Cosmos } from '../sim/cosmos';
import { Motes } from '../sim/motes';
import { hzRadius } from '../sim/stellar';
import type { SurfaceOptions, SurfaceScene } from './surfacePort';
import { HandTracker } from '../xr/hands';
import { Room, Surface } from '../xr/room';
import { AudioPort, LoopHandle, nullAudio } from './audioPort';
import { Codex } from './codex';
import { Director } from './director';
import { Ember } from './ember';
import { ForgeHands } from './forgeHands';
import { GhostHands } from './ghostHands';
import { PalmMenu } from '../ui/palmMenu';
import { TextPanel } from '../ui/text';
import { DISCOVERIES } from './codex';
import { Settings } from './settings';
import { Persistence } from './persist';
import { loadSurface } from './surfacePort';

export interface LightSource {
  position: Vector3;
  color: Color;
  intensity: number;
  /** Falloff radius in meters (light at distance r is half intensity). */
  radius: number;
}

/**
 * Top-level orchestrator: owns the real-world model (hands, room, table),
 * the relighting layer, the forge and all gameplay modules.
 */
export class Game {
  readonly world: World;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly clock: Clock = clock;
  readonly settings = new Settings();
  readonly hands = new HandTracker();
  readonly room = new Room();
  readonly dimmer = new Dimmer();
  readonly handReceivers = new HandReceivers();
  private readonly handSkins = new HandSkins();
  readonly well = new Well();
  /** Everything that lives on the table, positioned at the forge point. */
  readonly forge = new Group();
  readonly motes = new Motes();
  readonly cosmos = new Cosmos();
  readonly forgeHands = new ForgeHands();
  readonly ember = new Ember();
  readonly codex = new Codex();
  readonly shockwave = new Shockwave();
  readonly pulsar = new Pulsar();
  readonly zoneRing = new ZoneRing();
  readonly ghosts = new GhostHands();
  /** Volumetric glows: the free cloud, each hand's captured cloud, the squeeze. */
  private readonly cloudGlow = new Glow({ color: new Color(1, 0.3, 0.45), core: 0, renderOrder: 35 });
  private readonly handGlows = [new Glow({ color: new Color(1, 0.35, 0.5), core: 0, renderOrder: 36 }), new Glow({ color: new Color(1, 0.35, 0.5), core: 0, renderOrder: 36 })];
  private readonly squeezeGlow = new Glow({ color: new Color(1, 0.6, 0.35), core: 0.3, rays: 0.6, renderOrder: 37 });
  private readonly handLights: LightSource[] = [
    { position: new Vector3(), color: new Color(1, 0.35, 0.5), intensity: 0, radius: 0.07 },
    { position: new Vector3(), color: new Color(1, 0.35, 0.5), intensity: 0, radius: 0.07 },
  ];
  readonly menu: PalmMenu;
  /** Floating panel for the codex / notices. */
  readonly panel = new TextPanel({ width: 0.3, aspect: 1.25, size: 40, plate: 0.6 });
  private panelTimer = 0;
  readonly director: Director;
  readonly persist: Persistence;
  audio: AudioPort = nullAudio;
  private sessionSeen: XRSession | null = null;
  private lastFrame: XRFrame | null = null;
  surface: Surface | null = null;
  readonly head = new Vector3();
  readonly headForward = new Vector3();
  readonly headUp = new Vector3();
  readonly lights: LightSource[] = [];
  /** Target and current darkness of the real world (0..1). */
  dimTarget = 0;
  dim = 0;
  pulsarOn = false;
  inXR = false;
  inSurface = false;
  private surfaceScene: SurfaceScene | null = null;
  private searchTime = 0;
  private readonly origin = new Matrix4();
  private readonly trails = new Map<Body, Trail>();
  private readonly timers: { at: number; fn: () => void }[] = [];
  private flashLevel = 0;
  private flashHold = -1;
  private readonly starLights = new Map<Body, LightSource>();
  private readonly compressLight: LightSource = { position: new Vector3(), color: new Color(1, 0.5, 0.3), intensity: 0, radius: 0.08 };
  private readonly remnantLight: LightSource = { position: new Vector3(), color: new Color(0.5, 0.6, 1.0), intensity: 0, radius: 1.2 };
  private loops: { compress?: LoopHandle; wind?: LoopHandle; pulsar?: LoopHandle; boil?: LoopHandle } = {};
  private readonly starHums = new Map<Body, LoopHandle>();
  private lastPluck = new Map<Body, number>();
  private readonly _v = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly _w = new Vector3();
  private readonly panelOffset = new Vector3();

  constructor(world: World) {
    this.world = world;
    this.scene = world.scene;
    this.camera = world.camera;
    this.renderer = world.renderer;
    this.forge.name = 'forge';
    this.scene.add(
      this.room.group,
      this.dimmer.mesh,
      this.handReceivers.mesh,
      this.well.cap,
      this.forge,
      this.motes.points,
      this.cosmos.group,
      this.ember.group,
      this.shockwave.mesh,
      this.pulsar.group,
      this.zoneRing.mesh,
      this.ghosts.group,
      this.panel.mesh,
      this.cloudGlow.mesh,
      this.handGlows[0].mesh,
      this.handGlows[1].mesh,
      this.squeezeGlow.mesh,
    );
    this.menu = new PalmMenu([
      { id: 'codex', icon: '✦', label: () => `${this.codex.count}/${DISCOVERIES.length}`, action: () => this.showCodex() },
      {
        id: 'flash',
        icon: '☀',
        label: () => (this.settings.reduceFlashes ? 'Soft flash' : 'Full flash'),
        action: () => {
          this.settings.reduceFlashes = !this.settings.reduceFlashes;
          this.settings.save();
        },
      },
      {
        id: 'music',
        icon: '♫',
        label: () => (this.settings.musicVolume > 0 ? 'Music on' : 'Music off'),
        action: () => {
          this.settings.musicVolume = this.settings.musicVolume > 0 ? 0 : 0.8;
          this.audio.setMusicVolume(this.settings.musicVolume);
          this.settings.save();
        },
      },
      { id: 'move', icon: '⌖', label: () => 'Move forge', action: () => this.requestMove() },
      { id: 'restart', icon: '↺', label: () => 'Hold: restart', hold: true, action: () => this.restart() },
    ]);
    this.scene.add(this.menu.group);
    this.menu.onToggle = (open) => this.audio.play(open ? 'menu-open' : 'menu-close', this.head, { gain: 0.5 });
    this.forge.add(this.well.group);
    this.well.cap.visible = false;
    this.dimmer.mesh.visible = false;
    this.lights.push(this.compressLight, this.remnantLight, ...this.handLights);
    this.director = new Director(this);
    this.persist = new Persistence(this);
    this.cosmos.events = { onEvent: (k, b) => this.onCosmosEvent(k, b) };
    this.codex.onDiscover = (d) => {
      this.audio.play('discovery');
      if (params.debug) console.log(`[codex] discovered ${d.title}`);
    };
    this.ember.onSpeak = () => this.audio.play('ember-speak', this.ember.position, { gain: 0.5 });
  }

  /** Run `fn` after `seconds` of game time. */
  after(seconds: number, fn: () => void) {
    this.timers.push({ at: clock.time + seconds, fn });
  }

  private lastNow = 0;

  update(deltaSeconds: number, frame: XRFrame | null) {
    // In XR, only the update that carries an XRFrame drives the game (dev
    // tooling may call World.update a second time per frame). Measure our own
    // delta so neither call order nor a zero delta can stall or double-tick.
    if (this.world.session && !frame) return;
    const now = performance.now() / 1000;
    const d = this.lastNow > 0 ? now - this.lastNow : deltaSeconds;
    this.lastNow = now;
    clock.tick(d);
    const dt = clock.dt;
    const time = clock.time;
    receiverUniforms.uTime.value = clock.realTime;
    this.inXR = !!this.world.session;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (clock.time >= this.timers[i].at) {
        const t = this.timers.splice(i, 1)[0];
        t.fn();
      }
    }

    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.headForward);
    this.headUp.set(0, 1, 0).applyQuaternion(this.camera.getWorldQuaternion(this.headQuat));
    this.origin.copy(this.world.player.matrixWorld);
    const refSpace = this.world.xrReferenceSpace ?? null;
    this.lastFrame = frame;
    const session = this.world.session ?? null;
    if (session && session !== this.sessionSeen) {
      this.sessionSeen = session;
      this.audio.unlock();
      if (this.persist.hasFinishedArc) void this.persist.tryRestoreAnchor(session);
    }
    this.persist.pollAnchor(frame, refSpace, this.origin);
    this.hands.update(frame, refSpace, this.origin, clock.realDt, clock.realTime);
    this.room.update(frame, refSpace, this.origin);
    this.audio.setListener(this.head, this.headForward, this.headUp);

    if (this.inXR && !this.surface) this.searchForSurface(clock.realDt);

    this.dimmer.mesh.visible = this.inXR;
    this.dimmer.follow(this.head);
    // Prefer IWSDK's skinned hand mesh as the hand receiver; spheres are the fallback.
    const va = this.world.input?.xr?.visualAdapters;
    const vis = (a: unknown) => (a as { visual?: { model?: import('@iwsdk/core').Object3D } } | undefined)?.visual?.model;
    this.handSkins.update([vis(va?.hand.left), vis(va?.hand.right)]);
    this.handReceivers.mesh.visible = this.inXR && !this.handSkins.active;
    this.handReceivers.update(this.hands.both);

    if (this.surface) {
      this.forge.updateMatrixWorld(true);
      this.updateMove(clock.realDt);
      this.persist.update(clock.realDt);
      this.director.update(dt);
      this.forgeHands.update(dt, clock.realTime, this.hands, this.motes, this.cosmos);
      this.motes.update(dt, time, this.hands.both, this.forgeHands.compress.active ? this.forgeHands.compress : null, this.forgeHands.tension);
      this.cosmos.update(dt, time, this.head);
      this.updateFx(dt, time);
      this.updateAudio(dt);
    }
    // The well breathes: wide open while there is matter to gather, an ember
    // aperture otherwise (the director opens it during the wake beat).
    if (this.surface && this.director.beat !== 'wake' && this.director.beat !== 'wait-surface') {
      const gathering = this.motes.gatherMask !== 0 && this.motes.freeCount > 40;
      const target = gathering ? 1 : 0.3;
      this.well.open = damp(this.well.open, target, 0.8, clock.realDt);
    }
    this.well.update(this.forgeHands.tension);
    this.ember.update(clock.realDt, clock.realTime, this.head);
    this.updateUI(clock.realDt);
    this.updateSurfaceScene(dt, time);

    this.dim = damp(this.dim, this.dimTarget, 2.2, clock.realDt);
    receiverUniforms.uDim.value = this.dim;
    this.updateFlash(clock.realDt);
    this.pushLights();
    this.updatePixelScale();
  }

  private searchForSurface(dt: number) {
    this.searchTime += dt;
    // Let head tracking settle and scene understanding report planes first.
    if (this.searchTime < 1.0) return;
    // A returning player's forge comes back to the exact spot on their table.
    const rp = this.persist.restoredPose;
    if (rp) {
      this.placeForge({ point: rp.position.clone(), y: rp.position.y, outline: null, label: 'anchor', source: 'plane' }, rp.yaw);
      return;
    }
    if (this.persist.hasFinishedArc && this.searchTime < 3.0) return;
    const found = this.room.findTable(this.head, this.headForward);
    if (found) {
      this.placeForge(found);
    } else if (this.searchTime > 3.5) {
      const fwd = new Vector3(this.headForward.x, 0, this.headForward.z).normalize();
      const point = this.head.clone().addScaledVector(fwd, 0.42);
      point.y = this.head.y - 0.45;
      this.placeForge({ point, y: point.y, outline: null, label: 'virtual', source: 'virtual' });
    }
  }

  placeForge(surface: Surface, yaw?: number) {
    const firstPlacement = !this.surface;
    this.surface = surface;
    this.forge.position.copy(surface.point);
    this.well.place(surface.point, surface.outline);
    this.well.group.position.set(0, 0, 0);
    // Orient the forge so its local +Z points toward the player.
    const toPlayer = new Vector3(this.head.x - surface.point.x, 0, this.head.z - surface.point.z);
    const y = yaw ?? Math.atan2(toPlayer.x, toPlayer.z);
    this.forge.rotation.set(0, y, 0);
    if (surface.label !== 'anchor' || !firstPlacement) {
      void this.persist.pinForge(this.lastFrame, this.world.xrReferenceSpace ?? null, surface.point, y);
    }
    this.forge.updateMatrixWorld(true);
    this.motes.setForge(surface.point, surface.y);
    this.cosmos.setForge(surface.point, surface.y);
    console.log(`[sunsmith] forge placed on ${surface.label} (${surface.source}) at`, surface.point.toArray().map((v) => +v.toFixed(3)));
  }

  /** Flash: additive white over the whole real world (capped by settings). */
  flash(level: number, hold?: number) {
    const cap = this.settings.reduceFlashes ? 0.35 : 1;
    if (hold !== undefined) {
      this.flashHold = hold * cap;
      return;
    }
    this.flashLevel = Math.max(this.flashLevel, level * cap);
  }

  private updateFlash(dt: number) {
    this.flashLevel = Math.max(0, this.flashLevel - dt * 1.6);
    const f = Math.max(this.flashLevel * this.flashLevel, this.flashHold > 0 ? this.flashHold : 0);
    receiverUniforms.uFlash.value.setRGB(f, f * 0.96, f * 0.9);
  }

  setBurn(center: Vector3, radius: number) {
    receiverUniforms.uBurn.value.set(center.x, center.y, center.z, radius);
  }

  /** Head-gaze + pinch on a target (works without eye tracking; IWSDK GazeSystem covers glasses). */
  gazePinch(target: Vector3, radius: number) {
    const anyPinch = this.hands.left.pinchStarted || this.hands.right.pinchStarted;
    if (!anyPinch) return false;
    const to = this._v.subVectors(target, this.head);
    const along = to.dot(this.headForward);
    if (along <= 0) return false;
    const perp = Math.sqrt(Math.max(0, to.lengthSq() - along * along));
    return perp < radius + along * 0.06;
  }

  /** A pinch that starts near a point. */
  pinchNear(p: Vector3, radius: number) {
    for (const h of this.hands.both) if (h.pinchStarted && h.pinchPoint.distanceTo(p) < radius) return true;
    return this.gazePinch(p, radius);
  }

  private updateFx(dt: number, time: number) {
    this.shockwave.update(dt, time);
    // Pulsar.
    this.pulsar.intensity = damp(this.pulsar.intensity, this.pulsarOn && !this.inSurface ? 1 : 0, 1.2, dt);
    this.pulsar.update(dt, time);
    const beam = receiverUniforms.uBeam.value;
    beam.set(this.pulsar.group.position.x, this.pulsar.group.position.y, this.pulsar.group.position.z, this.pulsar.intensity * 0.9);
    receiverUniforms.uBeamAxis.value.copy(this.pulsar.axis);
    // Habitable zone around the main star.
    const ms = this.cosmos.mainStar();
    const holdingWorld = this.forgeHands.grabbed.some((b) => b && (b.type === 'planet' || b.type === 'moon'));
    if (this.director.beat === 'sandbox') this.zoneRing.target = holdingWorld ? 0.8 : 0;
    this.zoneRing.update(dt, time, ms ? ms.pos : null, ms ? hzRadius(ms.luminosity ?? 1) : 0.15);
    // Orbit trails.
    for (const b of this.cosmos.bodies) {
      if (b.type !== 'planet' && b.type !== 'moon' && b.type !== 'gas') continue;
      let tr = this.trails.get(b);
      if (!tr) {
        tr = new Trail(b.type === 'moon' ? new Color(0.7, 0.75, 0.85) : new Color(0.55, 0.75, 1.0));
        this.trails.set(b, tr);
        this.scene.add(tr.line);
      }
      if (b.kinematic || b.heldBy >= 0) tr.reset();
      tr.push(b.pos, dt);
      tr.line.visible = !this.inSurface;
    }
    for (const [b, tr] of this.trails) {
      if (!this.cosmos.bodies.includes(b)) {
        this.scene.remove(tr.line);
        this.trails.delete(b);
      }
    }
    // Remnant glow lights the room faintly.
    const rem = this.motes.remnantCount;
    this.remnantLight.position.copy(this.forge.position).y += 0.4;
    this.remnantLight.intensity = Math.min(1, rem / 1500) * 0.45;
    this.remnantLight.color.setRGB(0.55, 0.62, 0.95);
    // Volumetric glows.
    const m = this.motes;
    const free = m.freeCount;
    const cloudC = this._v.copy(this.forge.position);
    cloudC.y += 0.17;
    const gasColor = m.gatherMask & 1 ? [1, 0.3, 0.45] : [0.55, 0.65, 1.0];
    this.cloudGlow.material.uniforms.uColor.value.setRGB(gasColor[0], gasColor[1], gasColor[2]);
    this.cloudGlow.set(cloudC, 0.2, Math.min(1, free / 500) * 0.16);
    for (let k = 0; k < 2; k++) {
      const h = this.hands.both[k];
      const amt = Math.min(1, m.heldCount[k] / 600);
      const p = this.handGlows[k].mesh.position;
      if (h.tracked) p.copy(h.palm).addScaledVector(h.normal, 0.03);
      this.handGlows[k].material.uniforms.uColor.value.setRGB(gasColor[0], gasColor[1], gasColor[2]);
      this.handGlows[k].set(null, 0.05 + 0.05 * Math.sqrt(amt), h.tracked ? amt * 0.5 : 0);
      const hl = this.handLights[k];
      hl.position.copy(p);
      hl.color.setRGB(gasColor[0], gasColor[1], gasColor[2]);
      hl.intensity = h.tracked ? amt * 0.5 : 0;
    }
    {
      const c = this.forgeHands.compress;
      const heat = c.progress;
      this.squeezeGlow.material.uniforms.uColor.value.setRGB(1, 0.35 + 0.55 * heat, 0.3 + 0.6 * heat * heat);
      this.squeezeGlow.set(c.center, 0.03 + c.radius * 1.4, c.active ? 0.25 + heat * heat * 1.2 + this.forgeHands.tension * 0.8 : 0);
      this.squeezeGlow.tick(time);
    }
    // Squeeze glow lights the palms.
    const c = this.forgeHands.compress;
    this.compressLight.position.copy(c.center);
    this.compressLight.intensity = c.active ? 0.25 + c.progress * c.progress * 2.2 + this.forgeHands.tension * 0.6 : 0;
    const h = c.progress;
    this.compressLight.color.setRGB(1, 0.35 + 0.5 * h, 0.25 + 0.6 * h * h);
    this.compressLight.radius = 0.05 + 0.04 * h;
  }

  private updateAudio(dt: number) {
    const a = this.audio;
    if (!a.ready) return;
    const c = this.forgeHands.compress;
    // Squeeze tension.
    if (c.active) {
      if (!this.loops.compress) this.loops.compress = a.loop('compress', c.center, { progress: 0, heat: 0 });
      this.loops.compress.setPosition(c.center);
      this.loops.compress.set({ progress: c.progress, heat: this.forgeHands.tension });
      a.setIntensity(this.forgeHands.tension);
    } else if (this.loops.compress) {
      this.loops.compress.stop(0.3);
      this.loops.compress = undefined;
      a.setIntensity(0);
    }
    // Gather wind: hands moving through gas.
    const handSpeed = Math.max(this.hands.left.speed, this.hands.right.speed);
    const nearGas = this.motes.freeCount > 30 && this.motes.gatherMask !== 0;
    if (nearGas) {
      if (!this.loops.wind) this.loops.wind = a.loop('gather-wind', this.forge.position, { intensity: 0 });
      this.loops.wind.set({ intensity: clamp(handSpeed * 1.5) * 0.8, pitch: clamp(handSpeed) });
    } else if (this.loops.wind) {
      this.loops.wind.stop(1);
      this.loops.wind = undefined;
    }
    if (this.motes.capturedThisFrame > 0) a.play('gather-tick', this.forge.position, { gain: 0.35, pitch: 0.9 + Math.random() * 0.4 });
    // Star hums.
    for (const s of this.cosmos.stars) {
      let hum = this.starHums.get(s);
      if (s.phase === 'dead') {
        hum?.stop(1);
        this.starHums.delete(s);
        continue;
      }
      if (!hum) {
        hum = a.loop('star-hum', s.pos, { mass: s.spec ? s.mu / 0.0013 : 1, size: 0 });
        this.starHums.set(s, hum);
      }
      hum.setPosition(s.pos);
      hum.set({ mass: s.mu / 0.0013, size: clamp(s.radius / 0.13) });
    }
    // Giant boiling.
    const giant = this.cosmos.stars.find((s) => s.phase === 'swelling' || s.phase === 'supergiant');
    if (giant) {
      if (!this.loops.boil) this.loops.boil = a.loop('giant-boil', giant.pos, { intensity: 0 });
      this.loops.boil.set({ intensity: clamp(giant.radius / 0.13) });
    } else if (this.loops.boil) {
      this.loops.boil.stop(0.2);
      this.loops.boil = undefined;
    }
    // Pulsar.
    if (this.pulsar.intensity > 0.05 && !this.inSurface) {
      if (!this.loops.pulsar) this.loops.pulsar = a.loop('pulsar', this.pulsar.group.position, { rate: this.pulsar.rate * 2 });
    } else if (this.loops.pulsar) {
      this.loops.pulsar.stop(1);
      this.loops.pulsar = undefined;
    }
    // Music of the spheres: worlds pluck a note as they cross the meridian facing you.
    const ms = this.cosmos.mainStar();
    if (ms && !this.inSurface) {
      const toHead = this._v.subVectors(this.head, ms.pos).setY(0).normalize();
      for (const b of this.cosmos.bodies) {
        if ((b.type !== 'planet' && b.type !== 'moon' && b.type !== 'gas') || b.heldBy >= 0 || b.kinematic) continue;
        const rel = this._w.subVectors(b.pos, ms.pos).setY(0);
        const r = rel.length();
        const ang = Math.atan2(rel.x * toHead.z - rel.z * toHead.x, rel.x * toHead.x + rel.z * toHead.z);
        const last = this.lastPluck.get(b);
        if (last !== undefined && Math.sign(last) !== Math.sign(ang) && Math.abs(ang) < 0.5) {
          const degree = Math.round(clamp(1 - (r - 0.05) / 0.3) * 9);
          a.pluck(b.pos, degree, b.type === 'moon' ? 0.4 : 0.8);
        }
        this.lastPluck.set(b, ang);
      }
    }
    void dt;
  }

  private onCosmosEvent(kind: string, body: Body) {
    if (kind === 'released') return;
    this.director.onCosmosEvent(kind, body);
  }

  private pushLights() {
    // Stars light the real room.
    for (const s of this.cosmos.stars) {
      let l = this.starLights.get(s);
      if (!l) {
        l = { position: s.pos, color: new Color(), intensity: 0, radius: 0.2 };
        this.starLights.set(s, l);
        this.lights.push(l);
      }
      const sv = s.star!;
      l.color.copy(sv.color);
      const lum = s.phase === 'dead' ? 0 : (s.luminosity ?? 1) * sv.brightness;
      l.intensity = this.inSurface ? 0 : 0.9 * lum + (s.phase === 'collapse' ? 2 : 0);
      l.radius = 0.11 + sv.radius * 2.2 + Math.sqrt(s.luminosity ?? 1) * 0.06;
    }
    for (const [s, l] of this.starLights) {
      if (!this.cosmos.bodies.includes(s)) {
        l.intensity = 0;
        this.starLights.delete(s);
        this.lights.splice(this.lights.indexOf(l), 1);
      }
    }
    const pos = receiverUniforms.uLightPos.value;
    const col = receiverUniforms.uLightCol.value;
    const sorted = this.lights.filter((l) => l.intensity > 0.001).sort((a, b) => b.intensity - a.intensity);
    const n = Math.min(sorted.length, MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const l = sorted[i];
      pos[i].set(l.position.x, l.position.y, l.position.z, l.radius);
      col[i].set(l.color.r, l.color.g, l.color.b, l.intensity);
    }
    receiverUniforms.uLightCount.value = n;
  }

  private updatePixelScale() {
    let h = this.renderer.domElement.height;
    if (this.inXR) {
      const cams = this.renderer.xr.getCamera().cameras;
      if (cams.length && cams[0].viewport) h = cams[0].viewport.w || h;
    }
    this.motes.setPixelScale(h * 0.5);
    this.ghosts.setScale(h * 0.5);
  }

  // ---------------------------------------------------------------- UI

  private updateUI(dt: number) {
    // Ghost hands live in the forge frame.
    this.ghosts.origin.copy(this.forge.position);
    this.ghosts.right3.set(1, 0, 0).applyQuaternion(this.forge.quaternion);
    this.ghosts.toward.set(0, 0, 1).applyQuaternion(this.forge.quaternion);
    // Fade the demo the moment the player is actively doing something.
    const busy = this.forgeHands.compress.active || this.forgeHands.grabbed.some((b) => !!b);
    this.ghosts.suppressed = busy || this.menu.isOpen;
    this.ghosts.update(dt);
    this.menu.update(dt, this.hands, this.head);
    if (this.panelTimer > 0) {
      this.panelTimer -= dt;
      if (this.panelTimer <= 0) this.panel.targetOpacity = 0;
    }
    this.panel.mesh.position.copy(this.forge.position).add(this.panelOffset.set(0, 0.3, 0).applyQuaternion(this.forge.quaternion));
    this.panel.update(dt, this.head);
  }

  showCodex() {
    const lines = DISCOVERIES.map((d) => (this.codex.found.has(d.id) ? `✦ ${d.title}` : '· · ·'));
    this.panel.setText(`DISCOVERIES  ${this.codex.count} / ${DISCOVERIES.length}\n\n${lines.join('\n')}`);
    this.panel.targetOpacity = 1;
    this.panelTimer = 9;
  }

  /** Re-place the forge: the player holds a palm flat where they want it. */
  requestMove() {
    this.movePending = true;
    this.ember.sayNow('Hold your palm flat where you want your forge.');
  }
  movePending = false;
  private moveHold = 0;
  private updateMove(dt: number) {
    if (!this.movePending) return;
    for (const h of this.hands.both) {
      if (!h.tracked) continue;
      const flat = h.normal.y < -0.85 && h.curl < 0.3 && h.speed < 0.08;
      if (flat) {
        this.moveHold += dt;
        if (this.moveHold > 1.2) {
          const p = h.palm.clone();
          p.y -= 0.03;
          const shift = p.clone().sub(this.forge.position);
          for (const b of this.cosmos.bodies) b.pos.add(shift);
          this.placeForge({ point: p, y: p.y, outline: null, label: 'palm', source: 'palm' });
          this.movePending = false;
          this.moveHold = 0;
          this.audio.play('chime', p);
        }
        return;
      }
    }
    this.moveHold = Math.max(0, this.moveHold - dt);
  }

  restart() {
    this.persist.clear();
    location.reload();
  }

  // ---------------------------------------------------------------- surface

  enterSurface(opts: SurfaceOptions) {
    loadSurface().then(({ SurfaceScene: S }) => {
      if (this.surfaceScene) {
        this.scene.remove(this.surfaceScene.group);
        this.surfaceScene.dispose();
      }
      this.surfaceScene = new S(opts);
      // Ground origin directly below the seated head.
      this.surfaceScene.group.position.set(this.head.x, this.head.y - 1.15, this.head.z);
      const yaw = Math.atan2(-this.headForward.x, -this.headForward.z);
      this.surfaceScene.group.rotation.set(0, yaw, 0);
      this.surfaceScene.setFade(0);
      this.scene.add(this.surfaceScene.group);
      this.inSurface = true;
      this.setForgeVisible(false);
      this.audio.loop('surf', undefined, { intensity: 0.7 });
    });
  }

  surfaceDawn(t: number, fade: number) {
    if (!this.surfaceScene) return;
    this.surfaceScene.setDawn(t);
    this.surfaceScene.setFade(fade);
  }

  exitSurface() {
    if (this.surfaceScene) {
      this.scene.remove(this.surfaceScene.group);
      this.surfaceScene.dispose();
      this.surfaceScene = null;
    }
    this.inSurface = false;
    this.setForgeVisible(true);
  }

  private setForgeVisible(v: boolean) {
    this.cosmos.group.visible = v;
    this.motes.points.visible = v;
    this.forge.visible = v;
    this.zoneRing.mesh.visible = v && this.zoneRing.opacity > 0.01;
  }

  private updateSurfaceScene(dt: number, time: number) {
    if (this.surfaceScene) this.surfaceScene.update(dt, time, this.head);
    // Keep the world body visible during the descent even though the forge hides.
    if (this.inSurface) this.cosmos.group.visible = false;
  }
}

export { smoothstep };
