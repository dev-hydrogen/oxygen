# Changelog

## Oxygen 0.3.0

### Added

- Right-click menus: the viewport (inspect what's under the pointer, play, captures, helpers), tabs (close
  others, to the right, saved, all), the Outliner, a component's header or a field in the Inspector (copy,
  paste, reset, its graph), an input in the Context panel (set, clear, pin, find uses) and a problem.
- Middle-click a tab to close it.
- Screenshots, GIFs and videos (MP4, or WebM where the browser can't make MP4) of the viewport from its menu or
  the Preview menu, at a size of your choosing (Settings › Viewport › Screenshots and recordings). Recordings
  play the effect at a steady frame rate, from now or from the start, until it ends (or for a length you set).
  Screenshots go on the clipboard and leave out the background by default. The desktop app keeps captures in
  Pictures/Oxygen and puts a GIF or video on the clipboard as a file; the web app downloads them; VS Code asks
  where. Recordings can move the camera (orbit, sway, push in, pull back, rise, spiral), and every capture has
  a small Oxygen mark in the corner, which Settings can turn off.
  <br><img src="https://github.com/dev-hydrogen/oxygen/raw/main/docs/media/0.3.0/recording.gif" width="360" alt="Aurora, recorded with the orbit camera">
- Move the stand-in entity, its locators, its path's points and blocks right in the viewport: click (blocks:
  right-click › *Move*), then drag the handles or nudge with the arrow keys and Page Up / Page Down. The entity
  has a place to stand (*Stands at* in the Scene panel); a path goes round it.
  <br><img src="https://github.com/dev-hydrogen/oxygen/raw/main/docs/media/0.3.0/move.png" width="420" alt="Move handles on the stand-in entity">
- Turn the entity the same way (right-click › *Turn the entity*, or R while moving it): a ring, or the arrow keys.
- Move and turn the effect's own emitter where it isn't on the entity, and the scene's other effects: right-click
  the emitter › *Move* or *Turn*, or set *Spawns at* and *Turned* in the Scene panel. The game can't turn an
  emitter /particle spawns; the turn is for previewing local-space motion.
- The Texture panel's texture path can be edited, and its grid takes any size.
- Right-click menus in Molang and number fields: cut, copy, paste and select all, then the field's own items. The
  desktop app has the usual edit menu in every other text field too.
- The Debug panel can change values: drag or type a particle's age, lifetime, position, velocity or rotation, or
  an emitter's variables and the temps, and the preview carries on from there.
- *Fill unset with* takes a number of your own, for variables and for queries; dragging it changes everything it
  filled together.
- A gradient stop can be written as R, G, B, A Molang in the Inspector (the *ƒ* button on the stop), like
  `"0.52": ["v.red1", "v.green1", "v.blue1", "v.alpha1"]`. The preview already ran such stops; the Inspector only
  offered a hex code for them.
- Import a picture as the effect's texture without a resource pack: *Import image…* in the Texture panel, *File ›
  Import texture image…*, or drop it on the Texture panel. It stands in for the texture path (an effect on a
  vanilla texture gets `textures/particle/<file name>`), and Oxygen keeps it for next time.
- The Game menu (desktop) chooses where packs deploy: any Minecraft install it found, or *Custom paths…*, where
  the resource pack folder, the behavior pack folder (Oxygen Link) and the content log are each set by hand, for
  Bedrock on Linux and macOS launchers or other setups Oxygen doesn't find. The choice is kept. The MCP server's
  `game_deploy` takes a folder path as `install` to copy the pack straight into.
- Settings › Viewport › Helper limits: how many particles get facing axes and velocity arrows, and how many
  emitters get markers and shapes.

### Changed

- The scene (entity, blocks, emitter place, other effects) is kept in the file by default, once you change it, so
  moving and turning things in the viewport, and every other scene change, undoes and redoes with Ctrl+Z / Ctrl+Y
  (in VS Code too). A drag is one step. Turn *Keep in file* off in the Scene panel to leave the file alone.
- The Debug panel's *Its turn* says which values the particle set and which it only read (from whatever ran
  before it in that pass), for its update and its render.
- Facing axes and velocity arrows stay on the same particles while they live, instead of jumping between them,
  and go on many more of them (500 and 2,000 to begin with, from 64 and 256).
- Number boxes apply while you drag them, not when you let go. Scenario queries and pinned variables change the
  running preview without starting it over, and a locator's place and turn follow at once.

### Fixed

- Clicking between fields in the Inspector could select text from the click onwards: a graph appearing, or values
  shown in the field changing, moved the text under a held button. They now wait for the release.
- An effect on the entity that doesn't follow it (bind_to_actor: false) started where the entity stood before
  it was last moved, not where it stands: the entity took its new place a frame late.
- The desktop app crashed once the game's content log passed 2 GB (a world whose packs log errors every frame
  gets there in a few hours): it read the whole file each time it grew. It now reads only the new lines, and the
  MCP server's `game_log` reads at most the newest 32 MB.

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
