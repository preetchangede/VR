import { params } from './params';

/**
 * Game clock. Real time by default (clamped so a hitch never explodes the
 * simulation); with `?fixed=N` every frame advances exactly 1/N s, which makes
 * emulator tests reproducible and lets the trailer render offline at any speed.
 */
export class Clock {
  /** Seconds since start (game time, affected by timeScale). */
  time = 0;
  /** Seconds since start, never scaled (for UI / audio sync). */
  realTime = 0;
  dt = 0;
  realDt = 0;
  timeScale = 1;
  frame = 0;

  tick(deltaSeconds: number) {
    const raw = params.fixedDt > 0 ? params.fixedDt : Math.min(Math.max(deltaSeconds, 0), 0.1);
    this.realDt = raw;
    this.realTime += raw;
    this.dt = raw * this.timeScale;
    this.time += this.dt;
    this.frame++;
  }
}

export const clock = new Clock();
