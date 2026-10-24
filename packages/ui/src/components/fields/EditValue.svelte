<script lang="ts">
	import type { Value } from 'molangjs';
	import ScrubNumber from './ScrubNumber.svelte';

	/** A value the Debug panel shows and lets you change: drag or type a number, type a string */
	interface Props {
		value: Value;
		label: string;
		onchange: (value: Value) => void;
		/** read-only (mid-step, or not a plain value) */
		disabled?: boolean;
		step?: number;
		/** how it reads when it can't be changed */
		text: string;
	}

	let { value, label, onchange, disabled = false, step = 0.1, text }: Props = $props();
</script>

{#if disabled || (typeof value !== 'number' && typeof value !== 'string')}
	<span class="ro">{text}</span>
{:else if typeof value === 'number'}
	<span class="edit"><ScrubNumber {label} {step} value={Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : 0} onchange={(n) => n !== null && onchange(n)} /></span>
{:else}
	<input class="edit text ox-code" aria-label={label} {value} onchange={(e) => onchange(e.currentTarget.value)} />
{/if}

<style>
	.edit {
		display: block;
		min-width: 60px;
		max-width: 140px;
	}
	/* looks like the value it is until it's pointed at */
	.edit :global(.scrub),
	.text {
		height: 18px;
		background: none;
		padding: 0 4px;
		margin-left: -4px;
	}
	.edit:hover :global(.scrub),
	.text:hover {
		background: var(--ox-input-hover);
	}
	.edit :global(.steps) {
		display: none !important;
	}
	.text {
		width: 100%;
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
		color: inherit;
		font: inherit;
	}
	.text:focus {
		border-color: var(--ox-lox);
		background: var(--ox-input);
	}
</style>
