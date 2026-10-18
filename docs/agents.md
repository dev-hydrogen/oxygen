# Oxygen for coding agents (MCP)

Oxygen includes an [MCP](https://modelcontextprotocol.io) server. With it, a coding agent such as Claude Code,
Cursor or Codex can create particle effects, edit them, check them for problems and look at them. It uses the
same engine, analysis and viewport as the editor, so what the agent sees is what you would see in Oxygen, and
what players see in the game.

## Setting it up

You need [Node.js](https://nodejs.org) 22 or newer.

### The quick way: let your agent do it

Copy this prompt into Claude Code, Codex or another coding agent. It downloads the server, installs it and adds it
to the agent. Oxygen has the same prompt under *Help › Set up a coding agent…*, with a copy button.

```text
Set up the Oxygen MCP server for yourself, so you can create, check and preview Minecraft Bedrock particle effects with Oxygen's engine.

1. Check that Node.js 22 or newer is installed (`node --version`). If it isn't, stop and tell me.
2. Download https://github.com/dev-hydrogen/oxygen/releases/latest/download/oxygen-mcp.zip and unzip it into my home folder, so the server is at ~/oxygen-mcp/server.cjs (on Windows, %USERPROFILE%\oxygen-mcp\server.cjs). If that folder already exists, replace it.
3. In that folder, run `npm install --omit=dev`, then `npx playwright install chromium`.
4. Add it as an MCP server named "oxygen" for every project, running `node` with the absolute path to server.cjs as its only argument, over stdio:
   - Claude Code: `claude mcp add --scope user oxygen -- node <absolute path>/server.cjs`
   - Codex: `codex mcp add oxygen -- node <absolute path>/server.cjs`
   - Any other agent: add `"oxygen": { "command": "node", "args": ["<absolute path>/server.cjs"] }` to the `mcpServers` in its MCP settings.
5. Tell me if I need to restart you to load it. Once it's loaded, call its list_examples tool to check that it works.
```

Paste it again to update to a newer release.

### By hand

1. Download [oxygen-mcp.zip](https://github.com/dev-hydrogen/oxygen/releases/latest/download/oxygen-mcp.zip) from
   the latest release and unzip it somewhere it can stay. It holds a folder, `oxygen-mcp`.
2. In that folder, install Playwright and its headless Chromium, which the preview renders in:

   ```sh
   npm install --omit=dev
   npx playwright install chromium
   ```

3. Add the server to your agent. It talks over stdio:

   ```sh
   claude mcp add --scope user oxygen -- node /path/to/oxygen-mcp/server.cjs   # Claude Code
   codex mcp add oxygen -- node /path/to/oxygen-mcp/server.cjs                 # Codex
   ```

   Other agents take the same command in their MCP settings:

   ```json
   {
   	"mcpServers": {
   		"oxygen": { "command": "node", "args": ["/path/to/oxygen-mcp/server.cjs"] }
   	}
   }
   ```

### From a clone of the repository

To run the server as it is on `main`, or while working on it, build it from a clone (see [building](building.md)):

```sh
pnpm install
pnpm --filter @oxygen/mcp build
npx playwright install chromium
```

and point your agent at `apps/mcp/dist/server.cjs` instead. `pnpm package:mcp` makes the same zip the releases
carry, in `apps/mcp/release/`.

Relative file paths are relative to the folder the agent starts the server in, usually your project.

## What the agent can do

| Tool | What it does |
| --- | --- |
| `reference` | The particle format and how the game really behaves: every component with its fields, defaults and when the game evaluates them; materials; Molang queries and math; the [game rules](accuracy.md) Oxygen measured in Minecraft; and `measurements`, each in-game test with its recorded result |
| `list_examples` | The bundled examples, to start from |
| `create_effect` | A new effect file from Oxygen's starting effect or a copy of an example under a new identifier |
| `read_effect` | A summary of an effect: components, curves, events and what they spawn, variables and where they're set and read, scenarios, problems |
| `edit_effect` | Edits by JSON path (set, Molang, remove, insert, rename), applied together like an edit in Oxygen: formatting, key order and comments stay as they were. Reports what changed and the problems afterwards |
| `write_effect` | Replaces a file's whole text (or creates it), for rewrites too big for a list of edits. Refuses text that isn't valid JSON; reports what changed and the problems |
| `check_effect` | The problems the Problems panel would show |
| `simulate_effect` | Runs the effect and reports, at chosen times, how many particles are alive and drawn, where they are, which emitters and events ran, and runtime problems such as unset variables or the particle cap |
| `preview_effect` | Pictures of the effect at chosen times, by default on one labelled sheet, with the same numbers. Optionally saves the PNGs, and can leave the pictures out of the reply once saved (`return_images: false`) |
| `open_in_editor` | Opens the file in the Oxygen desktop app for you to look at and play with |
| `record_gif` | An animated GIF of the effect, drawn by the same viewport, saved to a file (a few of its frames come back in the reply) |

For understanding how an effect is evaluated, and debugging it:

| Tool | What it does |
| --- | --- |
| `inspect_effect` | Everything the engine holds at a moment: every particle (position, velocity, age, lifetime, its randoms, size, UV, colour, facing), every emitter with its lifetime state and variable map, query values and temps |
| `trace_effect` | Every Molang evaluation of one particle and its emitter during a frame, in the order the game runs them, with the value of every part of each expression and the variables it changed. `particle: "next"` catches a particle from its very first evaluation |
| `log_effect` | Every evaluation of every emitter and particle during a frame, in execution order |
| `evaluate_molang` | Runs Molang inside the effect without changing it. With `at` (a field's path) it runs at the exact moment that field is evaluated, for each particle: what each particle saw in the variables they share, which is how effects with index counters or render-pass layouts work. Without an effect, it runs on its own with the values you give |
| `track_effect` | Values frame by frame: particle attributes, a field's value over each particle's age, or emitter variables |
| `analyze_molang` | Checks an expression without running it: errors as the game reports them, what it reads and writes, the rules for a pack version, formatted forms |

And Minecraft itself, through the same link as the desktop app's Game menu:

| Tool | What it does |
| --- | --- |
| `game_status` | The installs on this machine and whether a game is connected |
| `game_connect` | Listens for `/connect` from the game |
| `game_deploy` | Copies the pack into the game's development folders (and, optionally, Oxygen Link for script-style spawns) |
| `game_spawn` | Spawns an effect in front of the player, like `/particle` or a script with variables |
| `game_command` | Runs a command |
| `game_log` | What the game's content log says about particle files since the last deploy |

Previews and simulations play the effect the way `/particle` does unless asked otherwise (`spawn`: `script` or
`entity`), and play it once, like the game. They use a fixed clock and the same random seed every time, so the
same file always gives the same pictures and numbers. The camera frames every particle across the chosen times,
from an angle the agent picks; it can also be placed by hand or taken from a view saved in the file. The ground
grid sits at y = 0 and the small outlined cube is one block.

The debugging tools replay the effect the same way, so a `time` names one frame exactly: the one that reaches
it. They run in the editor's own session, so what they report is what the editor shows.

Other effects can play in the same scene (`others`: identifiers and positions), like the Scene panel's "Other
effects". Without `others`, the ones the file's scene keeps play, as in the editor.

## Opening effects in Oxygen

`open_in_editor` starts the desktop app with the file, or hands the file to the app already running, which opens it
in a tab (or brings its tab forward). The app follows the file on disk, so the agent's later changes show there as
they're made; a tab with unsaved changes keeps them and says so. The server finds Oxygen through `OXYGEN_DESKTOP`
(the app's executable) if set, then the desktop build of the repository the server was built in, then an installed
app.

## Packs, textures and child effects

The server finds the resource pack around a file the same way the desktop app does: the nearest folder above it
with a `manifest.json`, or else the folder holding `particles/`. From the pack it reads:

- **textures**, as PNG. Vanilla particle textures the pack doesn't replace come with Oxygen. A texture that
  can't be found draws as the game's magenta and black, and the tools say which one. TGA textures aren't shown.
- **child effects** that events spawn, by identifier, falling back to the bundled examples. Effects copied from
  an example that spawns others come with a note: the game needs those children in the pack too.
- **Vibrant Visuals** lighting and texture sets, for previews with `mode: "vv"`.

## Things to know

- Pictures come from software rendering in headless Chromium. They show exactly what the editor's viewport
  shows, but each one takes a moment; a sheet of four 480 × 360 pictures takes one to two seconds.
- `edit_effect` refuses a file that isn't valid JSON. Fix that with `write_effect`, which replaces the whole text.
- The game tools change things outside Oxygen: `game_deploy` writes into the game's development pack folders and
  `game_command` runs commands in your world. Agents ask before calling tools like these unless you've allowed them.
