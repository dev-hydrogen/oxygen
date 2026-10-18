import { describe, expect, it } from 'vitest';
import { ParticleWorld } from 'wintersky';
import { compileIn, evaluateInEmitter, runIsolated, watchField } from '../src/debug/evaluate';
import { encodeGif } from '../src/debug/gif';
import { analyzeMolang, evaluateStandalone } from '../src/molang';

const DT = 1 / 60;

/** Particles laid out by an index counter the emitter resets every update, and a render-pass counter */
const counted = {
	format_version: '1.10.0',
	particle_effect: {
		description: { identifier: 'test:counted', basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' } },
		components: {
			'minecraft:emitter_initialization': { creation_expression: 'v.count = 5;', per_update_expression: 'v.next = 0; v.next_render = 0;' },
			'minecraft:emitter_rate_instant': { num_particles: 'v.count' },
			'minecraft:emitter_lifetime_once': { active_time: 5 },
			'minecraft:particle_lifetime_expression': { max_lifetime: 5 },
			'minecraft:particle_initialization': { per_update_expression: 'v.index = v.next; v.next = v.next + 1;', per_render_expression: 'v.r = v.next_render; v.next_render = v.next_render + 1;' },
			'minecraft:particle_motion_parametric': { relative_position: ['v.index', 0, 0] },
			'minecraft:particle_appearance_billboard': { size: ['0.1 + v.r * 0.1', 'math.random(0.1, 0.2)'], facing_camera_mode: 'rotate_xyz' },
		},
	},
};

function world() {
	const w = new ParticleWorld({ seed: 7 });
	const def = w.loadEffect(counted);
	const emitter = w.spawn(def, { position: [0, 0, 0] });
	for (let i = 0; i < 3; i++) w.step(DT);
	return { w, def, emitter };
}

const state = (w: ParticleWorld) => ({ snap: JSON.stringify({ ...w.snapshot(), emitters: w.emitters.map((e) => [e.vars, [...e.pool.pos.subarray(0, e.pool.count * 3)], [...e.pool.size.subarray(0, e.pool.count * 2)]]) }), rng: w.rng.state });

describe('field moments', () => {
	it('show what each particle saw from the shared variables, and change nothing', () => {
		const a = world();
		const b = world();
		const seen: { id: number; index: unknown; r: unknown }[] = [];
		const { expr: readIndex } = compileIn(a.w, 'v.next', null);
		const { expr: readR } = compileIn(a.w, 'v.next_render', null);
		const update = watchField(a.w, [a.def], 'particle_effect/components/minecraft:particle_initialization/per_update_expression', 'before', (m) => {
			seen.push({ id: m.emitter.pool.id[m.index], index: runIsolated(a.w, m.emitter, readIndex, m.env).value, r: null });
		});
		const render = watchField(a.w, [a.def], 'particle_effect/components/minecraft:particle_appearance_billboard/size/0', 'before', (m) => {
			const s = seen.find((x) => x.id === m.emitter.pool.id[m.index])!;
			// the render expression has already run for this particle: it took the value one below
			s.r = runIsolated(a.w, m.emitter, readR, m.env).value;
		});
		a.w.step(DT);
		update.restore();
		render.restore();
		b.w.step(DT);
		expect(seen.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
		expect(seen.map((s) => s.r)).toEqual([1, 2, 3, 4, 5]);
		// after the frame, the shared map only holds the last writer's value
		expect(a.w.emitters[0].vars[a.w.symbols.variable('variable.index')]).toBe(4);
		// the frame went exactly as it would have without anyone watching
		expect(state(a.w)).toEqual(state(b.w));
	});

	it('include constant fields, which the engine otherwise never evaluates', () => {
		const { w, def } = world();
		let n = 0;
		const watch = watchField(w, [def], 'particle_effect/components/minecraft:particle_lifetime_expression/max_lifetime', 'before', () => n++);
		w.spawn(def, { position: [0, 0, 0] });
		w.step(DT);
		watch.restore();
		expect(n).toBe(5);
		expect(def.particle.maxLifetime!.constant).toBe(5);
	});
});

describe('evaluating in an emitter', () => {
	it('sees the particle built-ins and the variables, and leaves no trace', () => {
		const { w, emitter } = world();
		const before = state(w);
		const { expr } = compileIn(w, 'v.next = 100; t.x = math.random(0, 1); return v.particle_age * 60 + v.index;', null);
		const res = evaluateInEmitter(w, emitter, 2, expr);
		expect(res.value).toBeCloseTo(3 + 4, 4);
		expect(res.changed['variable.next']).toEqual({ before: 5, after: 100 });
		expect(state(w)).toEqual(before);
	});

	it('reports an aborted expression like the game', () => {
		const { w, emitter } = world();
		const res = evaluateInEmitter(w, emitter, -1, compileIn(w, 'v.never_set * 2', null).expr);
		expect(res).toMatchObject({ value: 0, aborted: true });
		expect(res.errors).toContain('unset-variable');
	});
});

describe('standalone Molang', () => {
	it('runs loops with break, and lists every pass of a part', () => {
		const r = evaluateStandalone({ expression: 't.s = 0; t.i = 0; loop(10, { t.i = t.i + 1; t.i > 5 ? break; t.s = t.s + t.i; }); return t.s;' });
		expect(r.value).toBe(15);
		const sum = (r.parts as { text: string; values?: unknown[] }[]).find((p) => p.text === 't.s + t.i');
		expect(sum?.values).toEqual([1, 3, 6, 10, 15]);
	});

	it('uses 32-bit floats, and answers queries by exact call', () => {
		expect(evaluateStandalone({ expression: '0.1 + 0.2 == 0.3' }).value).toBe(1);
		expect(evaluateStandalone({ expression: 'q.position(1) + q.position(0)', queries: { 'query.position(1)': 2, 'q.position(0)': 5 } }).value).toBe(7);
	});

	it('analyses without running: an unknown query fails the field', () => {
		expect(analyzeMolang({ expression: 'q.not_a_query + 1' }).loads).toMatch(/^no/);
		expect(analyzeMolang({ expression: 'v.a = 1; v.b = v.a;' }).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing-return' })]));
	});
});

/** Just enough of a GIF decoder to check the encoder: the global palette and each frame's pixel indices */
function decodeGif(bytes: Uint8Array): { width: number; height: number; palette: Uint8Array; frames: Uint8Array[]; delays: number[] } {
	const u16 = (o: number) => bytes[o] | (bytes[o + 1] << 8);
	expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a');
	const width = u16(6), height = u16(8);
	const palette = bytes.slice(13, 13 + 768);
	let p = 13 + 768;
	const frames: Uint8Array[] = [];
	const delays: number[] = [];
	while (bytes[p] !== 0x3b) {
		if (bytes[p] === 0x21) {
			if (bytes[p + 1] === 0xf9) delays.push(u16(p + 4));
			p += 2;
			while (bytes[p]) p += bytes[p] + 1;
			p++;
			continue;
		}
		expect(bytes[p]).toBe(0x2c);
		p += 10;
		const min = bytes[p++];
		const data: number[] = [];
		while (bytes[p]) {
			data.push(...bytes.subarray(p + 1, p + 1 + bytes[p]));
			p += bytes[p] + 1;
		}
		p++;
		// LZW
		const clear = 1 << min;
		let size = min + 1;
		let dict: number[][] = [];
		const reset = () => {
			dict = Array.from({ length: clear + 2 }, (_, i) => [i]);
			size = min + 1;
		};
		reset();
		const out: number[] = [];
		let bit = 0;
		let prev: number[] | null = null;
		for (;;) {
			let code = 0;
			for (let k = 0; k < size; k++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << k;
			if (code === clear) {
				reset();
				prev = null;
				continue;
			}
			if (code === clear + 1) break;
			const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]];
			out.push(...entry);
			if (prev) dict.push([...prev, entry[0]]);
			if (dict.length === 1 << size && size < 12) size++;
			prev = entry;
		}
		frames.push(Uint8Array.from(out));
	}
	return { width, height, palette, frames, delays };
}

describe('GIF encoding', () => {
	it('round-trips frames through one palette, with the delays asked for', () => {
		const w = 37, h = 23;
		// more colours than fit a palette at once, as a gradient: every pixel must come back close to its colour
		const frames = [0, 1, 2].map((f) => {
			const data = new Uint8Array(w * h * 4);
			for (let i = 0; i < w * h; i++) data.set([(i * 7 + f * 40) % 256, (i * 3) % 256, (f * 90 + (i % w) * 6) % 256, 255], i * 4);
			return { width: w, height: h, data };
		});
		const gif = decodeGif(encodeGif(frames, [0.05, 0.1, 1 / 30]));
		expect([gif.width, gif.height, gif.frames.length]).toEqual([w, h, 3]);
		expect(gif.delays).toEqual([5, 10, 3]);
		let total = 0, worst = 0;
		frames.forEach((f, n) => {
			expect(gif.frames[n].length).toBe(w * h);
			for (let i = 0; i < w * h; i++) {
				const k = gif.frames[n][i] * 3;
				for (let c = 0; c < 3; c++) {
					const d = Math.abs(gif.palette[k + c] - f.data[i * 4 + c]);
					total += d;
					worst = Math.max(worst, d);
				}
			}
		});
		// 256 colours for thousands spread over the whole colour cube (boxes about 40 levels wide): close on average,
		// never far off. A render's colours cluster, so it does much better
		expect(total / (3 * w * h * 3)).toBeLessThan(12);
		expect(worst).toBeLessThan(48);
	});

	it('keeps a few flat colours exactly', () => {
		const colours = [
			[20, 28, 44],
			[252, 196, 84],
			[132, 60, 236],
		];
		const data = new Uint8Array(64 * 4);
		for (let i = 0; i < 64; i++) data.set([...colours[i % 3], 255], i * 4);
		const gif = decodeGif(encodeGif([{ width: 8, height: 8, data }], [0.1]));
		for (let i = 0; i < 64; i++) expect([...gif.palette.subarray(gif.frames[0][i] * 3, gif.frames[0][i] * 3 + 3)]).toEqual(colours[i % 3]);
	});
});
