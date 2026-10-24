import type { Scenario } from '@oxygen/format';

/** Which edits the preview can take while it plays, and which need the effect to start over */

/** components read once, when the emitter starts (or fires its burst): edits show on a fresh start */
const READ_AT_START = /^minecraft:emitter_(initialization|lifetime_(once|looping|expression)|rate_(instant|manual)|local_space)$/;
/** components read when a particle is created: with a burst nothing new is created, so edits need a fresh start */
const READ_AT_CREATION = /^minecraft:(emitter_shape_\w+|particle_initial_(speed|spin)|particle_lifetime_expression)$/;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * An oxygen block without what scenarios supply while the effect plays: query values are asked for every time
 * a query runs, and pinned variables are written before every update, so changing either needs no fresh start
 * (dragging one of them shows at once).
 */
function liveScenarios(meta: Record<string, unknown>): Record<string, unknown> {
	const list = meta.scenarios;
	if (!Array.isArray(list)) return meta;
	return {
		...meta,
		scenarios: list.map((sc: Scenario) => {
			const { queries: _q, ...rest } = sc;
			const pinned = new Set((sc.pinned ?? []).map((n) => n.toLowerCase()));
			if (!rest.variables || !pinned.size) return rest;
			return { ...rest, variables: Object.fromEntries(Object.entries(rest.variables).map(([n, v]) => [n, pinned.has(n.toLowerCase()) ? 'pinned' : v])) };
		}),
	};
}

/**
 * Whether an edit only shows after the effect starts over. Appearance, motion, curves and the like are read
 * every frame, so those edits run in place (EffectSession.hotSwap).
 */
export function editNeedsRestart(before: unknown, after: unknown): boolean {
	type Json = Record<string, unknown> | undefined;
	const a = (before ?? {}) as Record<string, unknown>;
	const b = (after ?? {}) as Record<string, unknown>;
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
		if (k === 'particle_effect') continue;
		if (k === 'oxygen') {
			// saved camera views don't touch the simulation; scenarios and the scene do
			const { cameras: _a, ...ma } = (a[k] ?? {}) as Record<string, unknown>;
			const { cameras: _b, ...mb } = (b[k] ?? {}) as Record<string, unknown>;
			if (!same(liveScenarios(ma), liveScenarios(mb))) return true;
		} else if (!same(a[k], b[k])) return true;
	}
	const pa = (a.particle_effect ?? {}) as Record<string, Json>;
	const pb = (b.particle_effect ?? {}) as Record<string, Json>;
	if (pa.description?.identifier !== pb.description?.identifier) return true;
	// events fire again from the start (creation events have already run)
	if (!same(pa.events, pb.events)) return true;
	const ca = (pa.components ?? {}) as Record<string, unknown>;
	const cb = (pb.components ?? {}) as Record<string, unknown>;
	const burst = 'minecraft:emitter_rate_instant' in cb || 'minecraft:emitter_rate_manual' in cb;
	for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
		if (same(ca[k], cb[k])) continue;
		if (READ_AT_START.test(k)) return true;
		if (burst && READ_AT_CREATION.test(k)) return true;
	}
	return false;
}
