import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { readMeta } from '@oxygen/format';
import { locatorsFromGeometry, type EntitySettings, type Locator, type Motion } from '@oxygen/scene';
import { parse as parseJsonc } from 'jsonc-parser';
import { z } from 'zod';
import { load, type SpawnMode } from './effects';
import { childEffects, effectIndex } from './pack';
import type { SessionRequest, Vec3 } from './protocol';

export interface PlayOptions {
	spawn?: SpawnMode;
	repeat: boolean;
	timeOfDay?: number;
	others?: { effect: string; position?: number[] }[];
	camera?: { position: Vec3; target: Vec3; fov?: number } | null;
	entity?: EntityArgs;
}

const vec3 = z.array(z.number()).length(3);

/** The entity an effect plays on (spawn 'entity'); every field optional */
export const entitySchema = z
	.object({
		locator: z.string().optional().describe('The locator the effect is attached to, from `locators` or `geometry`. Omit for the entity itself (its feet, its own axes)'),
		locators: z
			.array(z.object({ name: z.string(), offset: vec3.describe('Model pixels, as a geometry file writes them (16 to a block; the model faces -Z)'), rotation: vec3.optional().describe('Degrees, geometry order') }))
			.optional()
			.describe('Locators to use, written like a geometry file'),
		geometry: z.string().optional().describe("A .geo.json file whose locators to use (resolved through its bones' pivots and rotations)"),
		model: z.string().optional().describe('Which geometry in that file, when it holds several (identifier)'),
		bind_to_actor: z.boolean().optional().describe('false: the effect starts where the entity is (the world origin when a locator is given, as in-game) and stays there. Default true'),
		yaw: z.number().optional().describe("Facing when it doesn't walk, Minecraft yaw: 0 south (+Z), 90 west"),
		scale: z.number().positive().optional().describe('minecraft:scale (grows locator offsets and the effect on a locator)'),
		width: z.number().min(0).optional().describe('Collision box width (entity_aabb), default 0.6'),
		height: z.number().min(0).optional().describe('Collision box height, default 1.8'),
		remove_after: z.number().min(0).optional().describe('The entity despawns (or the controller state ends) this many seconds after the effect starts'),
		motion: z
			.object({
				kind: z.enum(['still', 'circle', 'line', 'bob', 'path']),
				radius: z.number().positive().optional().describe('circle (default 2)'),
				length: z.number().positive().optional().describe('line (default 6)'),
				height: z.number().optional().describe('bob (default 1)'),
				speed: z.number().positive().optional().describe('blocks per second (bob: cycles per second)'),
				points: z.array(vec3).min(2).optional().describe('path waypoints'),
				ends: z.enum(['loop', 'reverse']).optional().describe('path: back to the first point or back the way it came'),
			})
			.optional()
			.describe('How it moves (default still). Movement moves attached effects; the game adds none of its speed to their particles'),
	})
	.optional()
	.describe("The entity, when spawn is 'entity' (given alone, it implies spawn 'entity'). Default: the file's own scene");

export type EntityArgs = z.infer<typeof entitySchema>;

/** Scene settings for the entity an agent described (locators from a geometry file resolved here) */
export function entitySettings(a: NonNullable<EntityArgs>): Partial<EntitySettings> {
	const out: Partial<EntitySettings> = { v: 2 };
	let locators: Locator[] | undefined = a.locators?.map((l) => ({ name: l.name, offset: l.offset as Vec3, ...(l.rotation ? { rotation: l.rotation as Vec3 } : {}) }));
	if (a.geometry) {
		const models = locatorsFromGeometry(parseJsonc(readFileSync(resolve(a.geometry), 'utf8'), [], { allowTrailingComma: true }));
		const m = a.model ? models.find((x) => x.model === a.model) : (models.find((x) => x.locators.length) ?? models[0]);
		if (!m) throw new Error(a.model ? `${a.geometry} has no geometry ${a.model} (it has ${models.map((x) => x.model).join(', ') || 'none'})` : `${a.geometry} has no geometry`);
		locators = [...m.locators, ...(locators ?? [])];
		out.model = m.model;
	}
	if (locators) out.locators = locators;
	if (a.locator !== undefined) {
		if (a.locator && !(locators ?? []).some((l) => l.name === a.locator)) throw new Error(`No locator ${a.locator}: give it in locators, or a geometry file that has it${locators?.length ? ` (known: ${locators.map((l) => l.name).join(', ')})` : ''}`);
		out.locator = a.locator;
	}
	if (a.bind_to_actor !== undefined) out.unbound = a.bind_to_actor ? undefined : true;
	if (a.yaw !== undefined) out.yaw = a.yaw;
	if (a.scale !== undefined) out.scale = a.scale;
	if (a.width !== undefined) out.width = a.width;
	if (a.height !== undefined) out.height = a.height;
	if (a.remove_after !== undefined) out.removeAfter = a.remove_after;
	const m = a.motion;
	if (m) {
		const motion: Motion =
			m.kind === 'circle'
				? { kind: 'circle', radius: m.radius ?? 2, speed: m.speed ?? 2 }
				: m.kind === 'line'
					? { kind: 'line', length: m.length ?? 6, speed: m.speed ?? 3 }
					: m.kind === 'bob'
						? { kind: 'bob', height: m.height ?? 1, speed: m.speed ?? 1 }
						: m.kind === 'path'
							? { kind: 'path', points: (m.points ?? [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]]) as Vec3[], speed: m.speed ?? 2, ends: m.ends ?? 'loop' }
							: { kind: 'still' };
		out.motion = motion;
	}
	return out;
}

/** What the preview page needs to play a file: its text, the effects it reaches, and how it's started */
export function sessionRequest(path: string, o: PlayOptions): { request: SessionRequest; missingChildren: string[] } {
	const e = load(path, o.spawn);
	const extras = o.others?.map((x, i) => ({ effect: x.effect, position: (x.position ?? [3 * (i + 1), 0, 0]) as Vec3 })) ?? null;
	// what plays besides the effect: the effects asked for, else the ones the file's scene keeps
	const saved = readMeta(e.doc).scene?.extras;
	const sceneIds = extras ? extras.map((x) => x.effect) : Array.isArray(saved) ? saved.flatMap((x: { effect?: unknown } | null) => (typeof x?.effect === 'string' ? [x.effect] : [])) : [];
	const { effects, missing } = childEffects(e.doc.text, effectIndex(e.root), sceneIds);
	return {
		request: {
			text: e.doc.text,
			file: { name: basename(path), id: path },
			effects,
			engine: e.engine,
			spawn: o.spawn ?? (o.entity ? 'entity' : null),
			repeat: o.repeat,
			timeOfDay: o.timeOfDay ?? null,
			parents: e.parents,
			extras,
			camera: o.camera ?? null,
			entity: o.entity ? entitySettings(o.entity) : null,
		},
		missingChildren: missing,
	};
}
