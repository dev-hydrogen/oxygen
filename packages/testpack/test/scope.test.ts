import { describe, expect, it } from 'vitest';
import { parse } from 'molangjs';
import { MARKERS, type Json } from '../src/tests';
import { READ_CTXS, SCOPE_TESTS, scopeBehaviors, scopeClient, scopeCommands, scopeEffects, scopeEntities, sizeOf } from '../src/scope';

const client = scopeClient();
const bp = scopeBehaviors();
const effects = scopeEffects();
const anims = client.animations.animations as Json;
const controllers = client.controllers.animation_controllers as Json;
const renders = client.renderControllers.render_controllers as Json;

/** Every Molang string under a value (not names, paths or commands) */
function molang(v: unknown, out: string[] = []): string[] {
	if (typeof v === 'string') {
		if (/[=;?<>]|\b(q|v|t|c|math)\./.test(v) && !v.startsWith('/')) out.push(v);
	} else if (Array.isArray(v)) v.forEach((x) => molang(x, out));
	else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'identifier' && k !== 'particle_effects') molang(x, out);
	return out;
}

describe('scope tests (temps and context in game)', () => {
	it('every entity reference resolves: animations, controllers, render controllers, effects, states', () => {
		for (const e of Object.values(client.entities)) {
			const d = e['minecraft:client_entity'].description;
			for (const id of Object.values(d.animations) as string[]) expect(anims[id] ?? controllers[id], id).toBeDefined();
			for (const entry of d.scripts.animate) {
				const key = typeof entry === 'string' ? entry : Object.keys(entry)[0];
				expect(d.animations[key], key).toBeDefined();
			}
			for (const r of d.render_controllers) expect(renders[typeof r === 'string' ? r : Object.keys(r)[0]]).toBeDefined();
			for (const id of Object.values(d.particle_effects) as string[]) expect(effects[id.replace('oxygen:scope_', '')], id).toBeDefined();
			// effects an animation fires are the entity's short names
			for (const [id, a] of Object.entries(anims))
				if (!id.includes('.att_')) for (const list of Object.values((a as Json).particle_effects ?? {}) as Json[][]) for (const f of list) expect(d.particle_effects[f.effect], f.effect).toBeDefined();
		}
		for (const c of [...Object.values(controllers), ...Object.values(bp.controllers.animation_controllers as Json)] as Json[]) {
			expect(c.states[c.initial_state]).toBeDefined();
			for (const st of Object.values(c.states) as Json[]) for (const tr of st.transitions ?? []) expect(c.states[Object.keys(tr)[0]]).toBeDefined();
		}
		const b = bp.entities.scope['minecraft:entity'].description;
		for (const id of Object.values(b.animations) as string[]) expect((bp.animations.animations as Json)[id] ?? (bp.controllers.animation_controllers as Json)[id], id).toBeDefined();
		for (const entry of b.scripts.animate) expect(b.animations[Object.keys(entry)[0]]).toBeDefined();
	});

	it('all Molang parses, except the deliberate writes to c.*', () => {
		const sources = [client.entities.scope['minecraft:client_entity'].description.scripts, anims, controllers, renders, client.attachables, bp.animations, bp.controllers, effects];
		const errors = sources
			.flatMap((s) => molang(s))
			.flatMap((src) => parse(src).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.message}: ${src}`));
		expect(errors.every((e) => e.startsWith('context.* variables are read-only'))).toBe(true);
		expect(errors.length).toBe(2);
	});

	it('each station writes temps no other station writes', () => {
		const temps = new Map<string, string>();
		for (const test of SCOPE_TESTS)
			for (const st of test.stations) {
				for (const m of JSON.stringify(st.actors).matchAll(/\bt\.(s\d\d_\w+?)\b(?:\.\w+)? = /g)) {
					const owner = temps.get(m[1]);
					expect(owner === undefined || owner === `${test.id}_${st.id}`, `${m[1]} in ${test.id}_${st.id} and ${owner}`).toBe(true);
					temps.set(m[1], `${test.id}_${st.id}`);
				}
			}
		expect(temps.size).toBeGreaterThan(35);
	});

	it('a full reader reads its value in every client entity context, each on its own cube', () => {
		const readers = scopeEntities().filter((p) => p.actor.reads?.length === READ_CTXS.length);
		expect(readers.length).toBeGreaterThan(25);
		for (const r of readers) expect(r.actor.reads!.map((x) => x.ctx)).toEqual([...READ_CTXS]);
		// variants are unique and every one has a spawn event
		const events = bp.entities.scope['minecraft:entity'].events;
		for (const p of scopeEntities()) expect(events[`oxygen:v${p.variant}`]).toBeDefined();
	});

	it('the sizes a reader shows: expected values big, unset small, others tiny', () => {
		expect(sizeOf('t.x', [7], { values: [2, 1.5, 1], unset: 0.6, other: 0.3 })).toBe('((t.x ?? -999) == -999) ? 0.6 : (((t.x ?? -999) == 7) ? 2 : (0.3))');
		// the game allows only a bare variable left of ??: a member is checked through its struct
		expect(sizeOf('t.s.a', [7], { values: [2], unset: 0.6, other: 0.3 })).toBe('((t.s ?? -999) == -999) ? 0.6 : (((t.s.a) == 7) ? 2 : (0.3))');
	});

	it('a test function clears the last run and summons every entity with its variant', () => {
		const lines = scopeCommands(SCOPE_TESTS[0], 100, -61, MARKERS);
		expect(lines[0]).toBe('event entity @e[type=oxygen:scope] oxygen:despawn');
		const summons = lines.filter((l) => l.includes('summon oxygen:scope'));
		expect(summons.length).toBe(SCOPE_TESTS[0].stations.reduce((n, s) => n + s.actors.filter((a) => a.kind === 'entity').length, 0));
		// readers come a second later, through the delay script event
		expect(lines.some((l) => l.startsWith('scriptevent oxygen:at {"after":1,"command":"summon oxygen:scope 0 -60 100 0 0 oxygen:v'))).toBe(true);
	});
});
