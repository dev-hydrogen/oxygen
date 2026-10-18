<script lang="ts">
	import { tick } from 'svelte';
	import type { FileRef } from '../../host';
	import { SPAWN_MODES } from '../../state/session.svelte';
	import { LAYOUTS, type Workspace } from '../../state/workspace.svelte';
	import { closeEffect, copyShareLink, openExample, save } from '../../lib/actions';
	import { REPO } from '../../lib/about';

	/** File / Edit / View / Preview / Examples / Help, like other editors: every panel can be brought back from View */
	interface Props {
		workspace: Workspace;
		panels: Record<string, { title: string }>;
	}

	let { workspace, panels }: Props = $props();

	interface Action {
		label: string;
		keys?: string;
		run?: () => void | Promise<void>;
		/** an external page (opens in the browser) */
		href?: string;
		/** a toggle or a choice: shows a check */
		checked?: boolean;
		disabled?: boolean;
		title?: string;
	}
	type Item = Action | { separator: true } | { heading: string };

	let open = $state<string | null>(null);
	let root = $state<HTMLElement>();
	let recent = $state<FileRef[]>([]);
	let examples = $state<{ name: string; load: () => Promise<string> }[]>([]);

	const host = $derived(workspace.host);
	const inVsCode = $derived(host.kind === 'vscode');
	/** the key bound to a command, for the menu's right column */
	const k = (id: string) => workspace.keymap.label(id);

	function fileItems(): Item[] {
		const s = workspace.active;
		const items: Item[] = [];
		if (!inVsCode) items.push({ label: 'New effect', keys: k('file.new'), run: () => void workspace.newEffect() });
		if (host.openFiles) items.push({ label: 'Open files…', keys: k('file.open'), run: () => workspace.openFiles() });
		if (host.openPack) items.push({ label: 'Open resource pack folder…', keys: k('file.openPack'), run: () => workspace.openPack() });
		if (host.recentFiles && recent.length) {
			items.push({ separator: true }, { heading: 'Recent' });
			for (const f of recent.slice(0, 6)) items.push({ label: f.name, title: f.where ?? f.id ?? '', run: () => workspace.openKnown(f) });
		}
		items.push({ separator: true });
		items.push({ label: 'Save', keys: k('file.save'), disabled: !s, run: () => save(workspace) });
		if (host.saveAs) items.push({ label: 'Save as…', keys: k('file.saveAs'), disabled: !s, run: () => save(workspace, true) });
		if (host.download) items.push({ label: 'Download a copy', keys: host.saveAs ? undefined : k('file.saveAs'), disabled: !s, run: () => workspace.download() });
		if (host.kind === 'web') items.push({ label: 'Copy share link', keys: k('file.share'), disabled: !s, run: () => copyShareLink(workspace) });
		items.push({ separator: true }, { label: 'Settings…', keys: k('app.settings'), run: () => workspace.openSettings() });
		if (!inVsCode) items.push({ separator: true }, { label: 'Close effect', keys: k('file.close'), disabled: !s, run: () => closeEffect(workspace) });
		return items;
	}

	function editItems(): Item[] {
		const s = workspace.active;
		return [
			{ label: 'Undo', keys: k('edit.undo'), disabled: !s, run: () => void (s && workspace.undo(s)) },
			{ label: 'Redo', keys: k('edit.redo'), disabled: !s, run: () => void (s && workspace.redo(s)) },
			{ separator: true },
			{
				label: 'Find uses of a variable…',
				keys: k('edit.findVariable'),
				disabled: !s,
				run: () => {
					if (!s) return;
					s.programFilter = 'v.';
					s.referencesRequest = { name: 'v.', at: Date.now() };
				},
			},
			{ separator: true },
			{ label: 'Commands…', keys: k('app.commands'), run: () => void (workspace.paletteOpen = true) },
			{ label: 'Keyboard shortcuts…', run: () => workspace.openSettings('keyboard') },
		];
	}

	function viewItems(): Item[] {
		const items: Item[] = [{ heading: 'Panels' }];
		for (const [id, p] of Object.entries(panels)) {
			const shown = workspace.openPanels.includes(id);
			items.push({ label: p.title, checked: shown, keys: k(`view.panel.${id}`), run: () => (shown ? workspace.hide(id) : workspace.show(id)) });
		}
		items.push({ separator: true }, { heading: 'Reset the layout to' });
		for (const l of LAYOUTS) items.push({ label: l.label, title: l.help, keys: k(`view.layout.${l.id}`), run: () => void (workspace.layoutRequest = { name: l.id, at: Date.now() }) });
		items.push({ separator: true }, { heading: 'Inspector' });
		items.push({ label: 'By category', checked: workspace.inspectorView === 'categories', keys: k('view.inspector.categories'), run: () => void (workspace.inspectorView = 'categories') });
		items.push({ label: 'By phase', checked: workspace.inspectorView === 'phases', keys: k('view.inspector.phases'), run: () => void (workspace.inspectorView = 'phases') });
		return items;
	}

	function previewItems(): Item[] {
		const s = workspace.active;
		if (!s) return [{ heading: 'Open an effect to preview it' }];
		const items: Item[] = [
			{ label: s.playing ? 'Pause' : s.finished ? 'Replay' : 'Play', keys: k('preview.play'), run: () => s.togglePlay() },
			{ label: 'Step one frame', keys: k('preview.step'), disabled: s.playing, run: () => s.stepFrame() },
			{ label: 'Restart', keys: k('preview.restart'), run: () => s.restart() },
			{ label: 'Repeat', checked: s.loopPreview, keys: k('preview.repeat'), title: 'Looping effects loop seamlessly; others play again when they end', run: () => void (s.loopPreview = !s.loopPreview) },
			{ label: 'Frame the particles', keys: k('preview.frame'), run: () => void (workspace.frameRequest = Date.now()) },
			{ separator: true },
			{ label: 'Trajectory paths', checked: s.showPaths, keys: k('preview.paths'), run: () => void (s.showPaths = !s.showPaths) },
			{ label: 'Facing axes', checked: s.showFacing, keys: k('preview.facing'), run: () => void (s.showFacing = !s.showFacing) },
			{ label: 'Velocity arrows', checked: s.showVelocity, keys: k('preview.velocity'), run: () => void (s.showVelocity = !s.showVelocity) },
			{ label: 'Emitter shape', checked: s.showShape, keys: k('preview.shape'), run: () => void (s.showShape = !s.showShape) },
			{ separator: true },
			{ heading: 'Spawned by' },
		];
		for (const m of SPAWN_MODES) items.push({ label: m.label, title: m.help, checked: s.spawnMode === m.id, keys: k(`preview.spawn.${m.id}`), run: () => s.setSpawnMode(m.id) });
		items.push({ separator: true }, { heading: 'Rendering' });
		const modes = [
			{ id: 'classic', label: 'Classic' },
			{ id: 'vv', label: 'Vibrant Visuals' },
			{ id: 'split', label: 'Classic | Vibrant side by side' },
		] as const;
		for (const m of modes) items.push({ label: m.label, checked: workspace.renderMode === m.id, keys: k(`preview.render.${m.id}`), run: () => void (workspace.renderMode = m.id) });
		items.push({ label: 'Sky behind Vibrant Visuals', checked: workspace.vvSky, keys: k('preview.vvSky'), title: 'Off keeps the classic background, so only the particles differ', run: () => void (workspace.vvSky = !workspace.vvSky) });
		items.push({ separator: true }, { label: 'Preview and viewport settings…', run: () => workspace.openSettings('preview') });
		return items;
	}

	function exampleItems(): Item[] {
		if (!examples.length) return [{ heading: 'Loading…' }];
		return examples.map((e) => ({ label: e.name.replace(/_/g, ' '), run: () => openExample(workspace, e) }));
	}

	function helpItems(): Item[] {
		return [
			{ label: 'Keyboard shortcuts', keys: k('app.shortcuts'), run: () => void (workspace.shortcutsOpen = true) },
			{ label: 'All commands', keys: k('app.commands'), run: () => void (workspace.paletteOpen = true) },
			{ separator: true },
			{ label: 'Oxygen guide', href: `${REPO}/blob/main/docs/guide.md` },
			{ label: 'How faithful the preview is', href: `${REPO}/blob/main/docs/accuracy.md` },
			{ label: 'Bedrock particle documentation', href: 'https://learn.microsoft.com/minecraft/creator/documents/particleeffects' },
			{ label: 'Molang reference', href: 'https://learn.microsoft.com/minecraft/creator/reference/content/molangreference/' },
			{ separator: true },
			{ label: "What's new", run: () => workspace.openAbout('new') },
			{ label: 'Set up a coding agent…', title: 'A prompt that installs Oxygen’s MCP server in Claude Code, Codex and other agents', run: () => workspace.openAbout('agents') },
			{ label: 'Report a problem', href: `${REPO}/issues/new` },
			{ label: 'System information', run: () => workspace.openAbout('system') },
			{ separator: true },
			{ label: 'About Oxygen', keys: k('app.about'), run: () => workspace.openAbout('about') },
		];
	}

	// in VS Code an example opens in an editor of its own, when the host can do that
	const MENUS = $derived<{ id: string; label: string; items: () => Item[] }[]>([
		{ id: 'file', label: 'File', items: fileItems },
		{ id: 'edit', label: 'Edit', items: editItems },
		{ id: 'view', label: 'View', items: viewItems },
		{ id: 'preview', label: 'Preview', items: previewItems },
		...(host.kind !== 'vscode' || host.openExample ? [{ id: 'examples', label: 'Examples', items: exampleItems }] : []),
		{ id: 'help', label: 'Help', items: helpItems },
	]);

	const items = $derived.by(() => {
		const m = MENUS.find((x) => x.id === open);
		return m ? m.items() : [];
	});

	const isAction = (i: Item): i is Action => 'label' in i;

	async function show(id: string | null, focusFirst = false) {
		open = id;
		if (id === 'file' && host.recentFiles) void host.recentFiles().then((r) => (recent = r));
		if (id === 'examples' && !examples.length) void host.examples().then((e) => (examples = e));
		if (id && focusFirst) {
			await tick();
			root?.querySelector<HTMLElement>('.menu [role^="menuitem"]:not(:disabled)')?.focus();
		}
	}

	function choose(a: Action) {
		if (a.disabled) return;
		open = null;
		void a.run?.();
	}

	function topKey(e: KeyboardEvent, i: number) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			open = null;
		} else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			void show(MENUS[i].id, true);
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			const next = (i + (e.key === 'ArrowRight' ? 1 : MENUS.length - 1)) % MENUS.length;
			root?.querySelectorAll<HTMLElement>('.top')[next]?.focus();
			if (open) void show(MENUS[next].id);
		}
	}

	function menuKey(e: KeyboardEvent) {
		const i = MENUS.findIndex((m) => m.id === open);
		const entries = [...(root?.querySelectorAll<HTMLElement>('.menu [role^="menuitem"]:not(:disabled)') ?? [])];
		const at = entries.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			entries[(at + (e.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length]?.focus();
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			const next = (i + (e.key === 'ArrowRight' ? 1 : MENUS.length - 1)) % MENUS.length;
			void show(MENUS[next].id, true);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			open = null;
			root?.querySelectorAll<HTMLElement>('.top')[i]?.focus();
		} else if (e.key === 'Tab') open = null;
	}

	$effect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => {
			if (!root?.contains(e.target as Node)) open = null;
		};
		window.addEventListener('pointerdown', away, true);
		return () => window.removeEventListener('pointerdown', away, true);
	});
</script>

<div class="menubar" role="menubar" aria-label="Menu" tabindex="-1" bind:this={root}>
	{#each MENUS as m, i (m.id)}
		<div class="wrap">
			<button
				class="top"
				class:on={open === m.id}
				role="menuitem"
				aria-haspopup="menu"
				aria-expanded={open === m.id}
				onclick={() => void show(open === m.id ? null : m.id)}
				onpointerenter={() => open && open !== m.id && void show(m.id)}
				onkeydown={(e) => topKey(e, i)}>{m.label}</button
			>
			{#if open === m.id}
				<!-- svelte-ignore a11y_interactive_supports_focus -->
				<div class="menu" role="menu" aria-label={m.label} onkeydown={menuKey}>
					{#each items as item, k (k)}
						{#if 'separator' in item}
							<div class="sep" role="separator"></div>
						{:else if 'heading' in item}
							<div class="heading">{item.heading}</div>
						{:else if isAction(item) && item.href}
							<a class="item" role="menuitem" href={item.href} target="_blank" rel="noreferrer" onclick={() => (open = null)}>
								<span class="check"></span><span class="label">{item.label}</span><span class="keys">↗</span>
							</a>
						{:else if isAction(item)}
							<button
								class="item"
								role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
								aria-checked={item.checked}
								disabled={item.disabled}
								title={item.title}
								onclick={() => choose(item)}
							>
								<span class="check">
									{#if item.checked}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>{/if}
								</span>
								<span class="label">{item.label}</span>
								{#if item.keys}<span class="keys">{item.keys}</span>{/if}
							</button>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.menubar {
		display: flex;
		align-items: center;
		height: 100%;
		flex: none;
	}
	.wrap {
		position: relative;
		height: 100%;
		display: flex;
		align-items: center;
	}
	.top {
		height: 24px;
		padding: 0 8px;
		border: none;
		background: none;
		border-radius: var(--ox-radius);
		color: var(--ox-haze);
		cursor: pointer;
	}
	.top:hover,
	.top.on {
		color: var(--ox-frost);
		background: var(--ox-hover);
	}
	.top.on {
		background: var(--ox-active);
	}
	.menu {
		position: absolute;
		top: 32px;
		left: 0;
		z-index: 200;
		min-width: 230px;
		max-height: calc(100vh - 60px);
		overflow-y: auto;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		padding: 4px;
		display: flex;
		flex-direction: column;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 10px 0 4px;
		border: none;
		background: none;
		border-radius: var(--ox-radius);
		color: var(--ox-frost);
		text-align: left;
		text-decoration: none;
		cursor: pointer;
		white-space: nowrap;
	}
	.item:hover:not(:disabled),
	.item:focus-visible {
		background: var(--ox-selection);
		outline: none;
	}
	.item:disabled {
		color: var(--ox-text-dim);
		cursor: default;
	}
	.check {
		width: 14px;
		flex: none;
		display: grid;
		place-items: center;
		color: var(--ox-lox);
	}
	.check svg {
		width: 12px;
		height: 12px;
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label::first-letter {
		text-transform: uppercase;
	}
	.keys {
		color: var(--ox-text-dim);
		font-size: 11px;
		padding-left: 18px;
	}
	.heading {
		padding: 6px 10px 2px 24px;
		font-size: 11px;
		color: var(--ox-text-dim);
	}
	.sep {
		height: 1px;
		margin: 4px 2px;
		background: var(--ox-rule);
	}
</style>
