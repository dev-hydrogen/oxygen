// The headless preview the MCP server drives through Playwright: Oxygen's own session and viewport, stepped
// with a fixed clock instead of the animation loop, so a request always gives the same pictures and numbers.
import { DefaultLoadingManager } from 'three';
import { parse as parseJsonc } from 'jsonc-parser';
import { readMeta } from '@oxygen/format';
import { DEFAULT_GIZMOS, EffectSession, ViewportScene, Workspace, createMersProvider, createTextureProvider, type FileRef, type Host } from '@oxygen/ui';
import type { CameraRequest, EmitterSummary, PreviewApi, RunProblem, RunRequest, RunResult, SampleStats, Vec3 } from '../src/protocol';

/** the simulation step: the editor's 60 fps */
const DT = 1 / 60;

/** default viewing directions (from the target toward the camera) */
const ANGLES: Record<Extract<CameraRequest, { kind: 'auto' }>['angle'], Vec3> = {
	iso: [3.6, 2.8, 5.2],
	front: [0, 0.35, 1],
	side: [1, 0.35, 0],
	top: [0, 1, 0.02],
	bottom: [0, -1, 0.02],
};

// Texture loads in flight: the fetch through the server, then three's image decode. A picture is taken only
// once a frame draws without starting new loads.
let loading = 0;
let requests = 0;
const manager = DefaultLoadingManager;
const itemStart = manager.itemStart.bind(manager);
const itemEnd = manager.itemEnd.bind(manager);
manager.itemStart = (url) => {
	loading++;
	itemStart(url);
};
manager.itemEnd = (url) => {
	loading--;
	itemEnd(url);
};

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

/** times and coordinates reported to the millisecond / millimetre */
const round3 = (x: number) => Math.round(x * 1000) / 1000;

function makeHost(missing: Set<string>, blobs: string[]): Host {
	/** Fetch a file of the effect's pack through the server; it counts as a load in flight until `use` is done */
	const fromPack = async <T>(kind: 'texture' | 'pack-text', file: FileRef, path: string, use: (r: Response) => Promise<T>): Promise<T> => {
		requests++;
		loading++;
		try {
			return await use(await fetch(`./api/${kind}?file=${encodeURIComponent(file.id ?? '')}&path=${encodeURIComponent(path)}`));
		} finally {
			loading--;
		}
	};
	return {
		kind: 'web',
		save: async () => null,
		examples: async () => [],
		resolveTexture: (texture, file) =>
			fromPack('texture', file, texture, async (r) => {
				if (!r.ok) {
					missing.add(texture);
					return null;
				}
				const url = URL.createObjectURL(await r.blob());
				blobs.push(url);
				return url;
			}),
		readPackText: (path, file) => fromPack('pack-text', file, path, async (r) => (r.ok ? r.text() : null)),
		loadSettings: async () => ({}),
		saveSettings: () => {},
	};
}

/** Draw paused frames until one draws without asking for anything new, and every load has finished */
async function settle(scene: ViewportScene): Promise<void> {
	for (let round = 0; round < 40; round++) {
		const before = requests;
		scene.frame(0);
		await sleep(0);
		for (let i = 0; i < 2000 && loading > 0; i++) await sleep(5);
		if (requests === before) return;
	}
}

function measure(session: EffectSession, time: number): SampleStats {
	const p: Vec3 = [0, 0, 0];
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	let particles = 0;
	let visible = 0;
	let capHit = false;
	for (const e of session.world.emitters) {
		particles += e.pool.count;
		if (e.pool.count >= e.cap) capHit = true;
		if (e.culled) continue;
		for (let i = 0; i < e.pool.count; i++) {
			if (!e.pool.visible[i]) continue;
			visible++;
			e.particleWorldPos(i, p);
			for (let k = 0; k < 3; k++) {
				if (p[k] < min[k]) min[k] = p[k];
				if (p[k] > max[k]) max[k] = p[k];
			}
		}
	}
	return { time: round3(time), particles, visible, emitters: session.world.emitters.length, bounds: visible ? { min: min.map(round3) as Vec3, max: max.map(round3) as Vec3 } : null, capHit };
}

/** Put the pictures side by side, each labelled with its time and particle count */
async function contactSheet(urls: string[], labels: string[], w: number, h: number): Promise<string> {
	const cols = Math.ceil(Math.sqrt(urls.length));
	const rows = Math.ceil(urls.length / cols);
	const c = document.createElement('canvas');
	c.width = cols * w;
	c.height = rows * h;
	const g = c.getContext('2d')!;
	g.fillStyle = '#000';
	g.fillRect(0, 0, c.width, c.height);
	for (let i = 0; i < urls.length; i++) {
		const img = new Image();
		img.src = urls[i];
		await img.decode();
		const x = (i % cols) * w;
		const y = Math.floor(i / cols) * h;
		g.drawImage(img, x, y, w, h);
		g.font = '600 14px system-ui, sans-serif';
		const tw = g.measureText(labels[i]).width;
		g.fillStyle = 'rgba(0, 0, 0, 0.6)';
		g.fillRect(x + 6, y + 6, tw + 12, 22);
		g.fillStyle = '#fff';
		g.fillText(labels[i], x + 12, y + 22);
		g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
		g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
	}
	return c.toDataURL('image/png');
}

async function run(req: RunRequest): Promise<RunResult> {
	const missing = new Set<string>();
	const blobs: string[] = [];
	const host = makeHost(missing, blobs);
	const children = new Map<string, unknown>();
	for (const [id, text] of Object.entries(req.effects)) children.set(id, parseJsonc(text, [], { allowTrailingComma: true }));

	const session = new EffectSession(req.text, req.file, { engine: req.engine, findChild: (id) => children.get(id) ?? null });
	// worker threads would make stepping asynchronous: keep the whole world on this thread
	session.parallel.unavailable = true;
	session.setParentInputs(req.parents);
	if (req.timeOfDay !== null) session.timeOfDay = req.timeOfDay;
	if (req.spawn && session.spawnMode !== req.spawn) session.setSpawnMode(req.spawn);
	// every play starts with a restart, which spawns these too
	if (req.extras) session.setScene({ extras: req.extras.length ? req.extras : undefined }, false);
	session.loopPreview = req.repeat;
	await new Workspace(host).loadPackVisuals(session);

	// every event fired and every emitter seen, counted exactly (the Timeline panel keeps a capped window)
	let events = new Map<string, Map<string, { count: number; first: number }>>();
	let lanes = new Map<number, { effect: string; start: number; end: number | null }>();
	let now = 0;
	const recordEvent = session.world.onEvent;
	session.world.onEvent = (e, name, particle) => {
		recordEvent?.(e, name, particle);
		let byName = events.get(e.def.identifier);
		if (!byName) events.set(e.def.identifier, (byName = new Map()));
		const ev = byName.get(name);
		if (ev) ev.count++;
		else byName.set(name, { count: 1, first: round3(now) });
	};
	const noteEmitters = () => {
		const seen = new Set<number>();
		for (const e of session.world.emitters) {
			seen.add(e.id);
			if (!lanes.has(e.id)) lanes.set(e.id, { effect: e.def.identifier, start: now, end: null });
		}
		for (const [id, l] of lanes) if (l.end === null && !seen.has(id)) l.end = now;
	};

	const r = req.render;
	const width = r?.width ?? 320;
	const height = r?.height ?? 240;
	const canvas = document.createElement('canvas');
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	document.body.append(canvas);
	const scene = new ViewportScene(canvas, { textures: createTextureProvider(host, () => session), mers: createMersProvider(host, () => session) });
	scene.resize(width, height);
	scene.setSession(session);
	if (r) {
		scene.renderMode = r.mode;
		scene.gizmos = { ...DEFAULT_GIZMOS, ground: r.ground, block: r.ground, emitter: r.gizmos, children: r.gizmos, killPlane: r.gizmos };
		session.showShape = r.gizmos;
	}

	let peak = { particles: 0, time: 0 };
	let finishedAt: number | null = null;
	/** Start over and play to each sample time; `at` sees the paused world at each one */
	const play = async (at: (stats: SampleStats) => Promise<void> | void) => {
		events = new Map();
		lanes = new Map();
		peak = { particles: 0, time: 0 };
		finishedAt = null;
		now = 0;
		session.restart();
		session.playing = true;
		noteEmitters();
		for (const t of req.times) {
			while (now + DT / 2 < t && !session.finished) {
				now += DT;
				scene.frame(DT, false);
				noteEmitters();
				const n = session.world.particleCount;
				if (n > peak.particles) peak = { particles: n, time: round3(now) };
			}
			if (session.finished && finishedAt === null) finishedAt = round3(now);
			session.playing = false;
			// once everything has ended the clock stops; the sample still stands for the time asked about
			await at(measure(session, session.finished ? t : now));
			session.playing = !session.finished;
		}
	};

	let samples: SampleStats[] = [];
	const shots: string[] = [];
	if (r) {
		let view: { position: Vec3; target: Vec3; fov?: number } | null = null;
		const cam = r.camera;
		if (cam.kind === 'manual') view = cam;
		else if (cam.kind === 'bookmark') {
			const saved = readMeta(session.doc).cameras ?? [];
			const b = saved.find((c) => c.name === cam.name);
			if (!b) throw new Error(`No camera bookmark named "${cam.name}" in the file (saved: ${saved.map((c) => c.name).join(', ') || 'none'})`);
			view = b;
		} else {
			// a first run finds where the particles go, so every picture shares one camera that shows them all
			const lo: Vec3 = [Infinity, Infinity, Infinity];
			const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
			const grow = (p: readonly number[]) => {
				for (let k = 0; k < 3; k++) {
					lo[k] = Math.min(lo[k], p[k]);
					hi[k] = Math.max(hi[k], p[k]);
				}
			};
			await play((s) => {
				if (s.bounds) {
					grow(s.bounds.min);
					grow(s.bounds.max);
				} else for (const e of session.world.emitters) grow(e.position);
			});
			if (lo[0] === Infinity) {
				grow([-1, -0.5, -1]);
				grow([1, 1.5, 1]);
			}
			const center: Vec3 = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) as Vec3;
			const radius = Math.max(0.25, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
			const fov = 70;
			const dist = (radius / Math.sin((fov * Math.PI) / 360)) * 1.1 / Math.max(0.05, cam.zoom);
			const d = ANGLES[cam.angle];
			const len = Math.hypot(d[0], d[1], d[2]);
			view = { position: [0, 1, 2].map((k) => center[k] + (d[k] / len) * dist) as Vec3, target: center, fov };
		}
		scene.setView({ position: view.position, target: view.target, fov: view.fov ?? 70 });
		await play(async (s) => {
			samples.push(s);
			await settle(scene);
			scene.frame(0);
			// read the picture in the same task as the draw (the drawing buffer isn't kept)
			shots.push(canvas.toDataURL('image/png'));
		});
	} else {
		await play((s) => {
			samples.push(s);
		});
	}
	noteEmitters();

	session.refreshStats();
	const problems: RunProblem[] = session.problems.map((p) => ({ path: p.path, severity: p.severity, message: p.message, code: p.code, source: p.source }));

	const emitters = new Map<string, EmitterSummary>();
	for (const l of lanes.values()) {
		const s = emitters.get(l.effect);
		const end = l.end === null ? null : round3(l.end);
		if (!s) emitters.set(l.effect, { effect: l.effect, count: 1, firstStart: round3(l.start), lastEnd: end, events: {} });
		else {
			s.count++;
			s.lastEnd = s.lastEnd === null || end === null ? null : Math.max(s.lastEnd, end);
		}
	}
	for (const [effect, byName] of events) {
		const s = emitters.get(effect) ?? { effect, count: 0, firstStart: 0, lastEnd: null, events: {} };
		for (const [name, ev] of byName) s.events[name] = ev;
		emitters.set(effect, s);
	}

	const images = r && shots.length > 1 && r.sheet ? [await contactSheet(shots, samples.map((s) => `${s.time.toFixed(2)} s · ${s.particles} particles`), width, height)] : shots;
	const camera = r ? { position: scene.view().position, target: scene.view().target, fov: scene.view().fov } : null;

	scene.dispose();
	scene.renderer.forceContextLoss();
	canvas.remove();
	session.dispose();
	for (const url of blobs) URL.revokeObjectURL(url);

	return {
		identifier: session.identifier,
		samples,
		peak,
		finishedAt,
		emitters: [...emitters.values()],
		problems,
		missingTextures: [...missing],
		images,
		camera,
	};
}

const api: PreviewApi = { run };
window.oxygenPreview = api;
