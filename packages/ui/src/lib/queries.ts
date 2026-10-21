import { STRUCT_QUERIES, type Value } from 'molangjs';
import type { ParticleWorld, QueryContext, QueryProvider, Vec3 } from 'wintersky';
import { getQuery } from '@oxygen/metadata';
import { callSignature } from './inputs';

/** The stand-in entity as the queries see it */
export interface QueryEntity {
	position: Vec3;
	velocity: Vec3;
	yaw: number;
}

/** `query.bone_aabb.min.y` (one member of a struct query) → `['query.bone_aabb', 'min.y']`; others → `[name, null]` */
export function splitMember(name: string): [string, string | null] {
	for (const q of Object.keys(STRUCT_QUERIES)) if (name.startsWith(q + '.')) return [q, name.slice(q.length + 1)];
	return [name, null];
}

export interface PreviewQueryOptions {
	/** Scenario values (exact call signature or bare name); undefined = use the live value */
	override: (name: string, args: Value[], world: ParticleWorld) => Value | undefined;
	/** Scene settings */
	timeOfDay: () => number;
	lastDelta: () => number;
	/** The stand-in entity, when the effect is spawned on one */
	entity: () => QueryEntity | null;
}

const DEG = 180 / Math.PI;

/**
 * Values for world queries in the preview: camera, emitter, time and counts come from the live scene;
 * a scenario can pin any query (by exact call signature or by name). Queries with no value return
 * undefined, which the engine reports once and treats as 0.
 */
export class PreviewQueries implements QueryProvider {
	/** While on, the last value of every call signature is kept (the Context panel shows them) */
	recording = false;
	readonly last = new Map<string, Value | undefined>();

	constructor(private o: PreviewQueryOptions) {}

	resolve(name: string, args: Value[], ctx: QueryContext): Value | undefined {
		const [base, member] = splitMember(name);
		// a scenario value for the whole struct query (q.bone_origin('head')) answers each of its members
		const set = this.o.override(name, args, ctx.world) ?? (member ? this.o.override(base, args, ctx.world) : undefined);
		// bone queries never find a bone in particle Molang (e15), so only a scenario value answers them
		const v = !member && this.creationBlind(base, ctx) ? 0 : (set ?? (member ? undefined : this.live(name, args, ctx)));
		if (this.recording) {
			// calls with ever-changing arguments (q.position(v.particle_age)) would grow this without end
			if (this.last.size > 512) this.last.clear();
			this.last.set(callSignature(name, args), v);
		}
		return v;
	}

	/** Why a query has no value here, for the problem the engine reports */
	why(name: string, _args: Value[], ctx: QueryContext): string | undefined {
		const [base] = splitMember(name);
		const info = getQuery(base);
		if (!info) return undefined;
		if (STRUCT_QUERIES[base]) {
			const found = "particle effects never find a bone in-game ('Could not find specified bone' on an entity, whatever its queryable_geometry, and in /particle effects: e29, t80)";
			return `${found}. The struct reads 0 and the expression goes on (give the query a value in Context to try one out)`;
		}
		if (base === 'query.relative_block_has_any_tag') return "the game can't evaluate it in particle Molang or pre_effect_script ('Scope requires an Actor', e16): it reads 0";
		if (info.context === 'entity' && ctx.emitter.rootContext !== 'entity') return "it asks about the entity an effect is on, and this one isn't spawned on an entity (use the Entity spawn mode, or give it a value in Context)";
		return undefined;
	}

	/**
	 * An emitter on an entity can't see the entity's queries yet in its creation expression: they read 0 there,
	 * though pre_effect_script and the update expression see them (e07, e10).
	 */
	private creationBlind(name: string, ctx: QueryContext): boolean {
		if (ctx.emitter.rootContext !== 'entity') return false;
		const c = ctx.world.current;
		return c.phase === 'creation' && c.path.endsWith('/creation_expression') && getQuery(name)?.context === 'entity';
	}

	private live(name: string, args: Value[], ctx: QueryContext): Value | undefined {
		const w = ctx.world;
		const cam = w.camera;
		const e = ctx.emitter;
		const n = (i: number) => (typeof args[i] === 'number' ? (args[i] as number) : 0);
		const dx = cam.position[0] - e.position[0];
		const dy = cam.position[1] - e.position[1];
		const dz = cam.position[2] - e.position[2];
		const dist = Math.hypot(dx, dy, dz);
		switch (name) {
			case 'query.camera_rotation': {
				// effects spawned by /particle or scripts read 0 on both axes whatever the camera does (t60, t61, t63)
				if (e.rootContext !== 'entity') return 0;
				// x = pitch (down positive), y = yaw (Minecraft: 0 = south/+Z, clockwise)
				const f = cam.forward;
				if (n(0) === 0) return -Math.asin(Math.max(-1, Math.min(1, f[1]))) * DEG;
				return Math.atan2(-f[0], f[2]) * DEG;
			}
			case 'query.rotation_to_camera': {
				// /particle and script spawns: a constant 0 (x) and -90 (y) wherever the camera is (t62, t63)
				if (e.rootContext !== 'entity') return n(0) === 0 ? 0 : -90;
				if (n(0) === 0) return -Math.atan2(dy, Math.hypot(dx, dz)) * DEG;
				return Math.atan2(-dx, dz) * DEG;
			}
			case 'query.distance_from_camera':
				return dist;
			case 'query.camera_distance_range_lerp': {
				const a = Math.min(n(0), n(1));
				const b = Math.max(n(0), n(1));
				return b > a ? Math.min(1, Math.max(0, (dist - a) / (b - a))) : 0;
			}
			case 'query.lod_index': {
				let i = 0;
				while (i < args.length && dist > n(i)) i++;
				return i;
			}
			case 'query.position': {
				// on an entity: where the entity stands, not the locator (e07, e11)
				const a = e.rootContext === 'entity' ? this.o.entity() : null;
				return (a ?? e).position[Math.max(0, Math.min(2, n(0)))];
			}
			case 'query.position_delta': {
				const a = e.rootContext === 'entity' ? this.o.entity() : null;
				return (a ?? e).velocity[Math.max(0, Math.min(2, n(0)))] * this.o.lastDelta();
			}
			case 'query.life_time':
				// the time since the current animation started: particles read 0, on an entity too (e16, e17)
				return 0;
			case 'query.delta_time':
				// particles read 0, on an entity (e16, e17) and in /particle effects (t80)
				return 0;
			case 'query.last_frame_time':
			case 'query.average_frame_time':
			case 'query.minimum_frame_time':
			case 'query.maximum_frame_time':
				return this.o.lastDelta();
			case 'query.frame_alpha':
				return 0;
			case 'query.time_of_day':
				return this.o.timeOfDay();
			case 'query.day':
				return 0;
			case 'query.time_stamp':
				return Math.floor(w.time * 20);
			case 'query.moon_phase':
				return 0;
			case 'query.moon_brightness':
				return 1;
			case 'query.get_level_seed_based_fraction':
				return 0.5;
			case 'query.is_in_ui':
				return 0;
			case 'query.total_emitter_count':
				return w.emitters.length;
			case 'query.total_particle_count':
				return w.particleCount;
			case 'query.effect_emitter_count':
				return w.emitters.filter((x) => x.def === e.def).length;
			case 'query.effect_particle_count':
				return w.emitters.filter((x) => x.def === e.def).reduce((s, x) => s + x.pool.count, 0);
			case 'query.is_alive':
				// the preview's stand-in entity is alive; world-spawned emitters have no actor to ask
				return e.rootContext === 'entity' ? 1 : undefined;
			case 'query.is_moving':
			case 'query.ground_speed':
			case 'query.vertical_speed':
			case 'query.body_y_rotation':
			case 'query.head_y_rotation':
			case 'query.is_on_ground': {
				const a = e.rootContext === 'entity' ? this.o.entity() : null;
				if (!a) return undefined;
				const ground = Math.hypot(a.velocity[0], a.velocity[2]);
				if (name === 'query.is_moving') return ground + Math.abs(a.velocity[1]) > 1e-3 ? 1 : 0;
				if (name === 'query.ground_speed') return ground;
				if (name === 'query.vertical_speed') return a.velocity[1];
				if (name === 'query.is_on_ground') return a.position[1] < 1e-3 ? 1 : 0;
				return a.yaw;
			}
			case 'query.log':
			case 'query.debug_output':
				return 0;
			default:
				return undefined;
		}
	}
}
