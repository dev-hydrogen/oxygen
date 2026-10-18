// Builds the MCP server (esbuild → dist/server.cjs) and the headless preview page (Vite → dist/preview), and copies
// what they read at run time: the examples, the vanilla sprites and Oxygen's guides.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import * as esbuild from 'esbuild';
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
rmSync(resolve(here, 'dist'), { recursive: true, force: true });

cpSync(resolve(here, '../../packages/ui/static/examples'), resolve(here, 'dist/examples'), { recursive: true });
cpSync(resolve(here, '../../vendor/wintersky/assets'), resolve(here, 'dist/vanilla'), { recursive: true });
mkdirSync(resolve(here, 'dist/docs'), { recursive: true });
for (const doc of ['accuracy.md', 'molang.md']) cpSync(resolve(here, '../../docs', doc), resolve(here, 'dist/docs', doc));

await esbuild.build({
	entryPoints: [resolve(here, 'src/server.ts')],
	outfile: resolve(here, 'dist/server.cjs'),
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	// Playwright finds its browsers relative to its own install
	external: ['playwright'],
	// prefer ESM builds: jsonc-parser's UMD build hides its requires from the bundler
	mainFields: ['module', 'main'],
	banner: { js: '#!/usr/bin/env node' },
	define: { OXYGEN_MCP_VERSION: JSON.stringify(JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')).version) },
	sourcemap: true,
	logLevel: 'warning',
});
chmodSync(resolve(here, 'dist/server.cjs'), 0o755);

await viteBuild({
	root: resolve(here, 'preview'),
	base: './',
	configFile: false,
	plugins: [svelte()],
	logLevel: 'warn',
	build: { outDir: resolve(here, 'dist/preview'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 5000, modulePreload: false },
});
console.log('mcp built');
