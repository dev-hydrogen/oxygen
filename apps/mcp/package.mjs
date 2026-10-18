// Packs the built server (dist/) into release/oxygen-mcp.zip: everything it needs but Playwright and its Chromium,
// which `npm install` and `npx playwright install chromium` fetch where it's unpacked. The zip holds one folder,
// oxygen-mcp/. Its name carries no version, so the latest release always has it at the same address.
import { zipSync } from 'fflate';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, 'dist');
const own = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'));

const files = {};
const add = (path, data) => (files[`oxygen-mcp/${path}`] = [typeof data === 'string' ? new TextEncoder().encode(data) : data, { mtime: new Date('2026-01-01') }]);
const walk = (dir) => {
	for (const name of readdirSync(dir).sort()) {
		const full = join(dir, name);
		// source maps point into the repository: no use without it
		if (statSync(full).isDirectory()) walk(full);
		else if (!name.endsWith('.map')) add(relative(dist, full).split('\\').join('/'), readFileSync(full));
	}
};
walk(dist);

add(
	'package.json',
	`${JSON.stringify(
		{
			name: 'oxygen-mcp',
			version: own.version,
			private: true,
			description: own.description,
			license: own.license,
			homepage: 'https://github.com/dev-hydrogen/oxygen/blob/main/docs/agents.md',
			bin: { 'oxygen-mcp': './server.cjs' },
			engines: { node: '>=22' },
			dependencies: own.dependencies,
		},
		null,
		'\t',
	)}\n`,
);
add(
	'README.md',
	`# Oxygen MCP server ${own.version}

Tools for coding agents to create, check, simulate and preview Minecraft Bedrock particle effects with Oxygen's
engine. Needs Node.js 22 or newer.

1. In this folder: \`npm install --omit=dev\`, then \`npx playwright install chromium\` (the preview renders in
   headless Chromium).
2. Add it to your agent as an MCP server named \`oxygen\` that runs \`node /path/to/oxygen-mcp/server.cjs\` over stdio:
   - Claude Code: \`claude mcp add --scope user oxygen -- node /path/to/oxygen-mcp/server.cjs\`
   - Codex: \`codex mcp add oxygen -- node /path/to/oxygen-mcp/server.cjs\`
   - Others: \`{ "mcpServers": { "oxygen": { "command": "node", "args": ["/path/to/oxygen-mcp/server.cjs"] } } }\`

Updating: replace this folder with the new release's and run step 1 again. Everything the tools do:
https://github.com/dev-hydrogen/oxygen/blob/main/docs/agents.md
`,
);

mkdirSync(resolve(here, 'release'), { recursive: true });
const out = resolve(here, 'release', 'oxygen-mcp.zip');
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`${relative(process.cwd(), out)}: ${Object.keys(files).length} files, ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
