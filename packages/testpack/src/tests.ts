/**
 * In-game verification tests. Each test is a row of "probes": small particle effects spawned side by
 * side above coloured wool markers. A probe's visibility (or position) answers one yes/no question,
 * so results can be read from a single screenshot.
 */
export type Json = Record<string, any>;

export interface Probe {
	id: string;
	/** What it means if this probe is visible (or how to read it) */
	reads: string;
	/** Particle JSON (identifier is assigned by the generator) */
	effect: Json;
	/** Extra effects this probe needs (e.g. event children), keyed by short id */
	children?: Record<string, Json>;
	/** The probe effect's events (otherwise from probeEvents) */
	events?: Json;
	/** Spawn via the helper script instead of /particle (Script API context) */
	script?: { vars: Record<string, number> };
	/** Blocks to place for this probe, relative to the probe base (floor = y -1) */
	blocks?: { dx: number; dy: number; dz: number; block: string }[];
	/** Spawn height offset above the default probe height */
	spawnDy?: number;
	/** Curves for this probe's effect */
	curves?: Json;
	/** Flipbook probes: the u0 (0–1) of the only opaque frame in the texture; visible iff that frame shows */
	opaqueU0?: number;
}

export interface TestCase {
	id: string;
	title: string;
	question: string;
	probes: Probe[];
	/** seconds to wait after spawning before the screenshot */
	wait: number;
	/** Additional camera views (default: front) */
	views?: ('front' | 'behind' | 'above' | 'frontleft' | 'frontright')[];
	formatVersion?: string;
	/** probe spacing override (blocks) */
	spacing?: number;
	/** Engine assumption this test checks (plain text, linked to code) */
	assumption: string;
	/** Turn the camera away from the probes `after` seconds after spawning, for `seconds`, then back */
	lookAway?: { after: number; seconds: number };
}

/** Wool colours under probe 1, 2, 3 … (left to right) */
export const MARKERS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'cyan', 'purple', 'blue', 'brown'];

const VISIBLE = 0.3;
const show = (cond: string) => `(${cond}) ? ${VISIBLE} : 0`;

interface ProbeOpts {
	size?: [unknown, unknown] | unknown;
	facing?: string;
	material?: string;
	texture?: string;
	tint?: unknown;
	extraComponents?: Json;
	lifetime?: unknown;
	count?: unknown;
	activeTime?: unknown;
}

/** Standard probe: one long-lived particle, size 0.3, white bordered square */
export function probe(components: Json = {}, o: ProbeOpts = {}): Json {
	const size = Array.isArray(o.size) ? o.size : o.size !== undefined ? [o.size, o.size] : [VISIBLE, VISIBLE];
	const keys = Object.keys(components);
	const hasRate = keys.some((k) => k.startsWith('minecraft:emitter_rate_'));
	const hasLifetime = keys.some((k) => k.startsWith('minecraft:emitter_lifetime_') && k !== 'minecraft:emitter_lifetime_events');
	const json: Json = {
		format_version: '1.10.0',
		particle_effect: {
			description: {
				identifier: '',
				basic_render_parameters: { material: o.material ?? 'particles_alpha', texture: o.texture ?? 'textures/particle/oxygen_probe' },
			},
			components: {
				'minecraft:emitter_rate_instant': { num_particles: o.count ?? 1 },
				'minecraft:emitter_lifetime_once': { active_time: o.activeTime ?? 1 },
				'minecraft:particle_lifetime_expression': { max_lifetime: o.lifetime ?? 40 },
				'minecraft:particle_appearance_billboard': {
					size,
					facing_camera_mode: o.facing ?? 'lookat_xyz',
					uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] },
				},
				...(o.tint ? { 'minecraft:particle_appearance_tinting': { color: o.tint } } : {}),
				...components,
				...(o.extraComponents ?? {}),
			},
		},
	};
	// a probe that specifies its own rate / lifetime component replaces the defaults (never two of a kind)
	if (hasRate && !components['minecraft:emitter_rate_instant']) delete json.particle_effect.components['minecraft:emitter_rate_instant'];
	if (hasLifetime && !components['minecraft:emitter_lifetime_once']) delete json.particle_effect.components['minecraft:emitter_lifetime_once'];
	if (hasRate && !components['minecraft:emitter_rate_instant'] && o.count !== undefined) void 0;
	return json;
}

const BAD_READ = 'v.a = v.unset_b + 1; v.c = 5;';

/** A probe drawn from a 4-frame strip where only frame `opaque` is solid (cutout hides the rest) */
function flipbookProbe(opaque: number, flipbook: Json, lifetime = 10): Json {
	const json = probe({}, { texture: `textures/particle/oxygen_frames_${opaque}`, lifetime });
	json.particle_effect.components['minecraft:particle_appearance_billboard'].uv = {
		texture_width: 64,
		texture_height: 16,
		flipbook: { base_UV: [0, 0], size_UV: [16, 16], step_UV: [16, 0], ...flipbook },
	};
	return json;
}

export const TESTS: TestCase[] = [
	{
		id: 't01',
		title: 'Read before first write',
		question: 'What happens when an expression reads a variable that was never set?',
		assumption: 'Unset reads evaluate to 0.0 with a content error; the expression continues (world option unsetMode = "zero").',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Control — always visible.', effect: probe() },
			{ id: 'p2', reads: 'Visible → the effect still runs after a bad read in per_update.', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: BAD_READ } }) },
			{ id: 'p3', reads: 'Visible → statements after the bad read still execute.', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: BAD_READ } }, { size: show('(v.c ?? 0) == 5') }) },
			{ id: 'p4', reads: 'Visible → the bad read evaluated to 0 (v.a == 1).', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: BAD_READ } }, { size: show('(v.a ?? -1) == 1') }) },
			{ id: 'p5', reads: 'Visible → a bad read inside the size field reads 0 and the field still works.', effect: probe({}, { size: ['v.unset_z + 0.3', 0.3] }) },
			{ id: 'p6', reads: 'Visible → creation_expression continues after a bad read.', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.q = v.unset_q; v.ok = 1;' } }, { size: show('(v.ok ?? 0) == 1') }) },
			{ id: 'p7', reads: 'Visible → ?? catches an unset variable inside a complex left side.', effect: probe({}, { size: show('((v.unset_w + 1) ?? 0.3) == 0.3') }) },
		],
	},
	{
		id: 't02',
		title: 'Unset or zero active_time',
		question: 'Does an emitter whose active_time is unset/zero spawn anything (and does it restart every frame)?',
		assumption: 'active_time is evaluated before creation_expression; 0 means never active → nothing spawns, no restart storm.',
		wait: 3,
		probes: [
			{ id: 'p1', reads: 'Control — a cluster of particles.', effect: probe({ 'minecraft:emitter_rate_steady': { spawn_rate: 6, max_particles: 30 }, 'minecraft:emitter_shape_box': { half_dimensions: [0.4, 0.4, 0.4] } }, { activeTime: 2, size: 0.08 }) },
			{ id: 'p2', reads: 'Visible → once + unset active_time still spawns.', effect: probe({ 'minecraft:emitter_rate_steady': { spawn_rate: 6, max_particles: 30 }, 'minecraft:emitter_shape_box': { half_dimensions: [0.4, 0.4, 0.4] } }, { activeTime: 'v.unset_t', size: 0.08 }) },
			{ id: 'p3', reads: 'Visible → looping + unset active_time spawns; MANY particles → it restarts every frame.', effect: probe({ 'minecraft:emitter_lifetime_looping': { active_time: 'v.unset_t', sleep_time: 0 }, 'minecraft:emitter_shape_box': { half_dimensions: [0.4, 0.4, 0.4] } }, { size: 0.08, count: 1 }) },
			{ id: 'p4', reads: 'Visible → active_time sees a value set in creation_expression (setup runs AFTER creation).', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.t = 3;' }, 'minecraft:emitter_rate_steady': { spawn_rate: 6, max_particles: 30 }, 'minecraft:emitter_shape_box': { half_dimensions: [0.4, 0.4, 0.4] } }, { activeTime: 'v.t', size: 0.08 }) },
			{ id: 'p5', reads: 'Visible → an instant burst still fires with active_time 0.', effect: probe({ 'minecraft:emitter_shape_box': { half_dimensions: [0.4, 0.4, 0.4] } }, { activeTime: 0, count: 5, size: 0.08 }) },
		],
	},
	{
		id: 't03',
		title: 'Syntax errors',
		question: 'Which errors make the whole effect fail to load?',
		assumption: 'Any Molang syntax error fails the whole effect; unknown queries evaluate to 0.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Control.', effect: probe() },
			{ id: 'p2', reads: 'Visible → a syntax error in the size field does not kill the effect.', effect: probe({}, { size: ['0.3 +* 1', 0.3] }) },
			{ id: 'p3', reads: 'Visible → a syntax error in tint (other field) does not kill the effect.', effect: probe({}, { tint: ['1 +* 2', 1, 1, 1] }) },
			{ id: 'p4', reads: 'Visible → a syntax error in an event that never fires is ignored.', effect: probe({ }, {}) },
			{ id: 'p5', reads: 'Visible → a syntax error in an unused curve is ignored.', effect: probe({}, {}) },
			{ id: 'p6', reads: 'Visible → an unknown math function is tolerated.', effect: probe({}, { tint: ['math.oxygen_nope(1)', 1, 1, 1] }) },
			{ id: 'p7', reads: 'Visible → a double-quoted string is tolerated.', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: 'v.s = "a";' } }) },
			{ id: 'p8', reads: 'Visible → for_each is accepted in particles.', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: 'for_each(t.e, q.oxygen_list, { v.n = 1; });' } }) },
			{ id: 'p9', reads: 'Visible → an unknown query evaluates to 0 (size stays 0.3).', effect: probe({}, { size: ['q.oxygen_nonexistent + 0.3', 0.3] }) },
		],
	},
	{
		id: 't04',
		title: '10,000 particle cap',
		question: 'Is there a 10,000 particles-per-emitter cap, and does it block spawns?',
		assumption: 'Each emitter holds at most 10,000 particles; extra spawns are dropped.',
		wait: 2,
		probes: [
			{
				id: 'p1',
				reads: 'Count the dots: 2 dots (left pair) → capped at 10,000; 4 dots → no cap.',
				effect: probe(
					{
						'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
						'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
						'minecraft:particle_motion_parametric': { relative_position: ['(v.idx >= 9998 && v.idx <= 10001) ? (v.idx - 9998) * 0.6 : 1000', 0, 0] },
					},
					{ count: 20000, size: 0.12 },
				),
			},
			{
				id: 'p2',
				reads: 'Same window with a steady emitter (max_particles 20000): 2 dots → capped.',
				effect: probe(
					{
						'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
						'minecraft:emitter_rate_steady': { spawn_rate: 100000, max_particles: 20000 },
						'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
						'minecraft:particle_motion_parametric': { relative_position: ['(v.idx >= 9998 && v.idx <= 10001) ? (v.idx - 9998) * 0.6 : 1000', 0, 0] },
					},
					{ size: 0.12, activeTime: 3 },
				),
			},
			{
				id: 'p3',
				reads: 'Control: 9,999 particles → exactly 1 dot.',
				effect: probe(
					{
						'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
						'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
						'minecraft:particle_motion_parametric': { relative_position: ['(v.idx >= 9998 && v.idx <= 10001) ? (v.idx - 9998) * 0.6 : 1000', 0, 0] },
					},
					{ count: 9999, size: 0.12 },
				),
			},
		],
	},
	{
		id: 't05',
		title: 'Temp leaking boundaries',
		question: 'Across which boundaries do t.* values survive?',
		assumption: 'Only from an event sequence into a child pre_effect_expression.',
		wait: 2,
		probes: [
			{
				id: 'p1',
				reads: 'Visible → t.* from an event sequence reaches the child pre_effect (documented).',
				effect: {
					...probe(
						{ 'minecraft:emitter_initialization': { creation_expression: 'v.secret = 7;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } },
						{ size: 0 },
					),
				},
				children: { child: probe({ 'minecraft:emitter_initialization': {} }, { size: show('(v.got ?? 0) == 7') }) },
			},
			{ id: 'p2', reads: 'Visible → temps leak from one particle to the next in the update loop.', effect: probe({ 'minecraft:particle_initialization': { per_update_expression: 'v.seen = t.carry ?? 0; t.carry = 1;' } }, { count: 3, size: show('v.seen == 1') }) },
			{ id: 'p3', reads: 'Visible → temps leak from emitter per_update into particle expressions.', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: 't.e = 1;' }, 'minecraft:particle_initialization': { per_update_expression: 'v.got = t.e ?? 0;' } }, { size: show('v.got == 1') }) },
			{ id: 'p4', reads: 'Visible → temps leak from the update pass into render preparation.', effect: probe({ 'minecraft:particle_initialization': { per_update_expression: 't.r = 1;', per_render_expression: 'v.gr = t.r ?? 0;' } }, { size: show('v.gr == 1') }) },
			{ id: 'p5', reads: 'Visible → temps persist across frames.', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: 'v.prev = t.f ?? 0; t.f = 1;' } }, { size: show('v.prev == 1') }) },
			{
				id: 'p6',
				reads: "Visible → a leaked temp is still readable in the child's creation_expression.",
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				children: { child: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.gotz = t.z ?? 0;' } }, { size: show('(v.gotz ?? 0) == 5') }) },
			},
			{
				id: 'p7',
				reads: 'Visible → temps persist between two expression steps of one sequence.',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: show('(v.k ?? 0) == 3') }),
			},
		],
	},
	{
		id: 't06',
		title: 'Material render states',
		question: 'Do cutouts show particles behind their holes, do blended particles write depth, what is the alpha-test threshold, and which modes are one-sided?',
		assumption: 'Cutout discards transparent texels (no depth write there); blend/add never write depth; alpha test at 0.5 on texture×tint alpha; particles are one-sided.',
		wait: 2,
		views: ['front', 'behind'],
		probes: [
			{ id: 'p1', reads: 'Two overlapping cutout quads: back quad visible through the front holes → correct.', effect: twoQuads('particles_alpha', 'textures/particle/oxygen_cutout') },
			{ id: 'p2', reads: 'Two overlapping blended quads: overlap blends (no hard occlusion) → no depth write.', effect: twoQuads('particles_blend', 'textures/particle/oxygen_glass') },
			{ id: 'p3', reads: 'Alpha-step bands (alpha 16…240): count visible bands from the right → threshold.', effect: probe({}, { material: 'particles_alpha', texture: 'textures/particle/oxygen_alpha_steps', size: 0.6, facing: 'rotate_xyz' }) },
			{ id: 'p4', reads: 'Same with tint alpha 0.5: fewer bands → tint alpha participates in the test.', effect: probe({}, { material: 'particles_alpha', texture: 'textures/particle/oxygen_alpha_steps', size: 0.6, facing: 'rotate_xyz', tint: [1, 1, 1, 0.5] }) },
			{ id: 'p5', reads: 'emitter_transform_xy plane facing the camera; check the behind view for culling.', effect: probe({}, { facing: 'emitter_transform_xy', texture: 'textures/particle/oxygen_arrow', size: 0.5 }) },
			{ id: 'p6', reads: 'direction_z pointing AWAY from the camera: visible → back faces render.', effect: probe({ 'minecraft:particle_appearance_billboard': { size: [0.5, 0.5], facing_camera_mode: 'direction_z', direction: { mode: 'custom', custom_direction: [0, 0, 1] }, uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } } }, { texture: 'textures/particle/oxygen_arrow' }) },
			{ id: 'p7', reads: 'direction_z pointing AT the camera (control for p6).', effect: probe({ 'minecraft:particle_appearance_billboard': { size: [0.5, 0.5], facing_camera_mode: 'direction_z', direction: { mode: 'custom', custom_direction: [0, 0, -1] }, uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } } }, { texture: 'textures/particle/oxygen_arrow' }) },
			{ id: 'p8', reads: 'Additive quads overlapping: brighter overlap.', effect: twoQuads('particles_add', 'textures/particle/oxygen_glass') },
		],
	},
	{
		id: 't07',
		title: 'Missing vs zero max_lifetime',
		question: 'How long do particles live with max_lifetime 0, or with no max_lifetime at all?',
		assumption: 'max_lifetime 0 → dies on its first update; missing → lives until something else expires it.',
		wait: 4,
		probes: [
			{ id: 'p1', reads: 'Control (40 s).', effect: probe() },
			{ id: 'p2', reads: 'Visible after 4 s → missing max_lifetime (component present) lives on.', effect: probe({ 'minecraft:particle_lifetime_expression': { expiration_expression: 0 } }) },
			{ id: 'p3', reads: 'Visible after 4 s → no lifetime component at all lives on.', effect: withoutLifetime(probe()) },
			{ id: 'p4', reads: 'Visible → max_lifetime 0 renders at least once / survives.', effect: probe({}, { lifetime: 0 }) },
		],
	},
	{
		id: 't08',
		title: 'What a new loop resets',
		question: 'Does creation_expression re-run each loop? Do emitter randoms re-roll? Does v.* persist?',
		assumption: 'each loop is a new emitter (reported by creators for entity-attached loops): creation re-runs, emitter randoms re-roll, v.* starts over.',
		wait: 3.5,
		probes: [
			{ id: 'p1', reads: 'Column of particles rising → creation_expression re-runs every loop; one cluster → it does not.', effect: probe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0 }, 'minecraft:emitter_initialization': { creation_expression: 'v.n = (v.n ?? 0) + 1;' }, 'minecraft:emitter_shape_point': { offset: [0, 'v.n * 0.35', 0] } }, { size: 0.1 }) },
			{ id: 'p2', reads: 'Particles at different heights → emitter randoms re-roll per loop.', effect: probe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0 }, 'minecraft:emitter_shape_point': { offset: [0, 'v.emitter_random_1 * 2', 0] } }, { size: 0.1 }) },
			{ id: 'p3', reads: 'Later loops spawn higher → v.* persists across loops.', effect: probe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0 }, 'minecraft:emitter_initialization': { per_update_expression: 'v.c = (v.c ?? 0) + 1;' }, 'minecraft:emitter_shape_point': { offset: [0, 'math.min(v.c / 60, 3)', 0] } }, { size: 0.1 }) },
		],
	},
	{
		id: 't10',
		title: 'Negative and zero size',
		question: 'Which size combinations render?',
		assumption: 'Any negative axis hides the particle.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Control [0.3, 0.3].', effect: probe() },
			{ id: 'p2', reads: '[-0.3, 0.3]', effect: probe({}, { size: [-0.3, 0.3], texture: 'textures/particle/oxygen_arrow' }) },
			{ id: 'p3', reads: '[0.3, -0.3]', effect: probe({}, { size: [0.3, -0.3], texture: 'textures/particle/oxygen_arrow' }) },
			{ id: 'p4', reads: '[-0.3, -0.3]', effect: probe({}, { size: [-0.3, -0.3], texture: 'textures/particle/oxygen_arrow' }) },
			{ id: 'p5', reads: '[0, 0.3]', effect: probe({}, { size: [0, 0.3] }) },
			{ id: 'p6', reads: '[0.3, 0]', effect: probe({}, { size: [0.3, 0] }) },
		],
	},
	{
		id: 't11',
		title: 'UV edge cases',
		question: 'What does a zero or negative uv_size show?',
		assumption: 'A zero uv_size samples a one-texel sliver stretched over the quad; negative flips.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Full atlas: red | green | blue | yellow.', effect: uvProbe([0, 0], [16, 16]) },
			{ id: 'p2', reads: 'uv [4,0] size [0,16]: solid green → sliver; full atlas → treated as full.', effect: uvProbe([4, 0], [0, 16]) },
			{ id: 'p3', reads: 'uv [4,0] size [4,16]: solid green (control).', effect: uvProbe([4, 0], [4, 16]) },
			{ id: 'p4', reads: 'uv [8,0] size [-8,16]: green|red → flipped.', effect: uvProbe([8, 0], [-8, 16]) },
		],
	},
	{
		id: 't12',
		title: 'Extra metadata in particle files',
		question: 'Where can Oxygen store its own data without breaking the effect?',
		assumption: 'Unknown keys are ignored (at least at the top level).',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Control.', effect: probe() },
			{ id: 'p2', reads: 'Visible → a top-level "oxygen" key is ignored.', effect: { ...probe(), oxygen: { version: 1, comments: {} } } },
			{ id: 'p3', reads: 'Visible → an "oxygen" key inside particle_effect is ignored.', effect: addKey(probe(), ['particle_effect'], 'oxygen', { version: 1 }) },
			{ id: 'p4', reads: 'Visible → an "oxygen" key inside description is ignored.', effect: addKey(probe(), ['particle_effect', 'description'], 'oxygen', { version: 1 }) },
			{ id: 'p5', reads: 'Visible → an unknown component is ignored.', effect: probe({ 'oxygen:meta': { version: 1 } }) },
			{ id: 'p6', reads: 'Visible → an unknown field inside a component is ignored.', effect: addKey(probe(), ['particle_effect', 'components', 'minecraft:particle_appearance_billboard'], 'oxygen_note', 'hi') },
		],
	},
	{
		id: 't13',
		title: 'Newlines inside Molang strings',
		question: 'Can expressions contain line breaks?',
		assumption: 'Whitespace, including newlines, is ignored between tokens.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Control.', effect: probe() },
			{ id: 'p2', reads: 'Visible → "0.1 +\\n0.2" parses.', effect: probe({}, { size: ['0.1 +\n0.2', 0.3] }) },
			{ id: 'p3', reads: 'Visible → multi-line statements parse.', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.a = 0.3;\nv.b = 1;\n' } }, { size: ['v.a ?? 0', 0.3] }) },
		],
	},
	{
		id: 't14',
		title: 'Direction facing modes',
		question: 'How do direction_x/y/z orient the arrow texture, including straight up and below min_speed?',
		assumption: 'Skill axis table; fallback axis near vertical; derive_from_velocity keeps the previous facing below the threshold.',
		wait: 2,
		views: ['front', 'above'],
		probes: [
			{ id: 'p1', reads: 'direction_x, dir +X', effect: dirProbe('direction_x', [1, 0, 0]) },
			{ id: 'p2', reads: 'direction_y, dir +X', effect: dirProbe('direction_y', [1, 0, 0]) },
			{ id: 'p3', reads: 'direction_z, dir toward camera (-Z)', effect: dirProbe('direction_z', [0, 0, -1]) },
			{ id: 'p4', reads: 'direction_z, dir straight up (+Y) — fallback orientation', effect: dirProbe('direction_z', [0, 1, 0]) },
			{ id: 'p5', reads: 'direction_z, dir almost up (0, 1, -0.001)', effect: dirProbe('direction_z', [0, 1, -0.001]) },
			{ id: 'p6', reads: 'lookat_direction, dir +X', effect: dirProbe('lookat_direction', [1, 0, 0]) },
			{
				id: 'p7',
				reads: 'direction_z from velocity 0.005 (< 0.01 threshold) toward +X: shows the facing used before any velocity-derived direction.',
				effect: probe({ 'minecraft:particle_initial_speed': 0.005, 'minecraft:emitter_shape_point': { direction: [1, 0, 0] }, 'minecraft:particle_motion_dynamic': {}, 'minecraft:particle_appearance_billboard': { size: [0.4, 0.4], facing_camera_mode: 'direction_z', uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } } }, { texture: 'textures/particle/oxygen_arrow' }),
			},
			{
				id: 'p8',
				reads: 'Same velocity with min_speed_threshold 0 → faces +X.',
				effect: probe({ 'minecraft:particle_initial_speed': 0.005, 'minecraft:emitter_shape_point': { direction: [1, 0, 0] }, 'minecraft:particle_motion_dynamic': {}, 'minecraft:particle_appearance_billboard': { size: [0.4, 0.4], facing_camera_mode: 'direction_z', direction: { mode: 'derive_from_velocity', min_speed_threshold: 0 }, uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } } }, { texture: 'textures/particle/oxygen_arrow' }),
			},
		],
	},
	{
		id: 't16',
		title: 'Kill plane with parametric jumps',
		question: 'Is the kill plane a crossing test that also catches parametric position jumps?',
		assumption: 'Sign-crossing test between the previous and current position after motion.',
		wait: 3,
		probes: [
			{ id: 'p1', reads: 'Gone after 1 s → a parametric jump across y=+1 is caught.', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, 'v.particle_age > 1 ? 2 : 0', 0] }, 'minecraft:particle_kill_plane': [0, 1, 0, -1] }) },
			{ id: 'p2', reads: 'Visible → a jump that stays below the plane survives.', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, 'v.particle_age > 1 ? 0.6 : 0', 0] }, 'minecraft:particle_kill_plane': [0, 1, 0, -1] }) },
			{ id: 'p3', reads: 'Visible → a particle that starts above the plane and never crosses survives (not a half-space test).', effect: probe({ 'minecraft:emitter_shape_point': { offset: [0, 2, 0] }, 'minecraft:particle_kill_plane': [0, 1, 0, -1] }) },
			{ id: 'p4', reads: 'Gone → the first update counts the spawn point as a previous position (parametric [0,2,0] jumps across y=+1 immediately).', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, 2, 0] }, 'minecraft:particle_kill_plane': [0, 1, 0, -1] }) },
		],
	},
	{
		id: 't17',
		title: 'Collision with different blocks',
		question: 'Which blocks do particles collide with, and at what height do they rest?',
		assumption: 'Particles collide with solid block AABBs only.',
		wait: 4,
		probes: [
			{ id: 'p1', reads: 'Lands on stone.', effect: faller(), spawnDy: 1.5, blocks: [{ dx: 0, dy: 0, dz: 0, block: 'stone' }] },
			{ id: 'p2', reads: 'Water: rests on top / sinks.', effect: faller(), spawnDy: 1.5, blocks: [{ dx: 0, dy: -1, dz: 0, block: 'water' }] },
			{ id: 'p3', reads: 'Leaves.', effect: faller(), spawnDy: 1.5, blocks: [{ dx: 0, dy: 0, dz: 0, block: 'oak_leaves' }] },
			{ id: 'p4', reads: 'Bottom slab: rests at half height → uses the real collision box.', effect: faller(), spawnDy: 1.5, blocks: [{ dx: 0, dy: 0, dz: 0, block: 'smooth_stone_slab' }] },
			{ id: 'p5', reads: 'Glass.', effect: faller(), spawnDy: 1.5, blocks: [{ dx: 0, dy: 0, dz: 0, block: 'glass' }] },
			{ id: 'p6', reads: 'Short grass (no collision box).', effect: faller(), spawnDy: 1.5, blocks: [{ dx: 0, dy: -1, dz: 0, block: 'grass_block' }, { dx: 0, dy: 0, dz: 0, block: 'short_grass' }] },
			{ id: 'p7', reads: 'Fence (1.5 tall collision).', effect: faller(), spawnDy: 1.5, blocks: [{ dx: 0, dy: 0, dz: 0, block: 'oak_fence' }] },
		],
	},
	{
		id: 't19',
		title: 'Molang semantics',
		question: 'Do these Molang behaviours match Oxygen? (visible = matches)',
		assumption: 'molangjs fork semantics.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'math.round(-2.5) == -3 (halves away from zero)', effect: probe({}, { size: show('math.round(-2.5) == -3') }) },
			{ id: 'p2', reads: 'math.sign(0) == -1', effect: probe({}, { size: show('math.sign(0) == -1') }) },
			{ id: 'p3', reads: 'math.min_angle(180) == -180', effect: probe({}, { size: show('math.min_angle(180) == -180') }) },
			{ id: 'p4', reads: 'math.mod(-1, 3) == -1 (sign of the dividend)', effect: probe({}, { size: show('math.mod(-1, 3) == -1') }) },
			{ id: 'p5', reads: "'Hello' == 'hello' → VISIBLE means strings are case-INsensitive", effect: probe({}, { size: show("'Hello' == 'hello'") }) },
			{ id: 'p6', reads: '1 || 0 && 0 == 1 (&& before ||)', effect: probe({}, { size: show('(1 || 0 && 0) == 1') }) },
			{ id: 'p7', reads: '"0.3;" (statement, no return) → INVISIBLE means 0.0', effect: probe({}, { size: ['0.3;', 0.3] }) },
			{ id: 'p8', reads: '5 / 0 == 0', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.z = 0;' } }, { size: show('(5 / v.z) == 0') }) },
			{ id: 'p9', reads: 'NaN is truthy (math.sqrt(-1) ? …)', effect: probe({}, { size: 'math.sqrt(-1) ? 0.3 : 0' }) },
			{ id: 'p10', reads: 'math.random(0, 1) never exceeds 1 / random_integer(0,1) hits 1 eventually', effect: probe({}, { size: show('math.random_integer(1, 1) == 1') }) },
		],
	},
	{
		id: 't20',
		title: 'Tint packing',
		question: 'Do tint values above 1 brighten, and do negatives clamp to 0?',
		assumption: 'trunc(c * 255) clamped to 0–255 (no HDR).',
		wait: 2,
		probes: [
			{ id: 'p1', reads: '[1,1,1,1]', effect: probe({}, { tint: [1, 1, 1, 1] }) },
			{ id: 'p2', reads: '[2,2,2,1] — same as p1 → clamped', effect: probe({}, { tint: [2, 2, 2, 1] }) },
			{ id: 'p3', reads: '[-1,1,1,1] — cyan → negative clamps to 0', effect: probe({}, { tint: [-1, 1, 1, 1] }) },
			{ id: 'p4', reads: '[0.5,0.5,0.5,1] — mid grey', effect: probe({}, { tint: [0.5, 0.5, 0.5, 1] }) },
		],
	},
	{
		id: 't21',
		title: 'Script API spawn variables',
		question: 'When are MolangVariableMap values (Script API spawnParticle) applied?',
		assumption: 'Before creation_expression (like pre_effect_script).',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Visible → the variable map reaches the effect.', effect: probe({}, { size: 'v.size ?? 0' }), script: { vars: { 'variable.size': 0.3 } } },
			{ id: 'p2', reads: 'Large (0.3) → set before creation (creation keeps it via ??); small (0.1) → set after.', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.size = v.size ?? 0.1;' } }, { size: 'v.size' }), script: { vars: { 'variable.size': 0.3 } } },
			{ id: 'p3', reads: 'Small (0.05) → creation overwrites the script value; large → script wins.', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.size = 0.05;' } }, { size: 'v.size' }), script: { vars: { 'variable.size': 0.3 } } },
		],
	},
	{
		id: 't24',
		title: 'Draw order of overlapping blended particles',
		question: 'Are blended particles inside one emitter sorted back-to-front?',
		assumption: 'Unknown — simulator currently draws in spawn order.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'First-spawned = far red, second = near blue. Overlap looks blue-on-top either way if sorted.', effect: orderedPair(true) },
			{ id: 'p2', reads: 'First-spawned = near red, second = far blue. Blue drawn over red here → unsorted (spawn order).', effect: orderedPair(false) },
		],
	},
	{
		id: 't26',
		title: 'Molang "version" numbers',
		question: 'Which per-expression version index enables right-associative ternaries / && before ||?',
		assumption: 'version = index of the latest versioned change in effect (4 = 1.18.10, 5 = 1.18.20, 12 = 1.21.100).',
		formatVersion: '1.26.50',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'ternary, version 3: invisible → left-assoc (old)', effect: versioned('(1 ? 1 : 0 ? 0 : 0) * 0.3', 3) },
			{ id: 'p2', reads: 'ternary, version 4: visible → right-assoc (1.18.10)', effect: versioned('(1 ? 1 : 0 ? 0 : 0) * 0.3', 4) },
			{ id: 'p3', reads: '&&/||, version 4: invisible → old grouping', effect: versioned('(0 && 1 || 1) * 0.3', 4) },
			{ id: 'p4', reads: '&&/||, version 5: visible → 1.18.20 grouping', effect: versioned('(0 && 1 || 1) * 0.3', 5) },
			{ id: 'p5', reads: 'version 12: visible', effect: versioned('(0 && 1 || 1) * 0.3', 12) },
			{ id: 'p6', reads: 'plain string in a 1.26.50 file: visible (pack min_engine_version 1.26.0)', effect: versioned('(0 && 1 || 1) * 0.3', null) },
		],
	},
	{
		id: 't27',
		title: 'Billboard size scale',
		question: 'Is billboard size a half-extent? (size 0.5 should match the 1-block reference beside it)',
		assumption: 'size is the half width/height of the quad.',
		wait: 2,
		probes: [{ id: 'p1', reads: 'Compare with the white block to its right.', effect: probe({}, { size: 0.5, facing: 'rotate_xyz' }), blocks: [{ dx: 1.5, dy: 1, dz: 0, block: 'white_concrete' }] }],
	},
	// ------------------------------------------------------------ follow-up round (after the 1.26.52 run)
	{
		id: 't28',
		title: 'Value of a field whose Molang fails to parse',
		question: 'What does an expression with a syntax error evaluate to?',
		assumption: 'Parse errors fall back to 1.0 (from t03).',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Width with a broken X (height 0.2): wide like p2 → fallback 1.0.', effect: probe({}, { size: ['0.5 +* 1', 0.2] }) },
			{ id: 'p2', reads: 'Control: size [1.0, 0.2].', effect: probe({}, { size: [1, 0.2] }) },
			{ id: 'p3', reads: 'Broken height (width 0.2): tall → 1.0.', effect: probe({}, { size: [0.2, '0.2 +* 1'] }) },
			{ id: 'p4', reads: 'Tint [broken, 0, 0, 1]: red → R fell back to 1.0; black → 0.', effect: probe({}, { tint: ['1 +* 2', 0, 0, 1] }) },
			{ id: 'p5', reads: 'relative_position [broken, 0, 0]: shifted 1 block toward +X (screen-left) → 1.0.', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: ['1 +* 2', 0, 0] } }) },
			{ id: 'p6', reads: 'Unknown query in size X: wide → also 1.0.', effect: probe({}, { size: ['q.oxygen_unknown', 0.2] }) },
			{ id: 'p7', reads: 'Unset variable at runtime in size X: invisible (abort → 0) — contrast with p1.', effect: probe({}, { size: ['v.unset_k', 0.2] }) },
			{ id: 'p8', reads: 'Visible → valid statements in an expression that also has a syntax error still run.', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: 'v.ok = 1; v.x = 1 +* 2;' } }, { size: show('(v.ok ?? 0) == 1') }) },
		],
	},
	{
		id: 't29',
		title: 'Particle counter calibration and cap',
		question: 'Does the update-index counter work, and how many particles can one emitter hold?',
		assumption: '10,000 per emitter (user report).',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'idx 0 of 100 (counter works).', effect: capProbe(100, 0) },
			{ id: 'p2', reads: 'idx 99 of 100.', effect: capProbe(100, 99) },
			{ id: 'p3', reads: 'idx 100 of 100 → must be invisible.', effect: capProbe(100, 100) },
			{ id: 'p4', reads: 'idx 999 of 20000.', effect: capProbe(20000, 999) },
			{ id: 'p5', reads: 'idx 4999 of 20000.', effect: capProbe(20000, 4999) },
			{ id: 'p6', reads: 'idx 7999 of 20000.', effect: capProbe(20000, 7999) },
			{ id: 'p7', reads: 'idx 9999 of 20000 (10,000th particle).', effect: capProbe(20000, 9999) },
			{ id: 'p8', reads: 'idx 10000 of 20000 (10,001st).', effect: capProbe(20000, 10000) },
			{ id: 'p9', reads: 'idx 8999 of 9000.', effect: capProbe(9000, 8999) },
		],
	},
	{
		id: 't30',
		title: 'Temp scope',
		question: 'Are t.* values shared between different emitters, and do they reach event expressions?',
		assumption: 'Temps persist (from t05); scope unknown.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Writer (invisible, sets t.cross = 1 every update).', effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: 't.cross = 1;' } }, { size: 0 }) },
			{ id: 'p2', reads: 'Visible → a DIFFERENT emitter reads t.cross written by p1 (temps are global).', effect: probe({}, { size: show('(t.cross ?? 0) == 1') }) },
			{ id: 'p3', reads: 'Visible → a temp set in creation_expression is readable in a creation event.', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.preset = 1;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: show('(v.before ?? 0) == 1') }) },
		],
	},
	{
		id: 't31',
		title: 'Loops and bursts',
		question: 'How many loops happen, does each loop burst, and does creation re-run?',
		assumption: 'Instant bursts once per loop; creation re-runs each loop; emitter_age resets per loop.',
		wait: 4.2,
		probes: [
			{ id: 'p1', reads: 'Looping active 0.5 sleep 0.5 + instant: one dot per burst, spread by loop count toward +X.', effect: loopProbe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0.5 } }) },
			{ id: 'p2', reads: 'Same with a steady rate (4/s): a column of dots per active period.', effect: loopProbe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0.5 }, 'minecraft:emitter_rate_steady': { spawn_rate: 4, max_particles: 100 } }) },
			{ id: 'p3', reads: 'Looping active 0.5 sleep 0 + instant.', effect: loopProbe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0 } }) },
			{ id: 'p4', reads: 'Several dots spread out → creation_expression re-runs each loop.', effect: probe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0.5 }, 'minecraft:emitter_initialization': { creation_expression: 'v.n = (v.n ?? -1) + 1;' }, 'minecraft:emitter_shape_point': { offset: ['v.n * 0.4', 0, 0] } }, { size: 0.1 }) },
			{ id: 'p5', reads: 'Dots at different heights → emitter randoms re-roll per loop.', effect: probe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0.5 }, 'minecraft:emitter_shape_point': { offset: [0, 'v.emitter_random_1 * 2', 0] } }, { size: 0.1 }) },
		],
	},
	{
		id: 't32',
		title: 'math.sign and friends at the edges',
		question: 'What does math.sign(0) return, and how do clamp/mod behave at the edges?',
		assumption: 'Docs say sign(0) = -1; t19 says no.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'math.sign(0) == 0', effect: probe({}, { size: show('math.sign(0) == 0') }) },
			{ id: 'p2', reads: 'math.sign(0) == 1', effect: probe({}, { size: show('math.sign(0) == 1') }) },
			{ id: 'p3', reads: 'math.sign(0) == -1', effect: probe({}, { size: show('math.sign(0) == -1') }) },
			{ id: 'p4', reads: 'math.sign(-0.0001) == -1', effect: probe({}, { size: show('math.sign(-0.0001) == -1') }) },
			{ id: 'p5', reads: 'math.sign(0.0001) == 1', effect: probe({}, { size: show('math.sign(0.0001) == 1') }) },
			{ id: 'p6', reads: 'math.copy_sign(2, 0) == 2', effect: probe({}, { size: show('math.copy_sign(2, 0) == 2') }) },
			{ id: 'p7', reads: 'math.clamp(5, 3, 1) == 1 (min > max clamps to max)', effect: probe({}, { size: show('math.clamp(5, 3, 1) == 1') }) },
			{ id: 'p8', reads: 'math.mod(5, 0) == 0', effect: probe({}, { size: show('math.mod(5, 0) == 0') }) },
		],
	},
	{
		id: 't33',
		title: 'Molang version thresholds',
		question: 'At which per-expression version do the ternary and &&/|| fixes apply?',
		assumption: 'Unknown — versions 4 and 5 still used old rules.',
		formatVersion: '1.26.50',
		wait: 2,
		probes: [
			...[6, 7, 8, 9, 10, 11].map((v) => ({ id: `p${v - 5}`, reads: `ternary, version ${v}: visible → right-assoc`, effect: versioned('(1 ? 1 : 0 ? 0 : 0) * 0.3', v) })),
			...[6, 7, 8, 9, 10, 11].map((v) => ({ id: `p${v + 1}`, reads: `&&/||, version ${v}: visible → new grouping`, effect: versioned('(0 && 1 || 1) * 0.3', v) })),
		],
	},
	{
		id: 't38',
		title: 'Looping by spawn context',
		question: 'Do looping emitters loop when spawned by /particle vs the Script API?',
		assumption: 't31 suggests /particle emitters never restart.',
		wait: 4.2,
		probes: [
			{ id: 'p1', reads: '/particle: one dot → no looping.', effect: loopProbe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0.5 } }) },
			{ id: 'p2', reads: 'Script API: several dots → loops.', effect: loopProbe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0.5 } }), script: { vars: {} } },
			{ id: 'p3', reads: 'Script API, steady 4/s: dots in several columns → loops.', effect: loopProbe({ 'minecraft:emitter_lifetime_looping': { active_time: 0.5, sleep_time: 0.5 }, 'minecraft:emitter_rate_steady': { spawn_rate: 4, max_particles: 100 } }), script: { vars: {} } },
		],
	},
	{
		id: 't39',
		title: 'Particle cap, fine search',
		question: 'Exactly how many particles can one emitter hold (instant burst vs steady accumulation)?',
		assumption: 'Between 1,000 and 5,000 (t29).',
		wait: 3,
		probes: [
			{ id: 'p1', reads: 'instant 20000 → idx 1499', effect: capProbe(20000, 1499) },
			{ id: 'p2', reads: 'instant 20000 → idx 1999', effect: capProbe(20000, 1999) },
			{ id: 'p3', reads: 'instant 20000 → idx 2047', effect: capProbe(20000, 2047) },
			{ id: 'p4', reads: 'instant 20000 → idx 2048', effect: capProbe(20000, 2048) },
			{ id: 'p5', reads: 'instant 20000 → idx 2999', effect: capProbe(20000, 2999) },
			{ id: 'p6', reads: 'instant 20000 → idx 3999', effect: capProbe(20000, 3999) },
			{ id: 'p7', reads: 'instant 20000 → idx 4095', effect: capProbe(20000, 4095) },
			{ id: 'p8', reads: 'instant 20000 → idx 4096', effect: capProbe(20000, 4096) },
			{ id: 'p9', reads: 'steady 5000/s, max 20000, 3 s → idx 4999 (accumulated over time)', effect: steadyCapProbe(4999) },
			{ id: 'p10', reads: 'steady 5000/s → idx 9999', effect: steadyCapProbe(9999) },
			{ id: 'p11', reads: 'steady 5000/s → idx 10000', effect: steadyCapProbe(10000) },
		],
	},
	{
		id: 't40',
		title: 'Global particle budget (run alone, world empty)',
		question: 'Is the limit global? p1 rises to q.total_particle_count / 1000 blocks; p2 marks every 1000th particle of one 30k burst.',
		assumption: 'Unknown: per-emitter vs global.',
		wait: 3,
		probes: [
			{ id: 'p1', reads: 'Height (blocks above the probe) = total particles in thousands.', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, 'q.total_particle_count / 1000', 0] } }, { size: 0.2, lifetime: 20, facing: 'rotate_xyz' }) },
			{
				id: 'p2',
				reads: 'Dots every 1000th particle (x = thousands, toward +X / screen-left): count dots = capacity in thousands.',
				effect: probe(
					{
						'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
						'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
						'minecraft:particle_motion_parametric': { relative_position: ['math.floor(v.idx / 1000) * 0.5', 'math.mod(v.idx, 1000) == 999 ? 0 : -4', 0] },
					},
					{ count: 30000, size: 0.12, lifetime: 20 },
				),
			},
		],
	},
	{
		id: 't41',
		title: 'Steady accumulation cap (run alone)',
		question: 'How many particles does a steady emitter accumulate (dots every 1000th particle)?',
		assumption: 'Per-emitter cap 10,000 (user report).',
		wait: 4,
		probes: [
			{ id: 'p1', reads: 'Height = total particles in thousands.', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, 'q.total_particle_count / 1000', 0] } }, { size: 0.2, lifetime: 20, facing: 'rotate_xyz' }) },
			{
				id: 'p2',
				reads: 'steady 100000/s, max 20000: count dots (x = thousands toward +X) = capacity in thousands.',
				effect: probe(
					{
						'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
						'minecraft:emitter_rate_steady': { spawn_rate: 100000, max_particles: 20000 },
						'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
						'minecraft:particle_motion_parametric': { relative_position: ['math.floor(v.idx / 1000) * 0.5', 'math.mod(v.idx, 1000) == 999 ? 0 : -4', 0] },
					},
					{ size: 0.12, lifetime: 20, activeTime: 10 },
				),
			},
		],
	},
	{
		id: 't42',
		title: 'Instant burst cap, exact (run alone)',
		question: 'Which of the indices 999, 1000, 1023, 1024, 1100, 1250, 1499 exist in one 30k burst? (dot k at x = k·0.5 toward +X)',
		assumption: 'Burst capped near 1000.',
		wait: 2,
		probes: [
			{
				id: 'p1',
				reads: 'Dots left→right on screen are k=6…0 (k=0 rightmost): idx 999, 1000, 1023, 1024, 1100, 1250, 1499.',
				effect: probe(
					{
						'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
						'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
						'minecraft:particle_motion_parametric': {
							relative_position: [
								'v.k = v.idx == 999 ? 0 : (v.idx == 1000 ? 1 : (v.idx == 1023 ? 2 : (v.idx == 1024 ? 3 : (v.idx == 1100 ? 4 : (v.idx == 1250 ? 5 : (v.idx == 1499 ? 6 : -1)))))); return v.k * 0.5;',
								'v.k < 0 ? -4 : 0',
								0,
							],
						},
					},
					{ count: 30000, size: 0.12, lifetime: 20 },
				),
			},
		],
	},
	{
		id: 't43',
		title: 'Per-emitter vs global cap (run alone)',
		question: 'Two emitters each request 1500 particles: is the total ~2000 (per-emitter cap 1000) or ~1000 (global)?',
		assumption: 'Cap 1000 per emitter (t41/t42).',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Height = total particles in thousands (~2 blocks → per-emitter, ~1 → global).', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, 'q.total_particle_count / 1000', 0] } }, { size: 0.2, lifetime: 20, facing: 'rotate_xyz' }) },
			{ id: 'p2', reads: 'Burst 1500 (parked under the floor).', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, -4, 0] } }, { count: 1500, size: 0.05, lifetime: 20 }) },
			{ id: 'p3', reads: 'Burst 1500 (parked under the floor).', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, -4, 0] } }, { count: 1500, size: 0.05, lifetime: 20 }) },
			{ id: 'p4', reads: 'Height = this effect\'s particle count in thousands (q.effect_particle_count).', effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, 'q.effect_particle_count / 1000', 0] } }, { size: 0.2, lifetime: 20, facing: 'rotate_xyz' }) },
		],
	},
	...(['direction_x', 'direction_y', 'direction_z', 'lookat_direction'] as const).map((mode, k) => ({
		id: `t${34 + k}`,
		title: `${mode} axis matrix`,
		question: `How does ${mode} orient the arrow texture for each axis direction?`,
		assumption: 'Skill axis table with a vertical fallback.',
		wait: 1.5,
		views: ['front', 'behind', 'above', 'frontleft', 'frontright'] as ('front' | 'behind' | 'above' | 'frontleft' | 'frontright')[],
		spacing: 3,
		probes: (
			[
				['p1', '+X', [1, 0, 0]],
				['p2', '-X', [-1, 0, 0]],
				['p3', '+Y', [0, 1, 0]],
				['p4', '-Y', [0, -1, 0]],
				['p5', '+Z', [0, 0, 1]],
				['p6', '-Z', [0, 0, -1]],
				['p7', 'zero', [0, 0, 0]],
			] as [string, string, [number, number, number]][]
		).map(([id, label, dir]) => ({ id, reads: `${mode}, direction ${label}`, effect: dirProbe(mode, dir) })),
	})),
	{
		id: 't44',
		title: 'Curves: clamping, Molang nodes, interpolation',
		question: 'How do curves treat inputs outside their range, Molang nodes (#110), each interpolation type, bezier_chain (#123), and are they set before creation_expression?',
		assumption: 'Linear clamps to its ends; nodes are Molang; catmull_rom uses the inner nodes; bezier is cubic; bezier_chain is Hermite and holds past its keys; curves are evaluated before creation.',
		wait: 2,
		probes: [
			{ id: 'p1', reads: 'Visible → linear clamps past the range (value 1); hidden → extrapolates (2).', effect: probe({}, { size: show('v.c > 0.9 && v.c < 1.1') }), curves: { 'variable.c': { type: 'linear', input: 2, horizontal_range: 1, nodes: [0, 1] } } },
			{ id: 'p2', reads: 'Visible → linear clamps before the range (value 1).', effect: probe({}, { size: show('v.c > 0.9 && v.c < 1.1') }), curves: { 'variable.c': { type: 'linear', input: -1, horizontal_range: 1, nodes: [1, 0] } } },
			{ id: 'p3', reads: 'Visible → a Molang node is evaluated (v.k = 1) (#110).', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.k = 1;' } }, { size: show('v.c > 0.9 && v.c < 1.1') }), curves: { 'variable.c': { type: 'linear', input: 0, horizontal_range: 1, nodes: ['v.k', 0] } } },
			{ id: 'p4', reads: 'Visible → catmull_rom of [0,0,1,1] at 0.5 is 0.5.', effect: probe({}, { size: show('v.c > 0.4 && v.c < 0.6') }), curves: { 'variable.c': { type: 'catmull_rom', input: 0.5, horizontal_range: 1, nodes: [0, 0, 1, 1] } } },
			{ id: 'p5', reads: 'Visible → bezier of [0,1,1,0] at 0.5 is 0.75.', effect: probe({}, { size: show('v.c > 0.7 && v.c < 0.8') }), curves: { 'variable.c': { type: 'bezier', input: 0.5, horizontal_range: 1, nodes: [0, 1, 1, 0] } } },
			{ id: 'p6', reads: 'Visible → bezier_chain with flat ends at 0.5 is 0.5 (#123).', effect: probe({}, { size: show('v.c > 0.45 && v.c < 0.55') }), curves: { 'variable.c': { type: 'bezier_chain', input: 0.5, nodes: { '0.0': { value: 0, slope: 0 }, '1.0': { value: 1, slope: 0 } } } } },
			{ id: 'p7', reads: 'Visible → bezier_chain holds its last value past the last key (#123).', effect: probe({}, { size: show('v.c > 0.9 && v.c < 1.1') }), curves: { 'variable.c': { type: 'bezier_chain', input: 2, nodes: { '0.0': { value: 0, slope: 0 }, '1.0': { value: 1, slope: 0 } } } } },
			{ id: 'p8', reads: 'Visible → curves are set before creation_expression runs; hidden → not yet.', effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 'v.k = v.c ?? -1;' } }, { size: show('v.k > 0.9') }), curves: { 'variable.c': { type: 'linear', input: 0, horizontal_range: 1, nodes: [1, 1] } } },
		],
	},
	{
		id: 't45',
		title: 'Float32 arithmetic',
		question: 'Does Molang compute in 32-bit floats?',
		assumption: 'Yes: values and operations round to float32 (Oxygen emulates this by default).',
		wait: 1,
		probes: [
			{ id: 'p1', reads: 'Visible → 0.1 + 0.2 == 0.3 (true in float32, false in doubles).', effect: probe({}, { size: show('0.1 + 0.2 == 0.3') }) },
			{ id: 'p2', reads: 'Visible → 16777216 + 1 == 16777216 (float32 has 24 bits of mantissa).', effect: probe({}, { size: show('16777216 + 1 == 16777216') }) },
			{ id: 'p3', reads: 'Visible → 0.1 * 3 == 0.3 (true in float32).', effect: probe({}, { size: show('0.1 * 3 == 0.3') }) },
			{ id: 'p4', reads: 'Control: always visible.', effect: probe({}, { size: show('1 + 1 == 2') }) },
		],
	},
	{
		id: 't46',
		title: 'Flipbook frames',
		question: 'Which frame does a flipbook show at a given age (looping, holding, stretched, and is max_frame a count)?',
		assumption: 'frame = floor(age * fps), held at max_frame - 1 without loop, wrapped with loop; stretch_to_lifetime spreads max_frame frames over the lifetime.',
		wait: 2.5,
		probes: [
			{ id: 'p1', reads: 'Visible → at 2.5 s with 1 fps it shows frame 2.', effect: flipbookProbe(2, { frames_per_second: 1, max_frame: 4, loop: false }), opaqueU0: 2 / 4 },
			{ id: 'p2', reads: 'Visible → with loop and max_frame 2 it is back on frame 0 at 2.5 s.', effect: flipbookProbe(0, { frames_per_second: 1, max_frame: 2, loop: true }), opaqueU0: 0 },
			{ id: 'p3', reads: 'Visible → without loop it holds the last frame (1).', effect: flipbookProbe(1, { frames_per_second: 1, max_frame: 2, loop: false }), opaqueU0: 1 / 4 },
			{ id: 'p4', reads: 'Visible → stretch_to_lifetime over 8 s shows frame 1 of 4 at 2.5 s.', effect: flipbookProbe(1, { frames_per_second: 1, max_frame: 4, stretch_to_lifetime: true, loop: false }, 8), opaqueU0: 1 / 4 },
			{ id: 'p5', reads: 'Visible → max_frame 3 ends on frame 2 (it is a count); hidden → it ends on frame 3.', effect: flipbookProbe(2, { frames_per_second: 10, max_frame: 3, loop: false }), opaqueU0: 2 / 4 },
		],
	},
	{
		id: 't47',
		title: 'Emitter culling',
		question: 'What stops while an emitter is out of view: render preparation (per_render, size, colour), particle updates, emitter updates?',
		assumption: 'A culled emitter skips render preparation only; emitter and particle updates carry on (particles never cull individually).',
		wait: 5,
		lookAway: { after: 1, seconds: 3 },
		probes: [
			{
				id: 'p1',
				reads: 'Visible → per_render stopped while out of view (the longest gap between render passes is over 1.5 s).',
				effect: probe({ 'minecraft:particle_initialization': { per_render_expression: 'v.gap = math.max(v.gap ?? 0, v.particle_age - (v.last ?? v.particle_age)); v.last = v.particle_age;' } }, { size: show('v.gap > 1.5') }),
			},
			{ id: 'p2', reads: 'Visible → particles kept ageing while out of view (age over 3.5 s at the screenshot).', effect: probe({}, { size: show('v.particle_age > 3.5') }) },
			{
				id: 'p3',
				reads: 'Visible → emitter updates stopped (or jumped) while out of view; hidden → they ran every frame.',
				effect: probe({ 'minecraft:emitter_initialization': { per_update_expression: 'v.egap = math.max(v.egap ?? 0, v.emitter_age - (v.elast ?? v.emitter_age)); v.elast = v.emitter_age;' } }, { size: show('v.egap > 1.5'), activeTime: 20 }),
			},
			{ id: 'p4', reads: 'Control: always visible.', effect: probe({}, { size: show('1') }) },
		],
	},
	{
		id: 't48',
		title: 'Event node order and random choices',
		question: 'In what order does one event node run its parts, and how does randomize treat weights of 0, negative weights and all-zero weights?',
		assumption: 'A node runs its sequence, then one random option, then its expression, sound and spawn; options weighted 0 or less are never picked, an all-zero randomize picks nothing, and weights are proportional.',
		wait: 2,
		probes: [
			{
				id: 'p1',
				reads: "Visible → a node runs its expression before its particle_effect (the child's pre-effect reads 1).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.o1 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { expression: 't.o1 = 1;', particle_effect: { effect: 'oxygen:t48_p1_child', type: 'emitter', pre_effect_expression: 'v.got = t.o1 ?? -1;' } } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 1') }) },
			},
			{
				id: 'p2',
				reads: "Visible → a node runs its sequence before its own expression (the child reads 1, not 2).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.o2 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { sequence: [{ expression: 't.o2 = 2;' }], expression: 't.o2 = 1;', particle_effect: { effect: 'oxygen:t48_p2_child', type: 'emitter', pre_effect_expression: 'v.got = t.o2 ?? -1;' } } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 1') }) },
			},
			{
				id: 'p3',
				reads: 'Visible → sequence steps run in order (the spawn in step 1 reads the value from before step 2).',
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.o3 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { sequence: [{ particle_effect: { effect: 'oxygen:t48_p3_child', type: 'emitter', pre_effect_expression: 'v.got = t.o3 ?? -1;' } }, { expression: 't.o3 = 1;' }] } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 0') }) },
			},
			{
				id: 'p4',
				reads: 'Visible → an option with weight 0 was picked at least once in 30 tries.',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'r' } }, { size: 0, count: 30 }),
				events: { r: { randomize: [{ weight: 0, particle_effect: { effect: 'oxygen:t48_p4_child', type: 'emitter' } }, { weight: 1 }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'p5',
				reads: 'Visible → an option with a negative weight was picked at least once in 30 tries.',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'r' } }, { size: 0, count: 30 }),
				events: { r: { randomize: [{ weight: -1, particle_effect: { effect: 'oxygen:t48_p5_child', type: 'emitter' } }, { weight: 1 }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'p6',
				reads: 'Visible → a randomize whose only option weighs 0 still picks it.',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'r' } }, { size: 0, count: 30 }),
				events: { r: { randomize: [{ weight: 0, particle_effect: { effect: 'oxygen:t48_p6_child', type: 'emitter' } }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'p7',
				reads: 'Control: equal weights → visible (picked about half of 30 tries).',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'r' } }, { size: 0, count: 30 }),
				events: { r: { randomize: [{ weight: 1, particle_effect: { effect: 'oxygen:t48_p7_child', type: 'emitter' } }, { weight: 1 }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'p8',
				reads: 'Hidden → weights are proportional (0.001 against 1000 is never picked in 30 tries); visible → they are not.',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'r' } }, { size: 0, count: 30 }),
				events: { r: { randomize: [{ weight: 0.001, particle_effect: { effect: 'oxygen:t48_p8_child', type: 'emitter' } }, { weight: 1000 }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
		],
	},
	{
		id: 't49',
		title: 'Event nodes: what runs (diagnostics for t48)',
		question: 'When one node has both an expression and a particle_effect, which run and in what order? Do particle creation events and randomize spawn children?',
		assumption: 'Both run, the expression first; particle creation events and randomize options spawn their children.',
		wait: 2,
		probes: [
			{
				id: 'q1',
				reads: "Visible → in a node with an expression and a particle_effect, the child's pre-effect sees the value from before the expression (the spawn runs first).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.q1 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { expression: 't.q1 = 1;', particle_effect: { effect: 'oxygen:t49_q1_child', type: 'emitter', pre_effect_expression: 'v.got = t.q1 ?? -1;' } } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 0') }) },
			},
			{
				id: 'q2',
				reads: 'Visible → that node spawns its child at all.',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { expression: 't.q2 = 1;', particle_effect: { effect: 'oxygen:t49_q2_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'q3',
				reads: "Visible → that node's expression runs too (it sets the emitter's v.flag).",
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: show('(v.flag ?? 0) == 1') }),
				events: { go: { expression: 'v.flag = 1;', particle_effect: { effect: 'oxygen:t49_q3_child', type: 'emitter' } } },
				children: { child: probe({}, { size: 0 }) },
			},
			{
				id: 'q4',
				reads: 'Visible → a particle creation event spawns its child.',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'r' } }, { size: 0 }),
				events: { r: { particle_effect: { effect: 'oxygen:t49_q4_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'q5',
				reads: 'Visible → randomize with one option spawns from an emitter event.',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { randomize: [{ weight: 1, particle_effect: { effect: 'oxygen:t49_q5_child', type: 'emitter' } }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'q6',
				reads: 'Visible → randomize with one option spawns from a particle event.',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'r' } }, { size: 0 }),
				events: { r: { randomize: [{ weight: 1, particle_effect: { effect: 'oxygen:t49_q6_child', type: 'emitter' } }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
		],
	},
	{
		id: 't50',
		title: 'Event nodes: order of parts, particle events, weights',
		question: 'Where do a node\'s sequence and randomize run relative to its spawn? Which particle events spawn children? How are randomize weights of 0 and all-zero treated, and are weights proportional?',
		assumption: 'To be measured (t49: a node spawns before its own expression; particle creation events spawn nothing).',
		wait: 2,
		probes: [
			{
				id: 'r1',
				reads: "Visible → a node's sequence runs before its spawn (the child reads 2).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.r1 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { sequence: [{ expression: 't.r1 = 2;' }], particle_effect: { effect: 'oxygen:t50_r1_child', type: 'emitter', pre_effect_expression: 'v.got = t.r1 ?? -1;' } } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 2') }) },
			},
			{
				id: 'r2',
				reads: "Visible → a node's spawn runs before its sequence (the child reads 0).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.r2 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { sequence: [{ expression: 't.r2 = 2;' }], particle_effect: { effect: 'oxygen:t50_r2_child', type: 'emitter', pre_effect_expression: 'v.got = t.r2 ?? -1;' } } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 0') }) },
			},
			{
				id: 'r3',
				reads: "Visible → a node's randomize runs before its spawn (the child reads 3).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.r3 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { randomize: [{ weight: 1, expression: 't.r3 = 3;' }], particle_effect: { effect: 'oxygen:t50_r3_child', type: 'emitter', pre_effect_expression: 'v.got = t.r3 ?? -1;' } } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 3') }) },
			},
			{
				id: 'r4',
				reads: 'Visible → a particle creation event runs its expression (it sets the emitter\'s v.pc).',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'c' } }, { size: show('(v.pc ?? 0) == 1') }),
				events: { c: { expression: 'v.pc = 1;' } },
			},
			{
				id: 'r5',
				reads: 'Visible → a particle expiration event spawns its child (control).',
				effect: probe({ 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, lifetime: 0.2 }),
				events: { x: { particle_effect: { effect: 'oxygen:t50_r5_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'r6',
				reads: 'Visible → a particle timeline event spawns its child.',
				effect: probe({ 'minecraft:particle_lifetime_events': { timeline: { '0.2': 't' } } }, { size: 0 }),
				events: { t: { particle_effect: { effect: 'oxygen:t50_r6_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'r7',
				reads: 'Visible → a particle creation event spawns a single-particle child (type particle).',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'c' } }, { size: 0 }),
				events: { c: { particle_effect: { effect: 'oxygen:t50_r7_child', type: 'particle' } } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'r8',
				reads: 'Visible → an option weighing 0 was picked at least once in 30 expiration events.',
				effect: probe({ 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, count: 30, lifetime: 0.2 }),
				events: { x: { randomize: [{ weight: 0, particle_effect: { effect: 'oxygen:t50_r8_child', type: 'emitter' } }, { weight: 1 }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'r9',
				reads: 'Visible → a randomize whose only option weighs 0 still picks it.',
				effect: probe({ 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, count: 30, lifetime: 0.2 }),
				events: { x: { randomize: [{ weight: 0, particle_effect: { effect: 'oxygen:t50_r9_child', type: 'emitter' } }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'r10',
				reads: 'Control: equal weights over 30 expiration events → visible.',
				effect: probe({ 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, count: 30, lifetime: 0.2 }),
				events: { x: { randomize: [{ weight: 1, particle_effect: { effect: 'oxygen:t50_r10_child', type: 'emitter' } }, { weight: 1 }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 'r11',
				reads: 'Hidden → weights are proportional (0.001 against 1000 never picked in 30); visible → they are not.',
				effect: probe({ 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, count: 30, lifetime: 0.2 }),
				events: { x: { randomize: [{ weight: 0.001, particle_effect: { effect: 'oxygen:t50_r11_child', type: 'emitter' } }, { weight: 1000 }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
		],
	},
	{
		id: 't51',
		title: 'Event nodes: which keys run together',
		question: 'Does a node with a sequence or randomize also run its own expression and particle_effect? Can a node have both a sequence and a randomize? With all weights 0, which option is picked?',
		assumption: 'To be measured (t50: a node with a sequence or randomize did not spawn its own particle_effect).',
		wait: 2,
		probes: [
			{
				id: 's1',
				reads: "Visible → a node with a sequence still runs its own expression (it sets the emitter's v.b1).",
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: show('(v.b1 ?? 0) == 1') }),
				events: { go: { sequence: [{ expression: 'v.a1 = 1;' }], expression: 'v.b1 = 1;' } },
			},
			{
				id: 's2',
				reads: 'Visible → a node with a sequence still spawns its own particle_effect.',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { sequence: [{ expression: 'v.a2 = 1;' }], particle_effect: { effect: 'oxygen:t51_s2_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 's3',
				reads: 'Visible → a node with a randomize still spawns its own particle_effect.',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { randomize: [{ weight: 1, expression: 'v.a3 = 1;' }], particle_effect: { effect: 'oxygen:t51_s3_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 's4',
				reads: "Visible → a node with a randomize still runs its own expression (v.b4).",
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: show('(v.b4 ?? 0) == 1') }),
				events: { go: { randomize: [{ weight: 1, expression: 'v.a4 = 1;' }], expression: 'v.b4 = 1;' } },
			},
			{
				id: 's5',
				reads: 'Visible → a node with both runs its sequence (which spawns the child).',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { sequence: [{ particle_effect: { effect: 'oxygen:t51_s5_child', type: 'emitter' } }], randomize: [{ weight: 1, expression: 'v.a5 = 1;' }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 's6',
				reads: 'Visible → a node with both runs its randomize (v.r6).',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: show('(v.r6 ?? 0) == 1') }),
				events: { go: { sequence: [{ expression: 'v.a6 = 1;' }], randomize: [{ weight: 1, expression: 'v.r6 = 1;' }] } },
			},
			{
				id: 's7',
				reads: 'Visible → with weights 0 and 0, the first option gets picked (30 tries).',
				effect: probe({ 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, count: 30, lifetime: 0.2 }),
				events: { x: { randomize: [{ weight: 0, particle_effect: { effect: 'oxygen:t51_s7_child', type: 'emitter' } }, { weight: 0 }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
			{
				id: 's8',
				reads: 'Visible → with weights 0 and 0, the second option gets picked too (30 tries).',
				effect: probe({ 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, count: 30, lifetime: 0.2 }),
				events: { x: { randomize: [{ weight: 0 }, { weight: 0, particle_effect: { effect: 'oxygen:t51_s8_child', type: 'emitter' } }] } },
				children: { child: probe({}, { size: show('1') }) },
			},
		],
	},
	{
		id: 't52',
		title: 'Event nodes: creation-event children and sequence vs randomize order',
		question: 'Is a child spawned by a particle creation event created at all (somewhere out of view)? In a node with both, does the sequence or the randomize run first, and does key order matter?',
		assumption: 'To be measured. u0 watches the temp that u1\'s child sets when it is created (temps are global).',
		wait: 2,
		probes: [
			{
				id: 'u0',
				reads: "Visible → the child u1's particle creation event spawns was created somewhere (its creation_expression set t.u1).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.u1 = 0;', per_update_expression: 'v.seen = t.u1 ?? 0;' } }, { size: show('v.seen == 1'), activeTime: 10 }),
			},
			{
				id: 'u1',
				reads: 'Spawns a child from a particle creation event (read u0).',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'c' } }, { size: 0 }),
				events: { c: { particle_effect: { effect: 'oxygen:t52_u1_child', type: 'emitter' } } },
				children: { child: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.u1 = 1;' } }, { size: 0 }) },
			},
			{
				id: 'u2',
				reads: "Visible → in a node with both, the sequence runs before the randomize (the randomize's spawn reads 1).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.u2 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { sequence: [{ expression: 't.u2 = 1;' }], randomize: [{ weight: 1, particle_effect: { effect: 'oxygen:t52_u2_child', type: 'emitter', pre_effect_expression: 'v.got = t.u2 ?? -1;' } }] } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 1') }) },
			},
			{
				id: 'u3',
				reads: "Visible → the randomize runs before the sequence (the sequence's spawn reads 1), sequence listed first.",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.u3 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { sequence: [{ particle_effect: { effect: 'oxygen:t52_u3_child', type: 'emitter', pre_effect_expression: 'v.got = t.u3 ?? -1;' } }], randomize: [{ weight: 1, expression: 't.u3 = 1;' }] } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 1') }) },
			},
			{
				id: 'u4',
				reads: 'Visible → the randomize runs before the sequence when it is listed first.',
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.u4 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { randomize: [{ weight: 1, expression: 't.u4 = 1;' }], sequence: [{ particle_effect: { effect: 'oxygen:t52_u4_child', type: 'emitter', pre_effect_expression: 'v.got = t.u4 ?? -1;' } }] } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 1') }) },
			},
			{
				id: 'u5',
				reads: 'Visible → a leaf node spawns before its expression also when the particle_effect is listed first.',
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.u5 = 0;' }, 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { particle_effect: { effect: 'oxygen:t52_u5_child', type: 'emitter', pre_effect_expression: 'v.got = t.u5 ?? -1;' }, expression: 't.u5 = 1;' } },
				children: { child: probe({}, { size: show('(v.got ?? -1) == 0') }) },
			},
		],
	},
	{
		id: 't53',
		title: 'Where a particle creation event spawns its child',
		question: 'A particle creation event creates its child (t52 u0), but not next to the particle. Where?',
		assumption: 'To be measured: look at the world origin after spawning (tp @s 4 2 4 facing 0 0 0).',
		wait: 1.5,
		probes: [
			{
				id: 'v1',
				reads: 'Visible here → the child spawns at the particle. Otherwise look for it at the world origin.',
				effect: probe({ 'minecraft:particle_lifetime_events': { creation_event: 'c' } }, { size: 0 }),
				events: { c: { particle_effect: { effect: 'oxygen:t53_v1_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1'), lifetime: 120 }) },
			},
		],
	},
	{
		id: 't54',
		title: 'emitter_bound children',
		question: 'Does an emitter_bound child stop when its parent emitter ends?',
		assumption: 'No: binding only makes the child follow its parent; it keeps its own lifetime (measured: it carries on after the parent ends or is gone).',
		wait: 3,
		probes: [
			{
				id: 'w1',
				reads: "Visible → a bound child still spawns at 3 s, after its parent ended at 1 s (it doesn't end with the parent).",
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0, activeTime: 1 }),
				events: { go: { particle_effect: { effect: 'oxygen:t54_w1_child', type: 'emitter_bound' } } },
				children: { child: probe({ 'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 } }, { size: show('v.particle_age < 0.5'), activeTime: 10, lifetime: 10 }) },
			},
			{
				id: 'w3',
				reads: 'Visible → a bound child still spawns at 3 s after its parent is gone entirely (no particles left at 1 s).',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0, activeTime: 1, lifetime: 0.3 }),
				events: { go: { particle_effect: { effect: 'oxygen:t54_w3_child', type: 'emitter_bound' } } },
				children: { child: probe({ 'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 } }, { size: show('v.particle_age < 0.5'), activeTime: 10, lifetime: 10 }) },
			},
			{
				id: 'w2',
				reads: 'Control: an unbound child still spawns at 3 s → visible.',
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0, activeTime: 1 }),
				events: { go: { particle_effect: { effect: 'oxygen:t54_w2_child', type: 'emitter' } } },
				children: { child: probe({ 'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 } }, { size: show('v.particle_age < 0.5'), activeTime: 10, lifetime: 10 }) },
			},
		],
	},
	{
		id: 't55',
		title: 'particle_with_velocity',
		question: "Does a particle_with_velocity child inherit the firing particle's velocity?",
		assumption: "Measured: single-particle children don't appear at the particle at all (they go to the world origin, t56), so their velocity can't be read here; x4 checks the kill plane setup with an emitter child.",
		wait: 2.5,
		probes: [
			{
				id: 'x1',
				reads: "Visible → the child did NOT inherit the parent's upward velocity (it never reached its kill plane half a block up).",
				effect: probe({ 'minecraft:emitter_shape_point': { direction: [0, 1, 0] }, 'minecraft:particle_initial_speed': 1, 'minecraft:particle_motion_dynamic': {}, 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, lifetime: 0.5 }),
				events: { x: { particle_effect: { effect: 'oxygen:t55_x1_child', type: 'particle_with_velocity' } } },
				children: { child: probe({ 'minecraft:particle_kill_plane': [0, 1, 0, -0.5], 'minecraft:particle_motion_dynamic': {} }, { size: show('1'), lifetime: 10 }) },
			},
			{
				id: 'x2',
				reads: "Control: a 'particle' child starts still → visible.",
				effect: probe({ 'minecraft:emitter_shape_point': { direction: [0, 1, 0] }, 'minecraft:particle_initial_speed': 1, 'minecraft:particle_motion_dynamic': {}, 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, lifetime: 0.5 }),
				events: { x: { particle_effect: { effect: 'oxygen:t55_x2_child', type: 'particle' } } },
				children: { child: probe({ 'minecraft:particle_kill_plane': [0, 1, 0, -0.5], 'minecraft:particle_motion_dynamic': {} }, { size: show('1'), lifetime: 10 }) },
			},
			{
				id: 'x3',
				reads: "Visible → a 'particle' child shows at all (no kill plane).",
				effect: probe({ 'minecraft:emitter_shape_point': { direction: [0, 1, 0] }, 'minecraft:particle_initial_speed': 1, 'minecraft:particle_motion_dynamic': {}, 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, lifetime: 0.5 }),
				events: { x: { particle_effect: { effect: 'oxygen:t55_x3_child', type: 'particle' } } },
				children: { child: probe({ 'minecraft:particle_motion_dynamic': {} }, { size: show('1'), lifetime: 10 }) },
			},
			{
				id: 'x4',
				reads: "Visible → an 'emitter' child with the same kill plane survives (it starts still).",
				effect: probe({ 'minecraft:emitter_shape_point': { direction: [0, 1, 0] }, 'minecraft:particle_initial_speed': 1, 'minecraft:particle_motion_dynamic': {}, 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, lifetime: 0.5 }),
				events: { x: { particle_effect: { effect: 'oxygen:t55_x4_child', type: 'emitter' } } },
				children: { child: probe({ 'minecraft:particle_kill_plane': [0, 1, 0, -0.5], 'minecraft:particle_motion_dynamic': {} }, { size: show('1'), lifetime: 10 }) },
			},
		],
	},
	{
		id: 't56',
		title: "Where a 'particle' spawn goes",
		question: "A 'particle' (or particle_with_velocity) spawn from an expiration event doesn't appear at the particle (t55). Does it exist, and where?",
		assumption: 'To be measured. y0 watches a temp the child particle sets every update; then look at the world origin (tp @s 4 1 4 facing 0 0 0).',
		wait: 2,
		probes: [
			{
				id: 'y0',
				reads: "Visible → y1's 'particle' child exists somewhere (its update set t.y1).",
				effect: probe({ 'minecraft:emitter_initialization': { creation_expression: 't.y1 = 0;', per_update_expression: 'v.seen = t.y1 ?? 0;' } }, { size: show('v.seen == 1'), activeTime: 10 }),
			},
			{
				id: 'y1',
				reads: "Spawns a 'particle' child from an expiration event (read y0).",
				effect: probe({ 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, lifetime: 0.3 }),
				events: { x: { particle_effect: { effect: 'oxygen:t56_y1_child', type: 'particle' } } },
				children: { child: probe({ 'minecraft:particle_initialization': { per_update_expression: 't.y1 = 1;' } }, { size: show('1'), lifetime: 120 }) },
			},
		],
	},
	{
		id: 't57',
		title: "'particle' spawns from emitter events",
		question: "Does a 'particle' spawn from an emitter event appear at the emitter?",
		assumption: 'To be measured (from particle events it appears at the world origin, t56).',
		wait: 1.5,
		probes: [
			{
				id: 'z1',
				reads: "Visible → a 'particle' spawn from an emitter creation event appears at the emitter.",
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { particle_effect: { effect: 'oxygen:t57_z1_child', type: 'particle' } } },
				children: { child: probe({}, { size: show('1'), lifetime: 10 }) },
			},
			{
				id: 'z2',
				reads: "Control: an 'emitter' spawn from the same event → visible.",
				effect: probe({ 'minecraft:emitter_lifetime_events': { creation_event: 'go' } }, { size: 0 }),
				events: { go: { particle_effect: { effect: 'oxygen:t57_z2_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1'), lifetime: 10 }) },
			},
		],
	},
	{
		id: 't58',
		title: 'Origin spawns: exactly the origin, or the particle\'s offset from its emitter?',
		question: "Do the misplaced spawns (t53, t56) land exactly at the world origin, or at the firing particle's position relative to its emitter, taken as a world position?",
		assumption: 'Measured: a2 lands at (3, 0, 0), its particle\'s offset from the emitter taken as a world position; a1 (a single-particle spawn) at the origin regardless of its particle\'s 3-block offset. Seen from tp 8 2 8 facing 1.5 1.5 0 and tp 3 -1 6 facing 3 0 0, with a reference particle at 0 0 0.',
		wait: 1.5,
		probes: [
			{
				id: 'a1',
				reads: "Look near the origin: a 'particle' spawn from an expiration event, its particle 3 blocks above the emitter.",
				effect: probe({ 'minecraft:emitter_shape_point': { offset: [0, 3, 0] }, 'minecraft:particle_lifetime_events': { expiration_event: 'x' } }, { size: 0, lifetime: 0.3 }),
				events: { x: { particle_effect: { effect: 'oxygen:t58_a1_child', type: 'particle' } } },
				children: { child: probe({}, { size: show('1'), lifetime: 120 }) },
			},
			{
				id: 'a2',
				reads: "Look near the origin: an 'emitter' spawn from a creation event, its particle 3 blocks along +x from the emitter.",
				effect: probe({ 'minecraft:emitter_shape_point': { offset: [3, 0, 0] }, 'minecraft:particle_lifetime_events': { creation_event: 'c' } }, { size: 0 }),
				events: { c: { particle_effect: { effect: 'oxygen:t58_a2_child', type: 'emitter' } } },
				children: { child: probe({}, { size: show('1'), lifetime: 120 }) },
			},
		],
	},
	{
		id: 't59',
		title: 'Camera queries while the camera turns (T22)',
		question: 'Does q.camera_rotation report the camera of the frame being drawn, or lag behind it while the camera turns?',
		assumption: "Superseded: q.camera_rotation reads 0 in /particle effects (t60, t61), so this probe can't follow the camera. Lag is measured with q.distance_from_camera in t64.",
		wait: 1,
		probes: [
			{
				id: 'c1',
				reads: 'Small dots: x = -sin(yaw) convention; large: x = +sin(yaw). Whichever sits on the crosshair when still is the right one; while turning, its distance from the centre is the lag.',
				effect: probe(
					{
						'minecraft:emitter_rate_instant': { num_particles: 20 },
						'minecraft:particle_motion_parametric': {
							relative_position: [
								'(v.particle_random_1 < 0.5 ? -1 : 1) * math.sin(q.camera_rotation(1)) * math.cos(q.camera_rotation(0)) * 4',
								'-math.sin(q.camera_rotation(0)) * 4',
								'math.cos(q.camera_rotation(1)) * math.cos(q.camera_rotation(0)) * 4',
							],
						},
					},
					{ size: 'v.particle_random_1 < 0.5 ? 0.06 : 0.14', lifetime: 120, activeTime: 120 },
				),
			},
		],
	},
	{
		id: 't60',
		title: 'q.camera_rotation(1) readout',
		question: 'What does q.camera_rotation(1) return for a known camera yaw (units, zero direction, sign)?',
		assumption: 'To be measured: a vertical stack, one probe per 45-degree bin; set the camera to known yaws and read which one is lit.',
		wait: 1,
		spacing: 0,
		probes: [
			{ id: 'b0', reads: 'red → q.camera_rotation(1) in [-200, -160) degrees (probe 1 from the bottom).', spawnDy: 0.0, effect: probe({}, { size: show('q.camera_rotation(1) >= -200 && q.camera_rotation(1) < -160'), lifetime: 120, activeTime: 120, tint: [1, 0, 0, 1] }) },
			{ id: 'b1', reads: 'orange → q.camera_rotation(1) in [-160, -110) degrees (probe 2 from the bottom).', spawnDy: 0.45, effect: probe({}, { size: show('q.camera_rotation(1) >= -160 && q.camera_rotation(1) < -110'), lifetime: 120, activeTime: 120, tint: [1, 0.5, 0, 1] }) },
			{ id: 'b2', reads: 'yellow → q.camera_rotation(1) in [-110, -70) degrees (probe 3 from the bottom).', spawnDy: 0.9, effect: probe({}, { size: show('q.camera_rotation(1) >= -110 && q.camera_rotation(1) < -70'), lifetime: 120, activeTime: 120, tint: [1, 1, 0, 1] }) },
			{ id: 'b3', reads: 'green → q.camera_rotation(1) in [-70, -20) degrees (probe 4 from the bottom).', spawnDy: 1.35, effect: probe({}, { size: show('q.camera_rotation(1) >= -70 && q.camera_rotation(1) < -20'), lifetime: 120, activeTime: 120, tint: [0, 1, 0, 1] }) },
			{ id: 'b4', reads: 'cyan → q.camera_rotation(1) in [-20, 20) degrees (probe 5 from the bottom).', spawnDy: 1.8, effect: probe({}, { size: show('q.camera_rotation(1) >= -20 && q.camera_rotation(1) < 20'), lifetime: 120, activeTime: 120, tint: [0, 1, 1, 1] }) },
			{ id: 'b5', reads: 'blue → q.camera_rotation(1) in [20, 70) degrees (probe 6 from the bottom).', spawnDy: 2.25, effect: probe({}, { size: show('q.camera_rotation(1) >= 20 && q.camera_rotation(1) < 70'), lifetime: 120, activeTime: 120, tint: [0, 0.3, 1, 1] }) },
			{ id: 'b6', reads: 'purple → q.camera_rotation(1) in [70, 110) degrees (probe 7 from the bottom).', spawnDy: 2.7, effect: probe({}, { size: show('q.camera_rotation(1) >= 70 && q.camera_rotation(1) < 110'), lifetime: 120, activeTime: 120, tint: [0.6, 0, 1, 1] }) },
			{ id: 'b7', reads: 'magenta → q.camera_rotation(1) in [110, 160) degrees (probe 8 from the bottom).', spawnDy: 3.15, effect: probe({}, { size: show('q.camera_rotation(1) >= 110 && q.camera_rotation(1) < 160'), lifetime: 120, activeTime: 120, tint: [1, 0, 1, 1] }) },
			{ id: 'b8', reads: 'grey → q.camera_rotation(1) in [160, 200) degrees (probe 9 from the bottom).', spawnDy: 3.6, effect: probe({}, { size: show('q.camera_rotation(1) >= 160 && q.camera_rotation(1) < 200'), lifetime: 120, activeTime: 120, tint: [0.5, 0.5, 0.5, 1] }) },
			{ id: 'rad', reads: 'Top: lit if q.camera_rotation(1) looks like radians (0.3 < |v| < 3.3).', spawnDy: 4.35, effect: probe({}, { size: show('math.abs(q.camera_rotation(1)) > 0.3 && math.abs(q.camera_rotation(1)) < 3.3'), lifetime: 120, activeTime: 120 }) },
		],
	},
	{
		id: 't61',
		title: 'q.camera_rotation(0) readout',
		question: 'What does q.camera_rotation(0) return for a known camera pitch?',
		assumption: 'To be measured, like t60.',
		wait: 1,
		spacing: 0,
		probes: [
			{ id: 'b0', reads: 'red → q.camera_rotation(0) in [-200, -160) degrees (probe 1 from the bottom).', spawnDy: 0.0, effect: probe({}, { size: show('q.camera_rotation(0) >= -200 && q.camera_rotation(0) < -160'), lifetime: 120, activeTime: 120, tint: [1, 0, 0, 1] }) },
			{ id: 'b1', reads: 'orange → q.camera_rotation(0) in [-160, -110) degrees (probe 2 from the bottom).', spawnDy: 0.45, effect: probe({}, { size: show('q.camera_rotation(0) >= -160 && q.camera_rotation(0) < -110'), lifetime: 120, activeTime: 120, tint: [1, 0.5, 0, 1] }) },
			{ id: 'b2', reads: 'yellow → q.camera_rotation(0) in [-110, -70) degrees (probe 3 from the bottom).', spawnDy: 0.9, effect: probe({}, { size: show('q.camera_rotation(0) >= -110 && q.camera_rotation(0) < -70'), lifetime: 120, activeTime: 120, tint: [1, 1, 0, 1] }) },
			{ id: 'b3', reads: 'green → q.camera_rotation(0) in [-70, -20) degrees (probe 4 from the bottom).', spawnDy: 1.35, effect: probe({}, { size: show('q.camera_rotation(0) >= -70 && q.camera_rotation(0) < -20'), lifetime: 120, activeTime: 120, tint: [0, 1, 0, 1] }) },
			{ id: 'b4', reads: 'cyan → q.camera_rotation(0) in [-20, 20) degrees (probe 5 from the bottom).', spawnDy: 1.8, effect: probe({}, { size: show('q.camera_rotation(0) >= -20 && q.camera_rotation(0) < 20'), lifetime: 120, activeTime: 120, tint: [0, 1, 1, 1] }) },
			{ id: 'b5', reads: 'blue → q.camera_rotation(0) in [20, 70) degrees (probe 6 from the bottom).', spawnDy: 2.25, effect: probe({}, { size: show('q.camera_rotation(0) >= 20 && q.camera_rotation(0) < 70'), lifetime: 120, activeTime: 120, tint: [0, 0.3, 1, 1] }) },
			{ id: 'b6', reads: 'purple → q.camera_rotation(0) in [70, 110) degrees (probe 7 from the bottom).', spawnDy: 2.7, effect: probe({}, { size: show('q.camera_rotation(0) >= 70 && q.camera_rotation(0) < 110'), lifetime: 120, activeTime: 120, tint: [0.6, 0, 1, 1] }) },
			{ id: 'b7', reads: 'magenta → q.camera_rotation(0) in [110, 160) degrees (probe 8 from the bottom).', spawnDy: 3.15, effect: probe({}, { size: show('q.camera_rotation(0) >= 110 && q.camera_rotation(0) < 160'), lifetime: 120, activeTime: 120, tint: [1, 0, 1, 1] }) },
			{ id: 'b8', reads: 'grey → q.camera_rotation(0) in [160, 200) degrees (probe 9 from the bottom).', spawnDy: 3.6, effect: probe({}, { size: show('q.camera_rotation(0) >= 160 && q.camera_rotation(0) < 200'), lifetime: 120, activeTime: 120, tint: [0.5, 0.5, 0.5, 1] }) },
			{ id: 'rad', reads: 'Top: lit if q.camera_rotation(0) looks like radians (0.3 < |v| < 3.3).', spawnDy: 4.35, effect: probe({}, { size: show('math.abs(q.camera_rotation(0)) > 0.3 && math.abs(q.camera_rotation(0)) < 3.3'), lifetime: 120, activeTime: 120 }) },
		],
	},
	{
		id: 't62',
		title: 'Camera queries in particles',
		question: 'Which camera queries track the camera in a /particle effect (q.camera_rotation reads 0, t60/t61)?',
		assumption: 'To be measured: stand 8.5 blocks west of the column (camera at -x) and read the colours.',
		wait: 1,
		spacing: 0,
		probes: [
			{ id: 'd0', reads: 'red → q.distance_from_camera == 0', spawnDy: 0.0, effect: probe({}, { size: show('q.distance_from_camera == 0'), lifetime: 120, activeTime: 120, tint: [1, 0, 0, 1] }) },
			{ id: 'd1', reads: 'green → q.distance_from_camera > 5 && q.distance_from_camera < 12', spawnDy: 0.45, effect: probe({}, { size: show('q.distance_from_camera > 5 && q.distance_from_camera < 12'), lifetime: 120, activeTime: 120, tint: [0, 1, 0, 1] }) },
			{ id: 'l0', reads: 'orange → q.camera_distance_range_lerp(0, 20) == 0', spawnDy: 0.9, effect: probe({}, { size: show('q.camera_distance_range_lerp(0, 20) == 0'), lifetime: 120, activeTime: 120, tint: [1, 0.5, 0, 1] }) },
			{ id: 'l1', reads: 'cyan → q.camera_distance_range_lerp(0, 20) > 0.25 && q.camera_distance_range_lerp(0, 20) < 0.6', spawnDy: 1.35, effect: probe({}, { size: show('q.camera_distance_range_lerp(0, 20) > 0.25 && q.camera_distance_range_lerp(0, 20) < 0.6'), lifetime: 120, activeTime: 120, tint: [0, 1, 1, 1] }) },
			{ id: 'r0', reads: 'grey → math.abs(q.rotation_to_camera(1)) < 20', spawnDy: 1.8, effect: probe({}, { size: show('math.abs(q.rotation_to_camera(1)) < 20'), lifetime: 120, activeTime: 120, tint: [0.5, 0.5, 0.5, 1] }) },
			{ id: 'r1', reads: 'blue → q.rotation_to_camera(1) >= 70 && q.rotation_to_camera(1) < 110', spawnDy: 2.25, effect: probe({}, { size: show('q.rotation_to_camera(1) >= 70 && q.rotation_to_camera(1) < 110'), lifetime: 120, activeTime: 120, tint: [0, 0.3, 1, 1] }) },
			{ id: 'r2', reads: 'yellow → q.rotation_to_camera(1) >= -110 && q.rotation_to_camera(1) < -70', spawnDy: 2.7, effect: probe({}, { size: show('q.rotation_to_camera(1) >= -110 && q.rotation_to_camera(1) < -70'), lifetime: 120, activeTime: 120, tint: [1, 1, 0, 1] }) },
			{ id: 'r3', reads: 'magenta → math.abs(q.rotation_to_camera(1)) >= 160', spawnDy: 3.15, effect: probe({}, { size: show('math.abs(q.rotation_to_camera(1)) >= 160'), lifetime: 120, activeTime: 120, tint: [1, 0, 1, 1] }) },
		],
	},
	{
		id: 't63',
		title: 'Camera rotation queries, exact values',
		question: 'Exactly what do q.rotation_to_camera and q.camera_rotation read in a /particle effect (t60-t62: constant)?',
		assumption: 'To be measured from a few sides, as t62.',
		wait: 1,
		spacing: 0,
		probes: [
			{ id: 'y0', reads: 'red → q.rotation_to_camera(1) == -90', spawnDy: 0.0, effect: probe({}, { size: show('q.rotation_to_camera(1) == -90'), lifetime: 120, activeTime: 120, tint: [1, 0, 0, 1] }) },
			{ id: 'y1', reads: 'orange → q.rotation_to_camera(1) > -90.5 && q.rotation_to_camera(1) < -89.5', spawnDy: 0.45, effect: probe({}, { size: show('q.rotation_to_camera(1) > -90.5 && q.rotation_to_camera(1) < -89.5'), lifetime: 120, activeTime: 120, tint: [1, 0.5, 0, 1] }) },
			{ id: 'p0', reads: 'green → q.rotation_to_camera(0) == 0', spawnDy: 0.9, effect: probe({}, { size: show('q.rotation_to_camera(0) == 0'), lifetime: 120, activeTime: 120, tint: [0, 1, 0, 1] }) },
			{ id: 'p1', reads: 'cyan → math.abs(q.rotation_to_camera(0)) < 20', spawnDy: 1.35, effect: probe({}, { size: show('math.abs(q.rotation_to_camera(0)) < 20'), lifetime: 120, activeTime: 120, tint: [0, 1, 1, 1] }) },
			{ id: 'p2', reads: 'blue → q.rotation_to_camera(0) > 70 && q.rotation_to_camera(0) < 110', spawnDy: 1.8, effect: probe({}, { size: show('q.rotation_to_camera(0) > 70 && q.rotation_to_camera(0) < 110'), lifetime: 120, activeTime: 120, tint: [0, 0.3, 1, 1] }) },
			{ id: 'p3', reads: 'yellow → q.rotation_to_camera(0) > -110 && q.rotation_to_camera(0) < -70', spawnDy: 2.25, effect: probe({}, { size: show('q.rotation_to_camera(0) > -110 && q.rotation_to_camera(0) < -70'), lifetime: 120, activeTime: 120, tint: [1, 1, 0, 1] }) },
			{ id: 'c0', reads: 'magenta → q.camera_rotation(0) == 0 && q.camera_rotation(1) == 0', spawnDy: 2.7, effect: probe({}, { size: show('q.camera_rotation(0) == 0 && q.camera_rotation(1) == 0'), lifetime: 120, activeTime: 120, tint: [1, 0, 1, 1] }) },
		],
	},
	{
		id: 't64',
		title: 'q.distance_from_camera lag (T22)',
		question: 'Does q.distance_from_camera lag behind a moving camera?',
		assumption: "No lag: the probe is placed (distance - 2) blocks toward a camera on the -z axis, so it sits 2 blocks in front of it and keeps its size on screen while the camera eases along the axis. Run by hand: camera @s set minecraft:free pos 0 -58 <z-12> rot 0 0, then ease 1 linear to <z-3>, screenshot mid-move and still.",
		wait: 1,
		probes: [
			{
				id: 'm1',
				reads: 'Compare its size while the camera moves with its size when still: bigger moving in → the query lags.',
				effect: probe({ 'minecraft:particle_motion_parametric': { relative_position: [0, 0, '-(q.distance_from_camera - 2)'] } }, { size: 0.3, lifetime: 120, activeTime: 120 }),
			},
		],
	},
	{
		id: 't65',
		title: 'Vibrant Visuals calibration (T23)',
		question: 'How bright does each kind of particle render under Vibrant Visuals at noon: unlit, lit, blend, additive, emissive texture set?',
		assumption: 'Measured from screenshots in both graphics modes; Oxygen fits its VV factors (unlit, lit, emissive) to the centre colours.',
		wait: 1,
		probes: [
			{ id: 'v1', reads: 'Colour of the centre: unlit, alpha, grey 128.', effect: probe({}, { size: 0.4, material: 'particles_alpha', texture: 'textures/particle/oxygen_grey', lifetime: 600, activeTime: 600 }) },
			{ id: 'v2', reads: 'Colour of the centre: lit, alpha, grey 128.', effect: probe({ 'minecraft:particle_appearance_lighting': {} }, { size: 0.4, material: 'particles_alpha', texture: 'textures/particle/oxygen_grey', lifetime: 600, activeTime: 600 }) },
			{ id: 'v3', reads: 'Colour of the centre: unlit, blend, grey 128.', effect: probe({}, { size: 0.4, material: 'particles_blend', texture: 'textures/particle/oxygen_grey', lifetime: 600, activeTime: 600 }) },
			{ id: 'v4', reads: 'Colour of the centre: unlit, additive, grey 128 (read against the sky beside it).', effect: probe({}, { size: 0.4, material: 'particles_add', texture: 'textures/particle/oxygen_grey', lifetime: 600, activeTime: 600 }) },
			{ id: 'v5', reads: 'Colour of the centre: unlit, alpha, grey 128 with an emissive texture set (MERS 0, 255, 255).', effect: probe({}, { size: 0.4, material: 'particles_alpha', texture: 'textures/particle/oxygen_grey_e', lifetime: 600, activeTime: 600 }) },
			{ id: 'v6', reads: 'Colour of the centre: lit, alpha, grey 128 with the emissive texture set.', effect: probe({ 'minecraft:particle_appearance_lighting': {} }, { size: 0.4, material: 'particles_alpha', texture: 'textures/particle/oxygen_grey_e', lifetime: 600, activeTime: 600 }) },
			{ id: 'v7', reads: 'Colour of the centre: unlit, alpha, white 255.', effect: probe({}, { size: 0.4, material: 'particles_alpha', texture: 'textures/particle/oxygen_white', lifetime: 600, activeTime: 600 }) },
			{ id: 'v8', reads: 'Colour of the centre: unlit, alpha, dark 64.', effect: probe({}, { size: 0.4, material: 'particles_alpha', texture: 'textures/particle/oxygen_dark', lifetime: 600, activeTime: 600 }) },
		],
	},
];

// ---------------------------------------------------------------- helpers

function withoutLifetime(json: Json): Json {
	delete json.particle_effect.components['minecraft:particle_lifetime_expression'];
	return json;
}

function addKey(json: Json, path: string[], key: string, value: unknown): Json {
	let o = json;
	for (const p of path) o = o[p];
	o[key] = value;
	return json;
}

function uvProbe(uv: [number, number], size: [number, number]): Json {
	return probe({ 'minecraft:particle_appearance_billboard': { size: [0.4, 0.4], facing_camera_mode: 'rotate_xyz', uv: { texture_width: 16, texture_height: 16, uv, uv_size: size } } }, { texture: 'textures/particle/oxygen_uv' });
}

function dirProbe(mode: string, dir: [number, number, number]): Json {
	return probe(
		{
			'minecraft:particle_appearance_billboard': {
				size: [0.4, 0.4],
				facing_camera_mode: mode,
				direction: { mode: 'custom', custom_direction: dir },
				uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] },
			},
		},
		{ texture: 'textures/particle/oxygen_arrow' },
	);
}

function twoQuads(material: string, texture: string): Json {
	return probe(
		{
			'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
			'minecraft:particle_motion_parametric': { relative_position: ['v.k = v.i; v.i = v.i + 1; return v.k * 0.35;', 'v.k * 0.25', '-v.k * 0.7'] },
		},
		{ material, texture, count: 2, size: 0.4, facing: 'rotate_xyz', tint: material === 'particles_alpha' ? undefined : [0.9, 0.5, 0.2, 1] },
	);
}

function capProbe(count: number, index: number): Json {
	return probe(
		{
			'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
			'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
			// park every other particle under the floor (keeps the emitter bounds small)
			'minecraft:particle_motion_parametric': { relative_position: [0, `v.idx == ${index} ? 0 : -4`, 0] },
		},
		{ count, size: 0.15 },
	);
}

function steadyCapProbe(index: number): Json {
	return probe(
		{
			'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
			'minecraft:emitter_rate_steady': { spawn_rate: 5000, max_particles: 20000 },
			'minecraft:particle_initialization': { per_update_expression: 'v.idx = v.i; v.i = v.i + 1;' },
			'minecraft:particle_motion_parametric': { relative_position: [0, `v.idx == ${index} ? 0 : -4`, 0] },
		},
		{ size: 0.15, activeTime: 10 },
	);
}

function loopProbe(components: Json): Json {
	return probe(
		{
			'minecraft:emitter_initialization': {
				per_update_expression: 'v.loopc = (v.prevage ?? 0) > v.emitter_age ? (v.loopc ?? 0) + 1 : (v.loopc ?? 0); v.prevage = v.emitter_age;',
			},
			'minecraft:emitter_shape_point': { offset: ['(v.loopc ?? 0) * 0.35', 'v.emitter_age', 0] },
			...components,
		},
		{ size: 0.08 },
	);
}

function faller(): Json {
	return probe(
		{
			'minecraft:particle_motion_dynamic': { linear_acceleration: [0, -12, 0] },
			'minecraft:particle_motion_collision': { collision_radius: 0.1, coefficient_of_restitution: 0, collision_drag: 5 },
		},
		{ size: 0.12 },
	);
}

function orderedPair(farFirst: boolean): Json {
	const z = farFirst ? ['0.6', '-0.6'] : ['-0.6', '0.6'];
	return probe(
		{
			'minecraft:emitter_initialization': { per_update_expression: 'v.i = 0;' },
			'minecraft:particle_initialization': { per_render_expression: 'v.rk = (v.rk ?? -1) + 1; v.rk = v.rk > 1.5 ? 0 : v.rk;' },
			'minecraft:particle_motion_parametric': { relative_position: ['v.k = v.i; v.i = v.i + 1; return v.k * 0.2;', 0, `v.k < 0.5 ? ${z[0]} : ${z[1]}`] },
		},
		{ material: 'particles_blend', texture: 'textures/particle/oxygen_glass', count: 2, size: 0.4, facing: 'rotate_xyz', tint: ['v.rk < 0.5 ? 1 : 0.1', '0.1', 'v.rk < 0.5 ? 0.1 : 1', 0.8] },
	);
}

function versioned(expression: string, version: number | null): Json {
	const json = probe({}, { size: [version === null ? expression : { expression, version }, 0.3] });
	json.format_version = '1.26.50';
	return json;
}

/** Event definitions some probes need (attached by the generator) */
export function probeEvents(testId: string, probeId: string): Json | undefined {
	const childId = `oxygen:${testId}_${probeId}_child`;
	if (testId === 't05' && probeId === 'p1') {
		return { go: { sequence: [{ expression: 't.xyz = v.secret;' }, { particle_effect: { effect: childId, type: 'emitter', pre_effect_expression: 'v.got = t.xyz;' } }] } };
	}
	if (testId === 't05' && probeId === 'p6') {
		return { go: { sequence: [{ expression: 't.z = 5;' }, { particle_effect: { effect: childId, type: 'emitter' } }] } };
	}
	if (testId === 't05' && probeId === 'p7') {
		return { go: { sequence: [{ expression: 't.k = 3;' }, { expression: 'v.k = t.k ?? 0;' }] } };
	}
	if (testId === 't03' && probeId === 'p4') return { never: { expression: 'v.x = 1 +* 2;' } };
	if (testId === 't30' && probeId === 'p3') return { go: { expression: 'v.before = t.preset ?? 0;' } };
	return undefined;
}

export function probeCurves(testId: string, probeId: string): Json | undefined {
	if (testId === 't03' && probeId === 'p5') return { 'variable.unused': { type: 'linear', input: 'v.particle_age', horizontal_range: 1, nodes: [0, '1 +* 2', 0] } };
	return undefined;
}

/** Tests of effects on an entity (the oxygen:rig entity) */
export { ENTITY_TESTS, type EntityTest } from './entity';
