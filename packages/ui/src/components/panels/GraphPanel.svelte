<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { sampleField, type FieldSamples } from '../../lib/sampler';
	import { PHASE_NAME, PHASE_VAR } from '../../lib/molang-text';
	import { fieldTarget } from '../../lib/field-target';
	import { tip } from '../../lib/tip';

	/** lines drawn, and particles sampled to choose them from and to shade the spread of */
	const LINES = 8;
	const POOL = 300;

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let canvas = $state<HTMLCanvasElement>();
	let width = $state(500);
	let height = $state(220);
	let seed = $state(1234);
	let samples = $state.raw<FieldSamples | null>(null);
	let busy = $state(false);

	/** the selected field (an axis or a vector's path gives the vector; numbers and missing fields count too) */
	const target = $derived.by(() => {
		void session?.version;
		return session ? fieldTarget(session, session.selected) : null;
	});
	/** which axis of a vector is plotted: the selected one, else the one picked here */
	let pickedAxis = $state(0);
	$effect(() => {
		const m = /\/(\d)$/.exec(session?.selected ?? '');
		pickedAxis = m && target?.kind === 'vector' ? Number(m[1]) : 0;
	});
	const ref = $derived(target ? (target.axes[Math.min(pickedAxis, target.axes.length - 1)] ?? null) : null);
	/** a value that doesn't change over time: say it instead of plotting a flat line */
	const constant = $derived.by(() => {
		const r = ref;
		if (!r) return null;
		if (!r.ref) return { value: r.fallback, missing: true };
		if (r.ref.field.constant !== null) return { value: r.ref.field.constant, missing: false };
		return null;
	});

	// resample when the field, the file or the seed changes (debounced: heavy effects take a moment)
	$effect(() => {
		const s = session;
		const r = ref;
		void s?.version;
		void seed;
		if (!s || !r || !r.ref || r.ref.field.broken || r.ref.field.constant !== null || !r.expectsValue) {
			samples = null;
			return;
		}
		busy = true;
		const t = setTimeout(() => {
			samples = sampleField(s, r.path, LINES, seed, 1 / 30, POOL);
			busy = false;
		}, 180);
		return () => clearTimeout(t);
	});

	const PAD = { l: 44, r: 12, t: 12, b: 26 };
	/** the plot's scales as last drawn, for reading values under the pointer */
	let scale: { x0: number; x1: number; y0: number; y1: number } | null = null;
	/** where the pointer is over the plot: the age there, and the values across the particles at it */
	let cursor = $state<{ left: number; x: number; text: string } | null>(null);
	function point(e: PointerEvent) {
		const data = samples;
		if (!data || !scale || !data.series.length) return void (cursor = null);
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const px = e.clientX - r.left;
		if (px < PAD.l || px > width - PAD.r) return void (cursor = null);
		const x = scale.x0 + ((px - PAD.l) / (width - PAD.l - PAD.r)) * (scale.x1 - scale.x0);
		let text: string;
		if (data.spread?.length) {
			const b = data.spread.reduce((best, s) => (Math.abs(s.x - x) < Math.abs(best.x - x) ? s : best));
			text = b.min === b.max ? fmt(b.mid) : `${fmt(b.min)} to ${fmt(b.max)}, median ${fmt(b.mid)}`;
		} else {
			const first = data.series[0].points;
			const p = first.reduce((best, q) => (Math.abs(q[0] - x) < Math.abs(best[0] - x) ? q : best));
			text = fmt(p[1]);
		}
		cursor = { left: px, x, text };
	}
	$effect(() => {
		const cv = canvas;
		const data = samples;
		if (!cv) return;
		const dpr = window.devicePixelRatio || 1;
		cv.width = width * dpr;
		cv.height = height * dpr;
		const ctx = cv.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		scale = null;
		if (!data || !data.series.length) return;
		const css = getComputedStyle(cv);
		const col = (v: string) => css.getPropertyValue(v).trim() || '#888';
		const all = data.series.flatMap((s) => s.points);
		const band = data.spread ?? [];
		let x0 = Math.min(...all.map((p) => p[0]), ...band.map((b) => b.x)),
			x1 = Math.max(...all.map((p) => p[0]), ...band.map((b) => b.x));
		let y0 = Math.min(...all.map((p) => p[1]), ...band.map((b) => b.min)),
			y1 = Math.max(...all.map((p) => p[1]), ...band.map((b) => b.max));
		if (x1 - x0 < 1e-6) x1 = x0 + 1;
		if (y1 - y0 < 1e-6) {
			y0 -= 0.5;
			y1 += 0.5;
		}
		const pad = (y1 - y0) * 0.08;
		y0 -= pad;
		y1 += pad;
		scale = { x0, x1, y0, y1 };
		const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (width - PAD.l - PAD.r);
		const sy = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
		ctx.font = `11px ${col('--ox-font-ui')}`;
		ctx.strokeStyle = col('--ox-rule');
		ctx.fillStyle = col('--ox-text-dim');
		ctx.lineWidth = 1;
		for (const y of ticks(y0, y1, 4)) {
			ctx.beginPath();
			ctx.moveTo(PAD.l, Math.round(sy(y)) + 0.5);
			ctx.lineTo(width - PAD.r, Math.round(sy(y)) + 0.5);
			ctx.stroke();
			ctx.fillText(fmt(y), 4, sy(y) + 4);
		}
		for (const x of ticks(x0, x1, 6)) {
			ctx.fillText(`${fmt(x)}s`, sx(x) - 10, height - 8);
		}
		const phase = ref ? col(PHASE_VAR[ref.phase].slice(4, -1)) : col('--ox-lox');
		// every sampled particle's values, as two bands: the whole range, and the middle 80 % of them
		const fill = (top: (b: (typeof band)[number]) => number, bottom: (b: (typeof band)[number]) => number, alpha: number) => {
			if (band.length < 2) return;
			ctx.globalAlpha = alpha;
			ctx.fillStyle = phase;
			ctx.beginPath();
			band.forEach((b, k) => (k ? ctx.lineTo(sx(b.x), sy(top(b))) : ctx.moveTo(sx(b.x), sy(top(b)))));
			for (let k = band.length - 1; k >= 0; k--) ctx.lineTo(sx(band[k].x), sy(bottom(band[k])));
			ctx.closePath();
			ctx.fill();
		};
		fill((b) => b.max, (b) => b.min, 0.1);
		fill((b) => b.hi, (b) => b.lo, 0.14);
		// the others first, so the one nearest the median reads on top
		[...data.series].reverse().forEach((s, k, list) => {
			const main = k === list.length - 1;
			ctx.strokeStyle = phase;
			ctx.globalAlpha = main ? 1 : 0.5;
			ctx.lineWidth = main ? 1.8 : 1;
			ctx.beginPath();
			s.points.forEach(([x, y], j) => (j ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
			ctx.stroke();
		});
		ctx.globalAlpha = 1;
	});

	function ticks(a: number, b: number, n: number): number[] {
		const span = b - a;
		if (!(span > 0)) return [a];
		const step0 = span / n;
		const mag = Math.pow(10, Math.floor(Math.log10(step0)));
		const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
		const out: number[] = [];
		for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
		return out;
	}
	function fmt(v: number) {
		return String(Math.round(v * 1000) / 1000);
	}
</script>

<div class="graph" bind:clientWidth={width}>
	{#if session && ref}
		<header style:--phase={PHASE_VAR[ref.phase]}>
			<span class="phase">{PHASE_NAME[ref.phase]}</span>
			<span class="title">{ref.label}</span>
			{#if target?.kind === 'vector'}
				<span class="axes" role="tablist" aria-label="Axis">
					{#each target.axes as a, i (a.path)}
						<button role="tab" aria-selected={i === pickedAxis} onclick={() => (pickedAxis = i)}>{'XYZW'[i]}</button>
					{/each}
				</span>
			{/if}
			<span class="dim" use:tip={samples?.spread ? `Shaded: the values of all ${samples.total} sampled particles at each age, and darker the middle 80 % of them. Bright line: the particle nearest the median. Thin lines: ${samples.series.length - 1} others, picked to be as unlike it and each other as they come.` : null}>
				over {samples?.axis ?? 'time'}{#if samples && samples.total > 1}, {samples.total} particles{/if}
			</span>
			<button class="btn" use:tip={'Run the effect again with other random numbers'} onclick={() => (seed = Math.floor(Math.random() * 1e6))}>Resample</button>
		</header>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="plot" bind:clientHeight={height} onpointermove={point} onpointerleave={() => (cursor = null)}>
			<canvas bind:this={canvas} style:width="{width}px" style:height="{height}px" aria-label="Values of {ref.label} over {samples?.axis ?? 'time'}"></canvas>
			{#if cursor}
				<div class="cursor" style:left="{cursor.left}px" aria-hidden="true"></div>
				<span class="readout ox-num" class:flip={cursor.left > width - 220} style:left="{cursor.left}px">{fmt(cursor.x)} s<span class="at">{cursor.text}</span></span>
			{/if}
			{#if busy}<span class="busy">Sampling…</span>{/if}
			{#if constant}<p class="empty">{constant.missing ? `Not in the file: the game uses ${constant.value ?? 'nothing'}.` : `A constant: always ${constant.value}.`} Write Molang to see it change over time.</p>
			{:else if !ref.expectsValue}<p class="empty">Statements set variables but have no value of their own; select a field that reads them.</p>
			{:else if samples && !samples.series.length && !busy}<p class="empty">This field didn't produce a number in the sampled time (it may abort, or run only on events).</p>{/if}
		</div>
		{#if samples?.skipped}<p class="note">{samples.skipped} evaluations aborted or returned a string and aren't plotted.</p>{/if}
	{:else}
		<p class="empty">Select a Molang field to plot its real values over time, simulated from the effect itself.</p>
	{/if}
</div>

<style>
	.graph {
		height: 100%;
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 6px 10px;
		border-bottom: 1px solid var(--ox-rule);
		border-left: var(--ox-phase-bar) solid var(--phase);
	}
	.phase {
		color: var(--phase);
		font-weight: 600;
	}
	.dim {
		color: var(--ox-text-dim);
	}
	.btn {
		margin-left: auto;
		border: 1px solid var(--ox-rule-strong);
		background: none;
		border-radius: var(--ox-radius);
		height: 22px;
		padding: 0 8px;
		cursor: pointer;
	}
	.btn:hover {
		background: var(--ox-hover);
	}
	.plot {
		flex: 1;
		min-height: 120px;
		position: relative;
	}
	canvas {
		display: block;
	}
	.cursor {
		position: absolute;
		top: 12px;
		bottom: 26px;
		width: 1px;
		background: var(--ox-rule-strong);
		pointer-events: none;
	}
	.readout {
		position: absolute;
		top: 10px;
		margin-left: 8px;
		padding: 1px 6px;
		border-radius: var(--ox-radius);
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		color: var(--ox-haze);
		font-size: 11.5px;
		white-space: nowrap;
		pointer-events: none;
	}
	.readout.flip {
		margin-left: -8px;
		transform: translateX(-100%);
	}
	.readout .at {
		margin-left: 8px;
		color: var(--ox-frost);
	}
	.busy {
		position: absolute;
		top: 8px;
		right: 12px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.axes {
		display: inline-flex;
		margin-left: 8px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
	}
	.axes button {
		border: none;
		background: none;
		color: var(--ox-haze);
		padding: 0 7px;
		height: 18px;
		cursor: pointer;
	}
	.axes button[aria-selected='true'] {
		color: var(--ox-frost);
		background: var(--ox-selection);
	}
	.empty {
		padding: 14px;
		color: var(--ox-haze);
		max-width: 60ch;
	}
	.note {
		margin: 0 10px 6px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
</style>
