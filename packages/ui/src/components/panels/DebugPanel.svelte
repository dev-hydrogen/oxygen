<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { SPAWN_MODES } from '../../state/session.svelte';
	import { tip } from '../../lib/tip';
	import { PHASE_VAR } from '../../lib/molang-text';
	import Hint from '../fields/Hint.svelte';
	import Toggle from '../fields/Toggle.svelte';
	import { explainFacing } from '../../lib/facing-text';
	import EditValue from '../fields/EditValue.svelte';
	import type { Value } from 'molangjs';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let tab = $state<'particle' | 'log'>('particle');
	/** the inspected particle's color, drawn large */
	let colorOpen = $state(false);
	let tickN = $state(0);
	// live particle state refreshes a few times a second while playing
	$effect(() => {
		const t = setInterval(() => tickN++, 250);
		return () => clearInterval(t);
	});

	const ENGINE_PHASE: Record<string, string> = { creation: 'setup', 'emitter-update': 'emitter', spawn: 'spawn', 'particle-update': 'particle', render: 'render', event: 'event' };
	const PHASE_LABEL: Record<string, string> = { creation: 'Setup', 'emitter-update': 'Emitter', spawn: 'Spawn', 'particle-update': 'Update', render: 'Render', event: 'Event' };

	/** an inspected emitter (clicked in the viewport): its own state, not a particle's */
	const einfo = $derived.by(() => {
		void tickN;
		void session?.debugVersion;
		const s = session;
		const sel = s?.selection;
		if (!s || !sel || sel.particle >= 0) return null;
		const e = s.world.emitters.find((x) => x.id === sel.emitter);
		if (!e) return { gone: true as const };
		const life = e.def.emitter.lifetime;
		const rate = e.def.emitter.rate;
		return {
			gone: false as const,
			identifier: e.def.identifier,
			parent: e.parentId,
			context: e.spawnOptions.context ?? 'command',
			bound: !!e.spawnOptions.bound,
			lifetime: life?.type ?? 'none',
			rate: rate?.type ?? 'none',
			age: e.age,
			totalAge: e.totalAge,
			loop: e.loopIndex,
			activeTime: e.activeTime,
			sleepTime: e.sleepTime,
			maxParticles: e.maxParticles,
			particles: e.pool.count,
			active: e.active,
			expired: e.expired,
			loops: e.loops,
			pos: [...e.position],
			randoms: [...e.randoms],
			travelled: e.travelled,
			vars: s.world.snapshotVars(e.vars),
			temps: s.world.temps.entries(s.world.symbols.tempNames),
		};
	});

	const pinfo = $derived.by(() => {
		void tickN;
		void session?.debugVersion;
		const s = session;
		const sel = s?.selection;
		if (!s || !sel || sel.particle < 0) return null;
		const e = s.world.emitters.find((x) => x.id === sel.emitter);
		if (!e) return { gone: true as const };
		const i = e.pool.indexOfId(sel.particle);
		if (i < 0) return { gone: true as const };
		const p = e.pool;
		const v3 = (a: Float32Array, k: number) => [a[k * 3], a[k * 3 + 1], a[k * 3 + 2]];
		const cam = s.world.camera;
		const facingInfo = e.particleFacing(i, cam);
		const toCam = facingInfo
			? (() => {
					const d = [cam.position[0] - facingInfo.position[0], cam.position[1] - facingInfo.position[1], cam.position[2] - facingInfo.position[2]];
					const l = Math.hypot(d[0], d[1], d[2]) || 1;
					return [d[0] / l, d[1] / l, d[2] / l] as [number, number, number];
				})()
			: null;
		return {
			facingMode: facingInfo?.mode ?? null,
			explain: facingInfo && toCam ? explainFacing(facingInfo, toCam) : null,
			gone: false as const,
			age: p.age[i],
			lifetime: p.hasLifetime[i] ? p.lifetime[i] : null,
			pos: v3(p.pos, i),
			vel: v3(p.vel, i),
			size: [p.size[i * 2], p.size[i * 2 + 1]],
			color: [p.color[i * 4], p.color[i * 4 + 1], p.color[i * 4 + 2], p.color[i * 4 + 3]],
			uv: [p.uv[i * 4], p.uv[i * 4 + 1], p.uv[i * 4 + 2], p.uv[i * 4 + 3]],
			facing: v3(p.facing, i),
			rot: p.rot[i],
			randoms: [p.random[i * 4], p.random[i * 4 + 1], p.random[i * 4 + 2], p.random[i * 4 + 3]],
			visible: !!p.visible[i],
			local: !!p.local[i],
			vars: s.world.snapshotVars(e.vars),
			temps: s.world.temps.entries(s.world.symbols.tempNames),
		};
	});

	/**
	 * The variables and temps the selected particle's own expressions use, through its turn in the last frame, in
	 * two passes: its update (spawn, update and its events) and its render. Variables belong to the emitter, so a
	 * value it only reads in a pass is whatever ran before it there: the emitter, an earlier particle, or (in the
	 * render pass, which starts once every particle has updated) the last particle's update. Those show dim; what its
	 * own expressions set shows plain.
	 */
	type Use = { state: 'set' | 'read' | 'none'; value: Value | undefined };
	const turn = $derived.by(() => {
		void tickN;
		void session?.debugVersion;
		const s = session;
		const sel = s?.selection;
		if (!s || !sel || sel.particle < 0) return null;
		const own = s.traces.filter((t) => t.particle === sel.particle);
		if (!own.length) return null;
		const names: string[] = [];
		const add = (n: string) => {
			if (!names.includes(n) && !n.startsWith('variable.particle_') && !n.startsWith('variable.emitter_')) names.push(n);
		};
		const uses = (t: (typeof own)[number]) => s.analysis.byPath.get(t.path)?.analysis;
		for (const t of own) {
			const a = uses(t);
			for (const u of [...(a?.writes ?? []), ...(a?.reads ?? [])]) if (u.ns === 'variable' || u.ns === 'temp') add(u.name);
		}
		const pass = (render: boolean) => own.filter((t) => (t.phase === 'render') === render);
		const valueIn = (t: (typeof own)[number], name: string, before: boolean): Value | undefined => {
			if (name.startsWith('temp.')) return t.temps.find(([k]) => k === name)?.[1];
			return (before ? t.varsBefore : t.varsAfter)[name];
		};
		/** set: the value its last write left; read only: the value it saw first */
		const use = (list: typeof own, name: string): Use => {
			let wrote: (typeof own)[number] | null = null;
			let read: (typeof own)[number] | null = null;
			for (const t of list) {
				const a = uses(t);
				if (a?.writes.some((w) => w.name === name)) wrote = t;
				else if (!read && a?.reads.some((r) => r.name === name)) read = t;
			}
			if (wrote) return { state: 'set', value: valueIn(wrote, name, false) };
			if (read) return { state: 'read', value: valueIn(read, name, true) };
			return { state: 'none', value: undefined };
		};
		const update = pass(false);
		const render = pass(true);
		return { hasRender: render.length > 0, rows: names.map((n) => ({ name: n, update: use(update, n), render: use(render, n) })) };
	});

	/** change a value of the inspected particle or emitter (not mid-step) */
	function edit(what: string, v: Value) {
		const sel = session?.selection;
		if (!session || !sel) return;
		session.setDebugValue(sel.emitter, sel.particle, what, v);
	}
	const READ_TIP = 'It only read this here: the value came from whatever ran before it in this pass (the emitter, an earlier particle, or in the render pass the last particle’s update)';
	const SET_TIP = 'Its own expressions set this here';
	const EDIT_TIP = 'Drag or type a value to change it in the preview from now on, as if the effect had set it. Restarting plays the effect as written.';
	const TURN_TIP = 'What this particle’s own expressions used in the last frame. Plain values it set; dim ones it only read, so they hold whatever ran before it. Render comes after every particle’s update.';
	const DOC = 'guide#inspecting-and-debugging';

	function f(n: number, d = 3) {
		if (Number.isNaN(n)) return 'NaN';
		return String(Math.round(n * 10 ** d) / 10 ** d);
	}
	function show(v: unknown) {
		return typeof v === 'number' ? f(v) : typeof v === 'string' ? `'${v}'` : String(v);
	}
	function label(path: string) {
		return session?.analysis.byPath.get(path)?.label ?? path.replace(/^particle_effect\/components\/minecraft:/, '').replace(/\//g, ' › ');
	}
	function short(n: string) {
		return n.replace(/^variable\./, 'v.').replace(/^temp\./, 't.');
	}
</script>

{#snippet cells(list: { k: string; text: string; value?: number; what?: string }[])}
	<span class="cells">
		{#each list as c (c.k)}
			<span class="cell">
				<span class="k">{c.k}</span>
				{#if c.what !== undefined && c.value !== undefined}
					<EditValue label={c.what} value={c.value} text={c.text} digits={3} disabled={!!session?.halt} onchange={(v) => edit(c.what!, v)} />
				{:else}
					<span class="v">{c.text}</span>
				{/if}
			</span>
		{/each}
	</span>
{/snippet}

<div class="debug">
	{#if session}
		<div class="bar">
			<div class="seg" role="tablist" aria-label="Debug view">
				<button role="tab" aria-selected={tab === 'particle'} onclick={() => (tab = 'particle')}>{session.selection && session.selection.particle < 0 ? 'Emitter' : 'Particle'}</button>
				<button role="tab" aria-selected={tab === 'log'} onclick={() => (tab = 'log')}>Execution log</button>
			</div>
			<button class="btn" title="Run the next frame one evaluation at a time" onclick={() => session.stepEvaluation()}>Step evaluation</button>
			<button class="btn" title="Finish the current frame" onclick={() => session.stepFrame()}>Next frame</button>
			{#if !session.playing}<button class="btn" onclick={() => (session.playing = true)}>Resume</button>{/if}
		</div>
		{#if session.halt}
			<p class="halt" style:--phase={PHASE_VAR[(ENGINE_PHASE[session.halt.phase] ?? 'event') as 'setup']}>
				Stopped before step {session.halt.step}: <strong>{label(session.halt.path)}</strong>
				{session.halt.particle >= 0 ? `for particle #${session.halt.particle}` : 'for the emitter'} ({PHASE_LABEL[session.halt.phase] ?? session.halt.phase}).
			</p>
		{/if}

		{#if tab === 'particle'}
			{#if !session.selection}
				<p class="empty">Click a particle in the viewport, or an emitter’s marker.</p>
			{:else if session.selection.particle < 0}
				{#if !einfo || einfo.gone}
					<p class="empty">Emitter #{session.selection.emitter} is gone. <button class="link" onclick={() => session.select(null)}>Clear</button></p>
				{:else}
					<div class="head">
						<strong>Emitter #{session.selection.emitter}</strong>
						<span class="dim ox-code">{einfo.identifier}</span>
						{#if einfo.parent !== null}<button class="link" onclick={() => session.select({ emitter: einfo.parent!, particle: -1 })}>parent #{einfo.parent}</button>{/if}
						<button class="link" onclick={() => session.select(null)}>Clear</button>
					</div>
					<div class="props ox-num">
						<span>State</span>
						<span>{einfo.expired ? 'expired' : einfo.active ? 'active' : 'sleeping'}{#if einfo.bound}<span class="more">bound to its parent</span>{/if}</span>
						<span>Spawned by</span>
						<span>{SPAWN_MODES.find((m) => m.id === einfo.context)?.label ?? einfo.context}<span class="more">{einfo.loops ? 'loops' : 'plays one loop'}</span></span>
						<span>Lifetime</span>
						<span class="ox-code">emitter_lifetime_{einfo.lifetime}</span>
						<span class="ox-code key" use:tip={'Seconds since this loop started'}>v.emitter_age</span>
						<span>{f(einfo.age)} s<span class="more">loop {einfo.loop + 1}, {f(einfo.totalAge)} s in all</span></span>
						<span class="ox-code key" use:tip={'The loop’s active time'}>v.emitter_lifetime</span>
						<span>{f(einfo.activeTime)} s{#if einfo.sleepTime}<span class="more">then sleeps {f(einfo.sleepTime)} s</span>{/if}</span>
						<span>Rate</span>
						<span><span class="ox-code">emitter_rate_{einfo.rate}</span>{#if einfo.rate === 'steady' || einfo.rate === 'manual'}<span class="more">max_particles {einfo.maxParticles}</span>{/if}</span>
						<span>Particles</span>
						<span>{einfo.particles}<span class="more">alive</span></span>
						<span>Position</span>
						{@render cells(['x', 'y', 'z'].map((k, a) => ({ k, text: f(einfo.pos[a]) })))}
						<span>Travelled</span>
						<span>{f(einfo.travelled)} blocks</span>
						<span class="ox-code key" use:tip={'Four random numbers from 0 to 1, drawn when the emitter starts and again each time it loops: `v.emitter_random_1` to `v.emitter_random_4`.'}>v.emitter_random_N</span>
						{@render cells(einfo.randoms.map((n, i) => ({ k: String(i + 1), text: f(n) })))}
					</div>
					<h4>This frame, in order</h4>
					<ol class="evals">
						{#each session.traces as t, i (i)}
							{@const ph = ENGINE_PHASE[t.phase] ?? 'event'}
							<li>
								<button style:--phase={PHASE_VAR[ph as 'setup']} onclick={() => (session.selected = t.path)}>
									<span class="ph">{PHASE_LABEL[t.phase] ?? t.phase}</span>
									<span class="lbl">{label(t.path)}</span>
									<span class="res ox-num">{show(t.result)}</span>
								</button>
							</li>
						{:else}
							<li class="dim">Nothing recorded yet: run a frame, or step.</li>
						{/each}
					</ol>
					<h4>Variables <Hint label="About changing values" text={EDIT_TIP} doc={DOC} /></h4>
					<div class="grid vars ox-num">
						{#each Object.entries(einfo.vars).filter(([k]) => !k.startsWith('variable.particle_')) as [k, v] (k)}
							<span class="ox-code">{short(k)}</span><EditValue label={short(k)} value={v} text={show(v)} disabled={!!session.halt} onchange={(x) => edit(k, x)} />
						{:else}
							<span class="dim">none</span><span></span>
						{/each}
					</div>
					{#if einfo.temps.length}
						<h4>Temps</h4>
						<div class="grid vars ox-num">
							{#each einfo.temps as [k, v] (k)}<span class="ox-code">{short(k)}</span><EditValue label={short(k)} value={v} text={show(v)} disabled={!!session.halt} onchange={(x) => edit(k, x)} />{/each}
						</div>
					{/if}
					{#if session.halt}<p class="explain">Stopped mid-frame: values can be changed once it finishes (Next frame).</p>{/if}
				{/if}
			{:else if !pinfo || pinfo.gone}
				<p class="empty">Particle #{session.selection.particle} has expired. <button class="link" onclick={() => session.select(null)}>Clear</button></p>
			{:else}
				<div class="head">
					<strong>Particle #{session.selection.particle}</strong>
					<span class="dim">emitter #{session.selection.emitter}</span>
					{#if !pinfo.visible}<span class="warn">not drawn</span>{/if}
					<button class="link" onclick={() => session.select(null)}>Clear</button>
				</div>
				<div class="props ox-num">
					<span class="ox-code key" use:tip={'Seconds since it spawned'}>v.particle_age</span>
					<span class="one"><EditValue label="v.particle_age" value={pinfo.age} text={f(pinfo.age)} disabled={!!session.halt} step={0.05} onchange={(v) => edit('age', v)} /><span class="unit">s</span></span>
					<span class="ox-code key" use:tip={'Seconds it lives, when it has a maximum'}>v.particle_lifetime</span>
					{#if pinfo.lifetime !== null}
						<span class="one"><EditValue label="v.particle_lifetime" value={pinfo.lifetime} text={f(pinfo.lifetime)} disabled={!!session.halt} step={0.05} onchange={(v) => edit('lifetime', v)} /><span class="unit">s</span></span>
					{:else}
						<span class="dim">no maximum</span>
					{/if}
					<span use:tip={pinfo.local ? 'In the emitter’s space: `emitter_local_space` is on' : 'In the world'}>Position{#if pinfo.local}<span class="more">local</span>{/if}</span>
					{@render cells(['x', 'y', 'z'].map((k, a) => ({ k, value: pinfo.pos[a], what: `pos.${k}`, text: f(pinfo.pos[a]) })))}
					<span use:tip={'Blocks per second'}>Velocity</span>
					{@render cells(['x', 'y', 'z'].map((k, a) => ({ k, value: pinfo.vel[a], what: `vel.${k}`, text: f(pinfo.vel[a]) })))}
					<span use:tip={'The billboard’s size as evaluated'}>Size</span>
					{@render cells(['x', 'y'].map((k, a) => ({ k, text: f(pinfo.size[a]) })))}
					<span>Rotation</span>
					<span class="one"><EditValue label="Rotation" value={pinfo.rot} text={f(pinfo.rot, 1)} disabled={!!session.halt} step={1} onchange={(v) => edit('rot', v)} /><span class="unit">°</span></span>
					<span use:tip={'The direction it faces along, as evaluated (a custom direction, or its velocity)'}>Direction</span>
					{@render cells(['x', 'y', 'z'].map((k, a) => ({ k, text: f(pinfo.facing[a]) })))}
					<span class="colorname" use:tip={'Red, green, blue and alpha from 0 to 1, as Molang gives them'}>
						Color
						<button class="sw" class:big={colorOpen} aria-expanded={colorOpen} aria-label="{colorOpen ? 'Shrink' : 'Enlarge'} the color" style:--c="rgba({pinfo.color[0]},{pinfo.color[1]},{pinfo.color[2]},{pinfo.color[3] / 255})" style:--solid="rgb({pinfo.color[0]},{pinfo.color[1]},{pinfo.color[2]})" onclick={() => (colorOpen = !colorOpen)}></button>
					</span>
					{@render cells(['r', 'g', 'b', 'a'].map((k, a) => ({ k, text: f(pinfo.color[a] / 255) })))}
					<span class="sub" use:tip={'The same color as whole numbers'}>0–255</span>
					{@render cells(['r', 'g', 'b', 'a'].map((k, a) => ({ k, text: String(pinfo.color[a]) })))}
					<span class="sub" use:tip={'The same color as #rrggbbaa'}>hex</span>
					<span class="one ox-code">#{pinfo.color.map((n) => n.toString(16).padStart(2, '0')).join('')}</span>
					<span use:tip={'The part of the texture it draws, as fractions of its width and height: from (u0, v0) to (u1, v1)'}>UV</span>
					{@render cells(['u0', 'v0', 'u1', 'v1'].map((k, a) => ({ k, text: f(pinfo.uv[a], 4) })))}
					<span class="ox-code key" use:tip={'Four random numbers from 0 to 1, drawn when the particle spawned: `v.particle_random_1` to `v.particle_random_4`.'}>v.particle_random_N</span>
					{@render cells(pinfo.randoms.map((n, i) => ({ k: String(i + 1), text: f(n) })))}
				</div>

				{#if pinfo.explain}
					<h4>Facing <span class="dim ox-code">{pinfo.facingMode}</span></h4>
					<div class="facing">
						<p>{pinfo.explain.rule}</p>
						{#each pinfo.explain.steps as step, k (k)}<p class="dim ox-num">{step}</p>{/each}
						{#each pinfo.explain.warnings as w, k (k)}<p class="warn">{w}</p>{/each}
						{#if !session.showFacing}<button class="link" onclick={() => (session.showFacing = true)}>Show axes in the viewport</button>{/if}
					</div>
				{/if}

				<h4>This frame, in order</h4>
				<ol class="evals">
					{#each session.traces as t, i (i)}
						{@const ph = ENGINE_PHASE[t.phase] ?? 'event'}
						<li>
							<button style:--phase={PHASE_VAR[ph as 'setup']} onclick={() => (session.selected = t.path)}>
								<span class="ph">{PHASE_LABEL[t.phase] ?? t.phase}</span>
								<span class="lbl">{label(t.path)}</span>
								<span class="res ox-num">{show(t.result)}</span>
							</button>
						</li>
					{:else}
						<li class="dim">Nothing recorded yet: run a frame, or step.</li>
					{/each}
				</ol>

				{#if turn?.rows.length}
					<h4>Its turn <Hint label="About a particle's turn" text={TURN_TIP} doc={DOC} /></h4>
					<div class="grid turn ox-num" class:two={turn.hasRender}>
						<span class="dim">Variable</span><span class="dim">In its update</span>{#if turn.hasRender}<span class="dim">In its render</span>{/if}
						{#each turn.rows as r (r.name)}
							<span class="ox-code">{short(r.name)}</span>
							{#each turn.hasRender ? [r.update, r.render] : [r.update] as u, k (k)}
								{#if u.state === 'none'}<span class="faint" title="Not used in this pass">—</span>
								{:else}<span class:faint={u.state === 'read'} title={u.state === 'read' ? READ_TIP : SET_TIP}>{u.value === undefined ? 'unset' : show(u.value)}{#if u.state === 'read'}<span class="tag">read</span>{/if}</span>{/if}
							{/each}
						{/each}
					</div>
				{/if}

				<h4>Variables <Hint label="About the emitter's variables" text={`Shared by every particle of the emitter, as the last one left them. ${EDIT_TIP}`} doc={DOC} /></h4>
				<div class="grid vars ox-num">
					{#each Object.entries(pinfo.vars).filter(([k]) => !k.startsWith('variable.particle_') && !k.startsWith('variable.emitter_')) as [k, v] (k)}
						<span class="ox-code">{short(k)}</span><EditValue label={short(k)} value={v} text={show(v)} disabled={!!session.halt} onchange={(x) => edit(k, x)} />
					{:else}
						<span class="dim">none</span><span></span>
					{/each}
				</div>
				{#if pinfo.temps.length}
					<h4>Temps</h4>
					<div class="grid vars ox-num">
						{#each pinfo.temps as [k, v] (k)}<span class="ox-code">{short(k)}</span><EditValue label={short(k)} value={v} text={show(v)} disabled={!!session.halt} onchange={(x) => edit(k, x)} />{/each}
					</div>
				{/if}
				{#if session.halt}<p class="explain">Stopped mid-frame: values can be changed once it finishes (Next frame).</p>{/if}
			{/if}
		{:else}
			<div class="logbar">
				<Toggle checked={session.logging} label="Record every evaluation" onchange={(v) => session.setLogging(v)} />
				<span>Record the last frame’s evaluations{session.logging ? ` (${session.log.length.toLocaleString()})` : ''}</span>
			</div>
			{#if session.logging}
				<table class="log ox-num">
					<thead><tr><th>Phase</th><th>Field</th><th>Particle</th><th>Result</th></tr></thead>
					<tbody>
						{#each session.log.slice(0, 1500) as l, i (i)}
							{@const ph = ENGINE_PHASE[l.phase] ?? 'event'}
							<tr style:--phase={PHASE_VAR[ph as 'setup']}>
								<td class="ph">{PHASE_LABEL[l.phase] ?? l.phase}</td>
								<td><button class="cell" onclick={() => (session.selected = l.path)}>{label(l.path)}</button></td>
								<td>{l.particle >= 0 ? `#${l.particle}` : 'emitter'}</td>
								<td>{show(l.result)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if session.log.length > 1500}<p class="dim pad">Showing the first 1,500 evaluations.</p>{/if}
			{:else}
				<p class="empty">Every Molang evaluation of a frame, in the order the game runs them.</p>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.explain {
		margin: 2px 10px 6px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
		max-width: 70ch;
	}
	.faint {
		color: var(--ox-text-dim);
	}
	.tag {
		margin-left: 5px;
		font-size: 10.5px;
		color: var(--ox-text-dim);
		font-family: var(--ox-font-ui);
	}
	.facing {
		padding: 0 10px 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.facing p {
		margin: 0;
	}
	.debug {
		height: 100%;
		overflow: auto;
		padding-bottom: 20px;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		padding: 6px 8px;
		border-bottom: 1px solid var(--ox-rule);
		position: sticky;
		top: 0;
		background: var(--ox-panel);
		z-index: 1;
	}
	.seg {
		display: flex;
		background: var(--ox-input);
		border-radius: var(--ox-radius);
		padding: 2px;
		margin-right: auto;
	}
	.seg button {
		border: none;
		background: none;
		padding: 0 8px;
		height: 20px;
		white-space: nowrap;
		border-radius: 2px;
		color: var(--ox-haze);
		cursor: pointer;
	}
	.seg button[aria-selected='true'] {
		background: var(--ox-raised);
		color: var(--ox-frost);
	}
	.btn {
		border: 1px solid var(--ox-rule-strong);
		background: none;
		border-radius: var(--ox-radius);
		height: 22px;
		padding: 0 8px;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn:hover {
		background: var(--ox-hover);
	}
	.halt {
		margin: 6px 8px;
		padding: 4px 8px;
		border-left: 2px solid var(--phase);
		background: var(--ox-hover);
	}
	.empty {
		padding: 12px 14px;
		color: var(--ox-haze);
		max-width: 60ch;
	}
	.head {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 8px 10px 4px;
	}
	.grid {
		display: grid;
		grid-template-columns: 90px 1fr;
		gap: 2px 10px;
		padding: 0 10px;
	}
	/* what the particle or emitter is right now: a name, then its values in columns that line up down the table */
	.props {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 3px 16px;
		align-items: center;
		padding: 0 10px 2px;
	}
	.props > span:nth-child(odd) {
		color: var(--ox-haze);
		min-height: 20px;
		line-height: 20px;
	}
	.props .key {
		color: var(--ox-syn-variable);
		font-size: 12px;
	}
	.cells {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0 6px;
		max-width: 420px;
	}
	.cell {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr);
		align-items: center;
		min-width: 0;
	}
	.cell .k {
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.cell .v {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell :global(.edit) {
		min-width: 0;
	}
	/* a value on its own starts where the columns' values do */
	.one {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-left: 18px;
	}
	.one :global(.edit) {
		min-width: 0;
		width: 64px;
	}
	.unit {
		color: var(--ox-text-dim);
	}
	/* a second fact about the same thing */
	.more {
		margin-left: 8px;
		color: var(--ox-text-dim);
		font-family: var(--ox-font-ui);
		font-variation-settings: 'MONO' 0;
	}
	.props > .sub {
		padding-left: 10px;
		color: var(--ox-text-dim);
	}
	.colorname {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	button.sw {
		flex: none;
		width: 20px;
		height: 14px;
		padding: 0;
		border: 1px solid var(--ox-rule-strong);
		cursor: zoom-in;
	}
	/* enlarged: with its alpha over the checker on the left, opaque on the right */
	button.sw.big {
		width: 96px;
		height: 48px;
		cursor: zoom-out;
		background:
			linear-gradient(90deg, var(--c) 50%, var(--solid) 50%),
			repeating-conic-gradient(#8e97ad 0 25%, #dfe5f0 0 50%) 0 0 / 12px 12px;
	}
	.grid > span:nth-child(odd) {
		color: var(--ox-haze);
	}
	.grid.turn > span {
		color: var(--ox-frost);
	}
	.grid.turn > span.faint,
	.grid.turn > span.dim {
		color: var(--ox-text-dim);
	}
	.grid.turn {
		grid-template-columns: auto auto;
		justify-content: start;
		column-gap: 16px;
	}
	.grid.turn.two {
		grid-template-columns: auto auto auto;
	}
	.grid.vars {
		grid-template-columns: minmax(90px, max-content) 1fr;
	}
	.sw {
		width: 12px;
		height: 12px;
		border-radius: 2px;
		background:
			linear-gradient(var(--c), var(--c)),
			repeating-conic-gradient(#555 0 25%, #888 0 50%) 0 0 / 6px 6px;
	}
	h4 {
		margin: 12px 10px 4px;
		font-size: var(--ox-title-size);
		font-weight: 600;
	}
	.evals {
		list-style: none;
		margin: 0;
		padding: 0 6px;
	}
	.evals button {
		display: grid;
		grid-template-columns: 60px 1fr auto;
		gap: 8px;
		width: 100%;
		border: none;
		background: none;
		text-align: left;
		padding: 1px 6px;
		border-left: var(--ox-phase-bar) solid var(--phase);
		cursor: pointer;
	}
	.evals button:hover {
		background: var(--ox-hover);
	}
	.ph {
		color: var(--phase);
	}
	.lbl {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.res {
		color: var(--ox-lox);
	}
	.dim {
		color: var(--ox-text-dim);
		font-weight: 400;
	}
	.warn {
		color: var(--ox-warning);
	}
	.link {
		border: none;
		background: none;
		color: var(--ox-lox);
		cursor: pointer;
		padding: 0;
		margin-left: auto;
	}
	.logbar {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 8px 10px;
		color: var(--ox-haze);
	}
	.log {
		width: 100%;
		border-collapse: collapse;
	}
	.log th {
		text-align: left;
		font-weight: 500;
		color: var(--ox-text-dim);
		padding: 2px 8px;
	}
	.log td {
		padding: 1px 8px;
		border-top: 1px solid var(--ox-rule);
	}
	.log tr td:first-child {
		border-left: var(--ox-phase-bar) solid var(--phase);
	}
	.cell {
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
	}
	.pad {
		padding: 4px 10px;
	}
</style>
