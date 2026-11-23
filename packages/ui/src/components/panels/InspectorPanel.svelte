<script lang="ts">
	import type { Category } from '@oxygen/format';
	import type { Workspace } from '../../state/workspace.svelte';
	import Inspector from '../inspector/Inspector.svelte';

	interface Props {
		workspace: Workspace;
		/** one category alone, in a panel of its own (the Inspector then leaves it out) */
		category?: Category;
	}

	let { workspace, category }: Props = $props();
	const session = $derived(workspace.active);
</script>

{#if session}
	{#key session.id}
		<Inspector {workspace} {session} only={category} />
	{/key}
{:else}
	<div class="empty">
		<p>No effect open.</p>
		<button onclick={() => workspace.newEffect()}>New effect</button>
	</div>
{/if}

<style>
	.empty {
		padding: 24px 16px;
		color: var(--ox-haze);
	}
	button {
		background: var(--ox-lox);
		color: #10131c;
		border: none;
		border-radius: var(--ox-radius);
		height: 26px;
		padding: 0 12px;
		font-weight: 600;
		cursor: pointer;
	}
</style>
