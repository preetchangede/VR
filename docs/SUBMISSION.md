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
- [ ] The demo video (under 3 minutes, real footage from device or emulator) is uploaded **publicly** to YouTube or Vimeo.
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

**Pinch** is the thumb-index distance with hysteresis (on at 0.9, off at 0.7). Throws use a smoothed 120 ms velocity window, blended into a circular orbit by "orbit assist".

The **menu** appears when an open palm faces the eyes; you poke its buttons with the other index finger. There are no fine finger poses, and every interaction fits within about 45 cm of a seated chest.

### What's next

- Multiplayer: forge stars together on a shared table, with each player's star lighting the other's hands.
- Meta VR Glasses: eyes-and-hands input is already wired in through gaze and pinch.
- More cosmic recipes: neutron-star mergers that forge gold, black holes that lens the remnant, and comets that deliver oceans.
