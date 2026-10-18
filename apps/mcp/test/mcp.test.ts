import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newEffect } from '@oxygen/format';
import { applyEdits } from '../src/effects';
import { childEffects, packRoot } from '../src/pack';

const starter = `${JSON.stringify(newEffect('test:a'), null, '\t')}\n`;

describe('applyEdits', () => {
	it('applies all edits or none: a failing edit throws, naming it', () => {
		expect(() =>
			applyEdits(starter, [
				{ op: 'set', path: 'components/minecraft:emitter_rate_steady/spawn_rate', value: 5 },
				{ op: 'remove', path: 'components/minecraft:not_there' },
			]),
		).toThrow(/edit 2 \(remove particle_effect\/components\/minecraft:not_there\)/);
	});

	it('places a new component in canonical order through the components/ shorthand', () => {
		const { text } = applyEdits(starter, [
			{ op: 'remove', path: 'components/minecraft:emitter_shape_point' },
			{ op: 'set', path: 'components/minecraft:emitter_shape_sphere', value: { radius: 1 } },
		]);
		const keys = Object.keys(JSON.parse(text).particle_effect.components);
		expect(keys.indexOf('minecraft:emitter_shape_sphere')).toBe(keys.indexOf('minecraft:emitter_lifetime_looping') + 1);
	});

	it('leaves untouched text alone (comments, number spelling) and reports the change in game terms', () => {
		const src = '{\n  // keep me\n  "format_version": "1.10.0",\n  "particle_effect": {\n    "components": {\n      "minecraft:particle_initial_speed": 1.0,\n      "minecraft:emitter_rate_instant": { "num_particles": 3 }\n    }\n  }\n}\n';
		const { text, diff } = applyEdits(src, [{ op: 'molang', path: 'components/minecraft:emitter_rate_instant/num_particles', expression: '10' }]);
		expect(text).toBe(src.replace('"num_particles": 3', '"num_particles": 10'));
		expect(diff).toContain('was: 3');
	});

	it('refuses to edit a file that is not valid JSON', () => {
		expect(() => applyEdits('{ "particle_effect": {', [{ op: 'set', path: 'format_version', value: '1.10.0' }])).toThrow(/isn't valid JSON/);
	});
});

describe('pack lookup', () => {
	const spawner = (id: string, children: string[]) =>
		JSON.stringify({ particle_effect: { description: { identifier: id }, events: Object.fromEntries(children.map((c, i) => [`e${i}`, { particle_effect: { effect: c, type: 'emitter' } }])) } });

	it('collects every child an effect reaches, once, and names the missing ones', () => {
		const dir = mkdtempSync(join(tmpdir(), 'oxygen-mcp-'));
		const index = new Map<string, string>();
		for (const [id, children] of [
			['t:b', ['t:c', 't:a']],
			['t:c', ['t:b', 't:gone']],
		] as const) {
			const file = join(dir, `${id.slice(2)}.json`);
			writeFileSync(file, spawner(id, [...children]));
			index.set(id, file);
		}
		const { effects, missing } = childEffects(spawner('t:a', ['t:b']), index);
		expect(Object.keys(effects).sort()).toEqual(['t:b', 't:c']);
		expect(missing).toEqual(['t:gone']);
	});

	it('finds the pack root by manifest, else by the particles folder', () => {
		const dir = mkdtempSync(join(tmpdir(), 'oxygen-mcp-'));
		mkdirSync(join(dir, 'rp/particles/fx'), { recursive: true });
		expect(packRoot(join(dir, 'rp/particles/fx/a.json'))).toBe(join(dir, 'rp'));
		writeFileSync(join(dir, 'manifest.json'), '{}');
		expect(packRoot(join(dir, 'rp/particles/fx/a.json'))).toBe(dir);
	});
});
