# Changelog

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
