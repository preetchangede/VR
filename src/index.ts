import { createSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { Game } from './game/game';
import { setupLanding } from './ui/landing';

let game: Game | null = null;
let frameErrors = 0;

/** One ECS system drives the whole experience each frame. */
class SunsmithSystem extends createSystem({}) {
  init() {
    game = new Game(this.world);
    (window as unknown as { sunsmith: Game }).sunsmith = game;
  }
  update(delta: number) {
    // An exception escaping here would stop the XR frame loop for good (the
    // next frame is only requested after this returns): log, and keep going.
    try {
      game?.update(delta, this.xrFrame ?? null);
    } catch (e) {
      if (frameErrors++ < 5) console.error('[sunsmith] frame error', e);
    }
  }
}

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(SunsmithSystem);
  setupLanding(world);
});
