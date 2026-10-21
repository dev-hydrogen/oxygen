import { parse, tokenize, walk, type Node, type Token } from 'molangjs';
import { stripComments } from './service';

const key = (t: Token) => (t.type === 'name' || t.type === 'keyword' ? t.lower : t.type === 'number' ? String(t.value ?? t.text) : t.text);

function code(src: string): Token[] {
	return tokenize(src).filter((t) => t.type !== 'comment' && t.type !== 'eof');
}

/** Spans of every node in an expression (parenthesized nodes also by their outer span) */
function nodeSpans(src: string): Set<string> {
	const spans = new Set<string>();
	const program = parse(src).program;
	for (const stmt of program.body)
		walk(stmt, (n: Node) => {
			spans.add(`${n.start}:${n.end}`);
		});
	return spans;
}

/** Where `needle` (one expression) appears in `src` as a whole subexpression, left to right */
export function findExpression(src: string, needle: string): { from: number; to: number }[] {
	const s = stripComments(src);
	const want = code(needle).map(key);
	if (!want.length) return [];
	const toks = code(s);
	const spans = nodeSpans(s);
	const out: { from: number; to: number }[] = [];
	for (let i = 0; i + want.length <= toks.length; i++) {
		let ok = true;
		for (let k = 0; k < want.length && ok; k++) ok = key(toks[i + k]) === want[k];
		if (!ok) continue;
		const from = toks[i].start;
		const to = toks[i + want.length - 1].end;
		// tokens can match without being one subexpression: `a + b` inside `a + b * c`
		if (!spans.has(`${from}:${to}`)) continue;
		out.push({ from, to });
		i += want.length - 1;
	}
	return out;
}

/** Remove parentheses that wrap the whole selection: `(a + b)` → `a + b` */
function unwrap(sel: string): string {
	let s = sel.trim();
	for (;;) {
		if (!s.startsWith('(') || !s.endsWith(')')) return s;
		let depth = 0;
		let wraps = true;
		for (let i = 0; i < s.length; i++) {
			if (s[i] === '(') depth++;
			else if (s[i] === ')') depth--;
			if (depth === 0 && i < s.length - 1) {
				wraps = false;
				break;
			}
		}
		if (!wraps) return s;
		s = s.slice(1, -1).trim();
	}
}

export interface ExtractResult {
	texts: string[];
	/** occurrences replaced across all texts */
	occurrences: number;
}

/**
 * Compute a subexpression once, in the first text, and use a variable for it everywhere. For a vector
 * the first text is X: it runs before Y and Z, so they can read what X sets (how common position
 * patterns share work across axes). Only whole subexpressions are replaced.
 */
export function extractToVariable(texts: string[], selection: string, variable: string): ExtractResult | { error: string } {
	const sel = unwrap(stripComments(selection)).replace(/\s+/g, ' ');
	if (!sel) return { error: 'Select part of an expression first.' };
	const parsed = parse(sel);
	if (parsed.diagnostics.some((d) => d.severity === 'error') || parsed.program.complex || parsed.program.body.length !== 1) return { error: 'Select one complete expression, without ; or statements.' };
	const node = parsed.program.body[0];
	if (node.type === 'Assign' || node.type === 'Return') return { error: 'Select a value, not an assignment.' };
	if (node.type === 'Name' || node.type === 'Number') return { error: 'That is already a single value.' };

	// what the selection reads must be ready in the first text: not set by a later text before it's used
	const reads = new Set<string>();
	walk(node, (n: Node) => {
		if (n.type === 'Name' && (n.ns === 'variable' || n.ns === 'temp')) reads.add(n.full);
	});
	for (let i = 1; i < texts.length; i++) {
		const p = parse(stripComments(texts[i])).program;
		const first = findExpression(texts[i], sel)[0];
		let problem: string | null = null;
		for (const stmt of p.body)
			walk(stmt, (n: Node) => {
				if (problem || n.type !== 'Assign' || n.target.type !== 'Name' || !reads.has(n.target.full)) return;
				if (!first || n.start < first.from) problem = n.target.full.replace(/^variable\./, 'v.').replace(/^temp\./, 't.');
			});
		if (problem) return { error: `${problem} is set later (in axis ${i + 1}) before this is used, so the first axis can't compute it yet.` };
	}

	let occurrences = 0;
	const out = texts.map((t, i) => {
		const spans = findExpression(t, sel);
		occurrences += spans.length;
		let next = t;
		for (const s of [...spans].reverse()) next = next.slice(0, s.from) + variable + next.slice(s.to);
		if (i > 0) return next;
		const assign = `${variable} = ${sel};`;
		const p = parse(stripComments(t)).program;
		if (!p.complex) return next.trim() ? `${assign} return ${next.trim()};` : assign;
		// before the statement that first uses it, else before the last statement (the value)
		const c = stripComments(t);
		const anchor = spans[0]?.from ?? p.body[p.body.length - 1]?.start ?? c.length;
		let at = c.lastIndexOf(';', anchor - 1) + 1;
		while (at < anchor && /\s/.test(c[at])) at++;
		// `at` is in the original text; replacements after it shift nothing before it
		return next.slice(0, at) + `${assign} ` + next.slice(at);
	});
	return { texts: out, occurrences };
}

/**
 * Move whole statements (selected anywhere in `from`) to the end of `to`: a refactor across phases, e.g. from
 * particle update to particle render. Only complete statements move; the texts keep their other statements.
 */
export function moveStatements(from: string, selection: string, to: string): { from: string; to: string; moved: number } | { error: string } {
	const sel = stripComments(selection).trim();
	if (!sel) return { error: 'Select one or more statements first.' };
	const parsed = parse(sel.endsWith(';') ? sel : `${sel};`);
	if (parsed.diagnostics.some((d) => d.severity === 'error') || !parsed.program.body.length) return { error: 'Select whole statements, ending with ;' };
	if (parsed.program.body.some((s) => s.type === 'Return')) return { error: "A return can't move: it gives this field its value." };
	const src = stripComments(from);
	const want = code(sel).map(key);
	if (want[want.length - 1] !== ';') want.push(';');
	const toks = code(src);
	for (let i = 0; i + want.length <= toks.length; i++) {
		let ok = true;
		for (let k = 0; k < want.length && ok; k++) ok = key(toks[i + k]) === want[k];
		// must start a statement: at the beginning or right after a ;
		if (!ok || (i > 0 && toks[i - 1].text !== ';')) continue;
		const start = toks[i].start;
		let end = toks[i + want.length - 1].end;
		while (end < from.length && /\s/.test(from[end])) end++;
		const statements = from.slice(start, toks[i + want.length - 1].end);
		const rest = (from.slice(0, start) + from.slice(end)).trim();
		const target = to.trim();
		return { from: rest, to: target ? `${target}${target.endsWith(';') ? ' ' : '; '}${statements}` : statements, moved: parsed.program.body.length };
	}
	return { error: 'Those statements are not in this field as written.' };
}
