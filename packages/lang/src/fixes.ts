import { molangMetadata, queryExists } from '@oxygen/metadata';
import { parse, walk, type MolangFeatures, type Node } from 'molangjs';
import { stripComments, type LangDiagnostic, type MolangContext } from './service';

export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

export interface QuickFix {
	title: string;
	edits: TextEdit[];
}

function distance(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		const cur = [i];
		for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		prev = cur;
	}
	return prev[n];
}

/** Known names closest to a misspelled one (query or math function), in the author's prefix style */
function nearest(written: string, names: string[], longPrefix: string, shortPrefix: string): string[] {
	const lower = written.toLowerCase();
	const short = lower.startsWith(`${shortPrefix}.`);
	const bare = lower.replace(/^[a-z]+\./, '');
	return names
		.map((n) => n.replace(/^[a-z]+\./, ''))
		.map((n) => ({ n, d: distance(bare, n) - (n.startsWith(bare) || bare.startsWith(n) ? 1 : 0) }))
		.filter((x) => x.d <= Math.max(2, Math.floor(bare.length / 3)))
		.sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
		.slice(0, 3)
		.map((x) => `${short ? shortPrefix : longPrefix}.${x.n}`);
}

function nodeAt(src: string, from: number, to: number, features: MolangFeatures | undefined, type: Node['type']): Node | null {
	const program = parse(stripComments(src), { features }).program;
	let found: Node | null = null;
	for (const stmt of program.body)
		walk(stmt, (n) => {
			if (!found && n.type === type && n.start === from && n.end >= to - 1) found = n;
		});
	return found;
}

const wrap = (n: { start: number; end: number }): TextEdit[] => [
	{ from: n.start, to: n.start, insert: '(' },
	{ from: n.end, to: n.end, insert: ')' },
];

/**
 * Fixes for a diagnostic, as text edits on the field's source. Each keeps what the game currently
 * does where that is the point (parentheses spell out the grouping this pack version already uses).
 */
export function quickFixes(src: string, d: LangDiagnostic, ctx: MolangContext = {}): QuickFix[] {
	const out: QuickFix[] = [];
	switch (d.code) {
		case 'unknown-query':
		case 'unknown-function': {
			const m = /^[a-z_]+\.[a-z0-9_]*/i.exec(src.slice(d.from));
			if (!m) break;
			const isQuery = d.code === 'unknown-query';
			const names = isQuery ? molangMetadata.queries.filter((q) => queryExists(q.name)).map((q) => q.name) : molangMetadata.math.map((f) => f.name);
			for (const name of nearest(m[0], names, isQuery ? 'query' : 'math', isQuery ? 'q' : 'math')) out.push({ title: `Change to ${name}`, edits: [{ from: d.from, to: d.from + m[0].length, insert: name }] });
			break;
		}
		case 'missing-return': {
			const code = stripComments(src);
			const program = parse(code, { features: ctx.features }).program;
			const last = program.body[program.body.length - 1];
			if (last && last.type !== 'Assign' && last.type !== 'Return' && last.type !== 'Loop' && last.type !== 'Block') {
				// the statement starts after the previous ';' (its own span leaves out parentheses)
				let at = code.lastIndexOf(';', last.start - 1) + 1;
				while (at < last.start && /\s/.test(code[at])) at++;
				out.push({ title: 'Return the last statement’s value', edits: [{ from: at, to: at, insert: 'return ' }] });
			} else {
				const end = src.trimEnd().length;
				out.push({ title: 'Add return 0.0 at the end (what the game evaluates now)', edits: [{ from: end, to: end, insert: `${src.trimEnd().endsWith(';') ? ' ' : '; '}return 0;` }] });
			}
			break;
		}
		case 'ternary-assoc': {
			const t = nodeAt(src, d.from, d.to, ctx.features, 'Ternary') as Extract<Node, { type: 'Ternary' }> | null;
			if (!t) break;
			const rightAssoc = ctx.features?.ternaryRightAssoc ?? true;
			const nested = (n: Node | null): n is Node => !!n && n.type === 'Ternary' && !n.parens;
			if (rightAssoc && nested(t.alternate)) out.push({ title: 'Add parentheses: A ? B : (C ? D : E)', edits: wrap(t.alternate) });
			else if (nested(t.test)) out.push({ title: 'Add parentheses: (A ? B : C) ? D : E', edits: wrap(t.test) });
			break;
		}
		case 'mixed-logic': {
			const l = nodeAt(src, d.from, d.to, ctx.features, 'Logical') as Extract<Node, { type: 'Logical' }> | null;
			if (!l) break;
			const edits: TextEdit[] = [];
			for (const side of [l.left, l.right]) if (side.type === 'Logical' && side.op !== l.op && !side.parens) edits.push(...wrap(side));
			if (edits.length) out.push({ title: 'Add parentheses (the grouping this pack version uses)', edits });
			break;
		}
		case 'never-set':
		case 'read-before-write': {
			const name = src.slice(d.from, d.to);
			if (/^(v|variable)\.[a-z0-9_]+$/i.test(name)) out.push({ title: `Use ${name} ?? 0 (reads 0 instead of aborting)`, edits: [{ from: d.from, to: d.to, insert: `(${name} ?? 0)` }] });
			break;
		}
	}
	return out;
}

/** Apply edits (in any order) to a string */
export function applyEdits(src: string, edits: TextEdit[]): string {
	let out = src;
	for (const e of [...edits].sort((a, b) => b.from - a.from || b.to - a.to)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
	return out;
}
