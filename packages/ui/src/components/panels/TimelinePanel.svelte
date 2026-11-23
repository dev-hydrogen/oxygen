<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import type { TimelineLane } from '../../state/timeline';
	import { joinPath } from '../../lib/molang-text';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let width = $state(800);
	let hoverX = $state<number | null>(null);

	const GUTTER = 168;
	const AXIS = 22;
	const COUNT_H = 46;
	const LANE_H = 20;
	/** effects with more instances than this share one lane */
	const SPREAD = 4;

	interface Row {
		key: string;
		label: string;
		title: string;
		effect: string;
		lanes: TimelineLane[];
		grouped: boolean;
	}

	const data = $derived.by(() => {
		const s = session;
		if (!s) return null;
		void s.timelineVersion;
		const rec = s.timeline;
		const times = rec.times;
		if (!times.length) return null;
		// the recorder mutates its lanes in place: give the template fresh copies so it sees the news
		const all = [...rec.lanes.values()].map((l) => ({ ...l, active: l.active.map((a) => [a[0], a[1]] as [number, number]), events: l.events.slice() }));
		let t0 = times[0];
		for (const l of all) if (l.start < t0) t0 = l.start;
		const t1 = Math.max(times[times.length - 1], t0 + 1);
		const plotW = Math.max(40, width - GUTTER - 12);
		const x = (t: number) => GUTTER + ((t - t0) / (t1 - t0)) * plotW;
		// particle count, the highest per pixel column
		const cols = new Float32Array(Math.ceil(plotW) + 1);
		let max = 1;
		for (let i = 0; i < times.length; i++) {
			const c = Math.min(cols.length - 1, Math.max(0, Math.round(x(times[i]) - GUTTER)));
			if (rec.counts[i] > cols[c]) cols[c] = rec.counts[i];
			if (rec.counts[i] > max) max = rec.counts[i];
		}
		let area = `M${GUTTER},${AXIS + COUNT_H}`;
		let last = 0;
		for (let c = 0; c < cols.length; c++) {
			// columns without a sample keep the previous height (frames are wider than a pixel when zoomed out)
			if (cols[c] > 0 || c === 0) last = cols[c];
			area += ` L${GUTTER + c},${AXIS + COUNT_H - (last / max) * (COUNT_H - 6)}`;
		}
		area += ` L${GUTTER + cols.length - 1},${AXIS + COUNT_H} Z`;
		// lanes: by effect in order of appearance; crowded effects share a lane
		const byEffect = new Map<string, TimelineLane[]>();
		for (const l of all.sort((a, b) => a.start - b.start || a.id - b.id)) {
			let g = byEffect.get(l.effect);
			if (!g) byEffect.set(l.effect, (g = []));
			g.push(l);
		}
		const rows: Row[] = [];
		for (const [effect, lanes] of byEffect) {
			if (lanes.length > SPREAD) rows.push({ key: effect, label: `${effect} ×${lanes.length}`, title: `${lanes.length} emitters of ${effect}`, effect, lanes, grouped: true });
			else for (const l of lanes) rows.push({ key: `${l.id}`, label: lanes.length > 1 ? `${effect} #${l.id}` : effect, title: `${effect}, emitter ${l.id}`, effect, lanes: [l], grouped: false });
		}
		// grouped lanes: how many are alive per pixel column
		const live = new Map<string, { path: string; max: number }>();
		for (const r of rows) {
			if (!r.grouped) continue;
			const n = new Int32Array(Math.ceil(plotW) + 1);
			for (const l of r.lanes) {
				const a = Math.max(0, Math.floor(x(l.start) - GUTTER));
				const b = Math.min(n.length - 1, Math.ceil(x(l.end ?? t1) - GUTTER));
				for (let c = a; c <= b; c++) n[c]++;
			}
			let m = 1;
			for (const v of n) if (v > m) m = v;
			live.set(r.key, { path: [...n].map((v, c) => `${c ? 'L' : 'M'}${GUTTER + c},${-(v / m) * (LANE_H - 6)}`).join(' '), max: m });
		}
		const step = niceStep((t1 - t0) / Math.max(1, plotW / 90));
		const ticks: number[] = [];
		for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) ticks.push(t);
		return { t0, t1, x, plotW, area, max, rows, live, ticks, step, height: AXIS + COUNT_H + 8 + rows.length * LANE_H + 8 };
	});

	function niceStep(raw: number): number {
		const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-3))));
		for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
		return 10 * p;
	}
	/** lane labels fit the gutter: drop the namespace first, then cut */
	function fit(label: string): string {
		if (label.length <= 25) return label;
		const bare = label.replace(/^[^:]+:/, '');
		return bare.length <= 25 ? bare : `${bare.slice(0, 24)}…`;
	}
	const fmt = (t: number, step: number) => `${t.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)} s`;

	const range = $derived(session?.historyRange ?? { from: 0, to: 0 });
	const now = $derived.by(() => {
		void session?.timelineVersion;
		return session?.stats.time ?? 0;
	});

	function timeAt(px: number): number | null {
		const d = data;
		if (!d) return null;
		const t = d.t0 + ((px - GUTTER) / d.plotW) * (d.t1 - d.t0);
		return Math.min(d.t1, Math.max(d.t0, t));
	}
	function scrub(px: number) {
		const t = timeAt(px);
		if (t === null || !session || range.to <= range.from) return;
		session.scrubTo(Math.min(range.to, Math.max(range.from, t)));
	}
	let dragging = false;
	function down(e: PointerEvent) {
		const px = e.offsetX;
		if (px < GUTTER) return;
		dragging = true;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		scrub(px);
	}
	let raf = 0;
	function move(e: PointerEvent) {
		hoverX = e.offsetX >= GUTTER ? e.offsetX : null;
		if (!dragging) return;
		const px = e.offsetX;
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(() => scrub(px));
	}

	/** what the cursor is over: time, particle count then, events within a few pixels */
	const hover = $derived.by(() => {
		const d = data;
		const s = session;
		if (!d || !s || hoverX === null) return null;
		const t = timeAt(hoverX)!;
		const times = s.timeline.times;
		let lo = 0;
		let hi = times.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (times[mid] < t) lo = mid + 1;
			else hi = mid;
		}
		const tol = ((d.t1 - d.t0) / d.plotW) * 3;
		const names = new Map<string, number>();
		for (const r of d.rows) for (const l of r.lanes) for (const ev of l.events) if (Math.abs(ev.t - t) <= tol) names.set(`${ev.name}`, (names.get(ev.name) ?? 0) + 1);
		return { t, count: s.timeline.counts[lo] ?? 0, events: [...names].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)) };
	});

	function openEvent(effect: string, name: string) {
		if (!session || effect !== session.def?.identifier) return;
		session.selected = joinPath('particle_effect/events', name);
		workspace.show('events');
	}
</script>

<div class="timeline" bind:clientWidth={width}>
	{#if session && data}
		<div class="bar">
			<span class="legend"><i class="sw active"></i>active <i class="sw life"></i>alive, not spawning <i class="sw ev"></i>event</span>
			{#if hover}
				<span class="readout ox-num">{fmt(hover.t, data.step / 10)} · {hover.count.toLocaleString()} particles{hover.events.length ? ` · ${hover.events.join(', ')}` : ''}</span>
			{:else}
				<span class="readout dim">{range.to > range.from ? 'Click or drag in the shaded span to go back in time.' : 'History is kept while the scene runs on one thread.'}</span>
			{/if}
			{#if !session.playing}<button class="btn" onclick={() => (session.playing = true)}>Play from here</button>{/if}
		</div>
		<svg
			width={width}
			height={data.height}
			role="slider"
			tabindex="0"
			aria-label="Timeline"
			aria-valuemin={data.t0}
			aria-valuemax={data.t1}
			aria-valuenow={now}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={() => (dragging = false)}
			onpointerleave={() => (hoverX = null)}
			onkeydown={(e) => {
				if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
					e.preventDefault();
					const t = Math.min(range.to, Math.max(range.from, now + (e.key === 'ArrowLeft' ? -1 : 1) / 60));
					if (range.to > range.from) session.scrubTo(t);
				}
			}}
		>
			<!-- the span that can be scrubbed -->
			{#if range.to > range.from}
				<rect class="scrubbable" x={data.x(Math.max(range.from, data.t0))} y={AXIS - 4} width={Math.max(1, data.x(range.to) - data.x(Math.max(range.from, data.t0)))} height={data.height - AXIS + 4} />
			{/if}
			<!-- axis -->
			{#each data.ticks as t (t)}
				<line class="grid" x1={data.x(t)} x2={data.x(t)} y1={AXIS - 4} y2={data.height} />
				<text class="tick ox-num" x={data.x(t) + 3} y="13">{fmt(t, data.step)}</text>
			{/each}
			<!-- particle count -->
			<text class="rowlabel" x="10" y={AXIS + 16}>Particles</text>
			<text class="rowsub ox-num" x="10" y={AXIS + 31}>peak {data.max.toLocaleString()}</text>
			<path class="count" d={data.area} />
			{#if session.stats.cap && data.max > session.stats.cap * 0.8}
				<line class="cap" x1={GUTTER} x2={GUTTER + data.plotW} y1={AXIS + COUNT_H - (session.stats.cap / data.max) * (COUNT_H - 6)} y2={AXIS + COUNT_H - (session.stats.cap / data.max) * (COUNT_H - 6)}>
					<title>Live particle cap ({session.stats.cap.toLocaleString()})</title>
				</line>
			{/if}
			<!-- emitters -->
			{#each data.rows as r, i (r.key)}
				{@const y = AXIS + COUNT_H + 8 + i * LANE_H}
				<g transform="translate(0,{y})">
					<line class="sep" x1="0" x2={width} y1="0" y2="0" />
					<text class="lanelabel" x="10" y="14"><title>{r.title}</title>{fit(r.label)}</text>
					{#if r.grouped}
						<path class="livecount" d={data.live.get(r.key)?.path} transform="translate(0,{LANE_H - 3})">
							<title>Up to {data.live.get(r.key)?.max} of them alive at once</title>
						</path>
					{:else}
						{@const l = r.lanes[0]}
						<rect class="life" x={data.x(l.start)} y="8" width={Math.max(1, data.x(l.end ?? data.t1) - data.x(l.start))} height="4" />
						{#each l.active as s, k (k)}
							<rect class="active" x={data.x(s[0])} y="6" width={Math.max(2, data.x(s[1]) - data.x(s[0]))} height="8" />
						{/each}
					{/if}
					{#each r.lanes as l (l.id)}
						{#each l.events as ev, k (k)}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<rect class="ev" class:particle={ev.particle} x={data.x(ev.t) - 1.5} y="2" width="3" height="16" onpointerdown={(e) => e.stopPropagation()} onclick={() => openEvent(l.effect, ev.name)}>
								<title>{ev.name} at {fmt(ev.t, 0.01)}{ev.particle ? ' (fired by a particle)' : ''}</title>
							</rect>
						{/each}
					{/each}
				</g>
			{/each}
			<!-- now -->
			<line class="now" x1={data.x(now)} x2={data.x(now)} y1={AXIS - 4} y2={data.height} />
			{#if hoverX !== null}<line class="hover" x1={hoverX} x2={hoverX} y1={AXIS - 4} y2={data.height} />{/if}
		</svg>
	{:else if session}
		<p class="empty">Nothing recorded yet: play the effect.</p>
	{:else}
		<p class="empty">No effect open.</p>
	{/if}
</div>

<style>
	.timeline {
		height: 100%;
		overflow: auto;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 5px 10px;
		border-bottom: 1px solid var(--ox-rule);
		min-height: 22px;
	}
	.legend {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--ox-text-dim);
		font-size: 11px;
		flex: none;
	}
	.sw {
		display: inline-block;
		width: 12px;
		height: 6px;
		border-radius: 1px;
		margin-left: 6px;
	}
	.sw.active {
		background: var(--ox-lox);
	}
	.sw.life {
		height: 3px;
		background: var(--ox-rule-strong);
	}
	.sw.ev {
		width: 2px;
		height: 10px;
		background: var(--ox-frost);
	}
	.readout {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ox-frost);
	}
	.readout.dim {
		color: var(--ox-text-dim);
	}
	.btn {
		flex: none;
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
	svg {
		display: block;
		font-family: var(--ox-font-ui);
		outline: none;
		cursor: crosshair;
		user-select: none;
	}
	.scrubbable {
		fill: var(--ox-lox);
		opacity: 0.06;
	}
	.grid {
		stroke: var(--ox-rule);
	}
	.tick {
		fill: var(--ox-text-dim);
		font-size: 10.5px;
	}
	.rowlabel,
	.lanelabel {
		fill: var(--ox-haze);
		font-size: 11.5px;
	}
	.rowsub {
		fill: var(--ox-text-dim);
		font-size: 10.5px;
	}
	.count {
		fill: var(--ox-lox);
		fill-opacity: 0.22;
		stroke: var(--ox-lox);
		stroke-width: 1;
	}
	.cap {
		stroke: var(--ox-warning);
		stroke-dasharray: 4 3;
	}
	.sep {
		stroke: var(--ox-rule);
		opacity: 0.6;
	}
	.life {
		fill: var(--ox-rule-strong);
	}
	.active {
		fill: var(--ox-lox);
		opacity: 0.85;
	}
	.livecount {
		fill: none;
		stroke: var(--ox-lox);
		stroke-width: 1.2;
	}
	.ev {
		fill: var(--ox-frost);
		stroke: var(--ox-bg);
		stroke-width: 0.75;
		cursor: pointer;
	}
	.ev.particle {
		fill: var(--ox-haze);
	}
	.now {
		stroke: var(--ox-frost);
		stroke-width: 1.5;
	}
	.hover {
		stroke: var(--ox-haze);
		stroke-dasharray: 2 3;
	}
	.empty {
		padding: 16px;
		color: var(--ox-haze);
		max-width: 60ch;
	}
</style>
