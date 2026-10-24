/**
 * In-game tests for where temps (t.*) and context values (c.*) reach. Each station has one writer — a context that
 * writes a temp of its own (t.<test>_<station>) — and one reader entity that reads it back in every Molang context
 * a client entity has, beside a particle fired by the reader, a free /particle effect, the server and (on some
 * stations) a vanilla armor stand. One screenshot answers a whole row of writer × reader combinations.
 *
 * Readers can't hand what they read on through temps (that's what is being tested), so each one shows it itself:
 * entity contexts set an entity variable that scales one of eight coloured cubes on the reader's head, particles
 * size themselves, the server places a block, the armor stand scales its head.
 */
import { makeImage } from './png';
import type { Json } from './tests';

/** Where a client entity's Molang runs, one indicator cube each (slot 1–8, in this order) */
export const READ_CTXS = ['timeline', 'bone', 'transition', 'on_entry', 'pre_animation', 'initialize', 'animate', 'render'] as const;
export type ReadCtx = (typeof READ_CTXS)[number];
export type WriteCtx = 'on_exit_late' | 'once' | 'timeline' | 'bone' | 'on_entry' | 'initial_entry' | 'transition' | 'on_exit' | 'pre_animation' | 'initialize' | 'animate' | 'render' | 'pre_effect' | 'particle';

/** Indicator colours, slot 1–8 (left to right, bottom row first) */
export const SLOT_COLOURS = ['red', 'orange', 'yellow', 'lime', 'cyan', 'blue', 'purple', 'white'];
const SLOT_RGB: [number, number, number][] = [
	[230, 40, 40],
	[255, 140, 20],
	[250, 230, 40],
	[90, 230, 60],
	[40, 220, 230],
	[40, 80, 240],
	[170, 60, 230],
	[255, 255, 255],
];

/** One value read: `expr` (Molang) against up to three expected values */
export interface Read {
	ctx: ReadCtx;
	expr: string;
	values: number[];
}

/** Sizes a reader shows: the 1st, 2nd and 3rd expected value, unset (?? caught it), any other value */
interface Scale {
	values: number[];
	unset: number;
	other: number;
}
/** Indicator cube scale (the cube is 4 px: 2 = half a block); 0 = the reader never ran */
const CUBE: Scale = { values: [2, 1.5, 1], unset: 0.6, other: 0.3 };
/** Particle flag size; 1.0 (the default) = the size field was dropped at load */
const FLAG: Scale = { values: [0.3, 0.22, 0.15], unset: 0.08, other: 0.04 };
const UNSET = -999;

/**
 * How to read `expr` safely: `val` is its value, `unset` says it was never set. The game only allows a bare variable
 * left of ?? (a member, or anything in parentheses, is a load error that drops the whole expression), so a member is
 * checked through its struct's own variable, and any other expression must not read an unset name.
 */
export function probeOf(expr: string): { val: string; unset: string } {
	if (/^[a-z]+\.[a-z_]\w*$/i.test(expr)) return { val: `(${expr} ?? ${UNSET})`, unset: `(${expr} ?? ${UNSET}) == ${UNSET}` };
	const member = /^([a-z]+\.[a-z_]\w*)\.\w+$/i.exec(expr);
	if (member) return { val: `(${expr})`, unset: `(${member[1]} ?? ${UNSET}) == ${UNSET}` };
	return { val: `(${expr})`, unset: `(${expr}) == ${UNSET}` };
}

/** Molang that turns what `expr` reads into a size */
export function sizeOf(expr: string, values: number[], s: Scale): string {
	const { val, unset } = probeOf(expr);
	let e = `${s.other}`;
	for (let i = values.length - 1; i >= 0; i--) e = `(${val} == ${values[i]}) ? ${s.values[i]} : (${e})`;
	return `(${unset}) ? ${s.unset} : (${e})`;
}

/** A scope entity: writes (by context) and reads (one indicator each); summoned `after` s, despawned at `gone` s */
export interface ScopeEntity {
	kind: 'entity';
	type?: 'scope' | 'scope_b';
	/** offset from the station (dx, dz); readers stand on it, writers behind and to the right */
	at?: [number, number];
	after?: number;
	gone?: number;
	/** statements written in each context (bone: a channel of its own, not the readers') */
	writes?: Partial<Record<WriteCtx, string>>;
	reads?: Read[];
	/** a particle the entity fires at its head, sized by what it reads; `pre` = its pre_effect_script */
	flag?: { expr: string; values: number[]; pre?: string };
	/** server-side (behaviour pack) Molang on this entity: writes, and a read that places a block beside it */
	server?: { timeline?: string; on_entry?: string; read?: { expr: string; values: number[] } };
}

/** A /particle effect (or a Script API spawn with `vars`) that writes, sized 0 */
export interface Writer {
	kind: 'particle';
	emitter?: string;
	creation?: string;
	particle?: string;
	render?: string;
	/** a creation event's expression */
	event?: string;
	vars?: Record<string, number>;
	after?: number;
	/** the emitter ends after this many seconds (default: never) */
	ends?: number;
}

/** A /particle flag sized by what it reads (`size` replaces the generated size); `vars` spawns it through the Script API */
export interface Flag {
	kind: 'flag';
	expr: string;
	values: number[];
	size?: string;
	creation?: string;
	vars?: Record<string, number>;
	/** offset (dx, dy) from the flag's place above the station */
	at?: [number, number];
	after?: number;
}

/** A vanilla armor stand: /playanimation writers (timeline, stop expression), a reader that scales its head, an item held */
export interface Stand {
	kind: 'stand';
	at?: [number, number];
	write?: string;
	stop?: string;
	read?: { expr: string; values: number[] };
	/** an item with an attachable of ours, held in its main hand */
	item?: keyof typeof SCOPE_ITEMS;
	after?: number;
}

/** A command run at the station: {X} {Y} {Z} are the station's base (feet) plus `at` */
export interface Cmd {
	kind: 'cmd';
	command: string;
	at?: [number, number];
	after?: number;
}

export type Actor = ScopeEntity | Writer | Flag | Stand | Cmd;

export interface Station {
	id: string;
	reads: string;
	actors: Actor[];
}

export interface ScopeTest {
	id: string;
	title: string;
	question: string;
	assumption: string;
	wait: number;
	stations: Station[];
	spacing?: number;
	/** readers of other tests' temps, nothing written (s11) */
	persist?: boolean;
}

// ---------------------------------------------------------------- station builders

const t = (test: string, station: string) => `t.${test}_${station}`;

/** The full reader: all eight entity contexts, a particle it fires, the server, a /particle flag (and the armor stand) */
function reader(expr: string, values: number[] = [7], o: { type?: 'scope' | 'scope_b'; after?: number; stand?: boolean; writes?: ScopeEntity['writes']; flagPre?: string; server?: boolean } = {}): Actor[] {
	const after = o.after ?? 1;
	const out: Actor[] = [
		{
			kind: 'entity',
			type: o.type,
			after,
			writes: o.writes,
			reads: READ_CTXS.map((ctx) => ({ ctx, expr, values })),
			flag: { expr, values, pre: o.flagPre },
			...(o.server === false ? {} : { server: { read: { expr, values } } }),
		},
		{ kind: 'flag', expr, values, after },
	];
	if (o.stand) out.push({ kind: 'stand', at: [-1.6, 1.2], read: { expr, values }, after });
	return out;
}

/** A writer entity behind the reader, writing `code` in one context */
const writer = (ctx: WriteCtx, code: string, o: Partial<ScopeEntity> = {}): ScopeEntity => ({ kind: 'entity', at: [1.6, 2.5], writes: { [ctx]: code }, ...o });

// ---------------------------------------------------------------- the tests

const LEGEND =
	'Reader cubes (slot = context, bottom row then top, left to right): red timeline key, orange bone channel, yellow controller transition, lime controller on_entry, cyan pre_animation, blue initialize, purple scripts.animate condition, white render controller (shown only when it reads the value). ' +
	'Cube size: half a block = the expected value (then ⅜, ¼ for a 2nd, 3rd value), small = unset (?? caught it), tiny = another value, none = that context never ran. ' +
	'Pink square above the reader = a particle it fires; white square above that = a free /particle (0.3 expected … 0.08 unset, 0.04 other, 1.0 = dropped at load). ' +
	'Wool on the right of the reader, placed by the server: lime expected (yellow, light blue a 2nd, 3rd value), red unset, orange other, none = the server Molang never ran. ' +
	'Armor stand (left, where present): its right arm raised straight forward = expected, lower for a 2nd/3rd value, barely lifted = unset.';

const s01 = 's01';
const s02 = 's02';
const s03 = 's03';
const s04 = 's04';
const s05 = 's05';
const s06 = 's06';
const s07 = 's07';
const s08 = 's08';
const s09 = 's09';

export const SCOPE_TESTS: ScopeTest[] = [
	{
		id: s01,
		title: 'Temps an entity writes (1)',
		question: `A writer entity (behind, right) writes 7 to a temp of its own in one context per station; can every other context, entity, effect and the server read it? ${LEGEND}`,
		assumption: 'Temps are global (t29, and entity → own particles in e20–e25): every reader shows half-block cubes, 0.3 squares and lime wool.',
		wait: 4,
		stations: [
			{ id: 'tl', reads: 'writer: an animation timeline key (every 0.5 s)', actors: [writer('timeline', `${t(s01, 'tl')} = 7;`), ...reader(t(s01, 'tl'), [7], { stand: true })] },
			{ id: 'bone', reads: 'writer: a bone channel (every frame)', actors: [writer('bone', `${t(s01, 'bone')} = 7;`), ...reader(t(s01, 'bone'))] },
			{ id: 'entry', reads: 'writer: a controller state’s on_entry (once)', actors: [writer('on_entry', `${t(s01, 'entry')} = 7;`), ...reader(t(s01, 'entry'))] },
			{ id: 'trans', reads: 'writer: a controller transition condition (an assignment in it, every frame)', actors: [writer('transition', `${t(s01, 'trans')} = 7;`), ...reader(t(s01, 'trans'))] },
			{ id: 'exit', reads: 'writer: a controller state’s on_exit (once)', actors: [writer('on_exit', `${t(s01, 'exit')} = 7;`), ...reader(t(s01, 'exit'))] },
		],
	},
	{
		id: s02,
		title: 'Temps an entity writes (2)',
		question: `As s01, for scripts and render controllers, and a writer that is gone before anything reads. ${LEGEND}`,
		assumption: 'Temps are global and never cleared.',
		wait: 4,
		stations: [
			{ id: 'pre', reads: 'writer: scripts.pre_animation (every frame)', actors: [writer('pre_animation', `${t(s02, 'pre')} = 7;`), ...reader(t(s02, 'pre'))] },
			{
				id: 'init',
				reads: 'writer: scripts.initialize (once). The writer’s own red cube: half a block = q.variant was known in initialize (tiny = it read 0 there, so the write was skipped)',
				actors: [writer('initialize', `${t(s02, 'init')} = 7;`, { reads: [{ ctx: 'bone', expr: '((v.initvar ?? -1) > 0) ? 7 : 1', values: [7] }] }), ...reader(t(s02, 'init'))],
			},
			{ id: 'anim', reads: 'writer: a scripts.animate condition (an assignment in it, every frame)', actors: [writer('animate', `${t(s02, 'anim')} = 7;`), ...reader(t(s02, 'anim'))] },
			{ id: 'render', reads: 'writer: a render controller’s part_visibility (an assignment in it, every drawn frame)', actors: [writer('render', `${t(s02, 'render')} = 7;`), ...reader(t(s02, 'render'))] },
			{ id: 'gone', reads: 'writer: a timeline key, despawned at 0.5 s; readers come at 1.5 s → do temps outlive the entity?', actors: [writer('timeline', `${t(s02, 'gone')} = 7;`, { gone: 0.5 }), ...reader(t(s02, 'gone'), [7], { after: 1.5 })] },
		],
	},
	{
		id: s03,
		title: 'Temps within one entity, and between entity types',
		question: `The reader writes the temp itself (no separate writer) in one context, or a writer of the other entity type (oxygen:scope_b, tan body) writes. Does an entity's own temp survive from one of its expressions to the next? ${LEGEND}`,
		assumption: 'Temps are global, so the entity reads its own writes everywhere; entity types don’t matter.',
		wait: 4,
		stations: [
			{ id: 'stl', reads: 'self: its own timeline key', actors: reader(t(s03, 'stl'), [7], { writes: { timeline: `${t(s03, 'stl')} = 7;` } }) },
			{ id: 'sbone', reads: 'self: its own bone channel (another channel than the readers’)', actors: reader(t(s03, 'sbone'), [7], { writes: { bone: `${t(s03, 'sbone')} = 7;` } }) },
			{ id: 'spre', reads: 'self: its own pre_animation', actors: reader(t(s03, 'spre'), [7], { writes: { pre_animation: `${t(s03, 'spre')} = 7;` } }) },
			{ id: 'sinit', reads: 'self: its own initialize (once, at its creation)', actors: reader(t(s03, 'sinit'), [7], { writes: { initialize: `${t(s03, 'sinit')} = 7;` } }) },
			{ id: 'atob', reads: 'oxygen:scope writes (timeline), oxygen:scope_b reads', actors: [writer('timeline', `${t(s03, 'atob')} = 7;`), ...reader(t(s03, 'atob'), [7], { type: 'scope_b' })] },
			{ id: 'btoa', reads: 'oxygen:scope_b writes (timeline), oxygen:scope reads', actors: [writer('timeline', `${t(s03, 'btoa')} = 7;`, { type: 'scope_b' }), ...reader(t(s03, 'btoa'))] },
		],
	},
	{
		id: s04,
		title: 'Temps from effects and scripts',
		question: `Effects write the temp: a pre_effect_script, an effect the writer entity fires, a free /particle effect (emitter, particle update, particle render, an event) and a Script API spawn whose MolangVariableMap names temp.<x>. Do entities and the server see what particles write? ${LEGEND}`,
		assumption: 'Global: every reader sees them. A MolangVariableMap only sets variables (setFloat may refuse temp.*: see the content log).',
		wait: 4,
		stations: [
			{ id: 'pre', reads: 'writer entity: pre_effect_script of an effect it fires (once)', actors: [writer('pre_effect', `${t(s04, 'pre')} = 7;`), ...reader(t(s04, 'pre'))] },
			{ id: 'att', reads: 'writer entity: an effect it fires, emitter per_update', actors: [writer('particle', `${t(s04, 'att')} = 7;`), ...reader(t(s04, 'att'))] },
			{ id: 'emit', reads: '/particle: emitter per_update (+ armor stand reader)', actors: [{ kind: 'particle', emitter: `${t(s04, 'emit')} = 7;` }, ...reader(t(s04, 'emit'), [7], { stand: true })] },
			{ id: 'part', reads: '/particle: particle per_update', actors: [{ kind: 'particle', particle: `${t(s04, 'part')} = 7;` }, ...reader(t(s04, 'part'))] },
			{ id: 'rend', reads: '/particle: particle per_render_expression', actors: [{ kind: 'particle', render: `${t(s04, 'rend')} = 7;` }, ...reader(t(s04, 'rend'))] },
			{ id: 'event', reads: '/particle: a creation event’s expression (once)', actors: [{ kind: 'particle', event: `${t(s04, 'event')} = 7;` }, ...reader(t(s04, 'event'))] },
			{ id: 'map', reads: 'Script API spawn, MolangVariableMap { temp.s04_map: 7 }', actors: [{ kind: 'particle', vars: { 'temp.s04_map': 7 } }, ...reader(t(s04, 'map'))] },
		],
	},
	{
		id: s05,
		title: 'Temps from vanilla entities, attachables and the server',
		question: `An armor stand writes through /playanimation (an animation's timeline, or the command's stop expression), an attachable it holds writes (its pre_animation), or the server writes (behaviour-pack animation timeline, controller on_entry). Do client and server share temps? ${LEGEND}`,
		assumption: 'Open: client and server may keep temps apart (one process in single player, but separate Molang contexts).',
		wait: 4,
		stations: [
			{ id: 'vtl', reads: 'armor stand (behind, right), /playanimation of a timeline that writes', actors: [{ kind: 'stand', at: [1.6, 2.5], write: `${t(s05, 'vtl')} = 7;` }, ...reader(t(s05, 'vtl'))] },
			{ id: 'vstop', reads: 'armor stand, /playanimation stop_expression "t.s05_vstop = 7; return 0;"', actors: [{ kind: 'stand', at: [1.6, 2.5], stop: `${t(s05, 'vstop')} = 7; return 0;` }, ...reader(t(s05, 'vstop'))] },
			{ id: 'stl', reads: 'server: behaviour-pack animation timeline on the writer (+ armor stand reader)', actors: [{ kind: 'entity', at: [1.6, 2.5], server: { timeline: `${t(s05, 'stl')} = 7;` } }, ...reader(t(s05, 'stl'), [7], { stand: true })] },
			{ id: 'sent', reads: 'server: behaviour-pack controller on_entry', actors: [{ kind: 'entity', at: [1.6, 2.5], server: { on_entry: `${t(s05, 'sent')} = 7;` } }, ...reader(t(s05, 'sent'))] },
		],
	},
	{
		id: s06,
		title: 'Order within a frame',
		question: `One temp written three times a frame: 1, then 2, then 3. The size of each reader says which write it sees last (half block = 1, ⅜ = 2, ¼ = 3; squares 0.3 / 0.22 / 0.15; wool lime / yellow / light blue). ${LEGEND}`,
		assumption: 'Open: entities and particles run in some order within a frame; readers after all writes see 3.',
		wait: 4,
		stations: [
			{ id: 'ent', reads: 'writer entity: pre_animation 1, bone channel 2, render controller 3', actors: [{ kind: 'entity', at: [1.6, 2.5], writes: { pre_animation: `${t(s06, 'ent')} = 1;`, bone: `${t(s06, 'ent')} = 2;`, render: `${t(s06, 'ent')} = 3;` } }, ...reader(t(s06, 'ent'), [1, 2, 3])] },
			{ id: 'part', reads: '/particle: emitter per_update 1, particle per_update 2, particle per_render 3', actors: [{ kind: 'particle', emitter: `${t(s06, 'part')} = 1;`, particle: `${t(s06, 'part')} = 2;`, render: `${t(s06, 'part')} = 3;` }, ...reader(t(s06, 'part'), [1, 2, 3])] },
			{ id: 'self', reads: 'self: the reader writes pre_animation 1, bone channel 2, render controller 3', actors: reader(t(s06, 'self'), [1, 2, 3], { writes: { pre_animation: `${t(s06, 'self')} = 1;`, bone: `${t(s06, 'self')} = 2;`, render: `${t(s06, 'self')} = 3;` } }) },
		],
	},
	{
		id: s07,
		title: 'Context values (c.*) in effects',
		question:
			'Squares (0.3 = 7 read, 0.08 = unset, 0.04 = another value, 1.0 = dropped at load): does any spawn route set c.*? Can Molang write c.*, and does a written c.* reach another effect?',
		assumption: 'c.* is unset in /particle effects (t-series v2); nothing in a particle can set it.',
		wait: 3,
		spacing: 4,
		stations: [
			{
				id: 'none',
				reads: '/particle, left to right: c.foo; c.is_first_person (0.3 = 0, 0.22 = 1); c.item_slot (0.3 = set at all); c.owning_entity (0.3 = set at all)',
				actors: [
					{ kind: 'flag', expr: 'c.foo', values: [7], at: [-1.2, 0], after: 0 },
					{ kind: 'flag', expr: 'c.is_first_person', values: [0, 1], at: [-0.4, 0], after: 0 },
					{ kind: 'flag', expr: '', values: [], size: "((c.item_slot ?? 'none') == 'none') ? 0.08 : 0.3", at: [0.4, 0], after: 0 },
					{ kind: 'flag', expr: '', values: [], size: '((c.owning_entity ?? -999) == -999) ? 0.08 : 0.3', at: [1.2, 0], after: 0 },
				],
			},
			{
				id: 'map',
				reads: 'Script API spawn: MolangVariableMap { context.foo: 7 } (left), { c.foo: 7 } (right), each read as c.foo',
				actors: [
					{ kind: 'flag', expr: 'c.foo', values: [7], vars: { 'context.foo': 7 }, at: [-0.5, 0], after: 0 },
					{ kind: 'flag', expr: 'c.foo', values: [7], vars: { 'c.foo': 7 }, at: [0.5, 0], after: 0 },
				],
			},
			{
				id: 'pre',
				reads: 'an entity fires a square with pre_effect_script "c.foo = 7;" (pink, above it), read as c.foo',
				actors: [{ kind: 'entity', flag: { expr: 'c.foo', values: [7], pre: 'c.foo = 7;' } }],
			},
			{
				id: 'write',
				reads: 'left: an effect writes c.cw = 7 in creation and reads it in its size; right (1 s later): another effect reads c.cw',
				actors: [
					{ kind: 'flag', expr: 'c.cw', values: [7], creation: 'c.cw = 7;', at: [-0.5, 0], after: 0 },
					{ kind: 'flag', expr: 'c.cw', values: [7], at: [0.5, 0], after: 1 },
				],
			},
		],
	},
	{
		id: s08,
		title: 'Context values (c.*) on entities',
		question: `Can an entity write c.* and read it back, and is c.is_first_person set on an entity? (Attachables: s17.) ${LEGEND}`,
		assumption: "c.* is read-only and set only where the game supplies it (attachables: c.item_slot, c.is_first_person, c.owning_entity).",
		wait: 4,
		stations: [
			{ id: 'ent', reads: 'the reader writes c.ce = 7 in its timeline and reads c.ce everywhere', actors: reader('c.ce', [7], { writes: { timeline: 'c.ce = 7;' }, server: false }) },
			{ id: 'fp', reads: 'the reader reads c.is_first_person (half block = 0, ⅜ = 1)', actors: reader('c.is_first_person', [0, 1], { server: false }) },
		],
	},
	{
		id: s09,
		title: 'Queries through temps',
		question:
			'Values only one context can query, handed to another through temps. Squares 0.3 = the value arrived (7), 0.04 = something else, 0.08 = unset. Reader cubes, left to right: red, orange, yellow (bone channels).',
		assumption: 'Temps are global, so a /particle effect gets entity and server queries, and an entity gets particle values.',
		wait: 4,
		stations: [
			{
				id: 'ent',
				reads: 'an entity’s bone channel writes; /particle squares, left to right: q.variant > 0, q.health == 20, q.bone_rotation(turn30).z == 30, q.property(oxygen:p) == 3, q.is_on_ground, q.distance_from_camera > 1',
				actors: [
					{
						kind: 'entity',
						at: [1.6, 2.5],
						writes: {
							bone: [
								`t.s09_v = (q.variant > 0) ? 7 : 1;`,
								`t.s09_h = (q.health == 20) ? 7 : 1;`,
								`v.o = q.bone_rotation('turn30'); t.s09_r = (v.o.z == 30) ? 7 : 1;`,
								`t.s09_p = (q.property('oxygen:p') == 3) ? 7 : 1;`,
								`t.s09_g = q.is_on_ground ? 7 : 1;`,
								`t.s09_d = (q.distance_from_camera > 1) ? 7 : 1;`,
							].join(' '),
						},
					},
					...(['v', 'h', 'r', 'p', 'g', 'd'] as const).map((k, i): Flag => ({ kind: 'flag', expr: `t.s09_${k}`, values: [7], at: [(i - 2.5) * 0.45, 0] })),
				],
			},
			{
				id: 'part',
				reads: 'a /particle effect writes; the reader’s cubes: red v.emitter_age > 0.5, orange v.particle_age > 0.5 (particle update), yellow q.camera_rotation ran',
				actors: [
					{ kind: 'particle', emitter: 't.s09_ea = (v.emitter_age > 0.5) ? 7 : 1; t.s09_cam = (math.abs(q.camera_rotation(1)) >= 0) ? 7 : 1;', particle: 't.s09_pa = (v.particle_age > 0.5) ? 7 : 1;' },
					{
						kind: 'entity',
						after: 1,
						reads: [
							{ ctx: 'bone', expr: 't.s09_ea', values: [7] },
							{ ctx: 'bone', expr: 't.s09_pa', values: [7] },
							{ ctx: 'bone', expr: 't.s09_cam', values: [7] },
						],
					},
				],
			},
			{
				id: 'srv',
				reads: 'the server writes (behaviour-pack timeline); /particle squares: q.variant > 0, q.health == 20, q.is_on_ground',
				actors: [
					{ kind: 'entity', at: [1.6, 2.5], server: { timeline: 't.s09_sv = (q.variant > 0) ? 7 : 1; t.s09_sh = (q.health == 20) ? 7 : 1; t.s09_sg = q.is_on_ground ? 7 : 1;' } },
					...(['sv', 'sh', 'sg'] as const).map((k, i): Flag => ({ kind: 'flag', expr: `t.s09_${k}`, values: [7], at: [(i - 1) * 0.5, 0] })),
				],
			},
		],
	},
	{
		id: 's10',
		title: 'Names, types and a control',
		question: `A control (an entity variable, which shouldn't leak), then temps by another name (temp.* for t.*, other case), a struct member and a string, written by an entity's timeline or a /particle effect. ${LEGEND}`,
		assumption: 'v.* belongs to its entity (every reader unset); temp. = t., names are case-insensitive; struct members and strings carry over like numbers.',
		wait: 4,
		stations: [
			{ id: 'ctl', reads: 'control: the writer sets v.s10_ctl = 7 (an entity variable); readers read v.s10_ctl → all unset', actors: [writer('timeline', 'v.s10_ctl = 7;'), ...reader('v.s10_ctl')] },
			{ id: 'alias', reads: 'writer: temp.s10_alias = 7; read as t.s10_alias', actors: [writer('timeline', 'temp.s10_alias = 7;'), ...reader('t.s10_alias')] },
			{ id: 'case', reads: 'writer: t.S10_CASE = 7; read as t.s10_case', actors: [writer('timeline', 't.S10_CASE = 7;'), ...reader('t.s10_case')] },
			{ id: 'struct', reads: 'writer: t.s10_st.a = 7 (a struct member); read as t.s10_st.a', actors: [writer('timeline', 't.s10_st.a = 7;'), ...reader('t.s10_st.a')] },
			{
				id: 'str',
				reads: "writer: t.s10_str = 'abc' (a string); half block = 'abc', small = unset, tiny = something else",
				actors: [writer('timeline', "t.s10_str = 'abc';"), ...reader("((t.s10_str ?? 'none') == 'abc') ? 7 : ((((t.s10_str ?? 'none') == 'none') ? -999 : 1))")],
			},
			{ id: 'pst', reads: '/particle writes a struct member t.s10_pst.x = 7 (emitter per_update); read as t.s10_pst.x', actors: [{ kind: 'particle', emitter: 't.s10_pst.x = 7;' }, ...reader('t.s10_pst.x')] },
		],
	},
	{
		id: 's12',
		title: 'Follow-ups: controllers, /playanimation, vanilla readers',
		question: `Why s01's on_exit writer reached nobody, whether an initial state's on_entry runs, whether /playanimation plays on an armor stand (its left arm goes up) and whether its timeline writes, whether a vanilla entity reads temps (right arm), and the stop expression again on our own entity and with readers there from the start. ${LEGEND}`,
		assumption: 'Open (s01 exit unset everywhere; s05 stand timeline unset; s05 stop expression reached only the entity animation contexts).',
		wait: 4,
		stations: [
			{
				id: 'exit',
				reads: 'an entity writes in on_exit (state default → after at once); its red cube: big = it reached "after"; the /particle square reads t.s12_exit',
				actors: [{ kind: 'entity', writes: { on_exit: `${t('s12', 'exit')} = 7;` }, reads: [{ ctx: 'bone', expr: 'v.exited', values: [1] }] }, { kind: 'flag', expr: t('s12', 'exit'), values: [7] }],
			},
			{ id: 'ientry', reads: 'writer: the initial state’s on_entry (the controller never leaves it)', actors: [writer('initial_entry', `${t('s12', 'ientry')} = 7;`), ...reader(t('s12', 'ientry'))] },
			{ id: 'vtl', reads: 'armor stand writer (behind, right): /playanimation of a timeline that writes; its left arm up = the animation plays', actors: [{ kind: 'stand', at: [1.6, 2.5], write: `${t('s12', 'vtl')} = 7;` }, ...reader(t('s12', 'vtl'))] },
			{
				id: 'vread',
				reads: 'two armor stands read: left t.s01_tl (an entity wrote it in s01), right t.s04_emit (a /particle wrote it); right arm straight forward = 7',
				actors: [
					{ kind: 'stand', at: [-1, 0], read: { expr: t(s01, 'tl'), values: [7] } },
					{ kind: 'stand', at: [1, 0], read: { expr: t(s04, 'emit'), values: [7] } },
				],
			},
			{
				id: 'estop',
				reads: 'our own entity (behind, right) gets /playanimation with stop expression "t.s12_estop = 7; return 0;"',
				actors: [
					{ kind: 'entity', at: [1.6, 2.5] },
					{ kind: 'cmd', at: [1.6, 2.5], after: 0.5, command: 'playanimation @e[type=oxygen:scope,x={X},y={Y},z={Z},r=1] animation.oxygen_scope.idle a 0 "t.s12_estop = 7; return 0;" oxygen_s' },
					...reader(t('s12', 'estop')),
				],
			},
			{
				id: 'gate',
				reads: "a never-true braced block: left /particle square t.s12_gate (entity pre_animation '(q.variant == 9999) ? { … };'), middle t.s12_igate (the same in initialize), right t.s12_pgate (a /particle emitter '(0) ? { … };'): all should be unset",
				actors: [
					{ kind: 'entity', at: [1.6, 2.5], writes: { pre_animation: '(q.variant == 9999) ? { t.s12_gate = 7; };', initialize: '(q.variant == 9999) ? { t.s12_igate = 7; };' } },
					{ kind: 'particle', emitter: '(0) ? { t.s12_pgate = 7; };' },
					{ kind: 'flag', expr: 't.s12_gate', values: [7], at: [-0.6, 0] },
					{ kind: 'flag', expr: 't.s12_igate', values: [7], at: [0, 0] },
					{ kind: 'flag', expr: 't.s12_pgate', values: [7], at: [0.6, 0] },
				],
			},
			{
				id: 'vstop',
				reads: 'armor stand stop expression again, the reader there from the start (summoned at once), its squares at 2 s',
				actors: [{ kind: 'stand', at: [1.6, 2.5], stop: `${t('s12', 'vstop')} = 7; return 0;` }, ...reader(t('s12', 'vstop'), [7], { after: 0.01 }), { kind: 'flag', expr: t('s12', 'vstop'), values: [7], at: [1.2, 0], after: 2 }],
			},
		],
	},
	{
		id: 's13',
		title: 'How long a temp written once lasts',
		question: 'Each writer writes its temp once, at the start; /particle squares read it 2, 5, 10 and 30 s later (left to right: 0.3 = still 7, 0.08 = gone). Writers: an entity that stays, an entity despawned at 0.5 s, an emitter that stays, an emitter that ends at 1 s.',
		assumption: 's11 found temps from s01/s04 gone minutes later, s02’s initialize temp still there.',
		wait: 32,
		stations: (
			[
				['ent', 'an entity (stays) writes once in a non-looping timeline', { kind: 'entity', at: [1.6, 2.5], writes: { once: 't.s13_ent = 7;' } }],
				['gone', 'an entity writes once, then despawns at 0.5 s', { kind: 'entity', at: [1.6, 2.5], writes: { once: 't.s13_gone = 7;' }, gone: 0.5 }],
				['emit', 'a /particle emitter (stays) writes once in creation_expression', { kind: 'particle', creation: 't.s13_emit = 7;' }],
				['end', 'a /particle emitter writes once in creation_expression, ends at 1 s', { kind: 'particle', creation: 't.s13_end = 7;', ends: 1 }],
			] as [string, string, Actor][]
		).map(([id, reads, w]): Station => ({
			id,
			reads,
			actors: [w, ...[2, 5, 10, 30].map((after, i): Flag => ({ kind: 'flag', expr: `t.s13_${id}`, values: [7], at: [(i - 1.5) * 0.6, 0], after }))],
		})),
	},
	{
		id: 's14',
		title: 'Is there a limit on how many temps exist?',
		question:
			'One /particle writes 2000 temps (t.s14_k0 … t.s14_k1999 = 7) in its creation_expression; squares read k0, k999, k1999 a second later (0.3 = 7, 0.08 = gone). Then look again at temps written by earlier tests (the monitor row): an eviction limit would have dropped them.',
		assumption: 'Temps vanished between tests (s11) without a time limit (s13: 30 s); maybe a capacity limit.',
		wait: 3,
		stations: [
			{
				id: 'many',
				reads: 'squares left to right: t.s14_k0, t.s14_k999, t.s14_k1999',
				actors: [
					{ kind: 'particle', creation: Array.from({ length: 2000 }, (_, i) => `t.s14_k${i} = 7;`).join(' ') },
					...[0, 999, 1999].map((k, i): Flag => ({ kind: 'flag', expr: `t.s14_k${k}`, values: [7], at: [(i - 1) * 0.6, 0] })),
				],
			},
		],
	},
	{
		id: 's15',
		title: 'Follow-ups: does on_exit run, can a vanilla entity read temps',
		question:
			"An entity's on_exit sets v.exitv = 1 and t.s15_exit = 7; its own cubes: red = it reached the next state (v.exited), orange = v.exitv (on_exit ran), yellow = t.s15_exit read back by itself; the /particle square reads t.s15_exit. Armor stands read a temp an entity writes all the time (t.s15_set) and one nothing writes (t.s15_never): right arm straight forward = 7, barely lifted = unset.",
		assumption: 's12: the controller left the state, but its on_exit temp reached nobody.',
		wait: 4,
		stations: [
			{
				id: 'exit',
				reads: 'cubes red v.exited, orange v.exitv, yellow t.s15_exit; square t.s15_exit',
				actors: [
					{
						kind: 'entity',
						writes: { on_exit: 'v.exitv = 1; t.s15_exit = 7;' },
						reads: [
							{ ctx: 'bone', expr: 'v.exited', values: [1] },
							{ ctx: 'bone', expr: 'v.exitv', values: [1] },
							{ ctx: 'bone', expr: 't.s15_exit', values: [7] },
						],
					},
					{ kind: 'flag', expr: 't.s15_exit', values: [7] },
				],
			},
			{
				id: 'vread',
				reads: 'stands, left to right on screen: t.s15_set (written by the entity behind, every 0.5 s), t.s15_never',
				actors: [
					writer('timeline', 't.s15_set = 7;'),
					{ kind: 'stand', at: [1, 0], read: { expr: 't.s15_set', values: [7] }, after: 1 },
					{ kind: 'stand', at: [-1, 0], read: { expr: 't.s15_never', values: [7] }, after: 1 },
					{ kind: 'flag', expr: 't.s15_set', values: [7] },
				],
			},
		],
	},
	{
		id: 's16',
		title: 'Counting frames between clears (hold an attachable to compare)',
		question:
			'Counters add 1 every frame to a temp; each square grows with its counter (0.02 + count / 600, capped at 0.5: half size after 5 s at 60 fps). A clear sends a square back to its smallest. Left to right: a /particle counting in its emitter update, an entity counting in a bone channel, a /particle writing once at creation and showing it (0.3 = still 7). Run it, screenshot; then hold a shield (or give the armor stand one) and screenshot again.',
		assumption: 'Rendering an attachable clears temps (found by hand after s14).',
		wait: 6,
		stations: [
			{
				id: 'count',
				reads: 'three squares (see the question)',
				actors: [
					{ kind: 'flag', expr: '', values: [], size: 'math.min(0.02 + (t.s16_k ?? 0) / 600, 0.5)', creation: '', at: [-0.8, 0], after: 0 },
					{ kind: 'particle', emitter: 't.s16_k = (t.s16_k ?? 0) + 1;' },
					{ kind: 'entity', at: [1.6, 2.5], writes: { bone: 't.s16_e = (t.s16_e ?? 0) + 1;' } },
					{ kind: 'flag', expr: '', values: [], size: 'math.min(0.02 + (t.s16_e ?? 0) / 600, 0.5)', at: [0, 0], after: 0 },
					{ kind: 'flag', expr: '', values: [], size: '((t.s16_once ?? 0) == 7) ? 0.3 : 0.08', creation: 't.s16_once = 7;', at: [0.8, 0], after: 0 },
				],
			},
		],
	},
	{
		id: 's17',
		title: 'Attachables: their temps, their context, and the clear (run last)',
		question:
			"Armor stands hold items with our attachables. att_w: its pre_animation writes t.s17_att = 7; the full reader. att_c: three cubes at the hand, red c.item_slot (big = 'main_hand', small = unset, tiny = another), orange c.is_first_person (big = 0, ⅜ = 1), yellow c.owning_entity -> q.is_alive (big = 1); pink square at the hand = an effect it fires reading c.item_slot; /particle squares read the temps it copies: t.s08_slot (0.3 = main_hand, 0.22 = unset there, 0.15 = another), t.s08_fp (0.3 = 0, 0.22 = 1), t.s08_oe (0.3 = 1). clear: a counter (grows 1/600 a frame) and a written-once square (0.3 = 7); a vanilla shield goes in a stand's hand at 2 s.",
		assumption: 'Found by hand: drawing any attachable (ours, a shield, a trident, a bow) clears every temp, once a frame while it is in view.',
		wait: 5,
		stations: [
			{ id: 'att_w', reads: 'armor stand (behind, right) holding oxygen:scope_item_w, whose pre_animation writes t.s17_att', actors: [{ kind: 'stand', at: [1.6, 2.5], item: 'w' }, ...reader('t.s17_att')] },
			{
				id: 'att_c',
				reads: 'armor stand holding oxygen:scope_item_c (cubes at its hand), squares: t.s08_slot, t.s08_fp, t.s08_oe',
				actors: [
					{ kind: 'stand', at: [0, 0.5], item: 'c', after: 0 },
					{ kind: 'flag', expr: 't.s08_slot', values: [7, 1, 3], at: [-0.8, 0.6] },
					{ kind: 'flag', expr: 't.s08_fp', values: [0, 1], at: [0, 0.6] },
					{ kind: 'flag', expr: 't.s08_oe', values: [1], at: [0.8, 0.6] },
				],
			},
			{
				id: 'clear',
				reads: 'left: a /particle frame counter (t.s17_k); right: t.s17_once written at creation; a shield goes into the stand’s hand at 2 s',
				actors: [
					{ kind: 'particle', emitter: 't.s17_k = (t.s17_k ?? 0) + 1;' },
					{ kind: 'flag', expr: '', values: [], size: 'math.min(0.02 + (t.s17_k ?? 0) / 600, 0.5)', at: [-0.5, 0], after: 0 },
					{ kind: 'flag', expr: '', values: [], size: '((t.s17_once ?? 0) == 7) ? 0.3 : 0.08', creation: 't.s17_once = 7;', at: [0.5, 0], after: 0 },
					{ kind: 'stand', at: [0, 1.5], after: 0 },
					{ kind: 'cmd', at: [0, 1.5], after: 2, command: 'replaceitem entity @e[type=armor_stand,x={X},y={Y},z={Z},r=1] slot.weapon.mainhand 0 shield' },
				],
			},
		],
	},
	{
		id: 's18',
		title: 'Attachable diagnostics and a late on_exit (run after s17)',
		question:
			'Armor stands, left to right on screen, hold d1 (an animation scales its three cubes 3× always), d2 (the same, with an animate condition of 1), d3 (pre_animation sets v.x = 3, a1 scaled 3× when it reads 3), d4 (bone channels read c.item_slot == main_hand, c.is_first_person == 0, c.owning_entity -> q.is_alive: 3× each when true, ½ when not), d5 (a render controller shows a1 only in the main hand, a2 only when not first person, a3 only when the owner is alive). Cubes at 1× = the animation never applied. Last station: an entity leaves its first state after 1 s; red cube = it got there, orange = v.exitv from on_exit, the square = t.s18_exit.',
		assumption: 's17: our attachable drew at default size, so its animations seemed not to apply.',
		wait: 4,
		spacing: 3,
		stations: [
			...(['d1', 'd2', 'd3', 'd4', 'd5'] as const).map((d): Station => ({ id: d, reads: `armor stand holding oxygen:scope_item_${d}`, actors: [{ kind: 'stand', item: d, after: 0 }] })),
			{
				id: 'exit',
				reads: 'cubes red v.exited, orange v.exitv; square t.s18_exit',
				actors: [
					{ kind: 'entity', writes: { on_exit_late: 'v.exitv = 1; t.s18_exit = 7;' }, reads: [{ ctx: 'bone', expr: 'v.exited', values: [1] }, { ctx: 'bone', expr: 'v.exitv', values: [1] }] },
					{ kind: 'flag', expr: 't.s18_exit', values: [7], after: 2 },
				],
			},
		],
	},
	{
		id: 's11',
		title: 'Do temps outlive their writers, a reload, the world?',
		question: `Readers only, no writers: temps that s01 (entity timeline), s02 (initialize), s04 (/particle) and s05 (server) wrote. Run it after those tests (before s17: an attachable in view clears temps), again after /reload, and again after reopening the world. ${LEGEND}`,
		assumption: 'Temps are never cleared while the game runs; reopening the world may clear them.',
		wait: 4,
		persist: true,
		stations: [
			{ id: 'tl', reads: 't.s01_tl (an entity timeline wrote it)', actors: reader(t(s01, 'tl'), [7], { after: 0.2 }) },
			{ id: 'init', reads: 't.s02_init (an entity initialize wrote it)', actors: reader(t(s02, 'init'), [7], { after: 0.2 }) },
			{ id: 'emit', reads: 't.s04_emit (a /particle emitter wrote it)', actors: reader(t(s04, 'emit'), [7], { after: 0.2 }) },
			{ id: 'srv', reads: 't.s05_stl (the server wrote it)', actors: reader(t(s05, 'stl'), [7], { after: 0.2 }) },
		],
	},
];

// ---------------------------------------------------------------- particle effects

const BILLBOARD = (size: string | number) => ({ size: [size, size], facing_camera_mode: 'lookat_xyz', uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } });

function effect(components: Json, events?: Json): Json {
	return {
		format_version: '1.10.0',
		particle_effect: {
			description: { identifier: '', basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/oxygen_probe' } },
			components,
			...(events ? { events } : {}),
		},
	};
}

/** One long-lived square that never goes out */
function square(size: string, colour: number[], extra: Json = {}, local = false): Json {
	return effect({
		...(local ? { 'minecraft:emitter_local_space': { position: true, rotation: true } } : {}),
		'minecraft:emitter_rate_instant': { num_particles: 1 },
		'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 },
		'minecraft:particle_lifetime_expression': { max_lifetime: 1000 },
		'minecraft:particle_appearance_billboard': BILLBOARD(size),
		'minecraft:particle_appearance_tinting': { color: colour },
		...extra,
	});
}

/** An effect that only writes (its one particle is size 0); it lives forever */
function writerEffect(w: { emitter?: string; creation?: string; particle?: string; render?: string; event?: string; ends?: number }): Json {
	const init: Json = {};
	if (w.creation) init.creation_expression = w.creation;
	if (w.emitter) init.per_update_expression = w.emitter;
	const part: Json = {};
	if (w.particle) part.per_update_expression = w.particle;
	if (w.render) part.per_render_expression = w.render;
	return effect(
		{
			...(Object.keys(init).length ? { 'minecraft:emitter_initialization': init } : {}),
			...(w.event ? { 'minecraft:emitter_lifetime_events': { creation_event: 'write' } } : {}),
			'minecraft:emitter_rate_instant': { num_particles: 1 },
			...(w.ends ? { 'minecraft:emitter_lifetime_once': { active_time: w.ends } } : { 'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 0 } }),
			'minecraft:particle_lifetime_expression': { max_lifetime: w.ends ?? 1000 },
			...(Object.keys(part).length ? { 'minecraft:particle_initialization': part } : {}),
			'minecraft:particle_appearance_billboard': BILLBOARD(0),
		},
		w.event ? { write: { expression: w.event } } : undefined,
	);
}

const PINK = [1, 0.4, 0.8, 1];
const WHITE = [1, 1, 1, 1];

// ---------------------------------------------------------------- layout

export const SCOPE_LAYOUT = { spacing: 5, flagDy: 4.6 };

/** Every scope entity with its variant (1, 2, …), in test, station, actor order */
export interface Placed {
	test: ScopeTest;
	station: Station;
	actor: ScopeEntity;
	variant: number;
	key: string;
}

export function scopeEntities(): Placed[] {
	const out: Placed[] = [];
	for (const test of SCOPE_TESTS)
		for (const station of test.stations)
			station.actors.forEach((actor, i) => {
				if (actor.kind === 'entity') out.push({ test, station, actor, variant: out.length + 1, key: `${test.id}_${station.id}_${i}` });
			});
	return out;
}

/** Particle effects of the scope tests, by name (identifier oxygen:scope_<name>) */
export function scopeEffects(): Record<string, Json> {
	const fx: Record<string, Json> = { nop: writerEffect({}) };
	for (const p of scopeEntities()) {
		const a = p.actor;
		if (a.flag) fx[`af${p.variant}`] = square(sizeOf(a.flag.expr, a.flag.values, FLAG), PINK, {}, true);
		if (a.writes?.particle) fx[`pw${p.variant}`] = writerEffect({ emitter: a.writes.particle });
	}
	for (const test of SCOPE_TESTS)
		for (const station of test.stations)
			station.actors.forEach((a, i) => {
				const key = `${test.id}_${station.id}_${i}`;
				if (a.kind === 'particle') fx[`w_${key}`] = writerEffect(a);
				if (a.kind === 'flag') fx[`f_${key}`] = square(a.size ?? sizeOf(a.expr, a.values, FLAG), WHITE, a.creation ? { 'minecraft:emitter_initialization': { creation_expression: a.creation } } : {});
			});
	// what an attachable fires at the hand: c.item_slot as the attachable sees it
	fx.att_slot = square("((c.item_slot ?? 'none') == 'main_hand') ? 0.3 : (((c.item_slot ?? 'none') == 'none') ? 0.08 : 0.04)", PINK, {}, true);
	return fx;
}

// ---------------------------------------------------------------- the scope entity (RP)

const INDICATOR_X = [-15, -5, 5, 15];
const INDICATOR_Y = [22, 34];

/** geometry.oxygen_scope: a body, eight indicator cubes on its head, a hidden calc bone, a turned bone, a locator above */
export function scopeGeometry(): Json {
	const indicators = Array.from({ length: 8 }, (_, i) => {
		const x = INDICATOR_X[i % 4];
		const y = INDICATOR_Y[Math.floor(i / 4)];
		return { name: `i${i + 1}`, parent: 'root', pivot: [x, y, 0], cubes: [{ origin: [x - 2, y - 2, -2], size: [4, 4, 4], uv: [(i % 4) * 16, 32 + Math.floor(i / 4) * 8] }] };
	});
	return {
		format_version: '1.16.0',
		'minecraft:geometry': [
			{
				description: { identifier: 'geometry.oxygen_scope', texture_width: 64, texture_height: 64, visible_bounds_width: 4, visible_bounds_height: 4, visible_bounds_offset: [0, 1.5, 0] },
				bones: [
					{ name: 'root', pivot: [0, 0, 0], cubes: [{ origin: [-3, 0, -2], size: [6, 16, 4], uv: [0, 0] }], locators: { top: [0, 44, 0] } },
					// readers' and writers' bone channels run on these (a small cube inside the body, so they're drawn)
					{ name: 'calc', parent: 'root', pivot: [0, 4, 0], cubes: [{ origin: [-1, 3, -1], size: [2, 2, 2], uv: [0, 48] }] },
					{ name: 'turn30', parent: 'root', pivot: [0, 8, 0], rotation: [0, 0, 30], cubes: [{ origin: [-1, 7, -1], size: [2, 2, 2], uv: [0, 48] }] },
					...indicators,
				],
			},
		],
	};
}

/** Grey (scope) or tan (scope_b) body; the indicator colours below y 32 */
export function scopeTexture(body: [number, number, number]): Uint8Array {
	return makeImage(64, 64, (x, y) => {
		if (y >= 32 && y < 48) {
			const slot = Math.floor(x / 16) + (y >= 40 ? 4 : 0);
			return [...SLOT_RGB[slot], 255];
		}
		return [...body, 255];
	});
}

/** Animations every scope entity shares */
function sharedAnimations(): Json {
	const a: Json = {
		'animation.oxygen_scope.display': { loop: true, bones: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`i${i + 1}`, { scale: `v.r${i + 1} ?? 0` }])) },
		'animation.oxygen_scope.nop': { loop: true, animation_length: 1 },
		'animation.oxygen_scope.idle': { loop: true, animation_length: 1 },
		// a controller state waits for this to finish (readers check 1 s after they are summoned)
		'animation.oxygen_scope.tick': { animation_length: 1, timeline: { '0.9': 'v.ticked = 1;' } },
	};
	for (let k = 1; k <= 8; k++) {
		[...CUBE.values, CUBE.unset, CUBE.other].forEach((size, i) => {
			a[`animation.oxygen_scope.set_${k}_${i}`] = { loop: true, animation_length: 0.5, timeline: { '0.1': `v.r${k} = ${size};` } };
		});
	}
	return a;
}

/** A reader's controller leaves its wait state when the 1 s tick animation is over (either sign of it) */
const WAITED = 'q.all_animations_finished || ((v.ticked ?? 0) > 0)';

/** The variant condition */
const is = (n: number) => `q.variant == ${n}`;
/** Statements run only on variant n (a braced block) */
const only = (n: number, code: string) => `(${is(n)}) ? { ${code} };`;

/** RP: both client entities, their animations, controllers and render controllers; the attachables */
export function scopeClient(): { entities: Record<'scope' | 'scope_b', Json>; animations: Json; controllers: Json; renderControllers: Json; attachables: Record<string, Json>; attachableGeometry: Json } {
	const animations = sharedAnimations();
	const names: Json = { display: 'animation.oxygen_scope.display', nop: 'animation.oxygen_scope.nop', tick: 'animation.oxygen_scope.tick' };
	const animate: (string | Json)[] = ['display'];
	const initialize: string[] = ['v.initvar = q.variant;'];
	const preAnimation: string[] = [];
	const preReads: string[] = [];
	const initReads: string[] = [];
	const controllers: Json = {};
	const renderControllers: Json = {};
	const renderList: (string | Json)[] = ['controller.render.oxygen_scope'];
	const renderReads = new Map<number, [number, string][]>();
	const effects: Json = {};
	for (const name of Object.keys(scopeEffects())) effects[name] = `oxygen:scope_${name}`;

	for (const { actor: a, variant: n } of scopeEntities()) {
		const w = a.writes ?? {};
		const boneReads: string[] = [];
		const timelineReads: string[] = [];
		const entryReads: string[] = [];
		let transitionRead: { k: number; r: Read } | null = null;
		(a.reads ?? []).forEach((r, i) => {
			const k = i + 1;
			const size = sizeOf(r.expr, r.values, CUBE);
			switch (r.ctx) {
				case 'timeline':
					timelineReads.push(`v.r${k} = ${size};`);
					break;
				case 'bone':
					boneReads.push(`v.r${k} = ${size};`);
					break;
				case 'pre_animation':
					preReads.push(`v.rp${n}_${k} = ${size};`);
					boneReads.push(`v.r${k} = v.rp${n}_${k} ?? 0;`);
					break;
				case 'initialize':
					initReads.push(`v.ri${n}_${k} = ${size};`);
					boneReads.push(`v.r${k} = v.ri${n}_${k} ?? 0;`);
					break;
				case 'on_entry':
					entryReads.push(`v.r${k} = ${size};`);
					break;
				case 'transition':
					transitionRead = { k, r };
					break;
				case 'animate': {
					const { val, unset } = probeOf(r.expr);
					const conds = [...r.values.map((v) => `!(${unset}) && (${val} == ${v})`), unset, [`!(${unset})`, ...r.values.map((v) => `(${val} != ${v})`)].join(' && ')];
					const sizeIndex = [...r.values.map((_, j) => j), 3, 4];
					conds.forEach((c, j) => {
						names[`a${n}_${k}_${j}`] = `animation.oxygen_scope.set_${k}_${sizeIndex[j]}`;
						animate.push({ [`a${n}_${k}_${j}`]: `(${is(n)}) && (${c})` });
					});
					break;
				}
				case 'render': {
					if (!renderReads.has(k)) renderReads.set(k, []);
					const { val, unset } = probeOf(r.expr);
					renderReads.get(k)!.push([n, `!(${unset}) && (${val} == ${r.values[0]})`]);
					boneReads.push(`v.r${k} = 1.5;`);
					break;
				}
			}
		});

		// animation timeline: reads, then (separately) the timeline writer
		if (timelineReads.length) {
			animations[`animation.oxygen_scope.rt${n}`] = { loop: true, animation_length: 0.5, timeline: { '0.1': timelineReads.join(' ') } };
			names[`rt${n}`] = `animation.oxygen_scope.rt${n}`;
			animate.push({ [`rt${n}`]: is(n) });
		}
		if (w.once) {
			animations[`animation.oxygen_scope.wo${n}`] = { animation_length: 0.3, timeline: { '0.1': w.once } };
			names[`wo${n}`] = `animation.oxygen_scope.wo${n}`;
			animate.push({ [`wo${n}`]: is(n) });
		}
		if (w.timeline) {
			animations[`animation.oxygen_scope.wt${n}`] = { loop: true, animation_length: 0.5, timeline: { '0.1': w.timeline } };
			names[`wt${n}`] = `animation.oxygen_scope.wt${n}`;
			animate.push({ [`wt${n}`]: is(n) });
		}
		// bone channels: reads on calc's X, the writer on its Y (two expressions)
		if (boneReads.length || w.bone) {
			animations[`animation.oxygen_scope.bc${n}`] = {
				loop: true,
				bones: { calc: { position: [boneReads.length ? `${boneReads.join(' ')} return 0;` : 0, w.bone ? `${w.bone} return 0;` : 0, 0] } },
			};
			names[`bc${n}`] = `animation.oxygen_scope.bc${n}`;
			animate.push({ [`bc${n}`]: is(n) });
		}
		// controller reads: wait 1 s, then check (on_entry reads), then a state per answer (the transition read)
		if (entryReads.length || transitionRead) {
			const states: Json = {
				wait: { animations: ['tick'], transitions: [{ check: WAITED }] },
				check: { ...(entryReads.length ? { on_entry: entryReads } : {}) },
			};
			if (transitionRead) {
				const { k, r } = transitionRead as { k: number; r: Read };
				const { val, unset } = probeOf(r.expr);
				const answers: [string, string, number][] = [['unset', unset, CUBE.unset], ...r.values.map((v, j): [string, string, number] => [`v${j}`, `${val} == ${v}`, CUBE.values[j]]), ['other', '1', CUBE.other]];
				states.check.transitions = answers.map(([s, c]) => ({ [s]: c }));
				for (const [s, , size] of answers) states[s] = { on_entry: [`v.r${k} = ${size};`] };
			}
			controllers[`controller.animation.oxygen_scope.r${n}`] = { initial_state: 'wait', states };
			names[`rc${n}`] = `controller.animation.oxygen_scope.r${n}`;
			animate.push({ [`rc${n}`]: is(n) });
		}
		// controller writers
		if (w.on_entry) {
			controllers[`controller.animation.oxygen_scope.we${n}`] = { initial_state: 'default', states: { default: { transitions: [{ w: '1' }] }, w: { on_entry: [w.on_entry] } } };
			names[`we${n}`] = `controller.animation.oxygen_scope.we${n}`;
			animate.push({ [`we${n}`]: is(n) });
		}
		if (w.on_exit_late) {
			controllers[`controller.animation.oxygen_scope.wxl${n}`] = {
				initial_state: 'default',
				states: { default: { animations: ['tick'], on_exit: [w.on_exit_late], transitions: [{ after: WAITED }] }, after: { on_entry: ['v.exited = 1;'] } },
			};
			names[`wxl${n}`] = `controller.animation.oxygen_scope.wxl${n}`;
			animate.push({ [`wxl${n}`]: is(n) });
		}
		if (w.initial_entry) {
			controllers[`controller.animation.oxygen_scope.wi${n}`] = { initial_state: 'default', states: { default: { on_entry: [w.initial_entry] } } };
			names[`wi${n}`] = `controller.animation.oxygen_scope.wi${n}`;
			animate.push({ [`wi${n}`]: is(n) });
		}
		if (w.transition) {
			controllers[`controller.animation.oxygen_scope.wtr${n}`] = { initial_state: 'default', states: { default: { transitions: [{ never: `${w.transition} return 0;` }] }, never: {} } };
			names[`wtr${n}`] = `controller.animation.oxygen_scope.wtr${n}`;
			animate.push({ [`wtr${n}`]: is(n) });
		}
		if (w.on_exit) {
			controllers[`controller.animation.oxygen_scope.wx${n}`] = { initial_state: 'default', states: { default: { on_exit: [w.on_exit], transitions: [{ after: '1' }] }, after: { on_entry: ['v.exited = 1;'] } } };
			names[`wx${n}`] = `controller.animation.oxygen_scope.wx${n}`;
			animate.push({ [`wx${n}`]: is(n) });
		}
		// scripts
		if (w.pre_animation) preAnimation.push(only(n, w.pre_animation));
		if (w.initialize) initialize.push(only(n, w.initialize));
		if (w.animate) {
			names[`nop${n}`] = 'animation.oxygen_scope.nop';
			animate.push({ [`nop${n}`]: `${only(n, w.animate)} return 0;` });
		}
		// render controller writer: a controller of its own, drawn only for this variant
		if (w.render) {
			renderControllers[`controller.render.oxygen_scope_w${n}`] = {
				geometry: 'Geometry.default',
				materials: [{ '*': 'Material.default' }],
				textures: ['Texture.default'],
				part_visibility: [{ '*': false }, { calc: `${w.render} return 1;` }],
			};
			renderList.push({ [`controller.render.oxygen_scope_w${n}`]: is(n) });
		}
		// effects it fires when it appears: its flag, a pre_effect_script writer, a writing effect
		const fire: Json[] = [];
		if (a.flag) fire.push({ effect: `af${n}`, locator: 'top', ...(a.flag.pre ? { pre_effect_script: a.flag.pre } : {}) });
		if (w.pre_effect) fire.push({ effect: 'nop', pre_effect_script: w.pre_effect });
		if (w.particle) fire.push({ effect: `pw${n}` });
		if (fire.length) {
			animations[`animation.oxygen_scope.f${n}`] = { animation_length: 0.05, particle_effects: { '0.0': fire } };
			names[`f${n}`] = `animation.oxygen_scope.f${n}`;
			animate.push({ [`f${n}`]: is(n) });
		}
	}

	// the main render controller: indicators a render controller reads are visible only when it reads the expected value
	const visibility: Json[] = [{ '*': true }];
	for (const [k, list] of renderReads) {
		let e = '1';
		for (const [n, cond] of [...list].reverse()) e = `(${is(n)}) ? (${cond}) : (${e})`;
		visibility.push({ [`i${k}`]: e });
	}
	renderControllers['controller.render.oxygen_scope'] = { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'], part_visibility: visibility };

	const client = (id: string, texture: string): Json => ({
		format_version: '1.10.0',
		'minecraft:client_entity': {
			description: {
				identifier: id,
				materials: { default: 'entity_alphatest' },
				textures: { default: texture },
				geometry: { default: 'geometry.oxygen_scope' },
				render_controllers: renderList,
				particle_effects: effects,
				animations: names,
				// writers first, then reads (one expression each)
				scripts: { initialize: [...initialize, ...initReads], pre_animation: [...preAnimation, ...preReads], animate },
			},
		},
	});

	// vanilla armor stand animations (/playanimation): a writer timeline, a head-scaling reader
	const standAnims: Json = {};
	for (const test of SCOPE_TESTS)
		for (const station of test.stations)
			station.actors.forEach((a, i) => {
				if (a.kind !== 'stand') return;
				const key = `${test.id}_${station.id}_${i}`;
				// the writer raises the left arm (it shows the animation plays); the reader raises the right one by what it reads
				if (a.write) standAnims[`animation.oxygen_scope.vw_${key}`] = { loop: true, animation_length: 0.5, timeline: { '0.1': a.write }, bones: { leftarm: { rotation: [-90, 0, 0] } } };
				if (a.read) standAnims[`animation.oxygen_scope.vr_${key}`] = { loop: true, bones: { rightarm: { rotation: [`-45 * (${sizeOf(a.read.expr, a.read.values, CUBE)})`, 0, 0] } } };
			});

	return {
		entities: { scope: client('oxygen:scope', 'textures/entity/oxygen_scope'), scope_b: client('oxygen:scope_b', 'textures/entity/oxygen_scope_b') },
		animations: { format_version: '1.8.0', animations: { ...animations, ...standAnims, ...attachableAnimations() } },
		controllers: { format_version: '1.10.0', animation_controllers: controllers },
		renderControllers: { format_version: '1.8.0', render_controllers: { ...renderControllers, ...attachableRenderControllers() } },
		attachables: attachables(),
		attachableGeometry: attachableGeometry(),
	};
}

// ---------------------------------------------------------------- attachables (s05 att, s08 att)

/** Items with an attachable of ours: w writes a temp, c shows the context values */
export const SCOPE_ITEMS = {
	w: 'oxygen:scope_item_w',
	c: 'oxygen:scope_item_c',
	d1: 'oxygen:scope_item_d1',
	d2: 'oxygen:scope_item_d2',
	d3: 'oxygen:scope_item_d3',
	d4: 'oxygen:scope_item_d4',
	d5: 'oxygen:scope_item_d5',
} as const;

/** Three cubes held at the right hand (bone rightitem binds to the holder's) */
function attachableGeometry(): Json {
	const cube = (name: string, i: number) => ({ name, parent: 'rightitem', pivot: [-6 + (i - 1) * 5, 10, -2], cubes: [{ origin: [-8 + (i - 1) * 5, 8, -4], size: [4, 4, 4], uv: [i * 16, 32] }] });
	return {
		format_version: '1.16.0',
		'minecraft:geometry': [
			{
				description: { identifier: 'geometry.oxygen_scope_item', texture_width: 64, texture_height: 64, visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 1, 0] },
				bones: [{ name: 'rightitem', pivot: [-6, 15, 1], locators: { hand: [-6, 6, -2] } }, cube('a1', 0), cube('a2', 1), cube('a3', 2)],
			},
		],
	};
}

function attachableAnimations(): Json {
	return {
		'animation.oxygen_scope.att_display': { loop: true, bones: { a1: { scale: 'v.c1 ?? 0' }, a2: { scale: 'v.c2 ?? 0' }, a3: { scale: 'v.c3 ?? 0' } } },
		'animation.oxygen_scope.att_fire': { animation_length: 0.05, particle_effects: { '0.0': [{ effect: 'slot', locator: 'hand' }] } },
		// s18 diagnostics: cubes a1–a3 at 3× = the check holds, ½ = it doesn't, 1 = the animation never applied
		'animation.oxygen_scope.att_big': { loop: true, bones: { a1: { scale: 3 }, a2: { scale: 3 }, a3: { scale: 3 } } },
		'animation.oxygen_scope.att_var': { loop: true, bones: { a1: { scale: '(v.x ?? 0) == 3 ? 3 : 0.5' } } },
		'animation.oxygen_scope.att_ctx': {
			loop: true,
			bones: {
				a1: { scale: "((c.item_slot ?? 'none') == 'main_hand') ? 3 : 0.5" },
				a2: { scale: '((c.is_first_person ?? -1) == 0) ? 3 : 0.5' },
				a3: { scale: '(c.owning_entity -> q.is_alive) ? 3 : 0.5' },
			},
		},
	};
}

function attachableRenderControllers(): Json {
	return {
		'controller.render.oxygen_scope_item': { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] },
		// s18 d5: context in a render controller: a1 shown = main hand, a2 shown = not first person, a3 shown = owner alive
		'controller.render.oxygen_scope_item_ctx': {
			geometry: 'Geometry.default',
			materials: [{ '*': 'Material.default' }],
			textures: ['Texture.default'],
			part_visibility: [{ '*': true }, { a1: "(c.item_slot ?? 'none') == 'main_hand'" }, { a2: '(c.is_first_person ?? -1) == 0' }, { a3: 'c.owning_entity -> q.is_alive' }],
		},
	};
}

function attachables(): Record<string, Json> {
	const base = (id: string, scripts: Json, extra: Json = {}): Json => ({
		format_version: '1.10.0',
		'minecraft:attachable': {
			description: {
				identifier: id,
				materials: { default: 'entity_alphatest', enchanted: 'entity_alphatest_glint' },
				textures: { default: 'textures/entity/oxygen_scope', enchanted: 'textures/misc/enchanted_item_glint' },
				geometry: { default: 'geometry.oxygen_scope_item' },
				render_controllers: ['controller.render.oxygen_scope_item'],
				scripts,
				...extra,
			},
		},
	});
	const slot = "(c.item_slot ?? 'none')";
	return {
		w: base(SCOPE_ITEMS.w, { pre_animation: ['t.s17_att = 7;'] }),
		d1: base(SCOPE_ITEMS.d1, { animate: ['big'] }, { animations: { big: 'animation.oxygen_scope.att_big' } }),
		d2: base(SCOPE_ITEMS.d2, { animate: [{ big: '1' }] }, { animations: { big: 'animation.oxygen_scope.att_big' } }),
		d3: base(SCOPE_ITEMS.d3, { pre_animation: ['v.x = 3;'], animate: ['var'] }, { animations: { var: 'animation.oxygen_scope.att_var' } }),
		d4: base(SCOPE_ITEMS.d4, { animate: ['ctx'] }, { animations: { ctx: 'animation.oxygen_scope.att_ctx' } }),
		d5: { ...base(SCOPE_ITEMS.d5, {}), 'minecraft:attachable': { description: { ...base(SCOPE_ITEMS.d5, {})['minecraft:attachable'].description, render_controllers: ['controller.render.oxygen_scope_item_ctx'] } } },
		c: base(
			SCOPE_ITEMS.c,
			{
				pre_animation: [
					`v.c1 = (${slot} == 'main_hand') ? 2 : ((${slot} == 'none') ? 0.6 : 0.3);`,
					`v.c2 = ${sizeOf('c.is_first_person', [0, 1], CUBE)};`,
					`v.c3 = ${sizeOf('c.owning_entity -> q.is_alive', [1], CUBE)};`,
					`t.s08_slot = (${slot} == 'main_hand') ? 7 : ((${slot} == 'none') ? 1 : 3);`,
					't.s08_fp = c.is_first_person;',
					't.s08_oe = c.owning_entity -> q.is_alive;',
				],
				animate: ['display', 'fire'],
			},
			{ animations: { display: 'animation.oxygen_scope.att_display', fire: 'animation.oxygen_scope.att_fire' }, particle_effects: { slot: 'oxygen:scope_att_slot' } },
		),
	};
}

// ---------------------------------------------------------------- the scope entity (BP)

/** BP: both entity types — variants as events, server-side animations and controllers by variant */
export function scopeBehaviors(): { entities: Record<'scope' | 'scope_b', Json>; animations: Json; controllers: Json; items: Record<string, Json> } {
	const placed = scopeEntities();
	const groups: Json = { despawn: { 'minecraft:instant_despawn': {} } };
	const events: Json = { 'oxygen:despawn': { add: { component_groups: ['despawn'] } } };
	const animations: Json = { 'animation.oxygen_scope_srv.tick': { animation_length: 1, timeline: { '0.9': ['v.ticked = 1;'] } } };
	const controllers: Json = {};
	const names: Json = { tick: 'animation.oxygen_scope_srv.tick' };
	const animate: Json[] = [];
	const BLOCKS = ['lime_wool', 'yellow_wool', 'light_blue_wool'];
	for (const { actor: a, variant: n } of placed) {
		groups[`v${n}`] = { 'minecraft:variant': { value: n } };
		events[`oxygen:v${n}`] = { add: { component_groups: [`v${n}`] } };
		const s = a.server;
		if (!s) continue;
		if (s.timeline) {
			animations[`animation.oxygen_scope_srv.w${n}`] = { loop: true, animation_length: 0.5, timeline: { '0.1': [s.timeline] } };
			names[`w${n}`] = `animation.oxygen_scope_srv.w${n}`;
			animate.push({ [`w${n}`]: is(n) });
		}
		if (s.on_entry) {
			controllers[`controller.animation.oxygen_scope_srv.we${n}`] = { initial_state: 'default', states: { default: { transitions: [{ w: '1' }] }, w: { on_entry: [s.on_entry] } } };
			names[`we${n}`] = `controller.animation.oxygen_scope_srv.we${n}`;
			animate.push({ [`we${n}`]: is(n) });
		}
		if (s.read) {
			const { val, unset } = probeOf(s.read.expr);
			const answers: [string, string, string][] = [['unset', unset, 'red_wool'], ...s.read.values.map((v, j): [string, string, string] => [`v${j}`, `${val} == ${v}`, BLOCKS[j]]), ['other', '1', 'orange_wool']];
			const states: Json = {
				wait: { animations: ['tick'], transitions: [{ check: WAITED }] },
				check: { transitions: answers.map(([st, c]) => ({ [st]: c })) },
			};
			for (const [st, , block] of answers) states[st] = { on_entry: [`/setblock ~1 ~ ~ ${block}`] };
			controllers[`controller.animation.oxygen_scope_srv.r${n}`] = { initial_state: 'wait', states };
			names[`r${n}`] = `controller.animation.oxygen_scope_srv.r${n}`;
			animate.push({ [`r${n}`]: is(n) });
		}
	}
	const entity = (id: string): Json => ({
		format_version: '1.21.0',
		'minecraft:entity': {
			description: {
				identifier: id,
				is_spawnable: false,
				is_summonable: true,
				is_experimental: false,
				properties: { 'oxygen:p': { type: 'int', range: [0, 10], default: 3, client_sync: true } },
				animations: names,
				scripts: { animate },
			},
			component_groups: groups,
			components: {
				'minecraft:type_family': { family: ['oxygen_scope'] },
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
	});
	const item = (id: string): Json => ({ format_version: '1.21.0', 'minecraft:item': { description: { identifier: id, menu_category: { category: 'items' } }, components: { 'minecraft:max_stack_size': 1 } } });
	return {
		entities: { scope: entity('oxygen:scope'), scope_b: entity('oxygen:scope_b') },
		animations: { format_version: '1.10.0', animations },
		controllers: { format_version: '1.10.0', animation_controllers: controllers },
		items: Object.fromEntries(Object.entries(SCOPE_ITEMS).map(([k, id]) => [k, item(id)])),
	};
}

// ---------------------------------------------------------------- commands

/** The function for one test: clear the last run, mark the stations, spawn every actor (delays through oxygen:at) */
export function scopeCommands(test: ScopeTest, z: number, floorY: number, markers: string[]): string[] {
	const spacing = test.spacing ?? SCOPE_LAYOUT.spacing;
	const variants = new Map(scopeEntities().map((p) => [p.actor, p.variant]));
	const out: string[] = [
		'event entity @e[type=oxygen:scope] oxygen:despawn',
		'event entity @e[type=oxygen:scope_b] oxygen:despawn',
		// armor stands from the last run fall out of the world (kill would drop them and their items here)
		'tp @e[type=armor_stand,tag=oxygen_scope] ~ -200 ~',
	];
	const later = (after: number | undefined, command: string) => (after ? out.push(`scriptevent oxygen:at ${JSON.stringify({ after, command })}`) : out.push(command));
	const r = (v: number) => Math.round(v * 100) / 100;
	test.stations.forEach((station, j) => {
		const x = j * spacing;
		const feet = floorY + 1;
		out.push(`setblock ${x} ${floorY} ${z} ${markers[j % markers.length]}_wool`);
		// clear the station (the server's answer from the last run, blocks other tests left on this row)
		out.push(`fill ${x - 2} ${feet} ${z - 2} ${x + 3} ${feet + 4} ${z + 4} air`);
		station.actors.forEach((a, i) => {
			const key = `${test.id}_${station.id}_${i}`;
			if (a.kind === 'entity') {
				const [dx, dz] = a.at ?? [0, 0];
				const pos = `${r(x + dx)} ${feet} ${r(z + dz)}`;
				later(a.after, `summon oxygen:${a.type ?? 'scope'} ${pos} 0 0 oxygen:v${variants.get(a)}`);
				if (a.gone) later(a.gone, `event entity @e[type=oxygen:${a.type ?? 'scope'},x=${r(x + dx)},y=${feet},z=${r(z + dz)},r=1] oxygen:despawn`);
			} else if (a.kind === 'particle') {
				const pos = `${x} ${floorY + 2} ${z + 1}`;
				if (a.vars) later(a.after, `scriptevent oxygen:spawn ${JSON.stringify({ effect: `oxygen:scope_w_${key}`, pos: [x, floorY + 2, z + 1], vars: a.vars })}`);
				else later(a.after, `particle oxygen:scope_w_${key} ${pos}`);
			} else if (a.kind === 'flag') {
				const [dx, dy] = a.at ?? [0, 0];
				const p: [number, number, number] = [r(x + dx), r(floorY + SCOPE_LAYOUT.flagDy + dy), z];
				const after = a.after ?? 1;
				if (a.vars) later(after, `scriptevent oxygen:spawn ${JSON.stringify({ effect: `oxygen:scope_f_${key}`, pos: p, vars: a.vars })}`);
				else later(after, `particle oxygen:scope_f_${key} ${p.join(' ')}`);
			} else if (a.kind === 'cmd') {
				const [dx, dz] = a.at ?? [0, 0];
				later(a.after, a.command.replaceAll('{X}', `${r(x + dx)}`).replaceAll('{Y}', `${feet}`).replaceAll('{Z}', `${r(z + dz)}`));
			} else {
				const [dx, dz] = a.at ?? [0, 0];
				const sel = `@e[type=armor_stand,x=${r(x + dx)},y=${feet},z=${r(z + dz)},r=1]`;
				later(a.after, `summon armor_stand ${r(x + dx)} ${feet} ${r(z + dz)} 180 0`);
				const at = (a.after ?? 0) + 0.1;
				later(at, `tag ${sel} add oxygen_scope`);
				if (a.item) later(at, `replaceitem entity ${sel} slot.weapon.mainhand 0 ${SCOPE_ITEMS[a.item]}`);
				// the client has to know the stand before an animation reaches it
				const play = (a.after ?? 0) + 0.5;
				if (a.write) later(play, `playanimation ${sel} animation.oxygen_scope.vw_${key} a 0 "0" oxygen_w`);
				if (a.stop) later(play, `playanimation ${sel} animation.oxygen_scope.idle a 0 "${a.stop}" oxygen_s`);
				if (a.read) later(play, `playanimation ${sel} animation.oxygen_scope.vr_${key} a 0 "0" oxygen_r`);
			}
		});
	});
	return out;
}
