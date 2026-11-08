# SUNSMITH — Design Document

> *Forge suns between your palms. Build a world from their ashes. Then stand on it.*

A seated, hands-only mixed reality experience for Meta Quest 3 / 3S, built with the Immersive Web SDK (WebXR). Session length: an 8–10 minute guided arc, then an open sandbox that persists on your table.

## Pillars

1. **You are the cause.** Nothing in the cosmos exists until you make it. Every star, element and world traces back to your hands.
2. **The room is part of the universe.** Passthrough is not a backdrop: the real table opens into space, virtual stars *relight the real room* and your real hands, and in the end the room burns away into the cosmos.
3. **One verb, infinite consequence.** Gather and squeeze. What you squeeze and how much decides what is born.
4. **True wonder.** The science is real: hydrogen to stars, stars to iron, iron to worlds. The awe is earned, not narrated.

## Input model (hands first, end to end)

| Verb | Gesture | Tolerance / notes |
|---|---|---|
| **Gather** | Move an open hand through gas or dust | 9 cm capture radius around the palm. Captured motes orbit the palm and trail behind it like smoke. |
| **Squeeze** | Bring both gas-holding hands together, palms roughly facing | Starts at palm distance < 38 cm. Progress = how close the palms are (38 → 9 cm). Hold > 90% for 1.1 s to ignite. Separating early re-expands the cloud; nothing is lost. |
| **Release** | Pull hands apart after ignition | The newborn body stays where it was born, then glides to its orbit. |
| **Grab / throw** | Pinch near a body, move, open | Velocity comes from a smoothed 6-frame history. Orbit assist blends the throw toward a circular orbit. |
| **Touch** | Fingertip contact | Poke a star and it flares toward your finger. Touch a living world to visit it. |
| **Gaze + pinch** | Look, then pinch (Meta VR Glasses / far targets) | IWSDK `GazeSystem`. Used for UI and "visit world". Never required for the core verbs. |
| **Palm menu** | Look at your open palm | A three-button menu floats above your palm; poke with the other hand. |
| **Place forge** | Auto (table detection) or hold a palm flat for 1 s | Works on a tray table or your lap. |

There are no fine finger poses and no locomotion, and the full experience is reachable within ~45 cm of a seated chest.

## The arc (first session)

| # | Beat | Player does | World does | MR moment |
|---|---|---|---|---|
| 0 | **Wake** | Enters XR | A wisp of light (*the Ember*) greets you and scans for a table | A grid sweep over real surfaces. The forge ring settles onto your table. |
| 1 | **The Well** | Watches | The tabletop opens into a well of deep space; crimson hydrogen rises out of it | The table appears to have a hole into infinity. |
| 2 | **Gather** | Sweeps the gas | Motes cling to the palms and swirl | Real hands occlude and glow faintly with the gas. |
| 3 | **First Light** | Squeezes | The cloud spins into a disk and heats from red to white, then **ignites** | The room goes dark for a heartbeat, then the star relights your real table and hands. |
| 4 | **The Giant** | Gathers three times the gas and squeezes harder | A blue giant is born, ages a million years in a breath, and swells into a red supergiant that engulfs your hands | The room turns red with its light. |
| 5 | **Supernova** | Watches and flinches | Collapse → silence → flash → a shockwave rushes through the room. You are *inside* a nebula of newborn elements. A pulsar rises in its place. | Pulsar beams sweep your real walls like a lighthouse. |
| 6 | **Worldsmith** | Gathers stardust, squeezes a molten world, throws it into orbit | A habitable zone glows around the sun. The world cools: oceans, clouds, continents. | Planet shadows on the real table. Orbits sing. |
| 7 | **Life** | Waits / admires | Green spreads across continents; the world sings a new note | — |
| 8 | **Homecoming** | Touches the living world | The room burns away into space from the table outward. The world rises to meet you. | Uses the room mesh to dissolve real geometry. |
| 9 | **Dawn** | Sits on a shore | Your sun rises over your ocean. Your supernova remnant fills the sky. | Full VR. |
| 10 | **Return** | Pinches the Ember | The room rebuilds itself around the forge | Back to passthrough, with the system still orbiting. |

After the arc, the forge stays in **sandbox mode**: every verb is available, discoveries fill the codex, and the system persists on your table across sessions.

### What you can make (one mechanic, many outcomes)

| Squeezed material | Amount | Result |
|---|---|---|
| Hydrogen | < 0.35 | **Gas giant** (a failed star), banded and with storms |
| Hydrogen | 0.35–0.7 | **Red dwarf**: small, deep orange, immortal |
| Hydrogen | 0.7–1.6 | **Sun**: yellow-white, the home star |
| Hydrogen | 1.6–2.6 | **White star**: brilliant and blue-white |
| Hydrogen | > 2.6 | **Blue giant** → red supergiant → supernova → pulsar |
| Stardust | < 0.25 | **Moon**. Thrown inside the Roche limit, it shatters into **rings**. |
| Stardust | ≥ 0.25 | **Molten world**, which cools into a lava, ocean or ice world depending on its orbit |

### Discoveries (codex, persists)

First Light · Red Dwarf · Blue Giant · Failed Star · Supernova · Pulsar · Molten World · Ocean World · Lava World · Ice World · Moon · Rings · Living World · Binary Stars · Homecoming.

## The physics (game-tuned)

- Units are meters and seconds in table space. A star's gravitational parameter μ = 0.0013 · mass m³/s², so a 15 cm orbit takes about 10 s.
- Semi-implicit Euler with 4 substeps. Planets feel stars; stars barely feel planets; moons feel their planet.
- **Orbit assist**: on release, velocity is blended toward a circular orbit (70% in the guided arc, 40% in the sandbox), and the orbit plane is eased toward the horizontal "ecliptic" at star height.
- **Soft tether**: beyond 0.5 m from the forge, a damped spring pulls bodies back. Nothing is ever lost.
- **Habitable zone**: r = 0.16 m · √L. A world's temperature follows its time-averaged distance.
- **Collisions**: two bodies merge. A moon inside 2.2 planet radii becomes a ring.

## MR rendering: the relighting model

Quest composites WebXR content over passthrough with premultiplied alpha: `display = rgb + (1 − a) · passthrough`. That gives us two independent controls over the *real* world:

- **alpha** darkens passthrough multiplicatively, like taking light away;
- **rgb** adds light on top, like a tinted glow.

We exploit this everywhere:

| Technique | How |
|---|---|
| **Room dimming** | three.js clears AR sessions to transparent, so a large inside-out *dimmer* sphere (drawn after the receivers, depth-tested) writes `alpha = dim` wherever no receiver did, tinting the darkness deep blue. |
| **Relighting real surfaces** | The room mesh (or detected planes) is drawn first as a *light receiver*: `alpha = dim · (1 − light)` and `rgb = tint · light`. Real surfaces near a star brighten back toward their true color, so the star lights your room. |
| **Real occlusion** | The receivers write depth, so virtual nebulae behind your couch are hidden by your couch. |
| **Relighting your hands** | IWSDK's skinned hand mesh is re-materialed as a receiver (instanced joint spheres as a fallback). Your real palms glow with the star you hold, and they occlude virtual content. |
| **The table casts a shadow** | Virtual lights are occluded by the real table top: a rectangle or ellipse fitted to the table's scene-plane outline, tested per light in the receiver shader. The floor and the legs beneath the table stay dark. |
| **The Well** | A table-cap receiver with a hole and a starfield "sky well" below the tabletop. The table looks open. |
| **Pulsar beams** | The receiver shader adds beam intensity based on the angle to the beam axes, so beams sweep across real walls. |
| **Burn-away** | The receiver shader dissolves surfaces within a growing radius of the forge into opaque space, with an ember edge. |

With no mesh and no planes, everything still works: the clear-color dim plus additive glows remain.

## Visual direction

The aesthetic is *luminous and painterly, with physically inspired color*. The real room is the canvas, and everything we add is light.

- **Hydrogen**: H-alpha crimson-rose (#ff4f7b) fading to violet.
- **Elements** (emission-inspired): oxygen teal #3fe6c8, carbon gold #ffc96b, silicon violet #a98bff, iron ember #ff7a3d.
- **Stars**: blackbody color by mass; boiling granulation, limb darkening, a corona with slowly rotating rays, and prominences that reach toward a nearby fingertip.
- **Worlds**: procedural continents, a specular ocean, a separate cloud layer, an atmosphere rim and a day/night terminator lit by the actual star.
- **Text**: small, warm white, close to the forge (about 0.55 m from the eyes), with a soft dark plate for legibility over passthrough.

## Audio direction

All audio is procedural (Web Audio), with no samples. Sources are spatialized (HRTF) at their real positions.

- **Score**: a generative ambient bed in D Lydian. Pads shift with each act and swell to a full chord at dawn.
- **Gather**: an airy granular whoosh driven by hand speed, plus a sparkle per captured mote.
- **Squeeze**: a rising tension tone and crackle, with a heartbeat pulse near ignition.
- **Ignition**: a sub-boom, a noise burst and a bright chord bloom.
- **Stars**: a per-star drone whose pitch follows mass.
- **Music of the spheres**: each world plucks a bell note (pentatonic, pitch set by orbit radius) as it crosses the meridian facing the player, so your system plays its own polyrhythm.
- **Supernova**: implosion suck, silence, then a detonation with a long tail. The pulsar ticks.
- **Dawn**: surf, wind and the score's resolution.

## Comfort and accessibility

- Seated, with no artificial locomotion. In the homecoming the player stays still while the world scales around a stable horizon, and then a fade.
- **Flash reduction** (on by default for the supernova peak, with full intensity opt-in), with ramps rather than strobes.
- Subtitles for everything the Ember says, at an adjustable size.
- Either hand can do everything. The single-hand fallback: holding a cloud against the table for 2 s also compresses it.
- Gestures are forgiving, failures are soft, and nothing is lost.

## Persistence (reason to come back)

- `localStorage` holds the system state (bodies, orbits, ages), the codex, settings and arc progress.
- A WebXR persistent anchor restores the forge on the same spot of the same real table.
- Time passes while you are away, so planets advance and a living world keeps evolving.

## Technical architecture

```
src/
  index.ts            World.create (IWSDK) + system registration
  core/               math, timing, state store, persistence
  xr/                 hands (joints → palm, pinch, velocity), table finder, anchors, room mesh
  render/             shaders: receivers, well, star, corona, planet, particles, shockwave, sky
  sim/                bodies, gravity, stellar evolution, climate, collisions
  game/               director (arc state machine), Ember guide, discoveries, menu
  audio/              engine, synth voices, score, spatial SFX
  surface/            the dawn scene (sky, ocean, terrain)
```

### Performance budget (Quest 3, 72–90 Hz)

- 70 or fewer draw calls in MR, and 40 or fewer on the surface. Multiview (IWSDK default) halves the CPU cost.
- 150k triangles or fewer, excluding the room mesh.
- 6,000 or fewer CPU-simulated motes (Float32Array, no allocations per frame) and 12,000 or fewer GPU-only ambient motes.
- No post-processing and no full-screen passes. Glow is baked into additive sprites.
- One persistent `ShaderMaterial` per effect and uniforms updated in place. No per-frame allocations.
