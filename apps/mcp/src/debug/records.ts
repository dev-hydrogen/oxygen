// What the debugging tools report about a world, as plain JSON. Shared by the preview page (which runs the editor's
// own session) and the server's tests, so it only depends on the engine and the analysis.
import { analyzeEffect, type EffectAnalysis } from '@oxygen/effect';
import { explainFacing } from '@oxygen/ui/lib/facing-text';
import { children, type Node, type Program, type Value } from 'molangjs';
import type { EffectDefinition, EmitterInstance, LogEntry, MolangField, ParticleWorld, TraceRecord, Vec3 } from 'wintersky';

/** Numbers as JSON: 7 significant digits (the game's floats are 32-bit), −0 → 0, NaN and ∞ as text */
export function r(n: number): number | string {
	if (!Number.isFinite(n)) return String(n);
	if (n === 0) return 0;
	return Number(n.toPrecision(7));
}
export const rv = (v: ArrayLike<number>): (number | string)[] => Array.from(v, r);
export const val = (v: Value | undefined): Value | null => (v === undefined ? null : typeof v === 'number' ? (r(v) as number) : v);

// ---------------------------------------------------------------- fields

const analyses = new WeakMap<EffectDefinition, EffectAnalysis>();

/** The effect-wide analysis of a definition (field labels and order), cached */
export function analysisOf(def: EffectDefinition): EffectAnalysis {
	let a = analyses.get(def);
	if (!a) analyses.set(def, (a = analyzeEffect(def)));
	return a;
}

/** A field of a definition by its JSON path, including the ones the analysis leaves out (pre-effect expressions) */
export function findField(def: EffectDefinition, path: string): MolangField | undefined {
	let found: MolangField | undefined;
	const seen = new Set<unknown>();
	const walk = (x: unknown) => {
		if (found || !x || typeof x !== 'object' || seen.has(x)) return;
		seen.add(x);
		if ('expr' in x && 'path' in x && (x as MolangField).path === path) {
			found = x as MolangField;
			return;
		}
		if (x instanceof Map) for (const v of x.values()) walk(v);
		else for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v);
	};
	walk({ curves: def.curves, emitter: def.emitter, particle: def.particle, events: [...def.events.values()] });
	return found;
}

/** Molang source of a field, as the game reads it */
export function sourceOf(field: MolangField): string {
	return typeof field.raw === 'number' ? String(field.raw) : field.expr.source;
}

// ---------------------------------------------------------------- particles and emitters

export const PARTICLE_FIELDS = ['position', 'velocity', 'age', 'lifetime', 'random', 'rotation', 'size', 'uv', 'color', 'visible', 'facing', 'contact'] as const;
export type ParticleField = (typeof PARTICLE_FIELDS)[number];

/** One particle as the engine holds it, and what render preparation computed for it */
export function particleRecord(e: EmitterInstance, i: number, fields: ReadonlySet<ParticleField> = new Set(PARTICLE_FIELDS)): Record<string, unknown> {
	const p = e.pool;
	const out: Record<string, unknown> = { id: p.id[i], emitter: e.id };
	if (fields.has('position')) {
		out.position = rv(e.particleWorldPos(i, [0, 0, 0]));
		if (p.local[i]) out.localPosition = rv(p.pos.subarray(i * 3, i * 3 + 3));
	}
	if (fields.has('velocity')) {
		out.velocity = rv(p.vel.subarray(i * 3, i * 3 + 3));
		out.speed = r(Math.hypot(p.vel[i * 3], p.vel[i * 3 + 1], p.vel[i * 3 + 2]));
	}
	if (fields.has('age')) out.age = r(p.age[i]);
	if (fields.has('lifetime')) out.lifetime = p.hasLifetime[i] ? r(p.lifetime[i]) : null;
	if (fields.has('random')) out.random = rv(p.random.subarray(i * 4, i * 4 + 4));
	if (fields.has('rotation')) {
		out.rotation = r(p.rot[i]);
		out.rotationRate = r(p.rotRate[i]);
	}
	if (fields.has('size')) out.size = rv(p.size.subarray(i * 2, i * 2 + 2));
	if (fields.has('uv')) {
		const uv = p.uv.subarray(i * 4, i * 4 + 4);
		out.uv = rv(uv);
		const tex = e.def.particle.billboard?.uv;
		if (tex) {
			const tw = tex.textureWidth || 1;
			const th = tex.textureHeight || 1;
			out.uvPixels = { u: r(uv[0] * tw), v: r(uv[1] * th), w: r((uv[2] - uv[0]) * tw), h: r((uv[3] - uv[1]) * th) };
		}
	}
	if (fields.has('color')) out.color = Array.from(p.color.subarray(i * 4, i * 4 + 4));
	if (fields.has('visible')) out.visible = !!p.visible[i];
	if (fields.has('facing') && e.def.particle.billboard) {
		const f = p.facing.subarray(i * 3, i * 3 + 3);
		if (f[0] || f[1] || f[2]) out.facingDirection = rv(f);
	}
	if (fields.has('contact') && e.def.particle.collision) out.contact = !!p.contact[i];
	return out;
}

/** How a particle's quad is oriented, in numbers and words (the editor's facing inspector) */
export function facingRecord(world: ParticleWorld, e: EmitterInstance, i: number): Record<string, unknown> | null {
	const cam = world.camera;
	const f = e.particleFacing(i, cam);
	if (!f) return null;
	const to: Vec3 = [cam.position[0] - f.position[0], cam.position[1] - f.position[1], cam.position[2] - f.position[2]];
	const l = Math.hypot(...to) || 1;
	const text = explainFacing(f, [to[0] / l, to[1] / l, to[2] / l]);
	return {
		mode: f.mode,
		right: rv(f.rotatedRight),
		up: rv(f.rotatedUp),
		normal: rv(f.normal),
		direction: f.direction ? rv(f.direction) : null,
		degenerate: f.degenerate,
		usedPoleFallback: f.usedFallback,
		velocity: f.velocity ? { speed: r(f.velocity.speed), minSpeed: f.velocity.minSpeed, held: f.velocity.held } : null,
		rule: text.rule,
		steps: text.steps,
		warnings: text.warnings,
	};
}

/** An emitter's variable map by name: variables belong to the emitter and every one of its particles shares them */
export function emitterVariables(world: ParticleWorld, e: EmitterInstance): Record<string, Value | null> {
	const out: Record<string, Value | null> = {};
	const names = world.symbols.variableNames;
	for (let k = 0; k < e.vars.length; k++) if (e.vars[k] !== undefined) out[names[k]] = val(e.vars[k]);
	return out;
}

export function emitterRecord(world: ParticleWorld, e: EmitterInstance, variables: boolean): Record<string, unknown> {
	const o = e.spawnOptions;
	const out: Record<string, unknown> = {
		id: e.id,
		effect: e.def.identifier,
		parent: e.parentId,
		spawnedBy: o.context ?? 'command',
		followsRulesOf: e.rootContext,
		position: rv(e.position),
		rotation: rv(e.rotation),
		velocity: rv(e.velocity),
		age: r(e.age),
		loop: e.loopIndex,
		loops: e.loops,
		activeTime: r(e.activeTime),
		sleepTime: r(e.sleepTime),
		active: e.active,
		expired: e.expired,
		particles: e.pool.count,
		cap: e.cap,
		culled: e.culled,
		localSpace: e.localSpace,
		random: rv(e.randoms),
	};
	const rate = e.def.emitter.rate;
	if (rate?.type === 'steady' || rate?.type === 'manual') out.maxParticles = r(e.maxParticles);
	if (rate?.type === 'steady') out.spawnAccumulator = r(e.spawnAccumulator);
	if (rate?.type === 'instant') out.burstDone = e.burstDone;
	if (e.failed) out.failed = e.def.failed?.reason ?? true;
	if (o.bound) out.bound = true;
	if (o.singleParticle) out.singleParticle = true;
	if (e.travelled) out.travelled = r(e.travelled);
	if (variables) out.variables = emitterVariables(world, e);
	return out;
}

// ---------------------------------------------------------------- evaluations

function nodesById(program: Program): Map<number, Node> {
	const out = new Map<number, Node>();
	const walk = (n: Node) => {
		out.set(n.id, n);
		for (const c of children(n)) walk(c);
	};
	for (const n of program.body) walk(n);
	return out;
}

export interface Part {
	text: string;
	kind: string;
	value: Value | null;
	/** every value, when the part ran more than once (inside a loop) */
	values?: (Value | null)[];
	runs?: number;
}

/**
 * What each part of an expression evaluated to, in the order the parts first ran. Literals are left out (their
 * value is their text); a part that ran several times lists its values.
 */
export function annotate(program: Program, values: Map<number, Value[]>, maxValues = 12): Part[] {
	const nodes = nodesById(program);
	const out: Part[] = [];
	for (const [id, vs] of values) {
		const n = nodes.get(id);
		if (!n || n.type === 'Number' || n.type === 'String') continue;
		const part: Part = {
			text: program.source.slice(n.start, n.end).replace(/\s+/g, ' '),
			kind: n.type === 'Name' ? n.ns : n.type === 'Call' ? `${n.callee.ns} call` : n.type.toLowerCase(),
			value: val(vs[vs.length - 1]),
		};
		if (vs.length > 1) {
			part.values = vs.slice(0, maxValues).map(val);
			part.runs = vs.length;
		}
		out.push(part);
	}
	return out;
}

export function changedVars(before: Record<string, Value>, after: Record<string, Value>): Record<string, { before: Value | null; after: Value | null }> {
	const out: Record<string, { before: Value | null; after: Value | null }> = {};
	for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (before[k] !== after[k] && !(Number.isNaN(before[k]) && Number.isNaN(after[k]))) out[k] = { before: val(before[k]), after: val(after[k]) };
	}
	return out;
}

/** The definition an emitter (by id) ran */
function defOf(world: ParticleWorld, emitter: number): EffectDefinition | null {
	return world.emitters.find((e) => e.id === emitter)?.def ?? null;
}

/** A trace record as plain data: the field, its source and result, every part's value, what it changed */
export function traceRecord(world: ParticleWorld, rec: TraceRecord, detail: 'full' | 'brief', fallback: EffectDefinition): Record<string, unknown> {
	const def = defOf(world, rec.emitter) ?? fallback;
	const ref = analysisOf(def).byPath.get(rec.path);
	const field = ref?.field ?? findField(def, rec.path);
	const out: Record<string, unknown> = {
		phase: rec.phase,
		field: ref?.label ?? rec.path,
		path: rec.path,
		emitter: rec.emitter,
		particle: rec.particle >= 0 ? rec.particle : null,
		source: field ? sourceOf(field) : null,
		result: val(rec.result),
	};
	if (detail === 'brief') return out;
	if (field && !field.broken) out.parts = annotate(world.traceVersion(field).program, rec.values);
	const changed = changedVars(rec.varsBefore, rec.varsAfter);
	if (Object.keys(changed).length) out.changed = changed;
	if (field && rec.temps.length) {
		// temps are global; list the ones this expression touches
		const used = new Set<string>();
		for (const n of nodesById(field.expr.program).values()) if (n.type === 'Name' && n.ns === 'temp') used.add(n.full);
		const temps = Object.fromEntries(rec.temps.filter(([k]) => used.has(k)).map(([k, v]) => [k, val(v)]));
		if (Object.keys(temps).length) out.temps = temps;
	}
	return out;
}

export function logRecord(world: ParticleWorld, l: LogEntry, fallback: EffectDefinition): Record<string, unknown> {
	const def = defOf(world, l.emitter) ?? fallback;
	return {
		phase: l.phase,
		field: analysisOf(def).byPath.get(l.path)?.label ?? l.path,
		path: l.path,
		emitter: l.emitter,
		particle: l.particle >= 0 ? l.particle : null,
		result: val(l.result),
	};
}
