<script lang="ts">
	import type { EffectSession } from '../../state/session.svelte';
	import { molangContextFor } from '../../lib/field-context';
	import { joinPath, molangText } from '../../lib/molang-text';
	import { analyzeEffect } from '@oxygen/effect';
	import { analyze, parse } from 'molangjs';
	import MolangInput from '../fields/MolangInput.svelte';
	import Select from '../fields/Select.svelte';
	import Hint from '../fields/Hint.svelte';
	import { tip } from '../../lib/tip';
	import EventNode from './EventNode.svelte';

	interface Props {
		session: EffectSession;
		path: string;
		depth?: number;
	}

	let { session, path, depth = 0 }: Props = $props();

	const node = $derived.by(() => {
		void session.version;
		const v = session.doc.get(path);
		return (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
	});
	const pe = $derived((node.particle_effect ?? null) as Record<string, unknown> | null);
	const seq = $derived(Array.isArray(node.sequence) ? node.sequence : null);
	const rnd = $derived(Array.isArray(node.randomize) ? (node.randomize as Record<string, unknown>[]) : null);

	const KINDS = [
		{ key: 'expression', label: 'Expression', help: 'Set variables when the event fires', init: '' as unknown },
		{ key: 'particle_effect', label: 'Spawn effect', help: 'Start another effect (or one particle of it)', init: { effect: '', type: 'emitter' } as unknown },
		{ key: 'sound_effect', label: 'Sound', help: 'Play a sound event', init: { event_name: '' } as unknown },
		{ key: 'sequence', label: 'Steps', help: 'Do several things in order: each step can set variables, spawn and play a sound', init: [{}, {}] as unknown },
		{ key: 'randomize', label: 'Random choice', help: 'Pick one of several options, by weight', init: [{ weight: 1 }, { weight: 1 }] as unknown },
	];
	/** with a sequence or random choice the game runs only those (t51): this step's own parts are skipped */
	const grouped = $derived(seq !== null || rnd !== null);
	const GROUP = new Set(['sequence', 'randomize']);
	const OWN = ['expression', 'particle_effect', 'sound_effect'];
	const hasOwn = $derived(OWN.some((k) => node[k] !== undefined));
	// a grouped step only takes more groups; otherwise everything is on offer (a group takes in what's there)
	const missing = $derived(KINDS.filter((k) => node[k.key] === undefined && (!grouped || GROUP.has(k.key))));
	const ignoredParts = $derived(grouped ? [node.expression !== undefined && 'expression', pe && 'spawn', node.sound_effect !== undefined && 'sound'].filter(Boolean) as string[] : []);

	const short = (n: string) => n.replace(/^variable\./, 'v.').replace(/^temp\./, 't.');
	function uses(src: string) {
		if (!src.trim()) return null;
		try {
			return analyze(parse(src).program, { context: 'particle' });
		} catch {
			return null;
		}
	}

	/**
	 * What crosses into the spawned child: temps its pre-effect reads (set earlier in this event, or left
	 * over from anywhere: temps are global in-game) and variables the child needs from outside.
	 */
	const handoff = $derived.by(() => {
		void session.version;
		void session.childrenVersion;
		if (!pe) return null;
		const pre = uses(molangText(pe.pre_effect_expression));
		const setBefore = new Map<string, string>();
		const collect = (value: unknown, label: string) => {
			if (!value || typeof value !== 'object') return;
			const o = value as Record<string, unknown>;
			if (o.expression !== undefined) for (const w of uses(molangText(o.expression))?.writes ?? []) if (w.ns === 'temp' && !setBefore.has(w.name)) setBefore.set(w.name, label);
			if (Array.isArray(o.sequence)) o.sequence.forEach((x) => collect(x, label));
			if (Array.isArray(o.randomize)) o.randomize.forEach((x) => collect((x as Record<string, unknown>)?.node ?? x, `${label}, in one random option`));
		};
		// this step's own expression runs after the spawn (t49): the child gets what it set last time
		const later = new Set((uses(molangText(node.expression))?.writes ?? []).filter((w) => w.ns === 'temp').map((w) => w.name));
		const m = /^(.*)\/sequence\/(\d+)$/.exec(path);
		if (m) {
			const steps = session.doc.get(joinPath(m[1], 'sequence'));
			if (Array.isArray(steps)) for (let i = 0; i < Number(m[2]); i++) collect(steps[i], `step ${i + 1}`);
		}
		const temps = [...new Set((pre?.reads ?? []).filter((r) => r.ns === 'temp').map((r) => r.name))].map((name) => ({ name, from: setBefore.get(name) ?? null, later: !setBefore.has(name) && later.has(name) }));
		const written = new Set((pre?.writes ?? []).filter((w) => w.ns === 'variable').map((w) => w.name));
		const id = String(pe.effect ?? '');
		const child = id ? session.childDefinition(id) : null;
		let needs: { name: string; set: boolean; optional: boolean }[] | null = null;
		if (child) {
			const ca = analyzeEffect(child);
			// reads behind ?? don't abort: those variables are optional
			const required = new Set<string>();
			for (const f of ca.fields) for (const r of f.analysis?.reads ?? []) if (r.ns === 'variable' && !r.guarded) required.add(r.name);
			needs = ca.variables.filter((v) => !v.builtin && !v.writes.length && !v.curve && v.reads.length).map((v) => ({ name: v.name, set: written.has(v.name), optional: !required.has(v.name) }));
		}
		const origin = /^particle_effect\/events\/([^/]+)/.exec(path);
		const atOrigin = !!origin && !!session.def?.particle.events.creation.includes(origin[1].replace(/~1/g, '/').replace(/~0/g, '~'));
		return { temps, needs, id, found: !!child, atOrigin };
	});

	function add(key: string) {
		const k = KINDS.find((x) => x.key === key)!;
		if (GROUP.has(key) && hasOwn) {
			// the game ignores a step's own parts next to steps or a random choice: move them into the first one
			const own: Record<string, unknown> = {};
			for (const o of OWN) if (node[o] !== undefined) own[o] = $state.snapshot(node[o]);
			const first = key === 'randomize' ? { weight: 1, ...own } : own;
			const second = key === 'randomize' ? { weight: 1 } : {};
			session.doc.transact(`Add ${k.label.toLowerCase()}`, () => {
				for (const o of OWN) if (node[o] !== undefined) session.doc.remove(joinPath(path, o));
				session.doc.set(joinPath(path, key), [first, second]);
			});
			return;
		}
		session.doc.set(joinPath(path, key), k.init, `Add ${k.label.toLowerCase()}`);
	}
</script>

<div class="node" style:--depth={depth}>
	{#if ignoredParts.length}
		<p class="ignored">This step has a {seq ? 'sequence' : 'random choice'}, so the game runs only {seq && rnd ? 'those' : 'that'} and ignores its {ignoredParts.join(' and ')} below. Move {ignoredParts.length > 1 ? 'them' : 'it'} into a step.</p>
	{/if}
	{#if node.expression !== undefined}
		<div class="part" class:skipped={grouped}>
			<div class="ph"><span>Expression</span>{#if pe && !grouped}<span class="hint">runs after the spawn</span>{/if}<button class="x" aria-label="Remove expression" onclick={() => session.doc.remove(joinPath(path, 'expression'))}>×</button></div>
			<MolangInput {session} path={joinPath(path, 'expression')} label="Event expression" multiline placeholder="v.flag = 1;" context={molangContextFor(session, joinPath(path, 'expression'))} />
		</div>
	{/if}
	{#if pe}
		<div class="part" class:skipped={grouped}>
			<div class="ph"><span>Spawn effect</span><button class="x" aria-label="Remove spawn effect" onclick={() => session.doc.remove(joinPath(path, 'particle_effect'))}>×</button></div>
			<label class="row"><span>Effect</span><input class="ox-code" value={String(pe.effect ?? '')} placeholder="namespace:effect" onchange={(e) => session.doc.set(joinPath(path, 'particle_effect', 'effect'), e.currentTarget.value, 'Edit event effect')} /></label>
			<div class="row">
				<span>Type</span>
				<Select
					value={String(pe.type ?? 'emitter')}
					label="Spawn type"
					options={[
						{ value: 'emitter', label: 'Emitter at this point', help: 'emitter: a new emitter, independent of this one' },
						{ value: 'emitter_bound', label: 'Emitter bound to this one', help: 'emitter_bound: follows this emitter; it keeps its own lifetime when this one ends' },
						{ value: 'particle', label: 'Single particle', help: 'particle: one particle of the child effect. With /particle or a script, in-game it appears at the world origin, not here' },
						{ value: 'particle_with_velocity', label: 'Single particle with velocity', help: "particle_with_velocity: like Single particle, with the firing particle's velocity. In-game it also appears at the world origin" },
					]}
					onchange={(v) => session.doc.set(joinPath(path, 'particle_effect', 'type'), v, 'Edit event effect')}
				/>
			</div>
			<div class="row top">
				<span class="withhint">Pre-effect <Hint label="About the pre-effect expression" where="events › particle_effect › pre_effect_expression" text="Runs in the child before its `creation_expression`. Temps set in earlier steps of this event are readable here; this step’s own expression runs after the spawn." doc="guide#events" /></span>
				<MolangInput {session} path={joinPath(path, 'particle_effect', 'pre_effect_expression')} label="Child pre-effect expression" multiline placeholder="v.size = t.size;" context={molangContextFor(session, joinPath(path, 'particle_effect', 'pre_effect_expression'))} />
			</div>
			{#if handoff?.atOrigin && !grouped}<p class="warnline">Fired on particle creation: with /particle or a script, the game spawns this at the particle’s offset from its emitter taken as a world position, not at the particle. <Hint label="About where it spawns" text="Particle timeline and expiration events spawn at the particle. Only creation events land near the world origin." doc="accuracy#events" /></p>{/if}
			{#if handoff && (handoff.temps.length || handoff.needs?.length || (handoff.id && !handoff.found))}
				<div class="handoff">
					{#each handoff.temps as t (t.name)}
						<p>
							<code class="ox-code tmp">{short(t.name)}</code>
							{#if t.from}<span>← set in {t.from}</span>
							{:else if t.later}<span class="warn">is set by this step’s expression, which runs after the spawn</span>
							{:else}<span class="warn">isn’t set earlier in this event: the child reads whatever last set it</span>{/if}
						</p>
					{/each}
					{#if handoff.needs}
						{#each handoff.needs as n (n.name)}
							<p>
								<span class="dim">child needs</span> <code class="ox-code var">{short(n.name)}</code>
								{#if n.set}<span class="ok">set here</span>{:else if n.optional}<span class="dim">not set (read with ??)</span>{:else}<span class="warn">not set: its reads abort</span>{/if}
							</p>
						{/each}
					{:else if handoff.id}
						<p class="dim">{handoff.id} isn’t in this pack.</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
	{#if node.sound_effect !== undefined}
		<div class="part" class:skipped={grouped}>
			<div class="ph"><span>Sound</span><button class="x" aria-label="Remove sound" onclick={() => session.doc.remove(joinPath(path, 'sound_effect'))}>×</button></div>
			<label class="row"><span>Sound event</span><input class="ox-code" value={String((node.sound_effect as Record<string, unknown>)?.event_name ?? '')} placeholder="random.pop" onchange={(e) => session.doc.set(joinPath(path, 'sound_effect', 'event_name'), e.currentTarget.value, 'Edit event sound')} /></label>
		</div>
	{/if}
	{#if seq}
		<div class="part">
			<div class="ph"><span use:tip={{ where: 'events › sequence', text: 'Run one after another, top to bottom.' }}>Steps</span><button class="x" aria-label="Remove steps" onclick={() => session.doc.remove(joinPath(path, 'sequence'))}>×</button></div>
			{#each seq as _, i (i)}
				<div class="child">
					<div class="ch"><span class="ox-num">Step {i + 1}</span><button class="x" aria-label="Remove step {i + 1}" onclick={() => session.doc.remove(joinPath(path, 'sequence', i))}>×</button></div>
					<EventNode {session} path={joinPath(path, 'sequence', i)} depth={depth + 1} />
				</div>
			{/each}
			<button class="link" onclick={() => session.doc.insert(joinPath(path, 'sequence'), {}, undefined, 'Add step')}>Add step</button>
		</div>
	{/if}
	{#if rnd}
		<div class="part">
			<div class="ph"><span use:tip={{ where: 'events › randomize', text: 'Picks one option by weight.' }}>Random choice</span><button class="x" aria-label="Remove random choice" onclick={() => session.doc.remove(joinPath(path, 'randomize'))}>×</button></div>
			{#each rnd as opt, i (i)}
				<div class="child">
					<div class="ch">
						<span>Weight</span>
						<input class="w ox-num" value={String(opt.weight ?? 1)} aria-label="Weight of option {i + 1}" onchange={(e) => session.doc.setRaw(joinPath(path, 'randomize', i, 'weight'), String(Number(e.currentTarget.value) || 0), 'Edit weight')} />
						<button class="x" aria-label="Remove option {i + 1}" onclick={() => session.doc.remove(joinPath(path, 'randomize', i))}>×</button>
					</div>
					<EventNode {session} path={joinPath(path, 'randomize', i)} depth={depth + 1} />
				</div>
			{/each}
			<button class="link" onclick={() => session.doc.insert(joinPath(path, 'randomize'), { weight: 1 }, undefined, 'Add option')}>Add option</button>
		</div>
	{/if}
	{#if missing.length}
		<div class="adds">
			<span class="addlabel">Add</span>
			{#each missing as k (k.key)}<button class="add" title={k.help + (GROUP.has(k.key) && hasOwn ? '. What this step already does moves into the first one.' : '')} onclick={() => add(k.key)}>{k.label}</button>{/each}
		</div>
	{/if}
</div>

<style>
	.handoff {
		margin-top: 4px;
		padding: 4px 8px;
		border-left: 2px solid var(--ox-syn-temp);
		background: var(--ox-hover);
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 11.5px;
	}
	.handoff p {
		margin: 0;
		color: var(--ox-haze);
	}
	.handoff .tmp {
		color: var(--ox-syn-temp);
	}
	.handoff .var {
		color: var(--ox-syn-variable);
	}
	.handoff .ok {
		color: var(--ox-phase-particle);
	}
	.handoff .warn {
		color: var(--ox-warning);
	}
	.handoff .dim {
		color: var(--ox-text-dim);
	}
	.ignored,
	.warnline {
		margin: 0;
		padding: 4px 8px;
		border-left: 2px solid var(--ox-warning);
		background: var(--ox-hover);
		color: var(--ox-frost);
		font-size: 11.5px;
	}
	.part.skipped {
		opacity: 0.55;
	}
	.node {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.part {
		border-left: 2px solid var(--ox-phase-event);
		padding: 2px 0 4px 8px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.ph,
	.ch {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 22px;
		color: var(--ox-frost);
		font-weight: 600;
	}
	.ch {
		font-weight: 500;
		color: var(--ox-haze);
	}
	.hint {
		font-weight: 400;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.child {
		padding-left: 6px;
		border-left: 1px dashed var(--ox-rule-strong);
		margin: 2px 0;
	}
	.row {
		display: grid;
		grid-template-columns: 84px 1fr;
		gap: 6px;
		align-items: center;
		color: var(--ox-haze);
	}
	.row.top {
		align-items: start;
	}
	.row.top > span {
		line-height: 22px;
	}
	.withhint {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	input {
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
		min-width: 0;
	}
	input:focus {
		border-color: var(--ox-lox);
	}
	.w {
		width: 56px;
	}
	.x {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		width: 20px;
		height: 20px;
	}
	.x:hover {
		color: var(--ox-frost);
	}
	.link {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--ox-lox);
		cursor: pointer;
		padding: 0;
	}
	.adds {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.addlabel {
		color: var(--ox-text-dim);
		margin-right: 2px;
	}
	.add {
		border: 1px dashed var(--ox-rule-strong);
		background: none;
		border-radius: var(--ox-radius);
		height: 22px;
		padding: 0 8px;
		color: var(--ox-haze);
		cursor: pointer;
	}
	.add:hover {
		color: var(--ox-frost);
		border-color: var(--ox-haze);
	}
</style>
