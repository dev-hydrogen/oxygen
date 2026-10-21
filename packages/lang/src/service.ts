import { explainQueryError, getMathFunction, getQuery, molangMetadata, queryExists, type QueryInfo } from '@oxygen/metadata';
import {
	analyze,
	compile,
	format,
	LATEST_FEATURES,
	parse,
	SymbolTable,
	tokenize,
	type FormatStyle,
	type MolangFeatures,
	type Program,
	type Token,
} from 'molangjs';

/** Phase of the game's update loop that evaluates a field (matches @oxygen/format) */
export type Phase = 'setup' | 'emitter' | 'spawn' | 'particle' | 'render' | 'event';

export interface VariableUse {
	/** JSON path of the field */
	path: string;
	/** Human label, e.g. "Billboard › Size W" */
	label: string;
	phase: Phase;
}

export interface VariableInfo {
	/** canonical lowercase name, e.g. `variable.speed` */
	name: string;
	writes: VariableUse[];
	reads: VariableUse[];
	/** Engine-provided variable (emitter_age …) */
	builtin?: string;
	/** Written by a curve */
	curve?: boolean;
	/** Supplied from outside the effect (pre-effect script, Script API variables, scenarios) */
	external?: string;
}

/** What the editor knows about the surrounding effect. Every member is optional. */
export interface MolangContext {
	/** Phase of the field being edited */
	phase?: Phase;
	/** The field uses the expression's value (size, rate) rather than only its statements (creation_expression) */
	expectsValue?: boolean;
	/** Value the game uses when this field fails to load */
	fallback?: number | null;
	/** Variables of the whole effect */
	variables?: () => VariableInfo[];
	/** Temps used anywhere in the effect (temps are global in-game) */
	temps?: () => string[];
	features?: MolangFeatures;
	/** Live value for a node's source range (value lenses), if the debugger is attached */
	valueAt?: (from: number, to: number) => number | string | null;
	/** Extra diagnostics from effect-wide analysis */
	extraDiagnostics?: (source: string) => LangDiagnostic[];
	/** F2 on a variable: rename it across the effect */
	onRename?: (variable: string) => void;
	/** F12 / Ctrl+click on a variable: show where it's first set */
	onDefinition?: (variable: string) => void;
	/** Shift+F12 on a variable: list every expression that uses it */
	onReferences?: (variable: string) => void;
}

export const BUILTIN_VARIABLES: Record<string, string> = {
	'variable.emitter_age': 'Seconds since the emitter (or its current loop) started.',
	'variable.emitter_lifetime': 'The active time of the current loop, in seconds.',
	'variable.emitter_random_1': 'Random 0–1, fixed for the emitter (re-rolled each loop).',
	'variable.emitter_random_2': 'Random 0–1, fixed for the emitter (re-rolled each loop).',
	'variable.emitter_random_3': 'Random 0–1, fixed for the emitter (re-rolled each loop).',
	'variable.emitter_random_4': 'Random 0–1, fixed for the emitter (re-rolled each loop).',
	'variable.particle_age': 'Seconds since this particle spawned.',
	'variable.particle_lifetime': 'This particle’s max_lifetime, in seconds.',
	'variable.particle_random_1': 'Random 0–1, fixed for this particle.',
	'variable.particle_random_2': 'Random 0–1, fixed for this particle.',
	'variable.particle_random_3': 'Random 0–1, fixed for this particle.',
	'variable.particle_random_4': 'Random 0–1, fixed for this particle.',
};

const NS_LONG: Record<string, string> = { v: 'variable', t: 'temp', c: 'context', q: 'query' };

export function canonicalName(raw: string): string {
	const lower = raw.toLowerCase();
	const dot = lower.indexOf('.');
	if (dot < 0) return lower;
	const ns = lower.slice(0, dot);
	return (NS_LONG[ns] ?? ns) + lower.slice(dot);
}

// ------------------------------------------------------------------------------------------ tokens

export type TokenClass =
	| 'variable'
	| 'builtin'
	| 'temp'
	| 'context'
	| 'query'
	| 'math'
	| 'unknown'
	| 'number'
	| 'string'
	| 'keyword'
	| 'operator'
	| 'punct'
	| 'bracket'
	| 'comment'
	| 'error';

export interface ClassifiedToken {
	from: number;
	to: number;
	cls: TokenClass;
	/** nesting depth for brackets (rainbow), -1 for an unmatched bracket */
	depth?: number;
}

const OPEN = '([{';
const CLOSE = ')]}';

/** Semantic classification for highlighting (same tokenizer as the compiler, so colors match the game's parse) */
export function classify(src: string): ClassifiedToken[] {
	const out: ClassifiedToken[] = [];
	const stack: { ch: string; index: number }[] = [];
	for (const t of tokenize(src, { comments: true })) {
		if (t.type === 'eof') break;
		out.push({ from: t.start, to: t.end, cls: tokenClass(t) });
		if (t.type === 'punct' && (OPEN.includes(t.text) || CLOSE.includes(t.text))) {
			const entry = out[out.length - 1];
			entry.cls = 'bracket';
			if (OPEN.includes(t.text)) {
				entry.depth = stack.length;
				stack.push({ ch: t.text, index: out.length - 1 });
			} else {
				const want = OPEN[CLOSE.indexOf(t.text)];
				const top = stack[stack.length - 1];
				if (top && top.ch === want) {
					stack.pop();
					entry.depth = stack.length;
				} else entry.depth = -1;
			}
		}
	}
	for (const s of stack) out[s.index].depth = -1;
	return out;
}

function tokenClass(t: Token): TokenClass {
	switch (t.type) {
		case 'number':
			return 'number';
		case 'string':
			return 'string';
		case 'keyword':
			return 'keyword';
		case 'op':
			return 'operator';
		case 'punct':
			return 'punct';
		case 'comment':
			return 'comment';
		case 'error':
			return 'error';
		case 'name': {
			const full = canonicalName(t.text);
			if (full.startsWith('variable.')) return BUILTIN_VARIABLES[full] ? 'builtin' : 'variable';
			if (full.startsWith('temp.')) return 'temp';
			if (full.startsWith('context.')) return 'context';
			if (full.startsWith('query.')) return 'query';
			if (full.startsWith('math.')) return 'math';
			return 'unknown';
		}
		default:
			return 'punct';
	}
}


/** The variable name (canonical) under a position, if any */
export function variableAt(src: string, pos: number): string | null {
	const tok = tokenize(src, { comments: true }).find((t) => t.start <= pos && pos <= t.end && t.type === 'name');
	if (!tok) return null;
	const full = canonicalName(tok.text);
	return full.startsWith('variable.') && !BUILTIN_VARIABLES[full] ? full : null;
}

/**
 * Token ranges of `texts[index]` it shares, as a common prefix or suffix of at least two tokens, with any of
 * the other texts. Stacked X/Y/Z editors dim these so only what differs between similar axes stands out.
 */
export function sharedRanges(texts: string[], index: number): { from: number; to: number }[] {
	if (texts.length < 2 || !texts[index]) return [];
	const toks = texts.map((t) => tokenize(t, { comments: true }).filter((x) => x.type !== 'eof'));
	const mine = toks[index];
	let pre = 0;
	let suf = 0;
	toks.forEach((other, k) => {
		if (k === index) return;
		let p = 0;
		while (p < mine.length && p < other.length && other[p].text === mine[p].text) p++;
		let q = 0;
		while (q < mine.length - p && q < other.length - p && other[other.length - 1 - q].text === mine[mine.length - 1 - q].text) q++;
		if (p >= 2) pre = Math.max(pre, p);
		if (q >= 2) suf = Math.max(suf, q);
	});
	if (pre + suf > mine.length) suf = mine.length - pre;
	const out: { from: number; to: number }[] = [];
	if (pre > 0) out.push({ from: mine[0].start, to: mine[pre - 1].end });
	if (suf > 0) out.push({ from: mine[mine.length - suf].start, to: mine[mine.length - 1].end });
	return out;
}

// ------------------------------------------------------------------------------------------ completion

export interface CompletionItem {
	label: string;
	/** Text inserted (defaults to label) */
	apply?: string;
	type: 'variable' | 'function' | 'keyword' | 'namespace' | 'constant' | 'property' | 'snippet';
	detail?: string;
	info?: string;
	boost?: number;
	/** snippet template with `${1:name}` fields (same field name = edited together) */
	snippet?: string;
}

export interface CompletionResult {
	from: number;
	to: number;
	items: CompletionItem[];
}

const KEYWORD_ITEMS: CompletionItem[] = [
	{ label: 'return', type: 'keyword', info: 'Ends the expression with a value. Without it, an expression with statements evaluates to 0.' },
	{ label: 'loop', apply: 'loop(', type: 'keyword', info: 'loop(count, { … }) — a fractional count rounds up; break and continue work.' },
	{ label: 'break', type: 'keyword', info: 'Leaves the innermost loop.' },
	{ label: 'continue', type: 'keyword', info: 'Skips to the next loop iteration.' },
];

/** Common particle Molang patterns, as fill-in templates */
export const SNIPPETS: CompletionItem[] = [
	{
		label: 'index',
		type: 'snippet',
		detail: 'particle index counter',
		info: 'Bedrock has no particle index. Count particles as this pass visits them; reset the counter to 0 in the emitter per_update_expression. Each pass (update, render) needs its own counter.',
		snippet: 'v.${1:idx} = v.${2:counter}; v.${2:counter} = v.${2:counter} + 1; return v.${1:idx} * ${3:0.1};',
	},
	{
		label: 'latch',
		type: 'snippet',
		detail: 'latch a random on a transition',
		info: 'math.random is fresh on every evaluation. Keep the old value except on the frame something happens.',
		snippet: 'v.${1:value} = (${2:v.reset} > 0.5) ? math.random(${3:0}, ${4:1}) : v.${1:value};',
	},
	{
		label: 'statemachine',
		type: 'snippet',
		detail: 'timer with random cooldown',
		info: 'Order matters: pick the next delay before resetting the timer. Initialize v.timer and v.delay in creation_expression.',
		snippet:
			'v.timer = v.timer + ${1:0.05};\nv.reset = (v.timer >= ${2:v.active_period} + v.delay) ? 1 : 0;\nv.delay = (v.reset > 0.5) ? math.random(${3:v.min}, ${4:v.max}) : v.delay;\nv.timer = (v.reset > 0.5) ? 0 : v.timer;',
	},
	{
		label: 'loop',
		type: 'snippet',
		detail: 'loop with a body',
		info: 'loop(count, { … }): a fractional count rounds up (loop(2.4) runs 3 times); break and continue work.',
		snippet: 'loop(${1:10}, {\n  ${2:t.i = t.i + 1;}\n});',
	},
	{
		label: 'overflow',
		type: 'snippet',
		detail: 'hide particles past a count',
		info: "Use the index from this pass, not one left over from another pass. Multiply size and alpha by v.visible.",
		snippet: 'v.visible = (v.${1:idx} < ${2:v.total} && ${2:v.total} > 0) ? 1 : 0;',
	},
	{
		label: 'expirecount',
		type: 'snippet',
		detail: 'expire particles past a count',
		info: 'For expiration_expression: tested after motion and aging. Reset v.expire_counter to 0 in per_update_expression. The -1 accounts for the increment.',
		snippet: 'v.expire_counter = v.expire_counter + 1; return v.expire_counter - 1 >= ${1:v.max_count};',
	},
	{
		label: 'lifefraction',
		type: 'snippet',
		detail: 'age / lifetime, guarded',
		info: 'Dividing by a zero lifetime evaluates to 0 and logs a content error.',
		snippet: '(v.particle_lifetime > 0 ? v.particle_age / v.particle_lifetime : 0)',
	},
	{
		label: 'between',
		type: 'snippet',
		detail: 'float-safe enum test',
		info: 'Values are floats: test a range instead of == for enum-like states.',
		snippet: '(${1:v.state} > ${2:0.5} && ${1:v.state} < ${3:1.5})',
	},
	{
		label: 'handoff',
		type: 'snippet',
		detail: 'pass a value to a child effect',
		info: "In an event's sequence: store into a temp in one step, then read it in a later step's pre_effect_expression (v.x = t.x;). Not in the same step: a step spawns before it runs its own expression. Temps are global in-game, so this is how data crosses into a child.",
		snippet: 't.${1:value} = v.${1:value};',
	},
];

function shortStyle(prefix: string): boolean {
	return /^(v|t|c|q)\./i.test(prefix);
}

/** Completions at `pos`. Returns null when the cursor is not in a name. */
export function complete(src: string, pos: number, ctx: MolangContext = {}, explicit = false): CompletionResult | null {
	const before = src.slice(0, pos);
	if (inString(before)) return null;
	const m = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]*)*$/.exec(before);
	const word = m ? m[0] : '';
	const from = pos - word.length;
	let to = pos;
	while (to < src.length && /[A-Za-z0-9_]/.test(src[to])) to++;
	if (!word && !explicit) return null;
	const dot = word.indexOf('.');
	if (dot < 0) {
		const items: CompletionItem[] = [
			{ label: 'v.', type: 'namespace', detail: 'variable', info: "The emitter's variables. One map is shared by all its particles.", boost: 3 },
			{ label: 't.', type: 'namespace', detail: 'temp', info: 'Temporary values. In-game they are global: never cleared, shared between emitters.', boost: 1 },
			{ label: 'q.', type: 'namespace', detail: 'query', info: 'Read game state.', boost: 2 },
			{ label: 'math.', type: 'namespace', info: 'Math functions (degrees).', boost: 2 },
			{ label: 'c.', type: 'namespace', detail: 'context', info: 'Context values supplied by the caller.' },
			...KEYWORD_ITEMS,
			...SNIPPETS,
		];
		return { from, to, items };
	}
	const nsRaw = word.slice(0, dot).toLowerCase();
	const ns = NS_LONG[nsRaw] ?? nsRaw;
	const prefixText = word.slice(0, dot + 1);
	const nameFrom = from + dot + 1;
	const short = shortStyle(prefixText);
	void short;
	switch (ns) {
		case 'variable': {
			const vars = new Map<string, CompletionItem>();
			for (const v of ctx.variables?.() ?? []) {
				const name = v.name.slice('variable.'.length);
				vars.set(name, {
					label: name,
					type: 'variable',
					detail: v.curve ? 'curve' : v.external ? v.external : describeUses(v),
					info: variableInfo(v),
					boost: v.writes.length ? 2 : 0,
				});
			}
			for (const [full, doc] of Object.entries(BUILTIN_VARIABLES)) {
				const name = full.slice('variable.'.length);
				if (!vars.has(name)) vars.set(name, { label: name, type: 'constant', detail: 'built-in', info: doc, boost: 1 });
			}
			return { from: nameFrom, to, items: [...vars.values()] };
		}
		case 'temp': {
			const names = ctx.temps?.() ?? [];
			return { from: nameFrom, to, items: names.map((n) => ({ label: n.replace(/^temp\./, ''), type: 'variable' as const, detail: 'temp' })) };
		}
		case 'query': {
			const items = molangMetadata.queries.filter((q) => queryExists(q.name)).map((q) => queryItem(q));
			return { from: nameFrom, to, items };
		}
		case 'math': {
			const items: CompletionItem[] = molangMetadata.math.map((f) => ({
				label: f.name.slice(5),
				apply: f.params.length ? `${f.name.slice(5)}(` : f.name.slice(5),
				type: f.params.length ? 'function' : 'constant',
				detail: f.params.length ? `(${f.params.join(', ')})` : undefined,
				info: f.description,
			}));
			return { from: nameFrom, to, items };
		}
		default:
			return { from: nameFrom, to, items: [] };
	}
}

function queryItem(q: QueryInfo): CompletionItem {
	const name = q.name.slice(6);
	const args = q.maxArgs === 0 ? '' : q.minArgs === q.maxArgs ? `${q.minArgs} arg${q.minArgs === 1 ? '' : 's'}` : `${q.minArgs}–${q.maxArgs ?? '∞'} args`;
	return {
		label: name,
		apply: q.maxArgs && q.maxArgs > 0 ? `${name}(` : name,
		type: 'function',
		detail: [args, q.context === 'entity' ? 'entity emitters' : ''].filter(Boolean).join(', ') || undefined,
		info: q.description,
		boost: q.context === 'any' ? 1 : 0,
	};
}

function describeUses(v: VariableInfo): string {
	if (!v.writes.length) return v.builtin ? 'built-in' : 'never written';
	const phases = [...new Set(v.writes.map((w) => w.phase))];
	return `set in ${phases.join(', ')}`;
}

function variableInfo(v: VariableInfo): string {
	const lines: string[] = [];
	if (v.builtin) lines.push(v.builtin);
	if (v.external) lines.push(`Supplied by ${v.external}.`);
	if (v.writes.length) lines.push(`Set by ${v.writes.map((w) => w.label).join(', ')}.`);
	else if (!v.builtin && !v.external && !v.curve) lines.push('Nothing in this effect sets it, so reading it aborts the expression in-game.');
	if (v.reads.length) lines.push(`Read by ${v.reads.map((r) => r.label).join(', ')}.`);
	return lines.join('\n');
}

function inString(before: string): boolean {
	let n = 0;
	for (let i = 0; i < before.length; i++) if (before[i] === "'") n++;
	return n % 2 === 1;
}

// ------------------------------------------------------------------------------------------ hover & signature

export interface HoverInfo {
	from: number;
	to: number;
	title: string;
	signature?: string;
	body: string;
	value?: number | string | null;
}

export function hoverAt(src: string, pos: number, ctx: MolangContext = {}): HoverInfo | null {
	const tok = tokenize(src, { comments: true }).find((t) => t.start <= pos && pos <= t.end && t.type !== 'eof');
	if (!tok || tok.type !== 'name') return null;
	const full = canonicalName(tok.text);
	const value = ctx.valueAt?.(tok.start, tok.end) ?? null;
	if (full.startsWith('query.')) {
		const q = getQuery(full);
		if (!q) return { from: tok.start, to: tok.end, title: full, body: 'Unknown query. The game rejects the whole field when it loads and uses the default instead.', value };
		return {
			from: tok.start,
			to: tok.end,
			title: full,
			signature: q.maxArgs === 0 ? undefined : `${full}(${q.minArgs === q.maxArgs ? `${q.minArgs} args` : `${q.minArgs}–${q.maxArgs ?? '∞'} args`})`,
			body: q.description + (q.context === 'entity' ? '\n\nOnly works for emitters attached to an entity.' : ''),
			value,
		};
	}
	if (full.startsWith('math.')) {
		const f = getMathFunction(full);
		if (!f) return { from: tok.start, to: tok.end, title: full, body: 'Unknown math function. The game rejects the whole field when it loads.', value };
		return { from: tok.start, to: tok.end, title: full, signature: `${full}(${f.params.join(', ')})`, body: f.description, value };
	}
	if (full.startsWith('variable.')) {
		const v = ctx.variables?.().find((x) => x.name === full);
		const builtin = BUILTIN_VARIABLES[full];
		const body = v ? variableInfo(v) : builtin ?? 'Nothing in this effect sets it, so reading it aborts the expression in-game. Use ?? to supply a default.';
		return { from: tok.start, to: tok.end, title: full, body, value };
	}
	if (full.startsWith('temp.')) {
		return { from: tok.start, to: tok.end, title: full, body: 'Temps are global in-game: never cleared between expressions, frames or emitters.', value };
	}
	return null;
}

export interface SignatureInfo {
	name: string;
	params: string[];
	active: number;
	description: string;
	/** position of the opening parenthesis */
	open: number;
}

/** The function call the cursor is inside, with the active argument */
export function signatureAt(src: string, pos: number): SignatureInfo | null {
	let depth = 0;
	let commas = 0;
	let inStr = false;
	for (let i = pos - 1; i >= 0; i--) {
		const ch = src[i];
		if (ch === "'") inStr = !inStr;
		if (inStr) continue;
		if (ch === ')' || ch === ']' || ch === '}') depth++;
		else if (ch === '(' || ch === '[' || ch === '{') {
			if (depth === 0) {
				if (ch !== '(') return null;
				const m = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\s*$/.exec(src.slice(0, i));
				if (!m) return null;
				const full = canonicalName(m[1]);
				if (full.startsWith('math.')) {
					const f = getMathFunction(full);
					if (!f) return null;
					return { name: full, params: f.params, active: commas, description: f.description, open: i };
				}
				if (full.startsWith('query.')) {
					const q = getQuery(full);
					if (!q) return null;
					const n = q.maxArgs ?? Math.max(q.minArgs, commas + 1);
					return { name: full, params: Array.from({ length: n }, (_, k) => `arg${k + 1}`), active: commas, description: q.description, open: i };
				}
				return null;
			}
			depth--;
		} else if (ch === ',' && depth === 0) commas++;
	}
	return null;
}

// ------------------------------------------------------------------------------------------ diagnostics

export interface LangDiagnostic {
	from: number;
	to: number;
	severity: 'error' | 'warning' | 'info';
	message: string;
	code: string;
}

const scratchSymbols = new SymbolTable();

/** Diagnostics for one expression, phrased as what the game does about each problem */
export function diagnose(src: string, ctx: MolangContext = {}): LangDiagnostic[] {
	const out: LangDiagnostic[] = [];
	if (!src.trim()) return out;
	const expr = compile(stripComments(src), {
		symbols: scratchSymbols,
		features: ctx.features ?? LATEST_FEATURES,
		queryExists,
		context: 'particle',
	});
	const fallback = ctx.fallback === undefined ? null : ctx.fallback;
	let hasError = false;
	for (const d of expr.diagnostics) {
		const isError = d.severity === 'error';
		hasError ||= isError;
		out.push({
			from: d.start,
			to: Math.max(d.end, d.start + 1),
			severity: d.severity,
			code: d.code,
			message: isError ? `${(d.code === 'unknown-query' ? explainQueryError(d.message) : d.message).replace(/\.$/, '')}. ${dropsField(fallback)}` : d.message,
		});
	}
	if (!hasError) {
		const a = analyze(expr.program, {
			context: 'particle',
			expectsValue: ctx.expectsValue,
			queryInfo: (n) => {
				const q = getQuery(n);
				return q ? { minArgs: q.minArgs, maxArgs: q.maxArgs } : undefined;
			},
		});
		for (const d of a.diagnostics) {
			if (d.code === 'unknown-query') continue; // already a compile error
			out.push({ from: d.start, to: Math.max(d.end, d.start + 1), severity: d.severity, code: d.code, message: d.message });
		}
	}
	if (ctx.extraDiagnostics) out.push(...ctx.extraDiagnostics(src));
	return out;
}

function dropsField(fallback: number | null): string {
	if (fallback === null) return 'The game ignores this whole field.';
	return `The game ignores this whole field and uses ${fallback}.`;
}

/** Remove editor-only `//` comments (Molang has none) */
export function stripComments(src: string): string {
	return src.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

// ------------------------------------------------------------------------------------------ formatting

export interface ParsedForFormat {
	program: Program;
	ok: boolean;
}

function parseWithComments(src: string, features?: MolangFeatures): ParsedForFormat {
	const { program, diagnostics } = parse(src, { features: features ?? LATEST_FEATURES, comments: true });
	return { program, ok: !diagnostics.some((d) => d.severity === 'error') };
}

/** Editor view: multi-line, indented, comments kept. Returns the input unchanged if it doesn't parse. */
export function prettyMolang(src: string, width = 64, features?: MolangFeatures): string {
	const { program, ok } = parseWithComments(src, features);
	if (!ok) return src;
	return format(program, { style: 'pretty', width, comments: true });
}

/** File form: single line, comments removed (they live in the file's oxygen block) */
export function compactMolang(src: string, style: Exclude<FormatStyle, 'pretty'> = 'spaced', features?: MolangFeatures): { text: string; comments: { before: number; text: string }[] } {
	const { program, ok } = parseWithComments(src, features);
	if (!ok) return { text: stripComments(src).replace(/\s*\n\s*/g, ' ').trim(), comments: [] };
	const comments = program.comments.map((c) => {
		let before = program.body.findIndex((s) => s.start > c.start);
		if (before < 0) before = program.body.length;
		return { before, text: c.text };
	});
	return { text: format(program, { style, comments: false }), comments };
}

/** Pretty form with stored comments re-inserted as `//` lines before their statements */
export function withComments(src: string, comments: { before: number; text: string }[], width = 64, features?: MolangFeatures): string {
	const { program, ok } = parseWithComments(src, features);
	if (!ok) return src;
	if (comments.length) {
		const body = program.body;
		program.comments = comments
			.map((c) => {
				const at = c.before < body.length ? body[c.before].start - 0.5 : program.end + 1;
				return { text: c.text, start: at, end: at };
			})
			.sort((a, b) => a.start - b.start);
	}
	return format(program, { style: 'pretty', width, comments: true });
}
