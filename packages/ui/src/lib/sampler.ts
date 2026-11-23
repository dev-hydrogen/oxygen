import { queryExists } from '@oxygen/metadata';
import { ParticleWorld, type EffectDefinition } from 'wintersky';
import type { EffectSession } from '../state/session.svelte';
import { scenarioVariables, writeScenarioGlobals } from './inputs';

export interface Series {
	id: number;
	points: [number, number][];
}

/** The values across every sampled particle at one age: the whole range, the middle 80 % and the median */
export interface Spread {
	x: number;
	min: number;
	lo: number;
	mid: number;
	hi: number;
	max: number;
	/** how many particles had a value at this age */
	n: number;
}

export interface FieldSamples {
	/** what x means */
	axis: 'particle age' | 'emitter age';
	/** the particles drawn as lines: the first is the one nearest the median, the rest as unlike it and each other as they come */
	series: Series[];
	/** evaluations that aborted or produced strings are left out */
	skipped: number;
	/** particles sampled in all (the lines are a few of them) */
	total: number;
	/** the values across all of them by age, when more were sampled than are drawn */
	spread: Spread[] | null;
}

/** A curve as `n` values at even steps through its own span, to compare curves of different lengths */
function shape(points: [number, number][], n = 16): number[] {
	const out: number[] = [];
	for (let k = 0; k < n; k++) out.push(points[Math.min(points.length - 1, Math.round((k / (n - 1)) * (points.length - 1)))][1]);
	return out;
}

/**
 * A few of many curves that show what the rest do: the one nearest the median first, then each time the one
 * farthest from those already picked. Random phases, offsets and speeds all end up covered, which the first few
 * particles to spawn don't promise.
 */
export function representatives(series: Series[], count: number): Series[] {
	if (series.length <= count) return series;
	const shapes = series.map((s) => shape(s.points));
	const n = shapes[0].length;
	const median = Array.from({ length: n }, (_, k) => {
		const col = shapes.map((v) => v[k]).sort((a, b) => a - b);
		return col[Math.floor(col.length / 2)];
	});
	const dist = (a: number[], b: number[]) => a.reduce((sum, v, k) => sum + (v - b[k]) ** 2, 0);
	const picked: number[] = [];
	let first = 0;
	shapes.forEach((v, i) => {
		if (dist(v, median) < dist(shapes[first], median)) first = i;
	});
	picked.push(first);
	const nearest = shapes.map((v) => dist(v, shapes[first]));
	while (picked.length < count) {
		let far = -1;
		nearest.forEach((d, i) => {
			if (!picked.includes(i) && (far < 0 || d > nearest[far])) far = i;
		});
		if (far < 0) break;
		picked.push(far);
		shapes.forEach((v, i) => (nearest[i] = Math.min(nearest[i], dist(v, shapes[far]))));
	}
	return picked.map((i) => series[i]);
}

/** The values of every curve by age, in steps of `dt` */
function spreadOf(series: Series[], dt: number): Spread[] {
	const bins = new Map<number, number[]>();
	for (const s of series) {
		for (const [x, y] of s.points) {
			const k = Math.round(x / dt);
			const list = bins.get(k);
			if (list) list.push(y);
			else bins.set(k, [y]);
		}
	}
	return [...bins]
		.sort((a, b) => a[0] - b[0])
		.map(([k, values]) => {
			values.sort((a, b) => a - b);
			const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
			return { x: k * dt, min: values[0], lo: at(0.1), mid: at(0.5), hi: at(0.9), max: values[values.length - 1], n: values.length };
		});
}

function sandbox(session: EffectSession, seed: number): { world: ParticleWorld; def: EffectDefinition } | null {
	const world = new ParticleWorld({ engine: session.engine, queryExists, seed });
	world.queries = session.world.queries;
	world.cullEmitters = false;
	const def = world.loadEffect(session.doc.value, session.engine);
	if (def.failed) return null;
	world.resolveEffect = () => null;
	world.beforeUpdate = (w) => session.applyPinned(w);
	const sc = session.scenario;
	writeScenarioGlobals(world, sc, session.inputScene(world));
	world.spawn(def, { position: [0, 0, 0], context: session.spawnMode, variables: scenarioVariables(sc, session.inputScene(world)), preEffect: sc?.preEffect ?? null });
	return { world, def };
}

function duration(def: EffectDefinition): number {
	const l = def.particle.maxLifetime?.constant;
	const life = def.emitter.lifetime;
	const active = life && 'activeTime' in life ? life.activeTime.constant : null;
	return Math.min(10, Math.max(1, (l ?? 3) + Math.min(active ?? 0.5, 2)));
}

/**
 * Real values of one field over time: runs a private copy of the effect with a fixed seed and records every
 * evaluation of `path` for the first `pool` particles (or the emitter). `count` of them come back as lines;
 * with a larger pool those are picked to show what the rest do, and the spread across all of them comes too.
 */
export function sampleField(session: EffectSession, path: string, count = 6, seed = 1234, dt = 1 / 30, pool = count): FieldSamples | null {
	const series = new Map<number, Series>();
	let axis: FieldSamples['axis'] = 'particle age';
	let skipped = 0;
	// an effect that spawns few particles in one run is run again with other randoms, until there are enough to
	// show what its particles do (a handful of runs at most: each is a whole simulation)
	const enough = Math.min(pool, 120);
	for (let pass = 0; pass < (pool > count ? 6 : 1); pass++) {
		const box = sandbox(session, seed + pass * 7919);
		if (!box) return null;
		const { world, def } = box;
		world.debug.log = true;
		world.debug.logLimit = 1e9;
		const born = new Map<number, number>();
		/** particles of this run, apart from the runs before */
		const key = (id: number) => pass * 1e7 + id;
		const seconds = duration(def);
		for (let t = 0; t < seconds; t += dt) {
			world.log.length = 0;
			world.step(dt);
			for (const e of world.emitters) for (let i = 0; i < e.pool.count; i++) if (!born.has(e.pool.id[i])) born.set(e.pool.id[i], world.time - e.pool.age[i]);
			for (const l of world.log) {
				if (l.path !== path) continue;
				if (typeof l.result !== 'number' || Number.isNaN(l.result)) {
					skipped++;
					continue;
				}
				if (l.particle < 0) {
					axis = 'emitter age';
					if (pass) continue;
					const s = series.get(-1) ?? { id: -1, points: [] };
					s.points.push([world.time, l.result]);
					series.set(-1, s);
					continue;
				}
				const id = key(l.particle);
				if (!series.has(id)) {
					if (series.size >= pool) continue;
					series.set(id, { id, points: [] });
				}
				series.get(id)!.points.push([world.time - (born.get(l.particle) ?? world.time), l.result]);
			}
		}
		// the emitter's own field is one curve whatever the randoms; and enough particles is enough
		if (series.has(-1) || series.size >= enough || !series.size) break;
	}
	const all = [...series.values()].filter((s) => s.points.length);
	const many = axis === 'particle age' && all.length > count;
	return { axis, series: many ? representatives(all, count) : all.slice(0, count), skipped, total: all.length, spread: many ? spreadOf(all, dt) : null };
}

/** World-space paths of the first `count` particles over their lifetimes (3D trajectory ghosts) */
export function sampleTrajectories(session: EffectSession, count = 8, seed = 4321, dt = 1 / 30): [number, number, number][][] {
	const box = sandbox(session, seed);
	if (!box) return [];
	const { world, def } = box;
	const paths = new Map<number, [number, number, number][]>();
	const p: [number, number, number] = [0, 0, 0];
	const seconds = duration(def);
	for (let t = 0; t < seconds; t += dt) {
		world.step(dt);
		for (const e of world.emitters) {
			for (let i = 0; i < e.pool.count; i++) {
				const id = e.pool.id[i];
				let line = paths.get(id);
				if (!line) {
					if (paths.size >= count) continue;
					paths.set(id, (line = []));
				}
				e.particleWorldPos(i, p);
				line.push([p[0], p[1], p[2]]);
			}
		}
	}
	return [...paths.values()].filter((l) => l.length > 1);
}
