// The headless preview the MCP server drives through Playwright: Oxygen's own session and viewport, stepped
// with a fixed clock instead of the animation loop, so a request always gives the same pictures and numbers.
import { readMeta } from '@oxygen/format';
import { DEFAULT_GIZMOS, type EffectSession } from '@oxygen/ui';
import type { EmitterSummary, PreviewApi, RunProblem, RunRequest, RunResult, SampleStats, Vec3 } from '../src/protocol';
import { inspect } from './inspect';
import { closeScene, DT, framing, openScene, openSession, restartClean, round3, settle } from './session';

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
	const opened = await openSession({ ...req, camera: null });
	const { session, missing } = opened;

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
	const { scene, canvas } = openScene(opened, width, height);
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
		restartClean(session);
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
			view = framing(lo, hi, cam.angle, cam.zoom);
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

	closeScene(scene, canvas);
	opened.close();

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

const api: PreviewApi = { run, inspect };
window.oxygenPreview = api;
