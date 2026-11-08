import { Color, Group, Vector3 } from '@iwsdk/core';
import { dampVec } from '../core/math';
import { Glow } from '../render/sprites';
import { TextPanel } from '../ui/text';

export interface Line {
  text: string;
  /** Seconds to hold after fully shown (default: by length). */
  hold?: number;
}

/**
 * THE EMBER — the last spark of a previous universe, and your guide.
 * A small living wisp that drifts beside the forge, speaks in subtitles, and
 * flies to whatever it wants you to look at.
 */
export class Ember {
  readonly group = new Group();
  readonly position = new Vector3();
  readonly target = new Vector3();
  private readonly core = new Glow({ color: new Color(1, 0.86, 0.6), core: 0.35, rays: 0.4, renderOrder: 60 });
  private readonly halo = new Glow({ color: new Color(1, 0.6, 0.3), core: 0, renderOrder: 59 });
  readonly subtitle = new TextPanel({ width: 0.3, aspect: 3.2, size: 58 });
  private queue: Line[] = [];
  private current: Line | null = null;
  private lineT = 0;
  visible = false;
  private fade = 0;
  /** Called when a line starts (for the voice sparkle sound). */
  onSpeak: (text: string) => void = () => {};
  /** Extra brightness when speaking. */
  private speakPulse = 0;
  /** Where subtitles sit, relative to the forge (set by the director). */
  readonly subtitleAnchor = new Vector3();
  private readonly _p = new Vector3();

  constructor() {
    this.group.add(this.halo.mesh, this.core.mesh, this.subtitle.mesh);
  }

  say(...lines: (string | Line)[]) {
    for (const l of lines) this.queue.push(typeof l === 'string' ? { text: l } : l);
  }

  /** Replace whatever is queued with new lines (interrupt). */
  sayNow(...lines: (string | Line)[]) {
    this.queue = [];
    this.current = null;
    this.say(...lines);
  }

  get speaking() {
    return !!this.current || this.queue.length > 0;
  }

  update(dt: number, time: number, head: Vector3) {
    this.fade += ((this.visible ? 1 : 0) - this.fade) * (1 - Math.exp(-dt * 3));
    // Drift toward the target with a lazy figure-eight bob.
    dampVec(this.position, this.target, 2.2, dt);
    const p = this._p.copy(this.position);
    p.x += Math.sin(time * 1.3) * 0.006;
    p.y += Math.sin(time * 2.1) * 0.008;
    p.z += Math.cos(time * 1.7) * 0.006;
    this.speakPulse = Math.max(0, this.speakPulse - dt * 1.5);
    const flicker = 0.85 + 0.15 * Math.sin(time * 17.0) * Math.sin(time * 7.3);
    const bright = this.fade * (0.9 + this.speakPulse * 0.8) * flicker;
    this.core.set(p, 0.009 + this.speakPulse * 0.003, bright * 1.1);
    this.halo.set(p, 0.028, bright * 0.3);
    this.core.tick(time);

    // Subtitles.
    if (!this.current && this.queue.length) {
      this.current = this.queue.shift()!;
      this.lineT = 0;
      this.subtitle.setText(this.current.text);
      this.subtitle.targetOpacity = 1;
      this.speakPulse = 1;
      this.onSpeak(this.current.text);
    }
    if (this.current) {
      this.lineT += dt;
      const hold = this.current.hold ?? 1.6 + this.current.text.length * 0.055;
      if (this.lineT > hold) {
        this.subtitle.targetOpacity = 0;
        if (this.lineT > hold + 0.45) this.current = null;
      }
    }
    this.subtitle.mesh.position.copy(this.subtitleAnchor);
    this.subtitle.update(dt, head);
  }
}
