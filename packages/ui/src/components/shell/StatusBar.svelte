<script lang="ts">
	import { untrack } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';

	interface Props {
		workspace: Workspace;
		onproblems?: () => void;
	}

	let { workspace, onproblems }: Props = $props();
	const s = $derived(workspace.active);
	const u = $derived(workspace.update);
	const counts = $derived.by(() => {
		const all = s?.problems ?? [];
		return { error: all.filter((p) => p.severity === 'error').length, warning: all.filter((p) => p.severity === 'warning').length };
	});

	let notice = $state<string | null>(null);
	let noticeKind = $state<'info' | 'error'>('info');
	let timer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const n = workspace.notice;
		if (!n) return;
		notice = n.text;
		noticeKind = n.kind;
		clearTimeout(timer);
		timer = setTimeout(() => (notice = null), untrack(() => workspace.prefs.noticeSeconds) * 1000);
	});
</script>

<footer class="status ox-num">
	{#if s}
		<button class="item problems" onclick={onproblems} title="Show problems">
			<span class="dot error"></span>{counts.error}
			<span class="dot warning"></span>{counts.warning}
		</button>
		<span class="item" class:warn={s.stats.capHit}>{s.stats.particles.toLocaleString()} / {s.stats.cap.toLocaleString()} particles</span>
		<span class="item dim">{s.stats.emitters} emitter{s.stats.emitters === 1 ? '' : 's'}</span>
		{#if (s.stats.threads ?? 1) > 1}<span class="item dim" title="Independent emitters run on {s.stats.threads} threads; pausing or inspecting brings them back to one">{s.stats.threads} threads</span>{/if}
		<span class="item dim">{s.stats.time.toFixed(1)} s</span>
		{#if s.scenario}
			<span class="item hatched" title="A scenario supplies variables the game won't have unless your entity or script does">Scenario: {s.scenario.name}</span>
		{/if}
	{/if}
	<span class="spacer"></span>
	{#if notice}<span class="item notice" class:error={noticeKind === 'error'} role="status">{notice}</span>{/if}
	{#if u.state === 'available' && u.page}
		<a class="item update" href={u.page} target="_blank" rel="noreferrer" title="This copy can't install updates itself: the release page has the download">Oxygen {u.version} is out: download it</a>
	{:else if u.state === 'available'}
		<button class="item update" title="Download it now; it installs when Oxygen restarts" onclick={() => workspace.host.updates?.download?.()}>Oxygen {u.version} is out: download</button>
	{:else if u.state === 'downloading'}
		<span class="item dim" title="It installs when Oxygen restarts">Downloading Oxygen {u.version} · {u.percent}%</span>
	{:else if u.state === 'ready'}
		<button class="item update" title={workspace.host.kind === 'web' ? 'A newer Oxygen was published. Reload to use it.' : 'Restart Oxygen to install it, or it installs when you next quit'} onclick={() => workspace.installUpdate()}>
			{workspace.host.kind === 'web' ? (u.version ? `Oxygen ${u.version} is out: reload` : 'Oxygen was updated: reload') : `Restart to update to ${u.version}`}
		</button>
	{/if}
</footer>

<style>
	.status {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 24px;
		padding: 0 6px;
		background: var(--ox-bg);
		border-top: 1px solid var(--ox-rule);
		color: var(--ox-frost);
		font-size: 12px;
		flex: none;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 100%;
		white-space: nowrap;
	}
	.problems {
		border: none;
		background: none;
		cursor: pointer;
		gap: 4px;
	}
	.problems:hover {
		background: var(--ox-hover);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		margin-left: 4px;
	}
	.dot.error {
		background: var(--ox-error);
	}
	.dot.warning {
		background: var(--ox-warning);
	}
	.dim {
		color: var(--ox-haze);
	}
	.warn {
		color: var(--ox-warning);
	}
	.hatched {
		background: var(--ox-hatch);
		color: var(--ox-lox);
	}
	.spacer {
		flex: 1;
	}
	.notice {
		color: var(--ox-frost);
	}
	.update {
		border: none;
		background: rgba(147, 189, 245, 0.16);
		color: var(--ox-lox);
		text-decoration: none;
		cursor: pointer;
		font-weight: 500;
	}
	.update:hover {
		background: rgba(147, 189, 245, 0.26);
	}
	.notice.error {
		color: var(--ox-error);
	}
</style>
