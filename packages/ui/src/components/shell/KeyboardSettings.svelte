<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import { BROWSER_KEYS, chordOf, formatChord, heldKey, sameKeys, type KeyCommand } from '../../lib/keys';
	import Chord from './Chord.svelte';

	/** Settings › Keyboard: every command, its keys, and recording new ones */
	interface Props {
		workspace: Workspace;
		query: string;
	}

	let { workspace, query }: Props = $props();
	const km = $derived(workspace.keymap);

	/** the command whose keys are being recorded, and which of its keys a new one replaces */
	let recording = $state<{ id: string; replace: number | null } | null>(null);
	/** a lone modifier pressed while recording a held camera key: it's the binding if nothing follows */
	let pendingModifier: string | null = null;

	const GROUP_ORDER = ['File', 'Edit', 'Oxygen', 'Preview', 'View', 'Camera', 'Molang editors'];
	const SCOPE_NOTE: Record<string, string> = {
		Preview: 'Keys without Ctrl or Alt wait while a text field has focus',
		Camera: 'Held in the viewport. Shift and the like can be bound alone here.',
		'Molang editors': 'In Molang editors; Ctrl+Space, Ctrl+D, Ctrl+F and folding are the editor’s own',
	};

	const groups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const out = new Map<string, KeyCommand[]>();
		for (const c of km.commands) {
			const keys = km.keys(c.id);
			const text = `${c.group} ${c.label} ${keys.map((k) => `${k} ${formatChord(k, km.mac)}`).join(' ')}`.toLowerCase();
			if (q && !text.includes(q)) continue;
			if (!out.has(c.group)) out.set(c.group, []);
			out.get(c.group)!.push(c);
		}
		return [...out.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
	});

	const modifiedCount = $derived(Object.keys(workspace.prefs.keys).filter((id) => !km.isDefault(id)).length);

	function setKeys(id: string, keys: string[]) {
		const c = km.command(id);
		const next = { ...workspace.prefs.keys };
		if (c && sameKeys(keys, c.keys)) delete next[id];
		else next[id] = keys;
		workspace.prefs.keys = next;
	}

	function remove(id: string, i: number) {
		setKeys(
			id,
			km.keys(id).filter((_, k) => k !== i),
		);
	}

	function reset(id: string) {
		const next = { ...workspace.prefs.keys };
		delete next[id];
		workspace.prefs.keys = next;
	}

	function resetAll() {
		if (confirm('Put every key back to how Oxygen comes?')) workspace.prefs.keys = {};
	}

	function start(id: string, replace: number | null = null) {
		recording = { id, replace };
		pendingModifier = null;
		workspace.recordingKeys = true;
	}

	function stop() {
		recording = null;
		pendingModifier = null;
		workspace.recordingKeys = false;
	}

	function commit(chord: string) {
		if (!recording) return;
		const { id, replace } = recording;
		const keys = [...km.keys(id)];
		if (replace !== null) keys[replace] = chord;
		else keys.push(chord);
		setKeys(id, [...new Set(keys)]);
		stop();
	}

	const isModifier = (c: string) => c === 'Shift' || c === 'Alt' || c === 'Mod' || c === 'Ctrl' || c === 'Meta';

	function recordDown(e: KeyboardEvent) {
		if (!recording) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return stop();
		const camera = km.command(recording.id)?.scope === 'camera';
		const chord = camera ? heldKey(e, km.mac) : chordOf(e, km.mac);
		if (!chord) return;
		if (isModifier(chord)) {
			// a modifier alone binds only held camera keys (Shift to fly faster); elsewhere wait for the key it goes with
			if (camera) pendingModifier = chord;
			return;
		}
		commit(chord);
	}

	function recordUp(e: KeyboardEvent) {
		if (!recording) return;
		e.preventDefault();
		e.stopPropagation();
		if (pendingModifier) commit(pendingModifier);
	}

	$effect(() => {
		if (!recording) return;
		window.addEventListener('keydown', recordDown, true);
		window.addEventListener('keyup', recordUp, true);
		return () => {
			window.removeEventListener('keydown', recordDown, true);
			window.removeEventListener('keyup', recordUp, true);
		};
	});
	onDestroy(() => (workspace.recordingKeys = false));

	/** what else a chord does, and keys the host keeps */
	function warnings(c: KeyCommand, chord: string): string[] {
		const out = km.clashes(chord, c.id).map((w) => `also: ${w}`);
		if (workspace.host.kind === 'web' && BROWSER_KEYS.includes(chord)) out.push('the browser keeps this key for itself');
		return out;
	}
</script>

<div class="keys">
	<div class="head">
		<p class="intro">Click a key to change it, <span class="plus">+</span> to add another. Esc cancels. {#if modifiedCount}<span class="count">{modifiedCount} changed</span>{/if}</p>
		<button class="btn" disabled={!modifiedCount} onclick={resetAll}>Reset all keys</button>
	</div>
	{#each groups as [group, commands] (group)}
		<section>
			<h4>{group}{#if SCOPE_NOTE[group]}<span class="note">{SCOPE_NOTE[group]}</span>{/if}</h4>
			{#each commands as c (c.id)}
				{@const keys = km.keys(c.id)}
				{@const changed = !km.isDefault(c.id)}
				<div class="row" class:changed>
					<div class="what">
						<span class="label">{c.label}</span>
						{#if c.help}<span class="help">{c.help}</span>{/if}
						{#each keys as chord (chord)}
							{#each warnings(c, chord) as w (w)}<span class="warn">{formatChord(chord, km.mac)} {w}</span>{/each}
						{/each}
					</div>
					<div class="bound">
						{#each keys as chord, i (chord)}
							{#if recording?.id === c.id && recording.replace === i}
								<span class="listening" role="status">Press keys…</span>
							{:else}
								<span class="key">
									<button class="chip" title="Change this key" onclick={() => start(c.id, i)}><Chord {chord} mac={km.mac} /></button>
									<button class="x" aria-label="Remove {formatChord(chord, km.mac)}" title="Remove" onclick={() => remove(c.id, i)}>×</button>
								</span>
							{/if}
						{/each}
						{#if recording?.id === c.id && recording.replace === null}
							<span class="listening" role="status">Press keys…</span>
							<button class="small" onclick={stop}>Cancel</button>
						{:else}
							<button class="add" aria-label="Add a key for {c.label}" title="Add a key" onclick={() => start(c.id)}>+</button>
						{/if}
						{#if changed}<button class="small" title="Back to {c.keys.length ? c.keys.map((k) => formatChord(k, km.mac)).join(', ') : 'no key'}" onclick={() => reset(c.id)}>Reset</button>{/if}
					</div>
				</div>
			{/each}
		</section>
	{:else}
		<p class="none">No command matches “{query}”.</p>
	{/each}
</div>

<style>
	.keys {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.intro {
		margin: 0;
		flex: 1;
		color: var(--ox-haze);
	}
	.plus {
		font-weight: 600;
		color: var(--ox-frost);
	}
	.count {
		margin-left: 6px;
		color: var(--ox-lox);
	}
	h4 {
		margin: 0 0 4px;
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
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 30px;
		padding: 3px 8px;
		border-left: 2px solid transparent;
		border-radius: var(--ox-radius);
	}
	.row:hover {
		background: var(--ox-hover);
	}
	.row.changed {
		border-left-color: var(--ox-lox);
	}
	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.help {
		font-size: 11.5px;
		color: var(--ox-text-dim);
	}
	.warn {
		font-size: 11.5px;
		color: var(--ox-warning);
	}
	.bound {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.key {
		display: inline-flex;
		align-items: center;
	}
	.chip {
		border: 1px solid transparent;
		background: none;
		padding: 2px 3px;
		border-radius: var(--ox-radius);
		cursor: pointer;
	}
	.chip:hover {
		border-color: var(--ox-rule-strong);
	}
	.x {
		border: none;
		background: none;
		color: var(--ox-text-dim);
		cursor: pointer;
		padding: 0 3px;
		font-size: 14px;
		opacity: 0;
	}
	.key:hover .x,
	.x:focus-visible {
		opacity: 1;
	}
	.x:hover {
		color: var(--ox-error);
	}
	.add {
		width: 22px;
		height: 22px;
		border: 1px dashed var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		line-height: 1;
	}
	.add:hover {
		color: var(--ox-frost);
		border-color: var(--ox-haze);
	}
	.listening {
		padding: 1px 8px;
		border: 1px solid var(--ox-lox);
		border-radius: var(--ox-radius);
		color: var(--ox-lox);
		font-size: 11.5px;
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.55;
		}
	}
	.small,
	.btn {
		height: 22px;
		padding: 0 8px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		font-size: 11.5px;
	}
	.btn {
		height: 26px;
		font-size: inherit;
		padding: 0 12px;
	}
	.small:hover,
	.btn:hover:not(:disabled) {
		color: var(--ox-frost);
		background: var(--ox-hover);
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.none {
		color: var(--ox-haze);
	}
</style>
