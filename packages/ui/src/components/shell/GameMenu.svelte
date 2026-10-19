<script lang="ts">
	import type { GameLink, GameStatus } from '../../host';
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
			<p class="dim">{status.installs.length ? `Packs deploy to ${status.installs.join(', ')}.` : 'No Minecraft install found for deploying packs.'}</p>
			<div class="actions">
				<button class="primary" disabled={busy || !workspace.active || !status.installs.length} onclick={deployAndSpawn}>
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
		width: 340px;
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
