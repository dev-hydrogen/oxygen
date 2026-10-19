import { describe, expect, it } from 'vitest';
import { ParticleWorld } from 'wintersky';
import { BlockWorld, collisionBoxes, DEFAULT_ENTITY, EntityDummy, locatorsFromGeometry, readEntity, readMcstructure, writeNbt, type EntitySettings, type Locator, type NbtTag } from '../src/index';

describe('collision shapes', () => {
	it('matches the in-game results of t17', () => {
		expect(collisionBoxes('minecraft:stone')).toEqual([[0, 0, 0, 1, 1, 1]]);
		expect(collisionBoxes('minecraft:water')).toEqual([]);
		expect(collisionBoxes('minecraft:short_grass')).toEqual([]);
		expect(collisionBoxes('minecraft:stone_slab')).toEqual([[0, 0, 0, 1, 0.5, 1]]);
		expect(collisionBoxes('minecraft:stone_slab', { 'minecraft:vertical_half': 'top' })).toEqual([[0, 0.5, 0, 1, 1, 1]]);
		expect(collisionBoxes('minecraft:oak_fence')[0][4]).toBe(1.5);
	});

	it('particles rest on a fence top in the preview world', () => {
		const blocks = new BlockWorld();
		blocks.set(0, 0, 0, 'oak_fence');
		const world = new ParticleWorld({ seed: 1 });
		world.blocks = blocks;
		const def = world.loadEffect({
			format_version: '1.10.0',
			particle_effect: {
				description: { identifier: 't:fall', basic_render_parameters: { material: 'particles_alpha', texture: 't' } },
				components: {
					'minecraft:emitter_rate_instant': { num_particles: 1 },
					'minecraft:emitter_lifetime_once': { active_time: 1 },
					'minecraft:particle_lifetime_expression': { max_lifetime: 10 },
					'minecraft:particle_motion_dynamic': { linear_acceleration: [0, -10, 0] },
					'minecraft:particle_motion_collision': { collision_radius: 0.05 },
					'minecraft:particle_appearance_billboard': { size: [0.1, 0.1], facing_camera_mode: 'lookat_xyz' },
				},
			},
		});
		const e = world.spawn(def, { position: [0.5, 3, 0.5] });
		for (let i = 0; i < 240; i++) world.step(1 / 60);
		expect(e.pool.pos[1]).toBeCloseTo(1.55, 2);
	});
});

describe('.mcstructure', () => {
	it('reads blocks, palette states and the waterlog layer', () => {
		const int = (v: number): NbtTag => ({ type: 'int', value: v });
		const list = (els: NbtTag[], type: NbtTag['type']): NbtTag => ({ type: 'list', elementType: type, value: els });
		const compound = (v: Record<string, NbtTag>): NbtTag => ({ type: 'compound', value: v });
		const str = (v: string): NbtTag => ({ type: 'string', value: v });
		// 2 × 1 × 1: a top slab, then air with water in the second layer
		const bytes = writeNbt({
			name: '',
			tag: compound({
				format_version: int(1),
				size: list([int(2), int(1), int(1)], 'int'),
				structure: compound({
					block_indices: list([list([int(0), int(1)], 'int'), list([int(-1), int(2)], 'int')], 'list'),
					palette: compound({
						default: compound({
							block_palette: list(
								[
									compound({ name: str('minecraft:stone_slab'), states: compound({ 'minecraft:vertical_half': str('top') }) }),
									compound({ name: str('minecraft:air'), states: compound({}) }),
									compound({ name: str('minecraft:water'), states: compound({}) }),
								],
								'compound',
							),
						}),
					}),
				}),
			}),
		});
		const { world, info } = readMcstructure(bytes);
		expect(info.size).toEqual([2, 1, 1]);
		expect(world.getBlock(0, 0, 0)).toBe('minecraft:stone_slab');
		expect(world.getCollisionBoxes('minecraft:stone_slab', 0, 0, 0)).toEqual([[0, 0.5, 0, 1, 1, 1]]);
		expect(world.getBlock(1, 0, 0)).toBe('minecraft:water');
		expect(BlockWorld.fromJSON(world.toJSON()).getBlock(0, 0, 0)).toBe('minecraft:stone_slab');
	});
});

describe('entity stand-in', () => {
	it('moves along a circle facing its direction of travel, with locators following', () => {
		const e = new EntityDummy({ motion: { kind: 'circle', radius: 2, speed: 2 }, locator: 'chest', locators: [{ name: 'chest', offset: [0, 24, 0] }] });
		e.update(0.25);
		const v = e.velocity;
		const speed = Math.hypot(v[0], v[2]);
		expect(speed).toBeCloseTo(2, 1);
		expect(e.locatorPosition('chest')[1]).toBeCloseTo(1.5, 5);
		const t = e.attachment().getTransform();
		expect(t.position[1]).toBeCloseTo(1.5, 5);
		// the entity's velocity isn't handed to its emitters (e06, e11)
		expect(t.velocity).toEqual([0, 0, 0]);
		// Minecraft yaw: forward is (-sin, cos)
		const yaw = (e.yaw * Math.PI) / 180;
		const fwd = [-Math.sin(yaw), Math.cos(yaw)];
		expect(fwd[0] * v[0] + fwd[1] * v[2]).toBeGreaterThan(0.9 * speed);
	});

	it('walks a waypoint path at a steady speed, looping back to the start or reversing at the end', () => {
		const points: [number, number, number][] = [
			[0, 0, 0],
			[4, 0, 0],
			[4, 0, 4],
		];
		const loop = new EntityDummy({ motion: { kind: 'path', points, speed: 2, ends: 'loop' }, locator: '' });
		loop.update(1);
		expect(loop.position[0]).toBeCloseTo(2, 5);
		expect(loop.yaw).toBeCloseTo(270, 5); // heading +X (east)
		loop.update(2.5); // 7 blocks in: on the second stretch, heading +Z
		expect(loop.position).toEqual([4, 0, 3]);
		expect(loop.yaw).toBeCloseTo(0, 5);
		loop.update(0.05);
		expect(Math.hypot(...loop.velocity)).toBeCloseTo(2, 5);
		// the loop closes along the diagonal back to the first point (8 + 5.66 blocks around)
		loop.update((8 + Math.hypot(4, 4)) / 2 - 3.55);
		expect(loop.position[0]).toBeCloseTo(0, 5);
		expect(loop.position[2]).toBeCloseTo(0, 5);
		const back = new EntityDummy({ motion: { kind: 'path', points, speed: 2, ends: 'reverse' }, locator: '' });
		back.update(5); // 10 blocks: to the end (8) and 2 back
		expect(back.position).toEqual([4, 0, 2]);
		expect(back.yaw).toBeCloseTo(180, 5); // heading −Z
	});

	it('reads older scenes: made-up attachment points become model-space locators', () => {
		const e = readEntity({ motion: { kind: 'still' }, locator: 'head', locatorFlipY: true } as never);
		expect(e.locator).toBe('head');
		expect(e.locators).toEqual([{ name: 'head', offset: [0, 25.92, -0] }]);
		expect(readEntity({ motion: { kind: 'still' }, locator: 'root' }).locator).toBe('');
		expect(readEntity({ v: 2, motion: { kind: 'still' }, locator: 'x', locators: [{ name: 'x', offset: [1, 2, 3] }] }).locators).toEqual([{ name: 'x', offset: [1, 2, 3] }]);
	});
});

/** Axes measured in-game (X, Y, Z of the emitter in world coordinates), test pack e01–e05, entity at yaw 0 */
describe('locator frames measured in-game', () => {
	const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 2));
	const on = (loc: Locator, settings: Partial<EntitySettings> = {}) => new EntityDummy({ ...DEFAULT_ENTITY, ...settings, locators: [loc], locator: loc.name }).frame();
	const L = (name: string, offset: [number, number, number], rotation?: [number, number, number]): Locator => ({ name, offset, ...(rotation ? { rotation } : {}) });

	it('without a locator: the entity frame, X west, Y up, Z north (e01 p1)', () => {
		const f = new EntityDummy({ ...DEFAULT_ENTITY }).frame();
		close(f.axes[0], [-1, 0, 0]);
		close(f.axes[1], [0, 1, 0]);
		close(f.axes[2], [0, 0, -1]);
		expect(f.position).toEqual([0, 0, 0]);
	});

	it('a locator flips Y: X east, Y down, Z north; +X model units go east, +Z north (e01 p2–p4)', () => {
		const f = on(L('up', [0, 24, 0]));
		close(f.position, [0, 1.5, 0]);
		close(f.axes[0], [1, 0, 0]);
		close(f.axes[1], [0, -1, 0]);
		close(f.axes[2], [0, 0, -1]);
		close(on(L('off_x', [8, 24, 0])).position, [0.5, 1.5, 0]);
		close(on(L('off_z', [0, 24, 8])).position, [0, 1.5, -0.5]);
	});

	it('locator rotations, alone and together (e01 p5–p8, e05 p1–p4)', () => {
		const axes = (r: [number, number, number]) => on(L('r', [0, 24, 0], r)).axes;
		close(axes([90, 0, 0]).flat(), [1, 0, 0, 0, 0, -1, 0, 1, 0]);
		close(axes([0, 90, 0]).flat(), [0, 0, 1, 0, -1, 0, 1, 0, 0]);
		close(axes([0, 0, 90]).flat(), [0, -1, 0, -1, 0, 0, 0, 0, -1]);
		close(axes([0, 30, 0])[0], [0.87, 0, 0.5]);
		close(axes([90, 90, 0]).flat(), [0, 0, 1, 1, 0, 0, 0, 1, 0]);
		close(axes([90, 0, 90]).flat(), [0, -1, 0, 0, 0, -1, 1, 0, 0]);
		close(axes([0, 90, 90]).flat(), [0, 0, 1, -1, 0, 0, 0, -1, 0]);
		close(axes([30, 45, 60]).flat(), [0.35, -0.61, 0.71, -0.57, -0.74, -0.35, 0.74, -0.28, -0.61]);
	});

	it('the entity’s facing turns it all (e03: yaw 90 faces west)', () => {
		const f = on(L('up', [0, 24, 0]), { yaw: 90 });
		close(f.axes[0], [0, 0, 1]);
		close(f.axes[2], [1, 0, 0]);
		const plain = new EntityDummy({ ...DEFAULT_ENTITY, yaw: 90 }).frame();
		close(plain.axes[0], [0, 0, -1]);
		close(plain.axes[2], [1, 0, 0]);
	});

	it('locators on bones, through a geometry file (e02)', () => {
		const geo = {
			format_version: '1.16.0',
			'minecraft:geometry': [
				{
					description: { identifier: 'geometry.rig' },
					bones: [
						{ name: 'root', pivot: [0, 0, 0] },
						{ name: 'brx', parent: 'root', pivot: [0, 24, 0], rotation: [90, 0, 0], locators: { brx: [0, 24, 0], brx_off: [0, 24, 8] } },
						{ name: 'bry', parent: 'root', pivot: [0, 24, 0], rotation: [0, 90, 0], locators: { bry_off: [8, 24, 0] } },
						{ name: 'chain', parent: 'bry', pivot: [8, 24, 0], rotation: [90, 0, 0], locators: { chain: [8, 24, 0] } },
						{ name: 'asc', parent: 'root', pivot: [0, 24, 0], locators: { asc_ign: { offset: [8, 32, 0], rotation: [0, 0, 0], ignore_inherited_scale: true } } },
					],
				},
			],
		};
		const [model] = locatorsFromGeometry(geo);
		expect(model.model).toBe('geometry.rig');
		const find = (n: string) => model.locators.find((l) => l.name === n)!;
		close(on(find('brx')).axes.flat(), [1, 0, 0, 0, 0, -1, 0, 1, 0]); // like the [90,0,0] locator
		close(on(find('brx_off')).position, [0, 2, 0]); // 8 units +Z turned up
		close(on(find('bry_off')).position, [0, 1.5, 0.5]);
		close(on(find('chain')).position, [0, 1.5, 0.5]);
		close(on(find('chain')).axes.flat(), [0, 0, 1, 1, 0, 0, 0, 1, 0]);
		expect(find('asc_ign').ignoreScale).toBe(true);
	});

	it('scale: the entity scales locator offsets and frames, not its own frame (e05 p6/p8, e10 p7)', () => {
		const f = on(L('up', [0, 24, 0]), { scale: 2 });
		close(f.position, [0, 3, 0]);
		expect(f.scale).toBe(2);
		expect(on({ name: 'i', offset: [8, 32, 0], ignoreScale: true }, { scale: 2 }).scale).toBe(1);
		expect(new EntityDummy({ ...DEFAULT_ENTITY, scale: 2 }).frame().scale).toBe(1);
	});

	it('entity_aabb is the entity’s box in the emitter’s frame, not moved back around the entity (e09)', () => {
		const e = new EntityDummy({ ...DEFAULT_ENTITY, locators: [L('up', [0, 24, 0])], locator: 'up' });
		expect(e.aabb()).toEqual({ min: [-0.3, 0, -0.3], max: [0.3, 1.8, 0.3] });
		const big = new EntityDummy({ ...DEFAULT_ENTITY, scale: 2 });
		expect(big.aabb()).toEqual({ min: [-0.6, 0, -0.6], max: [0.6, 3.6, 0.6] });
	});

	it('unbound effects start at the entity, or at the world origin with a locator (e10, e12)', () => {
		const e = new EntityDummy({ ...DEFAULT_ENTITY, motion: { kind: 'line', length: 4, speed: 2 }, locators: [L('up', [0, 24, 0])] });
		e.update(0.5);
		expect(e.unboundStart('').position).toEqual(e.position);
		expect(e.unboundStart('up').position).toEqual([0, 0, 0]);
	});
});

describe('vibrant visuals model', () => {
	it('reads pack lighting with vanilla defaults and samples keyframes from noon', async () => {
		const { parseLighting, sample, lightAt, DEFAULT_LIGHTING, parseTextureSet, writeTextureSet, generateMers } = await import('../src/vv');
		const m = parseLighting({ format_version: '1.21.40', 'minecraft:lighting_settings': { directional_lights: { orbital: { sun: { illuminance: 50000 } } } } });
		expect(m.sunIlluminance).toBe(50000);
		expect(m.moonIlluminance).toBe(DEFAULT_LIGHTING.moonIlluminance);
		expect(sample(DEFAULT_LIGHTING.sunIlluminance, 0)).toBeCloseTo(100);
		expect(sample(DEFAULT_LIGHTING.sunIlluminance, 0.5)).toBeCloseTo(0);
		const noon = lightAt(DEFAULT_LIGHTING, 0.5);
		const midnight = lightAt(DEFAULT_LIGHTING, 0);
		expect(noon.direction[1]).toBeGreaterThan(0.9);
		expect(midnight.exposure).toBeGreaterThan(noon.exposure * 100);
		const set = parseTextureSet({ format_version: '1.21.30', 'minecraft:texture_set': { color: 'spark', metalness_emissive_roughness_subsurface: 'spark_mers' } });
		expect(set?.mers).toBe('spark_mers');
		expect(writeTextureSet(set!)).toEqual({ format_version: '1.21.30', 'minecraft:texture_set': { color: 'spark', metalness_emissive_roughness_subsurface: 'spark_mers' } });
		const mers = generateMers(new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 128]), { threshold: 0.5, strength: 1, roughness: 0.5 });
		expect(Array.from(mers)).toEqual([0, 255, 128, 255, 0, 0, 128, 128]);
	});
});

describe('measured Vibrant Visuals particle light (t65)', () => {
	it('returns the measured keyframes and interpolates between them, wrapping past midnight', async () => {
		const { MEASURED_PARTICLE_LIGHT, measuredParticleLight } = await import('../src/vv');
		expect(measuredParticleLight(0.5)).toEqual(MEASURED_PARTICLE_LIGHT['0.5']);
		const between = measuredParticleLight(0.375);
		for (let i = 0; i < 3; i++) expect(between.light[i]).toBeCloseTo((MEASURED_PARTICLE_LIGHT['0.25'].light[i] + MEASURED_PARTICLE_LIGHT['0.5'].light[i]) / 2, 6);
		const late = measuredParticleLight(0.875);
		expect(late.emissive).toBeCloseTo((MEASURED_PARTICLE_LIGHT['0.75'].emissive + MEASURED_PARTICLE_LIGHT['0'].emissive) / 2, 6);
		// noon is blue: the sky lights particles that face the camera
		expect(MEASURED_PARTICLE_LIGHT['0.5'].light[2]).toBeGreaterThan(MEASURED_PARTICLE_LIGHT['0.5'].light[0] * 2);
	});

	it("scales by a pack's own lighting relative to the default", async () => {
		const { DEFAULT_LIGHTING, measuredParticleLight, particleLight } = await import('../src/vv');
		expect(particleLight(DEFAULT_LIGHTING, 0.5, true)).toEqual(measuredParticleLight(0.5));
		const warm = { ...DEFAULT_LIGHTING, ambientColor: [1, 0.5, 0.25] as [number, number, number], sunColor: [1, 0.5, 0.25] as [number, number, number] };
		const p = particleLight(warm, 0.5, true);
		const m = measuredParticleLight(0.5);
		expect(p.light[0] / m.light[0]).toBeGreaterThan(p.light[2] / m.light[2]);
		expect(particleLight(warm, 0.5, false)).toEqual(m);
	});
});

describe('Vibrant Visuals tone curve and auto exposure (measured in-game)', () => {
	it('the generic curve maps mid grey to 0.267 and reaches white at hdrMax', async () => {
		const { genericTone, GENERIC_TONE } = await import('../src/vv');
		expect(genericTone(GENERIC_TONE.midIn)).toBeCloseTo(GENERIC_TONE.midOut, 6);
		expect(genericTone(GENERIC_TONE.hdrMax)).toBeCloseTo(1, 6);
		expect(genericTone(0)).toBe(0);
		let last = 0;
		for (const x of [0.001, 0.01, 0.1, 1, 4, 16, 63]) {
			expect(genericTone(x)).toBeGreaterThan(last);
			last = genericTone(x);
		}
	});

	it('meters bright pixels with a soft knee', async () => {
		const { meterWeight, AUTO_EXPOSURE } = await import('../src/vv');
		expect(meterWeight(1)).toBeCloseTo(1, 2);
		expect(meterWeight(AUTO_EXPOSURE.knee)).toBeCloseTo(AUTO_EXPOSURE.knee / 2, 6);
		expect(meterWeight(1e9)).toBeLessThan(AUTO_EXPOSURE.knee);
	});

	it('darkens fast, recovers slowly and never goes below the floor', async () => {
		const { AutoExposure, AUTO_EXPOSURE, exposureFor } = await import('../src/vv');
		const eye = new AutoExposure();
		expect(eye.exposure).toBe(1);
		// an emissive wall covering 8 % of the screen at night (the in-game measurement): the floor within a second
		const wall = 1 + 0.08 * 690;
		for (let t = 0; t < 1; t += 1 / 60) eye.step(wall, 1 / 60);
		expect(eye.exposure).toBeCloseTo(AUTO_EXPOSURE.floor, 6);
		// gone: still dark a second later (the meter's average has to fall back first), back within 8 s
		for (let t = 0; t < 1; t += 1 / 60) eye.step(1, 1 / 60);
		expect(eye.exposure).toBeLessThan(0.35);
		for (let t = 0; t < 7; t += 1 / 60) eye.step(1, 1 / 60);
		expect(eye.exposure).toBeGreaterThan(0.95);
		// settling jumps straight to what a frame meters
		expect(eye.settle(wall)).toBe(exposureFor(wall));
		eye.reset();
		expect(eye.exposure).toBe(1);
	});

	it('defaults to the generic tone curve', async () => {
		const { DEFAULT_GRADING, parseGrading } = await import('../src/vv');
		expect(DEFAULT_GRADING.toneMapper).toBe('generic');
		expect(parseGrading({}).toneMapper).toBe('generic');
		expect(parseGrading({ 'minecraft:color_grading_settings': { tone_mapping: { operator: 'aces' } } }).toneMapper).toBe('aces');
	});
});

describe('Vibrant Visuals display transform (vanilla color grading)', () => {
	it('reads a pack grade and keeps hues of bright colours with the generic tone mapper', async () => {
		const { DEFAULT_GRADING, displayTransform, parseGrading } = await import('../src/vv');
		const g = parseGrading({ 'minecraft:color_grading_settings': { color_grading: { midtones: { contrast: [1.3, 1.3, 1.3], saturation: 1.2 } }, tone_mapping: { operator: 'reinhard_luminance' } } });
		expect(g.contrast).toEqual([1.3, 1.3, 1.3]);
		expect(g.saturation).toEqual([1.2, 1.2, 1.2]);
		expect(g.gamma).toBe(2.2);
		// a bright pink stays pink (the in-game glow keeps its tint), black stays black
		const pink = displayTransform([20, 20 * 0.268, 20 * 0.7], DEFAULT_GRADING);
		expect(pink[0]).toBeGreaterThan(0.95);
		expect(pink[1]).toBeLessThan(0.85);
		expect(displayTransform([0, 0, 0], DEFAULT_GRADING)).toEqual([0, 0, 0]);
	});
});
