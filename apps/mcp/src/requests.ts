import { basename } from 'node:path';
import { readMeta } from '@oxygen/format';
import { load, type SpawnMode } from './effects';
import { childEffects, effectIndex } from './pack';
import type { SessionRequest, Vec3 } from './protocol';

export interface PlayOptions {
	spawn?: SpawnMode;
	repeat: boolean;
	timeOfDay?: number;
	others?: { effect: string; position?: number[] }[];
	camera?: { position: Vec3; target: Vec3; fov?: number } | null;
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
		request: { text: e.doc.text, file: { name: basename(path), id: path }, effects, engine: e.engine, spawn: o.spawn ?? null, repeat: o.repeat, timeOfDay: o.timeOfDay ?? null, parents: e.parents, extras, camera: o.camera ?? null },
		missingChildren: missing,
	};
}
