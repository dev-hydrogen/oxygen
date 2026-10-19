import type { Scenario } from '@oxygen/format';
import { describe, expect, it } from 'vitest';
import { argText, callSignature, evalInput, evalKeys, scenarioQuery, scenarioVariables, type InputScene } from '../src/lib/inputs';
import { parseNumberText, showNumber } from '../src/lib/numbers';

const scene = (time = 0): InputScene => ({
	time,
	timeOfDay: 0.25,
	entity: { position: [1, 0, 2], velocity: [3, 0, 4], yaw: 90 },
	camera: { position: [0, 0, 10], forward: [0, 0, -1] },
	origin: [0, 0, 0],
});

describe('scenario inputs', () => {
	it('evaluates constants, Molang, keyframes and scene bindings', () => {
		expect(evalInput(2, scene())).toBe(2);
		expect(evalInput('red', scene())).toBe('red');
		expect(evalInput({ molang: 'q.anim_time * 2 + q.time_of_day' }, scene(1.5))).toBe(3.25);
		expect(evalInput({ scene: 'entity.speed' }, scene())).toBe(5);
		expect(evalInput({ scene: 'camera.distance' }, scene())).toBe(10);
		expect(evalInput({ scene: 'time' }, scene(4))).toBe(4);
	});

	it('interpolates keyframes, holds the ends, loops and steps', () => {
		const keys: [number, number][] = [
			[1, 0],
			[0, 10],
			[2, 20],
		];
		expect(evalKeys(keys, -1)).toBe(10);
		expect(evalKeys(keys, 0.5)).toBe(5);
		expect(evalKeys(keys, 1.5)).toBe(10);
		expect(evalKeys(keys, 9)).toBe(20);
		expect(evalKeys(keys, 2.5, true)).toBe(5);
		expect(evalKeys(keys, 0.5, false, true)).toBe(10);
	});

	it('looks queries up by exact call, then by name with a per-argument table', () => {
		const sc: Scenario = {
			name: 's',
			queries: {
				'query.armor_texture_slot(0)': 7,
				'query.armor_texture_slot': { table: { '1': 3, '2': 4 }, fallback: -1 },
				"query.property('ns:mode')": 'angry',
				'query.is_moving': 1,
			},
		};
		expect(scenarioQuery(sc, 'query.armor_texture_slot', [0], scene())).toBe(7);
		expect(scenarioQuery(sc, 'query.armor_texture_slot', [2], scene())).toBe(4);
		expect(scenarioQuery(sc, 'query.armor_texture_slot', [3], scene())).toBe(-1);
		expect(scenarioQuery(sc, 'query.property', ['ns:mode'], scene())).toBe('angry');
		expect(scenarioQuery(sc, 'query.is_moving', [], scene())).toBe(1);
		expect(scenarioQuery(sc, 'query.position', [1], scene())).toBeUndefined();
		expect(scenarioQuery(null, 'query.is_moving', [], scene())).toBeUndefined();
	});

	it('matches arguments that went through float32 emulation', () => {
		expect(argText(Math.fround(0.1))).toBe('0.1');
		expect(callSignature('query.x', [Math.fround(0.1), 'a'])).toBe("query.x(0.1, 'a')");
	});

	it('reads variable drivers once for the spawn', () => {
		const sc: Scenario = { name: 's', variables: { 'v.a': 1, 'v.b': { keys: [[0, 0], [2, 10]] }, 'v.c': 'blue' } };
		expect(scenarioVariables(sc, scene(1))).toEqual({ 'v.a': 1, 'v.b': 5, 'v.c': 'blue' });
	});
});

describe('number fields', () => {
	it('take numbers and arithmetic, and reject anything else', () => {
		expect(parseNumberText(' 2.5 ')).toBe(2.5);
		expect(parseNumberText('1/4')).toBe(0.25);
		expect(parseNumberText('math.pi / 2')).toBeCloseTo(Math.PI / 2);
		expect(parseNumberText('')).toBeNull();
		expect(parseNumberText('abc +')).toBeUndefined();
		expect(parseNumberText('2*(3')).toBeUndefined();
		expect(parseNumberText('v.x')).toBeUndefined();
	});

	it('display without float noise', () => {
		expect(showNumber(0.1 + 0.2)).toBe('0.3');
		expect(showNumber(-0.0000001)).toBe('0');
		expect(showNumber(1.23456, 2)).toBe('1.23');
	});
});

describe('scenario temps', () => {
	const fx = {
		format_version: '1.10.0',
		particle_effect: {
			description: { identifier: 'test:temps', basic_render_parameters: { material: 'particles_alpha', texture: 't' } },
			components: {
				'minecraft:emitter_initialization': { creation_expression: 'v.got = t.size;' },
				'minecraft:emitter_rate_instant': { num_particles: 1 },
				'minecraft:emitter_lifetime_once': { active_time: 1 },
				'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
			},
		},
	};
	const sc: Scenario = { name: 'S', variables: { 't.size': 3, 'v.keep': 1 }, pinned: ['t.size'] };

	it('go into the temp store before the spawn, not into the emitter', async () => {
		const { ParticleWorld } = await import('wintersky');
		const { writeScenarioGlobals, applyPinned } = await import('../src/lib/inputs');
		expect(scenarioVariables(sc, scene())).toEqual({ 'v.keep': 1 });
		const world = new ParticleWorld();
		writeScenarioGlobals(world, sc, scene());
		const e = world.spawn(world.loadEffect(fx), { position: [0, 0, 0], variables: scenarioVariables(sc, scene()) });
		expect(e.vars[world.symbols.variable('variable.got')]).toBe(3);
		// pinned temps are written again before every update
		world.temps.set(world.symbols.temp('temp.size'), 9);
		applyPinned(world, sc, scene());
		expect(world.temps.get(world.symbols.temp('temp.size'))).toBe(3);
	});

	it('context values (c.x) go to the world, for every expression, and only the scenario’s', async () => {
		const { ParticleWorld } = await import('wintersky');
		const { writeScenarioGlobals, applyPinned } = await import('../src/lib/inputs');
		const withContext: Scenario = { name: 'C', variables: { 'c.size': 2, 'context.Speed': 5 }, pinned: ['c.size'] };
		expect(scenarioVariables(withContext, scene())).toEqual({});
		const world = new ParticleWorld();
		world.contexts[world.symbols.context('context.stale')] = 1;
		writeScenarioGlobals(world, withContext, scene());
		const json = structuredClone(fx);
		json.particle_effect.components['minecraft:emitter_initialization'] = { creation_expression: 'v.got = c.size + c.speed;' };
		const e = world.spawn(world.loadEffect(json), { position: [0, 0, 0] });
		expect(e.vars[world.symbols.variable('variable.got')]).toBe(7);
		expect(world.contexts[world.symbols.context('context.stale')]).toBeUndefined();
		world.contexts[world.symbols.context('context.size')] = 9;
		applyPinned(world, withContext, scene());
		expect(world.contexts[world.symbols.context('context.size')]).toBe(2);
	});
});
