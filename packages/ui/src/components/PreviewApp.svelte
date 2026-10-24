<script lang="ts">
	import type { Workspace } from '../state/workspace.svelte';
	import Viewport from './panels/Viewport.svelte';
	import { handleKey } from '../lib/keyboard';
	import ContextMenu from './shell/ContextMenu.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	// the preview's own keys (play, restart, frame…); the rest belong to the editor beside it
	const onKey = (e: KeyboardEvent) => handleKey(workspace, e, (id) => id.startsWith('preview.'));
	const s = $derived(workspace.active);
	const errors = $derived(s ? s.problems.filter((p) => p.severity === 'error') : []);
</script>

<svelte:window onkeydown={onKey} />

<!-- Preview only: the viewport for a file edited elsewhere (VS Code text editor) -->
<div class="ox-root preview">
	<div class="view"><Viewport {workspace} /></div>
	{#if s}
		<footer class="ox-num">
			<span class="name">{s.identifier}</span>
			{#if errors.length}<span class="err" title={errors.map((e) => e.message).join('\n')}>{errors.length} error{errors.length === 1 ? '' : 's'}</span>{/if}
		</footer>
	{/if}
</div>
<ContextMenu />

<style>
	.preview {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--ox-bg);
	}
	.view {
		flex: 1;
		min-height: 0;
	}
	footer {
		display: flex;
		gap: 10px;
		align-items: center;
		height: 22px;
		padding: 0 8px;
		border-top: 1px solid var(--ox-rule);
		font-size: 12px;
		color: var(--ox-haze);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.err {
		color: var(--ox-error);
		margin-left: auto;
	}
</style>
