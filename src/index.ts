import { createSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { Game } from './game/game';
import { setupLanding } from './ui/landing';

let game: Game | null = null;

/** One ECS system drives the whole experience each frame. */
class SunsmithSystem extends createSystem({}) {
  init() {
    game = new Game(this.world);
    (window as unknown as { sunsmith: Game }).sunsmith = game;
  }
  update(delta: number) {
    game?.update(delta, this.xrFrame ?? null);
  }
}

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(SunsmithSystem);
  setupLanding(world);
});
