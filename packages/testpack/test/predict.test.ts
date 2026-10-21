import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParticleWorld, type EffectDefinition } from 'wintersky';
import { queryExists } from '@oxygen/metadata';
import { TESTS, probeCurves, probeEvents, type Json } from '../src/tests';

/** min_engine_version of the generated packs */
const PACK_ENGINE = [1, 26, 0];
/** where probes are simulated: away from the world origin, where some children end up in-game (t53) */
const AT: [number, number, number] = [40, 0, 40];

export interface Prediction {
	test: string;
	probe: string;
	failed: string | null;
	visible: number;
	reads: string;
}

/** Simulate each probe alone in Oxygen's engine and record what it predicts the screenshot shows. */
function predict(): Prediction[] {
	const out: Prediction[] = [];
	for (const test of TESTS) {
		for (const p of test.probes) {
			const world = new ParticleWorld({ seed: 7, engine: PACK_ENGINE, queryExists });
			// culling only matters where the test turns the camera away; the probe sits at the origin, in view
			world.cullEmitters = !!test.lookAway;
			world.camera = { ...world.camera, position: [AT[0], AT[1], AT[2] + 6], forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] };
			const id = `oxygen:${test.id}_${p.id}`;
			const json = structuredClone(p.effect) as Json;
			if (test.formatVersion) json.format_version = test.formatVersion;
			json.particle_effect.description.identifier = id;
			const ev = p.events ?? probeEvents(test.id, p.id);
			if (ev) json.particle_effect.events = ev;
			const cv = p.curves ?? probeCurves(test.id, p.id);
			if (cv) json.particle_effect.curves = cv;
			const defs = new Map<string, EffectDefinition>();
			const def = world.loadEffect(json);
			defs.set(id, def);
			for (const [cid, child] of Object.entries(p.children ?? {})) {
				const c = structuredClone(child) as Json;
				c.particle_effect.description.identifier = `${id}_${cid}`;
				defs.set(`${id}_${cid}`, world.loadEffect(c));
			}
			world.resolveEffect = (x) => defs.get(x) ?? null;
			world.planes.push({ normal: [0, 1, 0], d: -2, block: 'minecraft:smooth_stone' });
			world.spawn(def, { position: [...AT], context: p.script ? 'script' : 'command', variables: p.script?.vars });
			const frames = Math.round(test.wait * 60);
			for (let f = 0; f < frames; f++) {
				const t = f / 60;
				const away = !!test.lookAway && t >= test.lookAway.after && t < test.lookAway.after + test.lookAway.seconds;
				world.camera.forward = away ? [0, 0, 1] : [0, 0, -1];
				world.camera.right = away ? [-1, 0, 0] : [1, 0, 0];
				world.step(1 / 60);
			}
			let visible = 0;
			for (const e of world.emitters) {
				const pool = e.pool;
				for (let i = 0; i < pool.count; i++) {
					const w = e.particleWorldPos(i, [0, 0, 0]);
					const near = Math.abs(w[0] - AT[0]) < 4 && Math.abs(w[1] - AT[1]) < 6 && Math.abs(w[2] - AT[2]) < 4;
					const size = Math.abs(pool.size[i * 2]) * Math.abs(pool.size[i * 2 + 1]);
					// flipbook probes: only one frame of the texture is solid
					const frameOk = p.opaqueU0 === undefined || Math.abs(pool.uv[i * 4] - p.opaqueU0) < 1e-3;
					if (pool.visible[i] && near && size > 0 && pool.color[i * 4 + 3] > 0 && frameOk) visible++;
				}
			}
			out.push({ test: test.id, probe: p.id, failed: def.failed ? def.failed.reason : null, visible, reads: p.reads });
		}
	}
	return out;
}

describe('engine predictions for the in-game test pack', () => {
	it('produces a prediction for every probe', () => {
		const predictions = predict();
		const dir = join(__dirname, '..', 'out');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'predictions.json'), JSON.stringify(predictions, null, '\t'));
		const lines = predictions.map((p) => `${p.test}.${p.probe}\t${p.failed ? 'FAILED' : p.visible > 0 ? `visible(${p.visible})` : 'hidden'}\t${p.reads}`);
		console.log(lines.join('\n'));
		expect(predictions.length).toBe(TESTS.reduce((s, t) => s + t.probes.length, 0));
	});
});

/**
 * Replay the in-game observations: every boolean result in the fixture means "the probe was visible".
 * Excluded: probes whose outcome depends on other probes (t30 cross-emitter temps), dot-count readouts
 * (t04/t29), render-state checks the headless simulation doesn't model, and camera queries (t59-t64: the
 * prediction has no camera; the preview's query provider is unit-tested against them instead).
 */
// t78.f1/f2: one-sided billboards facing away from the camera (the prediction doesn't cull back faces)
const NOT_REPLAYABLE = new Set(['t04', 't29', 't30', 't52.u0', 't56.y0', 't59', 't60', 't61', 't62', 't63', 't64', 't78.f1', 't78.f2']);

describe('in-game fixtures (1.26.52)', () => {
	const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'ingame-1.26.52.json'), 'utf8')) as {
		results: Record<string, Record<string, unknown>>;
	};
	const predictions = predict();
	const cases: [string, boolean, Prediction][] = [];
	for (const pr of predictions) {
		if (NOT_REPLAYABLE.has(pr.test) || NOT_REPLAYABLE.has(`${pr.test}.${pr.probe}`)) continue;
		const observed = fixture.results[pr.test]?.[pr.probe];
		if (typeof observed === 'boolean') cases.push([`${pr.test}.${pr.probe}: ${pr.reads}`, observed, pr]);
	}
	it.each(cases)('%s', (_name, observed, pr) => {
		expect(pr.visible > 0).toBe(observed);
	});
});
