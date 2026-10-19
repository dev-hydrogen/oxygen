<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { PHASE_VAR } from '../../lib/molang-text';
	import Toggle from '../fields/Toggle.svelte';
	import { explainFacing } from '../../lib/facing-text';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let tab = $state<'particle' | 'log'>('particle');
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
	 * The variables and temps the selected particle's own expressions use, as its turn in the last frame left them:
	 * after its update (spawn, update and its events) and after its render. Variables belong to the emitter, so the
	 * shared state further down only shows what the last particle left; an index a particle takes from a counter
	 * shows here.
	 */
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
		for (const t of own) {
			const a = s.analysis.byPath.get(t.path)?.analysis;
			for (const u of [...(a?.writes ?? []), ...(a?.reads ?? [])]) if (u.ns === 'variable' || u.ns === 'temp') add(u.name);
		}
		const last = (render: boolean) => {
			for (let i = own.length - 1; i >= 0; i--) if ((own[i].phase === 'render') === render) return own[i];
			return null;
		};
		const value = (t: (typeof own)[number] | null, name: string) => {
			if (!t) return undefined;
			if (name.startsWith('temp.')) return t.temps.find(([k]) => k === name)?.[1];
			return t.varsAfter[name];
		};
		const update = last(false);
		const render = last(true);
		return { hasRender: !!render, rows: names.map((n) => ({ name: n, update: value(update, n), render: value(render, n) })) };
	});

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
				<p class="empty">Click a particle in the viewport to inspect it, or an emitter's marker to inspect the emitter. Values show up here and next to each name in the Molang editors.</p>
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
					<div class="grid ox-num">
						<span>State</span><span>{einfo.expired ? 'expired' : einfo.active ? 'active (spawning)' : 'sleeping'}{einfo.bound ? ', bound to its parent' : ''}</span>
						<span>Spawned by</span><span>{einfo.context}{einfo.loops ? ', loops' : ', plays one loop'}</span>
						<span>Lifetime</span><span>{einfo.lifetime}: active {f(einfo.activeTime)} s{einfo.sleepTime ? `, sleep ${f(einfo.sleepTime)} s` : ''}</span>
						<span>Age</span><span>{f(einfo.age)} s in loop {einfo.loop + 1} ({f(einfo.totalAge)} s in all)</span>
						<span>Rate</span><span>{einfo.rate}{einfo.rate === 'steady' || einfo.rate === 'manual' ? `, at most ${einfo.maxParticles} alive` : ''}</span>
						<span>Particles</span><span>{einfo.particles}</span>
						<span>Position</span><span>{einfo.pos.map((n) => f(n)).join(', ')}</span>
						<span>Travelled</span><span>{f(einfo.travelled)} blocks</span>
						<span>Randoms</span><span>{einfo.randoms.map((n) => f(n)).join(', ')}</span>
					</div>
					<h4>This frame, in order <span class="dim">(the emitter's own evaluations)</span></h4>
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
							<li class="dim">No evaluations recorded yet. Let the preview run a frame, or step.</li>
						{/each}
					</ol>
					<h4>Variables</h4>
					<div class="grid vars ox-num">
						{#each Object.entries(einfo.vars).filter(([k]) => !k.startsWith('variable.particle_')) as [k, v] (k)}
							<span class="ox-code">{short(k)}</span><span>{show(v)}</span>
						{:else}
							<span class="dim">none</span><span></span>
						{/each}
					</div>
					{#if einfo.temps.length}
						<h4>Temps <span class="dim">(global in-game)</span></h4>
						<div class="grid vars ox-num">
							{#each einfo.temps as [k, v] (k)}<span class="ox-code">{short(k)}</span><span>{show(v)}</span>{/each}
						</div>
					{/if}
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
				<div class="grid ox-num">
					<span>Age</span><span>{f(pinfo.age)} s{pinfo.lifetime !== null ? ` of ${f(pinfo.lifetime)} s` : ' (no max lifetime)'}</span>
					<span>Position</span><span>{pinfo.pos.map((n) => f(n)).join(', ')}{pinfo.local ? ' (emitter space)' : ''}</span>
					<span>Velocity</span><span>{pinfo.vel.map((n) => f(n)).join(', ')}</span>
					<span>Size</span><span>{pinfo.size.map((n) => f(n)).join(' × ')}</span>
					<span>Rotation</span><span>{f(pinfo.rot, 1)}°</span>
					<span>Facing dir</span><span>{pinfo.facing.map((n) => f(n)).join(', ')}</span>
					<span>Color</span><span class="col"><span class="sw" style:--c="rgba({pinfo.color[0]},{pinfo.color[1]},{pinfo.color[2]},{pinfo.color[3] / 255})"></span>{pinfo.color.join(', ')}</span>
					<span>UV</span><span>{pinfo.uv.map((n) => f(n, 4)).join(', ')}</span>
					<span>Randoms</span><span>{pinfo.randoms.map((n) => f(n)).join(', ')}</span>
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
						<li class="dim">No evaluations recorded yet. Let the preview run a frame, or step.</li>
					{/each}
				</ol>

				{#if turn?.rows.length}
					<h4>Its turn <span class="dim">(the values its own expressions left in the last frame)</span></h4>
					<div class="grid turn ox-num" class:two={turn.hasRender}>
						<span class="dim">Variable</span><span class="dim">After its update</span>{#if turn.hasRender}<span class="dim">After its render</span>{/if}
						{#each turn.rows as r (r.name)}
							<span class="ox-code">{short(r.name)}</span><span>{r.update === undefined ? '—' : show(r.update)}</span>{#if turn.hasRender}<span>{r.render === undefined ? '—' : show(r.render)}</span>{/if}
						{/each}
					</div>
				{/if}

				<h4>Variables <span class="dim">(shared by every particle of the emitter, as the last one left them)</span></h4>
				<div class="grid vars ox-num">
					{#each Object.entries(pinfo.vars).filter(([k]) => !k.startsWith('variable.particle_') && !k.startsWith('variable.emitter_')) as [k, v] (k)}
						<span class="ox-code">{short(k)}</span><span>{show(v)}</span>
					{:else}
						<span class="dim">none</span><span></span>
					{/each}
				</div>
				{#if pinfo.temps.length}
					<h4>Temps <span class="dim">(global in-game)</span></h4>
					<div class="grid vars ox-num">
						{#each pinfo.temps as [k, v] (k)}<span class="ox-code">{short(k)}</span><span>{show(v)}</span>{/each}
					</div>
				{/if}
			{/if}
		{:else}
			<div class="logbar">
				<Toggle checked={session.logging} label="Record every evaluation" onchange={(v) => session.setLogging(v)} />
				<span>Record every evaluation of the last frame{session.logging ? ` (${session.log.length.toLocaleString()} entries)` : ''}</span>
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
				<p class="empty">The log lists every Molang evaluation in the order the game runs them: emitter first, then each particle completely, then render preparation.</p>
			{/if}
		{/if}
	{/if}
</div>

<style>
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
	.grid > span:nth-child(odd) {
		color: var(--ox-haze);
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
	.col {
		display: flex;
		gap: 6px;
		align-items: center;
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
