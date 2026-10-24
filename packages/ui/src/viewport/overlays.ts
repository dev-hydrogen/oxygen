import * as THREE from 'three';
import { rotateByQuat, type CameraState, type ParticleWorld, type Quat, type Vec3 } from 'wintersky';

const C = {
	right: new THREE.Color(0xe86f6f),
	up: new THREE.Color(0x8fd16a),
	normal: new THREE.Color(0x6fa8ef),
	direction: new THREE.Color(0xf2c14e),
	held: new THREE.Color(0x6b7389),
	fallback: new THREE.Color(0xec92d6),
	degenerate: new THREE.Color(0xff7470),
	emitter: new THREE.Color(0x3fc4b2),
	emitterDone: new THREE.Color(0x4a5368),
};

/** A batch of colored line segments rebuilt every frame (one draw call) */
class Segments {
	readonly object: THREE.LineSegments;
	private pos: Float32Array;
	private col: Float32Array;
	private n = 0;

	constructor(
		private max: number,
		renderOrder: number,
	) {
		this.pos = new Float32Array(max * 6);
		this.col = new Float32Array(max * 6);
		const g = new THREE.BufferGeometry();
		this.attach(g);
		this.object = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
		this.object.renderOrder = renderOrder;
		this.object.frustumCulled = false;
	}

	private attach(g: THREE.BufferGeometry) {
		g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
		g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
	}

	/** Room for `max` segments (the limits are settings) */
	capacity(max: number) {
		if (max === this.max) return;
		this.max = max;
		this.pos = new Float32Array(max * 6);
		this.col = new Float32Array(max * 6);
		// a buffer's size is fixed once it's on the GPU: a new geometry
		const old = this.object.geometry;
		const g = new THREE.BufferGeometry();
		this.attach(g);
		this.object.geometry = g;
		old.dispose();
	}

	begin() {
		this.n = 0;
	}

	add(a: Vec3, b: Vec3, color: THREE.Color) {
		if (this.n >= this.max) return;
		const k = this.n * 6;
		this.pos[k] = a[0];
		this.pos[k + 1] = a[1];
		this.pos[k + 2] = a[2];
		this.pos[k + 3] = b[0];
		this.pos[k + 4] = b[1];
		this.pos[k + 5] = b[2];
		for (let j = 0; j < 2; j++) {
			this.col[k + j * 3] = color.r;
			this.col[k + j * 3 + 1] = color.g;
			this.col[k + j * 3 + 2] = color.b;
		}
		this.n++;
	}

	/** a line from p along unit vector d */
	ray(p: Vec3, d: Vec3, len: number, color: THREE.Color) {
		this.add(p, [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len], color);
	}

	end() {
		const g = this.object.geometry;
		g.setDrawRange(0, this.n * 2);
		// the lines moved: clicks test them against a fresh bound
		g.boundingSphere = null;
		(g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
		(g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
		this.object.visible = this.n > 0;
	}
}

const PER_PARTICLE = 12;

type Pool = { count: number; id: ArrayLike<number> };
type Owner = { id: number; pool: Pool };

/**
 * Which particles get a helper when there are more than it may draw: the same ones from frame to frame (a
 * particle keeps its helper while it lives), topped up with an even sample of the rest as they die.
 */
export class StablePick {
	private kept = new Set<number>();

	pick<E extends Owner>(emitters: readonly E[], limit: number, eligible: (e: E) => boolean = () => true, first: { emitter: number; particle: number } | null = null): [E, number][] {
		const out: [E, number][] = [];
		const next = new Set<number>();
		let total = 0;
		for (const e of emitters) if (eligible(e)) total += e.pool.count;
		if (first)
			for (const e of emitters) {
				if (e.id !== first.emitter || !eligible(e)) continue;
				for (let i = 0; i < e.pool.count; i++)
					if (e.pool.id[i] === first.particle) {
						out.push([e, i]);
						next.add(first.particle);
					}
			}
		for (const e of emitters) {
			if (!eligible(e)) continue;
			for (let i = 0; i < e.pool.count && out.length < limit; i++) {
				const id = e.pool.id[i];
				if (this.kept.has(id) && !next.has(id)) {
					out.push([e, i]);
					next.add(id);
				}
			}
		}
		const room = limit - out.length;
		if (room > 0) {
			const stride = Math.max(1, Math.ceil((total - out.length) / room));
			let k = 0;
			for (const e of emitters) {
				if (!eligible(e)) continue;
				for (let i = 0; i < e.pool.count && out.length < limit; i++) {
					const id = e.pool.id[i];
					if (next.has(id) || k++ % stride) continue;
					out.push([e, i]);
					next.add(id);
				}
			}
		}
		this.kept = next;
		return out;
	}
}

/**
 * Facing gizmo: for the inspected particle and a sample of others, the axes the renderer actually
 * builds (right red, up green, face normal blue) and the direction they were built from (amber; grey
 * while a velocity-driven facing is held below its speed threshold). A pink square marks the pole
 * fallback (|d.y| > 0.9999, fixed axes); a red cross marks a zero direction (nothing drawn).
 */
export class FacingOverlay {
	private seg = new Segments(64 * PER_PARTICLE, 16);
	private picker = new StablePick();
	readonly object = this.seg.object;

	update(world: ParticleWorld, camera: CameraState, selection: { emitter: number; particle: number } | null, limit = 64) {
		const seg = this.seg;
		seg.capacity(limit * PER_PARTICLE);
		seg.begin();
		const picks = this.picker.pick(world.emitters, limit, (e) => !!e.def.particle.billboard, selection);
		for (const [e, i] of picks) {
			const f = e.particleFacing(i, camera);
			if (!f) continue;
			const p = f.position;
			const dist = Math.hypot(camera.position[0] - p[0], camera.position[1] - p[1], camera.position[2] - p[2]);
			const size = Math.max(Math.abs(e.pool.size[i * 2]), Math.abs(e.pool.size[i * 2 + 1]));
			const len = Math.max(size * 1.4, dist * 0.035);
			if (f.degenerate) {
				const r = camera.right;
				const u = camera.up;
				const k = len * 0.4;
				seg.add([p[0] - (r[0] + u[0]) * k, p[1] - (r[1] + u[1]) * k, p[2] - (r[2] + u[2]) * k], [p[0] + (r[0] + u[0]) * k, p[1] + (r[1] + u[1]) * k, p[2] + (r[2] + u[2]) * k], C.degenerate);
				seg.add([p[0] - (r[0] - u[0]) * k, p[1] - (r[1] - u[1]) * k, p[2] - (r[2] - u[2]) * k], [p[0] + (r[0] - u[0]) * k, p[1] + (r[1] - u[1]) * k, p[2] + (r[2] - u[2]) * k], C.degenerate);
				continue;
			}
			// the direction first: axes that follow it (X in direction_x) draw over it, and it shows past them
			if (f.direction) seg.ray(p, f.direction, len * 1.7, f.velocity?.held ? C.held : C.direction);
			seg.ray(p, f.rotatedRight, len, C.right);
			seg.ray(p, f.rotatedUp, len, C.up);
			seg.ray(p, f.normal, len * 0.8, C.normal);
			if (f.usedFallback) {
				// a horizontal square: the direction is (anti)parallel to world up
				const k = len * 0.55;
				const c: Vec3[] = [
					[p[0] - k, p[1], p[2] - k],
					[p[0] + k, p[1], p[2] - k],
					[p[0] + k, p[1], p[2] + k],
					[p[0] - k, p[1], p[2] + k],
				];
				for (let j = 0; j < 4; j++) seg.add(c[j], c[(j + 1) % 4], C.fallback);
			}
		}
		seg.end();
	}

	hide() {
		this.seg.begin();
		this.seg.end();
	}
}

/**
 * Where every emitter is, children included: a small axis cross along the emitter's own rotation
 * (teal while active, grey once it has stopped spawning), sized to stay readable at any distance.
 */
export class EmitterMarkers {
	private seg = new Segments(256 * 3, 12);
	readonly object = this.seg.object;

	update(emitters: Iterable<{ id: number; position: Vec3; rotation: Quat; expired: boolean }>, camera: CameraState, skip: number | null, limit = 256) {
		const seg = this.seg;
		seg.capacity(limit * 3);
		seg.begin();
		const axis: Vec3 = [0, 0, 0];
		for (const e of emitters) {
			if (e.id === skip) continue;
			const p = e.position;
			const dist = Math.hypot(camera.position[0] - p[0], camera.position[1] - p[1], camera.position[2] - p[2]);
			const len = dist * 0.025;
			const color = e.expired ? C.emitterDone : C.emitter;
			for (const [x, y, z] of [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1],
			]) {
				rotateByQuat(axis, x, y, z, e.rotation);
				seg.add([p[0] - axis[0] * len, p[1] - axis[1] * len, p[2] - axis[2] * len], [p[0] + axis[0] * len, p[1] + axis[1] * len, p[2] + axis[2] * len], color);
			}
		}
		seg.end();
	}
}

const SHAPE = new THREE.Color(0x93bdf5);
const VELOCITY = new THREE.Color(0x3fc4b2);

type ShapeOwner = { def: import('wintersky').EffectDefinition; position: Vec3; rotation: Quat; spawnOptions?: { attachment?: { aabb?: { min: Vec3; max: Vec3 } } | null } };

/** A constant number from a Molang field, or null when it depends on the moment */
const constant = (f: { constant: number | null } | null | undefined, fallback: number): number | null => (f ? f.constant : fallback);
const constVec = (v: [{ constant: number | null }, { constant: number | null }, { constant: number | null }] | null, fallback: Vec3): Vec3 | null => {
	if (!v) return fallback;
	const out = v.map((f) => f.constant);
	return out.every((n) => n !== null) ? (out as Vec3) : null;
};

/**
 * Emitter shapes: where particles spawn (sphere, box, disc, the entity's box). Sizes that are Molang
 * depend on the moment, so only constant ones are drawn; the offset point is always marked.
 */
export class ShapeGizmo {
	private seg = new Segments(64 * 80, 11);
	readonly object = this.seg.object;

	update(emitters: Iterable<ShapeOwner>, camera: CameraState, limit = 64) {
		const seg = this.seg;
		seg.capacity(limit * 80);
		seg.begin();
		let n = 0;
		for (const e of emitters) {
			if (n++ >= limit) break;
			const shape = e.def.emitter.shape;
			if (!shape) continue;
			const offset = constVec(shape.offset as never, [0, 0, 0]) ?? [0, 0, 0];
			// emitter space → world: rotate by the emitter, then move to it
			const tmp: Vec3 = [0, 0, 0];
			const world = (x: number, y: number, z: number): Vec3 => {
				rotateByQuat(tmp, x + offset[0], y + offset[1], z + offset[2], e.rotation);
				return [tmp[0] + e.position[0], tmp[1] + e.position[1], tmp[2] + e.position[2]];
			};
			const ring = (r: number, ax: Vec3, ay: Vec3) => {
				let prev: Vec3 | null = null;
				for (let k = 0; k <= 32; k++) {
					const a = (k / 32) * Math.PI * 2;
					const c = Math.cos(a) * r, s = Math.sin(a) * r;
					const p = world(ax[0] * c + ay[0] * s, ax[1] * c + ay[1] * s, ax[2] * c + ay[2] * s);
					if (prev) seg.add(prev, p, SHAPE);
					prev = p;
				}
			};
			const box = (min: Vec3, max: Vec3) => {
				const c = (i: number): Vec3 => world(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
				for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) seg.add(c(a), c(b), SHAPE);
			};
			// the offset point: a small cross, sized to the view
			const o = world(0, 0, 0);
			const k = Math.hypot(camera.position[0] - o[0], camera.position[1] - o[1], camera.position[2] - o[2]) * 0.01;
			seg.add([o[0] - k, o[1], o[2]], [o[0] + k, o[1], o[2]], SHAPE);
			seg.add([o[0], o[1], o[2] - k], [o[0], o[1], o[2] + k], SHAPE);
			switch (shape.type) {
				case 'sphere': {
					const r = constant(shape.radius, 1);
					if (r === null) break;
					ring(r, [1, 0, 0], [0, 1, 0]);
					ring(r, [1, 0, 0], [0, 0, 1]);
					ring(r, [0, 1, 0], [0, 0, 1]);
					break;
				}
				case 'box': {
					const h = constVec(shape.halfDimensions as never, [0, 0, 0]);
					if (h) box([-h[0], -h[1], -h[2]], h);
					break;
				}
				case 'disc': {
					const r = constant(shape.radius, 1);
					const nrm = constVec(shape.planeNormal as never, [0, 1, 0]);
					if (r === null || !nrm) break;
					const l = Math.hypot(...nrm) || 1;
					const nx = nrm[0] / l, ny = nrm[1] / l, nz = nrm[2] / l;
					// same basis as the engine's disc sampling
					let u: Vec3 = Math.abs(ny) < 0.999 ? [-nz, 0, nx] : [1, 0, 0];
					const ul = Math.hypot(...u) || 1;
					u = [u[0] / ul, u[1] / ul, u[2] / ul];
					const v: Vec3 = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
					ring(r, u, v);
					break;
				}
				case 'entity_aabb': {
					const b = e.spawnOptions?.attachment?.aabb ?? { min: [-0.3, 0, -0.3] as Vec3, max: [0.3, 1.8, 0.3] as Vec3 };
					box(b.min, b.max);
					break;
				}
			}
		}
		seg.end();
	}

	hide() {
		this.seg.begin();
		this.seg.end();
	}
}

/** Each sampled particle's velocity as a line covering where it goes in the next 0.25 s */
export class VelocityOverlay {
	private seg = new Segments(256, 15);
	private picker = new StablePick();
	readonly object = this.seg.object;

	update(world: ParticleWorld, limit = 256) {
		const seg = this.seg;
		seg.capacity(limit);
		seg.begin();
		const p: Vec3 = [0, 0, 0];
		const v: Vec3 = [0, 0, 0];
		for (const [e, i] of this.picker.pick(world.emitters, limit)) {
			const pool = e.pool;
			e.particleWorldPos(i, p);
			const vx = pool.vel[i * 3], vy = pool.vel[i * 3 + 1], vz = pool.vel[i * 3 + 2];
			if (pool.local[i] && e.def.emitter.localSpace.rotation) rotateByQuat(v, vx, vy, vz, e.rotation);
			else v.splice(0, 3, vx, vy, vz);
			const end: Vec3 = [p[0] + v[0] * 0.25, p[1] + v[1] * 0.25, p[2] + v[2] * 0.25];
			seg.add(p, end, VELOCITY);
		}
		seg.end();
	}

	hide() {
		this.seg.begin();
		this.seg.end();
	}
}
