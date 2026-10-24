import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ConnectServer, deployHelper, deployPack, entriesFor, entryPath, findInstalls, folderInstall, installPaths, latestContentLog, parseContentLog, pathsInstall, readLogSince, readPack } from '../src/index';

const LOG = `00:02:20[Molang][error]-particles/sparks.json | ParticleEffect::_extractComponents | minecraft:particle_appearance_billboard | ParticleAppearanceBillboardComponent | size | 0.3 +* 1 | Error: binary Add '+' operator at end of expression
00:02:20[Molang][error]-particles/sparks.json | events | pop | v.x = 1 +* 2; | Error: binary Add '+' operator at end of expression
00:02:21[Effects][error]-particles/other.json | Unrecognized component name 'oxygen:meta' in particle effect
00:02:22[Scripting][warning]-something without a file
continued line`;

describe('content log', () => {
	it('parses file, context, expression and message', () => {
		const e = parseContentLog(LOG);
		expect(e).toHaveLength(4);
		expect(e[0]).toMatchObject({ category: 'Molang', level: 'error', file: 'particles/sparks.json', expression: '0.3 +* 1' });
		expect(e[0].message).toContain('binary Add');
		expect(entryPath(e[0])).toBe('particle_effect/components/minecraft:particle_appearance_billboard/size');
		expect(entryPath(e[1])).toBe('particle_effect/events/pop');
		expect(e[3].message).toContain('continued line');
		expect(entriesFor(e, 'C:/pack/particles/sparks.json')).toHaveLength(2);
	});

	it('reads only complete new lines, the newest part of a big log, and starts over when the file shrank', () => {
		const file = join(mkdtempSync(join(tmpdir(), 'oxygen-log-')), 'ContentLog.txt');
		writeFileSync(file, 'one\ntwo\nthr');
		expect(readLogSince(file, 0)).toEqual({ text: 'one\ntwo\n', end: 8 });
		appendFileSync(file, 'ee\n');
		expect(readLogSince(file, 8)).toEqual({ text: 'three\n', end: 14 });
		expect(readLogSince(file, 14)).toEqual({ text: '', end: 14 });
		// over the limit: the partial first line is dropped
		expect(readLogSince(file, 0, 9)).toEqual({ text: 'three\n', end: 14 });
		writeFileSync(file, 'new\n');
		expect(readLogSince(file, 14)).toEqual({ text: 'new\n', end: 4 });
	});
});

describe('deploy', () => {
	it('deploys into a folder chosen by hand as it is', () => {
		const tmp = mkdtempSync(join(tmpdir(), 'oxygen-folder-'));
		const pack = join(tmp, 'MyRP');
		mkdirSync(join(pack, 'particles'), { recursive: true });
		writeFileSync(join(pack, 'manifest.json'), JSON.stringify({ header: { name: 'My RP', uuid: 'u' }, modules: [{ type: 'resources' }] }));
		mkdirSync(join(tmp, 'logs'));
		writeFileSync(join(tmp, 'logs', 'ContentLog1.txt'), '');
		// any folder: the pack goes straight in, with nowhere for behavior packs
		const anywhere = folderInstall(join(tmp, 'out', 'packs'), []);
		expect(deployPack(readPack(pack), anywhere)).toBe(join(tmp, 'out', 'packs', 'MyRP'));
		expect(anywhere.logs).toBe(join(tmp, 'logs'));
		expect(deployHelper(anywhere)).toBeNull();
		// a resource_packs folder: Oxygen Link goes next door
		const rp = folderInstall(join(tmp, 'game', 'development_resource_packs'), []);
		expect(rp.packs).toEqual({ resource: join(tmp, 'game', 'development_resource_packs'), behavior: join(tmp, 'game', 'development_behavior_packs') });
		expect(deployHelper(rp)).toContain(join(tmp, 'game', 'development_behavior_packs'));
	});

	it('takes every path set by hand as it is', () => {
		const tmp = mkdtempSync(join(tmpdir(), 'oxygen-paths-'));
		const paths = { resource: join(tmp, 'rp'), behavior: join(tmp, 'elsewhere', 'bp'), logs: join(tmp, 'game.log') };
		const inst = pathsInstall(paths);
		expect(installPaths(inst)).toEqual(paths);
		// a log file of its own; a log folder that isn't there yet reads as no log
		writeFileSync(paths.logs, '');
		expect(latestContentLog(inst)).toBe(paths.logs);
		expect(latestContentLog(pathsInstall({ ...paths, logs: join(tmp, 'missing') }))).toBeNull();
		expect(deployHelper(inst)).toContain(join(tmp, 'elsewhere', 'bp'));
		expect(deployHelper(pathsInstall({ ...paths, behavior: null }))).toBeNull();
		// a found install's own paths
		expect(installPaths({ name: 'Minecraft', comMojang: join(tmp, 'com.mojang'), logs: null })).toEqual({ resource: join(tmp, 'com.mojang', 'development_resource_packs'), behavior: join(tmp, 'com.mojang', 'development_behavior_packs'), logs: null });
	});

	it('copies a resource pack into development_resource_packs', () => {
		const tmp = mkdtempSync(join(tmpdir(), 'oxygen-deploy-'));
		const pack = join(tmp, 'MyRP');
		mkdirSync(join(pack, 'particles'), { recursive: true });
		writeFileSync(join(pack, 'manifest.json'), JSON.stringify({ header: { name: 'My RP', uuid: 'u' }, modules: [{ type: 'resources' }] }));
		writeFileSync(join(pack, 'particles', 'a.json'), '{}');
		mkdirSync(join(pack, '.git'));
		const comMojang = join(tmp, 'com.mojang');
		const target = deployPack(readPack(pack), { name: 'test', comMojang, logs: null });
		expect(readFileSync(join(target, 'particles', 'a.json'), 'utf8')).toBe('{}');
		expect(existsSync(join(target, '.git'))).toBe(false);
		expect(target).toContain('development_resource_packs');
		// the deployed copy keeps Vibrant Visuals available; the pack itself is untouched
		expect(JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')).capabilities).toEqual(['pbr']);
		expect(JSON.parse(readFileSync(join(pack, 'manifest.json'), 'utf8')).capabilities).toBeUndefined();
	});

	it('finds installs from environment folders', () => {
		const tmp = mkdtempSync(join(tmpdir(), 'oxygen-env-'));
		mkdirSync(join(tmp, 'Minecraft Bedrock', 'Users', 'Shared', 'games', 'com.mojang'), { recursive: true });
		const found = findInstalls({ APPDATA: tmp, LOCALAPPDATA: join(tmp, 'none') });
		expect(found.map((f) => f.name)).toEqual(['Minecraft']);
	});
});

describe('/connect server', () => {
	it('sends commands and resolves with the game response', async () => {
		const server = new ConnectServer(19188);
		expect(await server.start()).toBe(19188);
		// a stand-in for the game: answers every commandRequest
		const game = new WebSocket('ws://127.0.0.1:19188');
		game.on('message', (data) => {
			const m = JSON.parse(String(data));
			if (m.header.messagePurpose === 'commandRequest') {
				game.send(JSON.stringify({ header: { requestId: m.header.requestId, messagePurpose: 'commandResponse' }, body: { statusCode: 0, statusMessage: `ran ${m.body.commandLine}` } }));
			}
		});
		await new Promise((r) => game.on('open', r));
		await new Promise((r) => setTimeout(r, 50));
		const res = await server.command('particle test:fx ~ ~1 ~');
		expect(res.statusMessage).toBe('ran particle test:fx ~ ~1 ~');
		game.close();
		server.stop();
	});
});

describe('Oxygen Link helper pack', () => {
	it('deploys a behavior pack that spawns with a variable map', async () => {
		const { deployHelper, helperPackFiles, particleSpawnCommand, scriptSpawnCommand, HELPER_UUID } = await import('../src/helper');
		const files = helperPackFiles();
		const manifest = JSON.parse(files['manifest.json']);
		expect(manifest.header.uuid).toBe(HELPER_UUID);
		expect(manifest.modules.some((m: { type: string }) => m.type === 'script')).toBe(true);
		expect(files['scripts/main.js']).toContain("event.id !== 'oxygen:link_spawn'");
		// the script body is valid JavaScript once the import is taken out
		expect(() => new Function(files['scripts/main.js'].replace(/^import[^\n]*\n/, ''))).not.toThrow();
		const tmp = mkdtempSync(join(tmpdir(), 'oxygen-link-'));
		const target = deployHelper({ name: 'test', comMojang: tmp, logs: null })!;
		expect(target).toContain('development_behavior_packs');
		expect(existsSync(join(target, 'scripts', 'main.js'))).toBe(true);
		expect(scriptSpawnCommand('a:b', { 'v.size': 0.3, 'variable.tint': [1, 0, 0] })).toBe('scriptevent oxygen:link_spawn {"effect":"a:b","vars":{"variable.size":0.3,"variable.tint":[1,0,0]}}');
		expect(scriptSpawnCommand('a:b', { 'v.k': 1 }, [2, 0, -1])).toBe('scriptevent oxygen:link_spawn {"effect":"a:b","vars":{"variable.k":1},"move":[2,0,-1]}');
		expect(files['scripts/main.js']).toContain('data.move');
		expect(particleSpawnCommand('a:b')).toBe('particle a:b ^ ^1.5 ^3');
		expect(particleSpawnCommand('a:b', [3, 0, -1.5])).toBe('execute positioned ^ ^1.5 ^3 run particle a:b ~3 ~ ~-1.5');
	});
});

describe('connect server ports', () => {
	it('moves on to the next free port when one is taken, and reports when none is free', async () => {
		const a = new ConnectServer(19190);
		const b = new ConnectServer(19190);
		const c = new ConnectServer(19190, 2);
		try {
			expect(await a.start()).toBe(19190);
			expect(await b.start()).toBe(19191);
			expect(b.port).toBe(19191);
			// only 19190 and 19191 to try, both taken
			expect(await c.start()).toBeNull();
			expect(c.error).toMatch(/19190.19191/);
		} finally {
			a.stop();
			b.stop();
			c.stop();
		}
	});
});
