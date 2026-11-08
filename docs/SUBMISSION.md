# Devpost submission: SUNSMITH

Everything the submission form asks for, ready to paste. Check these against the live Devpost form and Official Rules before submitting.

**Deadline:** Wednesday, November 18, 2026, 12:00 PM PT. Don't change the app after the deadline.

## Checklist

- [ ] The submitter is a **Meta VR Start** member with Developer Access enabled. Membership can take more than 24 hours to show, so apply early.
- [ ] The app is deployed to a public HTTPS URL (GitHub Pages or Vercel; see README → Deploy), and that URL opens it in the Meta Quest Browser on a Quest 3 / 3S.
- [ ] The full experience has been played once on a real Quest 3 or 3S, with hands only:
  - placement on a real table
  - gather and squeeze
  - supernova
  - throw into orbit
  - visit the world
  - return
  - relaunch, and check that "welcome back" restores the forge
- [ ] Space Setup is done on the test headset. Without it there are no planes, so the forge falls back to the palm-placement and virtual-table path; check that too.
- [ ] The demo video (under 3 minutes, real footage from device or emulator) is uploaded **publicly** to YouTube or Vimeo. The trailer is `film-out/sunsmith-trailer.mp4` (90 s, 1080p30; see Video below); it is not committed to git, and `tools/trailer/` rebuilds it.
- [ ] Track and division are chosen (see below).
- [ ] The app stays online and free until winners are announced (about December 11, 2026).

## Name

SUNSMITH

## Tagline (140 characters max)

> Forge suns between your palms on your real table. Build a world from their ashes. Then stand on it. Hands-only mixed reality for Quest.

(135 characters)

## Track and division

- **Division:** New Experience. All of the code was written during the submission window.
- **Track:** **Gaming** (a creation/discovery game with goals, a codex of 15 discoveries with hints for the ones you haven't found, and a persistent sandbox), or **Entertainment** (immersive storytelling with spatial audio). We recommend **Gaming**: the core is an interactive verb set (gather, squeeze, throw) with emergent outcomes.
- **Special awards it is built for:**
  - Boldest Original Concept: presence, spatial depth, real-world scale, eyes and hands.
  - Best First Five Minutes: the opening teaches controller-free interaction in-world, with ghost hands.
  - Best Reason to Come Back: a persistent anchored universe that keeps orbiting while you're away.
  - Best Accessibility Forward: seated, one-handed squeeze, soft-flash mode, subtitles, auto-assist.

## Description

### Inspiration

"We are made of star-stuff." Every atom of iron in your blood was forged inside a star that died before the Sun was born. We wanted you to *feel* that: not watch a planetarium, but be the cause. Tabletop solar systems already exist. SUNSMITH asks a different question: what if you made the stars yourself, with your bare hands, on your own table, and then stood on the world you built from their ashes?

### What it is

Sit at any table and the tabletop opens like an iris onto deep space. Crimson hydrogen rises out of it. You sweep it into your palms and squeeze, and the cloud spins into a disk and heats from red to white until it **ignites**. The newborn star lights your real table and your real hands.

Then you build a giant. It swells past your fingers into a red supergiant, then collapses in a supernova that floods your room with newborn oxygen, carbon, silicon and iron, while its pulsar sweeps beams across your actual walls. You gather that stardust into a molten world, pinch it, and throw it into orbit through the glowing habitable zone. You watch it cool into oceans, clouds, and life.

Touch it, and your room burns away into space. You're sitting on its shore at dawn, under the sun you ignited, with the remnant of your supernova glowing in the sky.

Afterwards, the forge stays anchored to your table as an open sandbox. Make red dwarfs, binary stars, gas giants (failed stars), moons, and rings (shatter a moon inside the Roche limit). Your system plays its own music: each world plucks a note as it passes, so orbits become polyrhythms.

### How we built it

- **Immersive Web SDK** on three.js with multiview, running in the Meta Quest Browser. Nothing to install, and a fast cold start.
- **Hands-first, end to end:** every verb is a large, robust two-handed or one-handed gesture read from the WebXR joints. There is a one-handed fist squeeze for accessibility, and look-and-pinch for selecting distant objects.
- **A passthrough relighting model:** Quest composites `rgb + (1 − alpha) · passthrough`. So we render the room mesh, the table and your hands as "receivers", where alpha removes light from the real world and receivers near a virtual star give it back. Virtual stars light your real table, walls and palms, and the real table top even shadows the floor beneath it; real furniture occludes virtual nebulae; pulsar beams sweep your walls; and the room can burn away into space, starting from the table.
- **Scene understanding:**
  - table detection via semantic plane labels, with the light pool clipped to the table's real outline;
  - the Quest 3 room mesh for occlusion, relighting and the burn-away;
  - persistent anchors, so your forge returns to the same spot next time.
- **Zero downloaded assets:** every star, planet, nebula and sky is procedural GLSL, and every sound and the generative score are synthesized live with Web Audio (HRTF-spatialized).
- **Tested without hardware** using Meta's IWER emulator, driven by our own harness: scripted seated players, choreographed hand gestures, synthetic rooms, and frame-stepped trailer capture.

### How hand interactions are implemented

The **gather** gesture captures motes within about 8 cm of an open palm. The palm frame (center, normal, finger direction) is computed from joint positions, so it is independent of controller or joint-orientation conventions.

The **squeeze** starts when two gas-holding palms face each other within 36 cm. Compression maps from palm distance (36 → 9.5 cm), and it ignites after you hold it above 80% for about 1 second, or about 1.6 seconds for giants. The alternative squeeze is curling a gas-holding hand into a fist.

**Pinch** is the thumb-index distance with hysteresis (on below ~1.9 cm, off above ~2.4 cm). A throw uses the pinch point's velocity over the last 120 ms of the pinch (the release frame itself is ignored, so parting fingers never add a flick), blended into an orbit by "orbit assist": a gentle release becomes a circular orbit right where you let go, a real throw keeps its shape. A held world survives a 0.2 s tracking dropout. A pinching hand never starts a squeeze or soaks up gas.

The **menu** appears when you look at your open palm (the palm faces your eyes and your gaze is on it, and that hand is not holding anything); you poke its buttons with the other index finger, and each button fires once per touch. There are no fine finger poses, and every interaction fits within about 45 cm of a seated chest.

### What's next

- Multiplayer: forge stars together on a shared table, with each player's star lighting the other's hands.
- Meta VR Glasses: eyes-and-hands input is already wired in through gaze and pinch (not yet tested on the glasses' narrower view).
- More cosmic recipes: neutron-star mergers that forge gold, black holes that lens the remnant, and comets that deliver oceans.

## Video

**`film-out/sunsmith-trailer.mp4`**: 90 seconds, 1920×1080, 30 fps, stereo AAC (−16 LUFS).

- **How it was made:** every frame is real app output, captured in Meta's IWER emulator (Immersive Web Emulation Runtime) in its synthetic living room. The capture harness (`tools/film.mjs`) steps the app exactly 1/30 s per frame and scripts the head and hands. No AI-generated video, no compositing beyond titles and crossfades. The rules allow emulator footage.
- **The soundtrack** is the game's own procedural audio engine, rendered offline. Each hit lands on the frame where the game fired that sound: the film harness logs every cue, and `tools/trailer/align.mjs` lines up the clips.
- **Shot list:**
  1. The table opens into deep space.
  2. Gathering hydrogen.
  3. First light between the palms, and the title.
  4. A blue giant swells past your fingers.
  5. Collapse, a held breath of silence, the supernova, the pulsar on the walls.
  6. Forging a world, then pinch, carry and let go into orbit.
  7. The world cools into an ocean world and comes alive.
  8. Touch it, and the room burns away into space.
  9. Dawn on the world you made.
  10. Back on the table, the system keeps turning.
- **Suggested YouTube title:** *SUNSMITH: forge suns between your palms (Quest 3 mixed reality, hands only)*. In the description, include the tagline, the public app URL and the line "Captured in Meta's IWER emulator".
- **Rebuild** (with the dev server running):
  1. `bash tools/trailer/render-all.sh` renders the shots.
  2. `node tools/trailer/align.mjs tools/trailer/timeline.json --anchors tools/trailer/anchors.json --write` aligns them.
  3. `node tools/preview/audio/render.mjs trailer_bed_v2` renders the soundtrack; copy it to `film-out/trailer_bed.wav`.
  4. `node tools/trailer/edit.mjs tools/trailer/timeline.json` cuts the video.

