<script lang="ts">
	import { canonicalVariable, renameVariable } from '@oxygen/effect';
	import { tick } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import { flushEdits } from '../../lib/flush';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	const from = $derived(session?.renameRequest ?? null);
	let value = $state('');
	let input = $state<HTMLInputElement>();

	$effect(() => {
		if (from) {
			value = from.replace(/^variable\./, '');
			void tick().then(() => input?.select());
		}
	});

	const check = $derived.by((): { ok: string } | { error: string } => {
		if (!session || !from) return { error: '' };
		const c = canonicalVariable(value);
		if ('error' in c) return c;
		if (c.name === from) return { error: 'That is the current name.' };
		if (session.analysis.variables.some((v) => v.name === c.name)) return { error: `${c.name.replace(/^variable\./, 'v.')} already exists in this effect; renaming would merge the two.` };
		return { ok: c.name };
	});
	const uses = $derived(session && from ? session.analysis.variables.find((v) => v.name === from) : undefined);

	function close() {
		if (session) session.renameRequest = null;
	}

	function apply() {
		if (!session || !from || !('ok' in check)) return;
		flushEdits();
		const r = renameVariable(session.doc, session.analysis, from, check.ok);
		workspace.say(`Renamed ${from.replace(/^variable\./, 'v.')} to ${check.ok.replace(/^variable\./, 'v.')} in ${r.occurrences} place${r.occurrences === 1 ? '' : 's'}`);
		close();
	}
</script>

{#if session && from}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={close}></div>
	<div class="dialog" role="dialog" aria-label="Rename variable">
		<h3>Rename <span class="ox-code">{from.replace(/^variable\./, 'v.')}</span></h3>
		<p class="dim">{uses ? `Set in ${uses.writes.length} and read in ${uses.reads.length} field${uses.reads.length === 1 ? '' : 's'} of this effect.` : 'Every use in this effect.'}</p>
		<div class="field">
			<span class="prefix ox-code">v.</span>
			<input
				bind:this={input}
				bind:value
				class="ox-code"
				aria-label="New name"
				onkeydown={(e) => {
					if (e.key === 'Enter') apply();
					else if (e.key === 'Escape') close();
				}}
			/>
		</div>
		{#if 'error' in check && check.error}<p class="err">{check.error}</p>{/if}
		<div class="actions">
			<button class="secondary" onclick={close}>Cancel</button>
			<button class="primary" disabled={!('ok' in check)} onclick={apply}>Rename</button>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: rgba(10, 12, 20, 0.35);
	}
	.dialog {
		position: fixed;
		z-index: 901;
		top: 90px;
		left: 50%;
		transform: translateX(-50%);
		width: min(440px, calc(100vw - 32px));
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h3 {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
	}
	p {
		margin: 0;
	}
	.dim {
		color: var(--ox-haze);
		font-size: 12px;
	}
	.field {
		display: flex;
		align-items: center;
		background: var(--ox-input);
		border: 1px solid var(--ox-lox);
		border-radius: var(--ox-radius);
	}
	.prefix {
		padding: 0 0 0 8px;
		color: var(--ox-syn-variable);
	}
	input {
		flex: 1;
		height: 28px;
		border: none;
		background: none;
		outline: none;
		padding: 0 8px 0 1px;
		color: var(--ox-syn-variable);
	}
	.err {
		color: var(--ox-warning);
		font-size: 12px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.primary,
	.secondary {
		height: 26px;
		padding: 0 12px;
		border-radius: var(--ox-radius);
		cursor: pointer;
	}
	.primary {
		background: var(--ox-lox);
		color: #10131c;
		border: none;
		font-weight: 600;
	}
	.primary:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.secondary {
		background: none;
		border: 1px solid var(--ox-rule-strong);
		color: var(--ox-frost);
	}
</style>
