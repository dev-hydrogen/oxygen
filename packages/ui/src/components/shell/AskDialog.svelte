<script lang="ts">
	import { tick } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';

	/** A question that needs an answer before going on (unsaved changes, a reset), asked in Oxygen's own window */
	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const q = $derived(workspace.question);
	let box = $state<HTMLElement>();

	// the answer Enter gives is the one in front
	$effect(() => {
		if (q) void tick().then(() => (box?.querySelector<HTMLElement>('.primary, .danger') ?? box?.querySelector<HTMLElement>('button'))?.focus());
	});

	function key(e: KeyboardEvent) {
		if (!q) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			q.resolve(null);
		}
	}
</script>

<svelte:window onkeydowncapture={key} />

{#if q}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={() => q.resolve(null)}></div>
	<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ox-ask-title" bind:this={box}>
		<h3 id="ox-ask-title">{q.title}</h3>
		{#if q.message}<p>{q.message}</p>{/if}
		<div class="actions">
			{#each q.actions as a (a.id)}
				<button class={a.kind ?? 'plain'} onclick={() => q.resolve(a.id)}>{a.label}</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 960;
		background: rgba(10, 12, 20, 0.5);
	}
	.dialog {
		position: fixed;
		z-index: 961;
		top: 28%;
		left: 50%;
		transform: translateX(-50%);
		width: min(440px, calc(100vw - 32px));
		padding: 18px 20px 16px;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
	}
	h3 {
		margin: 0;
		font-size: 14.5px;
		font-weight: 600;
		line-height: 20px;
		overflow-wrap: anywhere;
	}
	p {
		margin: 6px 0 0;
		color: var(--ox-haze);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 18px;
	}
	button {
		height: 28px;
		padding: 0 14px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-frost);
		cursor: pointer;
	}
	button:hover {
		background: var(--ox-hover);
	}
	/* stepping back is the quiet one, on the left */
	.quiet {
		margin-right: auto;
		border-color: transparent;
		color: var(--ox-haze);
	}
	.primary {
		background: var(--ox-lox);
		border-color: var(--ox-lox);
		color: #10131c;
		font-weight: 600;
	}
	.primary:hover {
		background: #a6c9f7;
	}
	.danger {
		border-color: var(--ox-error);
		color: var(--ox-error);
	}
</style>
