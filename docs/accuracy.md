# How Oxygen matches the game

Bedrock's particle system has plenty of quirks: things that work differently from what the documentation
suggests, or that other editors get wrong. Oxygen's preview copies the game, quirks included, so an effect that
works in Oxygen works in Minecraft.

Every behaviour on this page was checked in the game itself. Oxygen ships a test pack (`packages/testpack`)
with dozens of small test effects. Each one asks a single question, like "does a particle with no lifetime
component live?", and the answers recorded in the game are replayed against Oxygen's engine on every test run.
The bundled examples were also run in the game from the same camera to compare
([showcase](showcase.md)).

When the game silently ignores something, Oxygen's preview does the same, and the Problems panel tells you why.

## Molang

- **A mistake in one field doesn't break the effect.** The game drops that one field and uses its default
  (size 1, colour white, position 0). The rest of the effect still runs.
- **Reading a variable before anything sets it stops the whole expression.** The field then reads 0. Writing
  `v.speed ?? 1` gives a fallback instead. Oxygen marks these reads and offers that fix.
- **Temporary values (`t.*`) are global.** They're never cleared and are shared by every effect playing. That's
  how an event hands values to an effect it spawns, but it also means a temp can hold a leftover value.
- **Numbers are 32-bit,** as in the game, so `0.1 + 0.2 == 0.3` is true.
- **Curves aren't ready in an emitter's creation expression.** Elsewhere they clamp at their ends: a curve read
  before its first key or after its last holds that key's value.

## Spawning and lifetimes

- **Effects started with `/particle` or a script play once.** A looping emitter only loops when an entity
  plays it. Oxygen's Repeat button replays the effect for convenience and says so.
- **At most 1,000 particles per emitter** for `/particle` and scripts. New particles stop spawning at the cap.
- **A manual-rate emitter started with `/particle` ends straight away.** It runs its creation step, but its
  timeline and expiry events never fire. Use a burst or a steady rate for effects spawned that way.
- **No lifetime component means particles die immediately.** A lifetime component without a max lifetime lives
  forever.
- **Spheres and discs are denser in the middle.** The game places particles at a random distance that favours
  the centre, not evenly through the shape. Boxes are even.

## The order things run in

Every frame the game updates the emitter, then each particle in turn: its update expression, then its movement,
then its timeline events. Only after all particles have moved does it prepare them for drawing (render
expressions, size, colour, texture).

Because each particle runs its update and then moves before the next one starts, an effect can lay particles out
with a counter: each particle takes the next number and places itself by it. Snowstorm runs every particle's
update before moving any of them, so every particle ends up with the last particle's number and they all stack
on one spot.

Variables belong to the emitter, not to each particle. By the time render expressions run, a value set in the
update holds whatever the last particle left there (Oxygen flags reads like that). Size, colour or UV that depend
on something per particle need it again in the render pass: worked out from `v.particle_random_1`–`4` and
`v.particle_age`, which are each particle's own, or from a second counter in the render expression that the
emitter's update resets, as several examples do.

The Inspector's Phases view and the Expression panel's "whole effect" view show this order for your effect.

## Events

- **A step with sub-steps or a random choice runs only those.** Its own expression, spawn and sound are ignored.
  Oxygen greys them out and offers to move them into a step.
- **A plain step spawns its effect first, then runs its expression.**
- **Random choices are by weight.** A weight of 0 never wins against a positive weight.
- **Where spawned effects appear** depends on how the parent was started. For `/particle` and scripts:
  - a single particle spawned by an event appears at the world origin, not at the parent;
  - an effect spawned when a particle is created appears near the world origin too (at the particle's offset);
  - timeline and expiry events spawn at the particle, as you'd expect.

## Drawing

- **Billboard size is half the width.** A size of 1 makes a particle 2 blocks across.
- **Hidden when off screen, but still running.** When an emitter is out of view, its particles keep moving, but
  their render expressions pause.
- **Cutout textures** (`particles_alpha`) are either fully drawn or not at all, based on the texture's own
  transparency. The tint's alpha is ignored.
- **Blended and additive particles never hide each other**, so crossing glow planes blend smoothly. Snowstorm
  lets them cover each other, which leaves dark shards.
- **Colours are clamped** to the normal range, so a colour over 1 doesn't get brighter.
- **Direction-facing modes** (`direction_x`, `direction_y`, `direction_z`, `lookat_direction`) were rebuilt
  from the game's own results, including the straight-up and straight-down cases.

## Vibrant Visuals

Oxygen's Vibrant Visuals preview was matched to screenshots of the game at four times of day, and to recordings of
emissive particles at night.

- Lit and unlit particles look the same: both take the world's light, mostly from the sky.
- Only a texture set's glow (emissive) makes a particle shine at night. The Vibrant Visuals panel can make one
  for you.
- **A texture set belongs to the texture.** Every effect with that texture glows, child effects included.
- **Emissive light is very strong.** At night an emissive of 255 is about 40 times a white surface in the
  moonlight. It grows evenly with the emissive value and is weighted by alpha like any other light, but because
  it's so strong, a translucent texel already shows almost fully bright at a few percent alpha. Soft alpha
  edges therefore turn into the texture's hard pixel steps, and a soft glow texture becomes an opaque blob.
  For soft translucent glows keep emissive low (around 8 to 24 of 255); for strong glows, an emissive cutout
  (`particles_alpha`) with a clear pixel-art outline looks clean and blooms.
- **Auto exposure follows what's on screen.** Something emissive in view at night darkens everything else within
  half a second: an emissive area of 1 % of the screen took exposure to about a quarter, 8 % or more to the
  floor of about a sixth. When it goes, exposure holds for about a second and recovers over about three.
  Oxygen does the same while playing; still pictures from the MCP tools use the settled exposure of the moment.
- Bloom is a tight halo, fading within about a fifth of a glowing area's width.
- **Colours keep their hue as they get brighter.** Vanilla grades the picture (contrast 1.15, saturation 1.05) and
  tone maps with its 'generic' curve, which works on each colour's brightest channel: an over-bright pink glow
  stays pink and only its core turns pale, where a per-channel curve washes it out to white. Oxygen reads a pack's
  own `color_grading/color_grading.json` (midtones, tone mapper, gamma) and uses vanilla's without one.
- Additive particles come out brighter than others of the same colour.
- A resource pack has to opt in (`"capabilities": ["pbr"]` in its manifest), or the game turns Vibrant Visuals
  off while the pack is active.

## Effects on an entity

Measured with a test entity whose bones and locators are rotated, animated and scaled (`e01`–`e12` in the test
pack):

- **A locator flips the effect's Y axis.** Without a locator an effect sits at the entity's feet with X to its
  right, Y up and Z behind it. On an unturned locator Y points down and X to the entity's left. It's a half turn,
  not a mirror, so an emitter shooting up shoots down, and one shooting right shoots left.
- **Locators follow their bones,** through every parent, with rotations in the geometry file's order (X, then Y,
  then Z). The locator's own rotation turns the effect the same way.
- **The entity's scale** grows locator offsets and the effect on a locator, but not how fast its particles go.
  `ignore_inherited_scale` keeps the effect's size but not the locator's position.
- **The entity's movement adds nothing** to its particles, even with `emitter_local_space` velocity on.
- **World-space effects on an entity measure `relative_position` from the world origin,** not from the emitter.
- **`bind_to_actor: false`** starts the effect where the entity stands, or at the world origin when it has a
  locator.
- **`entity_aabb`** fills the entity's collision box placed at the emitter, in the emitter's axes. On a locator
  it hangs down from the locator.
- **Entity queries** (`q.variant`, `q.property`) work in an entity's effects, except in the emitter's creation
  expression, where they read 0. `q.position` is where the entity stands, not the locator. The entity's own
  variables aren't visible.
- **At most 1,000 particles per emitter,** bursts and steady rates alike. Creators had reported 10,000.
- **When the entity goes away,** or the controller state that played the effect ends, its emitters stop and
  particles in its space vanish. World-space particles carry on. An emitter outlives the animation that fired it.
  A looping animation fires a new emitter on each pass.

Oxygen's stand-in entity does all of this with the model at rest; it doesn't play the entity's animations.

## Camera queries

For effects started with `/particle` or a script, `q.distance_from_camera` follows the camera, but
`q.camera_rotation` always reads 0 and `q.rotation_to_camera` reads a fixed 0 and -90 wherever the camera is.

## What isn't measured yet

A few behaviours can't be checked with `/particle` or scripts, or haven't been yet. Oxygen follows creators'
reports for these:

- How a looping emitter played by an entity restarts. Oxygen treats each loop as a fresh emitter whose old
  particles live on.
- How an emitter bound to its parent follows a moving, turning parent.
- Some rarely used maths functions and easing curves.

Editor-only conveniences that the game doesn't have, like pinned variables, scenario inputs and Repeat, are
marked as such wherever they appear.
