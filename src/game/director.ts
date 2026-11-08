import { Color, Vector3 } from '@iwsdk/core';
import { clamp, easeInOut, lerp, smoothstep } from '../core/math';
import { params } from '../core/params';
import type { Body } from '../sim/cosmos';
import { COLLAPSE_HOLD, COLLAPSE_IN } from '../sim/cosmos';
import { Kind } from '../sim/motes';
import { GAS_GIANT_MAX, hzRadius } from '../sim/stellar';
import type { FormResult } from './forgeHands';
import type { Game } from './game';

export type BeatName =
  | 'wait-surface'
  | 'wake'
  | 'gather'
  | 'squeeze'
  | 'firstlight'
  | 'giant-gather'
  | 'giant-squeeze'
  | 'giant-life'
  | 'collapse'
  | 'remnant'
  | 'world-gather'
  | 'world-squeeze'
  | 'throw'
  | 'cooling'
  | 'life'
  | 'visit-prompt'
  | 'homecoming'
  | 'dawn'
  | 'return'
  | 'sandbox';

const H = 1 << Kind.Hydrogen;
const DUST = (1 << Kind.Oxygen) | (1 << Kind.Carbon) | (1 << Kind.Silicon) | (1 << Kind.Iron);

/** Forge-local anchor points (x right, y up, -z away from the player). */
export const SPOT = {
  sun: new Vector3(0, 0.17, 0),
  giant: new Vector3(0, 0.235, -0.2),
  ember: new Vector3(0.15, 0.2, 0.06),
  emberAside: new Vector3(0.2, 0.26, -0.02),
  subtitle: new Vector3(0, 0.035, 0.21),
  visit: new Vector3(0, 0.2, 0.12),
};

/**
 * The guided arc, beat by beat. Each beat sets up the world, teaches one
 * thing, watches for the player to do it (with hints and gentle auto-assist
 * so nobody gets stuck), then hands off to the next.
 */
const _toward = new Vector3();
const _side = new Vector3();

export class Director {
  beat: BeatName = 'wait-surface';
  t = 0;
  sun: Body | null = null;
  giant: Body | null = null;
  world: Body | null = null;
  private readonly g: Game;
  private hinted = new Set<string>();
  private lastHeldLog = 0;
  private visitFrom = new Vector3();
  private visitRadius = 0.03;
  private remnantColors: Color[] = [];
  /** Total motes offered in the current gather beat. */
  private offered = 0;
  private flags = new Set<string>();
  /** Sunrise speed multiplier (1 in play; faster for the trailer). */
  dawnSpeed = 1;
  /** Horizontal direction the dawn scene faces (set on arrival). */
  private readonly dawnForward = new Vector3(0, 0, -1);
  private readonly _f = new Vector3();
  private readonly _r = new Vector3();
  private readonly _u = new Vector3();
  private readonly _s = new Vector3();
  private readonly _v = new Vector3();

  constructor(game: Game) {
    this.g = game;
    game.forgeHands.onForm = (r) => this.onForm(r);
    game.forgeHands.onRelease = (b) => this.onRelease(b);
    game.forgeHands.onGrab = (b) => {
      if (b === this.world && this.world) this.world.kinematic = false;
      game.audio.play('chime', b.pos, { gain: 0.4, pitch: 1.5 });
    };
  }

  local(v: Vector3, out = new Vector3()) {
    return out.copy(v).applyMatrix4(this.g.forge.matrixWorld);
  }

  go(beat: BeatName) {
    if (params.debug) console.log(`[director] ${this.beat} -> ${beat}`);
    this.beat = beat;
    this.t = 0;
    this.hinted.clear();
    this.enter(beat);
  }

  private say(...lines: string[]) {
    this.g.ember.say(...lines);
  }

  private hint(id: string, after: number, cond: boolean, ...lines: string[]) {
    if (this.hinted.has(id) || this.t < after || !cond) return;
    this.hinted.add(id);
    this.g.ember.say(...lines);
  }

  private enter(beat: BeatName) {
    const g = this.g;
    const fh = g.forgeHands;
    switch (beat) {
      case 'wake':
        g.ember.visible = true;
        this.local(SPOT.ember, g.ember.position).add(new Vector3(0, 0.08, 0.05));
        this.local(SPOT.ember, g.ember.target);
        this.local(SPOT.subtitle, g.ember.subtitleAnchor);
        g.audio.setMood('void');
        g.dimTarget = 0.4;
        fh.allowSqueeze = false;
        fh.allowGrab = false;
        if (g.surface?.source === 'virtual') this.say("Hello, Sunsmith. I couldn't find a table, so I made you one.");
        else this.say('Hello, Sunsmith.');
        this.say('Before the first stars, the universe was dark.', "Let's open a well into the deep.");
        break;
      case 'gather':
        this.offered = 640;
        g.motes.emitFromWell(Kind.Hydrogen, this.offered, 6);
        g.motes.gatherMask = H;
        g.audio.setMood('nebula');
        g.ghosts.show('sweep');
        this.say('This is hydrogen, the first element.', 'Sweep it up with your open hands.');
        break;
      case 'squeeze':
        fh.allowSqueeze = true;
        fh.holdScale = 1;
        g.ghosts.show('squeeze');
        this.say('Now bring your hands together...', '...and squeeze. Hold it.');
        break;
      case 'firstlight':
        g.motes.gatherMask = 0;
        g.audio.setMood('forge');
        fh.allowSqueeze = false;
        g.dimTarget = 0.7;
        g.codex.discover('first-light');
        g.ghosts.show('none');
        g.menu.enabled = true;
        this.say('First light.', 'A sun is born. It will burn for ten billion years.', "But a sun alone can't build a world.", 'Worlds need iron and stone, and those are forged only inside giant stars.');
        break;
      case 'giant-gather':
        this.offered = 1700;
        g.motes.emitFromWell(Kind.Hydrogen, this.offered, 7);
        g.motes.gatherMask = H;
        fh.allowSqueeze = false;
        g.audio.setMood('giant');
        g.ghosts.show('sweep');
        this.say('Gather much more hydrogen.', "Let's make a giant.");
        break;
      case 'giant-squeeze':
        fh.allowSqueeze = true;
        fh.holdScale = 1.6;
        g.ghosts.show('squeeze');
        this.say('Squeeze with everything you have.', 'Hold it... hold it...');
        break;
      case 'giant-life':
        g.motes.gatherMask = 0;
        fh.allowSqueeze = false;
        g.ghosts.show('none');
        g.codex.discover('blue-giant');
        this.say('A blue giant. Ten thousand times brighter than your sun...', '...so it burns out young.', 'Watch. A million years, in a breath.');
        break;
      case 'collapse':
        if (this.giant) {
          this.giant.phase = 'collapse';
          this.giant.phaseT = 0;
          // Suck, silence, detonation: the collapse sound lasts the implosion,
          // everything else is silent until the supernova lands.
          g.audio.play('collapse', this.giant.pos, { size: 0.15 });
          g.audio.silence(COLLAPSE_IN + COLLAPSE_HOLD);
          g.ember.sayNow({ text: "It's collapsing...", hold: 1.2 });
        }
        break;
      case 'remnant':
        g.audio.setMood('remnant');
        break;
      case 'world-gather':
        this.offered = Math.max(400, g.motes.freeCount);
        g.motes.gatherMask = DUST;
        fh.allowSqueeze = false;
        g.ghosts.show('sweep');
        this.say('Gather the stardust.', "Let's shape a world.");
        break;
      case 'world-squeeze':
        fh.allowSqueeze = true;
        fh.holdScale = 1;
        g.ghosts.show('squeeze');
        this.say('Now press it together.');
        break;
      case 'throw':
        g.motes.gatherMask = 0;
        fh.allowSqueeze = false;
        fh.allowGrab = true;
        g.zoneRing.target = 1;
        g.codex.discover('molten-world');
        g.ghosts.show('pinch');
        this.say('A molten world. Now give it an orbit.', 'Pinch it, carry it to the green ring, and let go.');
        break;
      case 'cooling':
        g.zoneRing.target = 0.25;
        g.cosmos.evolutionRate = 1.4;
        g.audio.setMood('world');
        g.ghosts.show('none');
        this.say("It's cooling.", 'Steam rises, and rains for a thousand years...');
        break;
      case 'life':
        g.codex.discover('living-world');
        g.audio.play('life-bloom', this.world?.pos);
        this.say('Life.', 'On a world you made.');
        break;
      case 'visit-prompt':
        g.ghosts.show('touch');
        this.say('Would you like to stand on it?', 'Reach out and touch it.');
        g.prepareSurface(this.surfaceOptions());
        break;
      case 'homecoming':
        // A world still pinched is let go first: the cutscene owns it now.
        fh.dropAll();
        if (this.world) {
          this.visitFrom.copy(this.world.pos);
          this.visitRadius = this.world.radius;
          this.world.kinematic = true;
          this.world.vel.set(0, 0, 0);
        }
        fh.allowGrab = false;
        g.ember.sayNow();
        g.ghosts.show('none');
        g.audio.play('burn-away');
        g.audio.setMood('dawn');
        g.codex.discover('homecoming');
        break;
      case 'dawn':
        g.enterSurface(this.surfaceOptions());
        this.dawnForward.set(g.headForward.x, 0, g.headForward.z).normalize();
        g.ember.subtitleAnchor.copy(g.head).addScaledVector(this.dawnForward, 0.62).add(new Vector3(0, -0.24, 0));
        break;
      case 'return':
        this.flags.add('arc');
        g.audio.play('return');
        g.audio.setMood('sandbox');
        break;
      case 'sandbox':
        g.menu.enabled = true;
        this.local(SPOT.ember, g.ember.target);
        this.local(SPOT.subtitle, g.ember.subtitleAnchor);
        g.persist.save();
        g.motes.gatherMask = H | DUST;
        fh.allowSqueeze = true;
        fh.allowGrab = true;
        fh.holdScale = 1;
        g.cosmos.orbitAssist = 0.55;
        g.cosmos.evolutionRate = 1;
        g.zoneRing.target = 0;
        if (!g.persist.hasFinishedArc || this.flags.has('arc')) {
          g.ghosts.show('palm');
          g.after(9, () => g.ghosts.show('none'));
          this.say('Your forge is yours now.', 'Make anything. Your universe will wait for you, right here on this table.', 'Turn your palm toward you any time for the menu.');
        }
        break;
    }
  }

  private noHandsT = 0;
  private handsHintAt = -100;
  /** If no hands are seen during a gesture beat, ask for them (once in a while). */
  private handsWatchdog(dt: number) {
    const g = this.g;
    const gestureBeat = ['gather', 'squeeze', 'giant-gather', 'giant-squeeze', 'world-gather', 'world-squeeze', 'throw'].includes(this.beat);
    const L = g.hands.left;
    const R = g.hands.right;
    const anyHand = (L.tracked && !L.isController) || (R.tracked && !R.isController);
    const controllers = (L.tracked && L.isController) || (R.tracked && R.isController);
    this.noHandsT = gestureBeat && !anyHand ? this.noHandsT + dt : 0;
    if (this.noHandsT > 6 && g.clock.realTime - this.handsHintAt > 25) {
      if (controllers) {
        // Controllers work too; suggest hands just once.
        if (this.flags.has('ctrl-hint')) return;
        this.flags.add('ctrl-hint');
      }
      this.handsHintAt = g.clock.realTime;
      g.ember.sayNow(controllers ? 'Set your controllers down. Your hands are all you need.' : 'Raise your hands where I can see them.');
    }
  }

  update(dt: number) {
    this.t += dt;
    const g = this.g;
    this.handsWatchdog(dt);
    const m = g.motes;
    const held = m.heldCount[0] + m.heldCount[1];
    if (params.debug && g.clock.realTime - this.lastHeldLog > 2) {
      this.lastHeldLog = g.clock.realTime;
      console.log(`[director] ${this.beat} t=${this.t.toFixed(1)} held=${held} free=${m.freeCount} comp=${m.compressCount} rem=${m.remnantCount}`);
    }
    switch (this.beat) {
      case 'wait-surface':
        if (!g.surface) break;
        if (g.persist.hasFinishedArc && !params.beat) this.welcomeBack();
        else this.go('wake');
        break;
      case 'wake':
        if (params.beat && this.t > 0.3) {
          g.ember.sayNow();
          this.skipTo(params.beat as BeatName);
          break;
        }
        if (this.t > 2.2 && g.well.open === 0) g.audio.play('well-open', g.forge.position);
        if (this.t > 2.2) g.well.open = clamp(g.well.open + dt / 2.8);
        if (this.t > 2.2) g.dimTarget = 0.56;
        if (this.t > 5 && !g.ember.speaking) {
          if (params.beat) this.skipTo(params.beat as BeatName);
          else this.go('gather');
        }
        break;
      case 'gather': {
        if (held > 60) g.ghosts.show('none');
        const need = this.offered * 0.82;
        this.hint('slow', 16, held < 80, 'Move your open hands slowly through the glowing gas.');
        this.hint('more', 30, held < need, 'A little more...');
        if (held >= need || (held >= this.offered * 0.55 && this.t > 40) || this.t > 75) this.go('squeeze');
        break;
      }
      case 'squeeze':
        this.hint('how', 14, !g.forgeHands.compress.active, 'Press your palms toward each other, as if packing a snowball.');
        this.hint('fist', 28, !g.forgeHands.compress.active, 'Or slowly close one hand into a fist.');
        this.assistIgnite(60);
        break;
      case 'firstlight':
        if (this.sun) this.glide(this.sun, SPOT.sun, dt, 1.4);
        if (this.t > 2.6 && !this.hinted.has('title')) {
          this.hinted.add('title');
          g.titleDrop();
        }
        if (this.t > 4 && !g.ember.speaking) this.go('giant-gather');
        break;
      case 'giant-gather': {
        if (held > 120) g.ghosts.show('none');
        const need = this.offered * 0.78;
        this.hint('more', 25, held < need, 'Keep gathering. Giants are hungry.');
        if (held >= need || (held >= this.offered * 0.5 && this.t > 40) || this.t > 75) this.go('giant-squeeze');
        break;
      }
      case 'giant-squeeze':
        this.hint('how', 16, !g.forgeHands.compress.active, 'Both hands. Press it together and hold.');
        this.assistIgnite(60);
        break;
      case 'giant-life':
        if (this.giant) {
          this.glide(this.giant, SPOT.giant, dt, 1.0);
          if (this.t > 9 && this.giant.phase === 'main') {
            this.giant.phase = 'swelling';
            this.giant.phaseT = 0;
            g.ember.target.copy(this.local(SPOT.emberAside));
            this.say("It's running out of fuel... swelling into a red supergiant.", 'Go on. Reach inside it.');
          }
          if (this.giant.phase === 'supergiant' && (this.giant.phaseT ?? 0) > 6) this.go('collapse');
        }
        break;
      case 'collapse':
        // The 'collapsed' cosmos event triggers the supernova (see onCosmosEvent).
        if (this.flags.has('supernova') && this.t > 6 && !g.ember.speaking) this.go('remnant');
        break;
      case 'remnant':
        m.homeward = clamp(this.t / 6);
        if (this.t > 5 && m.remnantCount < 120) {
          m.homeward = 0;
          this.go('world-gather');
        }
        this.hint('falling', 2, true, 'The stardust is falling back to your forge.');
        break;
      case 'world-gather': {
        if (held > 60) g.ghosts.show('none');
        this.offered = Math.max(this.offered, held + m.freeCount);
        const need = Math.min(this.offered * 0.7, 1100);
        this.hint('more', 25, held < need, 'Sweep up the colored dust.');
        if (held >= need || (held >= 350 && this.t > 35) || this.t > 75) this.go('world-squeeze');
        break;
      }
      case 'world-squeeze':
        this.hint('how', 15, !g.forgeHands.compress.active, 'Bring your hands together, and squeeze.');
        this.assistIgnite(60);
        break;
      case 'throw': {
        const w = this.world;
        if (!w) break;
        if (w.kinematic && w.heldBy < 0) {
          // Hovering where it was born, slowly turning.
          w.vel.set(0, 0, 0);
          g.ghosts.target.copy(w.pos);
          const sun = g.cosmos.mainStar();
          if (sun) {
            const toward = _toward.subVectors(g.head, sun.pos).setY(0).normalize();
            const side = _side.set(toward.z, 0, -toward.x);
            g.ghosts.target2.copy(sun.pos).addScaledVector(toward.multiplyScalar(0.5).add(side).normalize(), hzRadius(sun.luminosity ?? 1));
          }
        }
        this.hint('pinch', 22, w.kinematic, 'Pinch it between your thumb and finger.');
        if (w.kinematic && this.t > 45 && !this.flags.has('auto-throw')) {
          this.flags.add('auto-throw');
          this.say('Let me help.');
          this.autoOrbit(w);
        }
        break;
      }
      case 'cooling': {
        const w = this.world;
        if (w?.living) this.go('life');
        if (w && !w.inHZ && this.t > 6 && !this.hinted.has('zone')) {
          this.hinted.add('zone');
          this.say((w.climate ?? 1) > 1 ? 'Too hot there. Try a little farther out.' : 'Too cold there. Bring it a little closer.');
          g.zoneRing.target = 1;
          g.ghosts.show('pinch');
        }
        if (w && w.inHZ && this.hinted.has('zone') && !this.hinted.has('zone-ok')) {
          this.hinted.add('zone-ok');
          g.ghosts.show('none');
          g.zoneRing.target = 0.25;
          this.say('Just right.');
        }
        // Never strand anyone: after a while, guide the world home ourselves.
        if (w && !w.inHZ && w.heldBy < 0 && this.t > 40 && !this.flags.has('auto-zone')) {
          this.flags.add('auto-zone');
          this.say('Let me help.');
          this.autoOrbit(w);
          g.ghosts.show('none');
        }
        break;
      }
      case 'life':
        if (this.t > 5 && !g.ember.speaking) this.go('visit-prompt');
        break;
      case 'visit-prompt': {
        const w = this.world;
        if (!w) break;
        w.highlight = 0.5 + 0.5 * Math.sin(this.t * 3.0);
        g.ghosts.target.copy(w.pos);
        const touched = g.forgeHands.poked?.body === w;
        const gazed = g.gazePinch(w.pos, w.radius + 0.03);
        this.hint('gaze', 22, true, 'Or simply look at it, and pinch.');
        if (((touched || gazed) && this.t > 1.5) || this.t > 80) {
          w.highlight = 0;
          this.go('homecoming');
        }
        break;
      }
      case 'homecoming':
        this.updateHomecoming(dt);
        break;
      case 'dawn':
        this.updateDawn();
        break;
      case 'return':
        this.updateReturn();
        break;
      case 'sandbox':
        this.updateSandbox(dt);
        break;
    }
  }

  /** If the gesture just isn't happening, help: ignite for the player. */
  private assistIgnite(after: number) {
    const g = this.g;
    if (this.t < after || g.forgeHands.compress.active || this.hinted.has('assist')) return;
    this.hinted.add('assist');
    g.ember.sayNow('Let me help.');
    g.forgeHands.forceIgnite(g.hands, g.motes, this.local(SPOT.sun));
  }

  /** Ease a kinematic body toward a forge-local spot. */
  private glide(b: Body, spot: Vector3, dt: number, speed: number) {
    const target = this.local(spot);
    b.pos.lerp(target, 1 - Math.exp(-speed * dt));
  }

  private autoOrbit(w: Body) {
    const sun = this.g.cosmos.mainStar();
    if (!sun) return;
    const hz = hzRadius(sun.luminosity ?? 1);
    const dir = new Vector3().subVectors(this.g.head, sun.pos);
    dir.y = 0;
    dir.setLength(hz);
    w.pos.copy(sun.pos).add(dir);
    w.kinematic = false;
    this.g.cosmos.release(w, new Vector3());
    this.onRelease(w);
  }

  onForm(r: FormResult) {
    const g = this.g;
    const beat = this.beat;
    const isGas = r.hydrogen > 0.6;
    g.flash(0.45);
    g.motes.sparks(r.at, 140, 0.6);
    if (!isGas || r.mass >= GAS_GIANT_MAX || beat === 'squeeze' || beat === 'giant-squeeze') {
      g.lightWave(r.at, new Color(1, 0.82, 0.55), 1.4, 1.6, 2.2);
    }
    if (beat === 'squeeze') {
      this.sun = g.cosmos.addStar(r.at, 1.0);
      g.audio.play('ignite', r.at, { size: 0.6 });
      g.audio.play('star-born', r.at);
      this.go('firstlight');
      return;
    }
    if (beat === 'giant-squeeze') {
      this.giant = g.cosmos.addStar(r.at, 3.0);
      g.flash(0.7);
      g.audio.play('ignite', r.at, { size: 1 });
      g.audio.play('star-born', r.at, { pitch: 1.25 });
      this.go('giant-life');
      return;
    }
    if (beat === 'world-squeeze') {
      const dust = this.dustTint(r.elements);
      this.world = g.cosmos.addPlanet(r.at, Math.max(r.mass, 0.6), 'planet', this.mix(r.elements), dust);
      this.world.kinematic = true;
      g.audio.play('planet-form', r.at);
      this.go('throw');
      return;
    }
    // Sandbox: what you squeezed decides what is born.
    this.makeRoom();
    if (isGas) {
      if (r.mass < GAS_GIANT_MAX) {
        const b = g.cosmos.addPlanet(r.at, r.mass, 'gas');
        b.kinematic = true;
        g.codex.discover('failed-star');
        g.audio.play('gas-giant', r.at);
        g.ember.sayNow('Not quite enough to ignite. A gas giant, a failed star.');
      } else {
        const s = g.cosmos.addStar(r.at, r.mass, true);
        g.audio.play('ignite', r.at, { size: clamp(r.mass / 3) });
        g.audio.play('star-born', r.at);
        if (s.spec!.cls === 'red-dwarf') g.codex.discover('red-dwarf');
        if (s.spec!.cls === 'blue-giant') {
          g.codex.discover('blue-giant');
          s.flags.add('mortal');
        }
        g.ember.sayNow(`${s.spec!.name}.`);
      }
    } else {
      const moon = r.mass < 0.25;
      const b = g.cosmos.addPlanet(r.at, r.mass, moon ? 'moon' : 'planet', this.mix(r.elements), this.dustTint(r.elements));
      b.kinematic = true;
      g.audio.play('planet-form', r.at, { size: moon ? 0.3 : 0.8 });
      if (!moon) g.codex.discover('molten-world');
    }
  }

  /**
   * Sandbox systems stay readable (and inside the GPU budget): past 14 bodies,
   * the oldest small body (never your sun or your world) dissolves to make room.
   */
  private makeRoom() {
    const g = this.g;
    let n = 0;
    for (const b of g.cosmos.bodies) if (b.type !== 'pulsar') n++;
    if (n < 14) return;
    let pick: Body | null = null;
    for (const pass of [false, true]) {
      for (const b of g.cosmos.bodies) {
        if (b === this.world || b === this.sun || b.heldBy >= 0 || b.type === 'pulsar') continue;
        if ((b.type === 'star') !== pass) continue;
        if (b.type === 'star' && b.phase !== 'main') continue;
        if (!pick || b.age > pick.age) pick = b;
      }
      if (pick) break;
    }
    if (!pick) return;
    g.motes.sparks(pick.pos, 60, 0.4, Kind.Iron);
    g.cosmos.remove(pick);
  }

  private onRelease(b: Body) {
    const g = this.g;
    g.audio.play('throw', b.pos);
    b.kinematic = false;
    if (b === this.world && this.beat === 'throw') {
      // Give the orbit a moment to settle, then judge the climate.
      g.after(2.5, () => {
        if (this.beat === 'throw' && this.world && this.world.heldBy < 0) this.go('cooling');
      });
    }
  }

  onCosmosEvent(kind: string, body: Body) {
    const g = this.g;
    switch (kind) {
      case 'collapsed':
        this.supernova(body);
        break;
      case 'ocean-world':
        g.codex.discover('ocean-world');
        g.audio.play('ocean-form', body.pos);
        if (this.beat === 'cooling') this.say('Oceans.');
        break;
      case 'lava-world':
        g.codex.discover('lava-world');
        break;
      case 'ice-world':
        g.codex.discover('ice-world');
        break;
      case 'life':
        g.audio.play('life-bloom', body.pos);
        if (this.beat === 'sandbox') g.codex.discover('living-world');
        break;
      case 'rings':
        g.codex.discover('rings');
        g.audio.play('ring-shatter', body.pos);
        break;
      case 'impact':
        g.audio.play('impact', body.pos);
        g.motes.sparks(body.pos, 90, 0.5, Kind.Iron);
        break;
      case 'moon-born':
        g.codex.discover('moon');
        break;
    }
  }

  private supernova(giant: Body) {
    const g = this.g;
    const at = giant.pos.clone();
    this.flags.add('supernova');
    g.flash(1.0);
    g.shockwave.fire(at);
    g.lightWave(at, new Color(0.7, 0.85, 1.0), 2.4, 1.45, 4.5);
    g.motes.ejecta(at, 2700);
    g.audio.play('supernova', at, { size: 1 });
    g.audio.setMood('supernova');
    g.dimTarget = 0.86;
    g.pulsar.group.position.copy(at);
    g.pulsarOn = true;
    g.codex.discover('supernova');
    g.codex.discover('pulsar');
    this.remnantColors = [new Color(0.25, 0.92, 0.8), new Color(1.0, 0.47, 0.22), new Color(0.68, 0.55, 1.0), new Color(1.0, 0.78, 0.4)];
    g.after(2.6, () => {
      g.ember.say('Supernova.', 'Oxygen. Carbon. Silicon. Iron. All of it, made just now.', 'Every atom of iron in your blood was born in a moment like this.');
    });
    if (this.beat !== 'collapse') {
      // Sandbox supernova: the stardust drifts home, and the music settles back.
      g.after(9, () => (g.motes.homeward = 1));
      g.after(16, () => {
        if (this.beat === 'sandbox') g.audio.setMood('sandbox');
      });
    }
  }

  private dustTint(el: number[]) {
    const c = new Color(0, 0, 0);
    const cols = [new Color(0.25, 0.92, 0.8), new Color(1.0, 0.78, 0.4), new Color(0.68, 0.55, 1.0), new Color(1.0, 0.47, 0.22)];
    const total = el.reduce((a, b) => a + b, 0) || 1;
    el.forEach((n, i) => c.add(cols[i].clone().multiplyScalar(n / total)));
    return c;
  }
  private mix(el: number[]) {
    const total = el.reduce((a, b) => a + b, 0) || 1;
    return el.map((n) => n / total);
  }

  private surfaceOptions() {
    const sun = this.sun ?? this.g.cosmos.mainStar();
    const w = this.world;
    return {
      sunColor: sun?.color?.clone() ?? new Color(1, 0.9, 0.75),
      sunSize: sun?.spec ? sun.spec.radius / 0.024 : 1,
      oceanColor: new Color(0.03, 0.18, 0.28),
      landColor: (w?.look?.dustTint ?? new Color(0.5, 0.4, 0.35)).clone().lerp(new Color(0.32, 0.27, 0.24), 0.65),
      lifeColor: new Color(0.25, 0.72, 0.45),
      lifeAmount: w?.look?.life ?? 0.8,
      hasMoon: this.g.cosmos.bodies.some((b) => b.type === 'moon'),
      moonPhase: 0.35,
      nebulaColors: this.remnantColors.length ? this.remnantColors : [new Color(0.25, 0.92, 0.8), new Color(1.0, 0.47, 0.22)],
      hasRings: (w?.look?.rings ?? 0) > 0.2,
      seed: w?.look?.seed ?? 7,
    };
  }

  private updateHomecoming(dt: number) {
    const g = this.g;
    const t = this.t;
    const w = this.world;
    // The room burns away from the forge outward.
    const burn = smoothstep(0.6, 5.2, t);
    g.setBurn(g.forge.position, burn * 6.5);
    g.dimTarget = 1;
    if (w && w.look && w.planet) {
      // The world drifts toward you, grows, then rises to meet you.
      const visit = this.local(SPOT.visit);
      const a = easeInOut(clamp(t / 3.5));
      w.pos.lerpVectors(this.visitFrom, visit, a);
      const grow = smoothstep(3.6, 7.0, t);
      const r = lerp(lerp(this.visitRadius, 0.07, a), 4.0, grow * grow * grow);
      w.look.radius = r;
      w.planet.setLook({ radius: r });
      // Sink its center so its surface rises toward the viewer's feet.
      w.pos.y -= r * 1.02 * smoothstep(4.2, 7.0, t);
      w.pos.z += 0;
    }
    // Through the clouds: the view whites out, then dawn fades up.
    g.fader.level = smoothstep(6.2, 7.3, t);
    if (t > 7.6) this.go('dawn');
    void dt;
  }

  private updateDawn() {
    const g = this.g;
    const t = this.t;
    g.surfaceDawn(clamp(0.05 + (t * this.dawnSpeed) / 70), 1);
    g.fader.level = 1 - smoothstep(0.3, 2.6, t);
    const say = (at: number, text: string, hold?: number) => {
      if (t >= at && !this.hinted.has(text)) {
        this.hinted.add(text);
        g.ember.say(hold ? { text, hold } : text);
      }
    };
    // The Ember choreographs the player's gaze: world, sun, sky, then home.
    const fwd = this._f.set(g.headForward.x, 0, g.headForward.z).normalize();
    if (fwd.lengthSq() < 0.5) fwd.set(0, 0, -1);
    const right = this._r.set(-fwd.z, 0, fwd.x);
    const up = this._u.set(0, 1, 0);
    const toSun = this._s.copy(this.dawnForward).applyAxisAngle(up, 0.26).normalize();
    const e = g.ember.target;
    if (t < 8) e.copy(g.head).addScaledVector(fwd, 0.5).addScaledVector(up, -0.12).addScaledVector(right, 0.1);
    else if (t < 15) e.copy(g.head).addScaledVector(toSun, 1.1).addScaledVector(up, 0.06);
    else if (t < 25) e.copy(g.head).addScaledVector(this.dawnForward, 0.6).addScaledVector(up, 0.85);
    else e.copy(g.head).addScaledVector(fwd, 0.45).addScaledVector(up, -0.14).addScaledVector(right, 0.12);
    // Subtitles ride low in the view, gently following the head.
    const sub = this._v.copy(g.head).addScaledVector(fwd, 0.62).addScaledVector(up, -0.24);
    g.ember.subtitleAnchor.lerp(sub, 1 - Math.exp(-2.5 * g.clock.realDt));
    say(3, 'Your world.');
    say(9, 'Your sun.');
    say(16, 'Above you, the ashes of your giant, still glowing.');
    say(26, 'Every atom of this world was forged by your hands.');
    say(34, 'And every atom of you was forged in a star.');
    say(43, 'Welcome home, Sunsmith.', 4);
    say(58, 'When you are ready, look at me and pinch to return.', 6);
    // Pinch it directly, or simply look at it and pinch (as with visiting the world).
    const pinchedEmber = g.pinchNear(g.ember.position, 0.07) || g.gazePinch(g.ember.position, 0.06);
    if ((t > 50 && pinchedEmber) || t > 110) this.go('return');
  }

  private updateReturn() {
    const g = this.g;
    const t = this.t;
    // Fade into deep space, swap scenes behind the fade, then the room
    // rebuilds itself from the far walls inward.
    g.fader.setColor(0.006, 0.008, 0.02);
    g.fader.level = smoothstep(0, 1.0, t) * (1 - smoothstep(1.3, 2.4, t));
    if (t > 1.1 && g.inSurface) {
      g.exitSurface();
      g.dimTarget = 1;
    }
    const burn = 1 - smoothstep(2.0, 5.6, t);
    g.setBurn(g.forge.position, burn * 6.5);
    const w = this.world;
    if (w && w.look && w.planet) {
      // Restore the world to its true size while the view is fully faded.
      const r = t < 1.0 ? 4.0 : this.visitRadius;
      w.look.radius = r;
      w.planet.setLook({ radius: r });
      if (t < 3.4) w.pos.copy(this.visitFrom);
      else if (w.kinematic) {
        w.kinematic = false;
        g.cosmos.release(w, new Vector3());
      }
    }
    if (t > 5.8) {
      g.setBurn(g.forge.position, 0);
      g.fader.setColor(1, 0.97, 0.92);
      g.dimTarget = 0.6;
      this.go('sandbox');
    }
  }

  private updateSandbox(dt: number) {
    const g = this.g;
    // Keep the forge supplied: hydrogen for stars, and a trickle of stardust
    // (oxygen, carbon, silicon, iron) for worlds and moons.
    if (g.motes.freeCount < 260 && this.t > 3 && !this.flags.has('refill')) {
      this.flags.add('refill');
      g.motes.emitFromWell(Kind.Hydrogen, 520, 5);
      g.after(8, () => this.flags.delete('refill'));
    }
    if (this.t > 6 && !this.flags.has('dust')) {
      this.flags.add('dust');
      let dust = 0;
      for (let i = 0; i < g.motes.capacity; i++) if (g.motes.state[i] === 1 && g.motes.kind[i] !== Kind.Hydrogen) dust++;
      if (dust < 90) for (const k of [Kind.Oxygen, Kind.Carbon, Kind.Silicon, Kind.Iron]) g.motes.emitFromWell(k, 55, 4);
      g.after(20, () => this.flags.delete('dust'));
    }
    // Giants made in the sandbox live fast and die spectacularly.
    for (const s of g.cosmos.stars) {
      if (!s.flags.has('mortal')) continue;
      if (s.phase === 'main' && s.age > 15) {
        s.phase = 'swelling';
        s.phaseT = 0;
      } else if (s.phase === 'supergiant' && (s.phaseT ?? 0) > 5) {
        s.phase = 'collapse';
        s.phaseT = 0;
        g.audio.play('collapse', s.pos, { size: 0.15 });
        g.audio.silence(COLLAPSE_IN + COLLAPSE_HOLD);
      }
    }
    // Binary detection.
    const live = g.cosmos.stars;
    if (live.length >= 2) {
      for (let i = 0; i < live.length; i++)
        for (let j = i + 1; j < live.length; j++)
          if (live[i].phase === 'main' && live[j].phase === 'main' && live[i].pos.distanceTo(live[j].pos) < 0.14) g.codex.discover('binary');
    }
    void dt;
  }

  remnantPalette() {
    return this.remnantColors;
  }
  setRemnantPalette(c: Color[]) {
    this.remnantColors = c;
  }

  /** A returning Sunsmith: restore their universe and go straight to the sandbox. */
  private welcomeBack() {
    const g = this.g;
    g.well.open = 1;
    const n = g.persist.restore();
    g.ember.visible = true;
    this.local(SPOT.ember, g.ember.position);
    this.local(SPOT.ember, g.ember.target);
    this.local(SPOT.subtitle, g.ember.subtitleAnchor);
    g.dimTarget = 0.6;
    g.menu.enabled = true;
    this.go('sandbox');
    g.ember.sayNow(
      'Welcome back, Sunsmith.',
      n > 1 ? 'Your worlds kept turning while you were away.' : 'Your forge kept burning while you were away.',
    );
    const away = g.persist.awaySeconds;
    if (away > 3600) g.ember.say(`It has been ${Math.round(away / 3600)} hours. For your worlds, a few billion years.`);
  }

  /** Jump into the arc for testing (?beat=...), creating prerequisites. */
  private skipTo(beat: BeatName) {
    const g = this.g;
    g.well.open = 1;
    const after = (b: BeatName) => {
      const order: BeatName[] = ['gather', 'squeeze', 'firstlight', 'giant-gather', 'giant-squeeze', 'giant-life', 'collapse', 'remnant', 'world-gather', 'world-squeeze', 'throw', 'cooling', 'life', 'visit-prompt', 'homecoming', 'dawn', 'sandbox'];
      return order.indexOf(beat) > order.indexOf(b);
    };
    if (after('firstlight')) {
      this.sun = g.cosmos.addStar(this.local(SPOT.sun), 1.0);
      g.dimTarget = 0.62;
    }
    if (after('giant-life') && !after('collapse')) {
      this.giant = g.cosmos.addStar(this.local(SPOT.giant), 3.0);
    }
    if (after('collapse')) {
      g.pulsar.group.position.copy(this.local(SPOT.giant));
      g.pulsarOn = true;
      this.flags.add('supernova');
      this.remnantColors = [new Color(0.25, 0.92, 0.8), new Color(1.0, 0.47, 0.22), new Color(0.68, 0.55, 1.0), new Color(1.0, 0.78, 0.4)];
    }
    if (beat === 'world-gather') {
      for (const k of [Kind.Oxygen, Kind.Carbon, Kind.Silicon, Kind.Iron]) g.motes.emitFromWell(k, 320, 4);
    }
    if (after('throw') && this.sun) {
      const p = this.sun.pos.clone().add(new Vector3(0, 0, hzRadius(1)));
      this.world = g.cosmos.addPlanet(p, 1.2, 'planet', [0.3, 0.2, 0.3, 0.2]);
      g.cosmos.release(this.world, new Vector3());
      if (after('cooling')) {
        this.world.cooled = 1;
        this.world.look!.life = after('life') ? 0.9 : 0;
        this.world.living = after('life');
      }
    }
    if (beat === 'giant-life' && !this.giant) this.giant = g.cosmos.addStar(this.local(SPOT.giant), 3.0);
    if (beat === 'throw' && !this.world) {
      // The freshly forged world hovers where the squeeze left it, waiting to be thrown.
      this.world = g.cosmos.addPlanet(this.local(new Vector3(0, 0.2, 0.12)), 1.0, 'planet', [0.3, 0.2, 0.3, 0.2]);
      this.world.kinematic = true;
    }
    this.go(beat);
  }
}
