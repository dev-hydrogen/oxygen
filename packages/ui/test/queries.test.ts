import { describe, expect, it } from 'vitest';
import { ParticleWorld } from 'wintersky';
import { PreviewQueries } from '../src/lib/queries';

const fx = {
	format_version: '1.10.0',
	particle_effect: {
		description: { identifier: 'test:cam', basic_render_parameters: { material: 'particles_alpha', texture: 't' } },
		components: {
			'minecraft:emitter_rate_instant': { num_particles: 1 },
			'minecraft:emitter_lifetime_once': { active_time: 1 },
			'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
			'minecraft:particle_appearance_billboard': { size: [0.1, 0.1], facing_camera_mode: 'lookat_xyz' },
		},
	},
};

describe('preview camera queries (measured in 1.26.52, t60-t64)', () => {
	const setup = (context: 'command' | 'entity') => {
		const world = new ParticleWorld();
		const q = new PreviewQueries({ override: () => undefined, timeOfDay: () => 0, lastDelta: () => 1 / 60, entity: () => null });
		world.queries = q;
		const e = world.spawn(world.loadEffect(fx), { position: [0, 0, 0], context });
		// camera 8 blocks west (-x), looking east
		world.camera = { ...world.camera, position: [-8, 0, 0], forward: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] };
		const ask = (name: string, ...args: number[]) => q.resolve(name, args, { world, emitter: e, particle: -1, spawnContext: context } as never);
		return ask;
	};

	it('/particle and script spawns: rotation queries are constants, distance follows the camera', () => {
		const ask = setup('command');
		expect(ask('query.camera_rotation', 0)).toBe(0);
		expect(ask('query.camera_rotation', 1)).toBe(0);
		expect(ask('query.rotation_to_camera', 0)).toBe(0);
		expect(ask('query.rotation_to_camera', 1)).toBe(-90);
		expect(ask('query.distance_from_camera')).toBeCloseTo(8);
		expect(ask('query.camera_distance_range_lerp', 0, 20)).toBeCloseTo(0.4);
	});

	it('entity-attached effects keep the live camera (not measured: documented behaviour)', () => {
		const ask = setup('entity');
		expect(ask('query.camera_rotation', 1)).toBeCloseTo(-90);
		expect(ask('query.rotation_to_camera', 1)).toBeCloseTo(90);
	});
});

describe('entity queries in the preview (measured, e07/e10/e11)', () => {
	const make = (creation: string) => ({
		...fx,
		particle_effect: { ...fx.particle_effect, components: { ...fx.particle_effect.components, 'minecraft:emitter_initialization': { creation_expression: creation, per_update_expression: 'v.u = q.variant;' } } },
	});
	it('read 0 in the creation expression, their value elsewhere; q.position is the entity', () => {
		const world = new ParticleWorld();
		const entity = { position: [5, 1, 2] as [number, number, number], velocity: [0, 0, 0] as [number, number, number], yaw: 0 };
		world.queries = new PreviewQueries({ override: (name) => (name === 'query.variant' ? 7 : undefined), timeOfDay: () => 0, lastDelta: () => 1 / 60, entity: () => entity });
		const e = world.spawn(world.loadEffect(make('v.c = q.variant; v.y = q.position(1);')), { position: [5, 2.5, 2], context: 'entity', preEffect: 'v.p = q.variant;' });
		world.step(1 / 60);
		const v = (n: string) => e.vars[world.symbols.variable(`variable.${n}`)];
		expect(v('c')).toBe(0);
		expect(v('p')).toBe(7);
		expect(v('u')).toBe(7);
		expect(v('y')).toBe(1);
	});
});
