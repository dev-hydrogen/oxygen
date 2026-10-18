// The debugging side of the preview page: questions about the running effect, answered by the editor's own session
// replayed from the spawn on the fixed clock. A `time` names one frame exactly: the frame that reaches it.
import { readMeta } from '@oxygen/format';
import type { EffectSession, ViewportScene } from '@oxygen/ui';
import type { EffectDefinition, EmitterInstance, Vec3 } from 'wintersky';
import { compileIn, evaluateInEmitter, runIsolated, watchField } from '../src/debug/evaluate';
import { encodeGif, type Rgba } from '../src/debug/gif';
import { emitterRecord, facingRecord, logRecord, PARTICLE_FIELDS, particleRecord, r, rv, traceRecord, val, type ParticleField } from '../src/debug/records';
import type { InspectQuery, InspectRequest, InspectResult } from '../src/protocol';
import { closeScene, DT, framing, openScene, openSession, restartClean, round3, settle } from './session';

/** The fixed clock: frames of DT from the spawn */
class Clock {
	frame = 0;
	constructor(
		private session: EffectSession,
		private scene: ViewportScene,
	) {}
	get time(): number {
		return this.frame * DT;
	}
	restart(): void {
		this.frame = 0;
		restartClean(this.session);
		this.session.playing = true;
	}
	/** one frame; false once everything has ended (Repeat off: the clock stops there, as in the editor) */
	step(): boolean {
		if (this.session.finished) return false;
		this.frame++;
		this.scene.frame(DT, false);
		return true;
	}
	run(frames: number): void {
		for (let k = 0; k < frames && this.step(); k++);
	}
}

/** The frame that reaches `time` (at least the first) */
const frameAt = (time: number) => Math.max(1, Math.round(time / DT));

/** The effect's own emitter (workers are off in the preview, so it's always in this world) */
function rootOf(session: EffectSession): EmitterInstance | null {
	const id = session.rootEmitter?.id;
	return id === undefined ? null : (session.world.emitters.find((e) => e.id === id) ?? null);
}

function findParticle(session: EffectSession, id: number): { e: EmitterInstance; i: number } | null {
	for (const e of session.world.emitters) {
		const i = e.pool.indexOfId(id);
		if (i >= 0) return { e, i };
	}
	return null;
}

/** Every definition in play: the effect, what its events spawn, and what's running */
function definitions(session: EffectSession): EffectDefinition[] {
	const out = new Set<EffectDefinition>([session.def]);
	const queue = session.childIds();
	const seen = new Set<string>();
	while (queue.length) {
		const id = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		const d = session.childDefinition(id);
		if (!d) continue;
		out.add(d);
		for (const n of d.events.values()) {
			const walk = (x: typeof n) => {
				if (x.particleEffect?.effect) queue.push(x.particleEffect.effect);
				x.sequence?.forEach(walk);
				x.randomize?.forEach((o) => walk(o.node));
			};
			walk(n);
		}
	}
	for (const e of session.world.emitters) out.add(e.def);
	return [...out];
}

function brief(session: EffectSession, clock: Clock): Record<string, unknown> {
	return { time: round3(clock.time), frame: clock.frame, liveParticles: session.world.particleCount, liveEmitters: session.world.emitters.length, ...(session.finished ? { finished: true } : {}) };
}

export async function inspect(req: InspectRequest): Promise<InspectResult> {
	const opened = await openSession(req);
	const { session } = opened;
	session.queries.recording = true;
	const q = req.query;
	const { scene, canvas } = openScene(opened, q.op === 'gif' ? q.width : 480, q.op === 'gif' ? q.height : 270);
	if (req.camera) scene.setView({ position: req.camera.position, target: req.camera.target, fov: req.camera.fov ?? 70 });
	const clock = new Clock(session, scene);
	try {
		if (q.op === 'gif') return await gif(session, scene, canvas, clock, q, [...opened.missing]);
		const data = answer(session, clock, q);
		return { data, missingTextures: [...opened.missing] };
	} finally {
		closeScene(scene, canvas);
		opened.close();
	}
}

function answer(session: EffectSession, clock: Clock, q: Exclude<InspectQuery, { op: 'gif' }>): Record<string, unknown> {
	const w = session.world;
	switch (q.op) {
		case 'state': {
			clock.restart();
			clock.run(Math.round(q.time / DT));
			const pq = q.particles;
			const ids = pq.ids ? new Set(pq.ids) : null;
			const list: { e: EmitterInstance; i: number }[] = [];
			for (const e of w.emitters) {
				if (pq.emitter !== null && e.id !== pq.emitter) continue;
				if (pq.effect && e.def.identifier !== pq.effect) continue;
				for (let i = 0; i < e.pool.count; i++) if (!ids || ids.has(e.pool.id[i])) list.push({ e, i });
			}
			const p: Vec3 = [0, 0, 0];
			const cam = w.camera.position;
			const key = ({ e, i }: { e: EmitterInstance; i: number }): number => {
				switch (pq.sort) {
					case 'age':
						return e.pool.age[i];
					case 'speed':
						return Math.hypot(e.pool.vel[i * 3], e.pool.vel[i * 3 + 1], e.pool.vel[i * 3 + 2]);
					case 'distance':
						e.particleWorldPos(i, p);
						return Math.hypot(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]);
					case 'x':
					case 'y':
					case 'z':
						return e.particleWorldPos(i, p)['xyz'.indexOf(pq.sort)];
					default:
						return e.pool.id[i];
				}
			};
			list.sort((a, b) => key(a) - key(b));
			if (pq.descending) list.reverse();
			const fields = new Set((pq.fields ?? PARTICLE_FIELDS) as ParticleField[]);
			const root = session.rootEmitter?.id ?? null;
			return {
				...brief(session, clock),
				matching: list.length,
				...(list.length ? { stats: stats(list) } : {}),
				particles: list.slice(pq.offset, pq.offset + pq.limit).map(({ e, i }) => {
					const rec = particleRecord(e, i, fields);
					if (pq.facing) rec.facing = facingRecord(w, e, i);
					return rec;
				}),
				...(pq.offset + pq.limit < list.length ? { more: list.length - pq.offset - pq.limit } : {}),
				emitters: w.emitters.map((e) => ({ ...(e.id === root ? { root: true } : {}), ...emitterRecord(w, e, q.variables) })),
				queries: Object.fromEntries([...session.queries.last].map(([k, v]) => [k, v === undefined ? 'no value here (reads 0, reported as unknown-query)' : val(v)])),
				temps: Object.fromEntries(w.temps.entries(w.symbols.tempNames).map(([k, v]) => [k, val(v)])),
			};
		}

		case 'trace': {
			const n = frameAt(q.time);
			let particle: number | null = null;
			let emitter = q.emitter;
			if (q.particle !== null) {
				// find the particle (and who makes it) in a first replay; the second traces it from its first evaluation
				clock.restart();
				clock.run(n - 1);
				particle = q.particle === 'next' ? w.nextParticleId : q.particle;
				const target = particle;
				if (emitter === null) {
					let found = findParticle(session, target);
					for (let f = 0; f < q.frames && !found && clock.step(); f++) found = findParticle(session, target);
					emitter = found?.e.id ?? null;
				}
				if (emitter === null)
					return {
						error:
							q.particle === 'next'
								? `No particle is spawned in the traced frame${q.frames > 1 ? 's' : ''} at ${round3(clock.time)} s (the next one would be particle ${target}). Pick a time when particles spawn (a burst spawns in the first frame: time 0), or trace more frames.`
								: `Particle ${target} doesn't exist in the traced frames (${target < w.nextParticleId ? 'it ended before them' : 'it isn’t spawned by then'}).`,
					};
			}
			clock.restart();
			clock.run(n - 1);
			emitter ??= session.rootEmitter?.id ?? null;
			if (emitter === null) return { error: 'Nothing to trace: no emitter is running at that time.' };
			const frames: Record<string, unknown>[] = [];
			w.debug.select = { emitter, particle };
			try {
				for (let f = 0; f < q.frames && clock.step(); f++) {
					let recs = w.traces;
					if (q.path) recs = recs.filter((t) => t.path.includes(q.path!));
					if (q.phase) recs = recs.filter((t) => t.phase === q.phase);
					const frame: Record<string, unknown> = { frame: clock.frame, time: round3(clock.time), evaluations: recs.length };
					frame.records = recs.slice(0, q.limit).map((t) => traceRecord(w, t, q.detail, session.def));
					if (recs.length > q.limit) frame.more = recs.length - q.limit;
					if (particle !== null) {
						const p = findParticle(session, particle);
						frame.particleAfter = p ? particleRecord(p.e, p.i) : particle < w.nextParticleId ? 'ended this frame' : 'not spawned yet';
					}
					frames.push(frame);
				}
			} finally {
				w.debug.select = null;
			}
			const none = frames.every((f) => !f.evaluations);
			return {
				selection: { emitter, particle },
				frames,
				...(none ? { note: 'Nothing was evaluated for this selection. Constant fields are never evaluated (their value is their text), and a particle has nothing to trace before it spawns.' } : {}),
			};
		}

		case 'log': {
			clock.restart();
			clock.run(frameAt(q.time) - 1);
			const entries: Record<string, unknown>[] = [];
			let total = 0;
			w.debug.log = true;
			w.debug.logLimit = 1_000_000;
			try {
				for (let f = 0; f < q.frames; f++) {
					w.log.length = 0;
					if (!clock.step()) break;
					for (const l of w.log) {
						if (q.path && !l.path.includes(q.path)) continue;
						if (q.phase && l.phase !== q.phase) continue;
						if (q.emitter !== null && l.emitter !== q.emitter) continue;
						if (q.particle !== null && l.particle !== q.particle) continue;
						total++;
						if (total > q.offset && entries.length < q.limit) entries.push({ frame: clock.frame, ...logRecord(w, l, session.def) });
					}
				}
			} finally {
				w.debug.log = false;
				w.log.length = 0;
			}
			return {
				...brief(session, clock),
				evaluations: total,
				entries,
				...(q.offset + entries.length < total ? { more: total - q.offset - entries.length } : {}),
				...(!total ? { note: 'Nothing was evaluated. Constant fields are never evaluated (their value is their text).' } : {}),
			};
		}

		case 'evaluate': {
			clock.restart();
			clock.run(Math.round(q.time / DT));
			let e: EmitterInstance | null = q.emitter !== null ? (w.emitters.find((x) => x.id === q.emitter) ?? null) : null;
			let index = -1;
			if (q.particle !== null) {
				const p = findParticle(session, q.particle);
				if (!p) return { ...brief(session, clock), error: `Particle ${q.particle} isn't alive at that time.` };
				e = p.e;
				index = p.i;
			}
			e ??= rootOf(session) ?? w.emitters[0] ?? null;
			if (!e) return { ...brief(session, clock), error: 'No emitter is running at that time.' };
			const { expr, diagnostics } = compileIn(w, q.expression, session.engine);
			const diags = diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message, text: q.expression.slice(d.start, d.end) }));
			if (!expr.ok) return { loads: false, diagnostics: diags };
			return { ...brief(session, clock), in: { emitter: e.id, particle: q.particle }, ...evaluateInEmitter(w, e, index, expr), diagnostics: diags };
		}

		case 'moments': {
			clock.restart();
			clock.run(frameAt(q.time) - 1);
			const { expr, diagnostics } = compileIn(w, q.expression, session.engine);
			const diags = diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message, text: q.expression.slice(d.start, d.end) }));
			if (!expr.ok) return { loads: false, diagnostics: diags };
			const hits: Record<string, unknown>[] = [];
			let total = 0;
			const watch = watchField(w, definitions(session), q.path, q.when, (m) => {
				if (q.effect && m.emitter.def.identifier !== q.effect) return;
				if (q.emitter !== null && m.emitter.id !== q.emitter) return;
				const pid = m.index >= 0 ? m.emitter.pool.id[m.index] : null;
				if (q.particle !== null && pid !== q.particle) return;
				total++;
				if (hits.length >= q.limit) return;
				const phase = w.current.phase;
				const res = runIsolated(w, m.emitter, expr, m.env);
				const hit: Record<string, unknown> = { emitter: m.emitter.id, particle: pid, phase, value: res.value };
				if (res.aborted) hit.aborted = true;
				if (res.errors.length) hit.errors = res.errors;
				if (q.parts) {
					hit.parts = res.parts;
					if (Object.keys(res.changed).length) hit.changed = res.changed;
				}
				hits.push(hit);
			});
			if (!watch.fields) return { error: `No effect in play has a field at ${q.path}. Paths are listed by describe/read_effect (e.g. particle_effect/components/minecraft:particle_appearance_billboard/size/0).` };
			try {
				clock.step();
			} finally {
				watch.restore();
			}
			return {
				...brief(session, clock),
				moment: `${q.when} ${q.path}`,
				evaluations: total,
				...(diags.length ? { diagnostics: diags } : {}),
				results: hits,
				...(total > hits.length ? { more: total - hits.length } : {}),
				...(!total ? { note: 'The field wasn’t evaluated in that frame for this selection. Try another time, or a field of the same phase that does run.' } : {}),
			};
		}

		case 'track':
			return track(session, clock, q);
	}
}

function stats(list: { e: EmitterInstance; i: number }[]): Record<string, unknown> {
	const acc = new Map<string, { min: number; max: number; sum: number; n: number }>();
	const add = (k: string, v: number) => {
		const a = acc.get(k) ?? { min: Infinity, max: -Infinity, sum: 0, n: 0 };
		a.min = Math.min(a.min, v);
		a.max = Math.max(a.max, v);
		a.sum += v;
		a.n++;
		acc.set(k, a);
	};
	const p: Vec3 = [0, 0, 0];
	let visible = 0;
	const byEmitter: Record<string, number> = {};
	for (const { e, i } of list) {
		const pool = e.pool;
		e.particleWorldPos(i, p);
		add('x', p[0]);
		add('y', p[1]);
		add('z', p[2]);
		add('speed', Math.hypot(pool.vel[i * 3], pool.vel[i * 3 + 1], pool.vel[i * 3 + 2]));
		add('age', pool.age[i]);
		if (pool.hasLifetime[i]) add('lifetime', pool.lifetime[i]);
		if (e.def.particle.billboard) {
			add('width', pool.size[i * 2]);
			add('height', pool.size[i * 2 + 1]);
			for (let k = 0; k < 4; k++) add('rgba'[k], pool.color[i * 4 + k]);
		}
		if (pool.visible[i]) visible++;
		byEmitter[e.id] = (byEmitter[e.id] ?? 0) + 1;
	}
	return { visible, byEmitter, ...Object.fromEntries([...acc].map(([k, a]) => [k, { min: r(a.min), max: r(a.max), mean: r(a.sum / a.n) }])) };
}

function track(session: EffectSession, clock: Clock, q: Extract<InspectQuery, { op: 'track' }>): Record<string, unknown> {
	const w = session.world;
	const first = Math.round(q.from / DT);
	const last = Math.round(q.to / DT);
	const every = q.every || Math.max(1, Math.ceil((last - first) / 300));
	clock.restart();
	clock.run(first);
	const out: Record<string, unknown> = { from: round3(clock.time), every: `${every} frame${every === 1 ? '' : 's'}` };
	const due = () => (clock.frame - first) % every === 0;

	if (q.path) {
		// a field's value at each of its evaluations, per particle (or per emitter for emitter fields)
		w.debug.log = true;
		w.debug.logLimit = 1_000_000;
		const born = new Map<number, number>();
		const series = new Map<number, (number | string)[][]>();
		let emitterField = false;
		try {
			while (clock.frame < last) {
				w.log.length = 0;
				if (!clock.step()) break;
				for (const e of w.emitters) for (let i = 0; i < e.pool.count; i++) if (!born.has(e.pool.id[i])) born.set(e.pool.id[i], clock.time - e.pool.age[i]);
				if (!due()) continue;
				const seen = new Set<number>();
				for (const l of w.log) {
					if (l.path !== q.path || typeof l.result !== 'number') continue;
					if (q.emitter !== null && l.emitter !== q.emitter) continue;
					const key = l.particle < 0 ? -l.emitter : l.particle;
					if (seen.has(key)) continue;
					if (!series.has(key)) {
						if (q.particles ? !q.particles.includes(l.particle) : series.size >= q.count) continue;
						series.set(key, []);
					}
					seen.add(key);
					if (l.particle < 0) emitterField = true;
					const age = l.particle < 0 ? clock.time : clock.time - (born.get(l.particle) ?? clock.time);
					series.get(key)!.push([round3(clock.time), r(age), r(l.result)]);
				}
			}
		} finally {
			w.debug.log = false;
			w.log.length = 0;
		}
		out.path = q.path;
		out.columns = ['time', emitterField ? 'emitter time' : 'particle age', 'value'];
		out.series = [...series].map(([k, rows]) => (k < 0 ? { emitter: -k, rows } : { particle: k, rows }));
		if (!series.size) out.note = 'The field was never evaluated in this window (constant fields never are: their value is their text).';
		return out;
	}

	if (q.variables?.length) {
		const names = q.variables.map((v) => {
			const lower = v.toLowerCase();
			return lower.startsWith('v.') ? `variable.${lower.slice(2)}` : lower.startsWith('variable.') ? lower : `variable.${lower}`;
		});
		const rows: (number | string | null)[][] = [];
		const push = () => {
			const e = q.emitter !== null ? w.emitters.find((x) => x.id === q.emitter) : rootOf(session);
			rows.push([round3(clock.time), ...names.map((n) => (e ? val(e.vars[w.symbols.variable(n)]) : null))]);
		};
		push();
		while (clock.frame < last && clock.step()) if (due()) push();
		out.columns = ['time', ...names];
		out.rows = rows;
		out.note = 'Values as each frame left them. Variables are shared by an emitter and all its particles, so per-particle values show the last writer; evaluate_molang with `at` shows what each particle saw.';
		return out;
	}

	const attrs = q.attributes.length ? q.attributes : ['position'];
	const columns = ['time', 'age'];
	for (const at of attrs) {
		if (at === 'position' || at === 'velocity' || at === 'facing') columns.push(`${at}.x`, `${at}.y`, `${at}.z`);
		else if (at === 'size') columns.push('width', 'height');
		else if (at === 'color') columns.push('r', 'g', 'b', 'a');
		else if (at === 'uv') columns.push('u0', 'v0', 'u1', 'v1');
		else if (at === 'rotation') columns.push('rotation', 'rotationRate');
		else if (at !== 'age') columns.push(at);
	}
	const want = q.particles ? new Set(q.particles) : null;
	const series = new Map<number, { emitter: number; born: number; rows: (number | string)[][]; endedBy?: number }>();
	const p: Vec3 = [0, 0, 0];
	const sample = (record: boolean) => {
		const alive = new Set<number>();
		for (const e of w.emitters) {
			if (q.emitter !== null && e.id !== q.emitter) continue;
			const pool = e.pool;
			for (let i = 0; i < pool.count; i++) {
				const id = pool.id[i];
				if (want && !want.has(id)) continue;
				let s = series.get(id);
				if (!s) {
					if (!want && series.size >= q.count) continue;
					series.set(id, (s = { emitter: e.id, born: round3(clock.time - pool.age[i]), rows: [] }));
				}
				alive.add(id);
				if (!record) continue;
				const row: (number | string)[] = [round3(clock.time), r(pool.age[i])];
				for (const at of attrs) {
					if (at === 'position') row.push(...rv(e.particleWorldPos(i, p)));
					else if (at === 'velocity') row.push(...rv(pool.vel.subarray(i * 3, i * 3 + 3)));
					else if (at === 'facing') row.push(...rv(pool.facing.subarray(i * 3, i * 3 + 3)));
					else if (at === 'speed') row.push(r(Math.hypot(pool.vel[i * 3], pool.vel[i * 3 + 1], pool.vel[i * 3 + 2])));
					else if (at === 'size') row.push(...rv(pool.size.subarray(i * 2, i * 2 + 2)));
					else if (at === 'color') row.push(...Array.from(pool.color.subarray(i * 4, i * 4 + 4)));
					else if (at === 'uv') row.push(...rv(pool.uv.subarray(i * 4, i * 4 + 4)));
					else if (at === 'rotation') row.push(r(pool.rot[i]), r(pool.rotRate[i]));
					else if (at === 'visible') row.push(pool.visible[i]);
				}
				s.rows.push(row);
			}
		}
		for (const [id, s] of series) if (s.endedBy === undefined && !alive.has(id)) s.endedBy = round3(clock.time);
	};
	sample(true);
	while (clock.frame < last && clock.step()) {
		sample(due());
		if (want && [...want].every((id) => series.get(id)?.endedBy !== undefined)) break;
	}
	out.columns = columns;
	out.series = [...series].map(([id, s]) => ({ particle: id, emitter: s.emitter, born: s.born, ...(s.endedBy !== undefined ? { endedBy: s.endedBy } : {}), rows: s.rows }));
	if (want) {
		const missing = [...want].filter((id) => !series.has(id));
		if (missing.length) out.notFound = missing;
	}
	return out;
}

/** Encode bytes as base64 without blowing the call stack */
function base64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

async function gif(session: EffectSession, scene: ViewportScene, canvas: HTMLCanvasElement, clock: Clock, q: Extract<InspectQuery, { op: 'gif' }>, missing: string[]): Promise<InspectResult> {
	const captures: number[] = [];
	for (let t = q.from; t <= q.to + 1e-9 && captures.length < 240; t += 1 / q.fps) captures.push(Math.round(t / DT));
	// where the camera looks: framed around everything the animation shows (one replay to find it), saved, or given
	let view: { position: Vec3; target: Vec3; fov?: number };
	const cam = q.camera;
	if (cam.kind === 'manual') view = cam;
	else if (cam.kind === 'bookmark') {
		const saved = readMeta(session.doc).cameras ?? [];
		const b = saved.find((c) => c.name === cam.name);
		if (!b) throw new Error(`No camera bookmark named "${cam.name}" in the file (saved: ${saved.map((c) => c.name).join(', ') || 'none'})`);
		view = b;
	} else {
		const lo: Vec3 = [Infinity, Infinity, Infinity];
		const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
		const p: Vec3 = [0, 0, 0];
		clock.restart();
		for (const f of captures) {
			clock.run(f - clock.frame);
			for (const e of session.world.emitters)
				for (let i = 0; i < e.pool.count; i++) {
					if (!e.pool.visible[i]) continue;
					e.particleWorldPos(i, p);
					for (let k = 0; k < 3; k++) {
						lo[k] = Math.min(lo[k], p[k]);
						hi[k] = Math.max(hi[k], p[k]);
					}
				}
		}
		view = framing(lo, hi, cam.angle, cam.zoom);
	}
	scene.setView({ position: view.position, target: view.target, fov: view.fov ?? 70 });
	scene.renderMode = q.mode;
	// an animation adapts like the game: from the settled scene, over the time between frames
	scene.vvExposure = 'adapt';
	scene.gizmos = { ...scene.gizmos, ground: q.ground, block: q.ground, emitter: q.gizmos, children: q.gizmos, killPlane: q.gizmos };
	session.showShape = q.gizmos;

	const w = canvas.width;
	const h = canvas.height;
	const grab = document.createElement('canvas');
	grab.width = w;
	grab.height = h;
	const g = grab.getContext('2d', { willReadFrequently: true })!;
	const frames: Rgba[] = [];
	const times: number[] = [];
	clock.restart();
	scene.resetExposure();
	for (const f of captures) {
		clock.run(f - clock.frame);
		session.playing = false;
		await settle(scene);
		scene.frame(0);
		// read the picture in the same task as the draw (the drawing buffer isn't kept)
		g.drawImage(canvas, 0, 0, w, h);
		if (q.captions) {
			const label = `${clock.time.toFixed(2)} s · ${session.world.particleCount} particles`;
			g.font = '600 13px system-ui, sans-serif';
			g.fillStyle = 'rgba(0, 0, 0, 0.55)';
			g.fillRect(6, 6, g.measureText(label).width + 12, 20);
			g.fillStyle = '#fff';
			g.fillText(label, 12, 21);
		}
		frames.push(g.getImageData(0, 0, w, h));
		times.push(clock.time);
		session.playing = !session.finished;
	}
	const delays = times.map((t, i) => (i + 1 < times.length ? times[i + 1] - t : 1 / q.fps));
	const bytes = encodeGif(frames, delays);

	// a few of the frames on one sheet, for the agent to look at
	const picks = Math.min(q.previews, frames.length);
	const images: string[] = [];
	if (picks) {
		const cols = Math.ceil(Math.sqrt(picks));
		const rows = Math.ceil(picks / cols);
		const sheet = document.createElement('canvas');
		sheet.width = cols * w;
		sheet.height = rows * h;
		const s = sheet.getContext('2d')!;
		for (let k = 0; k < picks; k++) {
			const idx = picks === 1 ? 0 : Math.round((k * (frames.length - 1)) / (picks - 1));
			s.putImageData(frames[idx] as ImageData, (k % cols) * w, Math.floor(k / cols) * h);
		}
		images.push(sheet.toDataURL('image/png'));
	}
	return {
		data: {
			frames: frames.length,
			fps: q.fps,
			from: round3(times[0] ?? q.from),
			to: round3(times[times.length - 1] ?? q.to),
			size: [w, h],
			bytes: bytes.length,
			camera: { position: view.position.map(round3), target: view.target.map(round3), fov: view.fov ?? 70 },
			...(session.finished ? { finishedAt: round3(clock.time) } : {}),
		},
		gif: base64(bytes),
		images,
		missingTextures: missing,
	};
}
