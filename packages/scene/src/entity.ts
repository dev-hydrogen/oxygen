import type { Attachment, Quat, Vec3 } from 'wintersky';

/**
 * A locator on the entity's model, as a geometry file writes it: an offset in model units (16 per block, the model's
 * own axes) and a rotation in degrees. Locators imported from a model are already resolved through their bones:
 * `offset` is where the bones put them and `frame` their whole rotation.
 */
export interface Locator {
	name: string;
	offset: Vec3;
	/** the locator's own rotation (degrees, Bedrock geometry order) */
	rotation?: Vec3;
	/** the bones' and the locator's rotation together, for imported locators (overrides `rotation`) */
	frame?: Quat;
	/** ignore_inherited_scale: the entity's scale moves the locator but doesn't scale its frame */
	ignoreScale?: boolean;
	/** the bone it sits on, for display */
	bone?: string;
}

/** A new locator's starting point: a block and a half up, the height of a player's chest */
export const NEW_LOCATOR: Locator = { name: 'locator', offset: [0, 24, 0] };

export type Motion =
	| { kind: 'still' }
	| { kind: 'circle'; radius: number; speed: number }
	| { kind: 'line'; length: number; speed: number }
	| { kind: 'bob'; height: number; speed: number }
	/** through waypoints at a steady speed; at the last one, back to the first (`loop`) or back the way it came */
	| { kind: 'path'; points: Vec3[]; speed: number; ends: 'loop' | 'reverse' };

/** A path to start from: a 4 × 4 square on the ground */
export const DEFAULT_PATH: Vec3[] = [
	[-2, 0, -2],
	[2, 0, -2],
	[2, 0, 2],
	[-2, 0, 2],
];

/**
 * Where a path motion is at time `t`, and which way it heads (horizontal; null on a vertical stretch).
 * A looping path closes from the last point back to the first.
 */
export function pathAt(m: Extract<Motion, { kind: 'path' }>, t: number): { position: Vec3; heading: [number, number] | null } {
	const pts = m.points.length ? m.points : [[0, 0, 0] as Vec3];
	const route = m.ends === 'loop' && pts.length > 2 ? [...pts, pts[0]] : pts;
	const ends: number[] = [0];
	for (let i = 1; i < route.length; i++) ends.push(ends[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1], route[i][2] - route[i - 1][2]));
	const total = ends[ends.length - 1];
	if (total < 1e-6) return { position: [...route[0]], heading: null };
	let d = Math.max(0, t) * Math.max(0.01, m.speed);
	let forward = true;
	if (m.ends === 'loop') d %= total;
	else {
		const p = d % (2 * total);
		forward = p < total;
		d = forward ? p : 2 * total - p;
	}
	let i = 1;
	while (i < route.length - 1 && ends[i] < d) i++;
	const a = route[i - 1];
	const b = route[i];
	const len = ends[i] - ends[i - 1];
	const f = len > 0 ? (d - ends[i - 1]) / len : 0;
	const dx = (b[0] - a[0]) * (forward ? 1 : -1);
	const dz = (b[2] - a[2]) * (forward ? 1 : -1);
	return { position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], heading: Math.hypot(dx, dz) > 1e-6 ? [dx, dz] : null };
}

export interface EntitySettings {
	motion: Motion;
	/** where it stands, or the point its motion goes round (a path's points are relative to it); the world origin when unset */
	origin?: Vec3;
	/** the locator effects are attached to; empty for none (the entity's own position) */
	locator: string;
	/** the model's locators (made here or imported from a geometry file) */
	locators?: Locator[];
	/** the geometry the locators came from, for display */
	model?: string;
	/** which way it faces when it doesn't walk, Minecraft's yaw in degrees: 0 south (+Z), 90 west (-X) */
	yaw?: number;
	/** collision box width and height in blocks, before scaling (entity_aabb) */
	width?: number;
	height?: number;
	/** minecraft:scale */
	scale?: number;
	/** bind_to_actor: false — the effect starts where the entity is and stays there */
	unbound?: boolean;
	/** the entity goes away (despawns, or the controller state that played the effect ends) after this many seconds */
	removeAfter?: number;
	/** settings layout: 2 since locators are model-space (older files used made-up names in blocks) */
	v?: 2;
}

export const DEFAULT_ENTITY: EntitySettings = { motion: { kind: 'still' }, locator: '', locators: [], width: 0.6, height: 1.8, v: 2 };

/** Older files named made-up attachment points; their offsets were blocks with +Z forward */
const OLD_POINTS: Record<string, Vec3> = {
	body: [0, 0.9, 0],
	head: [0, 1.62, 0],
	right_hand: [-0.375, 1.05, 0.1],
	left_hand: [0.375, 1.05, 0.1],
	above_head: [0, 2.1, 0],
};

/** Entity settings read from a file, brought up to date */
export function readEntity(saved: Partial<EntitySettings> & { locatorFlipY?: boolean } = {}): EntitySettings {
	const { locatorFlipY, ...rest } = saved;
	void locatorFlipY;
	const e: EntitySettings = { ...DEFAULT_ENTITY, ...rest };
	if (saved.v === 2) return e;
	// blocks with +Z forward (the old frame faced +Z at yaw 0, like the model's -Z) → model units
	const toModel = (o: Vec3): Vec3 => [o[0] * 16, o[1] * 16, -o[2] * 16];
	const locators: Locator[] = (saved.locators ?? []).map((l) => ({ name: l.name, offset: toModel(l.offset) }));
	let locator = saved.locator ?? '';
	if (locator === 'root') locator = '';
	else if (locator && !locators.some((l) => l.name === locator) && OLD_POINTS[locator]) locators.push({ name: locator, offset: toModel(OLD_POINTS[locator]) });
	if (locator && !locators.some((l) => l.name === locator)) locator = '';
	return { ...e, locators, locator, v: 2 };
}

// ---------------------------------------------------------------- frames

/** 3 × 3 matrix, row-major */
type Mat = number[];

const mul = (a: Mat, b: Mat): Mat => {
	const o = new Array<number>(9);
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
	return o;
};
const apply = (m: Mat, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const rx = (a: number): Mat => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const ry = (a: number): Mat => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rz = (a: number): Mat => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const RAD = Math.PI / 180;
/** model space → the entity's frame at yaw 0: the model's -Z is its front, which faces south (+Z) */
const MODEL: Mat = [1, 0, 0, 0, 1, 0, 0, 0, -1];
/** locators flip their own Y axis (e01): with MODEL that makes an unturned locator X east, Y down, Z north */
const FLIP_Y: Mat = [1, 0, 0, 0, -1, 0, 0, 0, 1];

/** A Bedrock geometry rotation (degrees) in model space: X, then Y, then Z, with X and Z turning the other way */
export function geometryRotation(r: Vec3): Mat {
	return mul(rz(-r[2] * RAD), mul(ry(r[1] * RAD), rx(-r[0] * RAD)));
}

/** Facing yaw (Minecraft: 0 south, 90 west) as a turn about Y */
function yawTurn(yaw: number): Mat {
	return ry(-yaw * RAD);
}

export function quatFromMat(m: Mat): Quat {
	const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
	const tr = m00 + m11 + m22;
	let x: number, y: number, z: number, w: number;
	if (tr > 0) {
		const s = Math.sqrt(tr + 1) * 2;
		w = 0.25 * s;
		x = (m21 - m12) / s;
		y = (m02 - m20) / s;
		z = (m10 - m01) / s;
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
		w = (m21 - m12) / s;
		x = 0.25 * s;
		y = (m01 + m10) / s;
		z = (m02 + m20) / s;
	} else if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
		w = (m02 - m20) / s;
		x = (m01 + m10) / s;
		y = 0.25 * s;
		z = (m12 + m21) / s;
	} else {
		const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
		w = (m10 - m01) / s;
		x = (m02 + m20) / s;
		y = (m12 + m21) / s;
		z = 0.25 * s;
	}
	return [x, y, z, w];
}

function matFromQuat([x, y, z, w]: Quat): Mat {
	return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

/** A locator's rotation in model space */
function locatorMat(l: Locator): Mat {
	return l.frame ? matFromQuat(l.frame) : geometryRotation(l.rotation ?? [0, 0, 0]);
}

/** Where an effect on the entity sits and which way its axes point */
export interface EntityFrame {
	position: Vec3;
	rotation: Quat;
	/** the frame's scale (spawn offsets scale with it) */
	scale: number;
	/** the frame's axes in the world (X, Y, Z), for drawing */
	axes: [Vec3, Vec3, Vec3];
}

// ---------------------------------------------------------------- geometry files

interface GeoBone {
	name: string;
	parent?: string;
	pivot?: Vec3;
	rotation?: Vec3;
	locators?: Record<string, Vec3 | { offset: Vec3; rotation?: Vec3; ignore_inherited_scale?: boolean }>;
}

/** The models in a geometry file (any format version), each with its locators resolved through its bones */
export function locatorsFromGeometry(json: unknown): { model: string; locators: Locator[] }[] {
	const out: { model: string; locators: Locator[] }[] = [];
	if (!json || typeof json !== 'object') return out;
	const root = json as Record<string, unknown>;
	const models: { id: string; bones: GeoBone[] }[] = [];
	if (Array.isArray(root['minecraft:geometry'])) {
		for (const g of root['minecraft:geometry'] as { description?: { identifier?: string }; bones?: GeoBone[] }[]) models.push({ id: g.description?.identifier ?? 'geometry', bones: g.bones ?? [] });
	}
	// 1.8 / 1.10: "geometry.name" or "geometry.name:parent" at the top level
	for (const [k, v] of Object.entries(root)) {
		if (k.startsWith('geometry.') && v && typeof v === 'object') models.push({ id: k.split(':')[0], bones: ((v as { bones?: GeoBone[] }).bones ?? []) });
	}
	for (const m of models) {
		const byName = new Map(m.bones.filter((b) => b && typeof b.name === 'string').map((b) => [b.name.toLowerCase(), b]));
		const chain = (b: GeoBone): GeoBone[] => {
			const list: GeoBone[] = [];
			const seen = new Set<GeoBone>();
			for (let at: GeoBone | undefined = b; at && !seen.has(at); at = at.parent ? byName.get(at.parent.toLowerCase()) : undefined) {
				seen.add(at);
				list.push(at);
			}
			return list; // the bone first, then its parents
		};
		const locators: Locator[] = [];
		for (const b of m.bones) {
			if (!b?.locators) continue;
			const bones = chain(b);
			for (const [name, raw] of Object.entries(b.locators)) {
				const own = Array.isArray(raw) ? { offset: raw, rotation: [0, 0, 0] as Vec3 } : { offset: raw.offset ?? [0, 0, 0], rotation: raw.rotation ?? ([0, 0, 0] as Vec3) };
				let p: Vec3 = [Number(own.offset[0]) || 0, Number(own.offset[1]) || 0, Number(own.offset[2]) || 0];
				let frame = geometryRotation(own.rotation.map((n) => Number(n) || 0) as Vec3);
				for (const bone of bones) {
					const r = geometryRotation((bone.rotation ?? [0, 0, 0]) as Vec3);
					const pv = (bone.pivot ?? [0, 0, 0]) as Vec3;
					const d = apply(r, [p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]]);
					p = [pv[0] + d[0], pv[1] + d[1], pv[2] + d[2]];
					frame = mul(r, frame);
				}
				const ignore = !Array.isArray(raw) && !!raw.ignore_inherited_scale;
				locators.push({ name, offset: p.map((n) => Math.round(n * 1e4) / 1e4) as Vec3, frame: quatFromMat(frame), bone: b.name, ...(ignore ? { ignoreScale: true } : {}) });
			}
		}
		out.push({ model: m.id, locators });
	}
	return out;
}

// ---------------------------------------------------------------- the stand-in entity

/**
 * The entity an effect is attached to in entity spawn mode: moves along a simple path so local space and
 * travel-distance events can be seen, and carries the model's locators. Frames follow what the game does (e01–e05).
 */
export class EntityDummy {
	position: Vec3 = [0, 0, 0];
	velocity: Vec3 = [0, 0, 0];
	/** Minecraft yaw: 0 faces south (+Z), 90 west (-X) */
	yaw = 0;
	time = 0;
	alive = true;

	private current: EntitySettings;

	constructor(settings: EntitySettings = DEFAULT_ENTITY) {
		this.current = settings;
		this.update(0);
	}

	get settings(): EntitySettings {
		return this.current;
	}

	/** New settings take effect at once: an unbound effect spawned next starts where the entity stands now */
	set settings(next: EntitySettings) {
		this.current = next;
		this.update(0);
	}

	get locators(): Locator[] {
		return this.settings.locators ?? [];
	}

	/** when the effect last started on it: removeAfter counts from here */
	private bornAt = 0;

	/** The effect starts (again) on it: it's there again, until removeAfter from now */
	respawn(): void {
		this.bornAt = this.time;
		this.alive = true;
	}

	update(dt: number): void {
		const prev: Vec3 = [...this.position];
		this.time += dt;
		const m = this.settings.motion;
		const t = this.time;
		const face = (dx: number, dz: number) => (((Math.atan2(-dx, dz) * 180) / Math.PI) % 360 + 360) % 360;
		switch (m.kind) {
			case 'still':
				this.position = [0, 0, 0];
				this.yaw = this.settings.yaw ?? 0;
				break;
			case 'circle': {
				const w = m.speed / Math.max(0.01, m.radius);
				const a = t * w;
				this.position = [Math.sin(a) * m.radius, 0, Math.cos(a) * m.radius];
				// face along the direction of travel: d/dt (sin a, cos a) = (cos a, -sin a)
				this.yaw = face(Math.cos(a), -Math.sin(a));
				break;
			}
			case 'line': {
				const period = (2 * m.length) / Math.max(0.01, m.speed);
				const p = (t % period) / period;
				const s = p < 0.5 ? p * 2 : 2 - p * 2;
				this.position = [0, 0, (s - 0.5) * m.length];
				this.yaw = p < 0.5 ? 0 : 180;
				break;
			}
			case 'bob':
				this.position = [0, (Math.sin(t * m.speed * Math.PI) * 0.5 + 0.5) * m.height, 0];
				this.yaw = this.settings.yaw ?? 0;
				break;
			case 'path': {
				const at = pathAt(m, t);
				this.position = at.position;
				// face the way it walks; straight up or down keeps the last facing
				if (at.heading) this.yaw = face(at.heading[0], at.heading[1]);
				else if (t === 0) this.yaw = this.settings.yaw ?? 0;
				break;
			}
		}
		const o = this.settings.origin;
		if (o) this.position = [this.position[0] + o[0], this.position[1] + o[1], this.position[2] + o[2]];
		if (dt > 0) this.velocity = [(this.position[0] - prev[0]) / dt, (this.position[1] - prev[1]) / dt, (this.position[2] - prev[2]) / dt];
		if (this.settings.removeAfter !== undefined && this.time - this.bornAt >= this.settings.removeAfter) this.alive = false;
	}

	get scale(): number {
		return this.settings.scale ?? 1;
	}

	/** The entity's own frame, used without a locator: X to its right, Y up, Z behind it (e01, e03) */
	get rotation(): Quat {
		return quatFromMat(mul(yawTurn(this.yaw), ry(Math.PI)));
	}

	/**
	 * Where an effect on `locator` is and which way its axes point. Without a locator: the entity's position and
	 * frame. On a locator: its offset through the model (scaled with the entity), and a frame with the locator's
	 * rotation whose Y axis is flipped (so X points to the entity's left, Y down and Z behind it when unturned).
	 */
	frame(locator = this.settings.locator): EntityFrame {
		const loc = locator ? this.locators.find((l) => l.name === locator) : undefined;
		const turn = yawTurn(this.yaw);
		let m: Mat;
		let position: Vec3 = [...this.position];
		let scale = 1;
		if (!loc) m = mul(turn, ry(Math.PI));
		else {
			const toWorld = mul(turn, MODEL);
			const s = this.scale;
			const o = apply(toWorld, [(loc.offset[0] / 16) * s, (loc.offset[1] / 16) * s, (loc.offset[2] / 16) * s]);
			position = [position[0] + o[0], position[1] + o[1], position[2] + o[2]];
			m = mul(toWorld, mul(locatorMat(loc), FLIP_Y));
			scale = loc.ignoreScale ? 1 : s;
		}
		return { position, rotation: quatFromMat(m), scale, axes: [[m[0], m[3], m[6]], [m[1], m[4], m[7]], [m[2], m[5], m[8]]] };
	}

	/** A move in the world as a change of a locator's offset, in model units: what dragging a locator does */
	modelDelta(d: Vec3): Vec3 {
		const m = mul(yawTurn(this.yaw), MODEL);
		// a rotation (and a mirror): its inverse is its transpose
		const k = 16 / (this.scale || 1);
		return [(m[0] * d[0] + m[3] * d[1] + m[6] * d[2]) * k, (m[1] * d[0] + m[4] * d[1] + m[7] * d[2]) * k, (m[2] * d[0] + m[5] * d[1] + m[8] * d[2]) * k];
	}

	locatorPosition(name: string): Vec3 {
		return this.frame(name).position;
	}

	/** The entity's collision box relative to the emitter, in the emitter's frame (entity_aabb, e09) */
	aabb(locator = this.settings.locator): { min: Vec3; max: Vec3 } {
		const f = this.frame(locator);
		// the box is the entity's, unshifted; the frame's own scale already scales it
		const k = this.scale / f.scale;
		const w = ((this.settings.width ?? 0.6) / 2) * k;
		const h = (this.settings.height ?? 1.8) * k;
		return { min: [-w, 0, -w], max: [w, h, w] };
	}

	/**
	 * The wintersky attachment for an emitter on `locator`. Its velocity is zero: `emitter_local_space.velocity`
	 * adds nothing for an entity, walking or pushed (e06, e11).
	 */
	attachment(locator = this.settings.locator): Attachment {
		return {
			getTransform: () => {
				const f = this.frame(locator);
				return { position: f.position, rotation: f.rotation, velocity: [0, 0, 0] };
			},
			alive: () => this.alive,
			aabb: this.aabb(locator),
			scale: this.frame(locator).scale,
			entity: true,
		};
	}

	/**
	 * Where an unbound effect (bind_to_actor: false) starts: at the entity without a locator, at the world origin
	 * with one (e10, e12). It stays there, with the world's axes rather than the entity's (e13).
	 */
	unboundStart(locator = this.settings.locator): { position: Vec3; rotation: Quat } {
		const has = !!locator && this.locators.some((l) => l.name === locator);
		return { position: has ? [0, 0, 0] : [...this.position], rotation: [0, 0, 0, 1] };
	}
}
