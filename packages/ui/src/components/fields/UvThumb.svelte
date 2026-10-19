<script lang="ts">
	import { getContext } from 'svelte';
	import type { EffectSession } from '../../state/session.svelte';
	import type { Workspace } from '../../state/workspace.svelte';

	interface Props {
		session: EffectSession;
		/** the billboard's uv object */
		uv: Record<string, unknown> | null;
	}

	let { session, uv }: Props = $props();
	const workspace = getContext<Workspace | undefined>('oxygen.workspace');
	const SIZE = 40;

	let canvas = $state<HTMLCanvasElement>();
	let image = $state.raw<HTMLImageElement | null>(null);
	let missing = $state(false);

	const texturePath = $derived.by(() => {
		void session.version;
		return session.def?.texture ?? '';
	});
	/** a painted, unsaved version of the texture wins over the file, as in the viewport */
	const override = $derived(session.textureOverride?.path === texturePath ? session.textureOverride.url : null);

	$effect(() => {
		const path = texturePath;
		const over = override;
		image = null;
		missing = false;
		if (!path || !workspace) return;
		let live = true;
		void (over ? Promise.resolve(over) : workspace.host.resolveTexture(path, session.file)).then((url) => {
			if (!live) return;
			if (!url) {
				missing = true;
				return;
			}
			const img = new Image();
			img.onload = () => live && (image = img);
			img.onerror = () => live && (missing = true);
			img.src = url;
		});
		return () => (live = false);
	});

	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	/** the drawn area in texture units: the area, or a flipbook's first frame (null when Molang drives it: the whole texture shows) */
	const area = $derived.by(() => {
		if (!uv) return null;
		const fb = uv.flipbook as Record<string, unknown> | undefined;
		const at = (fb ? fb.base_UV : uv.uv) as unknown[] | undefined;
		const size = (fb ? fb.size_UV : uv.uv_size) as unknown[] | undefined;
		const r = [num(at?.[0]), num(at?.[1]), num(size?.[0]), num(size?.[1])];
		return r.every((n) => n !== null) ? (r as number[]) : null;
	});

	$effect(() => {
		const c = canvas;
		if (!c) return;
		const g = c.getContext('2d')!;
		const dpr = window.devicePixelRatio || 1;
		c.width = SIZE * dpr;
		c.height = SIZE * dpr;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, SIZE, SIZE);
		g.imageSmoothingEnabled = false;
		const img = image;
		if (!img) {
			// the game's missing texture
			for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
				g.fillStyle = (x + y) % 2 ? '#000' : missing ? '#f0f' : '#333';
				g.fillRect((x * SIZE) / 2, (y * SIZE) / 2, SIZE / 2, SIZE / 2);
			}
			return;
		}
		// what the particle shows: the area (a flipbook's first frame), or the whole texture
		const a = area;
		const tw = Number(uv?.texture_width) || img.width;
		const th = Number(uv?.texture_height) || img.height;
		const sx = img.width / tw;
		const sy = img.height / th;
		const src = a ? { x: a[0] * sx, y: a[1] * sy, w: a[2] * sx, h: a[3] * sy } : { x: 0, y: 0, w: img.width, h: img.height };
		const aw = Math.abs(src.w) || 1;
		const ah = Math.abs(src.h) || 1;
		const k = Math.min(SIZE / aw, SIZE / ah);
		const w = aw * k;
		const h = ah * k;
		g.save();
		g.translate((SIZE - w) / 2 + (src.w < 0 ? w : 0), (SIZE - h) / 2 + (src.h < 0 ? h : 0));
		// a negative size draws the area mirrored, as the game does
		g.scale(src.w < 0 ? -1 : 1, src.h < 0 ? -1 : 1);
		g.drawImage(img, Math.min(src.x, src.x + src.w), Math.min(src.y, src.y + src.h), aw, ah, 0, 0, w, h);
		g.restore();
	});

	const title = $derived(missing ? `${texturePath} isn't in the pack — open the Texture panel` : texturePath ? `${texturePath} — open the Texture panel` : 'Open the Texture panel');
</script>

<button class="thumb" {title} aria-label="Open the Texture panel" onclick={() => workspace?.show('texture')}>
	<canvas bind:this={canvas} style:width="{SIZE}px" style:height="{SIZE}px"></canvas>
</button>

<style>
	.thumb {
		flex: none;
		padding: 0;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background:
			repeating-conic-gradient(var(--ox-input) 0% 25%, transparent 0% 50%) 0 0 / 8px 8px,
			var(--ox-bg, transparent);
		cursor: pointer;
		line-height: 0;
		overflow: hidden;
	}
	.thumb:hover,
	.thumb:focus-visible {
		border-color: var(--ox-lox);
	}
	canvas {
		display: block;
		image-rendering: pixelated;
	}
</style>
