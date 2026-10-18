# Building and development

## Setup

You need Node.js 22 or newer, pnpm (run `corepack enable` once) and Git.

```sh
git clone --recurse-submodules https://github.com/dev-hydrogen/oxygen.git
cd oxygen
pnpm install
```

`pnpm install` also downloads Mojang's query and schema data (from Mojang's `bedrock-samples`) into
`packages/metadata`. If GitHub rate-limits the download, set a `GITHUB_TOKEN` environment variable and run
`pnpm metadata`.

The particle engine and the Molang compiler are Git submodules in `vendor/`. If you cloned without
`--recurse-submodules`, run `git submodule update --init`.

## Running and building

| Task | Command | Result |
| --- | --- | --- |
| Web app with live reload | `pnpm dev` | http://localhost:5178 |
| Web app for hosting | `pnpm --filter @oxygen/web build` | `apps/web/dist/`, a static site that runs from any folder |
| Desktop app, from source | `pnpm desktop` | the app in a window |
| Desktop installer | `pnpm package:desktop` | `apps/desktop/release/` (Windows installer; dmg and AppImage are set up) |
| VS Code extension | `pnpm package:vscode` | `apps/vscode/oxygen-particle-editor-<version>.vsix` |
| MCP server for coding agents | `pnpm --filter @oxygen/mcp build` | `apps/mcp/dist/server.cjs` ([setup](agents.md)) |

To try a `.vsix`, install it in VS Code with *Extensions: Install from VSIX…*, or run
`code --install-extension apps/vscode/oxygen-particle-editor-<version>.vsix`.

`pnpm desktop` downloads Electron into its cache on the first run. Where that cache can't be written (a read-only
`~/Library/Caches/electron`, for instance), point it elsewhere: `electron_config_cache=/tmp/electron-cache pnpm desktop`.
Oxygen runs one window at a time: starting it again with a file, as `open_in_editor` does for agents, opens the
file in the window already running.

## Tests

| Command | What it checks |
| --- | --- |
| `pnpm test` | Unit tests, the engine against in-game results, the Molang compiler |
| `pnpm typecheck` | Types in every package |
| `pnpm test:vscode` | The extension inside a real VS Code |
| `pnpm test:webview-sync` | VS Code's text editor and Oxygen's editor staying in sync |
| `pnpm test:desktop` | The desktop app end to end |
| `pnpm test:update` | The packaged desktop app finding, downloading and offering an update from a local feed |
| `pnpm test:soak` | Five minutes of switching files and editing (`-- --minutes 30` for longer) |

The VS Code and desktop tests can also run against packaged builds:
`node apps/vscode/test/run.mjs --extension <unpacked folder>` and
`node tools/desktop-test.mjs --packaged <path to Oxygen.exe>`.

## Repository layout

| Path | What's there |
| --- | --- |
| `apps/web`, `apps/vscode`, `apps/desktop` | The three apps |
| `apps/mcp` | The MCP server for coding agents, and the headless preview page it renders with |
| `packages/ui` | The editor itself: panels, fields and the viewport (Svelte 5) |
| `packages/format` | Reading and editing particle JSON without disturbing its formatting |
| `packages/lang` | The Molang editor: completion, problems, fixes and refactors |
| `packages/effect` | Whole-effect analysis: run order, data flow, problems, which effect spawns which |
| `packages/scene` | The world around the effect: blocks, structures, the stand-in entity, Vibrant Visuals |
| `packages/gamelink` | Talking to Minecraft: deploying packs, `/connect`, the content log |
| `packages/metadata` | Mojang's query and schema data, downloaded at install |
| `packages/testpack` | The in-game test pack and its recorded results |
| `vendor/wintersky` | The particle engine and renderer |
| `vendor/molangjs` | The Molang compiler |
| `tools/` | Test drivers, the in-game runners, and the logo and icon renderers |

## Checking behaviour in Minecraft

Oxygen's engine is checked against the game with a test pack of small effects, each answering one question.

**1. Install the pack** (with Minecraft closed, since it only notices new development packs when it starts):

```sh
pnpm --filter @oxygen/testpack run deploy
```

This builds the packs, copies them into Minecraft's development pack folders and creates a flat world called
**Oxygen Test Lab** with both turned on. Use `run`, because `pnpm deploy` on its own is a different pnpm command.

**2. Run tests** in that world, from chat:

```
/function oxygen/setup        (once: noon, clear weather, spectator mode)
/function oxygen/t01_cam      (go to the test's station)
/function oxygen/t01          (run the test)
```

`packages/testpack/out/CHECKLIST.md` says what each test asks, how long to wait and what each probe (marked by
coloured wool, left to right) means.

**3. Recorded results** live in `packages/testpack/fixtures/`, and `pnpm test` replays them against the engine.
When a result changes in a new game version, update the fixture.

The bundled examples can be checked in the same world: `node tools/examples-ingame.mjs` copies them in, and
`node tools/examples-ingame.mjs --run` plays each one from its saved camera and screenshots it.

The runners that screenshot automatically (`tools/run-ingame-tests.mjs` and `--run` above) need an in-game
automation server for screenshots and input (`tools/bedrock-mcp.mjs` is its client). Commands go through
`tools/game-bridge.ts` over `/connect` when it's running.

## Continuous integration and releases

`.github/workflows/ci.yml` runs the tests, type checks and builds on every push to `main` and on pull requests.

`.github/workflows/release.yml` makes a release from a version tag:

1. Set the same `version` in `apps/vscode/package.json` and `apps/desktop/package.json`, and add a section for
   it at the top of `CHANGELOG.md` (drop the "(unreleased)" from its heading).
2. Tag and push: `git tag 0.2.0 && git push origin 0.2.0`.
3. The workflow builds the desktop app on Windows, macOS and Linux, the VS Code extension and the MCP server
   (`oxygen-mcp.zip`, which the setup prompt in [agents.md](agents.md) downloads from the latest release), then
   creates a draft release with the newest changelog section as its notes. Check the draft on the Releases page and
   publish it.

Publishing the release is what updates everyone: the desktop app looks at the latest published release (drafts
don't count), using the `latest.yml` (Windows) and `latest-linux.yml` (AppImage) files the release carries; open
web tabs offer a reload once the site is deployed; and MCP servers installed from `oxygen-mcp.zip` tell the agent.
The macOS app can't install updates until it's signed and notarized, so it links to the release instead.

If the repository has `VSCE_PAT` and `OVSX_PAT` secrets, the same tag also publishes the extension to the
Visual Studio Marketplace and Open VSX.

## The web app on Cloudflare

The web app is served at [oxygen.hydrogen.exposed](https://oxygen.hydrogen.exposed) as a static Cloudflare
Worker. `apps/web/cloudflare.config.ts` names the Worker and its domain. To publish the current state, sign in
with the [`cf` CLI](https://developers.cloudflare.com/cf/) (`npx cf auth login`) and run:

```sh
pnpm --filter @oxygen/web run deploy
```

This builds with `--mode cloudflare`, which adds the Cloudflare Vite plugin, into `apps/web/.cloudflare/`, then
uploads it. A plain `vite build` is unaffected and still produces `apps/web/dist/`.

## Other tools

- `tools/logo.mjs` and `tools/icons.mjs` render the logos and the app icons.
- `tools/ui-shot.mjs` screenshots the web app after scripted steps, and `tools/png-sample.mjs` reads colours out
  of screenshots.
- `tools/vv-calibrate.mjs` and `tools/vv-fit.py` fit the Vibrant Visuals preview to in-game measurements.
- `tools/vv-probe-calibrate.mjs` renders any effect from a pack in the Vibrant Visuals preview with an in-game
  camera, to compare with a capture from the game pixel for pixel (emissive strength, bloom, auto exposure).
