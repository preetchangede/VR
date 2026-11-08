# Concept Exploration

Studio pitch session for the **Meta VR Start Developer Competition 2026**.

## What we are optimizing for

Hard constraints (from the official rules and Meta's announcement):

- **Hands-first, end to end.** Every step, including menus and the tutorial, must work without a controller.
- **Judged on Quest 3 / 3S.** A WebXR/IWSDK entry is submitted as a public link.
- **Seated-friendly** ("airplane seat test", a ~2 ft interaction volume) and **satisfying within 10 minutes** ("one bus stop test").
- **60 fps minimum**, so we budget for 72-90 Hz.

Scoring (4 × 25%): Innovation & Creativity, Experience Design, Technical Implementation (hand tracking, gaze, passthrough, scene understanding, anchoring), Polish & Presentation.

Special awards we can realistically target: **Boldest Original Concept** (presence, spatial depth, real-world scale, eyes and hands), **Best First Five Minutes**, **Best Reason to Come Back**.

The brief from our director: space, breathtaking, the table as the centerpiece, ridiculously fun, original, and full of wonder.

### The landscape (what already exists)

Tabletop solar systems are not new on Quest: *Planetarium* (play with gravity on a mini solar system), *Cosmic XR* (view the solar system and galaxies in passthrough), *Astra* (explore the solar system from your couch). **"A solar system on your table" is not an idea.** It is table stakes. Whatever we build has to make the player *the cause* of what they see, and has to use the real room in ways those apps do not.

---

## The pitches

### 1. SUNSMITH: "Forge suns between your palms"

The universe is dark, and your table is the forge. You sweep primordial hydrogen out of a portal in your tabletop, cup it between your hands, and **squeeze until it ignites into a star**. The light of that star pools on your real table. You build a giant star and watch it age, swell past your hands and die in a supernova that fills your room with newborn elements. Then you gather that stardust into a molten world and throw it into orbit. When it cools into an ocean planet, your room burns away into space and you are standing on its shore at dawn, under the sun you made.

- **Verbs:** sweep, cup, squeeze, release, throw. Every one is big, physical and reliable with hand tracking.
- **Hook:** real astrophysics (nucleosynthesis) *is* the progression. You literally make the iron your world is built from.
- **MR:** the tabletop portal, the star lighting your real table, the room dimming at ignition, the supernova flooding the room, and the room dissolving into space through the scene mesh.

### 2. SLINGSHOT: Gravity-assist courier

A holographic mission table. Pinch-pull-release to launch probes through gravity wells, collect stardust and thread moons. On a perfect run, you ride along with the probe at full scale.

- Tight, gamey loop and very replayable.
- But gravity-slingshot puzzles are a well-worn genre, the awe is low, and it reads as "a mobile game on a table".

### 3. CELESTIAL SAFARI: Photograph impossible phenomena

A living alien star system on your table. Frame shots with a **finger-frame gesture** (both hands make a rectangle) to capture rare events: eclipses, auroras, cryovolcanoes, a comet breaking up. Your photos are pinned to your real walls with persistent anchors.

- The finger-frame is a wonderful hands-first mechanic, and the wall gallery is a great reason to come back.
- But the system is pre-made, so you observe rather than cause. It needs a large content library of phenomena to stay interesting.

### 4. THE LAST OBSERVER: The end of the universe

A narrative piece at heat death. You gather the last embers of a dying cosmos and compress them into a new Big Bang that erupts from your table and fills your room.

- An enormous emotional payoff.
- But interactivity is thin, replay is near zero, and it is a 4-minute film with gestures.

### 5. MUSIC OF THE SPHERES: Orrery sequencer

Fling planets into orbit. Kepler's third law turns their periods into polyrhythms, and your star system *becomes a song*.

- Truly original and a lovely Entertainment-track fit.
- But a music toy has a narrower audience, and the visuals are calmer than the brief demands.

### 6. POCKET PROBE: Fly a tiny probe through a miniature system

Steer with your hand through Saturn's rings, then pinch-zoom until the system is room-sized.

- Great scale play.
- But hand-steered flight is fiddly, artificial locomotion fights seated comfort, and it competes head-on with existing solar-system explorers.

### 7. ESCAPE VELOCITY: Swat asteroids away from a tiny Earth

Arcade planetary defense around your table.

- Immediately fun.
- But derivative, it shrinks wonder into whack-a-mole, and it is forgettable after five minutes.

---

## Critical evaluation

Scored 1–5 by the whole room. **Fun** means moment-to-moment hand feel; **MR** means how much the real table and room matter; **Ship** means confidence we can make it excellent on Quest WebXR before the deadline.

| Concept | Awe | Fun | Original | MR | Hands | Seated / 10 min | Replay | Ship | **Total** |
|---|---|---|---|---|---|---|---|---|---|
| **1. Sunsmith** | **5** | **5** | **5** | **5** | **5** | 5 | 4 | 3 | **37** |
| 2. Slingshot | 3 | 5 | 2 | 4 | 4 | 5 | 5 | 4 | 32 |
| 3. Celestial Safari | 4 | 4 | 4 | 4 | 5 | 4 | 5 | 2 | 32 |
| 4. Last Observer | 5 | 2 | 4 | 4 | 3 | 5 | 1 | 4 | 28 |
| 5. Music of the Spheres | 3 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | 33 |
| 6. Pocket Probe | 4 | 3 | 2 | 3 | 2 | 2 | 3 | 3 | 22 |
| 7. Escape Velocity | 2 | 4 | 1 | 3 | 4 | 5 | 3 | 5 | 27 |

### Why Sunsmith wins

1. **It answers "what is impossible in real life?" with your own hands.** Holding a newborn star. Being inside a supernova. Standing on a world you made out of the ashes of a star you made. No planetarium does this, because in a planetarium you are a spectator.
2. **The table is the protagonist, not a stage.** The tabletop opens into a well of deep space. The star you ignite lights your real table and dims your real room. The final transition burns your room away into the cosmos, starting from the table. Passthrough and scene understanding are the story, not a backdrop.
3. **One mechanic, deep consequences.** Gather-and-squeeze is the only skill to learn. What you squeeze (hydrogen or stardust) and how much decides whether you make a red dwarf, a sun, a blue giant, a molten world or an ice moon. That is exactly the "scope to one mechanic and finish it" advice.
4. **Built-in emotional arc.** Darkness → first light → death of a giant → birth of a world → homecoming. It lands in under 10 minutes, and the science is true: "the iron in your blood was made in a star like that."
5. **Robust on real hardware.** Sweep, squeeze and throw are large, two-handed motions that hand tracking handles well. There are no fine finger poses, no locomotion, and you never need to stand.

### Risks and how we neutralize them

| Risk | Mitigation |
|---|---|
| Creation sandboxes can feel aimless | A guided 8–10 minute arc with clear goals (light a star → forge iron → make a habitable world → visit it), then a sandbox with a discovery codex. |
| Particle overdraw on Quest | Small, mostly CPU-simulated additive sprites with a hard particle budget; no full-screen post-processing; glow is baked into sprites. |
| No table, or no Space Setup | A palm-flat placement gesture puts the forge anywhere (a lap, a tray table). Every scene-understanding feature has a fallback. |
| Comfort during the "visit your world" scale shift | The player never moves. The world scales around a stable horizon, then a soft fade. No artificial locomotion. |
| Photosensitivity (ignition flashes, supernova) | A flash-reduction setting, and flashes ramp in rather than strobe. |

### Ideas we stole from the runners-up

- From **Music of the Spheres**: every orbiting world plucks a note as it swings past, so your star system plays its own polyrhythmic song.
- From **The Last Observer**: the narrative frame and a quiet, earned finale.
- From **Celestial Safari**: persistence. Your forge stays anchored to your table between sessions, and the system you built keeps orbiting.

**Decision: build SUNSMITH.**
