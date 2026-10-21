import { describe, expect, it } from 'vitest';
import { classify, compactMolang, complete, diagnose, hoverAt, prettyMolang, signatureAt, withComments } from '../src/service';

describe('classify', () => {
	it('classifies names by namespace and colors brackets by depth', () => {
		const t = classify('v.a = math.sin(q.anim_time * (t.x + 1));');
		const cls = (text: string) => t.find((x) => 'v.a = math.sin(q.anim_time * (t.x + 1));'.slice(x.from, x.to) === text)?.cls;
		expect(cls('v.a')).toBe('variable');
		expect(cls('math.sin')).toBe('math');
		expect(cls('q.anim_time')).toBe('query');
		expect(cls('t.x')).toBe('temp');
		const depths = t.filter((x) => x.cls === 'bracket').map((x) => x.depth);
		expect(depths).toEqual([0, 1, 1, 0]);
	});
	it('marks unmatched brackets', () => {
		const t = classify('(1 + 2');
		expect(t[0].depth).toBe(-1);
	});
	it('marks built-in variables', () => {
		expect(classify('v.particle_age')[0].cls).toBe('builtin');
	});
});

describe('complete', () => {
	it('offers namespaces at the start of a name', () => {
		const r = complete('', 0, {}, true)!;
		expect(r.items.map((i) => i.label)).toContain('v.');
	});
	it('offers queries after q.', () => {
		const r = complete('q.anim', 6)!;
		expect(r.from).toBe(2);
		expect(r.items.some((i) => i.label === 'anim_time')).toBe(true);
	});
	it('offers effect variables and built-ins after v.', () => {
		const r = complete('v.', 2, { variables: () => [{ name: 'variable.speed', writes: [{ path: 'x', label: 'On creation', phase: 'setup' }], reads: [] }] })!;
		const labels = r.items.map((i) => i.label);
		expect(labels).toContain('speed');
		expect(labels).toContain('particle_age');
	});
	it('stays quiet inside strings', () => {
		expect(complete("'v.", 3)).toBeNull();
	});
});

describe('hover and signatures', () => {
	it('documents queries', () => {
		const h = hoverAt('q.position(1)', 3)!;
		expect(h.title).toBe('query.position');
		expect(h.body).toContain('position');
	});
	it('explains unset variables', () => {
		expect(hoverAt('v.nope', 2)!.body).toContain('aborts');
	});
	it('tracks the active argument', () => {
		const s = signatureAt('math.clamp(v.a, 0, ', 19)!;
		expect(s.name).toBe('math.clamp');
		expect(s.active).toBe(2);
	});
});

describe('diagnose', () => {
	it('phrases errors as what the game does', () => {
		const d = diagnose('1 +', { fallback: 1 });
		expect(d[0].severity).toBe('error');
		expect(d[0].message).toContain('uses 1');
	});
	it('flags unknown queries as load errors', () => {
		expect(diagnose('q.not_a_query').some((d) => d.message.includes('Failed to resolve query'))).toBe(true);
	});
	it('treats queries outside the default query set as load errors, and says why', () => {
		for (const src of ['q.heightmap(0, 0)', 'q.above_top_solid(0, 0)', "q.has_biome_tag('ocean')", "q.any_tag('x')"]) {
			const d = diagnose(src, { fallback: 1 });
			expect(d.length, src).toBe(1);
			expect(d[0].code).toBe('unknown-query');
			expect(d[0].message).toMatch(/particle Molang can't use/);
			expect(d[0].message).toContain('uses 1');
		}
		expect(diagnose('q.heightmap(0, 0)')[0].message).toMatch(/^query\.heightmap is a world generation query/);
		expect(diagnose('q.time_of_day + q.position(1)')).toEqual([]);
		expect(complete('q.heightm', 9)?.items.some((i) => i.label.includes('heightmap')) ?? false).toBe(false);
	});
	it('warns about missing return in value fields', () => {
		expect(diagnose('v.a = 1; v.a;', { expectsValue: true }).some((d) => d.code === 'missing-return')).toBe(true);
	});
	it('ignores editor comments', () => {
		expect(diagnose('// note\n1 + 2')).toEqual([]);
	});
});

describe('formatting', () => {
	it('pretty prints and compacts while keeping comments aside', () => {
		const src = 'v.a = 1; // first\nv.b = math.clamp(v.a, 0, 1);';
		const { text, comments } = compactMolang(src);
		expect(text).toBe('v.a = 1; v.b = math.clamp(v.a, 0, 1);');
		expect(comments).toEqual([{ before: 1, text: 'first' }]);
		const restored = withComments(text, comments);
		expect(restored).toContain('// first');
		expect(restored.indexOf('// first')).toBeGreaterThan(restored.indexOf('v.a = 1'));
		expect(prettyMolang('1+2')).toBe('1 + 2');
	});
});

describe('sharedRanges', () => {
	it('dims what similar axes share and ignores unrelated ones', async () => {
		const { sharedRanges } = await import('../src/service');
		const x = 'math.cos(v.t) * v.r';
		const y = 'math.sin(v.t) * v.r';
		const r = sharedRanges([x, y, '0'], 0);
		expect(r.map((s) => x.slice(s.from, s.to))).toEqual(['(v.t) * v.r']);
		expect(sharedRanges(['0', x, y], 0)).toEqual([]);
	});
});
