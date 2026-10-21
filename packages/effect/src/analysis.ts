import { COMPONENT_BY_ID, type FieldInfo, type Phase } from '@oxygen/format';
import { BUILTIN_VARIABLES, type VariableInfo, type VariableUse } from '@oxygen/lang';
import { explainQueryError } from '@oxygen/metadata';
import { analyze, type Analysis } from 'molangjs';
import type { EffectDefinition, EventNode, MolangField } from 'wintersky';

export type FieldPhase = Phase | 'event';

/** One Molang value in the effect, placed in the game's evaluation order */
export interface FieldRef {
	path: string;
	componentId: string | null;
	/** field key inside the component (`size`, `uv/uv_size`), curve or event name otherwise */
	key: string;
	/** vector / color channel index */
	axis: number | null;
	label: string;
	phase: FieldPhase;
	/** first-frame evaluation order; lower runs earlier. Infinity for events that never fire */
	rank: number;
	field: MolangField;
	expectsValue: boolean;
	/** value the game uses when the field fails to load (null = ignored / behaves as absent) */
	fallback: number | null;
	analysis: Analysis | null;
}

export interface Problem {
	path: string;
	severity: 'error' | 'warning' | 'info';
	message: string;
	code: string;
	/** range inside the field's Molang source, when the problem is inside an expression */
	from?: number;
	to?: number;
	source: 'molang' | 'effect' | 'schema' | 'json' | 'runtime' | 'game';
}

export interface AnalysisOptions {
	/** Variables supplied from outside (scenario variables, Script API map, pre-effect script) */
	external?: Record<string, string>;
	/** Variables set by the pre-effects of effects known to spawn this one (variable → their identifiers) */
	parents?: Record<string, string>;
	/** Live-particle cap that applies to the previewed spawn context */
	cap?: number;
	spawnContext?: 'command' | 'script' | 'entity';
}

export interface EffectAnalysis {
	fields: FieldRef[];
	byPath: Map<string, FieldRef>;
	variables: VariableInfo[];
	temps: string[];
	/** temps the effect reads but never sets: whatever set them before (a parent's event) is its input */
	tempInputs: string[];
	/** context.* values the effect reads (the caller supplies them; Molang can't set them) */
	contextInputs: string[];
	problems: Problem[];
	/** event name → first-frame rank of its earliest trigger */
	eventRanks: Map<string, number>;
	/** Every query call by signature (`query.position(1)`); dynamic arguments show as `?` */
	queries: { signature: string; name: string; args: (string | number | null)[]; uses: VariableUse[] }[];
}

const PHASE_BASE: Record<FieldPhase, number> = { setup: 0, emitter: 1000, spawn: 2000, particle: 3000, render: 4000, event: 5000 };

/**
 * Evaluation order inside each phase (component id, field key prefix), as the engine runs it. Matches
 * wintersky's emitter.ts and the game (the in-game test pack).
 */
const ORDER: [string, string][] = [
	// setup: lifetime & rate setup read pre-creation values, then creation_expression
	['minecraft:emitter_lifetime_once', 'active_time'],
	['minecraft:emitter_lifetime_looping', 'active_time'],
	['minecraft:emitter_lifetime_looping', 'sleep_time'],
	['minecraft:emitter_rate_steady', 'max_particles'],
	['minecraft:emitter_rate_manual', 'max_particles'],
	['minecraft:emitter_initialization', 'creation_expression'],
	// emitter update
	['minecraft:emitter_lifetime_expression', 'activation_expression'],
	['minecraft:emitter_initialization', 'per_update_expression'],
	['minecraft:emitter_rate_instant', 'num_particles'],
	['minecraft:emitter_lifetime_expression', 'expiration_expression'],
	['minecraft:emitter_rate_steady', 'spawn_rate'],
	// spawn
	['*shape', 'offset'],
	['*shape', 'radius'],
	['*shape', 'half_dimensions'],
	['*shape', 'plane_normal'],
	['*shape', 'direction'],
	['minecraft:particle_initial_speed', ''],
	['minecraft:particle_initial_spin', 'rotation'],
	['minecraft:particle_initial_spin', 'rotation_rate'],
	['minecraft:particle_lifetime_expression', 'max_lifetime'],
	// particle update
	['minecraft:particle_initialization', 'per_update_expression'],
	['minecraft:particle_motion_dynamic', 'linear_acceleration'],
	['minecraft:particle_motion_dynamic', 'linear_drag_coefficient'],
	['minecraft:particle_motion_dynamic', 'rotation_acceleration'],
	['minecraft:particle_motion_dynamic', 'rotation_drag_coefficient'],
	['minecraft:particle_motion_collision', 'enabled'],
	['minecraft:particle_motion_parametric', 'relative_position'],
	['minecraft:particle_motion_parametric', 'direction'],
	['minecraft:particle_motion_parametric', 'rotation'],
	['minecraft:particle_lifetime_expression', 'expiration_expression'],
	// render
	['minecraft:particle_initialization', 'per_render_expression'],
	['minecraft:particle_appearance_billboard', 'size'],
	['minecraft:particle_appearance_billboard', 'direction'],
	['minecraft:particle_appearance_billboard', 'uv'],
	['minecraft:particle_appearance_tinting', 'color'],
];

const AXIS_LABELS: Record<string, string[]> = {
	size: ['W', 'H'],
	uv: ['U', 'V'],
	uv_size: ['W', 'H'],
	base_UV: ['U', 'V'],
	color: ['R', 'G', 'B', 'A'],
};

function orderIndex(componentId: string, key: string): number {
	const isShape = componentId.startsWith('minecraft:emitter_shape_');
	const first = key.split('/')[0];
	const i = ORDER.findIndex(([c, k]) => (c === componentId || (isShape && c === '*shape')) && (k === first || k === ''));
	return i < 0 ? ORDER.length : i;
}

function isMolangField(x: unknown): x is MolangField {
	return !!x && typeof x === 'object' && 'expr' in x && 'path' in x && typeof (x as MolangField).path === 'string';
}

function collectFields(x: unknown, out: MolangField[], seen = new Set<unknown>()): void {
	if (!x || typeof x !== 'object' || seen.has(x)) return;
	seen.add(x);
	if (isMolangField(x)) {
		out.push(x);
		return;
	}
	if (x instanceof Map) {
		for (const v of x.values()) collectFields(v, out, seen);
		return;
	}
	for (const v of Array.isArray(x) ? x : Object.values(x)) collectFields(v, out, seen);
}

function fieldInfo(componentId: string, key: string): FieldInfo | undefined {
	const c = COMPONENT_BY_ID.get(componentId);
	if (!c) return undefined;
	const first = key.split('/')[0];
	return c.fields.find((f) => f.key === first) ?? c.fields.find((f) => f.key === '');
}

function fallbackFor(info: FieldInfo | undefined, axis: number | null): number | null {
	if (!info) return 0;
	const k = info.kind;
	switch (k.type) {
		case 'molang':
			return k.default === undefined ? 0 : k.default;
		case 'vec':
			return k.default ? (k.default[axis ?? 0] ?? 0) : 0;
		case 'color':
			return 1;
		case 'statements':
			return null;
		default:
			return 0;
	}
}

/** Place a definition field into the evaluation order, with a label and phase */
function describeField(f: MolangField, eventRanks: Map<string, number>): Omit<FieldRef, 'analysis'> {
	const path = f.path;
	const segs = path.split('/');
	if (segs[1] === 'components') {
		const componentId = segs[2];
		let rest = segs.slice(3).join('/');
		let axis: number | null = null;
		const hash = rest.indexOf('#');
		if (hash >= 0) {
			axis = Number(rest.slice(hash + 1));
			rest = rest.slice(0, hash);
		}
		const restSegs = rest ? rest.split('/') : [];
		const last = restSegs[restSegs.length - 1];
		if (axis === null && last !== undefined && /^\d+$/.test(last)) {
			axis = Number(last);
			restSegs.pop();
		}
		const key = restSegs.join('/');
		const info = fieldInfo(componentId, key);
		const comp = COMPONENT_BY_ID.get(componentId);
		const phase: FieldPhase = info?.phase ?? 'particle';
		const sub = restSegs[restSegs.length - 1] ?? '';
		const axisLabel = axis !== null ? (AXIS_LABELS[sub] ?? AXIS_LABELS[info?.key ?? ''] ?? ['X', 'Y', 'Z', 'W'])[axis] : '';
		const subLabel = restSegs.length > 1 ? ` ${restSegs.slice(1).join(' ')}` : '';
		const label = `${comp?.label ?? componentId.replace('minecraft:', '')} › ${info?.label || key || 'Value'}${subLabel}${axisLabel ? ` ${axisLabel}` : ''}`;
		const expectsValue = info?.kind.type !== 'statements';
		return {
			path,
			componentId,
			key,
			axis,
			label,
			phase,
			rank: PHASE_BASE[phase] + orderIndex(componentId, key) * 10 + (axis ?? 0),
			field: f,
			expectsValue,
			fallback: fallbackFor(info, axis),
		};
	}
	if (segs[1] === 'curves') {
		const name = segs[2];
		return {
			path,
			componentId: null,
			key: name,
			axis: null,
			label: `Curve ${name.replace(/^variable\./, 'v.')} › ${segs.slice(3).join(' ')}`,
			phase: 'particle',
			rank: PHASE_BASE.particle - 5,
			field: f,
			expectsValue: true,
			fallback: 0,
		};
	}
	if (segs[1] === 'events') {
		const name = segs[2];
		return {
			path,
			componentId: null,
			key: name,
			axis: null,
			label: `Event ${name} › ${segs.includes('pre_effect_expression') ? 'child pre-effect' : 'expression'}`,
			phase: 'event',
			rank: eventRanks.get(name) ?? Infinity,
			field: f,
			expectsValue: false,
			fallback: null,
		};
	}
	return { path, componentId: null, key: path, axis: null, label: path, phase: 'event', rank: Infinity, field: f, expectsValue: true, fallback: 0 };
}

/** First-frame rank at which each event can first fire */
function computeEventRanks(def: EffectDefinition): Map<string, number> {
	const ranks = new Map<string, number>();
	const at = (names: string[], rank: number) => {
		for (const n of names) ranks.set(n, Math.min(ranks.get(n) ?? Infinity, rank));
	};
	const e = def.emitter.events;
	at(e.creation, PHASE_BASE.setup + orderIndex('minecraft:emitter_initialization', 'creation_expression') * 10 + 5);
	for (const t of e.timeline) at(t.events, PHASE_BASE.emitter + 900);
	for (const t of e.travelDistance) at(t.events, PHASE_BASE.emitter + 900);
	for (const t of e.loopingTravelDistance) at(t.events, PHASE_BASE.emitter + 900);
	at(e.expiration, PHASE_BASE.emitter + 950);
	const p = def.particle.events;
	at(p.creation, PHASE_BASE.spawn + 990);
	for (const t of p.timeline) at(t.events, PHASE_BASE.particle + 900);
	at(p.expiration, PHASE_BASE.particle + 950);
	for (const c of def.particle.collision?.events ?? []) at([c.event], PHASE_BASE.particle + 500);
	// events reached through sequences/randomize from an already-ranked event share its rank (no nesting by name in Bedrock)
	return ranks;
}

/** Analyze the whole effect: fields in order, variable data flow and faithful problems */
export function analyzeEffect(def: EffectDefinition, options: AnalysisOptions = {}): EffectAnalysis {
	const raw: MolangField[] = [];
	collectFields(
		{ curves: def.curves, emitter: def.emitter, particle: def.particle, events: [...def.events.values()].map(eventFields) },
		raw,
	);
	const eventRanks = computeEventRanks(def);
	const fields: FieldRef[] = raw
		.filter((f) => !f.path.includes('pre_effect_expression'))
		.map((f) => {
			const d = describeField(f, eventRanks);
			const program = f.broken ? null : f.expr.program;
			const a = program && program.body.length ? analyze(program, { context: 'particle', expectsValue: d.expectsValue }) : null;
			return { ...d, analysis: a };
		})
		.sort((a, b) => a.rank - b.rank);
	const byPath = new Map(fields.map((f) => [f.path, f]));
	const problems: Problem[] = [];

	// definition-level problems (compile errors, broken fields, structure)
	for (const d of def.diagnostics) {
		const ref = byPath.get(d.path);
		const broken = ref?.field.broken;
		let message = d.code === 'unknown-query' ? explainQueryError(d.message) : d.message;
		if (d.severity === 'error' && (broken || (!ref && (d.start > 0 || d.end > 0)))) message = message.replace(/\.$/, '');
		if (d.severity === 'error' && broken) {
			message += ref.fallback === null ? '. The game ignores this whole field.' : `. The game ignores this whole field and uses ${ref.fallback}.`;
		} else if (d.severity === 'error' && !ref && (d.start > 0 || d.end > 0)) {
			// a Molang error in a field with no default (max_lifetime, expiration): it behaves as if absent
			message += '. The game ignores this whole field.';
		}
		problems.push({ path: d.path, severity: d.severity, message, code: d.code, from: d.start || undefined, to: d.end || undefined, source: d.code === 'unknown-component' || !ref ? 'effect' : 'molang' });
	}
	for (const f of fields) {
		if (!f.analysis) continue;
		for (const d of f.analysis.diagnostics) {
			if (d.code === 'unknown-query') continue;
			problems.push({ path: f.path, severity: d.severity, message: d.message, code: d.code, from: d.start, to: d.end, source: 'molang' });
		}
	}

	// ---- variable data flow
	type Write = { rank: number; use: VariableUse };
	const writes = new Map<string, Write[]>();
	const reads = new Map<string, VariableUse[]>();
	const temps = new Set<string>();
	const tempWrites = new Set<string>();
	const tempReads = new Set<string>();
	const contextReads = new Set<string>();
	const addWrite = (name: string, rank: number, use: VariableUse) => {
		const list = writes.get(name) ?? [];
		if (!list.some((w) => w.use.path === use.path)) list.push({ rank, use });
		writes.set(name, list);
	};
	for (const c of def.curves) addWrite(c.name, PHASE_BASE.particle - 5, { path: c.path, label: `Curve ${c.name.replace(/^variable\./, 'v.')}`, phase: 'particle' });
	for (const f of fields) {
		if (!f.analysis) continue;
		const phase = f.phase;
		for (const w of f.analysis.writes) {
			if (w.ns === 'temp') {
				temps.add(w.name);
				tempWrites.add(w.name);
			}
			if (w.ns === 'variable') addWrite(w.name, f.rank, { path: f.path, label: f.label, phase });
		}
		for (const r of f.analysis.reads) {
			if (r.ns === 'temp') {
				temps.add(r.name);
				tempReads.add(r.name);
			}
			if (r.ns === 'context') contextReads.add(r.name);
			if (r.ns !== 'variable') continue;
			const list = reads.get(r.name) ?? [];
			if (!list.some((u) => u.path === f.path)) list.push({ path: f.path, label: f.label, phase });
			reads.set(r.name, list);
		}
	}

	// structs (t67, t68): setting v.a.b sets the struct v.a; v.c = v.a fills v.c's members, so a member counts as
	// set wherever the nearest struct above it is
	for (const [name, list] of [...writes]) for (const parent of structsOf(name)) for (const w of list) addWrite(parent, w.rank, w.use);
	const writesOf = (name: string): Write[] => {
		for (const n of [name, ...structsOf(name).reverse()]) {
			const ws = writes.get(n);
			if (ws?.length) return ws;
		}
		return [];
	};

	const external = options.external ?? {};
	const parents = options.parents ?? {};
	const names = new Set<string>([...writes.keys(), ...reads.keys(), ...Object.keys(external)]);
	const variables: VariableInfo[] = [...names].sort().map((name) => ({
		name,
		writes: writesOf(name).map((w) => w.use),
		reads: reads.get(name) ?? [],
		builtin: BUILTIN_VARIABLES[name],
		curve: def.curves.some((c) => c.name === name),
		external: external[name],
	}));

	// read before write: a read that nothing earlier in the first frame has set aborts its expression
	for (const f of fields) {
		if (!f.analysis || f.rank === Infinity) continue;
		const writtenHere = new Map<string, number>();
		for (const w of f.analysis.writes) for (const n of [w.name, ...structsOf(w.name)]) if (!writtenHere.has(n)) writtenHere.set(n, w.order);
		const reported = new Set<string>();
		for (const r of f.analysis.reads) {
			if (r.ns !== 'variable' || r.guarded || reported.has(r.name)) continue;
			if (BUILTIN_VARIABLES[r.name] || external[r.name]) continue;
			const local = [r.name, ...structsOf(r.name)].map((n) => writtenHere.get(n)).find((o) => o !== undefined);
			if (local !== undefined && local < r.order) continue;
			const ws = writesOf(r.name);
			if (ws.some((w) => w.rank < f.rank)) continue;
			reported.add(r.name);
			const short = r.name.replace(/^variable\./, 'v.');
			if (!ws.length && parents[r.name]) {
				problems.push({
					path: f.path,
					severity: 'info',
					code: 'set-by-parent',
					message: `Only ${parents[r.name]} sets ${short}, in its pre-effect when it spawns this effect. Spawned any other way (/particle, a script, another event), reading it aborts this expression.`,
					from: r.start,
					to: r.end,
					source: 'effect',
				});
				continue;
			}
			if (!ws.length) {
				problems.push({
					path: f.path,
					severity: 'error',
					code: 'never-set',
					message: `Nothing sets ${short}, so reading it aborts this expression in-game (it evaluates to 0). Set it earlier or use ${short} ?? <default>.`,
					from: r.start,
					to: r.end,
					source: 'effect',
				});
				continue;
			}
			const first = ws.reduce((a, b) => (b.rank < a.rank ? b : a));
			const setupBeforeCreation = f.phase === 'setup' && first.use.label.includes('On creation');
			problems.push({
				path: f.path,
				severity: 'warning',
				code: 'read-before-write',
				message: setupBeforeCreation
					? `${f.label.split(' › ')[1]} is evaluated before creation_expression, so the first time ${short} isn't set yet and this expression aborts (0).`
					: `${short} is read before ${first.use.label} first sets it, so on the first frame this expression aborts (0).`,
				from: r.start,
				to: r.end,
				source: 'effect',
			});
		}
	}

	// update → render carry: the map is shared, so render sees the last particle's value. A render
	// expression that sets the variable itself before reading it (index-counter patterns) is fine.
	for (const f of fields) {
		if (f.phase !== 'render' || !f.analysis) continue;
		const firstWrite = new Map<string, number>();
		for (const w of f.analysis.writes) if (!firstWrite.has(w.name)) firstWrite.set(w.name, w.order);
		const reported = new Set<string>();
		for (const r of f.analysis.reads) {
			if (r.ns !== 'variable' || reported.has(r.name) || BUILTIN_VARIABLES[r.name]) continue;
			const local = firstWrite.get(r.name);
			if (local !== undefined && local < r.order) continue;
			// curves are evaluated again for each particle just before its render expressions, so they're fine
			if (def.curves.some((c) => c.name === r.name)) continue;
			const ws = writes.get(r.name) ?? [];
			if (!ws.some((w) => w.use.phase === 'particle' || w.use.phase === 'spawn')) continue;
			if (ws.some((w) => w.use.phase === 'render' && w.rank < f.rank)) continue;
			reported.add(r.name);
			problems.push({
				path: f.path,
				severity: 'warning',
				code: 'update-render-carry',
				message: `${r.name.replace(/^variable\./, 'v.')} is set per particle before render, but variables are shared by the whole emitter: render sees the value left by the last particle, not this one's.`,
				from: r.start,
				to: r.end,
				source: 'effect',
			});
		}
	}

	const queryMap = new Map<string, EffectAnalysis['queries'][number]>();
	for (const f of fields) {
		for (const q of f.analysis?.queries ?? []) {
			let entry = queryMap.get(q.signature);
			if (!entry) queryMap.set(q.signature, (entry = { signature: q.signature, name: q.name, args: q.args, uses: [] }));
			if (!entry.uses.some((u) => u.path === f.path)) entry.uses.push({ path: f.path, label: f.label, phase: f.phase });
		}
	}

	problems.push(...structuralChecks(def, options, fields));
	return { fields, byPath, variables, temps: [...temps], tempInputs: [...tempReads].filter((t) => !tempWrites.has(t)).sort(), contextInputs: [...contextReads].sort(), problems, eventRanks, queries: [...queryMap.values()].sort((a, b) => a.signature.localeCompare(b.signature)) };
}

/** What of an event node the game runs (t51): one with a sequence or randomize ignores its own parts */
function eventFields(node: EventNode): unknown {
	if (node.sequence || node.randomize) return { sequence: node.sequence?.map(eventFields), randomize: node.randomize?.map((o) => ({ weight: o.weight, node: eventFields(o.node) })) };
	return node;
}

function structuralChecks(def: EffectDefinition, options: AnalysisOptions, fields: FieldRef[] = []): Problem[] {
	const out: Problem[] = [];
	const C = 'particle_effect/components';
	const add = (path: string, severity: Problem['severity'], code: string, message: string) => out.push({ path, severity, code, message, source: 'effect' });
	if (!def.particle.hasLifetimeComponent) {
		add(C, 'warning', 'no-lifetime', 'Without a Particle lifetime component, particles die on their first update and are never drawn.');
	}
	// events, as the game runs them (t48–t53)
	const fromCreation = new Set(def.particle.events.creation);
	const walk = (node: EventNode, creation: boolean) => {
		if (node.sequence || node.randomize) {
			const own = [node.expression && 'expression', node.particleEffect && 'spawn', node.sound && 'sound'].filter(Boolean) as string[];
			if (own.length) add(node.path, 'warning', 'event-ignored', `This step has a ${node.sequence ? 'sequence' : 'random choice'}, so the game ignores its own ${own.join(' and ')}. Move ${own.length > 1 ? 'them' : 'it'} into a step of the sequence.`);
			const r = node.randomize ?? [];
			if (r.length > 1 && r.every((o) => o.weight === 0)) add(`${node.path}/randomize`, 'info', 'zero-weights', 'Every option weighs 0, so the game always picks the first.');
			else r.forEach((o, i) => o.weight === 0 && add(`${node.path}/randomize/${i}/weight`, 'info', 'zero-weight', 'Weighs 0, so the game never picks this option while another weighs more.'));
			node.sequence?.forEach((x) => walk(x, creation));
			r.forEach((o) => walk(o.node, creation));
			return;
		}
		const single = node.particleEffect?.type === 'particle' || node.particleEffect?.type === 'particle_with_velocity';
		if (node.particleEffect && single)
			add(`${node.path}/particle_effect`, 'warning', 'single-spawn-origin', "For effects spawned with /particle or a script, a single-particle spawn appears at the world origin in-game, not where the event fired. Spawn type 'emitter' appears at the particle or emitter.");
		else if (node.particleEffect && creation)
			add(`${node.path}/particle_effect`, 'warning', 'creation-spawn-origin', "This event fires when a particle is created; for effects spawned with /particle or a script, what it spawns lands in-game at the particle's offset from its emitter taken as a world position (near the world origin), not at the particle. Particle timeline and expiration events spawn at the particle.");
	};
	for (const [name, node] of def.events) walk(node, fromCreation.has(name));

	// camera rotation queries don't follow the camera in /particle and script spawns (t60-t63)
	if (options.spawnContext !== 'entity') {
		const constant: Record<string, string> = { 'query.camera_rotation': 'always reads 0', 'query.rotation_to_camera': 'reads a constant 0 (x) and -90 (y)' };
		for (const f of fields)
			for (const r of f.analysis?.queries ?? []) {
				const what = constant[r.name];
				if (what) out.push({ path: f.path, severity: 'warning', code: 'camera-query-constant', message: `${r.name.replace(/^query\./, 'q.')} ${what} in effects spawned with /particle or a script, whatever the camera does (measured in-game). q.distance_from_camera does follow the camera.`, from: r.start, to: r.end, source: 'effect' });
			}
	}

	const cap = options.cap ?? 1000;
	const rate = def.emitter.rate;
	const ctxName = options.spawnContext === 'entity' ? 'entity emitters' : '/particle and script spawns';
	if (rate?.type === 'instant' && rate.numParticles.constant !== null && rate.numParticles.constant > cap) {
		add(rate.numParticles.path, 'info', 'cap', `The game keeps at most ${cap} live particles per emitter for ${ctxName}; the rest of the burst never spawns.`);
	}
	if ((rate?.type === 'steady' || rate?.type === 'manual') && rate.maxParticles.constant !== null && rate.maxParticles.constant > cap) {
		add(rate.maxParticles.path, 'info', 'cap', `The game keeps at most ${cap} live particles per emitter for ${ctxName}.`);
	}
	if (rate?.type === 'manual' && options.spawnContext !== 'entity') {
		add(`${C}/minecraft:emitter_rate_manual`, 'warning', 'manual-ends', 'Spawned with /particle or a script, a manual-rate emitter has nothing to drive it: it runs its creation (expression and creation event), then ends at once, without its timeline or expiration events (measured in-game). Use an instant or steady rate for effects spawned that way.');
	}
	if (def.emitter.lifetime?.type === 'looping' && options.spawnContext !== 'entity') {
		add(`${C}/minecraft:emitter_lifetime_looping`, 'info', 'no-loop', 'Only emitters attached to an entity loop. /particle and script spawns play one loop, then expire.');
	}
	const bb = def.particle.billboard;
	if (bb) {
		bb.size.forEach((s, i) => {
			if (s.constant !== null && s.constant <= 0) add(s.path, 'warning', 'hidden-size', `A ${i ? 'height' : 'width'} of ${s.constant} hides the particle in-game.`);
		});
		const dirMode = ['direction_x', 'direction_y', 'direction_z', 'lookat_direction'].includes(bb.facing);
		if (dirMode && bb.direction.mode === 'derive_from_velocity' && !def.particle.initialSpeed && !def.particle.dynamic && !def.particle.parametric?.direction) {
			add(`${C}/minecraft:particle_appearance_billboard/facing_camera_mode`, 'warning', 'no-direction', 'This facing mode follows the velocity, but nothing gives particles a velocity, so nothing is drawn.');
		}
	}
	if (def.material === 'particles_alpha' && def.particle.tint?.type === 'color') {
		const a = def.particle.tint.color[3];
		if (a.constant === null || a.constant < 1) add(a.path, 'info', 'cutout-tint-alpha', 'Cutout (particles_alpha) ignores tint alpha: only the texture alpha decides what is drawn.');
	}
	if (def.particle.collision && !def.particle.dynamic) {
		add(`${C}/minecraft:particle_motion_collision`, 'info', 'collision-needs-dynamic', 'Collision only moves particles that have Dynamic motion.');
	}
	return out;
}

/** The structs a dotted name is a member of, outermost first: `variable.a.b.c` → `variable.a`, `variable.a.b` */
function structsOf(name: string): string[] {
	const out: string[] = [];
	for (let dot = name.indexOf('.', name.indexOf('.') + 1); dot !== -1; dot = name.indexOf('.', dot + 1)) out.push(name.slice(0, dot));
	return out;
}
