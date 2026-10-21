import { describe, expect, it } from 'vitest';
import { ParticleWorld } from 'wintersky';
import { analyzeEffect } from '../src/index';

function load(components: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	const world = new ParticleWorld();
	return world.loadEffect({
		format_version: '1.10.0',
		particle_effect: {
			description: { identifier: 'test:fx', basic_render_parameters: { material: 'particles_blend', texture: 't' } },
			components: {
				'minecraft:emitter_rate_instant': { num_particles: 5 },
				'minecraft:emitter_lifetime_once': { active_time: 1 },
				'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
				'minecraft:particle_appearance_billboard': { size: [0.1, 0.1], facing_camera_mode: 'lookat_xyz' },
				...components,
			},
			...extra,
		},
	});
}

describe('analyzeEffect', () => {
	it('orders fields like the game evaluates them', () => {
		const a = analyzeEffect(
			load({
				'minecraft:emitter_initialization': { creation_expression: 'v.a = 1;', per_update_expression: 'v.b = 2;' },
				'minecraft:particle_initialization': { per_update_expression: 'v.c = 1;', per_render_expression: 'v.d = 1;' },
			}),
		);
		const order = a.fields.map((f) => f.label);
		const idx = (s: string) => order.findIndex((l) => l.includes(s));
		expect(idx('Play once › Active time')).toBeLessThan(idx('Emitter expressions › On creation'));
		expect(idx('Emitter expressions › On creation')).toBeLessThan(idx('Emitter expressions › Every update'));
		expect(idx('Burst › Particles')).toBeLessThan(idx('Particle lifetime › Max lifetime'));
		expect(idx('Particle expressions › Every update')).toBeLessThan(idx('Particle expressions › Every render'));
		expect(idx('Particle expressions › Every render')).toBeLessThan(idx('Billboard › Size W'));
		expect(idx('Billboard › Size W')).toBeLessThan(idx('Billboard › Size H'));
	});

	it('counts a struct as set by its members, and a copy as filling the members (t67, t68)', () => {
		const a = analyzeEffect(load({ 'minecraft:emitter_initialization': { creation_expression: 'v.a.b = 1; v.c = v.a; v.d = v.c.b;' } }));
		expect(a.problems.filter((p) => p.code === 'never-set' || p.code === 'read-before-write')).toEqual([]);
		const unset = analyzeEffect(load({ 'minecraft:emitter_initialization': { creation_expression: 'v.d = v.q.b;' } }));
		expect(unset.problems.some((p) => p.code === 'never-set' && p.message.startsWith('Nothing sets v.q.b'))).toBe(true);
	});

	it('reports reads that nothing has set yet', () => {
		const a = analyzeEffect(
			load({
				'minecraft:emitter_lifetime_once': { active_time: 'v.duration' },
				'minecraft:emitter_initialization': { creation_expression: 'v.duration = 2;' },
				'minecraft:particle_appearance_billboard': { size: ['v.never', 'v.never ?? 0.1'], facing_camera_mode: 'lookat_xyz' },
			}),
		);
		const rbw = a.problems.find((p) => p.code === 'read-before-write');
		expect(rbw?.message).toContain('before creation_expression');
		const never = a.problems.filter((p) => p.code === 'never-set');
		expect(never.length).toBe(1); // the ?? read is safe
		expect(never[0].path).toContain('size/0');
	});

	it("turns a read only a parent's pre-effect sets into a note naming the parent", () => {
		const def = load({ 'minecraft:particle_appearance_tinting': { color: ['v.hue', 1, 1, 1] } });
		const alone = analyzeEffect(def).problems.filter((p) => p.path.includes('tinting'));
		expect(alone.map((p) => [p.severity, p.code])).toEqual([['error', 'never-set']]);
		const spawned = analyzeEffect(def, { parents: { 'variable.hue': 'test:rocket' } }).problems.filter((p) => p.path.includes('tinting'));
		expect(spawned.map((p) => [p.severity, p.code])).toEqual([['info', 'set-by-parent']]);
		expect(spawned[0].message).toMatch(/test:rocket/);
	});
	it('flags event parts the game ignores, creation-event spawns and zero weights', () => {
		const def = load(
			{ 'minecraft:particle_lifetime_events': { creation_event: 'born' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } },
			{
				events: {
					go: { sequence: [{ expression: 'v.a = 1;' }], expression: 'v.ignored = 1;', randomize: [{ weight: 0 }, { weight: 2 }] },
					born: { particle_effect: { effect: 'x:y' } },
					zero: { randomize: [{ weight: 0 }, { weight: 0 }] },
				},
			},
		);
		const a = analyzeEffect(def);
		const codes = a.problems.map((p) => `${p.code}@${p.path}`);
		expect(codes).toContain('event-ignored@particle_effect/events/go');
		expect(codes).toContain('zero-weight@particle_effect/events/go/randomize/0/weight');
		expect(codes).toContain('creation-spawn-origin@particle_effect/events/born/particle_effect');
		expect(codes).toContain('zero-weights@particle_effect/events/zero/randomize');
		// the ignored expression isn't counted as setting anything
		expect(a.variables.find((v) => v.name === 'variable.ignored')).toBeUndefined();
		expect(a.variables.find((v) => v.name === 'variable.a')?.writes).toHaveLength(1);
	});
	it('warns that camera rotation queries are constant in /particle and script spawns', () => {
		const def = load({ 'minecraft:particle_appearance_billboard': { size: ['q.camera_rotation(1) / 360', 'q.rotation_to_camera(0) + q.distance_from_camera'], facing_camera_mode: 'lookat_xyz' } });
		const codes = (o: Parameters<typeof analyzeEffect>[1]) => analyzeEffect(def, o).problems.filter((p) => p.code === 'camera-query-constant').length;
		expect(codes({ spawnContext: 'command' })).toBe(2);
		expect(codes({ spawnContext: 'entity' })).toBe(0);
	});
	it('lets a write earlier in the same expression satisfy a read', () => {
		const a = analyzeEffect(load({ 'minecraft:emitter_initialization': { creation_expression: 'v.a = 1; v.b = v.a + 1;' } }));
		expect(a.problems.filter((p) => p.code === 'never-set' || p.code === 'read-before-write')).toEqual([]);
	});

	it('warns about update → render carry on the shared variable map', () => {
		const a = analyzeEffect(
			load({
				'minecraft:particle_initialization': { per_update_expression: 'v.s = v.particle_age;' },
				'minecraft:particle_appearance_billboard': { size: ['v.s', 0.1], facing_camera_mode: 'lookat_xyz' },
			}),
		);
		expect(a.problems.some((p) => p.code === 'update-render-carry')).toBe(true);
	});

	it('does not flag curves read in render: they are evaluated again for each particle first', () => {
		const a = analyzeEffect(
			load(
				{ 'minecraft:particle_appearance_billboard': { size: ['0.1 * v.fade', 0.1], facing_camera_mode: 'lookat_xyz' } },
				{ curves: { 'variable.fade': { type: 'linear', input: 'v.particle_age', horizontal_range: 1, nodes: [1, 0] } } },
			),
		);
		expect(a.problems.filter((p) => p.code === 'update-render-carry')).toEqual([]);
	});

	it('does not flag render expressions that recompute their own variables (index counters)', () => {
		const a = analyzeEffect(
			load({
				'minecraft:emitter_initialization': { creation_expression: 'v.n = 0; v.k = 0;', per_update_expression: 'v.n = 0; v.k = 0;' },
				'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.n; v.n = v.n + 1;' },
				'minecraft:particle_appearance_billboard': { size: ['v.idx = v.k; v.k = v.k + 1; return 0.1 + v.idx * 0.01;', 0.1], facing_camera_mode: 'lookat_xyz' },
			}),
		);
		expect(a.problems.filter((p) => p.code === 'update-render-carry')).toEqual([]);
	});

	it('builds the variable index with writers, readers and temps', () => {
		const a = analyzeEffect(
			load({
				'minecraft:emitter_initialization': { creation_expression: 'v.speed = 3; t.k = 1;' },
				'minecraft:particle_initial_speed': 'v.speed',
			}),
		);
		const speed = a.variables.find((v) => v.name === 'variable.speed')!;
		expect(speed.writes[0].label).toBe('Emitter expressions › On creation');
		expect(speed.reads[0].label).toContain('Initial speed');
		expect(a.temps).toContain('temp.k');
	});

	it('explains broken fields with the value the game uses', () => {
		const a = analyzeEffect(load({ 'minecraft:particle_appearance_billboard': { size: ['1 +', 0.1], facing_camera_mode: 'lookat_xyz' } }));
		const p = a.problems.find((x) => x.severity === 'error' && x.path.endsWith('size/0'));
		expect(p?.message).toContain('uses 1');
	});

	it('flags structural problems', () => {
		const world = new ParticleWorld();
		const def = world.loadEffect({
			format_version: '1.10.0',
			particle_effect: {
				description: { identifier: 'a:b', basic_render_parameters: { material: 'particles_alpha', texture: 't' } },
				components: {
					'minecraft:emitter_rate_instant': { num_particles: 5000 },
					'minecraft:emitter_lifetime_looping': { active_time: 1 },
					'minecraft:particle_appearance_billboard': { size: [0, 0.1], facing_camera_mode: 'direction_z' },
				},
			},
		});
		const codes = analyzeEffect(def).problems.map((p) => p.code);
		expect(codes).toEqual(expect.arrayContaining(['no-lifetime', 'cap', 'no-loop', 'hidden-size', 'no-direction']));
	});
});

describe('renameVariable', () => {
	it('renames reads, writes and a curve, keeping representation and spelling', async () => {
		const { JsonDocument } = await import('@oxygen/format');
		const { renameVariable } = await import('../src/index');
		const json = {
			format_version: '1.10.0',
			particle_effect: {
				description: { identifier: 't:r', basic_render_parameters: { material: 'particles_alpha', texture: 't' } },
				curves: { 'variable.speed': { type: 'linear', input: 'v.particle_age', nodes: [0, 1] } },
				components: {
					'minecraft:emitter_initialization': { creation_expression: 'v.speed = 2; variable.Speed = v.speed * 2;' },
					'minecraft:emitter_rate_instant': { num_particles: 1 },
					'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
					'minecraft:particle_initial_speed': { expression: 'v.speed + 1', version: 12 },
					'minecraft:particle_appearance_billboard': { size: [0.1, 0.1], facing_camera_mode: 'lookat_xyz' },
				},
			},
		};
		const doc = new JsonDocument(JSON.stringify(json, null, '\t'));
		const world = new ParticleWorld();
		const a = analyzeEffect(world.loadEffect(doc.value));
		const r = renameVariable(doc, a, 'variable.speed', 'variable.velocity');
		expect(r.occurrences).toBe(4);
		const v = doc.value as typeof json;
		expect(v.particle_effect.components['minecraft:emitter_initialization'].creation_expression).toBe('v.velocity = 2; variable.velocity = v.velocity * 2;');
		expect(v.particle_effect.components['minecraft:particle_initial_speed']).toEqual({ expression: 'v.velocity + 1', version: 12 });
		expect(Object.keys(v.particle_effect.curves)).toEqual(['variable.velocity']);
		expect(doc.undo()).toBe(true);
		expect((doc.value as typeof json).particle_effect.curves['variable.speed']).toBeTruthy();
	});
});
