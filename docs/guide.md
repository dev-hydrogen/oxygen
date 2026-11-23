# Using Oxygen

A tour of the editor and the usual tasks. Most of it works the same in the web app, VS Code and the desktop app;
where they differ, it says so.

## The window

- **Top bar:** the menus, the command palette (Ctrl+K: every action, panel and layout by name), Settings (the
  gear) and Save. In the desktop app it's also the window's title bar. The Oxygen logo opens *About Oxygen*.
- **Tabs:** every open effect has a tab. Middle-click one to close it; right-click it to close others, those to
  its right or the saved ones. Closing one with unsaved changes asks whether to save them. In VS Code, each effect opens in its own editor instead.
- **Right-click** brings up a menu wherever there's something to do: the viewport, tabs, the file browser, a
  component's header or a field in the Inspector, an input in the Context panel, a problem. Inside text fields
  the browser's own menu stays, for copying and pasting.
- **Panels:** the viewport, the Inspector and the tool tabs (Expression, Problems, Context, Curves, Events,
  Texture, Scene and more). Drag a panel's tab to move it, double-click it to fill the window, and bring back
  closed panels from the View menu.
- **Files** (web and desktop apps): the open resource pack's files, down the left side. See *The file browser*
  below. In VS Code, its own Explorer does this.
- **Layouts:** the layout button in the top bar (it names the current one, *Editor* to begin with) sets the
  window to one of seven layouts, each set up for a job such as editing, events, curves, lighting or debugging.
  *Reset* puts the current one back as it starts. The same menu picks how the Inspector groups its fields, and
  the View menu has the same list under its panels.
- **Explanations:** panels say little. Rest the pointer on a label for what it is and, for anything the game
  reads, the file and key that hold it. A small *?* has a longer note: click it to keep the note open, and to
  get its link to the page here that covers the mechanics. *Help › Documentation* opens these pages in Oxygen.
- **Two kinds of label:** a label in the code typeface (`bind_to_actor`, `locator`, `pre_effect_script`) is a key
  the game reads from a file, written as the file writes it. A label in the ordinary typeface only sets up the
  preview.
- **Status bar:** problems, the number of live particles against the game's limit, emitters and time.

## Opening and saving

- **Web:** File › Open files, or Open resource pack folder to work on a whole pack. Chrome and Edge save straight
  back to your files. Other browsers download the saved file. Share links (File › Copy share link) carry the
  whole effect in the URL.
- **VS Code:** open a particle file. `*.particle.json` files open in Oxygen; for others run *Open in Oxygen*.
  VS Code handles saving and undo. Examples (*Oxygen: Open example…* or the Examples menu) open as new untitled
  files, so saving one asks where to put it.
- **Desktop:** open files or a pack folder. If a file changes outside Oxygen while it's open, Oxygen loads the
  change, unless you have unsaved edits.

Oxygen only changes the parts of a file you edit, so formatting, key order and anything it doesn't know about
stay as they were.

## The file browser

In the web and desktop apps, the *Files* panel lists the resource pack opened with *File › Open resource pack
folder*: everything under `particles`, `textures`, `lighting` and `color_grading`, and the manifest. It lists
only a pack you open: an effect opened by itself brings none. The desktop app opens the same pack again next
time; *×* closes it. *Filter files* narrows the list to names that match.

- **A particle file** is listed with its effect's identifier. Most files are named after their effect, and then
  the row reads as the identifier (`oxygen:aurora` for `aurora.particle.json`); where they differ, the
  identifier follows the file's name. The filter matches either. It opens for a look when you click it: its tab's name is slanted, and the next file you
  click takes that tab. Double-click the file or the tab, edit the effect or save it, and it stays open. Open
  ones stand out in the list, with a dot while they have unsaved changes.
- **A texture** shows below the list, as large as the panel is wide, with its size. *Use as texture* makes it the texture of the effect in
  front, when that effect is one of this pack's; the one it already uses is underlined.
- **A file Vibrant Visuals reads** (a texture set, `lighting/global.json`, the colour grading) shows its text.
  For the ones the Vibrant Visuals panel edits for this effect, *Edit in Vibrant Visuals* goes there.
- Right-click a file to copy its path (a texture's without the extension, as an effect writes it) or, in the
  desktop app, to show it in its folder.

The round arrow reads the pack again after files changed outside Oxygen.

## The Inspector

The Inspector lists every component of a particle effect, grouped into Emitter, Shape, Motion, Lifetime,
Appearance and Logic.

- **Turning components on and off.** Components the effect uses are open with their settings. The rest are
  shown as single dimmed rows. Use the switch on a row to turn a component on or off. Turning one off and back on
  restores what it had.
- **Choosing a kind.** Some components come in kinds that exclude each other, like the emitter's rate (instant,
  steady or manual) or its shape (point, sphere, box…). Pick the kind from the row's dropdown. Each kind keeps
  its own settings, so you can try one and switch back without losing anything.
- **The same goes for fields with modes,** like a colour that can be one colour, a gradient or per-channel
  Molang: switching back brings back what you had.
- **Grouping.** The layout button in the top bar groups the fields by category or by evaluation phase. By
  phase orders them by when the game runs them, with step numbers.
- **Folding and moving categories.** Click a category's name (Emitter, Shape, Motion…) to fold it shut. The
  arrow that shows at the right of the name, or a right-click, opens the category in a tab of its own, which
  you can move, dock and close like any panel; the Inspector leaves it out meanwhile, and closing the tab puts
  it back. The View menu lists them under *Inspector categories in their own tab*.
- **Keys.** Rest the pointer on a field's label, or a component's title, to see the key it writes
  (`emitter_rate_steady › spawn_rate`) and what the game does with it.

## The viewport

| Action | How |
| --- | --- |
| Play, pause | Space |
| Restart | R |
| Frame the particles | F |
| Orbit | Drag |
| Pan | Middle-drag or Shift+drag |
| Look around and fly | Right-drag, with W A S D (Q down, E up, Shift faster) |
| Zoom | Mouse wheel |
| Inspect a particle | Click it |
| Inspect an emitter, its shape, the kill plane or the entity | Click it |
| The viewport's menu | Right-click without dragging |
| Move the entity, a locator or a path point | Click it, then drag a handle or use the arrow keys and Page Up / Page Down (Shift: half a block) |
| Turn the entity, the emitter or a scene effect | Right-click it › *Turn* (or press R while moving it; G moves again), then drag a ring or use the arrow keys (15°, Shift: 1°) |
| Move the emitter | Right-click it › *Move the emitter*, in /particle and Script API spawning (on an entity it goes where the entity does) |
| Move a block | Right-click it › *Move*, then the same; Delete removes it |

These are the default keys; *Settings › Keyboard* changes them (see below). Settings › Viewport sets the field
of view, how fast the camera turns, zooms and flies, inverted up and down, the resolution and the background.

The toolbar picks how the effect is started (/particle, Script API or Animation), since the game treats them
differently, and whether it repeats. *Repeat* loops looping effects seamlessly, as they do on an entity (in the
game, /particle plays a looping effect once), and plays other effects again when they end. *Classic*, *Vibrant* or *Split* picks the lighting. *Show* turns helpers
on and off: the emitter shape, trajectory paths, facing axes, velocity arrows and more. Facing axes and velocity
arrows go on as many particles as *Settings › Viewport › Helper limits* allows (500 and 2,000 to begin with);
past that a sample gets them, and each particle keeps its helper while it lives. *Views* saves camera positions
with the effect, in the file's `oxygen` block.

**Screenshots, GIFs and videos:** right-click the viewport (or use the Preview menu). *Copy a screenshot* puts it
on the clipboard; *Save a screenshot* also keeps the file. *Record a GIF* or *Record a video*, *from here* or
*from the start*, plays the effect on at a steady frame rate and records it, until the effect ends (an effect
that repeats forever records 10 s). Videos are MP4, or WebM where the browser can't make MP4. Screenshots leave
out the background and the helpers by default, so only the particles (and any blocks) are in the picture; GIFs
and videos keep the background, since a GIF can only leave a pixel out or keep it (soft glows come out dithered)
and a video can't leave it out at all. *Camera while recording* (in the same menus) moves the camera from the
view you start at: an orbit, a sway, pushing in, pulling back, rising, or a spiral. Over a set length a move takes
the whole recording, so an orbit GIF loops; until the effect ends, each takes 8 s. Every capture has a small
Oxygen mark in the bottom right; Settings › Viewport › Screenshots and recordings turns it off, and sets the
sizes, the length, the frame rates and what's in them. The desktop app keeps captures in Pictures/Oxygen and puts a GIF or
video on the clipboard as a file, to paste into a chat or a folder; the web app downloads them; VS Code asks
where.

**Going back in time:** drag the time slider under the viewport, or use the Timeline panel, to scrub back up to
30 seconds. Playing on from there continues from that moment.

## Inspecting and debugging

Click a particle to inspect it. The Debug panel then shows its age, position, colour and randoms, every value
it worked out this frame, in order, and the emitter's variables. *Step evaluation* goes one calculation at a
time, and *Next frame* moves one frame on. While a particle is inspected, Molang fields show its values next to
each name.

*Its turn* lists the variables the particle's own expressions use, in its update and in its render. Variables
belong to the emitter, so every particle takes its turn with them: plain values are what this particle set, dim
ones (marked *read*) are what ran before it in that pass. The render pass starts once every particle has
updated, so a variable only the update sets reads there as the last particle left it. That's why `v.index` and
`v.r` in the aurora example look so different between the two columns.

Drag or type any value the panel shows for the particle (age, lifetime, position, velocity, rotation) or the
emitter (its variables, the temps) to change it in the preview from then on. Paused, the frame is drawn again
with it. The game has nothing like this; restarting plays the effect as written.

The *Execution log* tab records every Molang evaluation of a frame in the order the game runs them: the emitter
first, then each particle completely, then render preparation.

The **Timeline** panel shows how many particles were alive, when each emitter lived and every event it fired.
The **Graph** panel plots a selected field over time: it runs the effect aside and records the field for up to
300 particles. The shaded band is the range of values across all of them at each age (darker: the middle
80 %), the bright line is the particle nearest the median, and the thin lines are a few others chosen to differ
as much as possible, so random phases and offsets all show. Point at the plot to read the values at that age;
*Resample* runs it again with other random numbers. The **Pipeline** panel draws one frame in the game's
order: lines carry variables from the field that sets them to the fields that read them, and dashed lines are
reads that come before any write on the first frame.

## Inputs and scenarios (Context)

Effects often read values that come from outside, such as variables a script or an entity sets, or queries
about the entity an effect is attached to. The Context panel lists them all. Give each a value, or drive it over time, and save named
**scenarios** (for example "on fire" or "in water") to switch between them. Scenarios are stored in the file's
`oxygen` block, which the game ignores. With no scenario, nothing outside the effect supplies values, as when
it's spawned with /particle; setting any input starts one.

*Inputs* takes three kinds of name. Variables (`v.size`) are handed to the emitter once, before its
`creation_expression`, like a Script API variable map. Temps (`t.size`) go into the temp store that all effects
share, just before the effect starts, as a parent's event leaves them. Context values (`c.size`) are there for
every expression to read; Molang can't set them. *Pin* writes a value again before every update, which the
game never does.

`pre_effect_script` is the Molang an animation's `particle_effects` entry runs on the entity before the effect
starts; what it sets in `v.` is handed to the effect.

*Queries* lists every query the effect calls. Camera, time, position and entity queries follow the scene unless
you set them; a call with changing arguments can take a value per argument.

*Data flow* lists the effect's variables and temps with the fields that set and read each (beside the scenario
when the panel is wide enough). A temp nothing here
sets shows *outside*: temps are global in the game, so other effects (and, in the game, every client entity and
animation) can see and overwrite them.

*Fill unset with* gives every input without a value 0, 1, an empty string or a number of your own; drag that
number to change all the ones it filled together. Queries nothing supplies have the same. Every number box
applies as you drag it. Query values and pinned variables change the running preview at once; other variables
are handed over at spawn, so the effect starts over with them.

## Events

Events run when something happens: an emitter starts or ends, a time on the timeline is reached, a particle
hits something. An event can set variables, start another effect and play a sound.

- **The graph** (left) shows what fires each event and what it spawns, across every effect involved. Drag the
  background to pan, drag a card by its header to move it, and use *Tidy* to put the cards back. Ctrl+wheel
  zooms. Click a card to edit it.
- **The editor** (right) edits the selected event. Use *Add* to give it an expression, a spawned effect or a
  sound.
- **Steps** do several things in order, top to bottom. Each step is a small event of its own. Adding steps to an
  event that already does something moves that into the first step. A step that spawns an effect and has an
  expression runs the expression after the spawn.
- **Random choice** picks one of several options by weight. Use it for variety, like a firework that bursts in
  one of four colours.

When an event starts another effect, it can hand values over: temps (`t.*`) set earlier in the event can be
read by the new effect's *pre-effect* expression, which runs in the child before its `creation_expression`.
The graph shows which values cross over and flags missing ones. The spawn types are the file's own:
`emitter` (a new emitter, independent of this one), `emitter_bound` (follows this emitter, with its own
lifetime) and `particle` or `particle_with_velocity` (one particle of the child effect).

## Curves

Curves turn one number into another over a shape you draw: linear, smooth (Catmull-Rom), Bézier or a chain of
Bézier keys. Read them in Molang as `v.curve_name`; the game writes each to its variable every update. Drag
points to shape the curve: they snap to the grid unless you hold Shift, and in a Bézier chain a double-click
adds a key. The input can be any Molang, such as a particle's age. A Bézier control point pulls the curve
without it passing through; a Catmull-Rom end node sets the slope where the curve starts and ends. A Bézier
chain has no range: its keys are input values, and the curve holds its end values outside them.

## Textures and flipbooks

The Texture panel shows the effect's texture with the area each particle uses outlined. Drag the area to move
it, or its corner to resize; values snap to texture units, and the arrow keys nudge it (Shift resizes). Pink
outlines show where live particles are sampling. Middle, right or Space+drag pans, and the wheel zooms. An area
set by Molang is edited in the Inspector. For animations, switch the billboard's texture to *Flipbook* in the
Inspector and set the frame size, step and speed.

*Paint* edits the texture itself. Painted pixels show in the preview right away, and *Save texture* writes the
PNG to the pack. Ctrl+Z undoes strokes; B, E, G and I pick the tool.

No resource pack? *Import image…* in the Texture panel (or *File › Import texture image…*, or dropping a picture
on the panel) uses a picture file as the effect's texture. It stands in for the effect's texture path; an effect
on a vanilla texture gets `textures/particle/<file name>` instead. Oxygen keeps imported images for next time
(very big ones only until it closes), but they aren't in any pack: put the PNG at that path in your pack before you deploy.
*Remove import* goes back to the pack's file.

## Vibrant Visuals and glow

With the viewport on *Vibrant* or *Split*, the preview draws Minecraft's newer lighting, matched to the game
and using your pack's lighting settings. There, particles are lit by the world like blocks: lit and unlit
particles look the same, and additive ones come out a bit brighter.

All a particle has to say about it is its texture's **texture set**: a file next to the texture with the same
name (`flame_atlas.texture_set.json` for `flame_atlas.png`). The Vibrant Visuals panel edits that file, with the
file's own keys and values, and shows its text on the right as you change it:

```
"minecraft:texture_set": {
  "color": "flame_atlas",
  "metalness_emissive_roughness_subsurface": [0, 255, 204, 0]
}
```

- **`color`** is the colour texture.
- **`metalness_emissive_roughness_subsurface`** (MERS) says how the surface takes light, in four numbers from
  0 to 255: `metalness` (0 is not a metal), `emissive` (how much it shines with its own colour whatever the
  light: this is what makes a particle glow), `roughness` (0 is mirror-smooth, 255 matte) and `subsurface`
  (how much light passes through). Older texture sets have three numbers under
  `metalness_emissive_roughness`; Oxygen keeps whichever the file has.
  - *Not set* leaves the key out: the particle is lit by the world like a block, dimmer at night and in caves.
  - *Values* gives one value each for the whole texture.
  - *Texture* names a PNG next to the texture that holds the four values for every pixel, in its red, green,
    blue and alpha. Oxygen can make one from the colour texture (`<texture>_mers.png`): `emissive` rises with a
    pixel's brightness above *Threshold*, times *Gain*; `roughness` is the same everywhere; `metalness` is 0.
    The panel shows the texture it made, or the one already in the pack.

You see the result in the viewport straight away. *Save to pack* writes the texture set (and the MERS texture,
when Oxygen made one) next to the texture.

The panel also edits the two pack-wide files Vibrant Visuals draws with. They apply to everything in the pack,
not only this effect. Each section shows whether the pack has the file, previews changes at once, and shows the
file's text beside the controls. Nothing is written until that section's *Save to pack*; *Revert* drops the
changes. A file the pack already has keeps its formatting and everything Oxygen doesn't edit: only the keys you
changed are set. A pack without the file gets a new one.

- **Color grading** (`color_grading/color_grading.json`): the tone mapping `operator` (`generic`, `aces`,
  `hable`, `reinhard`, `reinhard_luma`, `reinhard_luminance`) and the `midtones` grade: `saturation`,
  `contrast`, `gain` and `offset` for red, green and blue, and `gamma`. Shadows, highlights and temperature
  aren't previewed, so Oxygen leaves them as the file has them.
- **Lighting** (`lighting/global.json`): the `illuminance` and `color` of the `sun`, the `moon` and the
  `ambient` light, each a single value or one per time of day, plus `orbital_offset_degrees` and the emissive
  `desaturation`. Times in this file count from noon: 0 is noon and 0.5 midnight. *By time of day* turns a
  single value into keys; *Add a key* adds one at the time of day shown. The preview scales its measured
  particle light by how these values differ from the game's defaults at that time.

Players only see any of this when the pack's `manifest.json` has `"capabilities": ["pbr"]`. The preview shows
it anyway, and the desktop app's Deploy adds the capability to the copy it puts in the game.

`emissive` in the game is much stronger than its number suggests. A soft, translucent particle at 255 turns
into a solid, hard-edged blob, because even its faint edges shine at full strength. Keep it low (around 8 to
24) on soft textures, and save 255 for cutout textures with a clear outline. The preview also copies the game's
auto exposure: something glowing in view at night darkens everything else for a few seconds.

## The scene

The Scene panel, among the tool tabs, sets up the world the preview plays in. It's saved in the file's `oxygen` block, which the game
ignores; turn *Save the scene in the file* off to leave the file alone.

Its sections fold away: click a title to close one you aren't using. Oxygen remembers which are open. Where the
panel is wide they sit side by side.

- **Spawn:** what starts the effect. */particle* and *Script API* place it at a position; a rotation there is
  for previewing local-space motion only, since the game can't rotate an effect spawned that way. *Animation*
  plays it on the entity, the way an animation or animation controller's `particle_effects` entry does.
  Right-click the emitter in the viewport to move it (G) or turn it (R) with handles.
- **Entity:** the stand-in for the mob the effect plays on. It's there only while the effect is spawned by an
  animation, since nothing else uses it.
- **World:** the ground and its height, the time of day, and sky and block light. Only effects with
  `particle_appearance_lighting` change with light in classic rendering; the rest stay fully bright, as in the
  game.
- **Blocks:** blocks to collide with. *Place* puts the chosen block where you click in the viewport
  (Shift+click removes); *Fill* fills a box between two corners, hollow or solid; *Import structure* places a
  `.mcstructure`. Particles collide with each block's real collision box, and the kill-in-blocks and
  only-in-blocks components test them.
- **Other effects:** effects that play in the same world as this one, so temps, particle caps and whole-world
  queries interact as they do in the game. The field offers the other open effects and the ones in this
  effect's pack.

### Effects on an entity

Set *Spawned by* to *Animation* to play the effect the way an animation or animation controller does on a mob.
The two rows under it are the keys of the animation's `particle_effects` entry:

- **`locator`:** one of the model's locators, or *none* for the entity itself. On a locator the game flips the
  effect's axes: an unturned locator points X to the entity's left, Y down and Z behind it, so an effect that
  rises without a locator falls on one. Without a locator X points to its right, Y up and Z behind it. The
  viewport draws the axes the effect gets (X red, Y green, Z blue).
- **`bind_to_actor`:** off is `bind_to_actor: false`. The effect starts where the entity stands and stays there,
  or at the world origin when it has a locator, with the world's axes, as in the game.
- **`pre_effect_script`** is in the Context panel, with the scenario it belongs to.

The Entity section describes the mob:

- **Position, yaw and movement:** it stands at the world origin to begin with: set its position in the panel,
  or click the entity in the viewport and drag it. It can stand still facing any way, or move around that
  position: a circle, a line, a path or a bob. A path's points are relative to it; the entity walks between
  them at a steady speed, facing where it goes. Effects follow, but the game adds none of the entity's speed
  to their particles.
- **`scale` and `collision_box`:** the entity's `minecraft:scale` and `minecraft:collision_box` (width and
  height), which `emitter_shape_entity_aabb` fills. The scale also grows locator offsets and the effect's size
  on a locator.
- **Despawns:** the entity despawns, or the controller state that played the effect ends, that many seconds
  after the effect starts. Its emitters stop, and particles in its space vanish with it; world-space ones
  carry on.
- **Locators:** the model's locators, as a geometry file has them. *Import model* reads a `.geo.json` and takes its
  locators, worked out through their bones the way the game does. *Add* makes one by hand, written like a
  geometry file: an offset in pixels (16 to a block) on the model, whose front is -Z, and a rotation in degrees.
  Adding one puts the effect on it. Click a name to edit it.

Effects on an entity loop their looping emitters, and every emitter holds at most 1,000 particles, as anywhere
else. See [how Oxygen matches the game](accuracy.md#effects-on-an-entity) for the rest.

## Testing in Minecraft (desktop app)

The desktop app can put your pack into Minecraft and start the effect in your world:

1. In Minecraft, open a world and run `/connect localhost:19131` once.
2. In Oxygen, open the Game menu and press *Deploy and spawn*. Oxygen copies the pack into Minecraft, reloads
   it and starts the effect. *Spawn again* replays it.

Packs go to the first Minecraft install Oxygen finds. To use another one, pick it under *Deploy to* in the Game
menu. *Custom paths…* sets each place by hand, for setups Oxygen doesn't find by itself (Bedrock launchers on
Linux and macOS, a copy on another drive):

- **Resource packs:** the folder your pack is copied into, as it is.
- **Behavior packs:** where Oxygen Link goes (the small behavior pack for spawning with a scenario's variables).
  Leave it empty to skip it.
- **Content log:** a folder of `ContentLog` files, or one log file, for the game's errors in Problems. Leave it
  empty for none.

The fields start from where packs go now, and browsing for a resource packs folder fills the empty ones it
suggests. Oxygen remembers the paths.

The Problems panel also shows what the game's content log said about the file, as *Game* entries.

Spawning with a scenario's variables goes through the Oxygen Link behavior pack, which deploys with your pack.
Turn it on once per world: Edit world → Behavior packs → Available → Oxygen Link. Minecraft lists new packs
after it rescans, which opening that screen does.

## Updates

- **Desktop app:** on Windows and Linux, new versions download in the background and install the next time Oxygen
  restarts; the status bar offers *Restart to update* once one is ready (Oxygen asks first if anything is unsaved).
  *Help › Check for updates…* looks right away, and *Settings › General* can make it only tell you instead. On
  macOS, Oxygen tells you about a new version and links to its download.
- **Web app:** always the newest when you open it. A tab left open notices a newer version and offers a reload.
- **VS Code:** the extension updates through VS Code, like any other.

## Settings and keys

*File › Settings…* (Ctrl+, or the gear in the top bar) has everything in one place, with a search box that looks
through every section and every key:

- **General:** asking before closing unsaved effects, how the Inspector groups its fields, the code text size, how long status
  messages stay, and in the desktop app the zoom of the whole window.
- **Preview:** how a newly opened effect starts (spawned by /particle, a script or an animation, repeating or not,
  its speed and time of day), and Classic or Vibrant Visuals rendering. An effect whose scene is saved in its
  file keeps its own.
- **Viewport:** the camera, the resolution, the background, the frame rate readout, the helpers and how many of
  them it draws, and screenshots and GIFs.
- **Keyboard:** every command, including each panel and layout, with its keys. Click a key to change it, *+* to
  add another, *×* to remove one. Oxygen warns when a key would also run something else, or when the browser
  keeps it for itself (Ctrl+W, Ctrl+T, Ctrl+N). The fly keys can be rebound too (Z Q S D on an AZERTY keyboard,
  say), and so can the Molang editors' rename, go to definition, uses, comment and format.
- **Settings data:** export your settings to a file and import them in another Oxygen, or reset them.

Keys without Ctrl or Alt (Space, R, F) wait while you type in a field. Settings are kept by each app: in the
browser for the web app, in VS Code's storage for the extension (shared by its editors), and in a settings file
for the desktop app. *Help › About Oxygen* shows the version, what's new, what the engine is built from, and the
system details to paste into a bug report.
