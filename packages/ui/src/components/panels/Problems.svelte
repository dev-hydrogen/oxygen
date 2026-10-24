<script lang="ts">
	import type { Problem } from '@oxygen/effect';
	import type { Workspace } from '../../state/workspace.svelte';
	import { menu, type MenuItem } from '../../lib/context-menu.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let filter = $state<'all' | 'error' | 'warning'>('all');

	const RANK = { error: 0, warning: 1, info: 2 };
	const problems = $derived.by(() => {
		if (!session) return [];
		void session.version;
		const list = session.problems.filter((p) => filter === 'all' || (filter === 'error' ? p.severity === 'error' : p.severity !== 'info'));
		return [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
	});
	const counts = $derived.by(() => {
		const all = session?.problems ?? [];
		return { error: all.filter((p) => p.severity === 'error').length, warning: all.filter((p) => p.severity === 'warning').length, info: all.filter((p) => p.severity === 'info').length };
	});

	function where(p: Problem): string {
		if (!session || !p.path) return 'File';
		const ref = session.analysis?.byPath.get(p.path);
		if (ref) return ref.label;
		const seg = p.path.split('/');
		const comp = seg.find((s) => s.startsWith('minecraft:'));
		return comp ? comp.replace('minecraft:', '').replace(/_/g, ' ') + (seg.length > 3 ? ` › ${seg.slice(3).join(' ')}` : '') : seg.slice(1).join(' › ') || 'Effect';
	}

	function problemMenu(p: Problem): MenuItem[] {
		return [
			{ label: 'Go to the field', disabled: !p.path, run: () => { if (session) session.selected = p.path || null; workspace.show('inspector'); } },
			{ separator: true },
			{ label: 'Copy the message', run: () => void navigator.clipboard.writeText(p.message) },
			{ label: 'Copy every problem', run: () => void navigator.clipboard.writeText(problems.map((x) => `${x.severity}: ${where(x)}: ${x.message}`).join('\n')) },
		];
	}

	const SOURCE: Record<Problem['source'], string> = { molang: 'Molang', effect: 'Effect', schema: 'Schema', json: 'JSON', runtime: 'Preview', game: 'Game' };
</script>

<div class="problems">
	<div class="toolbar">
		<div class="seg" role="tablist" aria-label="Filter problems">
			<button role="tab" aria-selected={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
			<button role="tab" aria-selected={filter === 'error'} onclick={() => (filter = 'error')}>Errors <span class="n ox-num">{counts.error}</span></button>
			<button role="tab" aria-selected={filter === 'warning'} onclick={() => (filter = 'warning')}>Warnings <span class="n ox-num">{counts.warning}</span></button>
		</div>
		<span class="dim ox-num">{counts.info} notes</span>
	</div>
	<ul class="list">
		{#each problems as p, i (i + p.path + p.message)}
			<li use:menu={() => problemMenu(p)}>
				<button class="item" class:selected={session?.selected === p.path} onclick={() => session && (session.selected = p.path || null)}>
					<span class="sev {p.severity}" aria-label={p.severity}></span>
					<span class="msg">{p.message}</span>
					<span class="where">{where(p)}</span>
					<span class="src">{SOURCE[p.source]}</span>
				</button>
			</li>
		{:else}
			<li class="none">{session ? 'No problems. The game will load this effect cleanly.' : 'No effect open.'}</li>
		{/each}
	</ul>
</div>

<style>
	.problems {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--ox-rule);
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
	.seg button[aria-selected='true'] {
		background: var(--ox-raised);
		color: var(--ox-frost);
	}
	.n {
		color: var(--ox-text-dim);
		margin-left: 2px;
	}
	.dim {
		color: var(--ox-text-dim);
		margin-left: auto;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: auto;
		flex: 1;
	}
	.item {
		display: grid;
		grid-template-columns: 10px 1fr auto auto;
		gap: 8px;
		align-items: baseline;
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		padding: 3px 10px;
		cursor: pointer;
	}
	.item:hover {
		background: var(--ox-hover);
	}
	.item.selected {
		background: var(--ox-selection);
	}
	.sev {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		align-self: center;
	}
	.sev.error {
		background: var(--ox-error);
	}
	.sev.warning {
		background: var(--ox-warning);
	}
	.sev.info {
		background: var(--ox-haze);
	}
	.msg {
		color: var(--ox-frost);
	}
	.where {
		color: var(--ox-haze);
		white-space: nowrap;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.src {
		color: var(--ox-text-dim);
		font-size: 11px;
	}
	.none {
		padding: 10px;
		color: var(--ox-haze);
	}
</style>
