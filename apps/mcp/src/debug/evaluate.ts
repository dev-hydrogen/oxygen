// Evaluating Molang inside a running world without changing it. Shared by the preview page and the tests.
import { MolangAbort, compile, type CompiledExpression, type Diagnostic, type Env, type Value } from 'molangjs';
import { evaluateCurve, type EffectDefinition, type EmitterInstance, type MolangField, type ParticleWorld } from 'wintersky';
import { annotate, changedVars, findField, val, type Part } from './records';

export interface EvaluationResult {
	value: Value | null;
	/** an unset variable or temp was read: the game stops the expression and it evaluates to 0 */
	aborted: boolean;
	parts: Part[];
	/** variables the expression set (before → after) */
	changed: Record<string, { before: Value | null; after: Value | null }>;
	/** content errors it raised (unset reads, division by zero, unknown queries) */
	errors: string[];
}

/** Compile Molang against a world's symbols, the way its effects' fields are compiled, with tracing on */
export function compileIn(world: ParticleWorld, source: string, engine: string | readonly number[] | null): { expr: CompiledExpression; diagnostics: Diagnostic[] } {
	const expr = compile(source, { symbols: world.symbols, engine, f32: world.options.f32, queryExists: world.options.queryExists ?? undefined, context: 'particle', mode: 'trace', comments: true });
	return { expr, diagnostics: expr.diagnostics };
}

/**
 * Run a compiled expression in an emitter's environment, then put back everything it could change: the emitter's
 * variables, the global temps, the random sequence and the content errors. The world goes on as if it never ran.
 */
export function runIsolated(world: ParticleWorld, e: EmitterInstance, expr: CompiledExpression, env: Env = e.env): EvaluationResult {
	const vars = e.vars.slice();
	const before = world.snapshotVars(e.vars);
	const temps = { v: world.temps.v.slice(), g: world.temps.g.slice(), gen: world.temps.gen };
	const rng = world.rng.state;
	const errors = new Map([...world.errors].map(([k, x]) => [k, { ...x }]));
	const current = { ...world.current };
	const trace = env.trace;
	const values = new Map<number, Value[]>();
	env.trace = (node, x) => {
		const list = values.get(node);
		if (list) list.push(x);
		else values.set(node, [x]);
		return x;
	};
	world.current.path = '(evaluate)';
	let value: Value = 0;
	let aborted = false;
	try {
		value = expr.run(env);
	} catch (err) {
		if (err instanceof MolangAbort) aborted = true;
		else throw err;
	} finally {
		env.trace = trace;
	}
	const after = world.snapshotVars(e.vars);
	const raised = [...world.errors.entries()].filter(([k]) => k.includes('|(evaluate)|')).map(([, x]) => (x.detail ? `${x.code}: ${x.detail}` : x.code));
	e.vars.length = 0;
	for (let k = 0; k < vars.length; k++) e.vars[k] = vars[k];
	world.temps.v = temps.v;
	world.temps.g = temps.g;
	world.temps.gen = temps.gen;
	world.rng.state = rng;
	world.errors = errors;
	Object.assign(world.current, current);
	return { value: val(value), aborted, parts: annotate(expr.program, values), changed: changedVars(before, after), errors: raised };
}

/**
 * Evaluate in an emitter as the frame left it: its variables, the built-ins written as its own fields see them
 * (v.emitter_*, and for particle `index` v.particle_* and the curves), queries and temps. Nothing changes.
 * Variables the particles share hold what the last writer left; use a field moment (watchField) for what one
 * particle saw.
 */
export function evaluateInEmitter(world: ParticleWorld, e: EmitterInstance, index: number, expr: CompiledExpression): EvaluationResult {
	const keep = e.vars.slice();
	const sl = world.slots;
	e.vars[sl.emitterAge] = e.age;
	e.vars[sl.emitterLifetime] = e.activeTime;
	for (let k = 0; k < 4; k++) e.vars[sl.emitterRandom[k]] = e.randoms[k];
	const run = (f: MolangField): number => {
		if (f.constant !== null) return f.constant;
		try {
			const v = f.expr.run(e.env);
			return typeof v === 'number' ? v : 0;
		} catch (err) {
			if (err instanceof MolangAbort) return 0;
			throw err;
		}
	};
	if (index >= 0) {
		const p = e.pool;
		e.vars[sl.particleAge] = p.age[index];
		e.vars[sl.particleLifetime] = p.lifetime[index];
		for (let k = 0; k < 4; k++) e.vars[sl.particleRandom[k]] = p.random[index * 4 + k];
		for (const c of e.def.curves) e.vars[c.slot] = evaluateCurve(c, run);
	}
	const qp = e.qctx.particle;
	e.qctx.particle = index;
	try {
		const res = runIsolated(world, e, expr);
		// what the built-ins and curves were set to isn't a change the expression made
		const builtin = new Set([...['emitter_age', 'emitter_lifetime', 'particle_age', 'particle_lifetime'].map((n) => `variable.${n}`), ...[1, 2, 3, 4].flatMap((k) => [`variable.emitter_random_${k}`, `variable.particle_random_${k}`]), ...e.def.curves.map((c) => c.name)]);
		for (const k of Object.keys(res.changed)) if (builtin.has(k)) delete res.changed[k];
		return res;
	} finally {
		e.qctx.particle = qp;
		e.vars.length = 0;
		for (let k = 0; k < keep.length; k++) e.vars[k] = keep[k];
	}
}

export interface FieldMoment {
	emitter: EmitterInstance;
	/** pool index of the particle, or -1 for an emitter field */
	index: number;
	env: Env;
}

/**
 * Call `at` at every evaluation of the field at `path` (in every given definition that has it), just before or just
 * after it runs, until `restore` is called. Constant fields are never evaluated by the engine; while watched they
 * are (they still give their constant), so their moments can be seen too.
 */
export function watchField(world: ParticleWorld, defs: Iterable<EffectDefinition>, path: string, when: 'before' | 'after', at: (m: FieldMoment) => void): { fields: number; restore: () => void } {
	const patched: { field: MolangField; expr: CompiledExpression; constant: number | null }[] = [];
	const moment = (env: Env) => {
		const emitter = world.emitters.find((e) => e.env === env);
		if (emitter) at({ emitter, index: emitter.qctx.particle, env });
	};
	for (const def of new Set(defs)) {
		const field = findField(def, path);
		if (!field || patched.some((p) => p.field === field)) continue;
		const orig = field.expr;
		patched.push({ field, expr: orig, constant: field.constant });
		field.constant = null;
		field.expr = {
			...orig,
			run: (env: Env) => {
				if (when === 'before') moment(env);
				try {
					return orig.run(env);
				} finally {
					if (when === 'after') moment(env);
				}
			},
		};
	}
	return {
		fields: patched.length,
		restore: () => {
			for (const p of patched) {
				p.field.expr = p.expr;
				p.field.constant = p.constant;
			}
		},
	};
}
