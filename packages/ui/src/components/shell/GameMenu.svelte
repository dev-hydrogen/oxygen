<script lang="ts">
	import type { DeployPaths, GameLink, GameStatus } from '../../host';
	import type { Workspace } from '../../state/workspace.svelte';
	import { flushEdits } from '../../lib/flush';
	import { isContextKey, isTempKey, scenarioVariables } from '../../lib/inputs';

	interface Props {
		workspace: Workspace;
		game: GameLink;
	}

	let { workspace, game }: Props = $props();
	let open = $state(false);
	let status = $state<GameStatus>({ connected: false, port: 19131, installs: [] });
	let note = $state<string | null>(null);
	let busy = $state(false);

	$effect(() => {
		void game.status().then((s) => (status = s));
		game.onStatus((s) => (status = s));
	});

	async function run(what: () => Promise<string>) {
		busy = true;
		try {
			note = await what();
		} catch (e) {
			note = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	/** the paths being set by hand (Deploy to › Custom paths), until they're used or the edit is cancelled */
	let editing = $state<{ resource: string; behavior: string; logs: string } | null>(null);
	const targetValue = $derived(editing || status.target?.custom ? 'custom' : status.target ? `install:${status.target.name}` : '');
	const PATHS: { key: keyof DeployPaths; label: string; help: string }[] = [
		{ key: 'resource', label: 'Resource packs', help: 'The folder resource packs are copied into' },
		{ key: 'behavior', label: 'Behavior packs', help: "The folder Oxygen Link (a behavior pack, for spawning with a scenario's variables) is copied into. Empty: it isn't deployed." },
		{ key: 'logs', label: 'Content log', help: "A folder of ContentLog files, or one log file, for the game's errors in Problems. Empty: none." },
	];

	async function chooseTarget(el: HTMLSelectElement) {
		const v = el.value;
		if (v === 'custom') {
			// start from where packs go now, so one path can change and the rest stay
			const p = status.target?.paths;
			editing = { resource: p?.resource ?? '', behavior: p?.behavior ?? '', logs: p?.logs ?? '' };
			return;
		}
		editing = null;
		if (!game.setDeployTarget) return;
		await run(async () => {
			status = await game.setDeployTarget!({ install: v.slice('install:'.length) });
			return `Packs deploy to ${status.target?.name ?? 'nowhere'} now.`;
		});
	}

	async function browse(key: keyof DeployPaths) {
		if (!editing || !game.pickPath) return;
		const picked = await game.pickPath(key, editing[key] || null);
		if (!picked || !editing) return;
		editing[key] = picked;
		// a resource packs folder suggests the rest, where they're still empty
		if (key === 'resource' && game.suggestPaths && (!editing.behavior || !editing.logs)) {
			const s = await game.suggestPaths(picked);
			if (editing && !editing.behavior) editing.behavior = s.behavior ?? '';
			if (editing && !editing.logs) editing.logs = s.logs ?? '';
		}
	}

	async function usePaths() {
		const e = editing;
		if (!e || !e.resource.trim() || !game.setDeployTarget) return;
		await run(async () => {
			status = await game.setDeployTarget!({ paths: { resource: e.resource.trim(), behavior: e.behavior.trim() || null, logs: e.logs.trim() || null } });
			editing = null;
			return 'Packs deploy to the paths you set now.';
		});
	}

	/** The active scenario's variables, as a Script API variable map can carry them (numbers only) */
	function spawnVariables(): { vars: Record<string, number> | undefined; dropped: string[] } {
		const s = workspace.active;
		const sc = s?.scenario;
		if (!s || !sc) return { vars: undefined, dropped: [] };
		const all = scenarioVariables(sc, s.inputScene()) ?? {};
		const vars: Record<string, number> = {};
		const dropped: string[] = [];
		for (const [k, v] of Object.entries(all)) {
			if (typeof v === 'number') vars[k] = v;
			else dropped.push(k);
		}
		// temps live in the game's shared store and context values come from the caller; a script's variable map can set neither
		for (const k of Object.keys(sc.variables ?? {})) if (isTempKey(k) || isContextKey(k)) dropped.push(k);
		return { vars: Object.keys(vars).length ? vars : undefined, dropped };
	}

	/** The effect, with the scenario's variables, plus the other effects in its scene at their offsets */
	async function spawn(identifier: string): Promise<string> {
		const { vars, dropped } = spawnVariables();
		let out = await game.spawn(identifier, vars);
		const extras = workspace.active?.scene.extras ?? [];
		for (const x of extras) await game.spawn(x.effect, undefined, x.position);
		if (extras.length) out += ` Also spawned ${extras.length === 1 ? extras[0].effect : `${extras.length} other effects`} from the scene.`;
		return dropped.length ? `${out} Text variables can't go in a variable map, so ${dropped.join(', ')} ${dropped.length === 1 ? 'was' : 'were'} left out.` : out;
	}

	async function deployAndSpawn() {
		const s = workspace.active;
		if (!s) return;
		flushEdits();
		if (s.dirty) await workspace.save(s);
		await run(async () => {
			const deployed = await game.deploy(s.file);
			if (!status.connected) return `${deployed} Connect Minecraft to spawn it from here.`;
			await game.reload();
			const spawned = await spawnAfterReload(s.identifier);
			return `${deployed} ${spawned}`;
		});
	}

	/** While a reload runs, the game answers commands with "Unknown command": wait it out (up to 30 s) */
	async function spawnAfterReload(identifier: string): Promise<string> {
		let out = '';
		for (let i = 0; i < 30; i++) {
			out = await spawn(identifier);
			if (!/unknown command/i.test(out)) return out;
			note = 'Waiting for the game to finish reloading…';
			await new Promise((r) => setTimeout(r, 1000));
		}
		return out;
	}
</script>

<div class="wrap">
	<button class="btn" class:live={status.connected} aria-expanded={open} onclick={() => (open = !open)}>
		<span class="dot" aria-hidden="true"></span>
		Game
	</button>
	{#if open}
		<div class="menu" role="dialog" aria-label="Game link">
			<p class="state">
				{#if status.connected}
					Connected to Minecraft.
				{:else}
					{#if status.error}<span class="err">The game link can't listen: {status.error}.</span>{/if}
					Not connected. In Minecraft, run <code class="ox-code">/connect localhost:{status.port}</code> to spawn effects from Oxygen.
				{/if}
			</p>
			{#if game.setDeployTarget}
				<label class="target">
					<span>Deploy to</span>
					<select value={targetValue} onchange={(e) => chooseTarget(e.currentTarget)} disabled={busy} aria-label="Deploy packs to">
						{#each status.installs as name (name)}<option value="install:{name}">{name}</option>{/each}
						{#if !status.target && !editing}<option value="" disabled>Nowhere yet</option>{/if}
						<option value="custom">Custom paths…</option>
					</select>
				</label>
				{#if editing}
					<div class="paths" role="group" aria-label="Custom paths">
						{#each PATHS as p (p.key)}
							<label class="pathrow" title={p.help}>
								<span>{p.label}</span>
								<input class="ox-code" bind:value={editing[p.key]} placeholder={p.key === 'resource' ? 'Required' : 'None'} spellcheck="false" />
								{#if game.pickPath}<button class="secondary small" onclick={() => browse(p.key)}>Browse…</button>{/if}
							</label>
						{/each}
						<div class="actions">
							<button class="primary" disabled={busy || !editing.resource.trim()} onclick={usePaths}>Use these paths</button>
							<button class="secondary" onclick={() => (editing = null)}>Cancel</button>
						</div>
					</div>
				{:else if status.target}
					{@const t = status.target}
					<dl class="dim shown">
						{#each PATHS as p (p.key)}
							<dt>{p.label}</dt>
							<dd class="ox-code" title={t.paths[p.key] ?? 'None'}>{t.paths[p.key] ?? 'None'}</dd>
						{/each}
					</dl>
					{#if t.custom}<button class="link" onclick={() => (editing = { resource: t.paths.resource, behavior: t.paths.behavior ?? '', logs: t.paths.logs ?? '' })}>Edit paths</button>{/if}
				{/if}
			{:else}
				<p class="dim">{status.installs.length ? `Packs deploy to ${status.installs.join(', ')}.` : 'No Minecraft install found for deploying packs.'}</p>
			{/if}
			<div class="actions">
				<button class="primary" disabled={busy || !workspace.active || !(status.target ?? status.installs.length)} onclick={deployAndSpawn}>
					{status.connected ? 'Deploy and spawn' : 'Deploy pack'}
				</button>
				<button class="secondary" disabled={busy || !status.connected || !workspace.active} onclick={() => run(() => spawn(workspace.active!.identifier))}>Spawn again</button>
				<button class="secondary" disabled={busy || !status.connected} onclick={() => run(() => game.reload())}>Reload packs</button>
			</div>
			{#if workspace.active?.scenario}
				<p class="dim">
					Spawns with scenario “{workspace.active.scenario.name}” variables through the Oxygen Link behavior pack, which deploys with your pack. Turn it on once per world: Edit world → Behavior packs → Available → Oxygen Link. Minecraft lists new packs after it rescans, which opening that screen does.
				</p>
			{/if}
			{#if note}<p class="note" role="status">{note}</p>{/if}
			<p class="dim">The game's content log shows up in Problems as “Game” entries for open files.</p>
		</div>
	{/if}
</div>

<style>
	.target {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}
	.target select {
		flex: 1;
		min-width: 0;
		height: 24px;
		background: var(--ox-input);
		color: var(--ox-frost);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
	}
	.paths {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.pathrow {
		display: grid;
		grid-template-columns: 92px 1fr auto;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
	}
	.pathrow input {
		min-width: 0;
		height: 24px;
		background: var(--ox-input);
		color: var(--ox-frost);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		padding: 0 6px;
	}
	.small {
		height: 24px;
		padding: 0 8px;
	}
	.shown {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 8px;
		margin: 0;
	}
	.shown dd {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.link {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--ox-lox);
		cursor: pointer;
		padding: 0;
		font-size: 11.5px;
	}
	.link:hover {
		text-decoration: underline;
	}
	.err {
		display: block;
		color: var(--ox-error);
		margin-bottom: 4px;
	}
	.wrap {
		position: relative;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 12px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
		color: var(--ox-frost);
	}
	.btn:hover {
		background: var(--ox-hover);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ox-text-dim);
	}
	.btn.live .dot {
		background: var(--ox-phase-particle);
	}
	.menu {
		position: absolute;
		right: 0;
		top: 32px;
		z-index: 100;
		width: 400px;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	p {
		margin: 0;
	}
	.dim {
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	code {
		background: var(--ox-input);
		padding: 0 4px;
		border-radius: 2px;
	}
	.actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin: 4px 0;
	}
	.primary,
	.secondary {
		height: 26px;
		padding: 0 10px;
		border-radius: var(--ox-radius);
		cursor: pointer;
	}
	.primary {
		background: var(--ox-lox);
		color: #10131c;
		border: none;
		font-weight: 600;
	}
	.secondary {
		background: none;
		border: 1px solid var(--ox-rule-strong);
		color: var(--ox-frost);
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.note {
		color: var(--ox-frost);
		font-size: 12px;
	}
</style>
