/**
 * Particle component catalog: what each component and field is, which phase of the game's update loop
 * evaluates it, and the value the game uses when it's missing or broken. Defaults marked `measured` were
 * verified in-game; the rest follow the documentation and creators' notes.
 */

export type Phase = 'setup' | 'emitter' | 'spawn' | 'particle' | 'render';

/** Phase color group (spawn and particle update share one color) */
export type PhaseColor = 'setup' | 'emitter' | 'particle' | 'render';

export const PHASE_COLOR: Record<Phase, PhaseColor> = {
	setup: 'setup',
	emitter: 'emitter',
	spawn: 'particle',
	particle: 'particle',
	render: 'render',
};

export const PHASES: { id: Phase; label: string; detail: string }[] = [
	{ id: 'setup', label: 'Emitter setup', detail: 'Runs once when the emitter is created (and when an entity loop restarts)' },
	{ id: 'emitter', label: 'Emitter update', detail: 'Runs every frame while the emitter exists, before its particles' },
	{ id: 'spawn', label: 'Particle spawn', detail: 'Runs once for each new particle' },
	{ id: 'particle', label: 'Particle update', detail: 'Runs every frame for each particle, one particle at a time' },
	{ id: 'render', label: 'Render', detail: 'Runs every frame for each visible particle, after all updates' },
];

export type Category = 'emitter' | 'shape' | 'motion' | 'lifetime' | 'appearance' | 'logic';

export const CATEGORIES: { id: Category; label: string }[] = [
	{ id: 'emitter', label: 'Emitter' },
	{ id: 'shape', label: 'Shape' },
	{ id: 'motion', label: 'Motion' },
	{ id: 'lifetime', label: 'Lifetime' },
	{ id: 'appearance', label: 'Appearance' },
	{ id: 'logic', label: 'Logic' },
];

export type FieldKind =
	| { type: 'molang'; default?: number | null; unit?: string }
	| { type: 'vec'; size: 2 | 3; labels: string[]; default?: number[]; unit?: string }
	| { type: 'statements' }
	| { type: 'number'; default?: number; min?: number; max?: number; step?: number; unit?: string }
	| { type: 'bool'; default?: boolean }
	| { type: 'enum'; options: { value: string; label: string; help?: string }[]; default?: string }
	| { type: 'string'; default?: string; placeholder?: string }
	| { type: 'events' }
	| { type: 'timeline'; key: 'time' | 'distance' }
	| { type: 'looping-distance' }
	| { type: 'blocks' }
	| { type: 'plane' }
	| { type: 'shape-direction'; allowOutwards: boolean }
	| { type: 'plane-normal' }
	| { type: 'color' }
	| { type: 'billboard-direction' }
	| { type: 'uv' }
	| { type: 'collision-events' };

export interface FieldInfo {
	key: string;
	label: string;
	phase: Phase;
	kind: FieldKind;
	help: string;
	/** default was verified in-game */
	measured?: boolean;
	required?: boolean;
}

export interface ComponentInfo {
	id: string;
	label: string;
	category: Category;
	/** Only one component of a group can be active (rate, lifetime, shape) */
	group?: 'rate' | 'lifetime' | 'shape';
	help: string;
	fields: FieldInfo[];
	/** Components whose JSON value isn't an object (initial speed may be a bare value; kill plane, block lists are arrays) */
	valueShape?: 'object' | 'molang-or-vec' | 'plane' | 'blocks';
}

const XYZ = ['X', 'Y', 'Z'];

export const COMPONENTS: ComponentInfo[] = [
	{
		id: 'minecraft:emitter_initialization',
		label: 'Emitter expressions',
		category: 'logic',
		help: 'Molang that runs when the emitter is created and on every emitter update. Variables set here are shared by every particle of this emitter.',
		fields: [
			{ key: 'creation_expression', label: 'On creation', phase: 'setup', kind: { type: 'statements' }, help: 'Runs once, after the lifetime and rate setup (so active_time and max_particles cannot see what it sets).' },
			{ key: 'per_update_expression', label: 'Every update', phase: 'emitter', kind: { type: 'statements' }, help: 'Runs every frame before particles update, even after the emitter stops spawning, while particles remain.' },
		],
	},
	{
		id: 'minecraft:emitter_local_space',
		label: 'Local space',
		category: 'emitter',
		help: 'For emitters attached to an entity: simulate particles relative to it. Has no effect on /particle or script spawns.',
		fields: [
			{ key: 'position', label: 'Follow position', phase: 'setup', kind: { type: 'bool', default: false }, help: 'Particles move with the entity.' },
			{ key: 'rotation', label: 'Follow rotation', phase: 'setup', kind: { type: 'bool', default: false }, help: 'Particles rotate with the entity. Needs "Follow position".' },
			{ key: 'velocity', label: 'Inherit velocity', phase: 'setup', kind: { type: 'bool', default: false }, help: "New particles add the entity's velocity." },
		],
	},
	{
		id: 'minecraft:emitter_rate_instant',
		label: 'Burst',
		category: 'emitter',
		group: 'rate',
		help: 'Spawns all particles at once at the start of each loop. Fires even when active_time is 0.',
		fields: [{ key: 'num_particles', label: 'Particles', phase: 'emitter', kind: { type: 'molang', default: 10 }, help: 'How many particles the burst spawns. The game caps live particles per emitter (1000 for /particle and script spawns).' }],
	},
	{
		id: 'minecraft:emitter_rate_steady',
		label: 'Steady rate',
		category: 'emitter',
		group: 'rate',
		help: 'Spawns particles continuously while the emitter is active.',
		fields: [
			{ key: 'spawn_rate', label: 'Rate', phase: 'emitter', kind: { type: 'molang', default: 1, unit: '/s' }, help: 'Particles per second, evaluated every update.' },
			{ key: 'max_particles', label: 'Max particles', phase: 'setup', kind: { type: 'molang', default: 50 }, help: 'Live particle limit, evaluated at setup (before creation_expression). The game also caps each emitter on its own.' },
		],
	},
	{
		id: 'minecraft:emitter_rate_manual',
		label: 'Manual rate',
		category: 'emitter',
		group: 'rate',
		help: 'Particles are spawned by the game (for example by entities), not by the emitter itself.',
		fields: [{ key: 'max_particles', label: 'Max particles', phase: 'setup', kind: { type: 'molang', default: 50 }, help: 'Live particle limit.' }],
	},
	{
		id: 'minecraft:emitter_lifetime_once',
		label: 'Play once',
		category: 'emitter',
		group: 'lifetime',
		help: 'The emitter runs for active_time seconds, then expires. Its particles live on.',
		fields: [{ key: 'active_time', label: 'Active time', phase: 'setup', kind: { type: 'molang', default: 10, unit: 's' }, help: 'Evaluated before creation_expression runs.' }],
	},
	{
		id: 'minecraft:emitter_lifetime_looping',
		label: 'Looping',
		category: 'emitter',
		group: 'lifetime',
		help: 'Runs for active_time, sleeps for sleep_time, then restarts. Only entity-attached emitters loop: /particle and script spawns play one loop and expire.',
		fields: [
			{ key: 'active_time', label: 'Active time', phase: 'setup', kind: { type: 'molang', default: 10, unit: 's' }, help: 'Evaluated at the start of each loop, before creation_expression on the first.' },
			{ key: 'sleep_time', label: 'Sleep time', phase: 'setup', kind: { type: 'molang', default: 0, unit: 's' }, help: 'Pause between loops. A loop with no total length never restarts.' },
		],
	},
	{
		id: 'minecraft:emitter_lifetime_expression',
		label: 'Expression lifetime',
		category: 'emitter',
		group: 'lifetime',
		help: 'The emitter is active while the activation expression is non-zero and expires when the expiration expression is non-zero.',
		fields: [
			{ key: 'activation_expression', label: 'Active while', phase: 'emitter', kind: { type: 'molang', default: 1 }, help: 'Spawns while this is non-zero. A burst fires each time it turns on.' },
			{ key: 'expiration_expression', label: 'Expire when', phase: 'emitter', kind: { type: 'molang', default: 0 }, help: 'The emitter expires the first update this is non-zero.' },
		],
	},
	{
		id: 'minecraft:emitter_lifetime_events',
		label: 'Emitter events',
		category: 'emitter',
		help: 'Events fired by the emitter: on creation, on expiration, at times, or by distance travelled.',
		fields: [
			{ key: 'creation_event', label: 'On creation', phase: 'setup', kind: { type: 'events' }, help: 'Fired once after creation_expression.' },
			{ key: 'expiration_event', label: 'On expiration', phase: 'emitter', kind: { type: 'events' }, help: 'Fired when the emitter expires.' },
			{ key: 'timeline', label: 'Timeline', phase: 'emitter', kind: { type: 'timeline', key: 'time' }, help: 'Events at emitter ages (seconds), per loop.' },
			{ key: 'travel_distance_events', label: 'By distance', phase: 'emitter', kind: { type: 'timeline', key: 'distance' }, help: 'Events once the emitter has moved this far (blocks).' },
			{ key: 'looping_travel_distance_events', label: 'Every distance', phase: 'emitter', kind: { type: 'looping-distance' }, help: 'Events each time the emitter moves this far.' },
		],
	},
	shape('minecraft:emitter_shape_point', 'Point', 'Spawns every particle at one point.', [
		{ key: 'offset', label: 'Offset', phase: 'spawn', kind: { type: 'vec', size: 3, labels: XYZ, default: [0, 0, 0], unit: 'blocks' }, help: 'Spawn position relative to the emitter.' },
		{ key: 'direction', label: 'Direction', phase: 'spawn', kind: { type: 'shape-direction', allowOutwards: false }, help: 'Initial direction of travel, scaled by initial speed.' },
	]),
	shape('minecraft:emitter_shape_sphere', 'Sphere', 'Spawns in or on a sphere.', [
		{ key: 'offset', label: 'Offset', phase: 'spawn', kind: { type: 'vec', size: 3, labels: XYZ, default: [0, 0, 0], unit: 'blocks' }, help: 'Center relative to the emitter.' },
		{ key: 'radius', label: 'Radius', phase: 'spawn', kind: { type: 'molang', default: 1, unit: 'blocks' }, help: 'Evaluated for each particle.' },
		{ key: 'surface_only', label: 'Surface only', phase: 'spawn', kind: { type: 'bool', default: false }, help: 'Spawn on the surface instead of inside.' },
		{ key: 'direction', label: 'Direction', phase: 'spawn', kind: { type: 'shape-direction', allowOutwards: true }, help: 'Outwards, inwards, or a custom direction.' },
	]),
	shape('minecraft:emitter_shape_box', 'Box', 'Spawns in or on a box.', [
		{ key: 'offset', label: 'Offset', phase: 'spawn', kind: { type: 'vec', size: 3, labels: XYZ, default: [0, 0, 0], unit: 'blocks' }, help: 'Center relative to the emitter.' },
		{ key: 'half_dimensions', label: 'Half size', phase: 'spawn', kind: { type: 'vec', size: 3, labels: XYZ, default: [0, 0, 0], unit: 'blocks' }, help: 'Distance from the center to each face.' },
		{ key: 'surface_only', label: 'Surface only', phase: 'spawn', kind: { type: 'bool', default: false }, help: 'Spawn on the faces instead of inside.' },
		{ key: 'direction', label: 'Direction', phase: 'spawn', kind: { type: 'shape-direction', allowOutwards: true }, help: 'Outwards, inwards, or a custom direction.' },
	]),
	shape('minecraft:emitter_shape_disc', 'Disc', 'Spawns in or on the edge of a disc.', [
		{ key: 'offset', label: 'Offset', phase: 'spawn', kind: { type: 'vec', size: 3, labels: XYZ, default: [0, 0, 0], unit: 'blocks' }, help: 'Center relative to the emitter.' },
		{ key: 'radius', label: 'Radius', phase: 'spawn', kind: { type: 'molang', default: 1, unit: 'blocks' }, help: 'Evaluated for each particle.' },
		{ key: 'plane_normal', label: 'Facing', phase: 'spawn', kind: { type: 'plane-normal' }, help: 'Axis the disc faces: x, y, z or a custom vector.' },
		{ key: 'surface_only', label: 'Edge only', phase: 'spawn', kind: { type: 'bool', default: false }, help: 'Spawn on the rim instead of inside.' },
		{ key: 'direction', label: 'Direction', phase: 'spawn', kind: { type: 'shape-direction', allowOutwards: true }, help: 'Outwards, inwards, or a custom direction.' },
	]),
	shape('minecraft:emitter_shape_custom', 'Custom', 'Spawns at a position computed by Molang.', [
		{ key: 'offset', label: 'Position', phase: 'spawn', kind: { type: 'vec', size: 3, labels: XYZ, default: [0, 0, 0], unit: 'blocks' }, help: 'Evaluated X, then Y, then Z for each particle.' },
		{ key: 'direction', label: 'Direction', phase: 'spawn', kind: { type: 'shape-direction', allowOutwards: false }, help: 'Initial direction of travel.' },
	]),
	shape('minecraft:emitter_shape_entity_aabb', 'Entity box', "Spawns in or on the attached entity's bounding box.", [
		{ key: 'surface_only', label: 'Surface only', phase: 'spawn', kind: { type: 'bool', default: false }, help: 'Spawn on the faces instead of inside.' },
		{ key: 'direction', label: 'Direction', phase: 'spawn', kind: { type: 'shape-direction', allowOutwards: true }, help: 'Outwards, inwards, or a custom direction.' },
	]),
	{
		id: 'minecraft:particle_initialization',
		label: 'Particle expressions',
		category: 'logic',
		help: "Molang that runs for each particle. Variables are still the emitter's shared map: a value set for one particle is seen by the next.",
		fields: [
			{ key: 'per_update_expression', label: 'Every update', phase: 'particle', kind: { type: 'statements' }, help: 'Runs first in each particle update, before motion.' },
			{ key: 'per_render_expression', label: 'Every render', phase: 'render', kind: { type: 'statements' }, help: 'Runs before size, facing, UV and tint are evaluated. Skipped when the whole emitter is off-screen.' },
		],
	},
	{
		id: 'minecraft:particle_initial_speed',
		label: 'Initial speed',
		category: 'motion',
		valueShape: 'molang-or-vec',
		help: "A speed along the shape's direction, or a velocity vector.",
		fields: [{ key: '', label: 'Speed', phase: 'spawn', kind: { type: 'molang', default: 0, unit: 'blocks/s' }, help: 'A single value scales the direction; three values set the velocity directly.' }],
	},
	{
		id: 'minecraft:particle_initial_spin',
		label: 'Initial spin',
		category: 'motion',
		help: 'Starting rotation of the billboard and how fast it turns.',
		fields: [
			{ key: 'rotation', label: 'Rotation', phase: 'spawn', kind: { type: 'molang', default: 0, unit: '°' }, help: 'Degrees, around the facing axis.' },
			{ key: 'rotation_rate', label: 'Rotation rate', phase: 'spawn', kind: { type: 'molang', default: 0, unit: '°/s' }, help: 'Used by dynamic motion.' },
		],
	},
	{
		id: 'minecraft:particle_motion_dynamic',
		label: 'Dynamic motion',
		category: 'motion',
		help: 'Physics: acceleration and drag integrated every update.',
		fields: [
			{ key: 'linear_acceleration', label: 'Acceleration', phase: 'particle', kind: { type: 'vec', size: 3, labels: XYZ, default: [0, 0, 0], unit: 'blocks/s²' }, help: 'Evaluated X, Y, Z every update.' },
			{ key: 'linear_drag_coefficient', label: 'Drag', phase: 'particle', kind: { type: 'molang', default: 0 }, help: 'Slows the particle in proportion to its speed.' },
			{ key: 'rotation_acceleration', label: 'Spin acceleration', phase: 'particle', kind: { type: 'molang', default: 0, unit: '°/s²' }, help: '' },
			{ key: 'rotation_drag_coefficient', label: 'Spin drag', phase: 'particle', kind: { type: 'molang', default: 0 }, help: '' },
		],
	},
	{
		id: 'minecraft:particle_motion_parametric',
		label: 'Parametric motion',
		category: 'motion',
		help: 'Sets the position, direction or rotation directly from Molang every update.',
		fields: [
			{ key: 'relative_position', label: 'Position', phase: 'particle', kind: { type: 'vec', size: 3, labels: XYZ, unit: 'blocks' }, help: 'Relative to the emitter. Evaluated X, then Y, then Z.' },
			{ key: 'direction', label: 'Direction', phase: 'particle', kind: { type: 'vec', size: 3, labels: XYZ }, help: 'Steers the velocity, keeping its speed.' },
			{ key: 'rotation', label: 'Rotation', phase: 'particle', kind: { type: 'molang', unit: '°' }, help: 'Billboard rotation in degrees.' },
		],
	},
	{
		id: 'minecraft:particle_motion_collision',
		label: 'Collision',
		category: 'motion',
		help: "Particles with dynamic motion collide with blocks' real collision boxes (slabs, fences). Water and plants have none.",
		fields: [
			{ key: 'enabled', label: 'Enabled', phase: 'particle', kind: { type: 'molang', default: 1 }, help: 'Collides while non-zero.' },
			{ key: 'collision_radius', label: 'Radius', phase: 'particle', kind: { type: 'number', default: 0, min: 0, max: 0.5, step: 0.01, unit: 'blocks' }, help: 'At most 0.5.' },
			{ key: 'collision_drag', label: 'Drag', phase: 'particle', kind: { type: 'number', default: 0, min: 0, unit: 'blocks/s' }, help: 'Speed lost per second while touching.' },
			{ key: 'coefficient_of_restitution', label: 'Bounciness', phase: 'particle', kind: { type: 'number', default: 0, min: 0, step: 0.05 }, help: '0 stops dead, 1 bounces fully.' },
			{ key: 'expire_on_contact', label: 'Expire on contact', phase: 'particle', kind: { type: 'bool', default: false }, help: '' },
			{ key: 'events', label: 'Events', phase: 'particle', kind: { type: 'collision-events' }, help: 'Fired on impacts faster than min_speed (at least 2 blocks/s).' },
		],
	},
	{
		id: 'minecraft:particle_lifetime_expression',
		label: 'Particle lifetime',
		category: 'lifetime',
		help: 'Without this component, particles die on their first update. With it but no max lifetime, they live until something else expires them.',
		fields: [
			{ key: 'max_lifetime', label: 'Max lifetime', phase: 'spawn', kind: { type: 'molang', default: null, unit: 's' }, measured: true, help: 'Evaluated once per particle. 0 dies on the first update.' },
			{ key: 'expiration_expression', label: 'Expire when', phase: 'particle', kind: { type: 'molang', default: null }, help: 'Checked every update after motion; non-zero kills the particle.' },
		],
	},
	{
		id: 'minecraft:particle_lifetime_events',
		label: 'Particle events',
		category: 'lifetime',
		help: 'Events fired by each particle.',
		fields: [
			{ key: 'creation_event', label: 'On creation', phase: 'spawn', kind: { type: 'events' }, help: '' },
			{ key: 'expiration_event', label: 'On expiration', phase: 'particle', kind: { type: 'events' }, help: '' },
			{ key: 'timeline', label: 'Timeline', phase: 'particle', kind: { type: 'timeline', key: 'time' }, help: 'Events at particle ages (seconds).' },
		],
	},
	{
		id: 'minecraft:particle_kill_plane',
		label: 'Kill plane',
		category: 'lifetime',
		valueShape: 'plane',
		help: 'Kills particles that cross the plane Ax + By + Cz + D = 0, relative to the emitter. Being on either side is fine; only crossing counts, and never on the first update.',
		fields: [{ key: '', label: 'Plane', phase: 'particle', kind: { type: 'plane' }, measured: true, help: 'A, B, C, D' }],
	},
	{
		id: 'minecraft:particle_expire_if_in_blocks',
		label: 'Expire in blocks',
		category: 'lifetime',
		valueShape: 'blocks',
		help: 'Kills particles inside any of these blocks.',
		fields: [{ key: '', label: 'Blocks', phase: 'particle', kind: { type: 'blocks' }, help: '' }],
	},
	{
		id: 'minecraft:particle_expire_if_not_in_blocks',
		label: 'Only in blocks',
		category: 'lifetime',
		valueShape: 'blocks',
		help: 'Kills particles outside all of these blocks.',
		fields: [{ key: '', label: 'Blocks', phase: 'particle', kind: { type: 'blocks' }, help: '' }],
	},
	{
		id: 'minecraft:particle_appearance_billboard',
		label: 'Billboard',
		category: 'appearance',
		help: 'Draws each particle as a textured quad. Without it particles are invisible.',
		fields: [
			{ key: 'size', label: 'Size', phase: 'render', kind: { type: 'vec', size: 2, labels: ['W', 'H'], default: [1, 1], unit: 'blocks' }, measured: true, help: 'Half the width and height. Any negative or zero axis hides the particle.', required: true },
			{
				key: 'facing_camera_mode',
				label: 'Facing',
				phase: 'render',
				kind: {
					type: 'enum',
					default: 'rotate_xyz',
					options: [
						{ value: 'rotate_xyz', label: 'Camera plane', help: 'Parallel to the screen' },
						{ value: 'rotate_y', label: 'Camera plane, upright', help: 'Turns only around Y' },
						{ value: 'lookat_xyz', label: 'Look at camera', help: 'Faces the camera position' },
						{ value: 'lookat_y', label: 'Look at camera, upright', help: 'Faces the camera, turning only around Y' },
						{ value: 'lookat_direction', label: 'Along direction, toward camera', help: 'X follows the direction, rolled to face the camera' },
						{ value: 'direction_x', label: 'Direction X', help: 'X follows the direction' },
						{ value: 'direction_y', label: 'Direction Y', help: 'Y follows the direction; a level direction lies flat' },
						{ value: 'direction_z', label: 'Direction Z', help: 'Faces along the direction' },
						{ value: 'emitter_transform_xy', label: 'Emitter XY plane', help: 'Faces +Z of the emitter. One-sided' },
						{ value: 'emitter_transform_xz', label: 'Emitter XZ plane', help: 'Faces +Y of the emitter. One-sided' },
						{ value: 'emitter_transform_yz', label: 'Emitter YZ plane', help: 'Faces +X of the emitter. One-sided' },
					],
				},
				help: 'How the quad is oriented. Particles are one-sided.',
			},
			{ key: 'direction', label: 'Direction', phase: 'render', kind: { type: 'billboard-direction' }, help: 'Where direction-based facing modes get their direction. With no direction, nothing is drawn.' },
			{ key: 'uv', label: 'Texture area', phase: 'render', kind: { type: 'uv' }, help: 'Which part of the texture to draw, or a flipbook.' },
		],
	},
	{
		id: 'minecraft:particle_appearance_tinting',
		label: 'Tint',
		category: 'appearance',
		help: 'Multiplies the texture color. Values are clamped to 0–1.',
		fields: [{ key: 'color', label: 'Color', phase: 'render', kind: { type: 'color' }, measured: true, help: 'A color, per-channel Molang, or a gradient. Cutout materials ignore tint alpha.' }],
	},
	{
		id: 'minecraft:particle_appearance_lighting',
		label: 'Lit by world',
		category: 'appearance',
		help: 'Particles take the light level at their position. Without it they are fully bright.',
		fields: [],
	},
];

function shape(id: string, label: string, help: string, fields: FieldInfo[]): ComponentInfo {
	return { id, label, category: 'shape', group: 'shape', help, fields };
}

export const COMPONENT_BY_ID = new Map(COMPONENTS.map((c) => [c.id, c]));

/** Canonical component order, used when adding a component to a file */
export const COMPONENT_ORDER = COMPONENTS.map((c) => c.id);

/** Insertion index that keeps components in canonical order */
export function componentInsertionIndex(id: string): (keys: string[]) => number {
	const rank = COMPONENT_ORDER.indexOf(id);
	return (keys) => {
		if (rank < 0) return keys.length;
		for (let i = 0; i < keys.length; i++) {
			const r = COMPONENT_ORDER.indexOf(keys[i]);
			if (r > rank) return i;
		}
		return keys.length;
	};
}

export const MATERIALS: { value: string; label: string; help: string }[] = [
	{ value: 'particles_alpha', label: 'Cutout', help: 'Texels below half alpha are discarded; the rest are opaque. Writes depth.' },
	{ value: 'particles_blend', label: 'Translucent', help: 'Alpha blended, drawn back to front. Never hides other particles.' },
	{ value: 'particles_add', label: 'Additive', help: 'Adds light. Never hides other particles.' },
	{ value: 'particles_opaque', label: 'Opaque', help: 'Ignores alpha entirely.' },
];

/** Starting file for a new effect */
export function newEffect(identifier: string): object {
	return {
		format_version: '1.10.0',
		particle_effect: {
			description: {
				identifier,
				basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' },
			},
			components: {
				'minecraft:emitter_rate_steady': { spawn_rate: 20, max_particles: 100 },
				'minecraft:emitter_lifetime_looping': { active_time: 1 },
				'minecraft:emitter_shape_point': {},
				'minecraft:particle_initial_speed': 2,
				'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
				'minecraft:particle_motion_dynamic': { linear_acceleration: [0, -2, 0] },
				'minecraft:particle_appearance_billboard': {
					size: [0.1, 0.1],
					facing_camera_mode: 'lookat_xyz',
					uv: { texture_width: 128, texture_height: 128, uv: [0, 0], uv_size: [8, 8] },
				},
			},
		},
	};
}
