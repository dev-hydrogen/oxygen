<script lang="ts">
	import type { FieldRef, FieldPhase } from '@oxygen/effect';
	import type { Workspace } from '../../state/workspace.svelte';
	import { PHASE_NAME, PHASE_VAR } from '../../lib/molang-text';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let width = $state(800);
	let hover = $state<string | null>(null);

	const COLS: FieldPhase[] = ['setup', 'emitter', 'spawn', 'particle', 'render', 'event'];
	const ROW = 26;
	const HEAD = 34;

	const layout = $derived.by(() => {
		const s = session;
		if (!s) return null;
		void s.version;
		const fields = s.analysis.fields.filter((f) => f.analysis && (f.analysis.reads.length || f.analysis.writes.length || f.phase !== 'event'));
		const cols = COLS.filter((c) => fields.some((f) => f.phase === c));
		const colW = Math.max(150, (width - 20) / Math.max(1, cols.length));
		const pos = new Map<string, { x: number; y: number; f: FieldRef; step: number }>();
		let step = 0;
		const counts = new Map<string, number>();
		for (const f of fields) {
			const ci = cols.indexOf(f.phase);
			const row = counts.get(f.phase) ?? 0;
			counts.set(f.phase, row + 1);
			if (f.rank !== Infinity) step++;
			pos.set(f.path, { x: 10 + ci * colW, y: HEAD + row * ROW, f, step: f.rank === Infinity ? 0 : step });
		}
		// data flow: every writer → every reader of the same variable
		type Edge = { from: string; to: string; name: string; late: boolean };
		const edges: Edge[] = [];
		for (const v of s.analysis.variables) {
			if (v.builtin) continue;
			for (const r of v.reads) {
				const rp = pos.get(r.path);
				if (!rp) continue;
				for (const w of v.writes) {
					// a curve writes its variable; draw that from the curve's input node
					const wp = pos.get(w.path) ?? pos.get(`${w.path}/input`);
					if (!wp || w.path === r.path) continue;
					edges.push({ from: wp.f.path, to: r.path, name: v.name.replace(/^variable\./, 'v.'), late: wp.f.rank > rp.f.rank });
				}
			}
		}
		const unset = new Set(s.analysis.problems.filter((p) => p.code === 'never-set' || p.code === 'read-before-write').map((p) => p.path));
		const height = HEAD + Math.max(...cols.map((c) => counts.get(c) ?? 0), 1) * ROW + 16;
		return { cols, colW, pos, edges, height, unset };
	});

	function path(a: { x: number; y: number }, b: { x: number; y: number }, colW: number): string {
		const x1 = a.x + colW - 18,
			y1 = a.y + 10,
			x2 = b.x + 2,
			y2 = b.y + 10;
		if (x2 > x1) {
			const dx = Math.max(30, (x2 - x1) / 2);
			return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
		}
		// same column or backwards (read on the next frame): loop out to the right
		const loop = 26 + Math.abs(y2 - y1) * 0.08;
		return `M${x1},${y1} C${x1 + loop},${y1} ${x1 + loop},${y2} ${b.x + colW - 18},${y2}`;
	}

	const related = (e: { from: string; to: string }) => !hover || e.from === hover || e.to === hover;
</script>

<div class="pipeline" bind:clientWidth={width}>
	{#if session && layout}
		<p class="intro"><span class="key solid"></span>set, then read <span class="key dashed"></span>read before its first write</p>
		<svg width={width} height={layout.height} role="img" aria-label="Evaluation pipeline">
			{#each layout.cols as c, i (c)}
				<g style:--phase={PHASE_VAR[c]}>
					<text class="head" x={10 + i * layout.colW} y="18">{PHASE_NAME[c]}</text>
					<line class="headline" x1={10 + i * layout.colW} x2={10 + (i + 1) * layout.colW - 18} y1="24" y2="24" />
				</g>
			{/each}
			{#each layout.edges as e, i (i)}
				{@const a = layout.pos.get(e.from)!}
				{@const b = layout.pos.get(e.to)!}
				<path
					class="edge"
					class:late={e.late}
					class:dim={!related(e)}
					style:--phase={PHASE_VAR[a.f.phase]}
					d={path(a, b, layout.colW)}
				>
					<title>{e.name}: {a.f.label} → {b.f.label}{e.late ? ' (read before it is set on the first frame)' : ''}</title>
				</path>
			{/each}
			{#each [...layout.pos.values()] as n (n.f.path)}
				<g
					class="node"
					class:sel={session.selected === n.f.path}
					class:bad={layout.unset.has(n.f.path)}
					style:--phase={PHASE_VAR[n.f.phase]}
					transform="translate({n.x},{n.y})"
					role="button"
					tabindex="0"
					aria-label="{n.f.label}, step {n.step}"
					onmouseenter={() => (hover = n.f.path)}
					onmouseleave={() => (hover = null)}
					onclick={() => {
						session.selected = n.f.path;
						workspace.show('expression');
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							session.selected = n.f.path;
							workspace.show('expression');
						}
					}}
				>
					<rect width={layout.colW - 20} height="20" rx="3" />
					<rect class="bar" width="2" height="20" />
					<text x="8" y="14" class="label">{n.f.label.length > (layout.colW - 50) / 6.4 ? n.f.label.slice(0, Math.floor((layout.colW - 50) / 6.4)) + '…' : n.f.label}</text>
					{#if n.step}<text x={layout.colW - 26} y="14" class="step" text-anchor="end">{n.step}</text>{/if}
				</g>
			{/each}
		</svg>
	{:else}
		<p class="intro">No effect open.</p>
	{/if}
</div>

<style>
	.pipeline {
		height: 100%;
		overflow: auto;
	}
	.intro {
		margin: 8px 10px 0;
		color: var(--ox-text-dim);
		font-size: 11.5px;
		max-width: 80ch;
	}
	svg {
		display: block;
		font-family: var(--ox-font-ui);
	}
	.head {
		fill: var(--phase);
		font-weight: 600;
		font-size: 12px;
	}
	.headline {
		stroke: var(--phase);
		stroke-width: 1;
		opacity: 0.5;
	}
	.key {
		display: inline-block;
		width: 22px;
		margin: 0 6px 3px 0;
		border-top: 1.5px solid var(--ox-haze);
		vertical-align: middle;
	}
	.key.dashed {
		margin-left: 14px;
		border-top-style: dashed;
	}
	.edge {
		fill: none;
		stroke: var(--phase);
		stroke-width: 1.2;
		opacity: 0.55;
		transition: opacity 0.1s;
	}
	.edge.late {
		stroke: var(--ox-error);
		stroke-dasharray: 3 3;
	}
	.edge.dim {
		opacity: 0.08;
	}
	.node {
		cursor: pointer;
		outline: none;
	}
	.node rect {
		fill: var(--ox-raised);
		stroke: var(--ox-rule-strong);
	}
	.node .bar {
		fill: var(--phase);
		stroke: none;
	}
	.node:hover rect:not(.bar),
	.node:focus-visible rect:not(.bar) {
		stroke: var(--ox-frost);
	}
	.node.sel rect:not(.bar) {
		stroke: var(--ox-lox);
		fill: var(--ox-selection);
	}
	.node.bad rect:not(.bar) {
		stroke: var(--ox-error);
	}
	.label {
		fill: var(--ox-frost);
		font-size: 11.5px;
	}
	.step {
		fill: var(--ox-text-dim);
		font-size: 10.5px;
	}
</style>
