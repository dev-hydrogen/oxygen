import { parse } from 'jsonc-parser';

/**
 * Particle materials beyond the game's four. An effect can name any material the game has, or one a pack
 * defines in `materials/particles.material` as `"name:parent": { … }`. The preview only knows how to draw the
 * four, so another one is drawn as the one it comes from.
 */

export const BASE_MATERIALS = ['particles_alpha', 'particles_blend', 'particles_add', 'particles_opaque'];

/** The materials a pack's particles.material defines, each with the one it inherits from (`''` for none) */
export function materialParents(text: string | null): Record<string, string> {
	if (!text) return {};
	const out: Record<string, string> = {};
	try {
		const root = parse(text, [], { allowTrailingComma: true }) as { materials?: Record<string, unknown> } | null;
		for (const key of Object.keys(root?.materials ?? {})) {
			if (key === 'version') continue;
			const [name, parent = ''] = key.split(':');
			if (name) out[name] = parent;
		}
	} catch {
		// not a material file Oxygen can read: no custom materials
	}
	return out;
}

/**
 * Which of the game's four a material is drawn as: the one it is, the one it inherits from in the pack, else a
 * guess from its name (`my_particles_add`), else cutout, as an unknown material was always drawn.
 */
export function baseMaterial(name: string, parents: Record<string, string> = {}): string {
	let at = name;
	for (let i = 0; i < 12; i++) {
		if (BASE_MATERIALS.includes(at)) return at;
		const parent = parents[at];
		if (!parent) break;
		at = parent;
	}
	const n = name.toLowerCase();
	if (/add/.test(n)) return 'particles_add';
	if (/blend|transparent|translucent/.test(n)) return 'particles_blend';
	if (/opaque/.test(n)) return 'particles_opaque';
	return 'particles_alpha';
}
