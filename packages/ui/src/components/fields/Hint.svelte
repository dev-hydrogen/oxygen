<script lang="ts">
	import { isPinned, onPinChange, tip as tipAction, togglePinned, type TipContent } from '../../lib/tip';

	/** A "?" beside a label: rest on it for the explanation, click to keep it open (with its Documentation link) */
	interface Props {
		text: string;
		/** the file and key that hold the state, when the game reads it */
		where?: string;
		/** the Documentation section with the mechanics */
		doc?: string;
		/** what it explains, for screen readers ("About bind_to_actor") */
		label?: string;
	}

	let { text, where, doc, label = 'More about this' }: Props = $props();
	let el = $state<HTMLButtonElement>();
	let open = $state(false);
	const content = $derived<TipContent>({ text, where, doc });

	$effect(() => onPinChange(() => (open = isPinned(el))));
</script>

<button bind:this={el} type="button" class="hint" class:open aria-label={label} aria-expanded={open} use:tipAction={content} onclick={(e) => { e.stopPropagation(); if (el) togglePinned(el, content); }}>?</button>

<style>
	.hint {
		flex: none;
		width: 14px;
		height: 14px;
		padding: 0;
		border: 1px solid var(--ox-rule-strong);
		border-radius: 50%;
		background: none;
		color: var(--ox-text-dim);
		font-size: 9.5px;
		font-weight: 600;
		line-height: 12px;
		text-align: center;
		cursor: help;
		vertical-align: middle;
	}
	.hint:hover,
	.hint.open {
		border-color: var(--ox-lox);
		color: var(--ox-lox);
	}
	.hint.open {
		background: var(--ox-selection);
	}
</style>
