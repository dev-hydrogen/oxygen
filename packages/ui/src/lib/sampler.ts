import { queryExists } from '@oxygen/metadata';
import { ParticleWorld, type EffectDefinition } from 'wintersky';
import type { EffectSession } from '../state/session.svelte';
import { scenarioVariables, writeScenarioGlobals } from './inputs';

export interface Series {
	id: number;
	points: [number, number][];
}

export interface FieldSamples {
	/** what x means */
	axis: 'particle age' | 'emitter age';
	series: Series[];
	/** evaluations that aborted or produced strings are left out */
	skipped: number;
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
 * evaluation of `path` for the first `count` particles (or the emitter).
 */
export function sampleField(session: EffectSession, path: string, count = 6, seed = 1234, dt = 1 / 30): FieldSamples | null {
	const box = sandbox(session, seed);
	if (!box) return null;
	const { world, def } = box;
	world.debug.log = true;
	world.debug.logLimit = 1e9;
	const born = new Map<number, number>();
	const series = new Map<number, Series>();
	let axis: FieldSamples['axis'] = 'particle age';
	let skipped = 0;
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
				const s = series.get(-1) ?? { id: -1, points: [] };
				s.points.push([world.time, l.result]);
				series.set(-1, s);
				continue;
			}
			if (!series.has(l.particle)) {
				if (series.size >= count) continue;
				series.set(l.particle, { id: l.particle, points: [] });
			}
			series.get(l.particle)!.points.push([world.time - (born.get(l.particle) ?? world.time), l.result]);
		}
	}
	return { axis, series: [...series.values()].filter((s) => s.points.length), skipped };
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
