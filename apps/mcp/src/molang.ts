// Molang on its own: static analysis, and evaluation with values the agent gives (no effect, no browser)
import { getQuery } from '@oxygen/metadata';
import { analyze, BUILTIN_QUERIES, changesForEngine, compile, createEnv, format, MolangAbort, SymbolTable, TempScope, type Node, type Value } from 'molangjs';
import { annotate, val } from './debug/records';

const knownQuery = (n: string) => !!getQuery(n) || BUILTIN_QUERIES.has(n);

/** What the game's loader and Oxygen's analysis say about an expression, without running it */
export function analyzeMolang(o: { expression: string; engine?: string | number[] | null; version?: number | null; expectsValue?: boolean; ast?: boolean; js?: boolean }): Record<string, unknown> {
	const expr = compile(o.expression, { symbols: new SymbolTable(), engine: o.engine ?? null, version: o.version ?? null, context: 'particle', comments: true, queryExists: knownQuery });
	const program = expr.program;
	const an = analyze(program, {
		context: 'particle',
		expectsValue: o.expectsValue ?? true,
		queryInfo: (n) => getQuery(n) ?? (BUILTIN_QUERIES.has(n) ? { minArgs: 0, maxArgs: null } : undefined),
	});
	const diagnostics = [...expr.diagnostics, ...an.diagnostics.filter((d) => !expr.diagnostics.some((x) => x.code === d.code && x.start === d.start))];
	const out: Record<string, unknown> = {
		loads: expr.ok ? 'yes' : 'no: in a particle file the game drops this whole field (statements in it never run) and uses its default',
		diagnostics: diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message, text: o.expression.slice(d.start, d.end), at: [d.start, d.end] })),
		constant: expr.constant,
		complex: expr.complex,
		reads: [...new Set(an.reads.map((x) => x.name))],
		writes: [...new Set(an.writes.map((x) => x.name))],
		readBeforeWrite: [...an.readBeforeWrite],
		queries: an.queries.map((q) => q.signature),
		math: [...new Set(an.mathCalls.map((m) => m.name))],
		usesRandom: an.usesRandom,
		rules: program.features,
	};
	if (o.engine) out.versionedChanges = changesForEngine(o.engine);
	if (expr.ok) {
		out.pretty = format(program, { style: 'pretty' });
		out.compact = format(program, { style: 'spaced' });
	}
	if (o.ast) out.ast = program.body.map(simplify);
	if (o.js) out.js = expr.js;
	return out;
}

function simplify(n: Node): unknown {
	switch (n.type) {
		case 'Number':
			return n.value;
		case 'String':
			return `'${n.value}'`;
		case 'Name':
			return n.full;
		case 'Unary':
			return { [n.op]: simplify(n.arg) };
		case 'Binary':
		case 'Logical':
			return { op: n.op, left: simplify(n.left), right: simplify(n.right) };
		case 'Ternary':
			return { if: simplify(n.test), then: simplify(n.consequent), else: n.alternate ? simplify(n.alternate) : null };
		case 'Coalesce':
			return { '??': [simplify(n.left), simplify(n.right)] };
		case 'Assign':
			return { set: n.target.full, to: simplify(n.value) };
		case 'Call':
			return { call: n.callee.full, args: n.args.map(simplify) };
		case 'Block':
			return { block: n.body.map(simplify) };
		case 'Loop':
			return { loop: simplify(n.count), body: simplify(n.body) };
		case 'ForEach':
			return { for_each: simplify(n.variable), in: simplify(n.collection), body: simplify(n.body) };
		case 'Return':
			return { return: n.arg ? simplify(n.arg) : null };
		case 'Index':
			return { index: simplify(n.object), at: simplify(n.index) };
		case 'Arrow':
			return { '->': [simplify(n.left), simplify(n.right)] };
		case 'Error':
			return { error: n.message };
		default:
			return n.type.toLowerCase();
	}
}

/**
 * Evaluate an expression with the game's rules (32-bit floats, degrees, unset reads abort it, `??`, loops) and values
 * given by name: variables, temps, context values and queries (by name or exact call signature, e.g. `query.position(1)`)
 */
export function evaluateStandalone(o: { expression: string; variables?: Record<string, Value>; temps?: Record<string, Value>; contexts?: Record<string, Value>; queries?: Record<string, Value>; engine?: string | number[] | null; seed?: number }): Record<string, unknown> {
	const symbols = new SymbolTable();
	const expr = compile(o.expression, { symbols, engine: o.engine ?? null, mode: 'trace', context: 'particle', comments: true });
	const diagnostics = expr.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message, text: o.expression.slice(d.start, d.end) }));
	if (!expr.ok) return { loads: false, value: null, diagnostics, note: 'In a particle file the game drops this field and uses its default.' };
	const canon = (k: string, ns: string, short: string) => {
		const lower = k.toLowerCase();
		return lower.startsWith(`${short}.`) ? `${ns}.${lower.slice(short.length + 1)}` : lower.startsWith(`${ns}.`) ? lower : `${ns}.${lower}`;
	};
	const v: Value[] = [];
	for (const [k, x] of Object.entries(o.variables ?? {})) v[symbols.variable(canon(k, 'variable', 'v'))] = x;
	const t = new TempScope();
	for (const [k, x] of Object.entries(o.temps ?? {})) t.set(symbols.temp(canon(k, 'temp', 't')), x);
	const c: Value[] = [];
	for (const [k, x] of Object.entries(o.contexts ?? {})) c[symbols.context(canon(k, 'context', 'c'))] = x;
	const queries = new Map(Object.entries(o.queries ?? {}).map(([k, x]) => [canon(k, 'query', 'q').replace(/\s+/g, ''), x]));
	const unanswered = new Set<string>();
	const errors: string[] = [];
	let state = (o.seed ?? 0x5eed) >>> 0;
	const env = createEnv({
		v,
		t,
		c,
		unsetMode: 'abort',
		// the engine's random sequence (mulberry32)
		rnd: () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let z = state;
			z = Math.imul(z ^ (z >>> 15), z | 1);
			z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
			return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
		},
		err: (code, _node, detail) => errors.push(detail ? `${code}: ${detail}` : code),
		q: (id, args) => {
			const name = symbols.queryNames[id];
			const sig = `${name}(${args.map((a) => (typeof a === 'string' ? `'${a}'` : String(Math.fround(a) === a && !Number.isInteger(a) ? Number(a.toPrecision(7)) : a))).join(',')})`;
			const hit = queries.get(sig) ?? queries.get(name);
			if (hit === undefined) {
				unanswered.add(sig.replace(/,/g, ', '));
				return 0;
			}
			return hit;
		},
	});
	const values = new Map<number, Value[]>();
	env.trace = (node, x) => {
		const list = values.get(node);
		if (list) list.push(x);
		else values.set(node, [x]);
		return x;
	};
	let value: Value = 0;
	let aborted = false;
	try {
		value = expr.run(env);
	} catch (e) {
		if (e instanceof MolangAbort) aborted = true;
		else throw e;
	}
	const given = new Set(Object.keys(o.variables ?? {}).map((k) => canon(k, 'variable', 'v')));
	const set: Record<string, Value | null> = {};
	symbols.variableNames.forEach((n, i) => {
		if (v[i] !== undefined && (!given.has(n) || v[i] !== o.variables?.[Object.keys(o.variables).find((k) => canon(k, 'variable', 'v') === n)!])) set[n] = val(v[i]);
	});
	return {
		value: val(value),
		aborted,
		...(aborted ? { note: 'An unset variable, temp or context value was read, so the game stops the whole expression: it evaluates to 0.' } : {}),
		...(expr.complex && !aborted && !/\breturn\b/.test(o.expression) ? { note: "Statements without a 'return' evaluate to 0, like in the game." } : {}),
		diagnostics,
		parts: annotate(expr.program, values),
		variablesSet: set,
		temps: Object.fromEntries(t.entries(symbols.tempNames).map(([k, x]) => [k, val(x)])),
		...(unanswered.size ? { queriesWithoutValue: [...unanswered] } : {}),
		...(errors.length ? { contentErrors: errors } : {}),
	};
}
