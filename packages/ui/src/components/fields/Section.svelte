<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A titled part of a panel that folds away, so a long panel shows only what's being worked on */
	interface Props {
		title: string;
		open: boolean;
		ontoggle: () => void;
		/** how much is inside, shown when there is something (blocks placed, effects added) */
		count?: number | string;
		/** beside the title: a hint, a button */
		aside?: Snippet;
		children: Snippet;
	}

	let { title, open, ontoggle, count, aside, children }: Props = $props();
</script>

<section class:open aria-label={title}>
	<header>
		<h3>
			<button class="fold" aria-expanded={open} onclick={ontoggle}>
				<svg viewBox="0 0 8 8" class:closed={!open} aria-hidden="true"><path d="M1.5 2.5l2.5 3 2.5-3" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
				{title}
				{#if count}<span class="count ox-num">{count}</span>{/if}
			</button>
		</h3>
		{#if aside}{@render aside()}{/if}
	</header>
	{#if open}<div class="body">{@render children()}</div>{/if}
</section>

<style>
	section {
		border-bottom: 1px solid var(--ox-rule);
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 10px 0 4px;
	}
	h3 {
		margin: 0;
		min-width: 0;
		font-size: var(--ox-title-size);
		font-weight: 600;
	}
	.fold {
		display: flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 6px 0 4px;
		border: none;
		border-radius: var(--ox-radius);
		background: none;
		font-weight: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	.fold:hover {
		background: var(--ox-hover);
	}
	section:not(.open) .fold {
		color: var(--ox-haze);
	}
	svg {
		width: 9px;
		height: 9px;
		flex: none;
		color: var(--ox-haze);
		transition: transform 0.12s;
	}
	svg.closed {
		transform: rotate(-90deg);
	}
	.count {
		color: var(--ox-text-dim);
		font-weight: 400;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 0 10px 10px;
	}
</style>
