# Changelog

## Oxygen 0.2.2

### Added

- The Context panel can fill every query the preview has no value for (0, 1 or an empty string) in one step, clear
  them, and nudge or scale every number set for a query at once, as it already could for variables.
- When a query has no value in the preview, the Problems panel says why: it needs an entity, the game can't run
  it in particle Molang, or it returns a struct to assign to a variable.

### Changed

Measured in the game with new tests in the test pack (`t66`–`t80`, `e13`–`e31`):

- Queries for world generation or tags (`q.heightmap`, `q.above_top_solid`, `q.noise`, the biome tags,
  `q.any_tag`) are load errors, as in the game, and their field uses its default. Completions no longer offer them.
- Names with more dots (`v.a.b`) are structs: `v.c = v.a` copies every member, reading `v.a` gives 0, and setting
  a member replaces a number `v.a` held. `??` on a member and temp members are flagged as warnings, as the game
  logs them, and still run.
- Bone queries assigned to a variable fill the struct with zeros, as the game does in particles, where they never
  find a bone. Used any other way they're a load error.
- `q.life_time` and `q.delta_time` read 0 in particles.
- An event's `pre_effect_expression` runs after the spawned effect's `creation_expression`.
- `loop` has no 1,024 cap, and a fractional count rounds up.
- `<`, `>`, `+` and the other numeric operators on a string are load errors.
- An assignment has a value: `v.a = (v.b = 3)` sets both.
- Children of a particle's events on an entity appear where the game puts them: `emitter_bound` children at the
  emitter, `emitter` children at the particle (at the emitter when the parent keeps its particles in local space).
- `emitter_local_space` with rotation but no position is ignored, as the game rejects it.
- `bind_to_actor: false` effects use the world's axes.

## Oxygen 0.2.1

### Added

- The desktop app updates itself on Windows and Linux: a new version downloads in the background and installs the
  next time Oxygen restarts, or right away from *Restart to update* in the status bar (it asks first if anything
  is unsaved). *Help › Check for updates…* looks now, and *Settings › General* can turn automatic downloads off.
  On macOS it says when there's a new version and links to it. This starts with the first release after 0.2.0:
  install that one by hand.
- The web app tells a tab left open when a newer version is out, and reloads into it on request.
- MCP servers installed from the release zip tell the agent when a newer release is out, and how to update.
- Effects on an entity use real locators. Import them from a model's `.geo.json` (worked out through its bones)
  or make your own with an offset and rotation as a geometry file writes them. The viewport draws the axes the
  effect gets. The stand-in entity also has a scale, a collision box size for `entity_aabb`, a facing, a time
  when it goes away, and a *Follows it* switch for `bind_to_actor: false`. The MCP tools take all of these as an
  `entity` option.
- The Inspector's texture area shows a small picture of what the particle draws (the area, or a flipbook's first
  frame). Clicking it opens the Texture panel.
- The Context panel takes temps (`t.size`) as inputs too, as a parent's event leaves them before it spawns the
  effect, and context values (`c.size`), which every expression can read. `evaluate_molang` takes `contexts` too.
- The Debug panel shows the values a selected particle's own expressions left on its turn in the frame, such as the
  index it took from a counter, next to what the emitter's shared variables hold now.

### Changed

- Effects on an entity now behave as measured in the game (test pack `e01`–`e12`):
  - A locator flips the effect's axes: an unturned locator points Y down and X to the entity's left. Without a
    locator X points to the entity's right and Z behind it.
  - An emitter on an entity holds 1,000 particles, not 10,000.
  - The entity's movement adds no speed to its particles, even with `emitter_local_space` velocity on.
  - World-space effects on an entity take `relative_position` from the world origin.
  - `entity_aabb` fills the entity's box at the emitter, in the emitter's axes.
  - Entity queries read 0 in an emitter's creation expression. `q.position` is where the entity stands.
  - When the entity goes away, particles in its space go with it.
- The entity's facing uses Minecraft's yaw: 0 is south, 90 west.
- The Scene panel no longer offers made-up attachment points (head, hands and so on) as locators. Scenes saved
  with them keep them as locators at the same places.

### Removed

- The *Flip Y* switch for locators. Every locator flips its axes in the game, so Oxygen always does.

### Fixed

- The start screen shows the keys you bound for New effect, Open files and Commands.

## Oxygen 0.2.0

### Added

- The web app is online at [oxygen.hydrogen.exposed](https://oxygen.hydrogen.exposed).
- An MCP server for coding agents (`apps/mcp`): agents can look up the particle format and the game's measured
  behaviour, create effects from the starting effect or an example, edit them by JSON path without disturbing
  formatting or rewrite them whole, check them, simulate them and render previews with Oxygen's viewport, with
  other effects playing alongside, and open them in the desktop app for you. See
  [Oxygen for coding agents](https://github.com/dev-hydrogen/oxygen/blob/main/docs/agents.md).
- Setting up the MCP server doesn't need a clone of the repository: each release carries it as `oxygen-mcp.zip`,
  and a prompt has a coding agent install it for itself. Copy the prompt from *Help › Set up a coding agent…* or
  from [Oxygen for coding agents](https://github.com/dev-hydrogen/oxygen/blob/main/docs/agents.md), which also
  gives the commands for Claude Code and Codex.
- The MCP server can also debug effects: every Molang evaluation of a particle with the value of each part, all
  evaluations of a frame in order, the engine's full state at any moment, values over time, Molang evaluated at
  the exact moment a field runs for each particle (for effects that share values between particles), static Molang
  analysis, animated GIFs, and a link to Minecraft itself (deploy, spawn, commands, content log).
- The desktop app keeps one window: opening a file while it runs (from the command line, a file manager or an
  agent) opens it there, or brings its tab forward.
- Settings (File › Settings…, Ctrl+, or the gear in the top bar): how a new effect starts playing, the camera
  (field of view, turning, wheel and flying speeds, inverted up and down), the viewport's resolution, background
  and helpers, the code text size, how long status messages stay and, in the desktop app, the window's zoom. A
  search box looks through every setting and key. Settings can be exported, imported and reset.
- Every key can be changed (Settings › Keyboard), including the camera's fly keys and the Molang editors' rename,
  go to definition, uses, comment and format. Each panel, layout and preview toggle can get a key of its own.
  Menus, tooltips, the command palette and the shortcuts sheet show the keys you chose, and the desktop app's
  native menu follows them.
- About Oxygen (Help menu, or click the logo): the version, what's new, what the engine and game data are built
  from, system details to copy into a bug report, and credits.
- New commands: step one frame, slower and faster playback, and next and previous open effect.
- The rendering mode, the sky behind Vibrant Visuals and the Inspector's layout are remembered between visits, and
  F frames the particles whenever no text field has focus (it needed the viewport focused).
- Vibrant Visuals preview: auto exposure, measured in-game. Something emissive in view at night darkens the rest
  within half a second and lets go over a few seconds, as in the game. Still pictures from the MCP tools use the
  settled exposure; GIFs adapt over their frames.

### Fixed

- Vibrant Visuals preview: texture sets now belong to their texture, as in the game. Child effects and other
  effects in the scene glowed only if they used the open effect's texture (and then with its texture set).
- Vibrant Visuals preview: emissive particles now look as in the game, refitted to recordings of emissive alpha
  ramps and tinted glows at night. Glow is much stronger (translucent glowing particles blow out to hard pixel
  edges, like in-game) but keeps its colour instead of washing out to white, bloom is a tight halo instead of a wide
  haze, and additive particles are lit a little brighter.
- Vibrant Visuals preview: the picture now goes through the game's display pipeline: the pack's color grading
  (vanilla's when it has none: contrast 1.15, saturation 1.05), its tone mapper ('generic' by default, measured
  in-game, instead of ACES; 'reinhard_luminance' and 'reinhard_luma' now keep hues) and its gamma. Without a pack's
  lighting, vanilla's lighting/global.json is the reference (emissive desaturation 0, not 0.1).

- A paused preview drew effects that count particles in their render expression (spiral galaxy, aurora,
  lightning, magic circle and others) wrong: every redraw advanced the count, so colours and sizes drifted.
  Redrawing a paused frame, or one scrubbed to, now shows it as it played. This now also holds for scenes big
  enough to run on several threads.
- A looping emitter starting its next loop kept the last loop's particles in its own pool: they counted toward the
  new loop's particle cap and shared its variables. With Repeat on, the aurora example's second burst was cut to
  100 particles, bunched at one end, by the cap and its index counter. Each loop now gets an emitter of its own, as
  in the game, and the last loop's particles finish with theirs.

## Oxygen 0.1.0

The first release of Oxygen, a ground-up rewrite of [Snowstorm](https://github.com/JannisX11/snowstorm) 3.2.2.
It runs as a web app, a VS Code extension and a desktop app.

### Highlights

- A preview that behaves like the game, checked against Minecraft behaviour by behaviour. See
  [how Oxygen matches the game](https://github.com/dev-hydrogen/oxygen/blob/main/docs/accuracy.md).
- Molang editing with completion, hover help, plain-language problems, quick fixes and refactors.
- Tools to understand an effect: the order everything runs in, particle inspection, step-by-step debugging,
  value graphs and 30 seconds of history to scrub through.
- An events graph across every effect involved, with steps, random choices and the values handed to child
  effects.
- Context inputs and named scenarios for effects that read variables from scripts or entities.
- A scene around the effect: blocks to collide with, `.mcstructure` import, and a stand-in entity that walks a
  path.
- A Vibrant Visuals preview, including making particles glow and saving the texture set.
- Seven window layouts, from a plain preview to a full debugging setup.
- In the desktop app, deploying a pack to Minecraft and spawning the effect in your world.
- 20 new examples, each checked in Minecraft.

### Fixed compared with Snowstorm

- Effects that place particles with a counter (circles, spirals, curtains) no longer collapse into one spot.
- Blended and additive particles no longer cut dark shapes out of each other.
- Temps (`t.*`) are shared between effects as in the game, so values reach the effects an event spawns.
- Child effects are found in the pack (or among the examples) and play without loading each one by hand.
- Looping no longer kills live particles (#91). Curve nodes can be Molang (#110), and `bezier_chain` holds its end
  values (#123). Negative sizes hide the particle (#119), and a UV size of 0 samples a sliver (#118).
- Collision uses real block shapes, not just a flat floor, and the kill plane is shown in the viewport (#81).
- Spheres and discs spawn particles the way the game does, denser in the middle.
- Colours, cutout transparency, facing modes, flipbooks and lighting match the game.
- Particle caps and looping follow how the effect is started (`/particle`, a script or an entity).
- Scenarios and pre-effect scripts replace the variable placeholder bar (#114).

### Removed

- The Vue 2 Snowstorm app. It remains in this repository's history, up to `f70fbb5`.
- Quick Setup: the Inspector now lists every component with a switch to turn it on.
- The variable placeholder bar: the Context panel replaces it.
- The mobile and portrait layout.
