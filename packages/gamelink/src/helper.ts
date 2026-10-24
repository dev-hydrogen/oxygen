import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { packFolder, type GameInstall } from './deploy';

/**
 * Oxygen Link: a tiny behavior pack that spawns effects the way a script does, with a MolangVariableMap.
 *   /scriptevent oxygen:link_spawn {"effect":"ns:id","vars":{"variable.size":0.3,"variable.tint":[1,0.5,0]}}
 * It spawns 3 blocks in front of the player who ran the command (like `/particle id ^ ^1.5 ^3`), then
 * moves by `move` (blocks along the world axes) when given.
 * Numbers become setFloat, [r,g,b] / [r,g,b,a] setColorRGB(A), {x,y,z} setVector3.
 */
export const HELPER_FOLDER = 'oxygen_link_bp';
export const HELPER_UUID = 'b7c4e3a2-5f1d-4e8b-9a6c-3d2f1e0b9a71';
const MODULE_UUID = 'b7c4e3a2-5f1d-4e8b-9a6c-3d2f1e0b9a72';
const SCRIPT_UUID = 'b7c4e3a2-5f1d-4e8b-9a6c-3d2f1e0b9a73';

export function helperPackFiles(): Record<string, string> {
	const manifest = {
		format_version: 2,
		header: {
			name: 'Oxygen Link',
			description: 'Lets Oxygen spawn effects with variables, like the Script API does',
			uuid: HELPER_UUID,
			version: [1, 0, 0],
			min_engine_version: [1, 26, 0],
		},
		modules: [
			{ type: 'data', uuid: MODULE_UUID, version: [1, 0, 0] },
			{ type: 'script', language: 'javascript', uuid: SCRIPT_UUID, version: [1, 0, 0], entry: 'scripts/main.js' },
		],
		dependencies: [{ module_name: '@minecraft/server', version: '2.10.0' }],
	};
	const script = `import { system, world, MolangVariableMap } from '@minecraft/server';

// /scriptevent oxygen:link_spawn {"effect":"ns:id","vars":{"variable.size":0.3},"offset":[1.5,0,3],"move":[2,0,0]}
// offset: up, right, ahead of the player; move: then along the world axes
system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id !== 'oxygen:link_spawn') return;
	try {
		const data = JSON.parse(event.message);
		const vars = new MolangVariableMap();
		for (const [name, value] of Object.entries(data.vars ?? {})) {
			if (typeof value === 'number') vars.setFloat(name, value);
			else if (Array.isArray(value) && value.length === 4) vars.setColorRGBA(name, { red: value[0], green: value[1], blue: value[2], alpha: value[3] });
			else if (Array.isArray(value) && value.length === 3) vars.setColorRGB(name, { red: value[0], green: value[1], blue: value[2] });
			else if (value && typeof value === 'object') vars.setVector3(name, { x: value.x ?? 0, y: value.y ?? 0, z: value.z ?? 0 });
		}
		const source = event.sourceEntity;
		const [up, side, ahead] = data.offset ?? [1.5, 0, 3];
		let dimension = world.getDimension('overworld');
		let at = { x: 0, y: 0, z: 0 };
		if (source) {
			dimension = source.dimension;
			const head = source.location;
			const d = source.getViewDirection();
			const flat = Math.hypot(d.x, d.z) || 1;
			// in front of the player at eye height, like ^ ^1.5 ^3
			at = { x: head.x + (d.x / flat) * ahead - (d.z / flat) * side, y: head.y + up, z: head.z + (d.z / flat) * ahead + (d.x / flat) * side };
		}
		const [mx, my, mz] = data.move ?? [0, 0, 0];
		at = { x: at.x + mx, y: at.y + my, z: at.z + mz };
		dimension.spawnParticle(data.effect, at, vars);
	} catch (error) {
		console.warn('oxygen:link_spawn failed: ' + error);
	}
});
`;
	return { 'manifest.json': `${JSON.stringify(manifest, null, '\t')}\n`, 'scripts/main.js': script };
}

/** Put Oxygen Link into the game's development behavior packs (replacing an older copy) */
export function deployHelper(install: GameInstall): string | null {
	const folder = packFolder(install, 'behavior');
	// a folder chosen by hand may have nowhere for behavior packs
	if (!folder) return null;
	const target = join(folder, HELPER_FOLDER);
	if (existsSync(target)) rmSync(target, { recursive: true, force: true });
	for (const [path, text] of Object.entries(helperPackFiles())) {
		const file = join(target, path);
		mkdirSync(join(file, '..'), { recursive: true });
		writeFileSync(file, text);
	}
	return target;
}

/** The command that spawns an effect through Oxygen Link with these variables, `move` blocks off the usual spot */
export function scriptSpawnCommand(effect: string, vars: Record<string, number | number[]>, move?: [number, number, number]): string {
	const full: Record<string, number | number[]> = {};
	for (const [k, v] of Object.entries(vars)) full[k.toLowerCase().replace(/^v\./, 'variable.')] = v;
	return `scriptevent oxygen:link_spawn ${JSON.stringify(isMoved(move) ? { effect, vars: full, move } : { effect, vars: full })}`;
}

/** /particle in front of the player (`^ ^1.5 ^3`), moved `offset` blocks along the world axes */
export function particleSpawnCommand(effect: string, offset?: [number, number, number]): string {
	if (!isMoved(offset)) return `particle ${effect} ^ ^1.5 ^3`;
	const rel = (n: number) => (n ? `~${+n.toFixed(4)}` : '~');
	return `execute positioned ^ ^1.5 ^3 run particle ${effect} ${rel(offset![0])} ${rel(offset![1])} ${rel(offset![2])}`;
}

function isMoved(v?: [number, number, number]): boolean {
	return !!v && v.some((n) => n !== 0);
}
