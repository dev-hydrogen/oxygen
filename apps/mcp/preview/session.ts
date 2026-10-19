// What every request to the preview page starts from: the editor's own session for the effect, a viewport around it,
// and the fixed clock. Used by run (pictures and numbers) and inspect (the debugging tools).
import { DefaultLoadingManager } from 'three';
import { parse as parseJsonc } from 'jsonc-parser';
import { EffectSession, ViewportScene, Workspace, createMersProvider, createTextureProvider, type FileRef, type Host } from '@oxygen/ui';
import type { CameraRequest, SessionRequest, Vec3 } from '../src/protocol';

/** the simulation step: the editor's 60 fps */
export const DT = 1 / 60;

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
export const round3 = (x: number) => Math.round(x * 1000) / 1000;

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
export async function settle(scene: ViewportScene): Promise<void> {
	for (let round = 0; round < 40; round++) {
		const before = requests;
		scene.frame(0);
		await sleep(0);
		for (let i = 0; i < 2000 && loading > 0; i++) await sleep(5);
		if (requests === before) return;
	}
}

export interface OpenedSession {
	session: EffectSession;
	host: Host;
	/** textures that resolved to nothing */
	missing: Set<string>;
	close(): void;
}

/** The editor's session for the effect, set up as asked */
export async function openSession(req: SessionRequest): Promise<OpenedSession> {
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
	if (req.entity) session.setScene({ entity: { ...session.scene.entity, ...req.entity } }, false);
	session.loopPreview = req.repeat;
	await new Workspace(host).loadPackVisuals(session);
	return {
		session,
		host,
		missing,
		close: () => {
			session.dispose();
			for (const url of blobs) URL.revokeObjectURL(url);
		},
	};
}

/** A viewport for the session; stepping goes through it, so the world's camera follows the viewport's */
export function openScene(o: OpenedSession, width: number, height: number): { scene: ViewportScene; canvas: HTMLCanvasElement } {
	const canvas = document.createElement('canvas');
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	document.body.append(canvas);
	const scene = new ViewportScene(canvas, { textures: createTextureProvider(o.host, () => o.session), mers: createMersProvider(o.host, () => o.session) });
	scene.resize(width, height);
	scene.setSession(o.session);
	return { scene, canvas };
}

export function closeScene(scene: ViewportScene, canvas: HTMLCanvasElement): void {
	scene.dispose();
	scene.renderer.forceContextLoss();
	canvas.remove();
}

/**
 * Start the effect over at time 0. The stand-in entity's clock starts over too, so a replay moves it exactly as
 * the first play did (the editor's restart keeps it walking).
 */
export function restartClean(session: EffectSession): void {
	session.entity.time = 0;
	session.entity.update(0);
	session.restart();
}

/** A camera that shows the box lo–hi from `angle`; `zoom` > 1 moves closer */
export function framing(lo: Vec3, hi: Vec3, angle: keyof typeof ANGLES, zoom: number): { position: Vec3; target: Vec3; fov: number } {
	if (lo[0] === Infinity) {
		lo = [-1, -0.5, -1];
		hi = [1, 1.5, 1];
	}
	const center: Vec3 = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) as Vec3;
	const radius = Math.max(0.25, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
	const fov = 70;
	const dist = ((radius / Math.sin((fov * Math.PI) / 360)) * 1.1) / Math.max(0.05, zoom);
	const d = ANGLES[angle];
	const len = Math.hypot(d[0], d[1], d[2]);
	return { position: [0, 1, 2].map((k) => center[k] + (d[k] / len) * dist) as Vec3, target: center, fov };
}
