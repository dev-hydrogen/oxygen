<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { joinPath } from '../../lib/molang-text';
	import EventNode from './EventNode.svelte';
	import EventGraph from './EventGraph.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let chosen = $state<string | null>(null);

	const names = $derived.by(() => {
		void session?.version;
		const e = session?.doc.get('particle_effect/events');
		return e && typeof e === 'object' ? Object.keys(e as object) : [];
	});
	const current = $derived.by(() => {
		const m = /^particle_effect\/events\/([^/]+)/.exec(session?.selected ?? '');
		const fromSel = m ? m[1].replace(/~1/g, '/').replace(/~0/g, '~') : null;
		return (fromSel && names.includes(fromSel) ? fromSel : chosen && names.includes(chosen) ? chosen : names[0]) ?? null;
	});

	/** Where the event is fired from, by name */
	const triggers = $derived.by(() => {
		const d = session?.def;
		const out: string[] = [];
		if (!d || !current) return out;
		const e = d.emitter.events;
		if (e.creation.includes(current)) out.push('emitter creation');
		if (e.expiration.includes(current)) out.push('emitter expiration');
		for (const t of e.timeline) if (t.events.includes(current)) out.push(`emitter timeline ${t.at}s`);
		for (const t of e.travelDistance) if (t.events.includes(current)) out.push(`after ${t.at} blocks`);
		for (const t of e.loopingTravelDistance) if (t.events.includes(current)) out.push(`every ${t.at} blocks`);
		const p = d.particle.events;
		if (p.creation.includes(current)) out.push('particle creation');
		if (p.expiration.includes(current)) out.push('particle expiration');
		for (const t of p.timeline) if (t.events.includes(current)) out.push(`particle timeline ${t.at}s`);
		for (const c of d.particle.collision?.events ?? []) if (c.event === current) out.push(`collision faster than ${c.minSpeed} m/s`);
		return out;
	});

	/** the graph earns its space once something is wired up */
	const hasGraph = $derived.by(() => {
		void session?.version;
		const d = session?.def;
		return !!d && (d.events.size > 0 || triggers.length > 0);
	});

	function pick(name: string) {
		chosen = name;
		if (session) session.selected = joinPath('particle_effect/events', name);
	}

	function addEvent() {
		if (!session) return;
		let n = 1;
		while (names.includes(`event_${n}`)) n++;
		session.doc.set(joinPath('particle_effect/events', `event_${n}`), { expression: '' }, 'Add event', (keys) => (keys.indexOf('components') >= 0 ? keys.indexOf('components') : keys.length));
		chosen = `event_${n}`;
		session.selected = joinPath('particle_effect/events', `event_${n}`);
	}
</script>

<div class="events">
	{#if session}
	<div class="layout" class:split={hasGraph}>
		{#if hasGraph}
			<div class="graphpane">
				<EventGraph {workspace} {session} {current} onpick={pick} />
			</div>
		{/if}
		<div class="editor">
		<div class="head">
			<select aria-label="Event" value={current ?? ''} onchange={(e) => (chosen = e.currentTarget.value)} disabled={!names.length}>
				{#each names as n (n)}<option value={n}>{n}</option>{/each}
			</select>
			{#if current}
				<input class="name ox-code" aria-label="Event name" value={current} onchange={(e) => {
					const v = e.currentTarget.value.trim();
					if (v && !names.includes(v)) {
						session.doc.renameKey(joinPath('particle_effect/events', current), v, 'Rename event');
						chosen = v;
					}
				}} />
			{/if}
			<button class="btn" onclick={addEvent}>New event</button>
			{#if current}<button class="link" onclick={() => session.doc.remove(joinPath('particle_effect/events', current), 'Remove event')}>Remove</button>{/if}
		</div>
		{#if current}
			<p class="fired">
				{#if triggers.length}Fired by {triggers.join(', ')}.{:else}<span class="warn">Nothing fires this event.</span> Reference it from Emitter events, Particle events or Collision.{/if}
			</p>
			<div class="body">
				{#key current}<EventNode {session} path={joinPath('particle_effect/events', current)} />{/key}
			</div>
		{:else}
			<p class="empty">No events yet.</p>
		{/if}
		</div>
	</div>
	{/if}
</div>

<style>
	.events {
		height: 100%;
		container-type: size;
	}
	.layout {
		height: 100%;
		display: grid;
		grid-template-rows: 100%;
	}
	.layout.split {
		grid-template-columns: minmax(0, 1fr) clamp(320px, 38%, 460px);
	}
	@container (max-width: 720px) {
		.layout.split {
			grid-template-columns: 100%;
			grid-template-rows: minmax(140px, 46%) minmax(0, 1fr);
		}
		.layout.split .editor {
			border-left: none;
			border-top: 1px solid var(--ox-rule);
		}
	}
	.graphpane {
		min-height: 0;
		min-width: 0;
	}
	.editor {
		overflow: auto;
		min-height: 0;
	}
	.split .editor {
		border-left: 1px solid var(--ox-rule);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		padding: 6px 8px;
		border-bottom: 1px solid var(--ox-rule);
	}
	.head select {
		max-width: 40%;
	}
	.head .name {
		flex: 1 1 90px;
		min-width: 0;
	}
	.head button {
		white-space: nowrap;
	}
	select,
	.name {
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
	}
	select option {
		background: var(--ox-float);
	}
	.name:focus {
		border-color: var(--ox-lox);
	}
	.btn {
		border: 1px solid var(--ox-rule-strong);
		background: none;
		border-radius: var(--ox-radius);
		height: 22px;
		padding: 0 8px;
		cursor: pointer;
	}
	.btn:hover {
		background: var(--ox-hover);
	}
	.link {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
	}
	.link:hover {
		color: var(--ox-frost);
	}
	.fired {
		margin: 6px 10px;
		color: var(--ox-haze);
	}
	.warn {
		color: var(--ox-warning);
	}
	.body {
		padding: 0 10px 20px;
	}
	.empty {
		padding: 16px;
		color: var(--ox-haze);
		max-width: 56ch;
	}
</style>
