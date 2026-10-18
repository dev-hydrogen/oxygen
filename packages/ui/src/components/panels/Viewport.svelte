<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { SPAWN_MODES, type SpawnMode } from '../../state/session.svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import { ViewportScene } from '../../viewport/scene';
	import { createMersProvider, createTextureProvider } from '../../lib/textures';
	import { readMeta, writeMeta } from '@oxygen/format';
	import type { GizmoHit, Gizmos } from '../../viewport/gizmos';
	import { SPEEDS } from '../../state/preferences';
	import { flyKeys } from '../../lib/keyboard';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	let canvas: HTMLCanvasElement;
	let wrap: HTMLDivElement;
	let scene: ViewportScene | null = null;
	let fps = $state(0);
	let downAt: [number, number] | null = null;
	let fpsTimer: ReturnType<typeof setInterval>;
	const session = $derived(workspace.active);

	onMount(() => {
		scene = new ViewportScene(canvas, { textures: createTextureProvider(workspace.host, () => workspace.active, () => workspace.packVersion), mers: createMersProvider(workspace.host, () => workspace.active, () => workspace.packVersion) });
		scene.setSession(workspace.active);
		if (import.meta.env?.DEV) (window as unknown as { __oxScene: unknown }).__oxScene = scene;
		const ro = new ResizeObserver(() => scene?.resize(wrap.clientWidth, wrap.clientHeight));
		ro.observe(wrap);
		scene.resize(wrap.clientWidth, wrap.clientHeight);
		scene.start();
		fpsTimer = setInterval(() => (fps = scene?.fps ?? 0), 500);
		return () => ro.disconnect();
	});

	$effect(() => {
		scene?.setSession(session);
	});

	// which helpers are drawn (kept with the preferences)
	$effect(() => {
		const g = { ...workspace.gizmos };
		if (scene) scene.gizmos = g;
	});

	// Settings › Viewport, and the keys bound to flying
	$effect(() => {
		const p = workspace.prefs;
		const controls = { fov: p.fov, turnSpeed: p.turnSpeed, invertY: p.invertY, zoomSpeed: p.zoomSpeed, flySpeed: p.flySpeed, fastFactor: p.fastFactor, resolution: p.resolution, background: p.background, flyKeys: flyKeys(workspace.keymap) };
		scene?.setControls(controls);
	});
	const km = $derived(workspace.keymap);

	let showOpen = $state(false);
	const GIZMOS: { key: keyof Gizmos; label: string; help: string }[] = [
		{ key: 'ground', label: 'Ground grid', help: "The ground plane's grid (particles still collide with it)" },
		{ key: 'block', label: 'Reference block', help: 'A one-block outline, for scale' },
		{ key: 'emitter', label: 'Emitter', help: "The effect's own emitter: its axes and ring. Click it to inspect the emitter." },
		{ key: 'children', label: 'Child emitters', help: 'Emitters its events spawn. Click one to inspect it.' },
		{ key: 'killPlane', label: 'Kill plane', help: 'Where the kill plane component removes particles' },
		{ key: 'entity', label: 'Entity', help: 'The stand-in entity, its locator and its path, when the effect is spawned on it' },
	];

	/** a click on something other than a particle: inspect it */
	function openGizmo(hit: GizmoHit) {
		const s = session;
		if (!s) return;
		if (hit.kind === 'emitter') {
			s.select({ emitter: hit.id, particle: -1 });
			workspace.show('debug');
		} else if (hit.kind === 'killPlane') {
			s.selected = 'particle_effect/components/minecraft:particle_kill_plane';
			workspace.show('inspector');
		} else if (hit.kind === 'shape') {
			const comps = Object.keys((s.doc.get('particle_effect/components') as object | undefined) ?? {});
			const shape = comps.find((k) => k.startsWith('minecraft:emitter_shape_'));
			if (shape) s.selected = `particle_effect/components/${shape}`;
			workspace.show('inspector');
		} else if (hit.kind === 'entity') workspace.show('scene');
	}

	$effect(() => {
		const m = workspace.renderMode;
		const sky = workspace.vvSky;
		if (scene) {
			scene.renderMode = m;
			scene.vvSky = sky;
		}
	});

	// "Frame the particles" from the command palette
	$effect(() => {
		if (workspace.frameRequest) scene?.frameAll();
	});

	$effect(() => {
		scene?.setSuspended(workspace.suspended);
	});

	onDestroy(() => {
		clearInterval(fpsTimer);
		scene?.dispose();
	});

	const speeds = SPEEDS;
	let viewsOpen = $state(false);
	const views = $derived.by(() => {
		void session?.version;
		return session ? (readMeta(session.doc).cameras ?? []) : [];
	});

	function saveView() {
		if (!session || !scene) return;
		const name = `View ${views.length + 1}`;
		writeMeta(session.doc, 'cameras', [...views, { name, ...scene.view() }], 'Save view');
	}

	function removeView(i: number) {
		if (!session) return;
		const next = views.filter((_, k) => k !== i);
		writeMeta(session.doc, 'cameras', next.length ? next : undefined, 'Remove view');
	}
</script>

<div class="viewport" bind:this={wrap}>
	<canvas
		bind:this={canvas}
		aria-label="Particle preview. Click a particle to inspect it."
		tabindex="0"
		onpointerdown={(e) => (downAt = [e.clientX, e.clientY])}
		onpointerup={(e) => {
			if (!downAt || !session || !scene) return;
			const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
			downAt = null;
			if (moved > 4 || e.button !== 0) return;
			const r = canvas.getBoundingClientRect();
			if (session.painting) {
				scene.paint(e.clientX - r.left, e.clientY - r.top, e.shiftKey);
				return;
			}
			const x = e.clientX - r.left;
			const y = e.clientY - r.top;
			// an emitter marker right under the pointer wins over the particles around it
			const marker = scene.pickGizmo(x, y, 'emitter');
			if (marker) return openGizmo(marker);
			const hit = scene.pick(x, y);
			if (hit) {
				session.select(hit);
				workspace.show('debug');
				return;
			}
			const other = scene.pickGizmo(x, y, 'other');
			if (other) return openGizmo(other);
			session.select(null);
		}}
	></canvas>

	{#if session}
		<div class="bar top">
			<button class="tool" aria-label={session.playing ? 'Pause' : session.finished ? 'Replay' : 'Play'} title={km.title(session.playing ? 'Pause' : session.finished ? 'Replay from the start' : 'Play', 'preview.play')} onclick={() => session.togglePlay()}>
				{#if session.playing}
					<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2" width="2.5" height="8" fill="currentColor" /><rect x="7" y="2" width="2.5" height="8" fill="currentColor" /></svg>
				{:else if session.finished}
					<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.5a3.5 3.5 0 1 0 1.1-3" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M2.2 1.6v2.8H5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
				{:else}
					<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" fill="currentColor" /></svg>
				{/if}
			</button>
			<button class="tool" aria-label="Step one frame" title={km.title('Step one frame', 'preview.step')} disabled={session.playing} onclick={() => session.stepFrame()}>
				<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2l5 4-5 4z" fill="currentColor" /><rect x="8.5" y="2" width="1.5" height="8" fill="currentColor" /></svg>
			</button>
			<button class="tool" aria-label="Restart" title={km.title('Restart', 'preview.restart')} onclick={() => session.restart()}>
				<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 6a3.5 3.5 0 1 1-1.1-2.55" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M9.8 1.5v2.8H7" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
			</button>
			<span class="sep"></span>
			<label class="mini">
				<span class="sr">Speed</span>
				<select value={session.speed} onchange={(e) => (session.speed = Number(e.currentTarget.value))} title="Playback speed">
					{#each speeds as s (s)}<option value={s}>{s}×</option>{/each}
				</select>
			</label>
			<label class="mini">
				<span class="sr">Spawned by</span>
				<select value={session.spawnMode} onchange={(e) => session.setSpawnMode(e.currentTarget.value as SpawnMode)} title={SPAWN_MODES.find((m) => m.id === session.spawnMode)?.help}>
					{#each SPAWN_MODES as m (m.id)}<option value={m.id} title={m.help}>{m.label}</option>{/each}
				</select>
			</label>
			<span class="sep"></span>
			<label class="mini">
				<span class="sr">Rendering</span>
				<select value={workspace.renderMode} onchange={(e) => (workspace.renderMode = e.currentTarget.value as 'classic' | 'vv' | 'split')} title="Vibrant Visuals is an approximation from the pack's lighting, grading and texture sets">
					<option value="classic">Classic</option>
					<option value="vv">Vibrant Visuals</option>
					<option value="split">Classic | Vibrant</option>
				</select>
			</label>
			{#if workspace.renderMode !== 'classic'}
				<button class="tool text" class:on={workspace.vvSky} aria-pressed={workspace.vvSky} title={workspace.vvSky ? "Vibrant Visuals shows the game's sky behind the particles. Turn off to keep the classic background, so only the particles differ." : 'Vibrant Visuals keeps the classic background, so only the particles differ. Turn on for the sky the game shows behind them.'} onclick={() => (workspace.vvSky = !workspace.vvSky)}>Sky</button>
			{/if}
			<div class="views">
				<button class="tool text" aria-expanded={showOpen} title="Choose which helpers the viewport draws" onclick={() => (showOpen = !showOpen)}>Show ▾</button>
				{#if showOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="menu left" role="menu" tabindex="-1" onpointerleave={() => (showOpen = false)}>
						<p class="vhead">This effect</p>
						{#each [{ on: session.showShape, label: 'Emitter shape', help: 'Outline the shape particles spawn in. Click it to edit the shape.', flip: () => (session.showShape = !session.showShape) }, { on: session.showPaths, label: 'Trajectory paths', help: 'Where sample particles travel over their lifetime', flip: () => (session.showPaths = !session.showPaths) }, { on: session.showFacing, label: 'Facing axes', help: 'How particles are oriented: their axes (X red, Y green, face blue) and the direction they were built from (amber)', flip: () => (session.showFacing = !session.showFacing) }, { on: session.showVelocity, label: 'Velocity arrows', help: 'Particle velocities: each line covers the next quarter second', flip: () => (session.showVelocity = !session.showVelocity) }] as o (o.label)}
							<button role="menuitemcheckbox" aria-checked={o.on} class="vitem check" title={o.help} onclick={o.flip}><span class="tick">{o.on ? '✓' : ''}</span>{o.label}</button>
						{/each}
						<p class="vhead">Scene</p>
						{#each GIZMOS as g (g.key)}
							<button role="menuitemcheckbox" aria-checked={workspace.gizmos[g.key]} class="vitem check" title={g.help} onclick={() => (workspace.gizmos = { ...workspace.gizmos, [g.key]: !workspace.gizmos[g.key] })}><span class="tick">{workspace.gizmos[g.key] ? '✓' : ''}</span>{g.label}</button>
						{/each}
						<p class="vnone">Click an emitter, the shape, the kill plane or the entity to inspect it.</p>
					</div>
				{/if}
			</div>
			<button class="tool text" class:on={session.loopPreview} aria-pressed={session.loopPreview} title="Repeat: looping effects loop seamlessly, as they do on an entity (in-game, /particle plays a looping effect once); other effects play again when they end." onclick={() => (session.loopPreview = !session.loopPreview)}>Repeat</button>
		</div>
		<div class="bar right">
			<div class="views">
				<button class="tool text" aria-expanded={viewsOpen} title="Saved camera views" onclick={() => (viewsOpen = !viewsOpen)}>Views</button>
				{#if viewsOpen}
					<div class="menu" role="menu">
						{#each views as v, i (i)}
							<div class="vrow">
								<button role="menuitem" class="vitem" onclick={() => { scene?.setView(v); viewsOpen = false; }}>{v.name}</button>
								<button class="vx" aria-label="Remove {v.name}" onclick={() => removeView(i)}>×</button>
							</div>
						{:else}
							<p class="vnone">No saved views yet.</p>
						{/each}
						<button class="vitem save" onclick={saveView}>Save this view</button>
						<p class="vnone">Views are stored in the file's oxygen block. Drag orbits around what's under the cursor; right drag looks around (hold {['forward', 'left', 'back', 'right'].map((a) => km.label(`camera.${a}`) ?? '').join(' ')} to fly).</p>
					</div>
				{/if}
			</div>
			<button class="tool text" title={km.title('Frame the particles', 'preview.frame')} onclick={() => scene?.frameAll()}>Frame</button>
		</div>
		{#if workspace.renderMode === 'split'}
			<div class="splitline" aria-hidden="true"></div>
			<span class="splitlabel left">Classic</span>
			<span class="splitlabel right">Vibrant Visuals (approximate)</span>
		{/if}
		{#if session.finished}
			<div class="ended" class:raised={session.historyRange.to - session.historyRange.from > 0.2}>
				<span>The effect ended at <span class="ox-num">{session.stats.time.toFixed(2)} s</span>: nothing it spawned is still alive.</span>
				<button class="tool text on" onclick={() => session.togglePlay()}>Replay</button>
				<button class="tool text" title="Play it again whenever it ends" onclick={() => (session.loopPreview = true)}>Repeat</button>
			</div>
		{/if}
		{#if !session.playing && session.historyRange.to - session.historyRange.from > 0.2}
			<div class="scrub">
				<span class="dim ox-num">{session.stats.time.toFixed(2)} s</span>
				<input
					type="range"
					min={session.historyRange.from}
					max={session.historyRange.to}
					step="0.01"
					value={session.stats.time}
					aria-label="Scrub through the last seconds"
					oninput={(e) => session.scrubTo(Number(e.currentTarget.value))}
				/>
				<span class="dim">Drag to go back; playing continues from there</span>
			</div>
		{/if}
		<div class="hud ox-num" aria-live="off">
			<span class:warn={session.stats.capHit} title={session.stats.capHit ? 'An emitter is at the live particle cap: new particles are blocked, like in-game' : 'Live particles / cap per emitter'}>
				{session.stats.particles.toLocaleString()} <span class="dim">/ {session.stats.cap.toLocaleString()}</span>
			</span>
			{#if workspace.prefs.showFps}<span class="dim" data-fps={fps}>{fps} fps</span>{/if}
		</div>
	{:else}
		<div class="empty">
			<p>Open a particle file or start a new effect to see it here.</p>
		</div>
	{/if}
</div>

<style>
	.viewport {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #161a26;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		outline: none;
	}
	.bar {
		position: absolute;
		top: 8px;
		display: flex;
		align-items: center;
		gap: 2px;
		background: rgba(26, 30, 44, 0.86);
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius-float);
		padding: 2px;
		backdrop-filter: blur(6px);
	}
	.bar.top {
		left: 8px;
		/* wraps instead of running under Views and Frame in a narrow viewport */
		flex-wrap: wrap;
		max-width: calc(100% - 150px);
	}
	.bar.right {
		right: 8px;
	}
	.tool {
		height: 24px;
		min-width: 24px;
		border: none;
		background: none;
		color: var(--ox-haze);
		border-radius: var(--ox-radius);
		cursor: pointer;
		display: grid;
		place-items: center;
		padding: 0 4px;
	}
	.tool.text {
		padding: 0 8px;
	}
	.tool svg {
		width: 12px;
		height: 12px;
	}
	.tool:hover:not(:disabled) {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.tool:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.tool.on {
		color: var(--ox-lox);
	}
	.sep {
		width: 1px;
		height: 16px;
		background: var(--ox-rule-strong);
		margin: 0 3px;
	}
	.mini select {
		appearance: none;
		height: 24px;
		background: none;
		border: none;
		color: var(--ox-frost);
		padding: 0 6px;
		border-radius: var(--ox-radius);
		cursor: pointer;
	}
	.mini select:hover {
		background: var(--ox-hover);
	}
	.mini option {
		background: var(--ox-float);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.views {
		position: relative;
	}
	.menu {
		position: absolute;
		right: 0;
		top: 30px;
		z-index: 10;
		min-width: 200px;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		padding: 4px;
	}
	.menu.left {
		right: auto;
		left: 0;
		min-width: 220px;
	}
	.vhead {
		margin: 6px 8px 2px;
		font-size: 11px;
		color: var(--ox-text-dim);
	}
	.vitem.check {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tick {
		width: 12px;
		color: var(--ox-lox);
	}
	.vrow {
		display: flex;
	}
	.vitem {
		flex: 1;
		text-align: left;
		border: none;
		background: none;
		padding: 4px 8px;
		border-radius: var(--ox-radius);
		cursor: pointer;
		width: 100%;
	}
	.vitem:hover {
		background: var(--ox-selection);
	}
	.vitem.save {
		color: var(--ox-lox);
	}
	.vx {
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		width: 24px;
	}
	.vnone {
		margin: 4px 8px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.scrub {
		position: absolute;
		left: 50%;
		bottom: 8px;
		transform: translateX(-50%);
		display: flex;
		gap: 10px;
		align-items: center;
		background: rgba(26, 30, 44, 0.86);
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius-float);
		padding: 4px 10px;
		width: min(560px, 70%);
		font-size: 12px;
	}
	.ended {
		position: absolute;
		left: 50%;
		bottom: 8px;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		align-items: center;
		background: rgba(26, 30, 44, 0.92);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		padding: 3px 4px 3px 12px;
		font-size: 12px;
		white-space: nowrap;
		max-width: calc(100% - 16px);
	}
	.ended.raised {
		bottom: 48px;
	}
	.ended > span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.scrub input {
		flex: 1;
		accent-color: var(--ox-lox);
	}
	.splitline {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 1px;
		background: var(--ox-rule-strong);
		pointer-events: none;
	}
	.splitlabel {
		position: absolute;
		bottom: 30px;
		color: var(--ox-haze);
		font-size: 11.5px;
		pointer-events: none;
	}
	.splitlabel.left {
		right: calc(50% + 10px);
	}
	.splitlabel.right {
		left: calc(50% + 10px);
	}
	.hud {
		position: absolute;
		left: 10px;
		bottom: 8px;
		display: flex;
		gap: 12px;
		color: var(--ox-frost);
		font-size: 12px;
		pointer-events: none;
	}
	.dim {
		color: var(--ox-haze);
	}
	.warn {
		color: var(--ox-warning);
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--ox-haze);
		pointer-events: none;
	}
</style>
