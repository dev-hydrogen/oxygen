import { describe, expect, it } from 'vitest';
import { changedPreferences, DEFAULT_PREFERENCES, readPreferences } from '../src/state/preferences';
import { getPref, isModified, searchSettings, SETTINGS, setPref } from '../src/lib/settings-schema';
import { parseMarkdown, releases } from '../src/lib/markdown';
import { readFileSync } from 'node:fs';

describe('preferences', () => {
	it('start at the defaults when nothing is stored', () => {
		expect(readPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
		expect(readPreferences('nonsense')).toEqual(DEFAULT_PREFERENCES);
	});

	it('keep good values, clamp numbers to the dialog’s range and drop the rest', () => {
		const p = readPreferences({ fov: 500, speed: 0.3, spawnMode: 'entity', renderMode: 'ultra', background: '#ABCDEF', zoom: Number.NaN, unknown: 1, codeSize: 0, keys: { 'file.save': ['ctrl+alt+s'] } });
		expect(p.fov).toBe(120);
		expect(p.speed).toBe(1);
		expect(p.spawnMode).toBe('entity');
		expect(p.renderMode).toBe('classic');
		expect(p.background).toBe('#abcdef');
		expect(p.zoom).toBe(1);
		expect(p.codeSize).toBe(0);
		expect(p.keys).toEqual({ 'file.save': ['Mod+Alt+S'] });
		expect('unknown' in p).toBe(false);
		expect(readPreferences({ codeSize: 3 }).codeSize).toBe(9);
	});

	it('take the viewport helpers from where they were kept before', () => {
		expect(readPreferences({}, { gizmos: { ground: false, block: 'yes' } }).gizmos).toEqual({ ...DEFAULT_PREFERENCES.gizmos, ground: false });
		expect(readPreferences({ gizmos: { entity: false } }, { gizmos: { ground: false } }).gizmos).toEqual({ ...DEFAULT_PREFERENCES.gizmos, entity: false });
	});

	it('export only what changed', () => {
		const p = readPreferences({ fov: 90, gizmos: { ground: false } });
		expect(changedPreferences(p)).toEqual({ fov: 90, gizmos: { ...DEFAULT_PREFERENCES.gizmos, ground: false } });
		expect(changedPreferences(DEFAULT_PREFERENCES)).toEqual({});
	});
});

describe('the settings dialog’s rows', () => {
	it('each set a preference that exists, with a control its default fits', () => {
		for (const r of SETTINGS) {
			const v = getPref(DEFAULT_PREFERENCES, r.key);
			expect(v, r.key).not.toBeUndefined();
			if (r.control.type === 'toggle') expect(typeof v, r.key).toBe('boolean');
			if (r.control.type === 'range') expect(v as number, r.key).toBeGreaterThanOrEqual(r.control.min);
			if (r.control.type === 'select') expect(r.control.options.map((o) => o.value), r.key).toContain(String(v));
		}
	});

	it('read and write nested preferences, and find rows by what they mention', () => {
		const p = structuredClone(DEFAULT_PREFERENCES);
		setPref(p, 'gizmos.ground', false);
		expect(getPref(p, 'gizmos.ground')).toBe(false);
		expect(isModified(p, 'gizmos.ground')).toBe(true);
		expect(isModified(p, 'fov')).toBe(false);
		expect(searchSettings(SETTINGS, 'kill').map((r) => r.key)).toEqual(['gizmos.killPlane']);
	});
});

describe('the changelog', () => {
	it('parses into releases, with wrapped list items joined and links kept', () => {
		const md = '# Changelog\n\n## 1.1\n\n### Added\n\n- A thing that\n  wraps, with `code` and a [link](docs/a.md).\n- **Bold** start\n\nA paragraph.\n\n## 1.0\n\n- First\n';
		const r = releases(md);
		expect(r.map((x) => x.title)).toEqual(['1.1', '1.0']);
		const list = r[0].blocks.find((b) => b.kind === 'list');
		expect(list).toEqual({
			kind: 'list',
			items: [
				[{ kind: 'text', text: 'A thing that wraps, with ' }, { kind: 'code', text: 'code' }, { kind: 'text', text: ' and a ' }, { kind: 'link', text: 'link', href: 'docs/a.md' }, { kind: 'text', text: '.' }],
				[{ kind: 'bold', text: 'Bold' }, { kind: 'text', text: ' start' }],
			],
		});
		expect(r[0].blocks.at(-1)).toEqual({ kind: 'paragraph', text: [{ kind: 'text', text: 'A paragraph.' }] });
	});

	it('reads Oxygen’s own, newest release first', () => {
		const r = releases(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8'));
		expect(r[0].title).toMatch(/^Oxygen \d+\.\d+\.\d+/);
		expect(r.length).toBeGreaterThan(1);
		expect(parseMarkdown('').length).toBe(0);
		// the pictures under items are for GitHub: the app's text has none of their HTML
		expect(JSON.stringify(r[0].blocks)).not.toContain('<img');
		expect(parseMarkdown('- An item\n  <br><img src="x.png" width="300">\n- Another')).toEqual([{ kind: 'list', items: [[{ kind: 'text', text: 'An item' }], [{ kind: 'text', text: 'Another' }]] }]);
	});
});
