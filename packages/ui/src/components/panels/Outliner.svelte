<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { joinPath } from '../../lib/molang-text';
	import { closeEffect, closeEffects } from '../../lib/actions';
	import { menu, type MenuItem } from '../../lib/context-menu.svelte';
	import type { EffectSession } from '../../state/session.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);

	const curves = $derived.by(() => {
		void session?.version;
		const c = session?.doc.get('particle_effect/curves');
		return c && typeof c === 'object' ? Object.keys(c as object) : [];
	});
	const events = $derived.by(() => {
		void session?.version;
		const e = session?.doc.get('particle_effect/events');
		return e && typeof e === 'object' ? Object.keys(e as object) : [];
	});

	function addCurve() {
		if (!session) return;
		let n = 1;
		while (curves.includes(`variable.curve_${n}`)) n++;
		session.doc.set(joinPath('particle_effect', 'curves', `variable.curve_${n}`), { type: 'linear', input: 'v.particle_age', horizontal_range: 'v.particle_lifetime', nodes: [0, 1] }, 'Add curve', (keys) => keys.indexOf('components') >= 0 ? keys.indexOf('components') : keys.length);
		session.selected = joinPath('particle_effect', 'curves', `variable.curve_${n}`, 'input');
		workspace.show('curves');
	}

	function effectMenu(s: EffectSession): MenuItem[] {
		const others = workspace.sessions.filter((x) => x !== s).map((x) => x.id);
		return [
			{ label: 'Show', run: () => void (workspace.activeId = s.id) },
			{ separator: true },
			{ label: 'Close', run: () => closeEffect(workspace, s.id) },
			{ label: 'Close others', disabled: !others.length, run: () => closeEffects(workspace, others) },
			{ separator: true },
			{ label: 'Copy identifier', run: () => void navigator.clipboard.writeText(s.identifier) },
		];
	}

	function curveMenu(name: string): MenuItem[] {
		const s = session;
		if (!s) return [];
		const path = joinPath('particle_effect', 'curves', name);
		return [
			{ label: 'Edit in the Curves panel', run: () => { s.selected = joinPath(path, 'input'); workspace.show('curves'); } },
			{ label: 'Find uses', run: () => { s.programFilter = name.replace(/^variable\./, 'v.'); s.referencesRequest = { name, at: Date.now() }; workspace.show('expression'); } },
			{ label: 'Rename everywhere…', run: () => void (s.renameRequest = name) },
			{ separator: true },
			{ label: 'Copy JSON', run: () => void navigator.clipboard.writeText(JSON.stringify(s.doc.get(path), null, '\t')) },
			{ label: 'Remove the curve', danger: true, run: () => s.doc.remove(path, `Remove ${name.replace(/^variable\./, 'v.')}`) },
		];
	}

	function eventMenu(name: string): MenuItem[] {
		const s = session;
		if (!s) return [];
		const path = joinPath('particle_effect', 'events', name);
		return [
			{ label: 'Edit in the Events panel', run: () => { s.selected = joinPath(path, 'expression'); workspace.show('events'); } },
			{ separator: true },
			{ label: 'Copy JSON', run: () => void navigator.clipboard.writeText(JSON.stringify(s.doc.get(path), null, '\t')) },
			{ label: 'Remove the event', danger: true, title: 'Whatever fires it keeps its name', run: () => s.doc.remove(path, `Remove event ${name}`) },
		];
	}

	function addEvent() {
		if (!session) return;
		let n = 1;
		while (events.includes(`event_${n}`)) n++;
		session.doc.set(joinPath('particle_effect', 'events', `event_${n}`), { expression: '' }, 'Add event', (keys) => keys.indexOf('components') >= 0 ? keys.indexOf('components') : keys.length);
		session.selected = joinPath('particle_effect', 'events', `event_${n}`, 'expression');
		workspace.show('events');
	}
</script>

<nav class="outliner" aria-label="Outliner">
	<h3>Open effects</h3>
	<ul>
		{#each workspace.sessions as s (s.id)}
			<li use:menu={() => effectMenu(s)}>
				<button class="item" class:active={s.id === workspace.activeId} onclick={() => (workspace.activeId = s.id)} onauxclick={(e) => e.button === 1 && closeEffect(workspace, s.id)}>
					<span class="name">{s.identifier}</span>
					{#if s.dirty}<span class="dot" aria-label="unsaved"></span>{/if}
				</button>
			</li>
		{/each}
	</ul>

	{#if session}
		<div class="h">
			<h3>Curves</h3>
			<button class="add" aria-label="Add curve" title="Add curve" onclick={addCurve}>+</button>
		</div>
		<ul>
			{#each curves as c (c)}
				{@const p = joinPath('particle_effect', 'curves', c, 'input')}
				<li use:menu={() => curveMenu(c)}><button class="item ox-code" class:active={session.selected?.startsWith(joinPath('particle_effect', 'curves', c))} onclick={() => { session.selected = p; workspace.show('curves'); }}>{c.replace(/^variable\./, 'v.')}</button></li>
			{:else}
				<li class="none">No curves</li>
			{/each}
		</ul>

		<div class="h">
			<h3>Events</h3>
			<button class="add" aria-label="Add event" title="Add event" onclick={addEvent}>+</button>
		</div>
		<ul>
			{#each events as e (e)}
				{@const p = joinPath('particle_effect', 'events', e, 'expression')}
				{@const rank = session.analysis.eventRanks.get(e)}
				<li use:menu={() => eventMenu(e)}>
					<button class="item ox-code" class:active={session.selected?.startsWith(joinPath('particle_effect', 'events', e))} onclick={() => { session.selected = p; workspace.show('events'); }}>
						{e}
						{#if rank === undefined}<span class="never" title="Nothing fires this event">never fired</span>{/if}
					</button>
				</li>
			{:else}
				<li class="none">No events</li>
			{/each}
		</ul>
	{/if}
</nav>

<style>
	.outliner {
		height: 100%;
		overflow: auto;
		padding: 4px 0 20px;
	}
	.h {
		display: flex;
		align-items: center;
		padding-right: 6px;
	}
	h3 {
		margin: 0;
		padding: 10px 10px 4px;
		font-size: var(--ox-title-size);
		font-weight: 600;
		color: var(--ox-haze);
		flex: 1;
	}
	.add {
		width: 20px;
		height: 20px;
		border: none;
		background: none;
		color: var(--ox-haze);
		border-radius: var(--ox-radius);
		cursor: pointer;
		margin-top: 6px;
	}
	.add:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: none;
		text-align: left;
		padding: 0 10px 0 14px;
		height: 24px;
		cursor: pointer;
		color: var(--ox-frost);
	}
	.item:hover {
		background: var(--ox-hover);
	}
	.item.active {
		background: var(--ox-selection);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ox-frost);
		flex: none;
		margin-left: auto;
	}
	.never {
		margin-left: auto;
		font-family: var(--ox-font-ui);
		font-variation-settings: 'MONO' 0;
		color: var(--ox-text-dim);
		font-size: 11px;
	}
	.none {
		padding: 2px 14px;
		color: var(--ox-text-dim);
	}
</style>
