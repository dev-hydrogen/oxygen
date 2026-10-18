// Minecraft itself, through Oxygen's game link (packages/gamelink): deploy the pack to the game's development
// folders, run commands through /connect, spawn an effect like /particle or a script, and read the content log.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectServer, deployHelper, deployPackDetailed, entriesFor, entryPath, findInstalls, latestContentLog, parseContentLog, particleSpawnCommand, readPack, scriptSpawnCommand, type GameInstall } from '@oxygen/gamelink';
import { z } from 'zod';
import { identifierOf, packRoot } from './pack';
import { data, existing, text, tool } from './util';

let link: ConnectServer | null = null;
/** where each install's content log was at the last deploy: entries after it are about what was deployed */
const logMarks = new Map<string, { file: string; size: number }>();

function install(name?: string): GameInstall {
	const all = findInstalls();
	if (!all.length) throw new Error('No Minecraft Bedrock install found on this machine (looked for the launcher, Preview and the older Store layouts).');
	if (!name) return all[0];
	const hit = all.find((i) => i.name.toLowerCase() === name.toLowerCase());
	if (!hit) throw new Error(`No install named "${name}". Found: ${all.map((i) => i.name).join(', ')}`);
	return hit;
}

async function command(line: string, version = 1) {
	if (!link?.connected) throw new Error(`Minecraft isn't connected. Call game_connect, then type /connect localhost:${link?.port ?? 19131} in the game's chat (cheats must be on).`);
	return link.command(line.replace(/^\//, ''), 8000, version);
}

export function registerGameTools(server: McpServer): void {
	server.registerTool(
		'game_status',
		{
			title: 'Minecraft status',
			description: 'The Minecraft Bedrock installs on this machine (development pack folders, content log) and whether a game is connected through /connect.',
			annotations: { readOnlyHint: true },
		},
		() =>
			tool(() =>
				data(link?.connected ? 'Minecraft is connected.' : link ? `Listening on port ${link.port}; not connected yet.` : 'Not listening for Minecraft (game_connect starts it).', {
					installs: findInstalls().map((i) => ({ name: i.name, comMojang: i.comMojang, contentLog: latestContentLog(i) })),
				}),
			),
	);

	server.registerTool(
		'game_connect',
		{
			title: 'Listen for Minecraft',
			description:
				"Start the server Minecraft joins with /connect, so game_spawn and game_command can run commands in the game. Returns what to type in the game's chat (the world needs cheats on). The same link the desktop app's Game menu uses.",
			inputSchema: { port: z.number().int().min(1024).max(65535).optional().describe('Default 19131 (the next free one if taken)') },
		},
		({ port }) =>
			tool(async () => {
				link ??= new ConnectServer(port ?? 19131);
				const p = await link.start();
				if (p === null) throw new Error(`Couldn't listen for Minecraft: ${link.error}`);
				return text(link.connected ? `Connected (port ${p}).` : `Listening. In Minecraft, type: /connect localhost:${p}`);
			}),
	);

	server.registerTool(
		'game_deploy',
		{
			title: 'Deploy the pack to Minecraft',
			description:
				"Copy the resource pack around a particle file (the folder with its manifest.json) into the game's development_resource_packs, replacing the previous copy. `helper` also installs Oxygen Link, a small behavior pack that lets game_spawn spawn effects the way the Script API does (with variables). Activate the packs in a world once; afterwards `reload` runs /reload all when connected. Writes into the game's folders.",
			inputSchema: {
				path: z.string().describe('A particle file in the pack, or the pack folder'),
				install: z.string().optional().describe('Which install (see game_status); default the first'),
				helper: z.boolean().optional(),
				reload: z.boolean().optional(),
			},
			annotations: { destructiveHint: true, openWorldHint: true },
		},
		(a) =>
			tool(async () => {
				const given = existing(a.path);
				const root = existsSync(join(given, 'manifest.json')) ? given : packRoot(given);
				if (!root || !existsSync(join(root, 'manifest.json'))) throw new Error(`No pack with a manifest.json around ${given}.`);
				const inst = install(a.install);
				const pack = readPack(root);
				const res = deployPackDetailed(pack, inst);
				const log = latestContentLog(inst);
				if (log) logMarks.set(inst.name, { file: log, size: statSync(log).size });
				const lines = [`Deployed ${pack.name} (${pack.kind} pack) to ${res.target}.`];
				if (res.addedPbr) lines.push("The deployed copy got the 'pbr' capability so Vibrant Visuals stays available; the pack itself is unchanged.");
				if (a.helper) lines.push(`Oxygen Link installed at ${deployHelper(inst)}.`);
				if (a.reload) lines.push(`/reload all: ${JSON.stringify(await command('reload all'))}`);
				return text(lines.join('\n'));
			}),
	);

	server.registerTool(
		'game_spawn',
		{
			title: 'Spawn in Minecraft',
			description:
				"Spawn an effect in the connected game, 3 blocks in front of the player at eye height: like /particle (`mode: 'command'`, default) or like the Script API with a MolangVariableMap (`mode: 'script'`, needs Oxygen Link: game_deploy with helper). `move` shifts it along the world axes. The pack must be active in the world.",
			inputSchema: {
				effect: z.string().optional().describe('Identifier (or give `path`)'),
				path: z.string().optional().describe('A particle file: its identifier is used'),
				mode: z.enum(['command', 'script']).optional(),
				variables: z.record(z.string(), z.union([z.number(), z.array(z.number())])).optional().describe('Script mode: numbers, [r,g,b] or [r,g,b,a]'),
				move: z.array(z.number()).length(3).optional(),
			},
			annotations: { openWorldHint: true },
		},
		(a) =>
			tool(async () => {
				const id = a.effect ?? (a.path ? identifierOf(readFileSync(existing(a.path), 'utf8')) : null);
				if (!id) throw new Error('Give `effect` (an identifier) or `path` (a particle file).');
				const move = a.move as [number, number, number] | undefined;
				const line = a.mode === 'script' ? scriptSpawnCommand(id, a.variables ?? {}, move) : particleSpawnCommand(id, move);
				const res = await command(line);
				return text(`/${line}\n${res.statusCode === 0 ? 'OK' : `Status ${res.statusCode}`}: ${res.statusMessage}`);
			}),
	);

	server.registerTool(
		'game_command',
		{
			title: 'Run a Minecraft command',
			description: 'Run a slash command in the connected game ("time set noon", "tp @s 0 100 0", "reload all") and return its status. `version: 42` uses the newer command parser (exact tp, execute … run).',
			inputSchema: { command: z.string(), version: z.number().int().optional() },
			annotations: { destructiveHint: true, openWorldHint: true },
		},
		({ command: line, version }) =>
			tool(async () => {
				const res = await command(line, version ?? 1);
				return text(`${res.statusCode === 0 ? 'OK' : `Status ${res.statusCode}`}: ${res.statusMessage}`);
			}),
	);

	server.registerTool(
		'game_log',
		{
			title: "Minecraft's content log",
			description:
				"What the game's content log says about particle files: Molang errors at load (the game dropped that field), unknown components, runtime errors such as unset variable reads. By default the entries since the last game_deploy, for the given file (or every file). Each comes with the JSON path it's about when that can be told.",
			inputSchema: {
				path: z.string().optional().describe('Only entries about this particle file'),
				install: z.string().optional(),
				since_deploy: z.boolean().optional().describe('Default true'),
				limit: z.number().int().min(1).max(500).optional().describe('Default 100 (the newest)'),
			},
			annotations: { readOnlyHint: true },
		},
		(a) =>
			tool(() => {
				const inst = install(a.install);
				const file = latestContentLog(inst);
				if (!file) throw new Error(`No content log for ${inst.name}. Turn on Settings › Creator › Content Log File in the game.`);
				const bytes = readFileSync(file);
				const mark = logMarks.get(inst.name);
				const from = a.since_deploy !== false && mark?.file === file ? Math.min(mark.size, bytes.length) : 0;
				let entries = parseContentLog(bytes.subarray(from).toString('utf8'));
				if (a.path) entries = entriesFor(entries, a.path);
				const shown = entries.slice(-(a.limit ?? 100)).map((e) => ({ time: e.time, level: e.level, category: e.category, file: e.file, path: entryPath(e), expression: e.expression, message: e.message }));
				return data(`${entries.length} entries in ${file}${from ? ' since the last deploy' : ''}:`, shown);
			}),
	);
}
