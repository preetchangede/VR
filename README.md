# SUNSMITH

> **Forge suns between your palms. Build a world from their ashes. Then stand on it.**

A seated, hands-only mixed reality experience for **Meta Quest 3 / 3S**, built with Meta's **Immersive Web SDK** (WebXR). It opens instantly in the Meta Quest Browser: there's nothing to install.

Your real table opens like an iris onto deep space. Primordial hydrogen rises out of it. You sweep the glowing gas into your hands, press your palms together and **squeeze until it ignites into a star**, and that star lights your real table and your real hands. You build a giant, watch it swell past your fingers and die in a supernova that fills your room with newborn oxygen, carbon, silicon and iron. Its pulsar sweeps beams across your walls. You gather that stardust into a molten world, throw it into orbit, and watch it cool into oceans and life. Then your room burns away into space, and you're sitting on the shore of the world you made, watching your own sun rise.

Every atom of that world came from your hands. Every atom of you came from a star.

---

## How to play

- **Where:** sit at a table (any table works; with no table, hold your palm flat where you want the forge). About 10 minutes for the first journey, then an open sandbox that stays on your table.
- **How:** with your hands, end to end. Controllers are optional.

| Gesture | What it does |
|---|---|
| **Sweep** an open hand through gas or dust | Gathers it. It clings to your palm. |
| **Press your palms together** and hold | Squeezes. The cloud spins into a disk, heats from red to white, and **ignites**. |
| **Close one hand into a fist** (one-handed alternative) | Squeezes too. |
| **Pinch** a world, carry it, let go | Throws it into orbit. Orbit assist turns any reasonable throw into a stable orbit. |
| **Touch** a star / a living world | The star flares toward your finger; touching a world takes you there. |
| **Look at your open palm** | Opens the menu (poke with the other hand): codex, flash softening, music, move forge, restart. |

What you make depends on what and how much you squeeze. Too little hydrogen gives a gas giant (a failed star); more gives a red dwarf, a sun, a white star, or a blue giant that will go supernova. A little stardust makes a moon (and inside the Roche limit, rings); more makes a world whose fate is decided by its orbit: lava, ocean, or ice. Fifteen discoveries fill your codex.

## Built for Quest's mixed reality features

| Feature | How SUNSMITH uses it |
|---|---|
| **Hand tracking** (WebXR Hand Input) | Every verb: gather, squeeze, pinch-throw, poke, palm menu. Joint-accurate occlusion via IWSDK's skinned hand mesh. |
| **Passthrough** (`immersive-ar`) | The real room is the stage. A *relighting model* (below) lets virtual stars light the real room. |
| **Scene understanding** (plane + mesh detection) | Finds your table (semantic label `table`/`desk`), clips the light pool to its real outline, uses the Quest 3 room mesh for real-world occlusion, pulsar beams on your walls, and the room burn-away. |
| **Persistent anchors** | Your forge reappears on the same spot of the same table next session. Your saved universe has kept orbiting while you were away. |
| **Eyes + hands** | Look at a world and pinch to visit it. Uses the real eye-gaze input source where the device has one (Meta VR Glasses request `gaze-tracking`), and head gaze on Quest 3 / 3S. |

### The relighting model

Quest composites WebXR over passthrough as `display = rgb + (1 − alpha) · passthrough`. So anything that stands for a *real* surface (the room mesh, the table, your hands) is drawn as a **receiver**:

- `alpha` takes light *away* from the real world (the room dims as the cosmos awakens);
- receivers near a virtual star have their alpha lifted back, so **the real table, the real walls and your real palms are lit by the star you are holding**;
- `rgb` adds tinted glow, pulsar beams, and the ember edge when the room burns away into space;
- receivers write depth, so your couch occludes a nebula behind it and your hand occludes the star behind it.

## Tech

- **Immersive Web SDK** (`@iwsdk/core`) on three.js with **OCULUS_multiview**: one ECS system drives the experience. No post-processing, no full-screen passes.
- **Zero asset downloads.** Every visual is procedural (GLSL), every sound is synthesized (Web Audio, HRTF-spatialized), and the score is generative. It cold-starts in seconds.
- CPU-simulated motes (typed arrays, no per-frame allocation), game-tuned gravity with orbit assist, habitable-zone climate, and stellar evolution.
- **Comfort and accessibility:** seated, no locomotion, soft-flash mode on by default, one-handed squeeze, subtitles for every line, forgiving gestures, auto-assist if someone gets stuck, and nothing can be lost.

## Run it

```bash
npm install
npm run dev:runtime     # Vite dev server on https://localhost:8081 (self-signed HTTPS)
```

- **On a Quest:** open `https://<your-computer-ip>:8081` in the Meta Quest Browser (accept the local certificate) and tap **Begin**.
- **In a desktop browser:** the IWSDK dev plugin injects **IWER** (Meta's Immersive Web Emulation Runtime) on localhost, with a synthetic living room for scene understanding.

Production build: `npm run build` (output in `dist/`). Any static HTTPS host works (see [Deploy](#deploy)).

### Test and film without a headset

- `node tools/sim.mjs tools/scenarios/<scenario>.mjs` drives the app inside IWER in headless Chromium: it seats a player at the living-room table, choreographs hands (sweep, squeeze, pinch), and screenshots each beat.
- `node tools/film.mjs tools/shots/<shot>.mjs` does deterministic, frame-stepped capture for the trailer: every captured frame advances exactly 1/30 s.
- URL switches: `?beat=giant-life` (jump in the arc), `?fixed=30` (deterministic time), `?debug`, `?fresh` (ignore saved universe), `?nomesh`, `?noplanes`.

## Deploy

- **GitHub Pages:** in Settings → Pages, set Source to **GitHub Actions**. Every push to `main` then publishes via `.github/workflows/deploy-pages.yml`.
- **Vercel:** `npm run build && npx vercel deploy --prod`. Use the stable `*.vercel.app` alias as the judging link.

## Project map

```
src/
  index.ts            IWSDK World + the Sunsmith system
  game/               director (the arc), forge hand verbs, Ember guide, ghost hands, codex, persistence
  sim/                motes (gas/dust), cosmos (bodies, gravity, climate, evolution), stellar classes
  render/             receivers (relighting), well, star, planet, fx (supernova, pulsar, zone, trails)
  surface/            the dawn scene on your world
  audio/              procedural audio engine + generative score
  xr/                 hand tracking, room/table understanding
docs/
  CONCEPTS.md         the concepts we explored and why this one won
  DESIGN.md           the full design
  SUBMISSION.md       competition submission notes
tools/                emulator test harness, scenarios, film shots
```

Built for the Meta VR Start Developer Competition 2026.
