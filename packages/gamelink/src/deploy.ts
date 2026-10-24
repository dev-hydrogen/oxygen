import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export interface GameInstall {
	name: string;
	/** the com.mojang folder holding development_*_packs */
	comMojang: string;
	logs: string | null;
	/**
	 * Folders packs are copied into instead of com.mojang's development folders (a folder chosen by hand).
	 * `behavior` is null when there's nowhere for behavior packs (Oxygen Link) to go.
	 */
	packs?: { resource: string; behavior: string | null };
}

/** The folder a pack of this kind is copied into, or null when the install has none for it */
export function packFolder(install: GameInstall, kind: 'resource' | 'behavior'): string | null {
	if (install.packs) return kind === 'resource' ? install.packs.resource : install.packs.behavior;
	return join(install.comMojang, kind === 'resource' ? 'development_resource_packs' : 'development_behavior_packs');
}

/** Minecraft Bedrock installs on this machine: GDK (Microsoft Store/launcher), Preview, and the older UWP layout */
export function findInstalls(env: NodeJS.ProcessEnv = process.env): GameInstall[] {
	const out: GameInstall[] = [];
	const appData = env.APPDATA ?? '';
	const local = env.LOCALAPPDATA ?? '';
	const candidates: [string, string, string | null][] = [
		['Minecraft', join(appData, 'Minecraft Bedrock', 'Users', 'Shared', 'games', 'com.mojang'), join(appData, 'Minecraft Bedrock', 'logs')],
		['Minecraft Preview', join(appData, 'Minecraft Bedrock Preview', 'Users', 'Shared', 'games', 'com.mojang'), join(appData, 'Minecraft Bedrock Preview', 'logs')],
		['Minecraft (UWP)', join(local, 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang'), join(local, 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'logs')],
		['Minecraft Preview (UWP)', join(local, 'Packages', 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang'), null],
	];
	for (const [name, comMojang, logs] of candidates) if (existsSync(comMojang)) out.push({ name, comMojang, logs: logs && existsSync(logs) ? logs : null });
	return out;
}

/**
 * Any folder chosen by hand, taken as it is: resource packs are copied straight into it. Behavior packs (Oxygen
 * Link) go to its `behavior_packs` sibling when it's a `resource_packs` or `development_resource_packs` folder,
 * and nowhere otherwise. The content log is the nearest `logs` folder above it with content logs in, else the
 * first found install's (the game that's likely running).
 */
export function folderInstall(folder: string, found: GameInstall[] = findInstalls()): GameInstall {
	const resource = resolve(folder);
	const m = /^(development_)?resource_packs$/i.exec(basename(resource));
	const behavior = m ? join(dirname(resource), `${m[1] ?? ''}behavior_packs`) : null;
	let logs: string | null = null;
	for (let dir = dirname(resource), i = 0; i < 6 && !logs; dir = dirname(dir), i++) {
		const p = join(dir, 'logs');
		if (existsSync(p) && readdirSync(p).some((f) => f.startsWith('ContentLog'))) logs = p;
		if (dirname(dir) === dir) break;
	}
	return { name: resource, comMojang: dirname(resource), logs: logs ?? found.find((i) => i.logs)?.logs ?? null, packs: { resource, behavior } };
}

/**
 * The places an install uses, each of which can be set by hand (Linux and macOS launchers, unusual setups):
 * where resource packs and behavior packs are copied, and the content log (a folder of ContentLog files, or one
 * file). Null: nowhere (no Oxygen Link, no content log).
 */
export interface DeployPaths {
	resource: string;
	behavior: string | null;
	logs: string | null;
}

/** The paths an install deploys to and reads the log from */
export function installPaths(install: GameInstall): DeployPaths {
	return { resource: packFolder(install, 'resource')!, behavior: packFolder(install, 'behavior'), logs: install.logs };
}

/** Paths set by hand, taken as they are */
export function pathsInstall(paths: DeployPaths): GameInstall {
	const resource = resolve(paths.resource);
	return { name: resource, comMojang: dirname(resource), logs: paths.logs ? resolve(paths.logs) : null, packs: { resource, behavior: paths.behavior ? resolve(paths.behavior) : null } };
}

export interface PackInfo {
	root: string;
	kind: 'resource' | 'behavior';
	name: string;
	uuid: string | null;
}

/** Read a pack's manifest to learn whether it's a resource or behavior pack */
export function readPack(root: string): PackInfo {
	const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
	const kind = (manifest.modules ?? []).some((m: { type?: string }) => m.type === 'resources') ? 'resource' : 'behavior';
	return { root, kind, name: String(manifest.header?.name ?? basename(root)), uuid: manifest.header?.uuid ?? null };
}

const SKIP = new Set(['.git', 'node_modules', '.vscode', '.oxygen']);

/**
 * Copy a pack into the game's development folder (development_resource_packs / development_behavior_packs),
 * replacing the previous copy. The game picks up changed files on /reload all or when re-entering a world.
 */
export function deployPack(pack: PackInfo, install: GameInstall): string {
	return deployPackDetailed(pack, install).target;
}

/**
 * Deploy, and say whether the copy was given the `pbr` capability. A resource pack without it turns Vibrant
 * Visuals off in-game while it's active (t65), so the copy in the development folder gets it, to keep Vibrant
 * Visuals available for testing; the pack itself is left as it is.
 */
export function deployPackDetailed(pack: PackInfo, install: GameInstall): { target: string; addedPbr: boolean } {
	const folder = packFolder(install, pack.kind);
	if (!folder) throw new Error(`No folder for behavior packs is set for ${install.name}, so ${pack.name} has nowhere to go.`);
	const target = join(folder, `${basename(pack.root)}`);
	mkdirSync(folder, { recursive: true });
	if (existsSync(target)) rmSync(target, { recursive: true, force: true });
	cpSync(pack.root, target, { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
	let addedPbr = false;
	if (pack.kind === 'resource') {
		try {
			const path = join(target, 'manifest.json');
			const manifest = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
			const caps: unknown[] = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
			if (!caps.includes('pbr')) {
				manifest.capabilities = [...caps, 'pbr'];
				writeFileSync(path, `${JSON.stringify(manifest, null, '\t')}\n`);
				addedPbr = true;
			}
		} catch {
			// a manifest JSON.parse can't read (comments): deployed as it is
		}
	}
	return { target, addedPbr };
}

/**
 * The complete lines a log gained after byte `from`, without loading the whole file: logs full of per-frame errors
 * pass 2 GB, which `readFileSync` can't read. Starts over when the file shrank, keeps only the last `maxBytes`, and
 * leaves a line still being written for the next call (`end` is where to continue).
 */
export function readLogSince(path: string, from: number, maxBytes = 8 << 20): { text: string; end: number } {
	const size = statSync(path).size;
	if (size < from) from = 0;
	let start = Math.max(from, size - maxBytes);
	if (start >= size) return { text: '', end: size };
	const buf = Buffer.alloc(size - start);
	const fd = openSync(path, 'r');
	try {
		readSync(fd, buf, 0, buf.length, start);
	} finally {
		closeSync(fd);
	}
	let body = buf;
	if (start > from) {
		// cut mid-file: drop the partial first line
		const nl = body.indexOf(10);
		if (nl < 0) return { text: '', end: start };
		body = body.subarray(nl + 1);
		start += nl + 1;
	}
	const last = body.lastIndexOf(10);
	if (last < 0) return { text: '', end: start };
	return { text: body.subarray(0, last + 1).toString('utf8'), end: start + last + 1 };
}

/** The newest content log file of an install (null when there's none, or its folder is missing) */
export function latestContentLog(install: GameInstall): string | null {
	if (!install.logs) return null;
	try {
		// a log file set by hand
		if (statSync(install.logs).isFile()) return install.logs;
		let best: { path: string; time: number } | null = null;
		for (const f of readdirSync(install.logs)) {
			if (!f.startsWith('ContentLog')) continue;
			const p = join(install.logs, f);
			const t = statSync(p).mtimeMs;
			if (!best || t > best.time) best = { path: p, time: t };
		}
		return best?.path ?? null;
	} catch {
		// a folder set by hand that isn't there (yet)
		return null;
	}
}
