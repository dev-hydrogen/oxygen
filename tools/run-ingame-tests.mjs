#!/usr/bin/env node
// Drives the Oxygen test pack in a running Minecraft (world "Oxygen Test Lab" loaded) through BedrockMCP:
// runs each test function, waits, and saves screenshots to test-results/ingame/<test>[_view].png
//   node tools/run-ingame-tests.mjs [t01 t02 … e01 …] [--setup]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const mcp = (...args) => execFileSync(process.execPath, [join(root, 'tools', 'bedrock-mcp.mjs'), ...args], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outDir = join(root, 'test-results', 'ingame');
mkdirSync(outDir, { recursive: true });

const fnDir = join(root, 'packages', 'testpack', 'out', 'oxygen_testpack_bp', 'functions', 'oxygen');
const args = process.argv.slice(2);
const tests = JSON.parse(execFileSync(process.execPath, ['-e', `
	import('${join(root, 'node_modules', 'tsx', 'dist', 'esm', 'api', 'index.mjs').replace(/\\/g, '/')}').catch(()=>null);
`], { encoding: 'utf8' }) || 'null') ?? null;
void tests;

// test ids + waits from the generated checklist (keeps this script dependency-free)
const checklist = readFileSync(join(root, 'packages', 'testpack', 'out', 'CHECKLIST.md'), 'utf8');
const entries = [...checklist.matchAll(/^## ([te]\d+) — .*?\n[\s\S]*?Wait ([\d.]+)s/gm)].map((m) => ({ id: m[1], wait: parseFloat(m[2]) }));
const selected = args.filter((a) => /^[te]\d+$/.test(a));
const run = selected.length ? entries.filter((e) => selected.includes(e.id)) : entries;

mcp('call', 'focus');
if (args.includes('--setup')) {
	mcp('chat', '/function oxygen/setup');
	await sleep(1500);
}
for (const t of run) {
	mcp('chat', `/function oxygen/${t.id}_cam`);
	await sleep(1500); // let chunks load before placing blocks / spawning
	mcp('chat', `/function oxygen/${t.id}`);
	await sleep(t.wait * 1000 + 600);
	console.log(mcp('screenshot', join(outDir, `${t.id}.png`), '1280', '720').split('\n')[0]);
	for (const view of ['behind', 'above', 'frontleft', 'frontright']) {
		try {
			readFileSync(join(fnDir, `${t.id}_${view}.mcfunction`));
		} catch {
			continue;
		}
		mcp('chat', `/function oxygen/${t.id}_${view}`);
		await sleep(700);
		console.log(mcp('screenshot', join(outDir, `${t.id}_${view}.png`), '1280', '720').split('\n')[0]);
	}
}
