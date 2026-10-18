import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import { parentInputsFor, spawnsOf, type EffectSpawns } from '@oxygen/effect';

/** What the build copies next to the server bundle (see build.mjs) */
export const BUNDLED = {
	examples: join(__dirname, 'examples'),
	vanilla: join(__dirname, 'vanilla'),
	preview: join(__dirname, 'preview'),
	docs: join(__dirname, 'docs'),
};

/** vanilla texture paths → the sprites wintersky bundles */
const VANILLA_TEXTURES: Record<string, string> = {
	'textures/particle/particles': 'particles.png',
	'textures/particle/campfire_smoke': 'campfire_smoke.png',
	'textures/particle/soul': 'soul.png',
	'textures/flame_atlas': 'flame_atlas.png',
};

/** Resource pack root of a file: the nearest folder above with manifest.json, else the parent of `particles/` */
export function packRoot(file: string): string | null {
	let dir = dirname(resolve(file));
	let particlesParent: string | null = null;
	for (let i = 0; i < 12; i++) {
		if (basename(dir) === 'particles') particlesParent ??= dirname(dir);
		if (existsSync(join(dir, 'manifest.json'))) return dir;
		const up = dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return particlesParent;
}

/** The pack's min_engine_version (selects Molang rules for plain-string expressions) */
export function packEngine(root: string | null): number[] | null {
	if (!root) return null;
	try {
		const m = parseJsonc(readFileSync(join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
		const v = m?.header?.min_engine_version;
		return Array.isArray(v) ? v.map(Number) : null;
	} catch {
		return null;
	}
}

/** The identifier an effect file declares (not just any mention: events name other effects too) */
export function identifierOf(text: string): string | null {
	return /"identifier"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null;
}

/** Particle files under `dir` by identifier. Read fresh every time: an agent edits files between calls. */
function scanEffects(dir: string): Map<string, string> {
	const out = new Map<string, string>();
	const walk = (d: string, depth: number) => {
		if (depth > 6 || !existsSync(d)) return;
		for (const f of readdirSync(d)) {
			const p = join(d, f);
			if (statSync(p).isDirectory()) walk(p, depth + 1);
			else if (f.endsWith('.json')) {
				const id = identifierOf(readFileSync(p, 'utf8'));
				if (id && !out.has(id)) out.set(id, p);
			}
		}
	};
	walk(dir, 0);
	return out;
}

/** The bundled examples by name (`fire`) → file */
export function examples(): Map<string, string> {
	const out = new Map<string, string>();
	if (!existsSync(BUNDLED.examples)) return out;
	for (const f of readdirSync(BUNDLED.examples).sort()) if (f.endsWith('.particle.json')) out.set(f.replace('.particle.json', ''), join(BUNDLED.examples, f));
	return out;
}

/**
 * Where effects are looked up by identifier: the pack's particles folder, then the bundled examples (what an
 * example spawns is another example, as in the editor)
 */
export function effectIndex(root: string | null): Map<string, string> {
	const index = root ? scanEffects(join(root, 'particles')) : new Map<string, string>();
	for (const [id, p] of scanEffects(BUNDLED.examples)) if (!index.has(id)) index.set(id, p);
	return index;
}

/**
 * Every effect the events of `text` reach, directly or through other children, plus the effects in `also` (other
 * effects playing in the scene) and what they reach, as text by identifier. The effect itself is left out: a child
 * spawning it back plays the text being previewed, not the file on disk.
 */
export function childEffects(text: string, index: Map<string, string>, also: readonly string[] = []): { effects: Record<string, string>; missing: string[] } {
	const effects: Record<string, string> = {};
	const missing: string[] = [];
	const pending: string[] = [...also];
	const queue = (json: unknown) => pending.push(...(spawnsOf(json)?.spawns ?? []).map((s) => s.effect));
	const json = parseJsonc(text, [], { allowTrailingComma: true });
	const root = spawnsOf(json)?.identifier;
	queue(json);
	while (pending.length) {
		const id = pending.shift()!;
		if (id === root || id in effects || missing.includes(id)) continue;
		const p = index.get(id);
		if (!p) {
			missing.push(id);
			continue;
		}
		effects[id] = readFileSync(p, 'utf8');
		queue(parseJsonc(effects[id], [], { allowTrailingComma: true }));
	}
	return { effects, missing };
}

/** What the indexed effects set, in their pre-effects, for an effect they spawn (variable → parents) */
export function parentInputs(index: Map<string, string>, identifier: string): Record<string, string> {
	const spawns: EffectSpawns[] = [];
	for (const p of index.values()) {
		const s = spawnsOf(parseJsonc(readFileSync(p, 'utf8'), [], { allowTrailingComma: true }));
		if (s) spawns.push(s);
	}
	return parentInputsFor(spawns, identifier);
}

/**
 * Image for a texture path from a particle file (`textures/particle/foo`): the pack's PNG, else the vanilla
 * sprite. `tga` is set when the pack only has a TGA, which the preview can't decode.
 */
export function textureFile(root: string | null, texture: string): { png: string | null; tga: boolean } {
	const base = texture.replace(/\.(png|tga)$/i, '');
	if (root) {
		const png = join(root, `${base}.png`);
		if (existsSync(png)) return { png, tga: false };
	}
	const bundled = VANILLA_TEXTURES[base];
	if (bundled && existsSync(join(BUNDLED.vanilla, bundled))) return { png: join(BUNDLED.vanilla, bundled), tga: false };
	return { png: null, tga: !!root && existsSync(join(root, `${base}.tga`)) };
}

/** A text file of the pack (lighting, texture sets, manifest); null when absent or outside the pack */
export function packText(root: string | null, path: string): string | null {
	if (!root) return null;
	const p = resolve(root, path);
	if (!p.startsWith(resolve(root)) || !existsSync(p)) return null;
	return readFileSync(p, 'utf8');
}
