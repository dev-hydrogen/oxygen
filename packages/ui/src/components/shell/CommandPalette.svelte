<script lang="ts">
	import { COMPONENTS, componentInsertionIndex } from '@oxygen/format';
	import { tick } from 'svelte';
	import { SPAWN_MODES } from '../../state/session.svelte';
	import { LAYOUTS, type Workspace } from '../../state/workspace.svelte';
	import { componentPath } from '../../lib/molang-text';
	import { closeEffect, copyShareLink, save } from '../../lib/actions';
	import { runCommand } from '../../lib/commands';

	interface Props {
		workspace: Workspace;
		panels: Record<string, { title: string }>;
	}

	let { workspace, panels }: Props = $props();
	let query = $state('');
	let index = $state(0);
	let input = $state<HTMLInputElement>();

	interface Command {
		label: string;
		group: string;
		keys?: string;
		run: () => void | Promise<void>;
	}

	const commands = $derived.by((): Command[] => {
		const s = workspace.active;
		const km = workspace.keymap;
		const k = (id: string) => km.label(id);
		const list: Command[] = [
			{ label: 'New effect', group: 'File', keys: k('file.new'), run: () => void workspace.newEffect() },
			{ label: 'Save', group: 'File', keys: k('file.save'), run: () => save(workspace) },
		];
		if (workspace.host.saveAs) list.push({ label: 'Save as…', group: 'File', keys: k('file.saveAs'), run: () => save(workspace, true) });
		if (workspace.host.download) list.push({ label: 'Download a copy', group: 'File', keys: workspace.host.saveAs ? undefined : k('file.saveAs'), run: () => workspace.download() });
		if (workspace.sessions.length && workspace.host.kind !== 'vscode') list.push({ label: 'Close effect', group: 'File', keys: k('file.close'), run: () => closeEffect(workspace) });
		if (workspace.sessions.length > 1) {
			list.push({ label: 'Next open effect', group: 'File', keys: k('file.nextEffect'), run: () => void runCommand(workspace, 'file.nextEffect') });
			list.push({ label: 'Previous open effect', group: 'File', keys: k('file.previousEffect'), run: () => void runCommand(workspace, 'file.previousEffect') });
		}
		if (workspace.host.openFiles) list.push({ label: 'Open files…', group: 'File', keys: k('file.open'), run: () => workspace.openFiles() });
		if (workspace.host.openPack) list.push({ label: 'Open resource pack folder…', group: 'File', keys: k('file.openPack'), run: () => workspace.openPack() });
		for (const [id, p] of Object.entries(panels)) {
			const shown = workspace.openPanels.includes(id);
			list.push({ label: `${shown ? 'Hide' : 'Show'} ${p.title}`, group: 'View', keys: k(`view.panel.${id}`), run: () => (shown ? workspace.hide(id) : workspace.show(id)) });
		}
		for (const l of LAYOUTS) list.push({ label: `Layout: ${l.label}`, group: 'View', keys: k(`view.layout.${l.id}`), run: () => void (workspace.layoutRequest = { name: l.id, at: Date.now() }) });
		list.push({ label: 'Inspector: categories', group: 'View', keys: k('view.inspector.categories'), run: () => void (workspace.inspectorView = 'categories') });
		list.push({ label: 'Inspector: phases', group: 'View', keys: k('view.inspector.phases'), run: () => void (workspace.inspectorView = 'phases') });
		list.push({ label: 'Settings', group: 'Oxygen', keys: k('app.settings'), run: () => workspace.openSettings() });
		list.push({ label: 'Settings: keyboard shortcuts', group: 'Oxygen', run: () => workspace.openSettings('keyboard') });
		list.push({ label: 'Settings: preview', group: 'Oxygen', run: () => workspace.openSettings('preview') });
		list.push({ label: 'Settings: viewport and camera', group: 'Oxygen', run: () => workspace.openSettings('viewport') });
		list.push({ label: 'About Oxygen', group: 'Help', keys: k('app.about'), run: () => workspace.openAbout('about') });
		list.push({ label: "What's new", group: 'Help', run: () => workspace.openAbout('new') });
		list.push({ label: 'System information', group: 'Help', run: () => workspace.openAbout('system') });
		list.push({ label: 'Keyboard shortcuts', group: 'Help', keys: k('app.shortcuts'), run: () => void (workspace.shortcutsOpen = true) });
		if (s) {
			list.push({ label: s.playing ? 'Pause' : s.finished ? 'Replay' : 'Play', group: 'Preview', keys: k('preview.play'), run: () => s.togglePlay() });
			if (!s.playing) list.push({ label: 'Step one frame', group: 'Preview', keys: k('preview.step'), run: () => s.stepFrame() });
			list.push({ label: 'Restart preview', group: 'Preview', keys: k('preview.restart'), run: () => s.restart() });
			list.push({ label: s.loopPreview ? 'Stop repeating the effect' : 'Repeat the effect', group: 'Preview', keys: k('preview.repeat'), run: () => void (s.loopPreview = !s.loopPreview) });
			list.push({ label: 'Slower playback', group: 'Preview', keys: k('preview.slower'), run: () => void runCommand(workspace, 'preview.slower') });
			list.push({ label: 'Faster playback', group: 'Preview', keys: k('preview.faster'), run: () => void runCommand(workspace, 'preview.faster') });
			list.push({ label: s.showFacing ? 'Hide facing axes' : 'Show facing axes', group: 'Preview', keys: k('preview.facing'), run: () => void (s.showFacing = !s.showFacing) });
			list.push({ label: s.showPaths ? 'Hide trajectory paths' : 'Show trajectory paths', group: 'Preview', keys: k('preview.paths'), run: () => void (s.showPaths = !s.showPaths) });
			list.push({ label: s.showVelocity ? 'Hide velocity arrows' : 'Show velocity arrows', group: 'Preview', keys: k('preview.velocity'), run: () => void (s.showVelocity = !s.showVelocity) });
			list.push({ label: s.showShape ? 'Hide emitter shape' : 'Show emitter shape', group: 'Preview', keys: k('preview.shape'), run: () => void (s.showShape = !s.showShape) });
			list.push({ label: 'Frame the particles', group: 'Preview', keys: k('preview.frame'), run: () => void (workspace.frameRequest = Date.now()) });
			list.push({
				label: 'Find uses of a variable…',
				group: 'Edit',
				keys: k('edit.findVariable'),
				run: () => {
					s.programFilter = 'v.';
					s.referencesRequest = { name: 'v.', at: Date.now() };
				},
			});
			for (const m of SPAWN_MODES) list.push({ label: `Spawn as ${m.label}`, group: 'Preview', keys: k(`preview.spawn.${m.id}`), run: () => s.setSpawnMode(m.id) });
			if (workspace.host.kind === 'web')
				list.push({
					label: 'Copy share link',
					group: 'File',
					keys: k('file.share'),
					run: () => copyShareLink(workspace),
				});
			list.push({ label: 'Undo', group: 'Edit', keys: k('edit.undo'), run: () => workspace.undo(s) });
			list.push({ label: 'Redo', group: 'Edit', keys: k('edit.redo'), run: () => workspace.redo(s) });
			const present = Object.keys((s.doc.get('particle_effect/components') as object) ?? {});
			const groups = new Set(COMPONENTS.filter((c) => present.includes(c.id) && c.group).map((c) => c.group));
			for (const c of COMPONENTS) {
				if (present.includes(c.id) || (c.group && groups.has(c.group))) continue;
				list.push({
					label: `Add ${c.label}`,
					group: 'Component',
					run: () => {
						const initial = c.valueShape === 'molang-or-vec' ? 1 : c.valueShape === 'plane' ? [0, 1, 0, 0] : c.valueShape === 'blocks' ? ['minecraft:water'] : {};
						s.doc.set(componentPath(c.id), initial, `Add ${c.label}`, componentInsertionIndex(c.id));
					},
				});
			}
		}
		return list;
	});

	function score(label: string, q: string): number {
		if (!q) return 1;
		const l = label.toLowerCase();
		const t = q.toLowerCase();
		if (l.includes(t)) return 100 - l.indexOf(t);
		let i = 0;
		for (const ch of l) if (ch === t[i]) i++;
		return i === t.length ? 10 : 0;
	}

	const results = $derived(
		commands
			.map((c) => ({ c, s: score(`${c.group} ${c.label}`, query) }))
			.filter((x) => x.s > 0)
			.sort((a, b) => b.s - a.s)
			.slice(0, 14)
			.map((x) => x.c),
	);

	$effect(() => {
		if (workspace.paletteOpen) {
			query = '';
			index = 0;
			void tick().then(() => input?.focus());
		}
	});

	function run(c: Command) {
		workspace.paletteOpen = false;
		void c.run();
	}
</script>

{#if workspace.paletteOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={() => (workspace.paletteOpen = false)}></div>
	<div class="palette" role="dialog" aria-label="Command palette">
		<input
			bind:this={input}
			bind:value={query}
			placeholder="Type a command"
			aria-label="Command"
			oninput={() => (index = 0)}
			onkeydown={(e) => {
				if (e.key === 'Escape') workspace.paletteOpen = false;
				else if (e.key === 'ArrowDown') {
					e.preventDefault();
					index = Math.min(results.length - 1, index + 1);
				} else if (e.key === 'ArrowUp') {
					e.preventDefault();
					index = Math.max(0, index - 1);
				} else if (e.key === 'Enter' && results[index]) run(results[index]);
			}}
		/>
		<ul role="listbox">
			{#each results as c, i (c.group + c.label)}
				<li role="option" aria-selected={i === index}>
					<button class:active={i === index} onmouseenter={() => (index = i)} onclick={() => run(c)}>
						<span class="group">{c.group}</span>
						<span class="label">{c.label}</span>
						{#if c.keys}<kbd>{c.keys}</kbd>{/if}
					</button>
				</li>
			{:else}
				<li class="none">No matching command</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: rgba(10, 12, 20, 0.35);
	}
	.palette {
		position: fixed;
		z-index: 901;
		top: 70px;
		left: 50%;
		transform: translateX(-50%);
		width: min(560px, calc(100vw - 32px));
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		overflow: hidden;
	}
	input {
		width: 100%;
		height: 38px;
		border: none;
		border-bottom: 1px solid var(--ox-rule-strong);
		background: transparent;
		padding: 0 14px;
		outline: none;
		font-size: 13.5px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 4px;
		max-height: 420px;
		overflow: auto;
	}
	button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		border: none;
		background: none;
		text-align: left;
		padding: 5px 10px;
		border-radius: var(--ox-radius);
		cursor: pointer;
	}
	button.active {
		background: var(--ox-selection);
	}
	.group {
		color: var(--ox-text-dim);
		width: 76px;
		flex: none;
	}
	.label {
		flex: 1;
	}
	kbd {
		font: inherit;
		color: var(--ox-haze);
		font-size: 11.5px;
	}
	.none {
		padding: 10px;
		color: var(--ox-haze);
	}
</style>
