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
	/** blocks to place around the rig, relative to the block it stands in */
	blocks?: { dx: number; dy: number; dz: number; block: string }[];
	/**
	 * Entity-side Molang for this rig, in a looping animation of its own (`loop` seconds, default 1): `timeline` keys
	 * run once a pass, `bones` channels (Molang statements allowed) every frame
	 */
	script?: { timeline?: Record<string, string>; bones?: Json; loop?: number };
	/** which rig entity type (default the plain rig): see RIG_KINDS */
	rig?: RigKind;
}

/**
 * Rig entity types that differ only in their client entity's geometry map and queryable_geometry (e29).
 * Every type shares the variants, animations and effects; the alt geometry has the same bones as the main one,
 * plus `altbone`, with `qbox` turned 30° about Z (the main one's isn't turned), so a bone query tells them apart.
 */
export const RIG_KINDS = {
	rig: { geometry: { default: 'geometry.oxygen_rig' } },
	rig_qd: { geometry: { default: 'geometry.oxygen_rig' }, queryable_geometry: 'default' },
	rig_qa: { geometry: { default: 'geometry.oxygen_rig', alt: 'geometry.oxygen_rig_alt' }, queryable_geometry: 'alt' },
	rig_q2: { geometry: { default: 'geometry.oxygen_rig', alt: 'geometry.oxygen_rig_alt' } },
	// the same two geometries, alt listed first (e31): does the last-listed one, or the non-default one, answer?
	rig_q3: { geometry: { alt: 'geometry.oxygen_rig_alt', default: 'geometry.oxygen_rig' } },
} as const;
export type RigKind = keyof typeof RIG_KINDS;

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

// ---------------------------------------------------------------- e32: where world-space parametric positions are measured from
//
// Every e32 rig fires a green flag at relative_position [1, 2, 0], beside the rig if positions are measured from
// the emitter or the entity, and a red one at the rig's own world position + [1, 2, 0], beside the rig if they're
// measured from the world origin (the rows are thousands of blocks from it, so the other one is far out of sight).
// placeE32 writes the red ones once the rows are laid out.

/** A world-space flag whose particle sits at `rel` (Molang) by parametric motion */
function paramFlag(rel: unknown[], colour: number[]): Json {
	const fx = flag('0.4', { 'minecraft:particle_motion_parametric': { relative_position: rel } }, colour);
	delete fx.particle_effect.components['minecraft:emitter_local_space'];
	return fx;
}
/** A world-space stream: 8 dots a second, each at `rel` (Molang) by parametric motion, living 3 s */
function paramStream(rel: unknown[], colour: number[]): Json {
	return trail({ 'minecraft:emitter_rate_steady': { spawn_rate: 8, max_particles: 100 }, 'minecraft:particle_motion_parametric': { relative_position: rel }, 'minecraft:particle_lifetime_expression': { max_lifetime: 3 } }, colour);
}
const E32_GREEN = [0.3, 1, 0.3, 1];
const E32_RED = [1, 0.25, 0.25, 1];
/** like aurora: the position moves with the particle's age */
const E32_WOBBLE = 'math.sin(v.particle_age * 90) * 0.5';
RIG_EFFECTS.e32_g = paramFlag([1, 2, 0], E32_GREEN);
RIG_EFFECTS.e32_ga = paramFlag([`1 + ${E32_WOBBLE}`, 2, 0], E32_GREEN);
RIG_EFFECTS.e32_gs = paramStream([1, 2, 0], E32_GREEN);
/** which red flag each e32 probe fires (its own world position is filled in by placeE32) */
const E32_RED_KINDS: ('flag' | 'wobble' | 'stream')[] = ['flag', 'flag', 'wobble', 'flag', 'stream', 'flag', 'flag'];
E32_RED_KINDS.forEach((_, j) => (RIG_EFFECTS[`e32_o${j}`] = paramFlag([0, 0, 0], E32_RED)));

/** Write the red flags of e32: probe j's rig stands at stations[j] (world coordinates of its feet) */
export function placeE32(stations: [number, number, number][]): void {
	E32_RED_KINDS.forEach((kind, j) => {
		const [x, y, z] = stations[j];
		const rel = [kind === 'wobble' ? `${x + 1} + ${E32_WOBBLE}` : x + 1, y + 2, z];
		RIG_EFFECTS[`e32_o${j}`] = kind === 'stream' ? paramStream(rel, E32_RED) : paramFlag(rel, E32_RED);
	});
}

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

// ---------------------------------------------------------------- event children (e13, e14)

/** Child effects an event can spawn, one per spawn type, told apart by colour and size */
const KIDS = {
	e: { type: 'emitter', colour: [1, 0.2, 0.2, 1], size: 0.2 },
	b: { type: 'emitter_bound', colour: [0.2, 1, 0.2, 1], size: 0.15 },
	p: { type: 'particle', colour: [0.3, 0.5, 1, 1], size: 0.1 },
	v: { type: 'particle_with_velocity', colour: [1, 0.9, 0.2, 1], size: 0.06 },
} as const;
for (const [k, kid] of Object.entries(KIDS)) {
	// one still particle that lives 3 s; a particle_with_velocity child moves if it takes the parent particle's velocity
	RIG_EFFECTS[`kid_${k}`] = effect({
		'minecraft:emitter_rate_instant': { num_particles: 1 },
		'minecraft:emitter_lifetime_once': { active_time: 1 },
		'minecraft:particle_motion_dynamic': {},
		'minecraft:particle_lifetime_expression': { max_lifetime: 3 },
		'minecraft:particle_appearance_billboard': BILLBOARD(kid.size),
		'minecraft:particle_appearance_tinting': { color: kid.colour },
	}, 'textures/particle/oxygen_probe');
}

export type EventPhase = 'creation' | 'timeline' | 'expiration';
export type EventSpace = 'world' | 'position' | 'rotation' | 'local';

/**
 * A parent whose one particle starts 1 block along the emitter's X and moves along its Y at 1 block/s for 1 s (grey),
 * and fires an event that spawns all four kinds of child: on its creation, at 0.5 s (timeline) or when it expires
 */
function eventParent(phase: EventPhase, sp: EventSpace): Json {
	const flags = { world: null, position: { position: true, rotation: false }, rotation: { position: false, rotation: true }, local: { position: true, rotation: true } }[sp];
	const json = effect({
		...(flags ? { 'minecraft:emitter_local_space': flags } : {}),
		'minecraft:emitter_rate_instant': { num_particles: 1 },
		'minecraft:emitter_lifetime_once': { active_time: 3 },
		'minecraft:emitter_shape_point': { offset: [1, 0, 0], direction: [0, 1, 0] },
		'minecraft:particle_initial_speed': 1,
		'minecraft:particle_motion_dynamic': {},
		'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
		'minecraft:particle_lifetime_events': phase === 'creation' ? { creation_event: 'kids' } : phase === 'timeline' ? { timeline: { '0.5': 'kids' } } : { expiration_event: 'kids' },
		'minecraft:particle_appearance_billboard': BILLBOARD(0.05),
		'minecraft:particle_appearance_tinting': { color: [0.6, 0.6, 0.6, 1] },
	}, 'textures/particle/oxygen_probe');
	json.particle_effect.events = { kids: { sequence: Object.entries(KIDS).map(([k, kid]) => ({ particle_effect: { effect: `oxygen:rig_kid_${k}`, type: kid.type } })) } };
	return json;
}
const PHASES: EventPhase[] = ['creation', 'timeline', 'expiration'];
const SPACES: EventSpace[] = ['world', 'position', 'rotation', 'local'];
for (const ph of PHASES) for (const sp of SPACES) RIG_EFFECTS[`ev_${ph}_${sp}`] = eventParent(ph, sp);

/** e13/e14 probes: every event phase in every emitter space, on a locator or not */
function eventProbes(locator?: string): EntityProbe[] {
	const out: EntityProbe[] = [];
	const space = (sp: EventSpace) => (sp === 'world' ? 'world space' : sp === 'local' ? 'local position and rotation' : `local ${sp} only`);
	for (const ph of PHASES)
		for (const sp of SPACES)
			out.push({
				id: `${ph[0]}${sp[0]}`,
				reads: `${ph} event, ${space(sp)}: where is each child (red emitter, green emitter_bound, blue particle, yellow particle_with_velocity) against the grey particle and the white dot (the emitter)? Does yellow move?`,
				fire: [{ effect: `ev_${ph}_${sp}`, ...(locator ? { locator } : {}) }, at(locator)],
			});
	return out;
}

// ---------------------------------------------------------------- readouts (e15, e16)

/**
 * A bar of 20 dots from the emitter along one of its axes (X red, Y green, Z blue), `value × scale` blocks long (a
 * negative value points the other way). `setup` runs first in the emitter's update. Dots that all sit on the emitter
 * mean the value was unset (the read aborted, or the setup was dropped).
 */
function bar(axis: number, value: string, scale: number, setup = ''): Json {
	const pos = [0, 0, 0].map((_, i) => (i === axis ? `(${value}) * ${scale} * v.k / 19` : 0));
	return effect({
		'minecraft:emitter_local_space': { position: true, rotation: true },
		'minecraft:emitter_rate_instant': { num_particles: 20 },
		'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
		'minecraft:emitter_initialization': { per_update_expression: `${setup} v.i = 0;`.trim() },
		'minecraft:particle_initialization': { per_update_expression: 'v.k = v.i; v.i = v.i + 1;' },
		'minecraft:particle_motion_parametric': { relative_position: pos },
		'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
		'minecraft:particle_appearance_billboard': BILLBOARD(0.04),
		'minecraft:particle_appearance_tinting': { color: COLOURS[axis] },
	}, 'textures/particle/oxygen_probe');
}

/** Three bars (`name_x`, `_y`, `_z`), one per value; `setup` runs before each */
function readout(name: string, setup: string, values: [string, string, string], scale: number): void {
	values.forEach((m, axis) => (RIG_EFFECTS[`${name}_${'xyz'[axis]}`] = bar(axis, m, scale, setup)));
}
const xyz = (o: string): [string, string, string] => [`${o}.x`, `${o}.y`, `${o}.z`];
readout('bo_qbox', "v.o = q.bone_origin('qbox');", xyz('v.o'), 1 / 16);
readout('bo_upper', "v.o = q.bone_origin('QBOX');", xyz('v.o'), 1 / 16);
readout('bo_brx', "v.o = q.bone_origin('brx');", xyz('v.o'), 1 / 16);
readout('bo_chain', "v.o = q.bone_origin('chain');", xyz('v.o'), 1 / 16);
readout('bo_ash', "v.o = q.bone_origin('ash');", xyz('v.o'), 1 / 16);
readout('bo_nope', "v.o = q.bone_origin('nope');", xyz('v.o'), 1 / 16);
readout('br_qrot', "v.o = q.bone_rotation('qrot');", xyz('v.o'), 1 / 90);
readout('br_arx', "v.o = q.bone_rotation('arx');", xyz('v.o'), 1 / 90);
readout('bmin_qbox', "v.o = q.bone_aabb('qbox');", xyz('v.o.min'), 1 / 16);
readout('bmax_qbox', "v.o = q.bone_aabb('qbox');", xyz('v.o.max'), 1 / 16);
readout('bmin_qrot', "v.o = q.bone_aabb('qrot');", xyz('v.o.min'), 1 / 16);
readout('bmax_qrot', "v.o = q.bone_aabb('qrot');", xyz('v.o.max'), 1 / 16);
readout('bmin_root', "v.o = q.bone_aabb('root');", xyz('v.o.min'), 1 / 16);
// pre_effect_script fills v.o; the bars only read it
readout('bo_pre', '', xyz('v.o'), 1 / 16);
// the member read straight off the call: 0.3 = works, 0.1 = something else, 1.0 (the default size) = dropped at load
RIG_EFFECTS.bo_direct = flag("q.bone_origin('qbox').y == 8 ? 0.3 : 0.1");
// where the rig stands within its block (x and z): 0.5 = the block's centre
readout('frac', '', ['q.position(0) - math.floor(q.position(0))', '0', 'q.position(2) - math.floor(q.position(2))'], 1);
// clocks: v.emitter_age (X) beside q.life_time (Y), 1 block a second; q.delta_time × 20 (Z: 1 block = a game tick)
readout('clock', '', ['v.emitter_age', 'q.life_time', 'q.delta_time * 20'], 1);
readout('clock_pre', '', ['v.emitter_age', 'v.l ?? -0.25', 'v.d ?? -0.25'], 1);

/** Fire the three bars of a readout */
function bars(name: string, extra: Partial<Fire> = {}): Fire[] {
	return ['x', 'y', 'z'].map((k) => ({ effect: `${name}_${k}`, ...extra }));
}

// block tags round the entity: 0.3 = true, 0.1 = false, 0.2 = the variable was never set, 1.0 (the default) = dropped at load
const tagFlag = (q: string) => flag(`${q} ? 0.3 : 0.1`);
RIG_EFFECTS.rb_e = tagFlag("q.relative_block_has_any_tag(1, 0, 0, 'stone')");
RIG_EFFECTS.rb_s = tagFlag("q.relative_block_has_any_tag(0, 0, 1, 'metal')");
RIG_EFFECTS.rb_e06 = tagFlag("q.relative_block_has_any_tag(0.6, 0, 0, 'stone')");
RIG_EFFECTS.rb_w06 = tagFlag("q.relative_block_has_any_tag(-0.6, 0, 0, 'stone')");
RIG_EFFECTS.rb_w14 = tagFlag("q.relative_block_has_any_tag(-1.4, 0, 0, 'stone')");
RIG_EFFECTS.rb_none = tagFlag("q.relative_block_has_any_tag(0, 0, -1, 'stone')");
RIG_EFFECTS.rb_var = flag('(v.k ?? -1) > 0 ? 0.3 : ((v.k ?? -1) == 0 ? 0.1 : 0.2)');
RIG_EFFECTS.rb_update = flag('(v.e ?? -1) > 0 ? 0.3 : ((v.e ?? -1) == 0 ? 0.1 : 0.2)', {
	'minecraft:emitter_initialization': { per_update_expression: "v.e = q.relative_block_has_any_tag(1, 0, 0, 'stone');" },
});
// q.is_alive while the entity dies: rising world-space dots, spawned 0.5 block along X while it reads 0
RIG_EFFECTS.alive = effect({
	'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 200 },
	'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
	'minecraft:emitter_shape_point': { offset: ['q.is_alive ? 0 : 0.5', 0, 0] },
	'minecraft:particle_motion_dynamic': { linear_acceleration: [0, 1, 0], linear_drag_coefficient: 2 },
	'minecraft:particle_lifetime_expression': { max_lifetime: 8 },
	'minecraft:particle_appearance_billboard': BILLBOARD(0.08),
	'minecraft:particle_appearance_tinting': { color: [1, 0.5, 0.9, 1] },
}, 'textures/particle/oxygen_probe');

// ---------------------------------------------------------------- follow-ups (e17)

/**
 * Children that leave a mark in a temp when they exist (temps are global): their emitter's creation sets
 * t.<tag>_<kind>e, their particles set t.<tag>_<kind>p. e13/e14 couldn't find some children anywhere near the entity.
 */
const MARKED: Record<string, { phase: EventPhase; space: EventSpace }> = { x1: { phase: 'creation', space: 'local' }, x2: { phase: 'timeline', space: 'world' } };
for (const [tag, m] of Object.entries(MARKED)) {
	for (const [k, kid] of Object.entries(KIDS)) {
		const json = structuredClone(RIG_EFFECTS[`kid_${k}`]);
		json.particle_effect.components['minecraft:emitter_initialization'] = { creation_expression: `t.${tag}_${k}e = 1;` };
		json.particle_effect.components['minecraft:particle_initialization'] = { per_update_expression: `t.${tag}_${k}p = 1;` };
		RIG_EFFECTS[`kidm_${tag}_${k}`] = json;
	}
	const parent = eventParent(m.phase, m.space);
	parent.particle_effect.events = { kids: { sequence: Object.entries(KIDS).map(([k, kid]) => ({ particle_effect: { effect: `oxygen:rig_kidm_${tag}_${k}`, type: kid.type } })) } };
	RIG_EFFECTS[`evm_${tag}`] = parent;
	// a square per kind of child: 0.3 = it exists (its emitter or particle ran), 0.1 = no sign of it
	for (const k of Object.keys(KIDS)) RIG_EFFECTS[`seen_${tag}_${k}`] = flag(`((t.${tag}_${k}e ?? 0) + (t.${tag}_${k}p ?? 0)) > 0 ? 0.3 : 0.1`, {}, [...KIDS[k as keyof typeof KIDS].colour]);
}
// big children (1.2, 0.9, 0.6 blocks across), so one at the entity's feet shows round its body (e18)
for (const [k, size] of [['e', 0.6], ['p', 0.45], ['v', 0.3]] as const) {
	const json = structuredClone(RIG_EFFECTS[`kid_${k}`]);
	json.particle_effect.components['minecraft:particle_appearance_billboard'] = BILLBOARD(size);
	RIG_EFFECTS[`kidbig_${k}`] = json;
}
for (const [tag, ph, sp] of [['big_cl', 'creation', 'local'], ['big_tw', 'timeline', 'world'], ['big_tl', 'timeline', 'local']] as const) {
	const parent = eventParent(ph, sp);
	parent.particle_effect.events = { kids: { sequence: (['e', 'p', 'v'] as const).map((k) => ({ particle_effect: { effect: `oxygen:rig_kidbig_${k}`, type: KIDS[k].type } })) } };
	RIG_EFFECTS[`ev_${tag}`] = parent;
}

/** 0.3 = the expression ran to the end; 0.1 = it stopped before v.ok = 1 (aborted); 0.2 = it never ran */
const okFlag = (update: string) => flag('(v.ok ?? -1) == 1 ? 0.3 : ((v.ok ?? -1) == 0 ? 0.1 : 0.2)', { 'minecraft:emitter_initialization': { per_update_expression: `v.ok = 0; ${update} v.ok = 1;` } });
RIG_EFFECTS.ok_bone_struct = okFlag("v.o = q.bone_origin('root');");
RIG_EFFECTS.ok_bone_number = okFlag("v.y = q.bone_origin('root') + 1;");
RIG_EFFECTS.ok_life = okFlag('v.l = q.life_time;');
// 0.3 = reads 0, 0.1 = something else, hidden = the read aborts the field
RIG_EFFECTS.zero_life = flag('q.life_time == 0 ? 0.3 : 0.1');
RIG_EFFECTS.zero_delta = flag('q.delta_time == 0 ? 0.3 : 0.1');

// ---------------------------------------------------------------- loops, bones, clocks, properties, block tags, planes (e19–e24)

/** 0.3 = `cond` holds; 0.15 = it doesn't; 0.05 = the temp `t.<name>` was never written (the entity's Molang didn't run or was dropped) */
const tflag = (name: string, cond: string) => flag(`(${cond}) ? 0.3 : (((t.${name} ?? -999) == -999) ? 0.05 : 0.15)`);
for (const [name, cond] of [
	['b1', 't.e20_b1 == 8'],
	['b2', 't.e20_b2 == 8'],
	['b3', 't.e20_b3 == 10'],
	['b4', 't.e20_b4 == 45'],
	['b5', 't.e20_b5 == 24'],
	['b6', 't.e20_b6 == 0'],
	['b7', 't.e20_b7 == 8'],
	['k1', 't.e23_k1 == 1'],
	['k2', 't.e23_k2 == 1'],
	['k3', 't.e23_k3 == 1'],
	['k4', 't.e23_k4 == 1'],
	['k5', 't.e23_k5 == 1'],
	['k6', 't.e23_k6 == 1'],
	['k7', 't.e23_k7 == 0'],
	['w1a', 't.e23_w1a == 1'],
	['w1b', 't.e23_w1b == 1'],
	['w1c', 't.e23_w1c == 1'],
	['d1', 't.e22_d1 > 1'],
] as const) {
	const tn = cond.split(' ')[0].slice(2);
	RIG_EFFECTS[`tf_${name}`] = tflag(tn, cond);
}
// emitter loops (e19): a world-space dot every 0.1 s at (emitter age, loop count, emitter random) in the emitter's frame
RIG_EFFECTS.loopmark = effect({
	'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 200 },
	'minecraft:emitter_lifetime_looping': { active_time: 1, sleep_time: 0.5 },
	'minecraft:emitter_initialization': { creation_expression: 'v.cnt = (v.cnt ?? 0) + 1;' },
	'minecraft:emitter_shape_point': { offset: ['v.emitter_age', '0.4 * v.cnt', 'v.emitter_random_1'] },
	'minecraft:particle_lifetime_expression': { max_lifetime: 8 },
	'minecraft:particle_appearance_billboard': BILLBOARD(0.05),
	'minecraft:particle_appearance_tinting': { color: [1, 0.5, 0.1, 1] },
}, 'textures/particle/oxygen_probe');
// clocks read from temps the entity writes every frame (e21): X = t.e21_lt (q.life_time), Y = t.e21_at (q.anim_time), Z = q.delta_time × 20
readout('eclock', '', ['t.e21_lt ?? -0.25', 't.e21_at ?? -0.25', '(t.e21_dt ?? -0.0125) * 20'], 1);
// a per-frame sum of q.delta_time in the entity (X) against v.emitter_age (Y)
readout('esum', '', ['t.e21_sum ?? -0.25', 'v.emitter_age', '0'], 1);
// property types and one without client_sync (e22): 0.3 = the expected value
RIG_EFFECTS.prop_ns = flag("(q.property('oxygen:ns') == 4) ? 0.3 : 0.1");
RIG_EFFECTS.prop_f = flag("(q.property('oxygen:f') == 2.5) ? 0.3 : 0.1");
RIG_EFFECTS.prop_b = flag("(q.property('oxygen:b') == 1) ? 0.3 : 0.1");
RIG_EFFECTS.prop_e = flag("(q.property('oxygen:e') == 'green') ? 0.3 : 0.1");
// camera queries in an entity's particles: size grows with the angle (compare the front and frontleft views)
RIG_EFFECTS.camrot = flag('0.08 + math.abs(q.camera_rotation(1)) / 180 * 0.5');
RIG_EFFECTS.camto = flag('0.08 + math.abs(q.rotation_to_camera(1)) / 180 * 0.5');
// planes on a turned entity (e24): particles shot along the emitter's X at 1 block/s, a kill plane at world x = -1 from the emitter
RIG_EFFECTS.killx = effect({
	'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 },
	'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
	'minecraft:emitter_shape_point': { direction: [1, 0, 0] },
	'minecraft:particle_initial_speed': 1,
	'minecraft:particle_motion_dynamic': {},
	'minecraft:particle_lifetime_expression': { max_lifetime: 3 },
	'minecraft:particle_kill_plane': [-1, 0, 0, -1],
	'minecraft:particle_appearance_billboard': BILLBOARD(0.05),
	'minecraft:particle_appearance_tinting': { color: [1, 0.2, 0.2, 1] },
}, 'textures/particle/oxygen_probe');
for (const mode of ['xy', 'xz', 'yz']) {
	RIG_EFFECTS[`plane_${mode}`] = effect({
		'minecraft:emitter_local_space': { position: true, rotation: true },
		'minecraft:emitter_rate_instant': { num_particles: 1 },
		'minecraft:emitter_lifetime_once': { active_time: 1 },
		'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
		'minecraft:particle_appearance_billboard': { size: [0.3, 0.15], facing_camera_mode: `emitter_transform_${mode}`, uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } },
		'minecraft:particle_appearance_tinting': { color: mode === 'xy' ? [1, 0.3, 0.3, 1] : mode === 'xz' ? [0.3, 1, 0.3, 1] : [0.3, 0.5, 1, 1] },
	}, 'textures/particle/oxygen_probe');
}

// bone query values the entity writes into temps every frame (e25), drawn as bars of 0.25 block per unit
for (const [name, temps] of [
	['bq_o', ['e25_ox', 'e25_oy', 'e25_oz']],
	['bq_min', ['e25_ax', 'e25_ay', 'e25_az']],
	['bq_max', ['e25_bx', 'e25_by', 'e25_bz']],
	['bq_r', ['e25_rx', 'e25_ry', 'e25_rz']],
	['bq_ash', ['e25_hx', 'e25_hy', 'e25_hz']],
	['bq_root', ['e25_tx', 'e25_ty', 'e25_tz']],
] as const) readout(name, '', temps.map((t) => `t.${t} ?? -1`) as [string, string, string], 0.25);
for (const [name, temps] of [
	['bq_z', ['e26_zx', 'e26_zy', 'e26_zz']],
	['bq_amin', ['e26_mx', 'e26_my', 'e26_mz']],
	['bq_amax', ['e26_nx', 'e26_ny', 'e26_nz']],
	['bq_rmin', ['e26_rx', 'e26_ry', 'e26_rz']],
	['bq_rmax', ['e26_sx', 'e26_sy', 'e26_sz']],
] as const) readout(name, '', temps.map((t) => `t.${t} ?? -0.25`) as [string, string, string], name === 'bq_z' ? 0.25 : 2);
const boneScript = (q: string, bone: string, prefix: string, member = '') =>
	`v.o = ${q}('${bone}'); t.${prefix}x = v.o${member}.x ?? -4; t.${prefix}y = v.o${member}.y ?? -4; t.${prefix}z = v.o${member}.z ?? -4; return 0;`;

// ---------------------------------------------------------------- query contexts (e28, e29)

/**
 * A square that says what a temp the entity's animation wrote holds: 0.05 = never written (the key didn't run or
 * was dropped at load), then one size per expected value, 0.1 for anything else
 */
function whichFlag(temp: string, sizes: [number, number][]): Json {
	let expr = '0.1';
	for (const [value, size] of [...sizes].reverse()) expr = `((t.${temp} ?? -999) == ${value}) ? ${size} : (${expr})`;
	return flag(`((t.${temp} ?? -999) == -999) ? 0.05 : (${expr})`);
}
// world generation and tag queries in an attached effect: 1.0 (the default size) = dropped at load
const wg: [string, string][] = [
	['h', 'q.heightmap(0, 0) > -1000'],
	['a', 'q.above_top_solid(0, 0) > -1000'],
	['n', 'q.noise(1, 1) > -1000'],
	['b', "q.has_biome_tag('overworld') >= 0"],
	['t', "q.any_tag('stone') >= 0"],
];
for (const [k, cond] of wg) {
	RIG_EFFECTS[`wg_${k}`] = flag(`(${cond}) ? 0.3 : 0.1`);
	// the same in the entity's animation, written to a temp: 0.3 = it ran and the condition held
	RIG_EFFECTS[`wge_${k}`] = whichFlag(`e28_${k}`, [[1, 0.3], [0, 0.15]]);
}
RIG_EFFECTS.wge_c = whichFlag('e28_c', [[1, 0.3]]);
// bone queries by rig kind (e29): the main geometry's qbox is unturned, the alt geometry's is turned 30°, altbone 15°
const boneSizes: [number, number][] = [[0, 0.3], [30, 0.2], [15, 0.25], [-1, 0.1]];
RIG_EFFECTS.bk_q = flag('((v.o.z ?? -1) == 0) ? 0.3 : (((v.o.z ?? -1) == 30) ? 0.2 : 0.1)', { 'minecraft:emitter_initialization': { per_update_expression: "v.o = q.bone_rotation('qbox');" } });
RIG_EFFECTS.bk_a = flag('((v.o.z ?? -1) == 15) ? 0.25 : 0.1', { 'minecraft:emitter_initialization': { per_update_expression: "v.o = q.bone_rotation('altbone');" } });
RIG_EFFECTS.bk_pre = flag('((v.o.z ?? -1) == 0) ? 0.3 : (((v.o.z ?? -1) == 30) ? 0.2 : 0.1)');
for (const kind of Object.keys(RIG_KINDS)) {
	RIG_EFFECTS[`bke_q_${kind}`] = whichFlag(`e29_${kind}_q`, boneSizes);
	RIG_EFFECTS[`bke_a_${kind}`] = whichFlag(`e29_${kind}_a`, boneSizes);
}

// ---------------------------------------------------------------- exact readouts (e30)

/**
 * A row of 21 squares that spells a temp in binary: round(value × 16) as 20-bit two's complement, bit 0 at the
 * emitter and higher bits along the emitter's X (big square = 1, small = 0); the 21st square is big when the temp
 * was written at all. Rows stack upwards by `row` (set through pre_effect_script).
 */
function bitsEffect(temp: string): Json {
	return effect({
		'minecraft:emitter_local_space': { position: true, rotation: true },
		'minecraft:emitter_rate_instant': { num_particles: 21 },
		'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
		'minecraft:emitter_initialization': {
			per_update_expression: `v.i = 0; v.rc = 0; v.set = ((t.${temp} ?? -999999) == -999999) ? 0 : 1; v.val = math.round((t.${temp} ?? 0) * 16); v.u = (v.val < 0) ? v.val + 1048576 : v.val;`,
		},
		'minecraft:particle_initialization': {
			per_update_expression: 'v.k = v.i; v.i = v.i + 1;',
			per_render_expression: 'v.rk = v.rc; v.rc = v.rc + 1;',
		},
		'minecraft:particle_motion_parametric': { relative_position: ['v.k * 0.12 + ((v.k > 19.5) ? 0.12 : 0)', '0.3 + (v.row ?? 0) * 0.16', 0] },
		'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
		'minecraft:particle_appearance_billboard': BILLBOARD('((v.rk > 19.5) ? v.set : math.mod(math.floor(v.u / math.pow(2, v.rk)), 2)) > 0.5 ? 0.05 : 0.012'),
		'minecraft:particle_appearance_tinting': { color: ['(v.rk > 19.5) ? 0.2 : 1', '(v.rk > 19.5) ? 1 : 1', '(v.rk > 19.5) ? 0.2 : 1', 1] },
	}, 'textures/particle/oxygen_probe');
}

/** What e30 reads, row by row (bottom row first): [name, struct expression, member] */
export const BIT_ROWS: [string, string, string][] = [
	['oqx', "q.bone_origin('qbox')", 'x'], ['oqy', "q.bone_origin('qbox')", 'y'], ['oqz', "q.bone_origin('qbox')", 'z'],
	['ozx', "q.bone_origin('qz')", 'x'], ['ozy', "q.bone_origin('qz')", 'y'], ['ozz', "q.bone_origin('qz')", 'z'],
	['orx', "q.bone_origin('root')", 'x'], ['ory', "q.bone_origin('root')", 'y'], ['orz', "q.bone_origin('root')", 'z'],
	['ohx', "q.bone_origin('ash')", 'x'], ['ohy', "q.bone_origin('ash')", 'y'], ['ohz', "q.bone_origin('ash')", 'z'],
	['anx', "q.bone_aabb('qbox')", 'min.x'], ['any', "q.bone_aabb('qbox')", 'min.y'], ['anz', "q.bone_aabb('qbox')", 'min.z'],
	['axx', "q.bone_aabb('qbox')", 'max.x'], ['axy', "q.bone_aabb('qbox')", 'max.y'], ['axz', "q.bone_aabb('qbox')", 'max.z'],
	['ttx', "q.bone_orientation_trs('brx')", 't.x'], ['tty', "q.bone_orientation_trs('brx')", 't.y'], ['ttz', "q.bone_orientation_trs('brx')", 't.z'],
	['trx', "q.bone_orientation_trs('brx')", 'r.x'], ['try', "q.bone_orientation_trs('brx')", 'r.y'], ['trz', "q.bone_orientation_trs('brx')", 'r.z'],
];
for (const prefix of ['a', 'b']) for (const [name] of BIT_ROWS) RIG_EFFECTS[`bits_${prefix}_${name}`] = bitsEffect(`e30${prefix}_${name}`);

/** The entity's animation writes every BIT_ROWS value to `t.e30<prefix>_<name>`, every frame (a bone channel) */
function bitScript(prefix: string): string {
	const out: string[] = [];
	let last = '';
	for (const [name, struct, member] of BIT_ROWS) {
		if (struct !== last) out.push(`v.s = ${struct};`);
		last = struct;
		out.push(`t.e30${prefix}_${name} = v.s.${member};`);
	}
	return `${out.join(' ')} return 0;`;
}
const bitFire = (prefix: string): Fire[] => BIT_ROWS.map(([name], row) => ({ effect: `bits_${prefix}_${name}`, pre_effect_script: `v.row = ${row};` }));
RIG_EFFECTS.bk_q3 = whichFlag('e31_q3_q', [[0, 0.3], [30, 0.2], [15, 0.25], [-1, 0.1]]);
RIG_EFFECTS.bk_q3a = whichFlag('e31_q3_a', [[0, 0.3], [30, 0.2], [15, 0.25], [-1, 0.1]]);

/** Stone east and west of the block the rig stands in, and iron (tag metal) south of it */
const TAG_BLOCKS = [
	{ dx: 1, dy: 0, dz: 0, block: 'stone' },
	{ dx: -1, dy: 0, dz: 0, block: 'stone' },
	{ dx: 0, dy: 0, dz: 1, block: 'iron_block' },
];

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
	const main = rigMainGeometry();
	const alt = structuredClone(main['minecraft:geometry'][0]);
	alt.description.identifier = 'geometry.oxygen_rig_alt';
	for (const b of alt.bones) {
		// no locators in the alt geometry: particle locators must exist in one geometry only
		delete b.locators;
		if (b.name === 'qbox') b.rotation = [0, 0, 30];
	}
	alt.bones.push({ name: 'altbone', parent: 'root', pivot: [0, 20, 0], rotation: [0, 0, 15], cubes: [{ origin: [-1, 19, -1], size: [2, 2, 2], uv: [0, 32] }] });
	return { ...main, 'minecraft:geometry': [...main['minecraft:geometry'], alt] };
}

function rigMainGeometry(): Json {
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
					// for the bone queries (e15): a plain box beside the body, and a turned bone with a turned cube
					{ name: 'qbox', parent: 'root', pivot: [4, 8, 0], cubes: [{ origin: [3, 6, -1], size: [2, 4, 2], uv: [0, 32] }] },
					// a pivot off every axis (e26)
					{ name: 'qz', parent: 'root', pivot: [2, 30, 5], cubes: [{ origin: [1, 29, 4], size: [2, 2, 2], uv: [0, 32] }] },
					{
						name: 'qrot',
						parent: 'root',
						pivot: [-4, 8, 0],
						rotation: [0, 0, 45],
						cubes: [
							{ origin: [-5, 6, -1], size: [2, 4, 2], uv: [0, 32] },
							{ origin: [-5, 11, -1], size: [2, 4, 2], pivot: [-4, 13, 0], rotation: [0, 0, 90], uv: [0, 32] },
						],
					},
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
	{
		id: 'e13',
		title: 'Where event children appear on an entity',
		question:
			'On an entity (no locator, yaw 0: emitter X west, Y up, Z north), where does each kind of child of a particle event appear, for creation, timeline and expiration events, in each emitter space? Does particle_with_velocity take the particle’s velocity? (For /particle effects see t53–t58.)',
		assumption:
			'Oxygen: on an entity every child appears where the particle is when its event fires (creation: 1 block along X; timeline: 0.5 up from there; expiration: 1 up), in every emitter space, and particle_with_velocity keeps rising at 1 block/s. Another reading is that children of an emitter using local position or rotation appear at the emitter instead. The u probes compare bind_to_actor: false.',
		wait: 2,
		spacing: 5,
		views: ['above', 'frontleft'],
		probes: [
			...eventProbes(),
			{ id: 'uc', reads: 'bind_to_actor false, creation event, world space', fire: [{ effect: 'ev_creation_world', bind_to_actor: false }, at()] },
			{ id: 'ut', reads: 'bind_to_actor false, timeline event, world space', fire: [{ effect: 'ev_timeline_world', bind_to_actor: false }, at()] },
			{ id: 'ue', reads: 'bind_to_actor false, expiration event, world space', fire: [{ effect: 'ev_expiration_world', bind_to_actor: false }, at()] },
		],
	},
	{
		id: 'e14',
		title: 'Where event children appear on a locator',
		question: 'As e13, on locator up (1.5 blocks up; emitter X east, Y down, Z north), and with the entity turned (yaw 90).',
		assumption: 'As e13: at the particle (on the locator the grey particle moves down, since the frame’s Y points down).',
		wait: 2,
		spacing: 5,
		views: ['above', 'frontleft'],
		probes: [
			...eventProbes('up'),
			{ id: 'yl', reads: 'yaw 90, timeline event, local space', yaw: 90, fire: [{ effect: 'ev_timeline_local', locator: 'up' }, at('up')] },
			{ id: 'yw', reads: 'yaw 90, timeline event, world space', yaw: 90, fire: [{ effect: 'ev_timeline_world', locator: 'up' }, at('up')] },
		],
	},
	{
		id: 'e15',
		title: 'Bone queries',
		question:
			'What do q.bone_origin, q.bone_rotation and q.bone_aabb give an entity’s effects: assigned to a variable (v.o = q.bone_origin(…); then v.o.x), in pre_effect_script, or read straight off the call? Each readout is three bars from the feet along the emitter’s X (red, west), Y (green, up) and Z (blue, north): positions 1 block per 16 model units, rotations 1 block per 90°.',
		assumption:
			'Oxygen: the values the geometry file has (Mojang: “the initial (from the .geo)” pivot and rotation), in model units, with no parents or animations applied; the aabb is the box round the bone’s own cubes in model units (a turned cube by its turned corners, the bone’s own turn left out). qbox: origin (4, 8, 0), aabb (3, 6, -1)–(5, 10, 1); qrot: rotation (0, 0, 45), aabb (-6, 6, -1)–(-2, 14, 1). A missing bone reads 0 and is reported. Bone names are case-insensitive.',
		wait: 2,
		spacing: 4,
		views: ['above', 'frontleft'],
		probes: [
			{ id: 'r1', reads: "q.bone_origin('qbox'): 0.25 X, 0.5 Y, 0 Z?", fire: bars('bo_qbox') },
			{ id: 'r2', reads: "q.bone_rotation('qrot'): 0.5 Z (45°)?", fire: bars('br_qrot') },
			{ id: 'r3', reads: "q.bone_aabb('qbox').min: 0.19 X, 0.38 Y, -0.06 Z?", fire: bars('bmin_qbox') },
			{ id: 'r4', reads: "q.bone_aabb('qbox').max: 0.31 X, 0.63 Y, 0.06 Z?", fire: bars('bmax_qbox') },
			{ id: 'r5', reads: "q.bone_aabb('qrot').min: -0.38 X, 0.38 Y, -0.06 Z without the bone's 45° turn; different with it", fire: bars('bmin_qrot') },
			{ id: 'r6', reads: "q.bone_aabb('qrot').max: -0.13 X, 0.88 Y, 0.06 Z without the bone's turn", fire: bars('bmax_qrot') },
			{ id: 'r7', reads: "q.bone_aabb('root').min, the body and nose: -0.19 X, 0 Y, -0.31 Z?", fire: bars('bmin_root') },
			{ id: 'r8', reads: "q.bone_origin('brx'), a bone the geometry turns: 1.5 Y (its pivot)?", fire: bars('bo_brx') },
			{ id: 'r9', reads: "q.bone_origin('chain'), a child of a turned bone: 0.5 X, 1.5 Y (its own pivot), or moved by its parent?", fire: bars('bo_chain') },
			{ id: 'r10', reads: "q.bone_origin('ash'), a bone an animation moves 8 units +X: 1.5 Y only (initial), or 0.5 X as well?", fire: bars('bo_ash') },
			{ id: 'r11', reads: "q.bone_rotation('arx'), a bone an animation turns 90° about X: 0 (initial), or 1 block X?", fire: bars('br_arx') },
			{ id: 'r12', reads: "q.bone_origin('nope'), no such bone: bars of length 0 (reads 0), or all dots on the feet (aborted)? Check the content log too.", fire: bars('bo_nope') },
			{ id: 'r13', reads: "q.bone_origin('QBOX'): are bone names case-insensitive (same as r1)?", fire: bars('bo_upper') },
			{ id: 'r14', reads: "pre_effect_script v.o = q.bone_origin('qbox'); then the bars read v.o (same as r1, or dots on the feet)", fire: bars('bo_pre', { pre_effect_script: "v.o = q.bone_origin('qbox');" }) },
			{ id: 'r15', reads: "q.bone_origin('qbox').y straight off the call: 0.3 square = works, 0.1 = reads something else, 1.0 = dropped at load", fire: [{ effect: 'bo_direct' }] },
		],
	},
	{
		id: 'e16',
		title: 'Block tags, clocks and dying',
		question:
			'Can an entity’s effects read q.relative_block_has_any_tag, and how are its offsets rounded? What do q.life_time and q.delta_time read in them? Does q.is_alive turn 0 while the entity dies, before it is removed?',
		assumption:
			'Stone stands east and west of each block-tag rig, iron (tag metal) south of it. Squares: 0.3 = true, 0.1 = false, 0.2 = the variable was never set, 1.0 = the field was dropped at load. The query may need block access that particle Molang doesn’t have. Oxygen’s preview gives no value for it or q.life_time yet, and has no death state.',
		wait: 4,
		spacing: 4,
		views: ['above', 'frontleft'],
		probes: [
			{ id: 'k0', reads: 'where the rig stands in its block: red (x) and blue (z) bars 0.5 long = the centre', fire: bars('frac') },
			{ id: 'k1', reads: "(1, 0, 0, 'stone'), stone east: 0.3 if offsets are world axes", blocks: TAG_BLOCKS, fire: [{ effect: 'rb_e', locator: 'up' }] },
			{ id: 'k2', reads: "(0, 0, 1, 'metal'), iron south: 0.3", blocks: TAG_BLOCKS, fire: [{ effect: 'rb_s', locator: 'up' }] },
			{ id: 'k3', reads: "yaw 90, (0, 0, 1, 'metal'): 0.3 = world axes; 0.1 = turned with the entity", yaw: 90, blocks: TAG_BLOCKS, fire: [{ effect: 'rb_s', locator: 'up' }] },
			{ id: 'k4', reads: "(0.6, 0, 0, 'stone'): 0.3 = floor(position + offset); 0.1 = the offset truncated or floored first", blocks: TAG_BLOCKS, fire: [{ effect: 'rb_e06', locator: 'up' }] },
			{ id: 'k5', reads: "(-0.6, 0, 0, 'stone'): 0.3 = floor(position + offset) or floor(offset); 0.1 = truncated", blocks: TAG_BLOCKS, fire: [{ effect: 'rb_w06', locator: 'up' }] },
			{ id: 'k6', reads: "(-1.4, 0, 0, 'stone'): 0.3 = floor(position + offset) or truncated; 0.1 = floor(offset)", blocks: TAG_BLOCKS, fire: [{ effect: 'rb_w14', locator: 'up' }] },
			{ id: 'k7', reads: "(0, 0, -1, 'stone'), nothing north: 0.1", blocks: TAG_BLOCKS, fire: [{ effect: 'rb_none', locator: 'up' }] },
			{ id: 'k8', reads: "pre_effect_script v.k = (1, 0, 0, 'stone')", blocks: TAG_BLOCKS, fire: [{ effect: 'rb_var', locator: 'up', pre_effect_script: "v.k = q.relative_block_has_any_tag(1, 0, 0, 'stone');" }] },
			{ id: 'k9', reads: "emitter per_update v.e = (1, 0, 0, 'stone')", blocks: TAG_BLOCKS, fire: [{ effect: 'rb_update', locator: 'up' }] },
			{ id: 'c1', reads: 'q.life_time (green, 1 block a second) against v.emitter_age (red); q.delta_time × 20 (blue): 1 block = a game tick, about 0.33 = a 60 fps frame', fire: bars('clock') },
			{
				id: 'c2',
				reads: 'the same, read once in pre_effect_script (green q.life_time, blue q.delta_time × 20; -0.25 = unset)',
				fire: bars('clock_pre', { pre_effect_script: 'v.l = q.life_time; v.d = q.delta_time * 20;' }),
			},
			{
				id: 'd1',
				reads: 'killed at 1.5 s: do new dots start 0.5 block along X (q.is_alive 0) during the death animation, or does the stream just stop?',
				components: { 'minecraft:damage_sensor': { triggers: [{ cause: 'all', deals_damage: 'yes' }] } },
				later: [{ after: 1.5, command: 'kill @s' }],
				fire: [{ effect: 'alive' }],
			},
		],
	},
	{
		id: 'e17',
		title: 'Follow-ups: missing children, failed queries',
		question:
			'Do the children e13/e14 didn’t show exist at all? Does a bone query that finds no bone (e15) abort the expression? Do q.life_time and q.delta_time read 0 or abort (e16)?',
		assumption:
			'x probes: the parent on locator up and three squares (red emitter child on up, blue particle child on off_x, yellow particle_with_velocity child on off_z): 0.3 = that child exists, 0.1 = no sign of it. ok probes: 0.3 = the expression ran on, 0.1 = it stopped at the query. zero probes: 0.3 = reads 0, 0.1 = reads something else, hidden = aborts.',
		wait: 2,
		spacing: 4,
		views: ['frontleft'],
		probes: [
			...Object.keys(MARKED).map((tag) => ({
				id: tag,
				reads: `${MARKED[tag].phase} event, ${MARKED[tag].space} space: which children exist?`,
				fire: [{ effect: `evm_${tag}`, locator: 'up' }, { effect: `seen_${tag}_e`, locator: 'up' }, { effect: `seen_${tag}_p`, locator: 'off_x' }, { effect: `seen_${tag}_v`, locator: 'off_z' }],
			})),
			{ id: 'b1', reads: "v.o = q.bone_origin('root'); in the emitter update: does the expression go on?", fire: [{ effect: 'ok_bone_struct', locator: 'up' }] },
			{ id: 'b2', reads: "v.y = q.bone_origin('root') + 1; (used as a number): does the expression go on?", fire: [{ effect: 'ok_bone_number', locator: 'up' }] },
			{ id: 'c3', reads: 'v.l = q.life_time; in the emitter update: does the expression go on?', fire: [{ effect: 'ok_life', locator: 'up' }] },
			{ id: 'c4', reads: 'size q.life_time == 0: 0.3 = reads 0', fire: [{ effect: 'zero_life', locator: 'up' }] },
			{ id: 'c5', reads: 'size q.delta_time == 0: 0.3 = reads 0', fire: [{ effect: 'zero_delta', locator: 'up' }] },
		],
	},
	{
		id: 'e18',
		title: 'Where the unseen children are',
		question: 'e17 showed the particle children (and local-space creation children) exist, but e13/e14 found none near the emitter or the particle. Are they at the entity’s feet, hidden by its body? These children are 1.2 (red emitter), 0.9 (blue particle) and 0.6 (yellow particle_with_velocity) blocks across.',
		assumption: 'To be measured. The parent is on locator up (1.5 blocks up); its particle starts 1 block east of it.',
		wait: 2,
		spacing: 6,
		probes: [
			{ id: 'g1', reads: 'creation event, local space', fire: [{ effect: 'ev_big_cl', locator: 'up' }, at('up')] },
			{ id: 'g2', reads: 'timeline event, world space', fire: [{ effect: 'ev_big_tw', locator: 'up' }, at('up')] },
			{ id: 'g3', reads: 'timeline event, local space', fire: [{ effect: 'ev_big_tl', locator: 'up' }, at('up')] },
			{ id: 'g4', reads: 'timeline event, world space, no locator', fire: [{ effect: 'ev_big_tw' }, at()] },
		],
	},
	{
		id: 'e19',
		title: 'What a loop resets on an entity',
		question: 'On an entity, a looping emitter (1 s on, 0.5 s off) leaves world-space dots at (emitter age, 0.4 × a creation counter, emitter random 1) in its frame. Does each loop restart the age, re-run creation with fresh variables, and re-roll the random?',
		assumption: 'Each loop is a new emitter (t08 assumption): lines along X restart, all at the same height (the counter starts over), each at a new Z.',
		wait: 5,
		spacing: 4,
		views: ['above', 'frontleft'],
		probes: [{ id: 'p1', reads: 'the dot lines: restarting along X? stacked in height (variables kept) or one height? at different Z (random re-rolled)?', fire: [{ effect: 'loopmark' }] }],
	},
	{
		id: 'e20',
		title: 'Bone queries in the entity’s own Molang',
		question: 'Do bone queries work in the entity’s animations (timeline keys and bone channels), where they fail in its particles (e15)? Squares: 0.3 = the expected value, 0.15 = another value (-1 = no bone), 0.05 = the entity never wrote the temp.',
		assumption: 'The default geometry is queryable (creators’ notes): qbox origin (4, 8, 0), aabb max y 10, qrot rotation z 45.',
		wait: 2,
		spacing: 3,
		probes: [
			{ id: 'b1', reads: "timeline: q.bone_origin('qbox').y == 8", script: { timeline: { '0.1': "v.o = q.bone_origin('qbox'); t.e20_b1 = v.o.y ?? -1;" }, loop: 0.5 }, fire: [{ effect: 'tf_b1', locator: 'up' }] },
			{ id: 'b2', reads: 'a bone channel (every frame): the same', script: { bones: { qbox: { position: ["v.o = q.bone_origin('qbox'); t.e20_b2 = v.o.y ?? -1; return 0;", 0, 0] } } }, fire: [{ effect: 'tf_b2', locator: 'up' }] },
			{ id: 'b3', reads: "timeline: q.bone_aabb('qbox').max.y == 10", script: { timeline: { '0.1': "v.o = q.bone_aabb('qbox'); t.e20_b3 = v.o.max.y ?? -1;" }, loop: 0.5 }, fire: [{ effect: 'tf_b3', locator: 'up' }] },
			{ id: 'b4', reads: "timeline: q.bone_rotation('qrot').z == 45", script: { timeline: { '0.1': "v.o = q.bone_rotation('qrot'); t.e20_b4 = v.o.z ?? -1;" }, loop: 0.5 }, fire: [{ effect: 'tf_b4', locator: 'up' }] },
			{ id: 'b5', reads: "timeline: q.bone_origin('chain').y == 24 (its own pivot, not moved by its turned parent)", script: { timeline: { '0.1': "v.o = q.bone_origin('chain'); t.e20_b5 = v.o.y ?? -1;" }, loop: 0.5 }, fire: [{ effect: 'tf_b5', locator: 'up' }] },
			{ id: 'b6', reads: "timeline: q.bone_origin('nope').y: 0.3 = reads 0, 0.15 = -1 (the struct isn't set)", script: { timeline: { '0.1': "v.o = q.bone_origin('nope'); t.e20_b6 = v.o.y ?? -1;" }, loop: 0.5 }, fire: [{ effect: 'tf_b6', locator: 'up' }] },
			{ id: 'b7', reads: "timeline: q.bone_origin('qbox').y read straight off the call", script: { timeline: { '0.1': "t.e20_b7 = q.bone_origin('qbox').y;" }, loop: 0.5 }, fire: [{ effect: 'tf_b7', locator: 'up' }] },
		],
	},
	{
		id: 'e21',
		title: 'Clocks in the entity’s Molang',
		question: 'What do q.life_time, q.anim_time and q.delta_time read in the entity’s own animation (every frame)? Does a per-frame sum of q.delta_time keep real time?',
		assumption: 'q.life_time is the time since the animation started; q.delta_time one frame; the sum tracks real time (creators’ notes).',
		wait: 3,
		spacing: 4,
		views: ['frontleft'],
		probes: [
			{ id: 'c1', reads: 'bars: red = q.life_time, green = q.anim_time (2 s loop), blue = q.delta_time × 20 (1 block = a game tick)', script: { bones: { qbox: { position: ['t.e21_lt = q.life_time; t.e21_at = q.anim_time; t.e21_dt = q.delta_time; return 0;', 0, 0] } }, loop: 2 }, fire: bars('eclock') },
			{ id: 'c2', reads: 'bars: red = the entity’s per-frame sum of q.delta_time, green = v.emitter_age (should be equal)', script: { bones: { qbox: { position: ['t.e21_sum = (t.e21_sum ?? 0) + q.delta_time; return 0;', 0, 0] } }, loop: 100 }, fire: bars('esum') },
		],
	},
	{
		id: 'e22',
		title: 'Property types and camera queries in an entity’s particles',
		question: 'Can particles read a property without client_sync, and float, bool and enum properties? What do camera queries read in an entity’s particles? Does q.distance_from_camera work in the entity’s animation?',
		assumption: 'client_sync is needed (creators’ notes); camera queries follow the camera on an entity (Oxygen: documented behaviour).',
		wait: 2,
		spacing: 3,
		views: ['frontleft'],
		probes: [
			{ id: 'q1', reads: "q.property('oxygen:ns') == 4, no client_sync: 0.3 = readable", fire: [{ effect: 'prop_ns', locator: 'up' }] },
			{ id: 'q2', reads: 'float property == 2.5', fire: [{ effect: 'prop_f', locator: 'up' }] },
			{ id: 'q3', reads: 'bool property true == 1', fire: [{ effect: 'prop_b', locator: 'up' }] },
			{ id: 'q4', reads: "enum property == 'green'", fire: [{ effect: 'prop_e', locator: 'up' }] },
			{ id: 'q5', reads: 'q.camera_rotation(1): size 0.08 + |angle| / 360 (compare views)', fire: [{ effect: 'camrot', locator: 'up' }] },
			{ id: 'q6', reads: 'q.rotation_to_camera(1): the same', fire: [{ effect: 'camto', locator: 'up' }] },
			{ id: 'q7', reads: 'q.distance_from_camera in the entity’s timeline > 1', script: { timeline: { '0.1': 't.e22_d1 = q.distance_from_camera;' }, loop: 0.5 }, fire: [{ effect: 'tf_d1', locator: 'up' }] },
		],
	},
	{
		id: 'e23',
		title: 'Block tags and world queries in the entity’s own Molang',
		question: 'Does q.relative_block_has_any_tag work in an entity’s timeline, with world-aligned, rounded offsets from its feet? Do the tool tags cover stone? Do q.above_top_solid and q.heightmap load in entity Molang, and does a failing key take other keys with it?',
		assumption: 'Stone east and west, iron (metal) south. Works, world-aligned (creators’ notes, measured on the player); above_top_solid fails.',
		wait: 2,
		spacing: 4,
		probes: [
			{ id: 'k1', reads: "(1, 0, 0, 'stone') == 1", blocks: TAG_BLOCKS, script: { timeline: { '0.1': "t.e23_k1 = q.relative_block_has_any_tag(1, 0, 0, 'stone');" }, loop: 0.5 }, fire: [{ effect: 'tf_k1', locator: 'up' }] },
			{ id: 'k2', reads: "yaw 90, (0, 0, 1, 'metal') == 1 → world-aligned", yaw: 90, blocks: TAG_BLOCKS, script: { timeline: { '0.1': "t.e23_k2 = q.relative_block_has_any_tag(0, 0, 1, 'metal');" }, loop: 0.5 }, fire: [{ effect: 'tf_k2', locator: 'up' }] },
			{ id: 'k3', reads: "(0.6, 0, 0, 'stone') == 1 → floor(position + offset)", blocks: TAG_BLOCKS, script: { timeline: { '0.1': "t.e23_k3 = q.relative_block_has_any_tag(0.6, 0, 0, 'stone');" }, loop: 0.5 }, fire: [{ effect: 'tf_k3', locator: 'up' }] },
			{ id: 'k4', reads: "(-0.6, 0, 0, 'stone') == 1", blocks: TAG_BLOCKS, script: { timeline: { '0.1': "t.e23_k4 = q.relative_block_has_any_tag(-0.6, 0, 0, 'stone');" }, loop: 0.5 }, fire: [{ effect: 'tf_k4', locator: 'up' }] },
			{ id: 'k5', reads: "(-1.4, 0, 0, 'stone') == 1", blocks: TAG_BLOCKS, script: { timeline: { '0.1': "t.e23_k5 = q.relative_block_has_any_tag(-1.4, 0, 0, 'stone');" }, loop: 0.5 }, fire: [{ effect: 'tf_k5', locator: 'up' }] },
			{ id: 'k6', reads: "stone has 'minecraft:is_pickaxe_item_destructible'", blocks: TAG_BLOCKS, script: { timeline: { '0.1': "t.e23_k6 = q.relative_block_has_any_tag(1, 0, 0, 'minecraft:is_pickaxe_item_destructible');" }, loop: 0.5 }, fire: [{ effect: 'tf_k6', locator: 'up' }] },
			{ id: 'k7', reads: 'air above has no tool tag (== 0)', blocks: TAG_BLOCKS, script: { timeline: { '0.1': "t.e23_k7 = q.relative_block_has_any_tag(0, 1, 0, 'minecraft:is_pickaxe_item_destructible', 'minecraft:is_shovel_item_destructible');" }, loop: 0.5 }, fire: [{ effect: 'tf_k7', locator: 'up' }] },
			{
				id: 'w1',
				reads: 'three squares (left a, middle b, right c): a = the key with q.above_top_solid ran up to it, b = past it, c = another key ran',
				script: { timeline: { '0.1': 't.e23_w1a = 1; v.h = q.above_top_solid(0, 0); t.e23_w1b = 1;', '0.2': 't.e23_w1c = 1;' }, loop: 0.5 },
				fire: [{ effect: 'tf_w1a', locator: 'off_x' }, { effect: 'tf_w1b', locator: 'up' }, { effect: 'tf_w1c', locator: 'off_z' }],
			},
		],
	},
	{
		id: 'e24',
		title: 'Planes on a turned entity',
		question: 'Is a kill plane in world axes or the emitter’s on a turned entity? Do emitter_transform planes turn with it? (Red streams go along the emitter’s X at 1 block/s for 3 s; the kill plane is x = -1 from the emitter.)',
		assumption: 'The kill plane is relative to the emitter in world axes (creators’ notes); emitter_transform planes follow the emitter.',
		wait: 3,
		spacing: 5,
		views: ['above', 'frontleft'],
		probes: [
			{ id: 'k0', reads: 'yaw 0: the stream goes west (-X) and should stop after 1 block', fire: [{ effect: 'killx' }] },
			{ id: 'k1', reads: 'yaw 90: the stream goes north; 3 blocks → world axes; 1 block → the emitter’s', yaw: 90, fire: [{ effect: 'killx' }] },
			{ id: 'p0', reads: 'yaw 0, locator up: xy red, xz green, yz blue planes', fire: [{ effect: 'plane_xy', locator: 'off_x' }, { effect: 'plane_xz', locator: 'up' }, { effect: 'plane_yz', locator: 'off_z' }] },
			{ id: 'p1', reads: 'yaw 90: the same planes, turned?', yaw: 90, fire: [{ effect: 'plane_xy', locator: 'off_x' }, { effect: 'plane_xz', locator: 'up' }, { effect: 'plane_yz', locator: 'off_z' }] },
		],
	},
	{
		id: 'e25',
		title: 'Bone query values in the entity’s Molang',
		question: 'What exactly do q.bone_origin, q.bone_aabb and q.bone_rotation return in the entity’s own animation (e20 found origin and aabb are not the geometry’s pivot and box)? Bars from the feet: red X, green Y, blue Z, 0.25 block per unit (−1 = the temp was never written, −4 = the member is unset).',
		assumption: 'qbox pivot (4, 8, 0) px, cubes (3, 6, -1)–(5, 10, 1) px; qrot rotation (0, 0, 45); ash is moved 8 px +X by an animation.',
		wait: 2,
		spacing: 5,
		views: ['frontleft'],
		probes: [
			{ id: 'o1', reads: "q.bone_origin('qbox')", script: { bones: { qbox: { position: [boneScript('q.bone_origin', 'qbox', 'e25_o'), 0, 0] } } }, fire: bars('bq_o') },
			{ id: 'a1', reads: "q.bone_aabb('qbox').min", script: { bones: { qbox: { position: [boneScript('q.bone_aabb', 'qbox', 'e25_a', '.min'), 0, 0] } } }, fire: bars('bq_min') },
			{ id: 'a2', reads: "q.bone_aabb('qbox').max", script: { bones: { qbox: { position: [boneScript('q.bone_aabb', 'qbox', 'e25_b', '.max'), 0, 0] } } }, fire: bars('bq_max') },
			{ id: 'r1', reads: "q.bone_rotation('qrot') (45 → a blue bar 11 blocks long)", script: { bones: { qbox: { position: [boneScript('q.bone_rotation', 'qrot', 'e25_r'), 0, 0] } } }, fire: bars('bq_r') },
			{ id: 'h1', reads: "q.bone_origin('ash'), a bone the pose animation moves 8 px +X", script: { bones: { qbox: { position: [boneScript('q.bone_origin', 'ash', 'e25_h'), 0, 0] } } }, fire: bars('bq_ash') },
			{ id: 't1', reads: "q.bone_origin('root')", script: { bones: { qbox: { position: [boneScript('q.bone_origin', 'root', 'e25_t'), 0, 0] } } }, fire: bars('bq_root') },
		],
	},
	{
		id: 'e26',
		title: 'Bone query values, part 2',
		question: 'q.bone_origin of a bone pivoted at (2, 30, 5) px (0.25 block per unit), and q.bone_aabb of qbox and root at 2 blocks per unit (in case it is in blocks). Bars from the feet: red X, green Y, blue Z.',
		assumption: 'e25: q.bone_origin reads (x, 24 − y, ?) in pixels.',
		wait: 2,
		spacing: 5,
		probes: [
			{ id: 'z1', reads: "q.bone_origin('qz')", script: { bones: { qbox: { position: [boneScript('q.bone_origin', 'qz', 'e26_z'), 0, 0] } } }, fire: bars('bq_z') },
			{ id: 'a1', reads: "q.bone_aabb('qbox').min ×2", script: { bones: { qbox: { position: [boneScript('q.bone_aabb', 'qbox', 'e26_m', '.min'), 0, 0] } } }, fire: bars('bq_amin') },
			{ id: 'a2', reads: "q.bone_aabb('qbox').max ×2", script: { bones: { qbox: { position: [boneScript('q.bone_aabb', 'qbox', 'e26_n', '.max'), 0, 0] } } }, fire: bars('bq_amax') },
			{ id: 'a3', reads: "q.bone_aabb('root').min ×2", script: { bones: { qbox: { position: [boneScript('q.bone_aabb', 'root', 'e26_r', '.min'), 0, 0] } } }, fire: bars('bq_rmin') },
			{ id: 'a4', reads: "q.bone_aabb('root').max ×2", script: { bones: { qbox: { position: [boneScript('q.bone_aabb', 'root', 'e26_s', '.max'), 0, 0] } } }, fire: bars('bq_rmax') },
		],
	},
	{
		id: 'e28',
		title: 'World generation and tag queries on an entity',
		question:
			'Are q.heightmap, q.above_top_solid, q.noise, q.has_biome_tag and q.any_tag load errors in effects attached to an entity too (t66 measured /particle effects), and in the entity’s own animation?',
		assumption:
			'w probes (attached effect, size from the query): 1.0 = dropped at load, 0.3 = it ran. e probes (the entity’s timeline writes a temp): 0.05 = never written (the key was dropped), 0.3 = it ran and held, 0.15 = it ran and read 0. ec: a second key on the same animation as eh, 0.3 = other keys still run.',
		wait: 2,
		spacing: 3,
		probes: [
			...wg.map(([k, cond]) => ({ id: `w${k}`, reads: `attached effect: ${cond}`, fire: [{ effect: `wg_${k}`, locator: 'up' }] })),
			...wg.map(([k, cond]) => ({
				id: `e${k}`,
				reads: `the entity’s timeline: t = ${cond}`,
				script: { timeline: { '0.1': `t.e28_${k} = ${cond};`, ...(k === 'h' ? { '0.2': 't.e28_c = 1;' } : {}) }, loop: 0.5 },
				fire: [{ effect: `wge_${k}`, locator: 'up' }, ...(k === 'h' ? [{ effect: 'wge_c', locator: 'off_y' }] : [])],
			})),
		],
	},
	{
		id: 'e29',
		title: 'Bone queries and queryable_geometry',
		question:
			'Does queryable_geometry decide which geometry the bone queries read, in the entity’s animation and in its particles (where e15 found no bones)? Four rig types: rig (one geometry, no queryable_geometry), rig_qd (queryable_geometry "default"), rig_qa (a second geometry "alt", queryable_geometry "alt"), rig_q2 (the second geometry, none selected).',
		assumption:
			'Squares: 0.3 = q.bone_rotation(\'qbox\').z is 0 (the main geometry), 0.2 = 30 (the alt geometry), 0.25 = altbone found (15, only in alt), 0.1 = no bone (unset), 0.05 = the entity never wrote the temp. P = particle per_update, E = the entity’s animation, R = pre_effect_script. Creators’ notes say the default geometry is queryable when queryable_geometry is omitted.',
		wait: 2,
		spacing: 3,
		probes: (Object.keys(RIG_KINDS) as RigKind[]).flatMap((kind) => [
			{ id: `${kind}_pq`, reads: `${kind}: particle q.bone_rotation('qbox')`, rig: kind, fire: [{ effect: 'bk_q', locator: 'up' }] },
			{ id: `${kind}_pa`, reads: `${kind}: particle q.bone_rotation('altbone')`, rig: kind, fire: [{ effect: 'bk_a', locator: 'up' }] },
			{
				id: `${kind}_eq`,
				reads: `${kind}: animation q.bone_rotation('qbox')`,
				rig: kind,
				script: { timeline: { '0.1': `v.o = q.bone_rotation('qbox'); t.e29_${kind}_q = v.o.z ?? -1;` }, loop: 0.5 },
				fire: [{ effect: `bke_q_${kind}`, locator: 'up' }],
			},
			{
				id: `${kind}_ea`,
				reads: `${kind}: animation q.bone_rotation('altbone')`,
				rig: kind,
				script: { timeline: { '0.1': `v.o = q.bone_rotation('altbone'); t.e29_${kind}_a = v.o.z ?? -1;` }, loop: 0.5 },
				fire: [{ effect: `bke_a_${kind}`, locator: 'up' }],
			},
			{ id: `${kind}_r`, reads: `${kind}: pre_effect_script q.bone_rotation('qbox')`, rig: kind, fire: [{ effect: 'bk_pre', locator: 'up', pre_effect_script: "v.o = q.bone_rotation('qbox');" }] },
		]),
	},
	{
		id: 'e30',
		title: 'Bone query values, exactly',
		question:
			'Exactly what do q.bone_origin, q.bone_aabb and q.bone_orientation_trs return in the entity’s own animation? Each row spells one value (× 16, rounded) in binary; rows bottom to top: qbox origin x y z, qz origin, root origin, ash origin (moved 8 px +X by an animation), qbox aabb min, qbox aabb max, brx TRS translation, brx TRS rotation. p1 faces south (yaw 0), p2 west (yaw 90), to see whether values turn with the entity.',
		assumption: 'Geometry: qbox pivot (4, 8, 0) px, cubes (3, 6, -1)–(5, 10, 1); qz pivot (2, 30, 5); root (0, 0, 0); ash (0, 24, 0); brx pivot (0, 24, 0), rotation (90, 0, 0).',
		wait: 2,
		spacing: 8,
		probes: [
			{ id: 'p1', reads: 'yaw 0', script: { bones: { qbox: { position: [bitScript('a'), 0, 0] } } }, fire: bitFire('a') },
			{ id: 'p2', reads: 'yaw 90', yaw: 90, script: { bones: { qbox: { position: [bitScript('b'), 0, 0] } } }, fire: bitFire('b') },
		],
	},
	{
		id: 'e31',
		title: 'Two geometries listed the other way round',
		question: 'rig_q3 lists alt first and default second, with no queryable_geometry. Which geometry do the entity’s bone queries read? (e29: with default listed first, alt answered.)',
		assumption: 'Squares: 0.3 = qbox at 0° (the main geometry), 0.2 = 30° (alt); altbone: 0.25 = found (alt), 0.3 = reads 0 (not found).',
		wait: 2,
		spacing: 3,
		probes: [
			{ id: 'q', reads: "rig_q3: animation q.bone_rotation('qbox')", rig: 'rig_q3', script: { timeline: { '0.1': "v.o = q.bone_rotation('qbox'); t.e31_q3_q = v.o.z;" }, loop: 0.5 }, fire: [{ effect: 'bk_q3', locator: 'up' }] },
			{ id: 'a', reads: "rig_q3: animation q.bone_rotation('altbone')", rig: 'rig_q3', script: { timeline: { '0.1': "v.o = q.bone_rotation('altbone'); t.e31_q3_a = v.o.z;" }, loop: 0.5 }, fire: [{ effect: 'bk_q3a', locator: 'up' }] },
		],
	},
	{
		id: 'e27',
		title: 'Bone queries through q.log',
		question: 'q.log writes each value to the content log once a second (a timeline key): exact values of the bone queries, q.bone_orientation_trs and the clocks in an entity animation (1000s digit = which value).',
		assumption: 'To be read from the content log.',
		wait: 3,
		probes: [{ id: 'l1', reads: 'read the content log', script: { timeline: { '0.5': "v.o = q.bone_origin('qbox'); q.log(1000 + v.o.x); q.log(2000 + v.o.y); q.log(3000 + v.o.z); v.o = q.bone_origin('qz'); q.log(1100 + v.o.x); q.log(2100 + v.o.y); q.log(3100 + v.o.z); v.o = q.bone_origin('root'); q.log(1200 + v.o.x); q.log(2200 + v.o.y); q.log(3200 + v.o.z); v.o = q.bone_origin('ash'); q.log(1300 + v.o.x); q.log(2300 + v.o.y); q.log(3300 + v.o.z); v.o = q.bone_aabb('qbox'); q.log(4000 + v.o.min.x); q.log(5000 + v.o.min.y); q.log(6000 + v.o.min.z); q.log(7000 + v.o.max.x); q.log(8000 + v.o.max.y); q.log(9000 + v.o.max.z); v.o = q.bone_rotation('qrot'); q.log(1400 + v.o.x); q.log(2400 + v.o.y); q.log(3400 + v.o.z); v.o = q.bone_rotation('arx'); q.log(1500 + v.o.x); q.log(2500 + v.o.y); q.log(3500 + v.o.z); v.o = q.bone_orientation_trs('qz'); q.log(1600 + v.o.t.x); q.log(2600 + v.o.t.y); q.log(3600 + v.o.t.z); q.log(4100 + q.life_time); q.log(4200 + q.delta_time); q.log(4300 + q.anim_time);" }, loop: 1 }, fire: [{ effect: 'dot' }] }],
	},
	{
		id: 'e32',
		title: 'Where world-space parametric positions on an entity are measured from',
		question:
			'A world-space emitter on an entity with particle_motion_parametric relative_position: is the position measured from the world origin (e10), from the entity now, from where the emitter spawned, or from where each particle was born? Green flag = [1,2,0] (beside the rig unless measured from the world origin); red flag = the rig’s world position + [1,2,0] (beside the rig only if measured from the world origin).',
		assumption: 'From the world origin (e10): only red flags, beside each rig, and they stay put when the rig moves.',
		wait: 5,
		spacing: 7,
		probes: [
			{ id: 'g1', reads: 'still, no locator: green or red flag 1 east, 2 up?', fire: [{ effect: 'e32_g' }, { effect: 'e32_o0' }, at()] },
			{ id: 'g2', reads: 'still, locator up (the e10 case): green or red?', fire: [{ effect: 'e32_g', locator: 'up' }, { effect: 'e32_o1', locator: 'up' }, at('up')] },
			{ id: 'g3', reads: 'like aurora: the position moves with v.particle_age (the flag wobbles ±0.5 in x)', fire: [{ effect: 'e32_ga' }, { effect: 'e32_o2' }, at()] },
			{ id: 'g4', reads: 'bind_to_actor false, no locator', fire: [{ effect: 'e32_g', bind_to_actor: false }, { effect: 'e32_o3', bind_to_actor: false }, at()] },
			{ id: 'g5', reads: 'moving 3 east and back from 1 s: a stream (8 dots/s, 3 s each). Over the rig now (follows it), at its start (stays), or a trail (each dot where the rig was when it was born)?', move: { kind: 'line', radius: 3, speed: 1.5, after: 1 }, fire: [{ effect: 'e32_gs' }, { effect: 'e32_o4' }] },
			{ id: 'g6', reads: 'moving 3 east and back from 1 s: one flag spawned before it moves. Follows the rig, or stays at its start?', move: { kind: 'line', radius: 3, speed: 1.5, after: 1 }, fire: [{ effect: 'e32_g' }, { effect: 'e32_o5' }, at()] },
			{ id: 'g7', reads: 'control: the same flags spawned by /particle at the rig (not on it)', later: [{ after: 0.3, command: 'particle oxygen:rig_e32_g ~ ~ ~' }, { after: 0.3, command: 'particle oxygen:rig_e32_o6 ~ ~ ~' }] },
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
export function rigBehaviors(): Record<RigKind, Json> {
	const out = {} as Record<RigKind, Json>;
	for (const kind of Object.keys(RIG_KINDS) as RigKind[]) {
		const json = rigBehavior();
		json['minecraft:entity'].description.identifier = `oxygen:${kind}`;
		out[kind] = json;
	}
	return out;
}

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
				properties: {
					'oxygen:p': { type: 'int', range: [0, 10], default: 3, client_sync: true },
					// without client_sync (e22)
					'oxygen:ns': { type: 'int', range: [0, 10], default: 4 },
					'oxygen:f': { type: 'float', range: [0.5, 100.5], default: 2.5, client_sync: true },
					'oxygen:b': { type: 'bool', default: true, client_sync: true },
					'oxygen:e': { type: 'enum', values: ['red', 'green'], default: 'green', client_sync: true },
				},
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

/** RP: one client entity per rig kind (sharing animations, controllers and the render controller) */
export function rigClients(): { entities: Record<RigKind, Json>; animations: Json; controllers: Json; renderController: Json } {
	const c = rigClient();
	const entities = {} as Record<RigKind, Json>;
	for (const [kind, k] of Object.entries(RIG_KINDS) as [RigKind, (typeof RIG_KINDS)[RigKind]][]) {
		const e = structuredClone(c.entity);
		const d = e['minecraft:client_entity'].description;
		d.identifier = `oxygen:${kind}`;
		d.geometry = { ...k.geometry };
		if ('queryable_geometry' in k) d.queryable_geometry = k.queryable_geometry;
		entities[kind] = e;
	}
	return { entities, animations: c.animations, controllers: c.controllers, renderController: c.renderController };
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
		if (probe.script) {
			animations[`animation.oxygen_rig.${key}_s`] = {
				loop: true,
				animation_length: probe.script.loop ?? 1,
				...(probe.script.timeline ? { timeline: probe.script.timeline } : {}),
				...(probe.script.bones ? { bones: probe.script.bones } : {}),
			};
			animationNames[`${key}_s`] = `animation.oxygen_rig.${key}_s`;
			animate.push({ [`${key}_s`]: `q.variant == ${variant}` });
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
