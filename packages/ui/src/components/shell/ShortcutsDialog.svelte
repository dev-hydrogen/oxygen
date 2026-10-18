<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { EDITOR_KEYS } from '../../lib/keys';
	import Chord from './Chord.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const km = $derived(workspace.keymap);

	/** what the mouse does: not rebindable */
	const MOUSE: Record<string, [string, string][]> = {
		Preview: [
			['Click', 'Inspect the particle under the cursor'],
			['Drag', 'Orbit around the particle or ground under the cursor'],
			['Right drag', 'Look around; hold the fly keys to fly'],
			['Middle drag · Shift drag', 'Pan'],
			['Wheel', 'Move toward what is under the cursor'],
		],
		'Molang editors': [
			['Ctrl click', 'Go to where it is set'],
			['Alt click', 'Add a cursor'],
			['Shift Alt drag', 'Column selection'],
		],
		Panels: [['Double-click a tab', 'Maximize the panel (again to restore)']],
	};
	const NOTES: Record<string, string> = { Preview: 'when no text field has focus', Camera: 'held, in the viewport' };

	/** the bound commands by group, in the keymap's order */
	const groups = $derived.by(() => {
		const out = new Map<string, { label: string; keys: string[] }[]>();
		for (const c of km.commands) {
			const keys = km.keys(c.id);
			if (!keys.length) continue;
			const g = c.group === 'Oxygen' ? 'Anywhere' : c.group === 'File' || c.group === 'Edit' ? 'Anywhere' : c.group;
			if (!out.has(g)) out.set(g, []);
			out.get(g)!.push({ label: c.label, keys });
		}
		const editor = out.get('Molang editors') ?? [];
		for (const e of EDITOR_KEYS.slice(0, 5)) editor.push({ label: e.label, keys: [e.keys] });
		out.set('Molang editors', editor);
		for (const g of Object.keys(MOUSE)) if (!out.has(g)) out.set(g, []);
		return [...out.entries()].map(([title, keys]) => ({ title, keys, mouse: MOUSE[title] ?? [] }));
	});

	const close = () => (workspace.shortcutsOpen = false);
	/** mouse words read as text, everything else as a key cap */
	const isKey = (t: string) => !/^(click|Click|drag|Double-click|a|tab)$/.test(t);
</script>

<svelte:window onkeydown={(e) => workspace.shortcutsOpen && e.key === 'Escape' && close()} />

{#if workspace.shortcutsOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={close}></div>
	<div class="dialog" role="dialog" aria-label="Keyboard shortcuts">
		<div class="top">
			<h3>Keyboard shortcuts</h3>
			<button class="customize" onclick={() => workspace.openSettings('keyboard')}>Change keys…</button>
			<button class="x" aria-label="Close" onclick={close}>×</button>
		</div>
		<div class="groups">
			{#each groups as g (g.title)}
				<section>
					<h4>{g.title}{#if NOTES[g.title]}<span class="note">{NOTES[g.title]}</span>{/if}</h4>
					<dl>
						{#each g.keys as k (k.label)}
							<dt>{#each k.keys as chord, i (chord)}{#if i}<span class="or">or</span>{/if}<Chord {chord} mac={km.mac} />{/each}</dt>
							<dd>{k.label}</dd>
						{/each}
						{#each g.mouse as [k, what] (k)}
							<dt>{#each k.split(' · ') as alt, i (i)}{#if i}<span class="or">or</span>{/if}{#each alt.split(' ') as part, j (j)}{#if isKey(part)}<kbd>{part}</kbd>{:else}<span class="mouse">{part}</span>{/if}{/each}{/each}</dt>
							<dd>{what}</dd>
						{/each}
					</dl>
				</section>
			{/each}
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
		top: 70px;
		left: 50%;
		transform: translateX(-50%);
		width: min(760px, calc(100vw - 32px));
		max-height: calc(100vh - 110px);
		overflow: auto;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		padding: 14px 18px 18px;
	}
	.top {
		display: flex;
		align-items: center;
		margin-bottom: 10px;
	}
	h3 {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
	}
	.customize {
		margin-left: auto;
		margin-right: 8px;
		height: 24px;
		padding: 0 10px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
	}
	.customize:hover {
		color: var(--ox-frost);
		background: var(--ox-hover);
	}
	.x {
		border: none;
		background: none;
		color: var(--ox-haze);
		font-size: 16px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ox-frost);
	}
	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 14px 28px;
	}
	h4 {
		margin: 0 0 6px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ox-haze);
	}
	.note {
		margin-left: 8px;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
		color: var(--ox-text-dim);
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 5px 12px;
		align-items: baseline;
	}
	dt {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		align-items: baseline;
		justify-content: flex-end;
		white-space: nowrap;
	}
	dd {
		margin: 0;
		color: var(--ox-frost);
	}
	kbd {
		font-family: var(--ox-font-ui);
		font-size: 11px;
		padding: 0 5px;
		border: 1px solid var(--ox-rule-strong);
		border-bottom-width: 2px;
		border-radius: 3px;
		background: var(--ox-raised);
		color: var(--ox-frost);
		line-height: 17px;
	}
	.mouse {
		color: var(--ox-haze);
		font-size: 11.5px;
	}
	.or {
		color: var(--ox-text-dim);
		font-size: 11px;
		margin: 0 2px;
	}
</style>
