<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/logo-on-dark.png">
    <img alt="Oxygen, a particle IDE for Minecraft Bedrock" src="docs/media/logo-on-light.png" width="720">
  </picture>
</p>

<p align="center">
  <img src="docs/media/prism-nebula.gif" width="32%" alt="Prism nebula">
  <img src="docs/media/aurora.gif" width="32%" alt="Aurora">
  <img src="docs/media/magic-circle.gif" width="32%" alt="Magic circle">
</p>

Oxygen is an editor for Minecraft Bedrock particle effects. Its preview behaves the way the game does, quirks
included, so what you see while you work is what players will see. It's a ground-up rewrite of
[Snowstorm](https://github.com/JannisX11/snowstorm) by JannisX11, and runs in the browser, in VS Code and as a
desktop app.

- **A preview you can trust.** Oxygen's particle engine was checked against the game, behaviour by behaviour.
  Effects that look wrong in other editors look right here. See [how Oxygen matches the game](docs/accuracy.md)
  and the [side-by-side showcase](docs/showcase.md).
- **Understand what an effect does.** See the order everything runs in, inspect any particle, step through a
  frame, and scrub back through the last 30 seconds.
- **Write Molang comfortably.** Completion, explanations on hover, problems explained in plain words, quick
  fixes and refactors. See [writing Molang](docs/molang.md).
- **Build whole effects.** Curves, events, child effects, textures and flipbooks, blocks and a moving entity in
  the scene, and a Vibrant Visuals preview with glow.

[Join the discord!](https://discord.gg/TEq6PNb25T)

## Get Oxygen

**Web.** Open [oxygen.hydrogen.exposed](https://oxygen.hydrogen.exposed) in any modern browser (Chrome, Edge or
Firefox). Pick an example or start a new effect, then use File › Open files or Open resource pack folder for your
own. In Chrome and Edge, Oxygen saves straight back into the pack; in other browsers, Save downloads the file. The
app can be installed from the browser's address bar to work offline.

**VS Code.** Install **Oxygen Particle Editor** from the Extensions view (Visual Studio Marketplace or Open VSX), or
install a `.vsix` with *Extensions: Install from VSIX…*. Files named `*.particle.json` open in Oxygen. For other
particle files, run *Open in Oxygen* from the command palette, or keep the text editor and run *Show preview*. The text
editor also gets Molang completion, hover help and problems. *Oxygen: Open example…* (or the editor's Examples
menu) opens one of the bundled examples as a new file you can save into your pack.

**Desktop (Windows, macOS, Linux).** Download the installer from the
[releases page](https://github.com/dev-hydrogen/oxygen/releases) and run it. Open particle
files or a whole resource pack folder. The desktop app can also deploy your pack to Minecraft and spawn the
effect in your world: run `/connect localhost:19131` in the game once, then use the Game menu.

**Coding agents.** An MCP server lets agents such as Claude Code create, edit, check and preview effects with
Oxygen's engine. See [Oxygen for coding agents](docs/agents.md).

New to the editor? The [user guide](docs/guide.md) walks through the panels and the usual tasks.

## Layouts

Seven layouts suit different jobs. Pick one from the View menu or the command palette (Ctrl+K), and drag any
panel to make your own.

| | |
| --- | --- |
| ![Editor](docs/screenshots/layout-editor.png) **Editor**: viewport, Inspector and the tool tabs | ![Preview](docs/screenshots/layout-preview.png) **Preview**: a large viewport and the Inspector |
| ![Code](docs/screenshots/layout-code.png) **Code**: the file as text with a floating preview | ![Events](docs/screenshots/layout-events.png) **Events**: the events graph and timeline |
| ![Curves](docs/screenshots/layout-curves.png) **Curves and motion**: curves and value graphs | ![Look](docs/screenshots/layout-look.png) **Look and lighting**: texture and Vibrant Visuals |
| ![Debugging](docs/screenshots/layout-debug.png) **Debugging**: inspect a particle, step through a frame | |

## Build from source

You need Node.js 22 or newer, pnpm (`corepack enable`) and Git.

```sh
git clone --recurse-submodules https://github.com/dev-hydrogen/oxygen.git
cd oxygen
pnpm install
pnpm dev                # the web app at http://localhost:5178
```

| To build | Run | You get |
| --- | --- | --- |
| Web app | `pnpm --filter @oxygen/web build` | `apps/web/dist/`, a static site |
| VS Code extension | `pnpm package:vscode` | `apps/vscode/oxygen-particle-editor-<version>.vsix` |
| Desktop app | `pnpm package:desktop` | an installer in `apps/desktop/release/` |
| MCP server for coding agents | `pnpm --filter @oxygen/mcp build` | `apps/mcp/dist/server.cjs` |

Tests, the repository layout and the in-game test pack are covered in [building and development](docs/building.md).
What changed from Snowstorm is in the [changelog](CHANGELOG.md).

## License

Oxygen is licensed under the GPL-3.0, like Snowstorm. The engine forks in `vendor/` keep their own licenses.
