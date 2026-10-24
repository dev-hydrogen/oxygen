# Using Oxygen

A tour of the editor and the usual tasks. Most of it works the same in the web app, VS Code and the desktop app;
where they differ, it says so.

## The window

- **Top bar:** the menus, the command palette (Ctrl+K: every action, panel and layout by name), Settings (the
  gear) and Save. In the desktop app it's also the window's title bar. The Oxygen logo opens *About Oxygen*.
- **Tabs:** every open effect has a tab. Middle-click one to close it; right-click it to close others, those to
  its right or the saved ones. In VS Code, each effect opens in its own editor instead.
- **Right-click** brings up a menu wherever there's something to do: the viewport, tabs, the Outliner, a
  component's header or a field in the Inspector, an input in the Context panel, a problem. Inside text fields
  the browser's own menu stays, for copying and pasting.
- **Panels:** the viewport, the Inspector and the tool tabs (Expression, Problems, Context, Curves, Events,
  Texture and more). Drag a panel's tab to move it, double-click it to fill the window, and bring back closed
  panels from the View menu.
- **Layouts:** the View menu resets the window to one of seven layouts, each set up for a job such as editing,
  events, curves, lighting or debugging.
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

## The Inspector

The Inspector lists every component of a particle effect, grouped into Emitter, Shape, Motion, Lifetime,
Appearance and Logic.

- **Turning components on and off.** Components the effect uses are open with their settings. The rest are
  shown as single dimmed rows. Use the switch on a row to turn a component on or off. Turning one off and back on
  restores what it had.
- **Choosing a kind.** Some components come in kinds that exclude each other, like the emitter's rate (burst,
  steady or manual) or its shape (point, sphere, box…). Pick the kind from the row's dropdown. Each kind keeps
  its own settings, so you can try one and switch back without losing anything.
- **The same goes for fields with modes,** like a colour that can be one colour, a gradient or per-channel
  Molang: switching back brings back what you had.
- **Categories or Phases.** The Phases view orders the fields by when the game runs them, with step numbers.

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
| The viewport's menu | Right-click without dragging |
| Move the entity, a locator or a path point | Click it, then drag a handle or use the arrow keys and Page Up / Page Down (Shift: half a block) |
| Turn the entity, the emitter or a scene effect | Right-click it › *Turn* (or press R while moving it; G moves again), then drag a ring or use the arrow keys (15°, Shift: 1°) |
| Move the emitter | Right-click it › *Move the emitter*, in /particle and Script API spawning (on an entity it goes where the entity does) |
| Move a block | Right-click it › *Move*, then the same; Delete removes it |

These are the default keys; *Settings › Keyboard* changes them (see below). Settings › Viewport sets the field
of view, how fast the camera turns, zooms and flies, inverted up and down, the resolution and the background.

The toolbar picks how the effect is started (/particle, Script API or Entity), since the game treats them
differently, and whether it repeats. *Classic*, *Vibrant* or *Split* picks the lighting. *Show* turns helpers
on and off: the emitter shape, trajectory paths, facing axes, velocity arrows and more. Facing axes and velocity
arrows go on as many particles as *Settings › Viewport › Helper limits* allows (500 and 2,000 to begin with);
past that a sample gets them, and each particle keeps its helper while it lives. *Views* saves camera positions
with the effect.

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

The **Timeline** panel shows how many particles were alive, when each emitter lived and every event it fired.
The **Graph** panel plots a selected field over time.

## Inputs and scenarios (Context)

Effects often read values that come from outside, such as variables a script or an entity sets, or queries
about the entity an effect is attached to. The Context panel lists them all. Give each a value, or drive it over time, and save named
**scenarios** (for example "on fire" or "in water") to switch between them. Scenarios are stored in the file's
`oxygen` block, which the game ignores.

*Variables in* takes three kinds of name. Variables (`v.size`) are handed to the emitter once, before its
`creation_expression`, like a Script API variable map. Temps (`t.size`) go into the temp store that all effects
share, just before the effect starts, as a parent's event leaves them. Context values (`c.size`) are there for
every expression to read; Molang can't set them. *Pin* writes a value again before every update.

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
- **Steps** do several things in order. Each step is a small event of its own. Adding steps to an event that
  already does something moves that into the first step.
- **Random choice** picks one of several options by weight. Use it for variety, like a firework that bursts in
  one of four colours.

When an event starts another effect, it can hand values over: temps (`t.*`) set earlier in the event can be
read by the new effect's *pre-effect* expression. The graph shows which values cross over and flags missing
ones.

## Curves

Curves turn one number into another over a shape you draw: linear, smooth (Catmull-Rom), Bézier or a chain of
Bézier keys. Read them in Molang as `v.curve_name`. Drag points to shape the curve. The input can be any Molang,
such as a particle's age.

## Textures and flipbooks

The Texture panel shows the effect's texture with the area each particle uses outlined. Drag the area to move
it, or its corner to resize. Pink outlines show where live particles are sampling. For animations, switch the
billboard's texture to *Flipbook* in the Inspector and set the frame size, step and speed.

No resource pack? *Import image…* in the Texture panel (or *File › Import texture image…*, or dropping a picture
on the panel) uses a picture file as the effect's texture. It stands in for the effect's texture path; an effect
on a vanilla texture gets `textures/particle/<file name>` instead. Oxygen keeps imported images for next time
(very big ones only until it closes), but they aren't in any pack: put the PNG at that path in your pack before you deploy.
*Remove import* goes back to the pack's file.

## Vibrant Visuals and glow

With the viewport on *Vibrant* or *Split*, the Vibrant Visuals panel previews Minecraft's newer lighting. To
make a particle glow there, choose what glows: nothing, the whole particle, or just its bright parts. You see
the result in the viewport straight away. *Save to pack* writes the texture set (and the glow map, for bright
parts) next to the texture.

Glow in the game is much stronger than its slider suggests. A soft, translucent particle with full glow turns
into a solid, hard-edged blob, because even its faint edges shine at full strength. Keep the glow low (around 8
to 24 of 255) on soft textures, and save full glow for cutout textures with a clear outline. The preview also
copies the game's auto exposure: something glowing in view at night darkens everything else for a few seconds.

## The scene

The Scene panel sets up the world around the effect: the ground and its height, blocks to collide with (paint
them, fill a box or import a `.mcstructure`), and a stand-in entity for effects attached to mobs. These settings
are saved in the file's `oxygen` block.

### Effects on an entity

Turn on *Spawn on it* to play the effect the way an animation or animation controller does on a mob. Then:

- **Locator:** pick one, or *None* for the entity itself. *Import from a model* reads a `.geo.json` and takes its
  locators, worked out through their bones the way the game does. *Add locator* makes one by hand, written like
  a geometry file: an offset in pixels (16 to a block) on the model, whose front is -Z, and a rotation.
- **Axes:** the viewport draws the axes the effect gets (X red, Y green, Z blue). On a locator the game flips
  them: an unturned locator points X to the entity's left, Y down and Z behind it, so an effect that rises
  without a locator falls on one. Without a locator X points to its right, Y up and Z behind it.
- **Follows it:** off is `bind_to_actor: false`. The effect starts where the entity stands and stays there, or
  at the world origin when it has a locator, with the world's axes, as in the game.
- **Where it stands:** at the world origin to begin with. Set it in the panel, or click the entity in the
  viewport and drag it. A path's points are relative to it.
- **Movement and facing:** stand still facing any way, walk a circle, a line or a path, or bob. Effects follow,
  but the game adds none of the entity's speed to their particles.
- **Scale and size:** `minecraft:scale` and the collision box that `entity_aabb` fills.
- **Goes away:** the entity despawns, or the controller state that played the effect ends, after some seconds.
  Its emitters stop, and particles in its space vanish with it.

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

The Problems panel also shows what the game's content log said about the file.

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

- **General:** asking before closing unsaved effects, the Inspector's layout, the code text size, how long status
  messages stay, and in the desktop app the zoom of the whole window.
- **Preview:** how a newly opened effect starts (spawned by /particle, a script or an entity, repeating or not,
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
