/**
 * In-game tests for effects attached to an entity. A test rig entity (oxygen:rig) carries real locators on plain,
 * rotated, animated and scaled bones; each probe is one rig, summoned with its own variant, whose animation fires
 * the probe's effects. Frame probes draw an axis triad (X red, Y green, Z blue, 1 block each) in the emitter's
 * frame, so a screenshot shows exactly where a locator puts an effect and which way its axes point.
 */
import { makeImage } from './png';
import type { Json } from './tests';

/** One particle_effects entry of an animation or controller (the game's own fields) */
export interface Fire {
	/** short name from RIG_EFFECTS */
	effect: string;
	locator?: string;
	/** default true: the emitter follows the entity */
	bind_to_actor?: boolean;
	pre_effect_script?: string;
}

export interface Move {
	/** teleported every tick round a circle (facing along it) or back and forth, pushed once, or driven along +X by physics velocity */
	kind: 'circle' | 'line' | 'push' | 'drive';
	radius?: number;
	/** blocks per second (circle, line), or the impulse (push) */
	speed?: number;
	/** start moving after this many seconds */
	after?: number;
	/** stop after this many seconds */
	seconds?: number;
}

export interface EntityProbe {
	id: string;
	reads: string;
	/** body yaw the rig is summoned with (0 faces south, +Z) */
	yaw?: number;
	/** effects its animation fires when it starts */
	fire?: Fire[];
	/** the animation loops this often (seconds), firing again each time */
	loop?: number;
	/** script-driven movement */
	move?: Move;
	/** commands run this many seconds after the rig is summoned ({rig} = a selector for this rig) */
	later?: { after: number; command: string }[];
	/** effects a controller state fires on entering it (the state is left when the rig's variant changes) */
	controller?: Fire[];
	/** extra components on this rig (behaviour) */
	components?: Json;
}

export interface EntityTest {
	id: string;
	title: string;
	question: string;
	assumption: string;
	probes: EntityProbe[];
	wait: number;
	spacing?: number;
	views?: ('front' | 'behind' | 'above' | 'frontleft' | 'frontright')[];
}

const COLOURS = [
	[1, 0.15, 0.15, 1],
	[0.2, 1, 0.2, 1],
	[0.3, 0.5, 1, 1],
];

function effect(components: Json, texture = 'textures/particle/oxygen_white'): Json {
	return {
		format_version: '1.10.0',
		particle_effect: {
			description: { identifier: '', basic_render_parameters: { material: 'particles_alpha', texture } },
			components,
		},
	};
}

type Space = 'local' | 'position' | 'world';

function space(s: Space): Json {
	if (s === 'local') return { 'minecraft:emitter_local_space': { position: true, rotation: true } };
	if (s === 'position') return { 'minecraft:emitter_local_space': { position: true, rotation: false } };
	return {};
}

/** A 1-block line along one emitter axis, drawn over the first second; the emitter lives forever */
function axisLine(axis: number, s: Space): Json {
	const offset = [0, 0, 0].map((_, i) => (i === axis ? 'math.min(v.emitter_age, 1)' : 0));
	return effect({
		...space(s),
		'minecraft:emitter_rate_steady': { spawn_rate: 40, max_particles: 40 },
		'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
		'minecraft:emitter_shape_point': { offset },
		'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
		// thin at the emitter, thick at the +1 end: which way an axis points reads from any view
		'minecraft:particle_appearance_billboard': { size: ['0.02 + 0.1 * math.clamp(v.emitter_age - v.particle_age, 0, 1)', '0.02 + 0.1 * math.clamp(v.emitter_age - v.particle_age, 0, 1)'], facing_camera_mode: 'lookat_xyz', uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } },
		'minecraft:particle_appearance_tinting': { color: COLOURS[axis] },
	});
}

/** A stream shot along one emitter axis (direction and speed), simulated in world space */
function axisStream(axis: number): Json {
	const direction = [0, 0, 0].map((_, i) => (i === axis ? 1 : 0));
	return effect({
		'minecraft:emitter_rate_steady': { spawn_rate: 20, max_particles: 100 },
		'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
		'minecraft:emitter_shape_point': { direction },
		'minecraft:particle_initial_speed': 2,
		'minecraft:particle_motion_dynamic': {},
		'minecraft:particle_lifetime_expression': { max_lifetime: 0.5 },
		'minecraft:particle_appearance_billboard': { size: [0.05, 0.05], facing_camera_mode: 'lookat_xyz', uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } },
		'minecraft:particle_appearance_tinting': { color: COLOURS[axis] },
	});
}

const BILLBOARD = (size: unknown) => ({ size: [size, size], facing_camera_mode: 'lookat_xyz', uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } });

/** A single white dot where the emitter is (marks a locator's position) */
function dot(size = 0.12, s: Space = 'local'): Json {
	return effect({
		...space(s),
		'minecraft:emitter_rate_instant': { num_particles: 1 },
		'minecraft:emitter_lifetime_once': { active_time: 1 },
		'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
		'minecraft:particle_appearance_billboard': BILLBOARD(size),
	}, 'textures/particle/oxygen_probe');
}

/** One big square, visible only when `size` (Molang) is non-zero; `extra` adds emitter components */
function flag(size: string, extra: Json = {}, colour = [1, 0.85, 0.2, 1]): Json {
	return effect({
		'minecraft:emitter_local_space': { position: true, rotation: true },
		'minecraft:emitter_rate_instant': { num_particles: 1 },
		'minecraft:emitter_lifetime_once': { active_time: 1 },
		'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
		'minecraft:particle_appearance_billboard': BILLBOARD(size),
		'minecraft:particle_appearance_tinting': { color: colour },
		...extra,
	}, 'textures/particle/oxygen_probe');
}

/** Dots that rise from the emitter at 0.5 blocks/s, `rate` a second, for as long as the emitter lives (world space) */
function riser(rate: number, lifetime: Json = { 'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 } }, colour = [1, 1, 1, 1]): Json {
	return effect({
		'minecraft:emitter_rate_steady': { spawn_rate: rate, max_particles: 200 },
		...lifetime,
		// rises by world-space acceleration against drag (0.5 blocks/s): parametric positions of world-space
		// emitters on an entity are taken from the world origin (e08)
		'minecraft:particle_motion_dynamic': { linear_acceleration: [0, 1, 0], linear_drag_coefficient: 2 },
		'minecraft:particle_lifetime_expression': { max_lifetime: 8 },
		'minecraft:particle_appearance_billboard': BILLBOARD(0.1),
		'minecraft:particle_appearance_tinting': { color: colour },
	}, 'textures/particle/oxygen_probe');
}

/** One instant puff of a rising dot per emitter (an emitter's birth leaves one dot) */
function puff(lifetime: Json, colour = [0.3, 0.9, 1, 1]): Json {
	return effect({
		'minecraft:emitter_rate_instant': { num_particles: 1 },
		...lifetime,
		'minecraft:particle_motion_dynamic': { linear_acceleration: [0, 1, 0], linear_drag_coefficient: 2 },
		'minecraft:particle_lifetime_expression': { max_lifetime: 8 },
		'minecraft:particle_appearance_billboard': BILLBOARD(0.12),
		'minecraft:particle_appearance_tinting': { color: colour },
	}, 'textures/particle/oxygen_probe');
}

/** A trail: dots left in world space where the emitter was, 10 a second */
function trail(extra: Json = {}, colour = [1, 0.4, 0.8, 1]): Json {
	return effect({
		'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 200 },
		'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
		'minecraft:particle_lifetime_expression': { max_lifetime: 20 },
		'minecraft:particle_appearance_billboard': BILLBOARD(0.08),
		'minecraft:particle_appearance_tinting': { color: colour },
		...extra,
	}, 'textures/particle/oxygen_probe');
}

/** Effects the rig can fire, by short name (identifier oxygen:rig_<name>) */
export const RIG_EFFECTS: Record<string, Json> = {
	ax: axisLine(0, 'local'),
	ay: axisLine(1, 'local'),
	az: axisLine(2, 'local'),
	px: axisLine(0, 'position'),
	py: axisLine(1, 'position'),
	pz: axisLine(2, 'position'),
	wx: axisLine(0, 'world'),
	wy: axisLine(1, 'world'),
	wz: axisLine(2, 'world'),
	sx: axisStream(0),
	sy: axisStream(1),
	sz: axisStream(2),
	dot: dot(),
	wdot: dot(0.12, 'world'),
	// entity Molang: visible when the particle reads the entity's value
	qvariant: flag('q.variant > 0 ? 0.3 : 0'),
	entvar: flag('v.ent == 5 ? 0.3 : 0'),
	pre_query: flag('v.k > 0 ? 0.3 : 0'),
	pre_entvar: flag('v.k == 5 ? 0.3 : 0'),
	property: flag("q.property('oxygen:p') == 3 ? 0.3 : 0"),
	position: flag('math.abs(q.position(1) + 60) < 0.01 ? 0.3 : 0'),
	// emitter-level reads (creation): a variable the emitter copies from the entity
	emit_query: flag('v.e > 0 ? 0.3 : 0', { 'minecraft:emitter_initialization': { creation_expression: 'v.e = q.variant;' } }),
	// how long emitters live on an entity
	riser: riser(4),
	puff_once: puff({ 'minecraft:emitter_lifetime_once': { active_time: 0.5 } }),
	puff_loop: puff({ 'minecraft:emitter_lifetime_looping': { active_time: 1, sleep_time: 0.5 } }, [1, 0.6, 0.2, 1]),
	// movement
	trail: trail(),
	trail_local: trail({ 'minecraft:emitter_local_space': { position: true, rotation: true } }, [0.4, 1, 0.4, 1]),
	inherit: trail({ 'minecraft:emitter_local_space': { position: false, rotation: false, velocity: true }, 'minecraft:particle_motion_dynamic': {}, 'minecraft:particle_lifetime_expression': { max_lifetime: 1.5 } }, [1, 0.9, 0.2, 1]),
	travel: effect({
		'minecraft:emitter_rate_instant': { num_particles: 0 },
		'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
		'minecraft:emitter_lifetime_events': { travel_distance_events: { '1.0': 'mark' }, looping_travel_distance_events: [{ distance: 1, effects: ['mark'] }] },
		'minecraft:particle_lifetime_expression': { max_lifetime: 20 },
		'minecraft:particle_appearance_billboard': BILLBOARD(0.1),
	}),
	// the entity's box (emitter_shape_entity_aabb), drawn on its surface
	aabb: effect({
		'minecraft:emitter_local_space': { position: true, rotation: true },
		'minecraft:emitter_rate_instant': { num_particles: 600 },
		'minecraft:emitter_lifetime_once': { active_time: 1 },
		'minecraft:emitter_shape_entity_aabb': { surface_only: true },
		'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
		'minecraft:particle_appearance_billboard': BILLBOARD(0.04),
		'minecraft:particle_appearance_tinting': { color: [1, 0.3, 1, 1] },
	}),
	// the live-particle cap: a 30k burst, a dot for every 1000th particle, x = thousands
	cap: effect({
		'minecraft:emitter_local_space': { position: true, rotation: true },
		'minecraft:emitter_rate_instant': { num_particles: 30000 },
		'minecraft:emitter_lifetime_once': { active_time: 1 },
		'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
		'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
		// every frame each live particle gets the next index (v.i restarts at 0): idx 999 exists while 1000 are alive
		'minecraft:particle_motion_parametric': { relative_position: ['math.floor(v.idx / 1000) * 0.25', 'math.mod(v.idx, 1000) == 999 ? 1.5 : -4', 0] },
		'minecraft:particle_lifetime_expression': { max_lifetime: 20 },
		'minecraft:particle_appearance_billboard': BILLBOARD(0.1),
		'minecraft:particle_appearance_tinting': { color: [1, 0.3, 0.3, 1] },
	}),
};
// parametric positions (e10)
RIG_EFFECTS.param_world = flag('0.25', { 'minecraft:particle_motion_parametric': { relative_position: [1, 0, 2] } }, [1, 0.3, 0.3, 1]);
RIG_EFFECTS.param_local = flag('0.25', { 'minecraft:particle_motion_parametric': { relative_position: [1, 0, 0] } }, [0.3, 1, 0.3, 1]);
RIG_EFFECTS.update_query = flag('v.e > 0 ? 0.3 : 0', { 'minecraft:emitter_initialization': { per_update_expression: 'v.e = q.variant;' } });
RIG_EFFECTS.trail_short = trail({ 'minecraft:particle_lifetime_expression': { max_lifetime: 1.5 } }, [1, 1, 1, 1]);
delete RIG_EFFECTS.param_world.particle_effect.components['minecraft:emitter_local_space'];
// q.position: a bar from the emitter, height q.position(1) + 61 (no locator: 1 block if it is the entity's feet)
RIG_EFFECTS.posbar = effect({
	'minecraft:emitter_local_space': { position: true, rotation: true },
	'minecraft:emitter_rate_instant': { num_particles: 20 },
	'minecraft:emitter_lifetime_once': { active_time: 1 },
	'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
	'minecraft:particle_initialization': { per_update_expression: 'v.k = v.i; v.i = v.i + 1;' },
	'minecraft:particle_motion_parametric': { relative_position: [0, '(q.position(1) + 61) * v.k / 19', 0] },
	'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
	'minecraft:particle_appearance_billboard': BILLBOARD(0.06),
	'minecraft:particle_appearance_tinting': { color: [1, 0.6, 0.1, 1] },
});
// q.position(0) and (2) against the entity's own: a dot at the emitter if q.position is the entity's x/z (set by pre_effect_script)
RIG_EFFECTS.posxz = flag('math.abs(q.position(0) - v.x) < 0.01 && math.abs(q.position(2) - v.z) < 0.01 ? 0.3 : 0.05');
// the live-particle cap of a steady emitter (20,000/s up to 20,000), a dot for every 1000th (x = thousands)
RIG_EFFECTS.cap_steady = structuredClone(RIG_EFFECTS.cap);
delete RIG_EFFECTS.cap_steady.particle_effect.components['minecraft:emitter_rate_instant'];
RIG_EFFECTS.cap_steady.particle_effect.components['minecraft:emitter_rate_steady'] = { spawn_rate: 20000, max_particles: 20000 };
RIG_EFFECTS.cap_steady.particle_effect.components['minecraft:emitter_lifetime_once'] = { active_time: 3 };
RIG_EFFECTS.cap_steady.particle_effect.components['minecraft:particle_appearance_tinting'] = { color: [0.3, 0.6, 1, 1] };
RIG_EFFECTS.travel.particle_effect.events = { mark: { particle_effect: { effect: 'oxygen:rig_wdot', type: 'emitter' } } };

/** The three axis lines of a frame at a locator */
export function triad(locator?: string, s: 'a' | 'p' | 'w' = 'a'): Fire[] {
	return ['x', 'y', 'z'].map((k) => ({ effect: s + k, ...(locator ? { locator } : {}) }));
}

function streams(locator?: string): Fire[] {
	return ['x', 'y', 'z'].map((k) => ({ effect: 's' + k, ...(locator ? { locator } : {}) }));
}

const at = (locator?: string): Fire => ({ effect: 'dot', ...(locator ? { locator } : {}) });

// ---------------------------------------------------------------- the rig

/** Locators, in model units (16 per block), on the rig's bones */
const P = 24; // 1.5 blocks up: above the body

/** geometry.oxygen_rig: a body with a yellow nose on its front (-Z in model space) and bones carrying locators */
export function rigGeometry(): Json {
	const bone = (name: string, extra: Json = {}) => ({ name, parent: 'root', pivot: [0, P, 0], ...extra });
	return {
		format_version: '1.16.0',
		'minecraft:geometry': [
			{
				description: { identifier: 'geometry.oxygen_rig', texture_width: 64, texture_height: 64, visible_bounds_width: 8, visible_bounds_height: 6, visible_bounds_offset: [0, 1.5, 0] },
				bones: [
					{
						name: 'root',
						pivot: [0, 0, 0],
						cubes: [
							{ origin: [-3, 0, -2], size: [6, 16, 4], uv: [0, 0] },
							{ origin: [-1, 11, -5], size: [2, 2, 3], uv: [0, 32] },
						],
						locators: {
							up: [0, P, 0],
							off_x: [8, P, 0],
							off_z: [0, P, 8],
							off_y: [0, P + 8, 0],
							rx90: { offset: [0, P, 0], rotation: [90, 0, 0] },
							ry90: { offset: [0, P, 0], rotation: [0, 90, 0] },
							rz90: { offset: [0, P, 0], rotation: [0, 0, 90] },
							ry30: { offset: [0, P, 0], rotation: [0, 30, 0] },
							// two axes at once: the order they apply in
							rxy: { offset: [0, P, 0], rotation: [90, 90, 0] },
							rxz: { offset: [0, P, 0], rotation: [90, 0, 90] },
							ryz: { offset: [0, P, 0], rotation: [0, 90, 90] },
							rxyz: { offset: [0, P, 0], rotation: [30, 45, 60] },
						},
					},
					// rotated in the geometry
					bone('brx', { rotation: [90, 0, 0], locators: { brx: [0, P, 0], brx_off: [0, P, 8] } }),
					bone('bry', { rotation: [0, 90, 0], locators: { bry: [0, P, 0], bry_off: [8, P, 0] } }),
					bone('brz', { rotation: [0, 0, 90], locators: { brz: [0, P, 0], brz_off: [8, P, 0] } }),
					// rotated, moved and scaled by an animation (oxygen_rig.pose)
					bone('arx', { locators: { arx: [0, P, 0], arx_off: [0, P, 8] } }),
					bone('ary', { locators: { ary: [0, P, 0], ary_off: [8, P, 0] } }),
					bone('arz', { locators: { arz: [0, P, 0], arz_off: [8, P, 0] } }),
					bone('ash', { locators: { ash: [0, P, 0] } }),
					bone('asc', { locators: { asc: [8, P, 0], asc_ign: { offset: [8, P + 8, 0], rotation: [0, 0, 0], ignore_inherited_scale: true } } }),
					// mirrored by an animation (scale [-1, 1, 1])
					bone('amir', { locators: { amir: [0, P, 0], amir_off: [8, P, 0] } }),
					// two axes on a bone
					bone('bxy', { rotation: [90, 90, 0], locators: { bxy: [0, P, 0] } }),
					// spun by an animation (oxygen_rig.spin), a quarter turn a second
					bone('spin', { locators: { spin: [8, P, 0] } }),
					// a chain: a child bone of a rotated bone
					{ name: 'chain', parent: 'bry', pivot: [8, P, 0], rotation: [90, 0, 0], locators: { chain: [8, P, 0] } },
				],
			},
		],
	};
}

/** The rig's texture: grey body, yellow nose */
export function rigTexture(): Uint8Array {
	return makeImage(64, 64, (_x, y) => (y >= 32 ? [250, 210, 40, 255] : [150, 150, 160, 255]));
}

// ---------------------------------------------------------------- tests

export const ENTITY_TESTS: EntityTest[] = [
	{
		id: 'e01',
		title: 'Locators on the root bone',
		question: 'Where does an effect on a locator spawn, and which way do its emitter axes point?',
		assumption: 'An effect without a locator spawns at the entity’s feet; a locator puts it at the locator’s offset (model units /16) in the entity’s frame, and its axes follow the entity’s facing (and the locator’s rotation).',
		wait: 2,
		spacing: 3,
		views: ['above', 'frontleft', 'behind'],
		probes: [
			{ id: 'p1', reads: 'no locator: triad at the feet', fire: triad() },
			{ id: 'p2', reads: 'locator up [0,24,0]', fire: triad('up') },
			{ id: 'p3', reads: 'locator off_x [8,24,0]: which side +X model units go', fire: [...triad('off_x'), at('up')] },
			{ id: 'p4', reads: 'locator off_z [0,24,8]: which side +Z model units go (the nose is on -Z)', fire: [...triad('off_z'), at('up')] },
			{ id: 'p5', reads: 'locator rotation [90,0,0]', fire: triad('rx90') },
			{ id: 'p6', reads: 'locator rotation [0,90,0]', fire: triad('ry90') },
			{ id: 'p7', reads: 'locator rotation [0,0,90]', fire: triad('rz90') },
			{ id: 'p8', reads: 'locator rotation [0,30,0]: the sign of a small yaw', fire: triad('ry30') },
		],
	},
	{
		id: 'e02',
		title: 'Locators on rotated, moved and scaled bones',
		question: 'Do locators follow their bone’s rotation (geometry and animation), position and scale, and how?',
		assumption: 'A locator moves and turns with its bone: geometry rotations and animation rotations both apply, as do animated position and scale.',
		wait: 3,
		spacing: 3,
		views: ['above', 'frontleft', 'behind'],
		probes: [
			{ id: 'p1', reads: 'bone rotated [90,0,0] in the geometry; dot = locator 8 units +Z of the pivot', fire: [...triad('brx'), at('brx_off')] },
			{ id: 'p2', reads: 'bone rotated [0,90,0] in the geometry; dot = locator 8 units +X', fire: [...triad('bry'), at('bry_off')] },
			{ id: 'p3', reads: 'bone rotated [0,0,90] in the geometry; dot = locator 8 units +X', fire: [...triad('brz'), at('brz_off')] },
			{ id: 'p4', reads: 'bone rotated [90,0,0] by an animation; dot = 8 units +Z', fire: [...triad('arx'), at('arx_off')] },
			{ id: 'p5', reads: 'bone rotated [0,90,0] by an animation; dot = 8 units +X', fire: [...triad('ary'), at('ary_off')] },
			{ id: 'p6', reads: 'bone rotated [0,0,90] by an animation; dot = 8 units +X', fire: [...triad('arz'), at('arz_off')] },
			{ id: 'p7', reads: 'bone moved [8,0,0] by an animation (dot = where it would be unmoved)', fire: [...triad('ash'), at('up')] },
			{ id: 'p8', reads: 'bone scaled 2 by an animation, locator 8 units +X (dot = unscaled)', fire: [...triad('asc'), at('off_x')] },
			{ id: 'p9', reads: 'a child bone [90,0,0] of the [0,90,0] bone, locator at its pivot', fire: triad('chain') },
		],
	},
	{
		id: 'e03',
		title: 'Entity facing and emitter space',
		question: 'How does the entity’s yaw turn an attached effect, in each emitter_local_space mode?',
		assumption: 'Local rotation follows the body yaw; with position-only local space, and in world space, shape offsets still turn with the entity at spawn.',
		wait: 2,
		spacing: 3,
		views: ['above', 'frontleft'],
		probes: [
			{ id: 'p1', reads: 'yaw 90, locator up', yaw: 90, fire: triad('up') },
			{ id: 'p2', reads: 'yaw 180, locator up', yaw: 180, fire: triad('up') },
			{ id: 'p3', reads: 'yaw 270, locator up', yaw: 270, fire: triad('up') },
			{ id: 'p4', reads: 'yaw 90, no locator', yaw: 90, fire: triad() },
			{ id: 'p5', reads: 'yaw 90, locator up, position-only local space', yaw: 90, fire: triad('up', 'p') },
			{ id: 'p6', reads: 'yaw 90, locator up, world space', yaw: 90, fire: triad('up', 'w') },
			{ id: 'p7', reads: 'yaw 0, locator rx90, world space', fire: triad('rx90', 'w') },
			{ id: 'p8', reads: 'yaw 0, locator rx90, position-only local space', fire: triad('rx90', 'p') },
		],
	},
	{
		id: 'e04',
		title: 'Directions on a locator',
		question: 'Do shape directions and speeds turn the same way as positions on a locator?',
		assumption: 'An emitter’s direction (and initial velocity) is turned by the same frame as its shape offsets.',
		wait: 2,
		spacing: 3,
		views: ['above', 'frontleft'],
		probes: [
			{ id: 'p1', reads: 'no locator', fire: streams() },
			{ id: 'p2', reads: 'locator up', fire: streams('up') },
			{ id: 'p3', reads: 'locator rx90', fire: streams('rx90') },
			{ id: 'p4', reads: 'locator rz90', fire: streams('rz90') },
			{ id: 'p5', reads: 'bone rotated [90,0,0] (brx)', fire: streams('brx') },
			{ id: 'p6', reads: 'yaw 90, locator up', yaw: 90, fire: streams('up') },
			{ id: 'p7', reads: 'bone scaled 2 (asc): are speeds scaled with the frame?', fire: streams('asc') },
		],
	},
	{
		id: 'e05',
		title: 'Rotation order, scale and mirroring',
		question: 'In which order do a locator’s (and a bone’s) X, Y and Z rotations apply, and what do scale and a mirrored bone do to the frame?',
		assumption: 'Rotations apply in the order Blockbench uses; a scaled bone scales the emitter frame (offsets), ignore_inherited_scale undoes it; a mirrored bone mirrors it.',
		wait: 3,
		spacing: 3,
		probes: [
			{ id: 'p1', reads: 'locator rotation [90,90,0]', fire: triad('rxy') },
			{ id: 'p2', reads: 'locator rotation [90,0,90]', fire: triad('rxz') },
			{ id: 'p3', reads: 'locator rotation [0,90,90]', fire: triad('ryz') },
			{ id: 'p4', reads: 'locator rotation [30,45,60]', fire: triad('rxyz') },
			{ id: 'p5', reads: 'bone rotation [90,90,0] (bxy)', fire: triad('bxy') },
			{ id: 'p6', reads: 'bone scaled 2, locator with ignore_inherited_scale (dot = up)', fire: [...triad('asc_ign'), at('up')] },
			{ id: 'p7', reads: 'bone mirrored [-1,1,1] by an animation; dot = locator 8 units +X', fire: [...triad('amir'), at('amir_off')] },
			{ id: 'p8', reads: 'entity scale 2 (minecraft:scale), locator up and the feet', components: { 'minecraft:scale': { value: 2 } }, fire: [...triad('up'), at()] },
		],
	},
	{
		id: 'e06',
		title: 'A moving entity',
		question: 'How do attached effects follow an entity that moves and turns (teleported each tick round a circle, or pushed)?',
		assumption: 'Local-space particles move and turn with the locator; world-space particles stay where they spawned; velocity: true adds the entity’s velocity; travel distance counts the entity’s movement.',
		wait: 6,
		spacing: 8,
		probes: [
			{ id: 'p1', reads: 'circling: local-space triad on up (follows and turns)', move: { kind: 'circle', radius: 2, speed: 2 }, fire: triad('up') },
			{ id: 'p2', reads: 'circling: world-space trail (pink) and local-space trail (green) on off_x', move: { kind: 'circle', radius: 2, speed: 2 }, fire: [{ effect: 'trail', locator: 'off_x' }, { effect: 'trail_local', locator: 'off_x' }] },
			{ id: 'p3', reads: 'circling: velocity: true (yellow dots drift along the way it moves?)', move: { kind: 'circle', radius: 2, speed: 2 }, fire: [{ effect: 'inherit', locator: 'up' }] },
			{ id: 'p4', reads: 'circling: a dot every block travelled', move: { kind: 'circle', radius: 2, speed: 2 }, fire: [{ effect: 'travel' }] },
			{ id: 'p5', reads: 'pushed (+X impulse): velocity: true, trail and travel dots', move: { kind: 'push', speed: 0.6, after: 1 }, fire: [{ effect: 'inherit', locator: 'up' }, { effect: 'trail' }, { effect: 'travel' }] },
			{ id: 'p6', reads: 'circling: bind_to_actor false (rising dots stay where it was summoned)', move: { kind: 'circle', radius: 2, speed: 2 }, fire: [{ effect: 'riser', locator: 'up', bind_to_actor: false }] },
		],
	},
	{
		id: 'e07',
		title: 'The entity’s Molang in its effects',
		question: 'Can an attached effect read the entity’s queries, variables and properties, directly or through pre_effect_script?',
		assumption: 'Particle Molang runs with the entity as its context: entity queries (q.variant, q.position, q.property) work; entity variables are not shared; pre_effect_script runs on the emitter and can read the entity’s queries.',
		wait: 2,
		spacing: 3,
		probes: [
			{ id: 'p1', reads: 'particle size reads q.variant (visible if it works)', fire: [{ effect: 'qvariant', locator: 'up' }] },
			{ id: 'p2', reads: 'particle size reads the entity’s v.ent (set to 5 in pre_animation)', fire: [{ effect: 'entvar', locator: 'up' }] },
			{ id: 'p3', reads: 'pre_effect_script v.k = q.variant;', fire: [{ effect: 'pre_query', locator: 'up', pre_effect_script: 'v.k = q.variant;' }] },
			{ id: 'p4', reads: 'pre_effect_script v.k = v.ent; (the entity’s variable)', fire: [{ effect: 'pre_entvar', locator: 'up', pre_effect_script: 'v.k = v.ent;' }] },
			{ id: 'p5', reads: "q.property('oxygen:p') == 3 (client_sync int property)", fire: [{ effect: 'property', locator: 'up' }] },
			{ id: 'p6', reads: 'q.position(1) is the entity’s y (-60)', fire: [{ effect: 'position', locator: 'up' }] },
			{ id: 'p7', reads: 'emitter creation_expression v.e = q.variant;', fire: [{ effect: 'emit_query', locator: 'up' }] },
		],
	},
	{
		id: 'e08',
		title: 'How long an attached emitter lives',
		question: 'What ends an attached emitter: the animation looping, the animation stopping, leaving a controller state, the entity going away?',
		assumption: 'Each pass of a looping animation fires a new emitter; looping emitters loop on an entity; an emitter outlives its animation and controller state; it ends with the entity (its particles stay).',
		wait: 6,
		spacing: 3,
		probes: [
			{ id: 'p1', reads: 'animation looping every 1.5 s fires a once emitter: a new rising dot each pass?', loop: 1.5, fire: [{ effect: 'puff_once', locator: 'up' }] },
			{ id: 'p2', reads: 'looping emitter (1 s on, 0.5 s off) fired once: a dot every 1.5 s?', fire: [{ effect: 'puff_loop', locator: 'up' }] },
			{ id: 'p3', reads: 'the animation stops at 2 s (variant changes): does the stream stop?', fire: [{ effect: 'riser', locator: 'up' }], later: [{ after: 2, command: 'event entity @s oxygen:off' }] },
			{ id: 'p4', reads: 'controller state left at 2 s: does the stream stop?', controller: [{ effect: 'riser', locator: 'up' }], later: [{ after: 2, command: 'event entity @s oxygen:off' }] },
			{ id: 'p5', reads: 'the entity despawns at 2 s: does the stream stop, do its particles stay?', fire: [{ effect: 'riser', locator: 'up' }, ...triad('off_x')], later: [{ after: 2, command: 'event entity @s oxygen:despawn' }] },
			{ id: 'p6', reads: 'control: the stream keeps going', fire: [{ effect: 'riser', locator: 'up' }] },
		],
	},
	{
		id: 'e09',
		title: 'Live particles on an entity, and its box',
		question: 'How many live particles can one emitter on an entity hold (a dot for every 1000th of a 30k burst), and where is entity_aabb?',
		assumption: 'An emitter on an entity holds 10,000 particles (creators’ reports; 1000 for /particle); entity_aabb is the entity’s collision box.',
		wait: 3,
		spacing: 10,
		probes: [
			{ id: 'p1', reads: 'count the red dots (x = thousands, 4 per block)', fire: [{ effect: 'cap' }] },
			{ id: 'p2', reads: 'entity_aabb without a locator: the 0.6 × 1.8 box at the feet?', fire: [{ effect: 'aabb' }] },
			{ id: 'p3', reads: 'entity_aabb on locator up: around the entity, or moved up with the locator?', fire: [{ effect: 'aabb', locator: 'up' }] },
			{ id: 'p4', reads: 'entity_aabb on locator rx90 (turned)', fire: [{ effect: 'aabb', locator: 'rx90' }] },
		],
	},
	{
		id: 'e10',
		title: 'Parametric positions, bind_to_actor, inherited velocity',
		question: 'Where do parametric positions of attached emitters land; does bind_to_actor: false leave the emitter where it spawned; does velocity: true take a teleported entity’s speed?',
		assumption: 'relative_position is from the emitter (world space: turned by the locator at spawn); bind_to_actor: false spawns at the locator and stays; velocity: true adds the entity’s velocity.',
		wait: 4,
		spacing: 8,
		probes: [
			{ id: 'p1', reads: 'world-space relative_position [1,0,2] on locator up (red square: at the rig, or near the world origin?)', fire: [{ effect: 'param_world', locator: 'up' }, at('up')] },
			{ id: 'p2', reads: 'local-space relative_position [1,0,0] on locator up (green square)', fire: [{ effect: 'param_local', locator: 'up' }, at('up')] },
			{ id: 'p3', reads: 'circling: bind_to_actor false on a world-space trail (stays in one place?)', move: { kind: 'circle', radius: 2, speed: 2 }, fire: [{ effect: 'trail', locator: 'up', bind_to_actor: false }] },
			{ id: 'p4', reads: 'walking ±X at 2 blocks/s (teleported): velocity: true (yellow) vs none (white, 1.5 s)', move: { kind: 'line', radius: 5, speed: 2 }, fire: [{ effect: 'inherit', locator: 'up' }, { effect: 'trail_short' }] },
			{ id: 'p5', reads: 'emitter per_update v.e = q.variant;', fire: [{ effect: 'update_query', locator: 'up' }] },
			{ id: 'p6', reads: 'world-space triad on the scaled bone (asc): scaled like the local one?', fire: triad('asc', 'w') },
			{ id: 'p7', reads: 'entity scale 2, no locator: triad scaled?', components: { 'minecraft:scale': { value: 2 } }, fire: triad() },
		],
	},
	{
		id: 'e11',
		title: 'Real velocity, and a locator an animation moves',
		question: 'With the entity really moving (physics velocity, +X 1.5 blocks/s from 0.5 s to 4.5 s): does velocity: true add it, how often do travel-distance events fire? Do effects follow a locator an animation spins?',
		assumption: 'velocity: true adds the entity’s velocity; travel events fire once per block; local-space particles follow an animated locator, world-space ones trace its path.',
		wait: 5,
		spacing: 10,
		probes: [
			{ id: 'p1', reads: 'driven: velocity: true (yellow, 1.5 s) vs none (white)', move: { kind: 'drive', speed: 1.5, after: 0.5, seconds: 4 }, fire: [{ effect: 'inherit', locator: 'up' }, { effect: 'trail_short' }] },
			{ id: 'p2', reads: 'driven: world trail (pink) and a dot every block travelled (6 blocks)', move: { kind: 'drive', speed: 1.5, after: 0.5, seconds: 4 }, fire: [{ effect: 'trail' }, { effect: 'travel' }] },
			{ id: 'p3', reads: 'locator on a bone spun 90°/s: local triad (turns with it?) and world trail (a circle of radius 0.5)', fire: [...triad('spin'), { effect: 'trail', locator: 'spin' }] },
			{ id: 'p4', reads: 'q.position(1): the orange bar is (q.position(1) + 61) tall (1 = the entity’s feet)', fire: [{ effect: 'posbar' }] },
			{ id: 'p5', reads: 'q.position(1) on locator up (the bar hangs down: Y flips): 1 = feet, 2.5 = the locator', fire: [{ effect: 'posbar', locator: 'up' }] },
		],
	},
	{
		id: 'e12',
		title: 'Steady cap, despawn, bind_to_actor without a locator',
		question: 'How many particles does a steady emitter on an entity hold; which particles survive the entity; where does bind_to_actor: false put an effect without a locator?',
		assumption: 'The cap is 1000 per emitter on entities too (e09); world-space particles outlive the entity, local-space ones go with it; unbound effects spawn at the world origin (e06, e10).',
		wait: 4,
		spacing: 10,
		probes: [
			{ id: 'p1', reads: 'steady 20,000/s up to 20,000: count the blue dots (x = thousands, 4 per block)', fire: [{ effect: 'cap_steady' }] },
			{ id: 'p2', reads: 'despawns at 2 s: local triad, world dot (white) and riser — which stay?', fire: [...triad('up'), { effect: 'wdot', locator: 'off_x' }, { effect: 'riser', locator: 'off_z' }], later: [{ after: 2, command: 'event entity @s oxygen:despawn' }] },
			{ id: 'p3', reads: 'bind_to_actor false, no locator: a riser (at the world origin?)', fire: [{ effect: 'riser', bind_to_actor: false }] },
			{ id: 'p4', reads: 'q.position(0)/(2) is the entity’s x/z (big square) or not (small)', fire: [{ effect: 'posxz', pre_effect_script: 'v.x = q.position(0); v.z = q.position(2);' }] },
		],
	},
];

// ---------------------------------------------------------------- pack files

export interface RigProbe {
	test: EntityTest;
	probe: EntityProbe;
	variant: number;
}

/** Every probe with its rig variant (1, 2, …) */
export function rigProbes(): RigProbe[] {
	const out: RigProbe[] = [];
	for (const test of ENTITY_TESTS) for (const probe of test.probes) out.push({ test, probe, variant: out.length + 1 });
	return out;
}

/** BP: oxygen:rig — no AI, no gravity, can't be hurt or pushed; each variant is an event */
export function rigBehavior(): Json {
	const probes = rigProbes();
	const groups: Json = { despawn: { 'minecraft:instant_despawn': {} }, off: { 'minecraft:variant': { value: 0 } } };
	const events: Json = {
		'oxygen:despawn': { add: { component_groups: ['despawn'] } },
		// variant 0: its probe's animation (and controller state) ends
		'oxygen:off': { remove: { component_groups: probes.map((r) => `v${r.variant}`) }, add: { component_groups: ['off'] } },
	};
	for (const { probe, variant } of probes) {
		groups[`v${variant}`] = { 'minecraft:variant': { value: variant }, ...(probe.components ?? {}) };
		events[`oxygen:v${variant}`] = { add: { component_groups: [`v${variant}`] } };
	}
	return {
		format_version: '1.21.0',
		'minecraft:entity': {
			description: {
				identifier: 'oxygen:rig',
				is_spawnable: false,
				is_summonable: true,
				is_experimental: false,
				properties: { 'oxygen:p': { type: 'int', range: [0, 10], default: 3, client_sync: true } },
			},
			component_groups: groups,
			components: {
				'minecraft:type_family': { family: ['oxygen_rig'] },
				'minecraft:collision_box': { width: 0.6, height: 1.8 },
				'minecraft:physics': { has_gravity: false, has_collision: true },
				'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false },
				'minecraft:damage_sensor': { triggers: [{ cause: 'all', deals_damage: 'no' }] },
				'minecraft:health': { value: 20, max: 20 },
				'minecraft:knockback_resistance': { value: 1 },
				'minecraft:variant': { value: 0 },
			},
			events,
		},
	};
}

/** RP: the client entity, its animations, controllers and render controller */
export function rigClient(): { entity: Json; animations: Json; controllers: Json; renderController: Json } {
	const particleEffects: Json = {};
	for (const name of Object.keys(RIG_EFFECTS)) particleEffects[name] = `oxygen:rig_${name}`;
	const animations: Json = {
		'animation.oxygen_rig.pose': {
			loop: true,
			bones: {
				arx: { rotation: [90, 0, 0] },
				ary: { rotation: [0, 90, 0] },
				arz: { rotation: [0, 0, 90] },
				ash: { position: [8, 0, 0] },
				asc: { scale: 2 },
				amir: { scale: [-1, 1, 1] },
			},
		},
		'animation.oxygen_rig.spin': { loop: true, bones: { spin: { rotation: [0, 'q.anim_time * 90', 0] } } },
	};
	const controllers: Json = {};
	const animationNames: Json = { pose: 'animation.oxygen_rig.pose', spin: 'animation.oxygen_rig.spin' };
	const animate: (string | Json)[] = ['pose', 'spin'];
	for (const { test, probe, variant } of rigProbes()) {
		const key = `${test.id}_${probe.id}`;
		if (probe.fire?.length) {
			animations[`animation.oxygen_rig.${key}`] = {
				...(probe.loop ? { loop: true, animation_length: probe.loop } : { animation_length: 0.05 }),
				particle_effects: { '0.0': probe.fire },
			};
			animationNames[key] = `animation.oxygen_rig.${key}`;
			animate.push({ [key]: `q.variant == ${variant}` });
		}
		if (probe.controller?.length) {
			const id = `controller.animation.oxygen_rig.${key}`;
			controllers[id] = {
				initial_state: 'default',
				states: {
					default: { transitions: [{ on: `q.variant == ${variant}` }] },
					on: { particle_effects: probe.controller, transitions: [{ default: `q.variant != ${variant}` }] },
				},
			};
			animationNames[`${key}_ctl`] = id;
			animate.push(`${key}_ctl`);
		}
	}
	return {
		entity: {
			format_version: '1.10.0',
			'minecraft:client_entity': {
				description: {
					identifier: 'oxygen:rig',
					materials: { default: 'entity_alphatest' },
					textures: { default: 'textures/entity/oxygen_rig' },
					geometry: { default: 'geometry.oxygen_rig' },
					render_controllers: ['controller.render.oxygen_rig'],
					particle_effects: particleEffects,
					animations: animationNames,
					// an entity variable effects can try to read (e07)
					scripts: { pre_animation: ['v.ent = 5;'], animate },
				},
			},
		},
		animations: { format_version: '1.8.0', animations },
		controllers: { format_version: '1.10.0', animation_controllers: controllers },
		renderController: {
			format_version: '1.8.0',
			render_controllers: { 'controller.render.oxygen_rig': { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] } },
		},
	};
}
