<script lang="ts">
	import type { EffectSession } from '../../state/session.svelte';
	import { sampleField, type FieldSamples } from '../../lib/sampler';
	import { showNumber } from '../../lib/numbers';
	import { afterRelease } from '../../lib/pointer';

	/** A field's real values over time, drawn under it while it's selected (opens the Graph panel on click) */
	interface Props {
		session: EffectSession;
		path: string;
		onexpand?: () => void;
	}

	let { session, path, onexpand }: Props = $props();
	let samples = $state.raw<FieldSamples | null>(null);

	$effect(() => {
		const s = session;
		const p = path;
		void s.version;
		// sampling runs the effect: not while a button is held (a click in a field would see the page stall)
		let cancel = () => {};
		const t = setTimeout(() => (cancel = afterRelease(() => (samples = sampleField(s, p, 6, 1234)))), 200);
		return () => {
			clearTimeout(t);
			cancel();
		};
	});

	const W = 300;
	const H = 44;
	const view = $derived.by(() => {
		const d = samples;
		if (!d || !d.series.length) return null;
		const all = d.series.flatMap((s) => s.points);
		const x0 = Math.min(...all.map((p) => p[0]));
		const x1 = Math.max(...all.map((p) => p[0]), x0 + 1e-6);
		let y0 = Math.min(...all.map((p) => p[1]));
		let y1 = Math.max(...all.map((p) => p[1]));
		const flat = y1 - y0 < 1e-9;
		if (flat) {
			y0 -= 1;
			y1 += 1;
		}
		const sx = (x: number) => ((x - x0) / (x1 - x0)) * W;
		const sy = (y: number) => 3 + (1 - (y - y0) / (y1 - y0)) * (H - 6);
		return {
			lines: d.series.map((s) => s.points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')),
			zero: y0 < 0 && y1 > 0 ? sy(0) : null,
			min: flat ? null : showNumber(Math.min(...all.map((p) => p[1])), 3),
			max: showNumber(Math.max(...all.map((p) => p[1])), 3),
			span: `${showNumber(x1 - x0, 2)} s of ${d.axis}`,
			count: d.series.length,
			skipped: d.skipped,
			flat,
		};
	});
</script>

{#if view}
	<button class="minigraph" title="Values of the first {view.count} {view.count === 1 ? 'series' : 'particles'} over time. Click for the Graph panel." onclick={onexpand}>
		<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
			{#if view.zero !== null}<line class="zero" x1="0" x2={W} y1={view.zero} y2={view.zero} />{/if}
			{#each view.lines as pts, i (i)}<polyline points={pts} style:opacity={i === 0 ? 1 : 0.45} />{/each}
		</svg>
		<span class="max ox-num">{view.flat ? `always ${view.max}` : view.max}</span>
		{#if view.min !== null}<span class="min ox-num">{view.min}</span>{/if}
		<span class="span">{view.span}{view.skipped ? `, ${view.skipped} aborted` : ''}</span>
	</button>
{/if}

<style>
	.minigraph {
		position: relative;
		display: block;
		/* its own line below the field's editors and actions */
		flex: 1 0 100%;
		order: 10;
		width: 100%;
		height: 50px;
		margin-top: 3px;
		padding: 0;
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius);
		background: var(--ox-input);
		cursor: zoom-in;
		overflow: hidden;
	}
	.minigraph:hover {
		border-color: var(--ox-rule-strong);
	}
	svg {
		position: absolute;
		inset: 3px 0;
		width: 100%;
		height: calc(100% - 6px);
	}
	polyline {
		fill: none;
		stroke: var(--phase, var(--ox-lox));
		stroke-width: 1.4;
		vector-effect: non-scaling-stroke;
	}
	.zero {
		stroke: var(--ox-rule-strong);
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}
	span {
		position: absolute;
		font-size: 10.5px;
		line-height: 1;
		color: var(--ox-text-dim);
		pointer-events: none;
		padding: 1px 2px;
		border-radius: 2px;
		background: color-mix(in srgb, var(--ox-input) 80%, transparent);
	}
	.max {
		top: 4px;
		left: 5px;
	}
	.min {
		bottom: 4px;
		left: 5px;
	}
	.span {
		bottom: 4px;
		right: 6px;
	}
</style>
