<script lang="ts">
	import type { Problem } from '@oxygen/effect';
	import type { Snippet } from 'svelte';
	import { PHASE_NAME, PHASE_VAR } from '../../lib/molang-text';
	import type { FieldPhase } from '@oxygen/effect';
	import { tip as tipAction } from '../../lib/tip';

	interface Props {
		label: string;
		phase: FieldPhase;
		help?: string;
		/** the key the field writes, as the file names it (`emitter_rate_steady › spawn_rate`) */
		where?: string;
		/** evaluation order (first frame), shown as a small badge */
		order?: number | null;
		problems?: Problem[];
		selected?: boolean;
		/** label sits above the editor (long Molang) */
		stacked?: boolean;
		onselect?: () => void;
		children: Snippet;
		actions?: Snippet;
	}

	let { label, phase, help = '', where, order = null, problems = [], selected = false, stacked = false, onselect, children, actions }: Props = $props();

	const worst = $derived(problems.some((p) => p.severity === 'error') ? 'error' : problems.some((p) => p.severity === 'warning') ? 'warning' : problems.length ? 'info' : null);
	const tip = $derived({ where, text: [help, ...problems.map((p) => p.message)].filter(Boolean).join('\n\n') || (where ? PHASE_NAME[phase] : '') });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="row" class:selected class:stacked style:--phase={PHASE_VAR[phase]} onclick={onselect}>
	<div class="label" use:tipAction={tip}>
		<span class="text">{label}</span>
		{#if worst}<span class="flag {worst}" aria-label="{problems.length} problem{problems.length === 1 ? '' : 's'}"></span>{/if}
		{#if order !== null}<span class="order ox-num" use:tipAction={`${PHASE_NAME[phase]}, step ${order} of the first frame`}>{order}</span>{/if}
	</div>
	<div class="editor">
		{@render children()}
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: minmax(84px, 34%) 1fr;
		align-items: start;
		gap: 6px;
		padding: 2px 8px 2px 10px;
		position: relative;
		min-height: var(--ox-row);
	}
	.row::before {
		content: '';
		position: absolute;
		left: 0;
		top: 2px;
		bottom: 2px;
		width: var(--ox-phase-bar);
		background: var(--phase);
		opacity: 0.55;
	}
	.row:hover::before,
	.row.selected::before {
		opacity: 1;
	}
	.row.selected {
		background: var(--ox-hover);
	}
	.row.stacked {
		grid-template-columns: 1fr;
		gap: 2px;
	}
	.label {
		display: flex;
		align-items: center;
		gap: 5px;
		min-height: 22px;
		color: var(--ox-haze);
		min-width: 0;
	}
	.row:hover .label,
	.row.selected .label {
		color: var(--ox-frost);
	}
	.text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.order {
		margin-left: auto;
		font-size: 10.5px;
		color: var(--ox-text-dim);
		min-width: 14px;
		text-align: right;
	}
	.row:hover .order,
	.row.selected .order {
		color: var(--phase);
	}
	.flag {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex: none;
	}
	.flag.error {
		background: var(--ox-error);
	}
	.flag.warning {
		background: var(--ox-warning);
	}
	.flag.info {
		background: var(--ox-haze);
	}
	.editor {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		min-width: 0;
		align-items: flex-start;
	}
	.actions {
		display: flex;
		gap: 2px;
		flex: none;
	}
</style>
