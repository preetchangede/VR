/**
 * SUNSMITH audio: a fully procedural Web Audio engine (no samples, nothing downloaded).
 *
 *   const audio = new AudioEngine();
 *   button.onclick = () => { audio.unlock(); world.launchXR(); };   // and again on XR session start
 *   // every frame:
 *   audio.setListener(headPos, headForward, headUp);
 *
 * See engine.ts for the façade, core.ts for the graph, sfx.ts / loops.ts / score.ts for the
 * sound design. Everything synthesizes on any BaseAudioContext, so tools/preview/audio can
 * render the very same graph offline.
 */
export { AudioEngine } from './engine';
export type { LoopHandle, LoopName, Mood, SfxName } from './types';
export { LOOP_NAMES, MOODS, SFX_NAMES } from './types';
