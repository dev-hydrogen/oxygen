import { describe, expect, it } from 'vitest';
import { baseMaterial, materialParents } from '../src/lib/materials';
import { representatives, type Series } from '../src/lib/sampler';

describe('the Graph panel’s lines', () => {
	// 60 particles on the same sine, each with a phase of its own (v.particle_random_3 * 360)
	const wave = (id: number, phase: number): Series => ({ id, points: Array.from({ length: 40 }, (_, k) => [k / 30, Math.sin((k / 40) * Math.PI * 2 + phase)] as [number, number]) });
	const all = Array.from({ length: 60 }, (_, i) => wave(i, (i / 60) * Math.PI * 2));

	it('picks curves spread over what the particles do, not the first few to spawn', () => {
		const picked = representatives(all, 6);
		expect(picked).toHaveLength(6);
		expect(new Set(picked.map((s) => s.id)).size).toBe(6);
		// the first few to spawn sit within a tenth of a turn of each other; the picks reach round the whole turn
		const phases = picked.map((s) => (s.id / 60) * 360).sort((a, b) => a - b);
		const gaps = phases.map((p, i) => (i ? p - phases[i - 1] : p + 360 - phases[phases.length - 1]));
		expect(Math.max(...gaps)).toBeLessThan(150);
		expect(Math.min(...gaps)).toBeGreaterThan(15);
	});

	it('gives every curve back when there are no more than asked for', () => {
		expect(representatives(all.slice(0, 4), 6)).toHaveLength(4);
	});
});

describe('materials beyond the game’s four', () => {
	it('draws a pack’s material as the one it inherits from', () => {
		const parents = materialParents('{ "materials": { "version": "1.0.0", "glow_soft:particles_add": { "+defines": [] }, "glow_softer:glow_soft": {}, /* own */ "plain": {} } }');
		expect(parents).toEqual({ glow_soft: 'particles_add', glow_softer: 'glow_soft', plain: '' });
		expect(baseMaterial('glow_softer', parents)).toBe('particles_add');
		expect(baseMaterial('particles_blend', parents)).toBe('particles_blend');
	});

	it('goes by the name without a pack, and falls back to cutout', () => {
		expect(baseMaterial('my_particles_blend')).toBe('particles_blend');
		expect(baseMaterial('entity_emissive_additive')).toBe('particles_add');
		expect(baseMaterial('something_else')).toBe('particles_alpha');
		expect(materialParents('not json at all')).toEqual({});
	});
});
