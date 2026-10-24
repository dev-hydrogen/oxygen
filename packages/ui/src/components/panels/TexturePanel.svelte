<script lang="ts">
	import { textureKey, type Workspace } from '../../state/workspace.svelte';
	import { joinPath } from '../../lib/molang-text';
	import type { RGBA } from '../../lib/color';
	import ColorPicker from '../fields/ColorPicker.svelte';
	import ScrubNumber from '../fields/ScrubNumber.svelte';
	import { importTextureFile, pickTexture } from '../../lib/import-texture';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let wrap = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let w = $state(500);
	let h = $state(300);
	let zoom = $state(4);
	let pan = $state<[number, number]>([20, 20]);
	let mode = $state<'uv' | 'paint'>('uv');
	let tool = $state<'pencil' | 'eraser' | 'bucket' | 'picker'>('pencil');
	/** paint color, 0–1 channels */
	let paint = $state<RGBA>([1, 1, 1, 1]);
	/** fit and center the texture whenever the panel changes size, until the user pans or zooms */
	let autoFit = $state(true);
	// pixel history: one entry per stroke or fill (the file's history covers UV edits)
	const undoStack: ImageData[] = [];
	const redoStack: ImageData[] = [];
	let historyVersion = $state(0);
	let grid = $state(0);
	let tick = $state(0);
	let dirty = $state(false);

	/** editable copy of the texture */
	let image = $state.raw<HTMLCanvasElement | null>(null);
	let imagePath = '';
	let loadNote = $state<string | null>(null);

	const BB = 'particle_effect/components/minecraft:particle_appearance_billboard';
	const texturePath = $derived.by(() => {
		void session?.version;
		return session?.def.texture ?? '';
	});
	const uv = $derived.by(() => {
		void session?.version;
		const v = session?.doc.get(joinPath(BB, 'uv'));
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
	});
	const texW = $derived(Number(uv?.texture_width ?? image?.width ?? 16) || 1);
	const texH = $derived(Number(uv?.texture_height ?? image?.height ?? 16) || 1);

	/** the open effect's texture is an image imported on its own, not the pack's file */
	const imported = $derived(!!texturePath && textureKey(texturePath) in workspace.importedTextures);

	// load (or reload when the file's texture changes, a pack opens or an image is imported)
	$effect(() => {
		const s = session;
		const path = texturePath;
		const at = `${workspace.packVersion}|${path}`;
		if (!s || !path || at === imagePath) return;
		imagePath = at;
		image = null;
		dirty = false;
		loadNote = 'Loading texture…';
		void workspace.resolveTexture(path, s.file).then((url) => {
			if (!url) {
				loadNote = `“${path}” isn't in the pack. Open your resource pack folder so Oxygen can find it, or use Import image… for just the picture.`;
				tick++;
				return;
			}
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => {
				const c = document.createElement('canvas');
				c.width = img.width;
				c.height = img.height;
				c.getContext('2d')!.drawImage(img, 0, 0);
				image = c;
				loadNote = null;
				fit();
				tick++;
			};
			img.onerror = () => (loadNote = `Couldn't load “${path}”.`);
			img.src = url;
		});
	});

	// redraw a few times a second while particles move (live UV overlay)
	$effect(() => {
		const t = setInterval(() => tick++, 200);
		return () => clearInterval(t);
	});

	function fit() {
		if (!image || w < 20 || h < 20) return;
		const z = Math.min((w - 32) / image.width, (h - 32) / image.height);
		// whole pixels when it's enlarged (crisp), any size when it has to shrink
		zoom = z >= 1 ? Math.floor(z) : Math.max(1 / 16, Math.floor(z * 16) / 16);
		pan = [Math.round((w - image.width * zoom) / 2), Math.round((h - image.height * zoom) / 2)];
	}

	// the panel can load hidden (an inactive tab measures 0×0) or be resized: keep it centered until moved
	$effect(() => {
		void w;
		void h;
		void image;
		if (autoFit) fit();
	});

	/** texture-unit rect → screen rect (texture units are texture_width/height, scaled onto the image) */
	function toScreen(u: number, v: number): [number, number] {
		const sx = image ? image.width / texW : 1;
		const sy = image ? image.height / texH : 1;
		return [pan[0] + u * sx * zoom, pan[1] + v * sy * zoom];
	}
	function toTex(x: number, y: number): [number, number] {
		const sx = image ? image.width / texW : 1;
		const sy = image ? image.height / texH : 1;
		return [(x - pan[0]) / zoom / sx, (y - pan[1]) / zoom / sy];
	}

	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	/** constant UV rect being edited (null when Molang drives it) */
	const fileRect = $derived.by((): { u: number; v: number; w: number; h: number; base: string; size: string } | null => {
		if (!uv) return null;
		const fb = uv.flipbook as Record<string, unknown> | undefined;
		if (fb) {
			const b = fb.base_UV as unknown[] | undefined;
			const sz = fb.size_UV as unknown[] | undefined;
			const u0 = num(b?.[0]), v0 = num(b?.[1]), sw = num(sz?.[0]), sh = num(sz?.[1]);
			return u0 !== null && v0 !== null && sw !== null && sh !== null ? { u: u0, v: v0, w: sw, h: sh, base: joinPath(BB, 'uv', 'flipbook', 'base_UV'), size: joinPath(BB, 'uv', 'flipbook', 'size_UV') } : null;
		}
		const a = uv.uv as unknown[] | undefined;
		const sz = uv.uv_size as unknown[] | undefined;
		const u0 = num(a?.[0]), v0 = num(a?.[1]), sw = num(sz?.[0]), sh = num(sz?.[1]);
		return u0 !== null && v0 !== null && sw !== null && sh !== null ? { u: u0, v: v0, w: sw, h: sh, base: joinPath(BB, 'uv', 'uv'), size: joinPath(BB, 'uv', 'uv_size') } : null;
	});
	/** the area as it's being dragged (drawn at once, written to the file a few times a second) */
	let rectDraft = $state<{ u: number; v: number; w: number; h: number } | null>(null);
	const rect = $derived(fileRect && rectDraft ? { ...fileRect, ...rectDraft } : fileRect);
	const frames = $derived.by(() => {
		const fb = uv?.flipbook as Record<string, unknown> | undefined;
		if (!fb || !rect) return [];
		const step = (fb.step_UV as number[]) ?? [0, 0];
		const n = Math.min(64, Math.max(1, Math.floor(num(fb.max_frame) ?? 1)));
		return Array.from({ length: n }, (_, i) => ({ u: rect.u + (step[0] ?? 0) * i, v: rect.v + (step[1] ?? 0) * i }));
	});

	$effect(() => {
		void tick;
		void zoom;
		void pan;
		void rect;
		const cv = canvas;
		if (!cv) return;
		const dpr = window.devicePixelRatio || 1;
		cv.width = w * dpr;
		cv.height = h * dpr;
		const ctx = cv.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		if (!image) return;
		const css = getComputedStyle(cv);
		const col = (v: string) => css.getPropertyValue(v).trim() || '#888';
		const iw = image.width * zoom, ih = image.height * zoom;
		// transparency checker
		const cell = Math.max(4, zoom * 2);
		for (let y = 0; y < ih; y += cell) for (let x = 0; x < iw; x += cell) {
			ctx.fillStyle = ((x + y) / cell) % 2 ? '#3a3f4f' : '#2c303d';
			ctx.fillRect(pan[0] + x, pan[1] + y, Math.min(cell, iw - x), Math.min(cell, ih - y));
		}
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(image, pan[0], pan[1], iw, ih);
		if (zoom >= 6) {
			ctx.strokeStyle = 'rgba(255,255,255,0.07)';
			ctx.beginPath();
			for (let x = 0; x <= image.width; x++) { ctx.moveTo(pan[0] + x * zoom + 0.5, pan[1]); ctx.lineTo(pan[0] + x * zoom + 0.5, pan[1] + ih); }
			for (let y = 0; y <= image.height; y++) { ctx.moveTo(pan[0], pan[1] + y * zoom + 0.5); ctx.lineTo(pan[0] + iw, pan[1] + y * zoom + 0.5); }
			ctx.stroke();
		}
		if (grid > 0) {
			ctx.strokeStyle = 'rgba(147,189,245,0.35)';
			ctx.beginPath();
			for (let u = 0; u <= texW; u += grid) { const [x] = toScreen(u, 0); ctx.moveTo(Math.round(x) + 0.5, pan[1]); ctx.lineTo(Math.round(x) + 0.5, pan[1] + ih); }
			for (let v = 0; v <= texH; v += grid) { const [, y] = toScreen(0, v); ctx.moveTo(pan[0], Math.round(y) + 0.5); ctx.lineTo(pan[0] + iw, Math.round(y) + 0.5); }
			ctx.stroke();
		}
		if (mode !== 'uv') return;
		// where live particles actually sample (random/Molang UVs show their spread)
		const e = session?.world.emitters[0];
		if (e) {
			ctx.strokeStyle = 'rgba(236,146,214,0.5)';
			ctx.lineWidth = 1;
			for (let i = 0; i < Math.min(e.pool.count, 150); i++) {
				const o = i * 4;
				const x0 = pan[0] + e.pool.uv[o] * iw, y0 = pan[1] + e.pool.uv[o + 1] * ih;
				const x1 = pan[0] + e.pool.uv[o + 2] * iw, y1 = pan[1] + e.pool.uv[o + 3] * ih;
				ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
			}
		}
		ctx.font = `11px ${col('--ox-font-ui')}`;
		frames.forEach((f, i) => {
			if (!rect) return;
			const [x0, y0] = toScreen(f.u, f.v);
			const [x1, y1] = toScreen(f.u + rect.w, f.v + rect.h);
			ctx.strokeStyle = i === 0 ? col('--ox-lox') : 'rgba(147,189,245,0.5)';
			ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
			ctx.fillStyle = col('--ox-frost');
			ctx.fillText(String(i + 1), Math.min(x0, x1) + 3, Math.min(y0, y1) + 12);
		});
		if (rect && !frames.length) {
			const [x0, y0] = toScreen(rect.u, rect.v);
			const [x1, y1] = toScreen(rect.u + rect.w, rect.v + rect.h);
			ctx.strokeStyle = col('--ox-lox');
			ctx.lineWidth = 2;
			ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
			ctx.fillStyle = col('--ox-lox');
			ctx.fillRect(x1 - 4, y1 - 4, 8, 8); // resize handle
		}
	});

	// ---- interaction (pointer capture keeps drags alive outside the canvas; no context menu)
	type Drag = { kind: 'pan' | 'move' | 'resize' | 'paint'; start: [number, number]; pan0: [number, number]; rect0: { u: number; v: number; w: number; h: number } | null };
	let drag: Drag | null = null;
	let spaceHeld = false;

	function local(e: PointerEvent | WheelEvent): [number, number] {
		const r = canvas!.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	}

	function down(e: PointerEvent) {
		const p = local(e);
		canvas!.setPointerCapture(e.pointerId);
		if (e.button === 1 || e.button === 2 || spaceHeld) {
			drag = { kind: 'pan', start: p, pan0: [...pan], rect0: null };
			return;
		}
		if (mode === 'paint') {
			if (!image) return;
			if (tool === 'picker') return pickAt(p);
			remember();
			if (tool === 'bucket') {
				fillAt(p);
				pushOverride();
				return;
			}
			drag = { kind: 'paint', start: p, pan0: pan, rect0: null };
			paintAt(p);
			return;
		}
		if (rect) {
			const [x1, y1] = toScreen(rect.u + rect.w, rect.v + rect.h);
			const [x0, y0] = toScreen(rect.u, rect.v);
			if (Math.abs(p[0] - x1) < 8 && Math.abs(p[1] - y1) < 8) drag = { kind: 'resize', start: p, pan0: pan, rect0: { ...rect } };
			else if (p[0] >= Math.min(x0, x1) && p[0] <= Math.max(x0, x1) && p[1] >= Math.min(y0, y1) && p[1] <= Math.max(y0, y1)) drag = { kind: 'move', start: p, pan0: pan, rect0: { ...rect } };
			else drag = { kind: 'pan', start: p, pan0: [...pan], rect0: null };
			if (drag.kind !== 'pan' && session) {
				session.doc.history.seal();
				// one drag is one undo step, however long it pauses
				session.doc.history.mergeMs = Infinity;
			}
		} else drag = { kind: 'pan', start: p, pan0: [...pan], rect0: null };
	}

	const pendingUv = new Map<string, [number, number]>();
	let uvTimer: ReturnType<typeof setTimeout> | null = null;
	function flushUv() {
		if (uvTimer) clearTimeout(uvTimer);
		uvTimer = null;
		const s = session;
		if (!s || !pendingUv.size) return;
		const writes = [...pendingUv];
		pendingUv.clear();
		s.doc.transact('Edit texture area', () => {
			for (const [path, v] of writes) s.doc.set(path, v, 'Edit texture area');
		});
	}
	/** show the area at once; write it to the file soon (live particles pick it up without restarting) */
	function setRect(next: { u: number; v: number; w: number; h: number }) {
		if (!fileRect) return;
		if (rectDraft && next.u === rectDraft.u && next.v === rectDraft.v && next.w === rectDraft.w && next.h === rectDraft.h) return;
		rectDraft = next;
		pendingUv.set(fileRect.base, [next.u, next.v]);
		pendingUv.set(fileRect.size, [next.w, next.h]);
		uvTimer ??= setTimeout(flushUv, 60);
	}

	function move(e: PointerEvent) {
		if (!drag || !session) return;
		const p = local(e);
		if (drag.kind === 'pan') {
			pan = [drag.pan0[0] + p[0] - drag.start[0], drag.pan0[1] + p[1] - drag.start[1]];
			autoFit = false;
		} else if (drag.kind === 'paint') paintAt(p);
		else if (rect && drag.rect0) {
			const [a0, b0] = toTex(...drag.start);
			const [a1, b1] = toTex(...p);
			const du = Math.round(a1 - a0), dv = Math.round(b1 - b0); // snap to texture units
			const r0 = drag.rect0;
			if (drag.kind === 'move') setRect({ u: r0.u + du, v: r0.v + dv, w: r0.w, h: r0.h });
			else setRect({ u: r0.u, v: r0.v, w: Math.max(0, r0.w + du), h: Math.max(0, r0.h + dv) });
		}
	}

	function up(e: PointerEvent) {
		if (drag) canvas!.releasePointerCapture(e.pointerId);
		if (drag?.kind === 'paint') pushOverride();
		if (drag?.kind === 'move' || drag?.kind === 'resize') {
			flushUv();
			if (session) {
				session.doc.history.mergeMs = 800;
				session.doc.history.seal();
			}
			rectDraft = null;
		}
		drag = null;
	}

	function wheel(e: WheelEvent) {
		e.preventDefault();
		const p = local(e);
		const next = Math.min(64, Math.max(1 / 16, zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
		const z = next >= 1 ? Math.round(next * 4) / 4 : Math.round(next * 16) / 16;
		pan = [p[0] - ((p[0] - pan[0]) * z) / zoom, p[1] - ((p[1] - pan[1]) * z) / zoom];
		zoom = z;
		autoFit = false;
	}

	const bytes = (c: RGBA) => c.map((n) => Math.round(Math.min(1, Math.max(0, n)) * 255)) as RGBA;

	function pixelAt(p: [number, number]): [number, number] | null {
		if (!image) return null;
		const x = Math.floor((p[0] - pan[0]) / zoom), y = Math.floor((p[1] - pan[1]) / zoom);
		return x < 0 || y < 0 || x >= image.width || y >= image.height ? null : [x, y];
	}

	/** keep the pixels as they are before a stroke or fill, for undo */
	function remember() {
		if (!image) return;
		undoStack.push(image.getContext('2d')!.getImageData(0, 0, image.width, image.height));
		if (undoStack.length > 60) undoStack.shift();
		redoStack.length = 0;
		historyVersion++;
	}

	function restore(from: ImageData[], to: ImageData[]): boolean {
		const snap = from.pop();
		if (!snap || !image) return false;
		const ctx = image.getContext('2d')!;
		to.push(ctx.getImageData(0, 0, image.width, image.height));
		ctx.putImageData(snap, 0, 0);
		dirty = true;
		historyVersion++;
		tick++;
		pushOverride();
		return true;
	}
	const undoPixels = () => restore(undoStack, redoStack);
	const redoPixels = () => restore(redoStack, undoStack);

	function pickAt(p: [number, number]) {
		const px = pixelAt(p);
		if (!px || !image) return;
		const d = image.getContext('2d')!.getImageData(px[0], px[1], 1, 1).data;
		paint = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
		tool = 'pencil';
	}

	function paintAt(p: [number, number]) {
		const px = pixelAt(p);
		if (!px || !image) return;
		const ctx = image.getContext('2d')!;
		ctx.clearRect(px[0], px[1], 1, 1);
		if (tool === 'pencil') {
			const [r, g, b, a] = bytes(paint);
			ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
			ctx.fillRect(px[0], px[1], 1, 1);
		}
		dirty = true;
		tick++;
		pushOverrideSoon();
	}

	/** bucket: the connected area of exactly this pixel's color (4-way), in the paint color */
	function fillAt(p: [number, number]) {
		const px = pixelAt(p);
		if (!px || !image) return;
		const ctx = image.getContext('2d')!;
		const W = image.width, H = image.height;
		const img = ctx.getImageData(0, 0, W, H);
		const d = img.data;
		const at = (px[1] * W + px[0]) * 4;
		const from = [d[at], d[at + 1], d[at + 2], d[at + 3]];
		const to = bytes(paint);
		// fully transparent pixels count as one color whatever their RGB
		const same = (i: number) => (from[3] === 0 ? d[i + 3] === 0 : d[i] === from[0] && d[i + 1] === from[1] && d[i + 2] === from[2] && d[i + 3] === from[3]);
		if (from.every((v, k) => v === to[k])) return;
		const seen = new Uint8Array(W * H);
		const stack = [px[1] * W + px[0]];
		while (stack.length) {
			const n = stack.pop()!;
			if (seen[n]) continue;
			seen[n] = 1;
			const i = n * 4;
			if (!same(i)) continue;
			d[i] = to[0];
			d[i + 1] = to[1];
			d[i + 2] = to[2];
			d[i + 3] = to[3];
			const x = n % W;
			if (x > 0) stack.push(n - 1);
			if (x < W - 1) stack.push(n + 1);
			if (n >= W) stack.push(n - W);
			if (n < W * (H - 1)) stack.push(n + W);
		}
		ctx.putImageData(img, 0, 0);
		dirty = true;
		tick++;
	}

	/** show the painted texture in the preview before it is saved */
	function pushOverride() {
		if (overrideTimer) clearTimeout(overrideTimer);
		overrideTimer = null;
		if (!image || !session) return;
		session.textureOverride = { path: texturePath, url: image.toDataURL('image/png') };
	}
	let overrideTimer: ReturnType<typeof setTimeout> | null = null;
	/** while a stroke goes on, the preview follows a few times a second */
	function pushOverrideSoon() {
		overrideTimer ??= setTimeout(pushOverride, 150);
	}

	/** this panel's keys: pixel undo/redo, tools, nudging the texture area */
	function key(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key.toLowerCase();
		if (mod && mode === 'paint' && (k === 'z' || k === 'y')) {
			const redo = k === 'y' || e.shiftKey;
			// with no pixel history left, the keys fall through to the file's undo
			if (redo ? redoPixels() : undoPixels()) {
				e.preventDefault();
				e.stopPropagation();
			}
			return;
		}
		if (mod || e.altKey || document.activeElement !== canvas) return;
		if (mode === 'paint') {
			const t = ({ b: 'pencil', e: 'eraser', g: 'bucket', i: 'picker' } as const)[k as 'b'];
			if (t) {
				tool = t;
				e.preventDefault();
				e.stopPropagation();
			}
		} else if (rect && e.key.startsWith('Arrow')) {
			// arrows move the area a texture unit; with Shift they resize it
			const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] ?? [0, 0];
			e.preventDefault();
			e.stopPropagation();
			const r = { u: rect.u, v: rect.v, w: rect.w, h: rect.h };
			if (e.shiftKey) setRect({ ...r, w: Math.max(0, r.w + d[0]), h: Math.max(0, r.h + d[1]) });
			else setRect({ ...r, u: r.u + d[0], v: r.v + d[1] });
			flushUv();
			rectDraft = null;
		}
	}

	let dropping = $state(false);

	/** Point the effect at another texture (the game looks it up without the extension) */
	function setTexturePath(text: string) {
		if (!session) return;
		const path = text.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.(png|tga)$/i, '');
		if (path === texturePath) return;
		const at = 'particle_effect/description/basic_render_parameters/texture';
		if (path) session.doc.set(at, path, 'Change texture');
		else session.doc.remove(at, 'Remove texture');
	}

	function stopImport() {
		if (!texturePath) return;
		workspace.removeImportedTexture(texturePath);
		workspace.say(`${texturePath} comes from the pack again.`);
	}

	async function saveTexture() {
		if (!image || !session) return;
		const blob: Blob = await new Promise((r) => image!.toBlob((b) => r(b!), 'image/png'));
		// painted over an imported image: the import follows
		if (imported) workspace.importTexture(texturePath, image.toDataURL('image/png'));
		const ok = (await workspace.host.saveTexture?.(texturePath, session.file, blob)) ?? false;
		if (!ok) {
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `${texturePath.split('/').pop() || 'texture'}.png`;
			a.click();
		}
		dirty = false;
		workspace.say(ok ? `Saved ${texturePath}.png` : `Downloaded ${a11yName()}`);
	}
	const a11yName = () => `${texturePath.split('/').pop() || 'texture'}.png`;
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === ' ' && document.activeElement === canvas) {
			spaceHeld = true;
			e.preventDefault();
		}
	}}
	onkeyup={(e) => {
		if (e.key === ' ') spaceHeld = false;
	}}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="texture" onkeydown={key}>
	<div class="bar">
		<div class="seg" role="tablist" aria-label="Texture mode">
			<button role="tab" aria-selected={mode === 'uv'} onclick={() => (mode = 'uv')}>Texture area</button>
			<button role="tab" aria-selected={mode === 'paint'} onclick={() => (mode = 'paint')}>Paint</button>
		</div>
		{#if mode === 'paint'}
			<div class="seg" role="radiogroup" aria-label="Tool">
				<button role="radio" aria-checked={tool === 'pencil'} title="Pencil (B)" onclick={() => (tool = 'pencil')}>Pencil</button>
				<button role="radio" aria-checked={tool === 'eraser'} title="Eraser (E)" onclick={() => (tool = 'eraser')}>Eraser</button>
				<button role="radio" aria-checked={tool === 'bucket'} title="Fill an area of one color (G)" onclick={() => (tool = 'bucket')}>Fill</button>
				<button role="radio" aria-checked={tool === 'picker'} title="Pick a color from the texture (I)" onclick={() => (tool = 'picker')}>Pick</button>
			</div>
			<ColorPicker value={paint} label="Paint color" onchange={(c) => (paint = c)} oninput={(c) => (paint = c)} />
			{#key historyVersion}
				<button class="btn" disabled={!undoStack.length} title="Undo the last stroke (Ctrl+Z)" onclick={undoPixels}>Undo</button>
				<button class="btn" disabled={!redoStack.length} title="Redo (Ctrl+Y)" onclick={redoPixels}>Redo</button>
			{/key}
			<button class="btn" disabled={!dirty} onclick={saveTexture}>Save texture</button>
		{:else}
			<span class="gridsel" title="Grid lines every this many texture units (empty: off)">
				Grid
				<span class="gridnum"><ScrubNumber label="Atlas grid" value={grid || null} min={0} step={1} placeholder="Off" allowEmpty onchange={(v) => (grid = v && v > 0 ? v : 0)} /></span>
			</span>
		{/if}
		<span class="spacer"></span>
		<input
			class="path ox-code"
			aria-label="Texture path"
			title="The texture path, from the pack's root and without .png (basic_render_parameters › texture)"
			placeholder="textures/particle/…"
			spellcheck="false"
			value={texturePath}
			onchange={(e) => setTexturePath(e.currentTarget.value)}
			onkeydown={(e) => {
				if (e.key === 'Enter') e.currentTarget.blur();
				else if (e.key === 'Escape') {
					e.currentTarget.value = texturePath;
					e.currentTarget.blur();
				}
			}}
		/>
		<span class="dim ox-num">{imported ? 'imported' : ''}{image ? `${imported ? ' · ' : ''}${image.width}×${image.height}px` : ''}{uv ? ` · UV units ${texW}×${texH}` : ''}</span>
		{#if imported}
			<button class="btn" title="Show the pack's file at this path again" onclick={stopImport}>Remove import</button>
		{/if}
		<button class="btn" title="Use a picture file as this effect's texture, without a resource pack (or drop one here)" onclick={() => void pickTexture(workspace)}>Import image…</button>
		<button
			class="btn"
			onclick={() => {
				autoFit = true;
				fit();
			}}>Fit</button
		>
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="stage"
		class:dropping
		bind:this={wrap}
		bind:clientWidth={w}
		bind:clientHeight={h}
		ondragover={(e) => {
			if (!e.dataTransfer?.types.includes('Files')) return;
			e.preventDefault();
			dropping = true;
		}}
		ondragleave={() => (dropping = false)}
		ondrop={(e) => {
			const f = e.dataTransfer?.files?.[0];
			dropping = false;
			if (!f) return;
			e.preventDefault();
			e.stopPropagation();
			void importTextureFile(workspace, f);
		}}
	>
		<canvas
			bind:this={canvas}
			style:width="{w}px"
			style:height="{h}px"
			tabindex="0"
			aria-label="Texture"
			class:paint={mode === 'paint'}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onwheel={wheel}
			oncontextmenu={(e) => e.preventDefault()}
		></canvas>
		{#if loadNote}<p class="note">{loadNote}</p>{/if}
	</div>
	<p class="foot">
		{#if mode === 'uv'}
			{#if rect}Drag the blue area to move it, its corner to resize; values snap to texture units.{:else if uv}This texture area is driven by Molang, so edit it in the Inspector.{:else}This effect draws the whole texture.{/if}
			Arrow keys nudge it (Shift resizes). Pink outlines are where live particles sample. Middle, right or Space+drag pans; the wheel zooms.
		{:else}
			Painted pixels show in the preview right away; Save texture writes the PNG to the pack. Ctrl+Z undoes strokes; B, E, G and I pick the tool.
		{/if}
	</p>
</div>

<style>
	.texture {
		height: 100%;
		display: flex;
		flex-direction: column;
	}
	.bar {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 5px 8px;
		border-bottom: 1px solid var(--ox-rule);
		flex-wrap: wrap;
	}
	.seg {
		display: flex;
		background: var(--ox-input);
		border-radius: var(--ox-radius);
		padding: 2px;
	}
	.seg button {
		border: none;
		background: none;
		padding: 0 8px;
		height: 20px;
		border-radius: 2px;
		color: var(--ox-haze);
		cursor: pointer;
	}
	.seg button[aria-selected='true'],
	.seg button[aria-checked='true'] {
		background: var(--ox-raised);
		color: var(--ox-frost);
	}
	.btn {
		border: 1px solid var(--ox-rule-strong);
		background: none;
		border-radius: var(--ox-radius);
		height: 22px;
		padding: 0 8px;
		cursor: pointer;
	}
	.btn:disabled {
		opacity: 0.4;
	}
	.btn:hover:not(:disabled) {
		background: var(--ox-hover);
	}
	.spacer {
		flex: 1;
	}
	.dim {
		color: var(--ox-text-dim);
	}
	.gridsel {
		display: flex;
		gap: 6px;
		align-items: center;
		color: var(--ox-haze);
	}
	.gridnum {
		width: 46px;
	}
	.path {
		flex: 0 1 260px;
		min-width: 120px;
		height: 22px;
		background: var(--ox-input);
		color: var(--ox-frost);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
	}
	.path:focus {
		border-color: var(--ox-lox);
	}
	.stage {
		flex: 1;
		min-height: 80px;
		position: relative;
		overflow: hidden;
		background: var(--ox-night);
	}
	.stage.dropping {
		outline: 2px dashed var(--ox-lox);
		outline-offset: -4px;
	}
	canvas {
		display: block;
		cursor: grab;
		outline: none;
		touch-action: none;
	}
	canvas.paint {
		cursor: crosshair;
	}
	.note {
		position: absolute;
		inset: 0;
		margin: auto;
		height: fit-content;
		max-width: 50ch;
		text-align: center;
		color: var(--ox-haze);
	}
	.foot {
		margin: 0;
		padding: 4px 10px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
		border-top: 1px solid var(--ox-rule);
	}
</style>
