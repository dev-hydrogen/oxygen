import { describe, expect, it } from 'vitest';
import { tidyMenu, type MenuItem } from '../src/lib/menu-items';
import { StablePick } from '../src/viewport/overlays';
import { editNeedsRestart } from '../src/lib/restart';
import { DEFAULT_PREFERENCES, RECORD_LIMIT, readPreferences } from '../src/state/preferences';
import { CAMERA_MOVES, cameraAt } from '../src/lib/camera-moves';
import { DEFAULT_GIZMO_LIMITS } from '../src/viewport/gizmos';
import { captureName } from '../src/lib/capture';

describe('right-click menus', () => {
	it('keep separators and headings only between items', () => {
		const items: MenuItem[] = [{ separator: true }, { heading: 'Lost' }, { separator: true }, { label: 'a' }, { separator: true }, { separator: true }, { heading: 'Show' }, { label: 'b' }, { heading: 'Empty' }, { separator: true }];
		expect(tidyMenu(items)).toEqual([{ label: 'a' }, { separator: true }, { heading: 'Show' }, { label: 'b' }]);
		expect(tidyMenu([{ separator: true }])).toEqual([]);
	});
});

/** an emitter with particles whose ids are given */
const emitter = (id: number, ids: number[]) => ({ id, pool: { count: ids.length, id: Int32Array.from(ids) } });
const idsOf = (picks: [{ pool: { id: ArrayLike<number> } }, number][]) => picks.map(([e, i]) => e.pool.id[i]);

describe('helpers on many particles', () => {
	it('draw every particle under the limit', () => {
		const pick = new StablePick();
		expect(idsOf(pick.pick([emitter(1, [1, 2, 3])], 10))).toEqual([1, 2, 3]);
	});

	it('keep the same particles from frame to frame as more spawn, and top up as they die', () => {
		const pick = new StablePick();
		const first = idsOf(pick.pick([emitter(1, Array.from({ length: 100 }, (_, i) => i + 1))], 10));
		expect(first).toHaveLength(10);
		// 50 more spawn: a stride sampler would move to other particles; these stay
		const second = idsOf(pick.pick([emitter(1, Array.from({ length: 150 }, (_, i) => i + 1))], 10));
		expect(second).toEqual(first);
		// the first three die: three others take their place, the rest stay
		const alive = Array.from({ length: 150 }, (_, i) => i + 1).filter((id) => !first.slice(0, 3).includes(id));
		const third = idsOf(pick.pick([emitter(1, alive)], 10));
		expect(third).toHaveLength(10);
		expect(third.filter((id) => first.includes(id))).toEqual(first.slice(3));
	});

	it('spread the sample over the particles, and always include the inspected one', () => {
		const pick = new StablePick();
		const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
		const got = idsOf(pick.pick([emitter(1, ids)], 10, () => true, { emitter: 1, particle: 777 }));
		expect(got[0]).toBe(777);
		expect(Math.max(...got.slice(1)) - Math.min(...got.slice(1))).toBeGreaterThan(500);
	});

	it('skip emitters that have nothing to draw', () => {
		const pick = new StablePick();
		const a = emitter(1, [1, 2]);
		const b = emitter(2, [3, 4]);
		expect(idsOf(pick.pick([a, b], 10, (e) => e.id === 2))).toEqual([3, 4]);
	});
});

describe('edits while the preview plays', () => {
	const doc = (scenario: Record<string, unknown>) => ({ particle_effect: { description: { identifier: 'a:b' }, components: {} }, oxygen: { version: 1, scenarios: [{ name: 'S', ...scenario }], activeScenario: 'S' } });
	it('a scenario query value needs no fresh start: queries are asked for as they run', () => {
		expect(editNeedsRestart(doc({ queries: { 'query.x': 1 } }), doc({ queries: { 'query.x': 2 } }))).toBe(false);
	});
	it('nor does a pinned variable, which is written before every update', () => {
		expect(editNeedsRestart(doc({ variables: { 'v.a': 1 }, pinned: ['v.a'] }), doc({ variables: { 'v.a': 3 }, pinned: ['v.a'] }))).toBe(false);
	});
	it('a variable handed over at spawn does', () => {
		expect(editNeedsRestart(doc({ variables: { 'v.a': 1 } }), doc({ variables: { 'v.a': 3 } }))).toBe(true);
		expect(editNeedsRestart(doc({ variables: { 'v.a': 1 } }), doc({ variables: { 'v.a': 1 }, pinned: ['v.a'] }))).toBe(true);
	});
});

describe('viewport preferences', () => {
	it('default to higher helper limits and see-through captures', () => {
		expect(DEFAULT_PREFERENCES.gizmoLimits).toEqual(DEFAULT_GIZMO_LIMITS);
		expect(DEFAULT_GIZMO_LIMITS.facing).toBeGreaterThan(64);
		expect(DEFAULT_PREFERENCES.captureTransparent).toBe(true);
	});
	it('only keep limits and capture settings the dialog offers', () => {
		const p = readPreferences({ gizmoLimits: { facing: 2000, velocity: 7, shapes: 'x' }, captureScale: 3, gifFps: 24, gifSize: 1080, gifSeconds: 99, videoFps: 60, videoSize: 999 });
		expect(p.gizmoLimits).toEqual({ ...DEFAULT_GIZMO_LIMITS, facing: 2000 });
		expect(p.captureScale).toBe(3);
		expect(p.gifFps).toBe(DEFAULT_PREFERENCES.gifFps);
		expect(p.gifSize).toBe(1080);
		expect(p.gifSeconds).toBe(RECORD_LIMIT);
		expect(p.videoFps).toBe(60);
		expect(p.videoSize).toBe(DEFAULT_PREFERENCES.videoSize);
		// 0 records until the effect ends, and is where recordings start
		expect(readPreferences({ gifSeconds: 0 }).gifSeconds).toBe(0);
		expect(DEFAULT_PREFERENCES.gifSeconds).toBe(0);
	});
	it('name captures after the effect and the moment', () => {
		expect(captureName('oxygen:aurora', 'gif')).toMatch(/^aurora-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.gif$/);
		expect(captureName('weird/name:x y', 'png')).toMatch(/^x_y-/);
	});
});

describe('recording camera moves', () => {
	const start = { position: [3, 2, 4] as [number, number, number], target: [0, 1, 0] as [number, number, number] };
	const dist = (v: { position: number[]; target: number[] }) => Math.hypot(...v.position.map((p, k) => p - v.target[k]));
	it('start where the view is, and an orbit comes back round to it', () => {
		for (const m of CAMERA_MOVES) cameraAt(m.id, start, 0).position.forEach((p, k) => expect(p).toBeCloseTo(start.position[k], 6));
		cameraAt('orbit', start, 1).position.forEach((p, k) => expect(p).toBeCloseTo(start.position[k], 6));
		expect(dist(cameraAt('orbit', start, 0.37))).toBeCloseTo(dist(start), 6);
		expect(cameraAt('orbit', start, 0.37).position[1]).toBeCloseTo(2, 6);
	});
	it('push in, pull back and rise do what they say, and keep looking at the target', () => {
		expect(dist(cameraAt('push', start, 1))).toBeLessThan(dist(start));
		expect(dist(cameraAt('pull', start, 1))).toBeGreaterThan(dist(start));
		expect(cameraAt('rise', start, 1).position[1]).toBeGreaterThan(start.position[1]);
		for (const m of CAMERA_MOVES) expect(cameraAt(m.id, start, 0.6).target).toEqual(start.target);
	});
});
