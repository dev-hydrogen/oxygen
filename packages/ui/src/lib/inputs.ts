import type { InputValue, Scenario, SceneSource } from '@oxygen/format';
import { Molang, type Value } from 'molangjs';
import type { ParticleWorld, Vec3 } from 'wintersky';

/** What scene-bound and time-driven inputs can see */
export interface InputScene {
	/** seconds since the effect started */
	time: number;
	timeOfDay: number;
	entity: { position: Vec3; velocity: Vec3; yaw: number } | null;
	camera: { position: Vec3; forward: Vec3 };
	/** the root emitter, for camera distance */
	origin: Vec3;
}

export type InputKind = 'constant' | 'molang' | 'keys' | 'table' | 'scene';

/** What kind of value an input holds (Molang booleans are 1.0 / 0.0) */
export type InputType = 'number' | 'bool' | 'string';

/** Input type for a query from Mojang's metadata return type */
export function queryInputType(returnType: string | undefined): InputType {
	if (returnType === 'bool') return 'bool';
	if (returnType === 'hash_type_64') return 'string';
	return 'number';
}

export function inputKind(v: InputValue): InputKind {
	if (typeof v === 'number' || typeof v === 'string') return 'constant';
	if ('molang' in v) return 'molang';
	if ('keys' in v) return 'keys';
	if ('table' in v) return 'table';
	return 'scene';
}

export const SCENE_SOURCES: { id: SceneSource; label: string }[] = [
	{ id: 'time', label: 'Seconds since start' },
	{ id: 'time_of_day', label: 'Time of day (0–1)' },
	{ id: 'entity.x', label: 'Entity X' },
	{ id: 'entity.y', label: 'Entity Y' },
	{ id: 'entity.z', label: 'Entity Z' },
	{ id: 'entity.speed', label: 'Entity ground speed (blocks/s)' },
	{ id: 'entity.vertical_speed', label: 'Entity vertical speed (blocks/s)' },
	{ id: 'entity.yaw', label: 'Entity yaw (degrees)' },
	{ id: 'entity.moving', label: 'Entity is moving (1/0)' },
	{ id: 'camera.x', label: 'Camera X' },
	{ id: 'camera.y', label: 'Camera Y' },
	{ id: 'camera.z', label: 'Camera Z' },
	{ id: 'camera.distance', label: 'Camera distance to emitter' },
	{ id: 'camera.yaw', label: 'Camera yaw (degrees)' },
	{ id: 'camera.pitch', label: 'Camera pitch (degrees)' },
];

const DEG = 180 / Math.PI;

function sceneValue(src: SceneSource, s: InputScene): number {
	const e = s.entity;
	const c = s.camera;
	switch (src) {
		case 'time':
			return s.time;
		case 'time_of_day':
			return s.timeOfDay;
		case 'entity.x':
			return e?.position[0] ?? 0;
		case 'entity.y':
			return e?.position[1] ?? 0;
		case 'entity.z':
			return e?.position[2] ?? 0;
		case 'entity.speed':
			return e ? Math.hypot(e.velocity[0], e.velocity[2]) : 0;
		case 'entity.vertical_speed':
			return e?.velocity[1] ?? 0;
		case 'entity.yaw':
			return e?.yaw ?? 0;
		case 'entity.moving':
			return e && Math.hypot(e.velocity[0], e.velocity[1], e.velocity[2]) > 1e-3 ? 1 : 0;
		case 'camera.x':
			return c.position[0];
		case 'camera.y':
			return c.position[1];
		case 'camera.z':
			return c.position[2];
		case 'camera.distance':
			return Math.hypot(c.position[0] - s.origin[0], c.position[1] - s.origin[1], c.position[2] - s.origin[2]);
		case 'camera.yaw':
			return Math.atan2(-c.forward[0], c.forward[2]) * DEG;
		case 'camera.pitch':
			return -Math.asin(Math.max(-1, Math.min(1, c.forward[1]))) * DEG;
	}
}

/** Keyframes over time: linear (or stepped), held before the first and after the last key */
export function evalKeys(keys: [number, number][], t: number, loop = false, step = false): number {
	if (!keys.length) return 0;
	const sorted = [...keys].sort((a, b) => a[0] - b[0]);
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	if (loop && last[0] > first[0]) t = first[0] + ((((t - first[0]) % (last[0] - first[0])) + (last[0] - first[0])) % (last[0] - first[0]));
	if (t <= first[0]) return first[1];
	if (t >= last[0]) return last[1];
	for (let i = 0; i < sorted.length - 1; i++) {
		const [t0, v0] = sorted[i];
		const [t1, v1] = sorted[i + 1];
		if (t >= t0 && t < t1) return step || t1 === t0 ? v0 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
	}
	return last[1];
}

/** How an argument appears in a signature or table key: `0`, `0.5`, `'head'` */
export function argText(a: Value): string {
	if (typeof a === 'string') return `'${a}'`;
	// arguments may have gone through float32 emulation: 0.1 arrives as 0.10000000149
	return Number.isInteger(a) ? String(a) : String(Number(a.toPrecision(7)));
}

export function callSignature(name: string, args: Value[]): string {
	return `${name}(${args.map(argText).join(', ')})`;
}

const molang = new Molang();

/** Evaluate one input. Undefined means "no value": the preview falls back to its live value. */
export function evalInput(v: InputValue, scene: InputScene, args: Value[] = []): Value | undefined {
	if (typeof v === 'number' || typeof v === 'string') return v;
	if ('molang' in v) {
		try {
			return molang.parse(v.molang, { 'query.anim_time': scene.time, 'query.life_time': scene.time, 'query.time_of_day': scene.timeOfDay });
		} catch {
			return undefined;
		}
	}
	if ('keys' in v) return evalKeys(v.keys, scene.time, v.loop, v.step);
	if ('table' in v) {
		const hit = v.table[args.map(argText).join(', ')];
		return hit ?? v.fallback;
	}
	return sceneValue(v.scene, scene);
}

/** A query's value from the scenario: exact call signature first, then the bare name (constant or table) */
export function scenarioQuery(sc: Scenario | null, name: string, args: Value[], scene: InputScene): Value | undefined {
	const qs = sc?.queries;
	if (!qs) return undefined;
	const exact = qs[callSignature(name, args)];
	if (exact !== undefined) return evalInput(exact, scene, args);
	const any = qs[name];
	return any === undefined ? undefined : evalInput(any, scene, args);
}

/** Variable values handed to the emitter at spawn (drivers are read at that moment) */
export function scenarioVariables(sc: Scenario | null, scene: InputScene): Record<string, Value> | undefined {
	if (!sc?.variables) return undefined;
	const out: Record<string, Value> = {};
	for (const [k, v] of Object.entries(sc.variables)) {
		if (isTempKey(k) || isContextKey(k)) continue;
		const val = evalInput(v, scene);
		if (val !== undefined) out[k] = val;
	}
	return out;
}

/** Scenario inputs named t.x (or temp.x) are temps: they go into the shared temp store, not to the emitter */
export function isTempKey(k: string): boolean {
	return /^(t|temp)\./i.test(k);
}

/** Scenario inputs named c.x (or context.x) are context values: the world supplies them to every expression */
export function isContextKey(k: string): boolean {
	return /^(c|context)\./i.test(k);
}

function tempSlot(w: ParticleWorld, k: string): number {
	return w.symbols.temp(`temp.${k.replace(/^(t|temp)\./i, '').toLowerCase()}`);
}

function contextSlot(w: ParticleWorld, k: string): number {
	return w.symbols.context(`context.${k.replace(/^(c|context)\./i, '').toLowerCase()}`);
}

/** A temp or context input into the world's store; false for an emitter variable */
function writeGlobal(w: ParticleWorld, k: string, val: Value): boolean {
	if (isTempKey(k)) w.temps.set(tempSlot(w, k), val);
	else if (isContextKey(k)) w.contexts[contextSlot(w, k)] = val;
	else return false;
	return true;
}

/**
 * The scenario's temps and context values, written into the world just before the effect spawns: temps as a
 * parent's event expression leaves them before it spawns a child (temps are global in-game, t05/t30), context
 * values as the caller would supply them
 */
export function writeScenarioGlobals(w: ParticleWorld, sc: Scenario | null, scene: InputScene): void {
	// the scenario is all the context there is: a value it no longer has is unset
	w.contexts.length = 0;
	for (const [k, v] of Object.entries(sc?.variables ?? {})) {
		if (!isTempKey(k) && !isContextKey(k)) continue;
		const val = evalInput(v, scene);
		if (val !== undefined) writeGlobal(w, k, val);
	}
}

/** Short display of an input for lists and tooltips */
export function describeInput(v: InputValue): string {
	if (typeof v === 'number') return String(v);
	if (typeof v === 'string') return `'${v}'`;
	if ('molang' in v) return v.molang;
	if ('keys' in v) return `${v.keys.length} key${v.keys.length === 1 ? '' : 's'}${v.loop ? ', looping' : ''}`;
	if ('table' in v) return `${Object.keys(v.table).length} argument value${Object.keys(v.table).length === 1 ? '' : 's'}`;
	return SCENE_SOURCES.find((s) => s.id === v.scene)?.label ?? v.scene;
}

/** Pinned scenario variables, written into the root emitters (temps and context values: the world) before every update (main thread or worker) */
export function applyPinned(w: ParticleWorld, sc: Scenario | null, scene: InputScene): void {
	if (!sc?.pinned?.length || !sc.variables) return;
	for (const name of sc.pinned) {
		const input = sc.variables[name];
		if (input === undefined) continue;
		const value = evalInput(input, scene);
		if (value === undefined) continue;
		if (writeGlobal(w, name, value)) continue;
		const slot = w.symbols.variable(name.toLowerCase().replace(/^v\./, 'variable.'));
		for (const e of w.emitters) if (!e.parent) e.vars[slot] = value;
	}
}
