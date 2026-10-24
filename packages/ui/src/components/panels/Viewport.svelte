<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { SPAWN_MODES, type SpawnMode } from '../../state/session.svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import { ViewportScene } from '../../viewport/scene';
	import { createMersProvider, createTextureProvider } from '../../lib/textures';
	import { readMeta, writeMeta } from '@oxygen/format';
	import { canTurn, sameTarget, type GizmoHit, type Gizmos, type MoveTarget } from '../../viewport/gizmos';
	import { openContextMenu, type MenuItem } from '../../lib/context-menu.svelte';
	import { captureName, copyImage, gifOptions, keepCapture, screenshotOptions, toPng, videoOptions } from '../../lib/capture';
	import { GifEncoder } from '../../lib/gif';
	import { VideoRecorder } from '../../lib/video';
	import { stampWatermark } from '../../lib/watermark';
	import { CAMERA_MOVE_SECONDS, CAMERA_MOVES } from '../../lib/camera-moves';
	import type { Vec3 } from 'wintersky';
	import { RECORD_REPEATING, SPEEDS } from '../../state/preferences';
	import { flyKeys } from '../../lib/keyboard';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	let canvas: HTMLCanvasElement;
	let wrap: HTMLDivElement;
	let scene: ViewportScene | null = null;
	let fps = $state(0);
	let downAt: [number, number] | null = null;
	let pressOnHandle = false;
	let fpsTimer: ReturnType<typeof setInterval>;
	const session = $derived(workspace.active);

	onMount(() => {
		// textures through the workspace, so images imported on their own stand in for the pack's
		const files = { resolveTexture: workspace.resolveTexture.bind(workspace), readPackText: workspace.host.readPackText?.bind(workspace.host) };
		scene = new ViewportScene(canvas, { textures: createTextureProvider(files, () => workspace.active, () => workspace.packVersion), mers: createMersProvider(files, () => workspace.active, () => workspace.packVersion) });
		scene.setSession(workspace.active);
		if (import.meta.env?.DEV) (window as unknown as { __oxScene: unknown }).__oxScene = scene;
		const ro = new ResizeObserver(() => scene?.resize(wrap.clientWidth, wrap.clientHeight));
		ro.observe(wrap);
		scene.resize(wrap.clientWidth, wrap.clientHeight);
		scene.onMove = applyMove;
		scene.onTurn = applyTurn;
		scene.start();
		fpsTimer = setInterval(() => (fps = scene?.fps ?? 0), 500);
		return () => ro.disconnect();
	});

	$effect(() => {
		scene?.setSession(session);
	});

	// which helpers are drawn (kept with the preferences)
	$effect(() => {
		const g = { ...workspace.gizmos };
		const limits = { ...workspace.prefs.gizmoLimits };
		if (scene) {
			scene.gizmos = g;
			scene.gizmoLimits = limits;
		}
	});

	// Settings › Viewport, and the keys bound to flying
	$effect(() => {
		const p = workspace.prefs;
		const controls = { fov: p.fov, turnSpeed: p.turnSpeed, invertY: p.invertY, zoomSpeed: p.zoomSpeed, flySpeed: p.flySpeed, fastFactor: p.fastFactor, resolution: p.resolution, background: p.background, flyKeys: flyKeys(workspace.keymap) };
		scene?.setControls(controls);
	});
	const km = $derived(workspace.keymap);

	let showOpen = $state(false);
	const GIZMOS: { key: keyof Gizmos; label: string; help: string }[] = [
		{ key: 'ground', label: 'Ground grid', help: "The ground plane's grid (particles still collide with it)" },
		{ key: 'block', label: 'Reference block', help: 'A one-block outline, for scale' },
		{ key: 'emitter', label: 'Emitter', help: "The effect's own emitter: its axes and ring. Click it to inspect the emitter." },
		{ key: 'children', label: 'Child emitters', help: 'Emitters its events spawn. Click one to inspect it.' },
		{ key: 'killPlane', label: 'Kill plane', help: 'Where the kill plane component removes particles' },
		{ key: 'entity', label: 'Entity', help: 'The stand-in entity, its locator and its path, when the effect is spawned on it' },
	];

	/** a click on something other than a particle: inspect it */
	function openGizmo(hit: GizmoHit) {
		const s = session;
		if (!s) return;
		if (hit.kind === 'emitter') {
			s.select({ emitter: hit.id, particle: -1 });
			workspace.show('debug');
		} else if (hit.kind === 'killPlane') {
			s.selected = 'particle_effect/components/minecraft:particle_kill_plane';
			workspace.show('inspector');
		} else if (hit.kind === 'shape') {
			const comps = Object.keys((s.doc.get('particle_effect/components') as object | undefined) ?? {});
			const shape = comps.find((k) => k.startsWith('minecraft:emitter_shape_'));
			if (shape) s.selected = `particle_effect/components/${shape}`;
			workspace.show('inspector');
		} else if (hit.kind === 'entity' || hit.kind === 'locator' || hit.kind === 'waypoint') {
			setTarget(hit);
			workspace.show('scene');
		} else if (hit.kind === 'block') setTarget(null);
	}

	// ---------------------------------------------------------------- moving the entity, locators, path points and blocks

	/** what the move handles are on (cleared when the effect changes) */
	let target = $state<MoveTarget | null>(null);
	/** the handles turn the target instead of moving it (R turns, G moves) */
	let turning = $state(false);
	function setTarget(t: MoveTarget | null, turn = false) {
		target = t;
		turning = turn && canTurn(t);
		if (scene) {
			scene.moveTarget = t;
			scene.turning = turning;
		}
	}
	function setTurning(on: boolean) {
		turning = on && canTurn(target);
		if (scene) scene.turning = turning;
	}

	/** where the emitter a target is about stands and how it's turned (the effect's own, or a scene effect) */
	function placeOf(t: MoveTarget): { which: number | null; position: Vec3; rotation: Vec3 } | null {
		const s = session;
		if (!s) return null;
		if (t.kind === 'emitter') return { which: null, position: [...(s.scene.emitter?.position ?? [0, 0, 0])] as Vec3, rotation: [...(s.scene.emitter?.rotation ?? [0, 0, 0])] as Vec3 };
		if (t.kind === 'extra') {
			const x = s.scene.extras?.[t.index];
			return x ? { which: t.index, position: [...x.position] as Vec3, rotation: [...(x.rotation ?? [0, 0, 0])] as Vec3 } : null;
		}
		return null;
	}

	/** Apply a turn of the rings (the target's whole turn now, as a quaternion) */
	function applyTurn(t: MoveTarget, q: [number, number, number, number], done: boolean) {
		const s = session;
		if (!s) return;
		if (t.kind === 'entity') {
			const ent = s.scene.entity;
			const yaw = ViewportScene.yawOf(q);
			s.setScene({ entity: { ...ent, yaw: yaw || undefined } }, false);
			s.entity.update(0);
		} else {
			const place = placeOf(t);
			if (place) s.placeEmitter(place.which, { position: place.position, rotation: ViewportScene.turnDegrees(q) });
		}
		if (done) moveStart = null;
	}

	/** Turn a target by `deg` degrees about a world axis (0 X, 1 Y, 2 Z), from the keys */
	function turnBy(t: MoveTarget, axis: 0 | 1 | 2, deg: number) {
		const s = session;
		if (!s || !scene) return;
		if (t.kind === 'entity') {
			if (axis !== 1) return;
			const ent = s.scene.entity;
			let yaw = (((ent.yaw ?? 0) - deg + 180) % 360 + 360) % 360 - 180;
			yaw = Math.round(yaw * 10) / 10;
			s.setScene({ entity: { ...ent, yaw: yaw || undefined } }, false);
			s.entity.update(0);
			return;
		}
		const place = placeOf(t);
		if (!place) return;
		const now = scene.targetTurn(s, t);
		const half = (deg * Math.PI) / 360;
		const by = [0, 0, 0, Math.cos(half)] as [number, number, number, number];
		by[axis] = Math.sin(half);
		// about the world axis: the extra turn goes first
		const [ax, ay, az, aw] = by, [bx, by2, bz, bw] = now;
		const q: [number, number, number, number] = [aw * bx + ax * bw + ay * bz - az * by2, aw * by2 - ax * bz + ay * bw + az * bx, aw * bz + ax * by2 - ay * bx + az * bw, aw * bw - ax * bx - ay * by2 - az * bz];
		s.placeEmitter(place.which, { position: place.position, rotation: ViewportScene.turnDegrees(q) });
	}
	$effect(() => {
		void session;
		untrack(() => setTarget(null));
	});

	const PX = 1 / 16;
	const snap = (v: number, step: number) => Math.round(v / step) * step;
	const round = (v: number) => Math.round(v * 1e4) / 1e4;
	/** the target's value when its drag (or nudge) began */
	let moveStart: unknown = null;

	/** Apply a drag of the handles (`delta` from where it began, in blocks) to what they're on */
	function applyMove(t: MoveTarget, delta: Vec3, done: boolean) {
		const s = session;
		if (!s) return;
		const ent = s.scene.entity;
		if (t.kind === 'entity') {
			const start = (moveStart ??= [...(ent.origin ?? [0, 0, 0])]) as Vec3;
			const origin = start.map((v, k) => round(v + snap(delta[k], PX))) as Vec3;
			s.setScene({ entity: { ...ent, origin: origin.some((v) => v) ? origin : undefined } }, false);
			s.entity.update(0);
		} else if (t.kind === 'locator') {
			const list = ent.locators ?? [];
			const start = (moveStart ??= list.find((l) => l.name === t.name)?.offset) as Vec3 | undefined;
			if (!start) return;
			// a pixel in the model is a sixteenth of a block, turned and scaled with the entity
			const d = s.entity.modelDelta(delta);
			const offset = start.map((v, k) => round(v + Math.round(d[k]))) as Vec3;
			s.setScene({ entity: { ...ent, locators: list.map((l) => (l.name === t.name ? { ...l, offset } : l)) } }, false);
		} else if (t.kind === 'waypoint') {
			const m = ent.motion;
			if (m.kind !== 'path') return;
			const start = (moveStart ??= [...m.points[t.index]]) as Vec3;
			const point = start.map((v, k) => round(v + snap(delta[k], PX))) as Vec3;
			s.setScene({ entity: { ...ent, motion: { ...m, points: m.points.map((p, i) => (i === t.index ? point : p)) } } }, false);
		} else if (t.kind === 'emitter' || t.kind === 'extra') {
			const place = placeOf(t);
			if (!place) return;
			const start = (moveStart ??= place.position) as Vec3;
			s.placeEmitter(place.which, { position: start.map((v, k) => round(v + snap(delta[k], PX))) as Vec3, rotation: place.rotation });
		} else {
			const start = (moveStart ??= [...t.cell]) as Vec3;
			const cell = start.map((v, k) => v + Math.round(delta[k])) as [number, number, number];
			if (!cell.every((v, k) => v === t.cell[k]) && !s.blocks.get(...cell)) {
				const b = s.blocks.get(...t.cell);
				s.blocks.set(...t.cell, null);
				if (b) s.blocks.set(...cell, b);
				s.applyScene(true);
				setTarget({ kind: 'block', cell });
			}
		}
		if (done) moveStart = null;
	}

	/** Arrow keys move the target along the world axis nearest the view, Page Up and Down move it up and down */
	function nudge(e: KeyboardEvent): boolean {
		const t = target;
		if (!t || !scene) return false;
		if (turning) {
			// left and right turn about the vertical; up and down tip it forward (about the view's right), Page Up / Down roll it
			const step = e.shiftKey ? 1 : 15;
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') turnBy(t, 1, e.key === 'ArrowLeft' ? step : -step);
			else if (t.kind === 'entity') return false;
			else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
				const f = scene.view();
				const fx = f.target[0] - f.position[0], fz = f.target[2] - f.position[2];
				const sideways = Math.abs(fx) > Math.abs(fz);
				const pitchAxis = sideways ? 2 : 0;
				const rollAxis = sideways ? 0 : 2;
				const sign = e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : -1;
				turnBy(t, e.key.startsWith('Arrow') ? pitchAxis : rollAxis, sign * step);
			} else return false;
			return true;
		}
		const step = t.kind === 'block' ? 1 : e.shiftKey ? 0.5 : PX;
		let d: Vec3 | null = null;
		if (e.key === 'PageUp') d = [0, step, 0];
		else if (e.key === 'PageDown') d = [0, -step, 0];
		else if (e.key.startsWith('Arrow')) {
			const f = scene.view();
			const fx = f.target[0] - f.position[0], fz = f.target[2] - f.position[2];
			// forward on the ground, snapped to X or Z; right is a quarter turn from it
			const fwd: Vec3 = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0, 0] : [0, 0, Math.sign(fz) || -1];
			const right: Vec3 = [-fwd[2], 0, fwd[0]];
			const dir = e.key === 'ArrowUp' ? fwd : e.key === 'ArrowDown' ? fwd.map((v) => -v) : e.key === 'ArrowRight' ? right : e.key === 'ArrowLeft' ? right.map((v) => -v) : null;
			if (dir) d = dir.map((v) => v * step) as Vec3;
		}
		if (!d) return false;
		moveStart = null;
		applyMove(t, d, true);
		return true;
	}

	function removeTarget() {
		const s = session;
		const t = target;
		if (!s || !t) return;
		const ent = s.scene.entity;
		if (t.kind === 'block') {
			s.blocks.set(...t.cell, null);
			s.applyScene(true);
		} else if (t.kind === 'waypoint' && ent.motion.kind === 'path' && ent.motion.points.length > 2) {
			const m = ent.motion;
			s.setScene({ entity: { ...ent, motion: { ...m, points: m.points.filter((_, i) => i !== t.index) } } }, false);
		} else if (t.kind === 'locator') {
			s.setScene({ entity: { ...ent, locators: (ent.locators ?? []).filter((l) => l.name !== t.name), locator: ent.locator === t.name ? '' : ent.locator } });
		} else return;
		setTarget(null);
	}

	function onCanvasKey(e: KeyboardEvent) {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'Escape' && target) {
			setTarget(null);
			e.preventDefault();
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && target) {
			removeTarget();
			e.preventDefault();
		} else if ((e.key === 'r' || e.key === 'R') && canTurn(target)) {
			setTurning(true);
			e.preventDefault();
		} else if ((e.key === 'g' || e.key === 'G') && target) {
			setTurning(false);
			e.preventDefault();
		} else if (nudge(e)) e.preventDefault();
	}

	const targetLabel = (t: MoveTarget) =>
		t.kind === 'entity'
			? 'the entity'
			: t.kind === 'emitter'
				? 'the emitter'
				: t.kind === 'extra'
					? (session?.scene.extras?.[t.index]?.effect ?? 'the effect')
					: t.kind === 'locator'
						? `locator ${t.name}`
						: t.kind === 'waypoint'
							? `path point ${t.index + 1}`
							: `the block at ${t.cell.join(' ')}`;

	// ---------------------------------------------------------------- screenshots and GIFs

	/** a recording under way: how far (`done` of a set length), how many seconds so far, `open` when it runs until the effect ends */
	let recording = $state<{ kind: 'gif' | 'video'; done: number; time: number; open: boolean; stop: boolean } | null>(null);

	async function screenshot(saveToo: boolean) {
		const s = session;
		if (!scene || !s) return;
		try {
			const image = scene.capture(screenshotOptions(workspace.prefs));
			if (workspace.prefs.watermark) await stampWatermark(image);
			const png = await toPng(image);
			const copied = await copyImage(png);
			const size = `${image.width} × ${image.height}`;
			if (saveToo || !copied) {
				const kept = await keepCapture(workspace.host, captureName(s.identifier, 'png'), png);
				if (!kept) return;
				workspace.say(`${copied ? 'Copied the screenshot' : `Saved the screenshot (this ${workspace.host.kind === 'vscode' ? 'view' : 'browser'} won't put pictures on the clipboard)`} (${size}) ${copied ? 'and saved it to' : 'to'} ${kept.where}.`);
			} else workspace.say(`Copied a screenshot (${size}) to the clipboard.`);
		} catch (e) {
			workspace.say(`The screenshot didn't work: ${(e as Error).message}`, 'error');
		}
	}

	/** Record a GIF or a video at a steady frame rate, for the set length or until the effect ends */
	async function record(kind: 'gif' | 'video', fromStart: boolean) {
		const s = session;
		if (!scene || !s || recording) return;
		const p = workspace.prefs;
		const base = kind === 'gif' ? gifOptions(p) : videoOptions(p);
		// an effect that repeats forever never ends: a while of it instead
		const looping = s.def?.emitter.lifetime?.type === 'looping' && (s.loopPreview || (s.spawnMode === 'entity' && s.scene.entity.removeAfter === undefined));
		const sized = !p.gifSeconds && looping ? { ...base, seconds: RECORD_REPEATING } : base;
		// a move spreads over a set length; until the effect ends, it takes CAMERA_MOVE_SECONDS
		const o = { ...sized, camera: { move: p.recordCamera, seconds: p.gifSeconds || (looping ? RECORD_REPEATING : CAMERA_MOVE_SECONDS) } };
		const mark = p.watermark;
		const what = kind === 'gif' ? 'GIF' : 'video';
		const wasPlaying = s.playing;
		recording = { kind, done: 0, time: 0, open: !p.gifSeconds && !looping, stop: false };
		// filled by the frames as they come (a closure, so the checker can't follow them)
		const out: { gif: GifEncoder | null; video: VideoRecorder | null } = { gif: null, video: null };
		try {
			await scene.record(
				{ ...o, fromStart },
				async (image, t, done) => {
					if (mark) await stampWatermark(image);
					if (kind === 'gif') (out.gif ??= new GifEncoder(o.transparent)).add(image, 1 / o.fps);
					else await (out.video ??= await VideoRecorder.start(image.width, image.height, o.fps)).add(image);
					if (recording) {
						recording.done = done;
						recording.time = t + 1 / o.fps;
					}
				},
				() => !!recording?.stop,
			);
			if (!fromStart && !wasPlaying) s.playing = false;
			const { gif, video } = out;
			const frames = (gif?.count ?? video?.count) || 0;
			if (!frames) return;
			const blob = gif ? new Blob([gif.finish() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }) : await video!.finish();
			const ext = gif ? 'gif' : video!.ext;
			const kept = await keepCapture(workspace.host, captureName(s.identifier, ext), blob);
			if (!kept) return;
			const copied = kept.path && workspace.host.copyFile ? await workspace.host.copyFile(kept.path) : false;
			const size = gif ? `${gif.width} × ${gif.height}` : `${video!.width} × ${video!.height}`;
			const kb = Math.round(blob.size / 1024).toLocaleString();
			const label = `a ${(frames / o.fps).toFixed(1)} s ${gif ? 'GIF' : ext.toUpperCase()} (${size}, ${o.fps} fps, ${kb} KB)`;
			workspace.say(copied ? `Recorded ${label}, saved it to ${kept.where} and copied the file.` : `Recorded ${label} and saved it to ${kept.where}.`);
		} catch (e) {
			void out.video?.cancel().catch(() => {});
			workspace.say(`The ${what} didn't work: ${(e as Error).message}`, 'error');
		} finally {
			recording = null;
		}
	}

	let lastCapture = 0;
	$effect(() => {
		const r = workspace.captureRequest;
		if (!r || r.at === lastCapture) return;
		lastCapture = r.at;
		untrack(() => {
			if (r.kind === 'copy' || r.kind === 'save') void screenshot(r.kind === 'save');
			else void record(r.kind.startsWith('gif') ? 'gif' : 'video', r.kind.endsWith('Start'));
		});
	});

	// ---------------------------------------------------------------- the right-click menu

	/** Move (and, where it turns, Turn) for a target */
	function moveItems(t: MoveTarget): MenuItem[] {
		const on = sameTarget(target, t);
		const items: MenuItem[] = [{ label: `Move ${targetLabel(t)}`, keys: 'G', checked: (on && !turning) || undefined, title: 'Drag the handles, or nudge with the arrow keys and Page Up / Page Down', run: () => setTarget(t) }];
		if (canTurn(t))
			items.push({
				label: `Turn ${targetLabel(t)}`,
				keys: 'R',
				checked: (on && turning) || undefined,
				title: t.kind === 'entity' ? 'Drag the ring, or turn with the left and right arrow keys' : 'Drag the rings, or turn with the arrow keys and Page Up / Page Down',
				run: () => setTarget(t, true),
			});
		return items;
	}

	function viewMenu(x: number, y: number): MenuItem[] {
		const s = session;
		if (!s || !scene) return [];
		const k = (id: string) => km.label(id);
		const items: MenuItem[] = [];
		const marker = scene.pickGizmo(x, y, 'emitter');
		const particle = marker ? null : scene.pick(x, y);
		// locator dots and path points come with the markers
		const other = marker && marker.kind !== 'emitter' ? marker : marker || particle ? null : scene.pickGizmo(x, y, 'other');
		if (marker && marker.kind === 'emitter') {
			items.push({ label: `Inspect emitter #${marker.id}`, run: () => openGizmo(marker) });
			// the effect's own emitter (where it isn't on the entity) and the scene's other effects move and turn
			const extra = s.extraIds.indexOf(marker.id);
			const t: MoveTarget | null = extra >= 0 ? { kind: 'extra', index: extra } : marker.id === s.rootEmitter?.id && s.spawnMode !== 'entity' ? { kind: 'emitter' } : null;
			if (t) {
				items.push(...moveItems(t));
				const place = placeOf(t);
				if (place)
					items.push({
						label: 'Reset its turn',
						disabled: !place.rotation.some((v) => v),
						run: () => s.placeEmitter(place.which, { position: place.position }),
					});
				if (t.kind === 'emitter') items.push({ label: 'Back to the world origin', disabled: !s.scene.emitter?.position, run: () => s.placeEmitter(null, { position: [0, 0, 0], rotation: s.scene.emitter?.rotation }) });
			}
		}
		if (particle) {
			items.push({ label: `Inspect particle #${particle.particle}`, run: () => { s.select(particle); workspace.show('debug'); } });
			items.push({ label: `Inspect its emitter #${particle.emitter}`, run: () => { s.select({ emitter: particle.emitter, particle: -1 }); workspace.show('debug'); } });
		}
		if (other) {
			if (other.kind === 'shape') items.push({ label: 'Edit the emitter shape', run: () => openGizmo(other) });
			else if (other.kind === 'killPlane') items.push({ label: 'Edit the kill plane', run: () => openGizmo(other) });
			else {
				if (other.kind === 'emitter') return items;
				const t: MoveTarget = other.kind === 'entity' ? { kind: 'entity' } : other.kind === 'locator' ? { kind: 'locator', name: other.name } : other.kind === 'waypoint' ? { kind: 'waypoint', index: other.index } : { kind: 'block', cell: other.cell };
				items.push(...moveItems(t));
				if (other.kind === 'locator') {
					const ent = s.scene.entity;
					items.push({ label: 'Attach the effect here', checked: ent.locator === other.name, run: () => s.setScene({ entity: { ...ent, locator: ent.locator === other.name ? '' : other.name } }) });
					items.push({ label: 'Remove the locator', danger: true, run: () => { setTarget({ kind: 'locator', name: other.name }); removeTarget(); } });
				}
				if (other.kind === 'waypoint') items.push({ label: 'Remove the point', danger: true, disabled: s.scene.entity.motion.kind === 'path' && s.scene.entity.motion.points.length <= 2, run: () => { setTarget({ kind: 'waypoint', index: other.index }); removeTarget(); } });
				if (other.kind === 'block') {
					const b = s.blocks.get(...other.cell);
					if (b) items.push({ label: `Paint with ${b.name.replace('minecraft:', '').replace(/_/g, ' ')}`, run: () => { s.painting = b.name; workspace.show('scene'); } });
					items.push({ label: 'Remove the block', danger: true, run: () => { s.blocks.set(...other.cell, null); s.applyScene(true); if (target?.kind === 'block') setTarget(null); } });
				}
				if (other.kind === 'entity') {
					const ent = s.scene.entity;
					items.push({ label: 'Back to the world origin', disabled: !ent.origin, run: () => { s.setScene({ entity: { ...ent, origin: undefined } }, false); s.entity.update(0); } });
					items.push({ label: 'Entity settings…', run: () => workspace.show('scene') });
				}
			}
		}
		if (target && !items.some((i) => 'label' in i && (i.label.startsWith('Move') || i.label.startsWith('Turn')))) items.push({ label: `Stop ${turning ? 'turning' : 'moving'} ${targetLabel(target)}`, keys: 'Esc', run: () => setTarget(null) });
		items.push({ separator: true });
		items.push({ label: s.playing ? 'Pause' : s.finished ? 'Replay' : 'Play', keys: k('preview.play'), run: () => s.togglePlay() });
		items.push({ label: 'Step one frame', keys: k('preview.step'), disabled: s.playing, run: () => s.stepFrame() });
		items.push({ label: 'Restart', keys: k('preview.restart'), run: () => s.restart() });
		items.push({ label: 'Repeat', checked: s.loopPreview, keys: k('preview.repeat'), run: () => void (s.loopPreview = !s.loopPreview) });
		items.push({ separator: true });
		items.push({ label: 'Copy a screenshot', keys: k('preview.copyScreenshot'), disabled: !!recording, run: () => screenshot(false) });
		items.push({ label: 'Save a screenshot', keys: k('preview.saveScreenshot'), disabled: !!recording, run: () => screenshot(true) });
		if (recording) items.push({ label: 'Stop recording', run: () => void (recording && (recording.stop = true)) });
		else {
			items.push({ label: 'Record a GIF from here', keys: k('preview.recordGif'), run: () => record('gif', false) });
			items.push({ label: 'Record a GIF from the start', keys: k('preview.recordGifStart'), run: () => record('gif', true) });
			items.push({ label: 'Record a video from here', keys: k('preview.recordVideo'), title: 'MP4 (WebM where the browser can’t make MP4)', run: () => record('video', false) });
			items.push({ label: 'Record a video from the start', keys: k('preview.recordVideoStart'), run: () => record('video', true) });
		}
		if (!recording) {
			items.push({ heading: 'Camera while recording' });
			for (const m of CAMERA_MOVES) items.push({ label: m.label, title: m.help, checked: workspace.prefs.recordCamera === m.id, run: () => void (workspace.prefs.recordCamera = m.id) });
			items.push({ separator: true });
		}
		items.push({ label: 'Screenshots leave out the background', checked: workspace.prefs.captureTransparent, run: () => void (workspace.prefs.captureTransparent = !workspace.prefs.captureTransparent) });
		items.push({ label: 'GIFs leave out the background', checked: workspace.prefs.gifTransparent, title: 'Translucent particles come out dithered', run: () => void (workspace.prefs.gifTransparent = !workspace.prefs.gifTransparent) });
		items.push({ separator: true });
		items.push({ label: 'Frame the particles', keys: k('preview.frame'), run: () => scene?.frameAll() });
		items.push({ label: 'Save this view', run: saveView });
		items.push({ separator: true }, { heading: 'Show' });
		items.push({ label: 'Emitter shape', checked: s.showShape, run: () => void (s.showShape = !s.showShape) });
		items.push({ label: 'Trajectory paths', checked: s.showPaths, run: () => void (s.showPaths = !s.showPaths) });
		items.push({ label: 'Facing axes', checked: s.showFacing, run: () => void (s.showFacing = !s.showFacing) });
		items.push({ label: 'Velocity arrows', checked: s.showVelocity, run: () => void (s.showVelocity = !s.showVelocity) });
		items.push({ separator: true });
		items.push({ label: 'Screenshot, GIF and helper settings…', run: () => workspace.openSettings('viewport') });
		return items;
	}

	$effect(() => {
		const m = workspace.renderMode;
		const sky = workspace.vvSky;
		if (scene) {
			scene.renderMode = m;
			scene.vvSky = sky;
		}
	});

	// "Frame the particles" from the command palette
	$effect(() => {
		if (workspace.frameRequest) scene?.frameAll();
	});

	$effect(() => {
		scene?.setSuspended(workspace.suspended);
	});

	onDestroy(() => {
		clearInterval(fpsTimer);
		scene?.dispose();
	});

	const speeds = SPEEDS;
	let viewsOpen = $state(false);
	const views = $derived.by(() => {
		void session?.version;
		return session ? (readMeta(session.doc).cameras ?? []) : [];
	});

	function saveView() {
		if (!session || !scene) return;
		const name = `View ${views.length + 1}`;
		writeMeta(session.doc, 'cameras', [...views, { name, ...scene.view() }], 'Save view');
	}

	function removeView(i: number) {
		if (!session) return;
		const next = views.filter((_, k) => k !== i);
		writeMeta(session.doc, 'cameras', next.length ? next : undefined, 'Remove view');
	}
</script>

<div class="viewport" bind:this={wrap}>
	<canvas
		bind:this={canvas}
		aria-label="Particle preview. Click a particle to inspect it."
		tabindex="0"
		onpointerdown={(e) => {
			downAt = [e.clientX, e.clientY];
			// a press on a move handle drags it: not a click
			pressOnHandle = e.button === 0 && !!scene?.handleHovered;
		}}
		onkeydown={onCanvasKey}
		onpointerup={(e) => {
			if (!downAt || !session || !scene) return;
			const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
			downAt = null;
			if (moved > 4 || pressOnHandle) return;
			const r = canvas.getBoundingClientRect();
			// right-drag looks around; a right click without dragging opens the menu
			if (e.button === 2) {
				openContextMenu(e, viewMenu(e.clientX - r.left, e.clientY - r.top));
				return;
			}
			if (e.button !== 0) return;
			if (session.painting) {
				scene.paint(e.clientX - r.left, e.clientY - r.top, e.shiftKey);
				return;
			}
			const x = e.clientX - r.left;
			const y = e.clientY - r.top;
			// an emitter marker right under the pointer wins over the particles around it
			const marker = scene.pickGizmo(x, y, 'emitter');
			if (marker) return openGizmo(marker);
			const hit = scene.pick(x, y);
			if (hit) {
				session.select(hit);
				workspace.show('debug');
				return;
			}
			const other = scene.pickGizmo(x, y, 'other');
			if (other) return openGizmo(other);
			session.select(null);
			setTarget(null);
		}}
	></canvas>

	{#if session}
		<div class="bar top">
			<button class="tool" aria-label={session.playing ? 'Pause' : session.finished ? 'Replay' : 'Play'} title={km.title(session.playing ? 'Pause' : session.finished ? 'Replay from the start' : 'Play', 'preview.play')} onclick={() => session.togglePlay()}>
				{#if session.playing}
					<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2" width="2.5" height="8" fill="currentColor" /><rect x="7" y="2" width="2.5" height="8" fill="currentColor" /></svg>
				{:else if session.finished}
					<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.5a3.5 3.5 0 1 0 1.1-3" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M2.2 1.6v2.8H5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
				{:else}
					<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" fill="currentColor" /></svg>
				{/if}
			</button>
			<button class="tool" aria-label="Step one frame" title={km.title('Step one frame', 'preview.step')} disabled={session.playing} onclick={() => session.stepFrame()}>
				<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2l5 4-5 4z" fill="currentColor" /><rect x="8.5" y="2" width="1.5" height="8" fill="currentColor" /></svg>
			</button>
			<button class="tool" aria-label="Restart" title={km.title('Restart', 'preview.restart')} onclick={() => session.restart()}>
				<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 6a3.5 3.5 0 1 1-1.1-2.55" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M9.8 1.5v2.8H7" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
			</button>
			<span class="sep"></span>
			<label class="mini">
				<span class="sr">Speed</span>
				<select value={session.speed} onchange={(e) => (session.speed = Number(e.currentTarget.value))} title="Playback speed">
					{#each speeds as s (s)}<option value={s}>{s}×</option>{/each}
				</select>
			</label>
			<label class="mini">
				<span class="sr">Spawned by</span>
				<select value={session.spawnMode} onchange={(e) => session.setSpawnMode(e.currentTarget.value as SpawnMode)} title={SPAWN_MODES.find((m) => m.id === session.spawnMode)?.help}>
					{#each SPAWN_MODES as m (m.id)}<option value={m.id} title={m.help}>{m.label}</option>{/each}
				</select>
			</label>
			<span class="sep"></span>
			<label class="mini">
				<span class="sr">Rendering</span>
				<select value={workspace.renderMode} onchange={(e) => (workspace.renderMode = e.currentTarget.value as 'classic' | 'vv' | 'split')} title="Vibrant Visuals is an approximation from the pack's lighting, grading and texture sets">
					<option value="classic">Classic</option>
					<option value="vv">Vibrant Visuals</option>
					<option value="split">Classic | Vibrant</option>
				</select>
			</label>
			{#if workspace.renderMode !== 'classic'}
				<button class="tool text" class:on={workspace.vvSky} aria-pressed={workspace.vvSky} title={workspace.vvSky ? "Vibrant Visuals shows the game's sky behind the particles. Turn off to keep the classic background, so only the particles differ." : 'Vibrant Visuals keeps the classic background, so only the particles differ. Turn on for the sky the game shows behind them.'} onclick={() => (workspace.vvSky = !workspace.vvSky)}>Sky</button>
			{/if}
			<div class="views">
				<button class="tool text" aria-expanded={showOpen} title="Choose which helpers the viewport draws" onclick={() => (showOpen = !showOpen)}>Show ▾</button>
				{#if showOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="menu left" role="menu" tabindex="-1" onpointerleave={() => (showOpen = false)}>
						<p class="vhead">This effect</p>
						{#each [{ on: session.showShape, label: 'Emitter shape', help: 'Outline the shape particles spawn in. Click it to edit the shape.', flip: () => (session.showShape = !session.showShape) }, { on: session.showPaths, label: 'Trajectory paths', help: 'Where sample particles travel over their lifetime', flip: () => (session.showPaths = !session.showPaths) }, { on: session.showFacing, label: 'Facing axes', help: 'How particles are oriented: their axes (X red, Y green, face blue) and the direction they were built from (amber)', flip: () => (session.showFacing = !session.showFacing) }, { on: session.showVelocity, label: 'Velocity arrows', help: 'Particle velocities: each line covers the next quarter second', flip: () => (session.showVelocity = !session.showVelocity) }] as o (o.label)}
							<button role="menuitemcheckbox" aria-checked={o.on} class="vitem check" title={o.help} onclick={o.flip}><span class="tick">{o.on ? '✓' : ''}</span>{o.label}</button>
						{/each}
						<p class="vhead">Scene</p>
						{#each GIZMOS as g (g.key)}
							<button role="menuitemcheckbox" aria-checked={workspace.gizmos[g.key]} class="vitem check" title={g.help} onclick={() => (workspace.gizmos = { ...workspace.gizmos, [g.key]: !workspace.gizmos[g.key] })}><span class="tick">{workspace.gizmos[g.key] ? '✓' : ''}</span>{g.label}</button>
						{/each}
						<p class="vnone">Click an emitter, the shape, the kill plane or the entity to inspect it. Click the entity, a locator or a path point to move it; right-click a block for its own menu.</p>
						<button class="vitem" onclick={() => { showOpen = false; workspace.openSettings('viewport'); }}>Helper limits…</button>
					</div>
				{/if}
			</div>
			<button class="tool text" class:on={session.loopPreview} aria-pressed={session.loopPreview} title="Repeat: looping effects loop seamlessly, as they do on an entity (in-game, /particle plays a looping effect once); other effects play again when they end." onclick={() => (session.loopPreview = !session.loopPreview)}>Repeat</button>
		</div>
		<div class="bar right">
			<div class="views">
				<button class="tool text" aria-expanded={viewsOpen} title="Saved camera views" onclick={() => (viewsOpen = !viewsOpen)}>Views</button>
				{#if viewsOpen}
					<div class="menu" role="menu">
						{#each views as v, i (i)}
							<div class="vrow">
								<button role="menuitem" class="vitem" onclick={() => { scene?.setView(v); viewsOpen = false; }}>{v.name}</button>
								<button class="vx" aria-label="Remove {v.name}" onclick={() => removeView(i)}>×</button>
							</div>
						{:else}
							<p class="vnone">No saved views yet.</p>
						{/each}
						<button class="vitem save" onclick={saveView}>Save this view</button>
						<p class="vnone">Views are stored in the file's oxygen block. Drag orbits around what's under the cursor; right drag looks around (hold {['forward', 'left', 'back', 'right'].map((a) => km.label(`camera.${a}`) ?? '').join(' ')} to fly).</p>
					</div>
				{/if}
			</div>
			<button class="tool text" title={km.title('Frame the particles', 'preview.frame')} onclick={() => scene?.frameAll()}>Frame</button>
		</div>
		{#if workspace.renderMode === 'split'}
			<div class="splitline" aria-hidden="true"></div>
			<span class="splitlabel left">Classic</span>
			<span class="splitlabel right">Vibrant Visuals (approximate)</span>
		{/if}
		{#if session.finished}
			<div class="ended" class:raised={session.historyRange.to - session.historyRange.from > 0.2}>
				<span>The effect ended at <span class="ox-num">{session.stats.time.toFixed(2)} s</span>: nothing it spawned is still alive.</span>
				<button class="tool text on" onclick={() => session.togglePlay()}>Replay</button>
				<button class="tool text" title="Play it again whenever it ends" onclick={() => (session.loopPreview = true)}>Repeat</button>
			</div>
		{/if}
		{#if !session.playing && session.historyRange.to - session.historyRange.from > 0.2}
			<div class="scrub">
				<span class="dim ox-num">{session.stats.time.toFixed(2)} s</span>
				<input
					type="range"
					min={session.historyRange.from}
					max={session.historyRange.to}
					step="0.01"
					value={session.stats.time}
					aria-label="Scrub through the last seconds"
					oninput={(e) => session.scrubTo(Number(e.currentTarget.value))}
				/>
				<span class="dim">Drag to go back; playing continues from there</span>
			</div>
		{/if}
		{#if recording}
			<div class="rec" role="status">
				<span class="dot" aria-hidden="true"></span>
				<span>Recording a {recording.kind === 'gif' ? 'GIF' : 'video'} <span class="ox-num">{recording.open ? `${recording.time.toFixed(1)} s, until the effect ends` : `${Math.round(recording.done * 100)}%`}</span></span>
				<button class="tool text on" onclick={() => recording && (recording.stop = true)}>Stop</button>
			</div>
		{:else if target}
			<div class="movehint">
				{#if turning}
					<span>Turning {targetLabel(target)}: drag the {target.kind === 'entity' ? 'ring, or use the left and right arrow keys' : 'rings, or use the arrow keys and Page Up / Down'} (15°; Shift: 1°).</span>
				{:else}
					<span>Moving {targetLabel(target)}: drag the handles, or use the arrow keys{target.kind === 'block' ? '' : ' (Shift: half a block)'} and Page Up / Down.</span>
				{/if}
				{#if canTurn(target)}
					<button class="tool text" class:on={!turning} title="Move (G)" onclick={() => setTurning(false)}>Move</button>
					<button class="tool text" class:on={turning} title="Turn (R)" onclick={() => setTurning(true)}>Turn</button>
				{/if}
				<button class="tool text" onclick={() => setTarget(null)}>Done</button>
			</div>
		{/if}
		<div class="hud ox-num" aria-live="off">
			<span class:warn={session.stats.capHit} title={session.stats.capHit ? 'An emitter is at the live particle cap: new particles are blocked, like in-game' : 'Live particles / cap per emitter'}>
				{session.stats.particles.toLocaleString()} <span class="dim">/ {session.stats.cap.toLocaleString()}</span>
			</span>
			{#if workspace.prefs.showFps}<span class="dim" data-fps={fps}>{fps} fps</span>{/if}
		</div>
	{:else}
		<div class="empty">
			<p>Open a particle file or start a new effect to see it here.</p>
		</div>
	{/if}
</div>

<style>
	.viewport {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #161a26;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		outline: none;
	}
	.bar {
		position: absolute;
		top: 8px;
		display: flex;
		align-items: center;
		gap: 2px;
		background: rgba(26, 30, 44, 0.86);
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius-float);
		padding: 2px;
		backdrop-filter: blur(6px);
	}
	.bar.top {
		left: 8px;
		/* wraps instead of running under Views and Frame in a narrow viewport */
		flex-wrap: wrap;
		max-width: calc(100% - 150px);
	}
	.bar.right {
		right: 8px;
	}
	.tool {
		height: 24px;
		min-width: 24px;
		border: none;
		background: none;
		color: var(--ox-haze);
		border-radius: var(--ox-radius);
		cursor: pointer;
		display: grid;
		place-items: center;
		padding: 0 4px;
	}
	.tool.text {
		padding: 0 8px;
	}
	.tool svg {
		width: 12px;
		height: 12px;
	}
	.tool:hover:not(:disabled) {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.tool:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.tool.on {
		color: var(--ox-lox);
	}
	.sep {
		width: 1px;
		height: 16px;
		background: var(--ox-rule-strong);
		margin: 0 3px;
	}
	.mini select {
		appearance: none;
		height: 24px;
		background: none;
		border: none;
		color: var(--ox-frost);
		padding: 0 6px;
		border-radius: var(--ox-radius);
		cursor: pointer;
	}
	.mini select:hover {
		background: var(--ox-hover);
	}
	.mini option {
		background: var(--ox-float);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.views {
		position: relative;
	}
	.menu {
		position: absolute;
		right: 0;
		top: 30px;
		z-index: 10;
		min-width: 200px;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		padding: 4px;
	}
	.menu.left {
		right: auto;
		left: 0;
		min-width: 220px;
	}
	.vhead {
		margin: 6px 8px 2px;
		font-size: 11px;
		color: var(--ox-text-dim);
	}
	.vitem.check {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tick {
		width: 12px;
		color: var(--ox-lox);
	}
	.vrow {
		display: flex;
	}
	.vitem {
		flex: 1;
		text-align: left;
		border: none;
		background: none;
		padding: 4px 8px;
		border-radius: var(--ox-radius);
		cursor: pointer;
		width: 100%;
	}
	.vitem:hover {
		background: var(--ox-selection);
	}
	.vitem.save {
		color: var(--ox-lox);
	}
	.vx {
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		width: 24px;
	}
	.vnone {
		margin: 4px 8px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.scrub {
		position: absolute;
		left: 50%;
		bottom: 8px;
		transform: translateX(-50%);
		display: flex;
		gap: 10px;
		align-items: center;
		background: rgba(26, 30, 44, 0.86);
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius-float);
		padding: 4px 10px;
		width: min(560px, 70%);
		font-size: 12px;
	}
	.ended {
		position: absolute;
		left: 50%;
		bottom: 8px;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		align-items: center;
		background: rgba(26, 30, 44, 0.92);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		padding: 3px 4px 3px 12px;
		font-size: 12px;
		white-space: nowrap;
		max-width: calc(100% - 16px);
	}
	.ended.raised {
		bottom: 48px;
	}
	.ended > span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.scrub input {
		flex: 1;
		accent-color: var(--ox-lox);
	}
	.splitline {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 1px;
		background: var(--ox-rule-strong);
		pointer-events: none;
	}
	.splitlabel {
		position: absolute;
		bottom: 30px;
		color: var(--ox-haze);
		font-size: 11.5px;
		pointer-events: none;
	}
	.splitlabel.left {
		right: calc(50% + 10px);
	}
	.splitlabel.right {
		left: calc(50% + 10px);
	}
	.rec,
	.movehint {
		position: absolute;
		left: 50%;
		top: 44px;
		transform: translateX(-50%);
		display: flex;
		gap: 8px;
		align-items: center;
		background: rgba(26, 30, 44, 0.92);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		padding: 3px 4px 3px 12px;
		font-size: 12px;
		white-space: nowrap;
		max-width: calc(100% - 16px);
	}
	.movehint > span {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ox-haze);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ox-error);
		animation: blink 1s steps(2) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.hud {
		position: absolute;
		left: 10px;
		bottom: 8px;
		display: flex;
		gap: 12px;
		color: var(--ox-frost);
		font-size: 12px;
		pointer-events: none;
	}
	.dim {
		color: var(--ox-haze);
	}
	.warn {
		color: var(--ox-warning);
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--ox-haze);
		pointer-events: none;
	}
</style>
