/// <reference lib="webworker" />
// A simulation worker: runs some of an effect's emitter trees in its own world, frame by frame, with the
// same inputs the main thread's world gets, and sends back what drawing needs.
import { queryExists } from '@oxygen/metadata';
import { BlockWorld } from '@oxygen/scene';
import { ParticleWorld, type EffectDefinition, type Vec3 } from 'wintersky';
import { applyPinned, scenarioQuery, writeScenarioGlobals, type InputScene } from '../lib/inputs';
import { PreviewQueries } from '../lib/queries';
import type { FrameInputs, FromSim, PackedArrays, RemoteFrame, SimSetup, ToSim } from './protocol';

let world: ParticleWorld | null = null;
let setup: SimSetup | null = null;
let defs = new Map<string, EffectDefinition | null>();
let inputs: FrameInputs | null = null;
let queryNames = new Set<string>();
let frames = 0;

const post = (m: FromSim, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function resolve(id: string): EffectDefinition | null {
	if (!world || !setup) return null;
	if (!defs.has(id)) {
		const json = setup.effects[id];
		defs.set(id, json ? world.loadEffect(json, setup.engine) : null);
	}
	return defs.get(id) ?? null;
}

function scene(w: ParticleWorld): InputScene {
	const root = w.emitters.find((e) => !e.parent);
	return {
		time: w.time,
		timeOfDay: inputs?.timeOfDay ?? 0.5,
		entity: inputs?.entity ?? null,
		camera: w.camera,
		origin: root?.position ?? [0, 0, 0],
	};
}

function start(s: SimSetup) {
	setup = s;
	defs = new Map();
	frames = 0;
	const w = new ParticleWorld({ engine: s.engine, queryExists, seed: s.seed, particleCap: s.caps });
	w.reserveIds(s.emitterBase, s.particleBase);
	w.time = s.time;
	w.frame = s.frame;
	if (s.blocks) w.blocks = BlockWorld.fromJSON(s.blocks as Parameters<typeof BlockWorld.fromJSON>[0]);
	w.planes = s.planes;
	w.resolveEffect = resolve;
	const sc = s.scenario;
	queryNames = new Set(Object.keys(sc?.queries ?? {}).map((k) => k.replace(/\(.*$/, '').toLowerCase()));
	w.queries = new PreviewQueries({
		override: (name, args, ww) => (queryNames.has(name) ? scenarioQuery(sc, name, args, scene(ww)) : undefined),
		timeOfDay: () => inputs?.timeOfDay ?? 0.5,
		lastDelta: () => inputs?.dt ?? 1 / 60,
		entity: () => inputs?.entity ?? null,
	});
	w.beforeUpdate = (ww) => applyPinned(ww, sc, scene(ww));
	// the scenario's temps and context values, as the main thread's world got them when the effect spawned
	writeScenarioGlobals(w, sc ?? null, scene(w));
	world = w;
}

const STRIDE = { pos: 3, size: 2, rot: 1, facing: 3, uv: 4, color: 4, visible: 1, local: 1, id: 1 } as const;

function frame(seq: number) {
	const w = world!;
	const out: RemoteFrame[] = [];
	let total = 0;
	for (const e of w.emitters) total += e.pool.count;
	const packed: PackedArrays = {
		pos: new Float32Array(total * 3),
		size: new Float32Array(total * 2),
		rot: new Float32Array(total),
		facing: new Float32Array(total * 3),
		uv: new Float32Array(total * 4),
		color: new Uint8Array(total * 4),
		visible: new Uint8Array(total),
		local: new Uint8Array(total),
		id: new Uint32Array(total),
	};
	let offset = 0;
	for (const e of w.emitters) {
		const p = e.pool;
		const n = p.count;
		for (const key of Object.keys(STRIDE) as (keyof typeof STRIDE)[]) {
			const k = STRIDE[key];
			(packed[key] as Float32Array).set((p[key] as Float32Array).subarray(0, n * k), offset * k);
		}
		out.push({
			id: e.id,
			parentId: e.parentId,
			effect: e.def.identifier,
			count: n,
			culled: e.culled,
			localSpace: e.localSpace,
			expired: e.expired,
			position: [...e.position] as Vec3,
			rotation: [...e.rotation] as [number, number, number, number],
			activeTime: e.activeTime,
			sleepTime: e.sleepTime,
			cap: e.cap,
			offset,
		});
		offset += n;
	}
	const errors = ++frames % 15 === 0 ? [...w.errors.values()] : null;
	post({ type: 'frame', seq, time: w.time, emitters: out, packed, errors }, Object.values(packed).map((a) => (a as Float32Array).buffer));
}

self.onmessage = (ev: MessageEvent<ToSim>) => {
	const m = ev.data;
	try {
		switch (m.type) {
			case 'setup':
				start(m.setup);
				break;
			case 'adopt': {
				const w = world!;
				// attached emitters follow the locator transform the main thread sends with every frame
				const attach = () => ({
					getTransform: () => ({ position: inputs?.attachment?.position ?? ([0, 0, 0] as Vec3), rotation: inputs?.attachment?.rotation ?? ([0, 0, 0, 1] as [number, number, number, number]), velocity: [0, 0, 0] as Vec3 }),
					alive: () => inputs?.attachment?.alive ?? true,
					aabb: setup?.aabb ?? undefined,
					scale: inputs?.attachment?.scale ?? 1,
					entity: true,
				});
				w.adopt(m.emitters, resolve, attach);
				break;
			}
			case 'step': {
				const w = world!;
				inputs = m.inputs;
				w.camera = m.inputs.camera;
				w.cullEmitters = m.inputs.cull;
				w.step(m.inputs.dt);
				frame(m.seq);
				break;
			}
			case 'recall': {
				const w = world;
				const emitters = w ? w.export(new Set(w.emitters.map((e) => e.id))) : [];
				post({ type: 'recalled', seq: m.seq, emitters });
				break;
			}
			case 'clear':
				world = null;
				setup = null;
				defs = new Map();
				break;
		}
	} catch (e) {
		post({ type: 'failed', message: (e as Error)?.message ?? String(e) });
	}
};
