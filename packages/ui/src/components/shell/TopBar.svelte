<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { closeEffect, closeEffects, copyShareLink, save } from '../../lib/actions';
	import { openContextMenu, type MenuItem } from '../../lib/context-menu.svelte';
	import type { EffectSession } from '../../state/session.svelte';
	import GameMenu from './GameMenu.svelte';
	import MenuBar from './MenuBar.svelte';
	import logoDark from '../../assets/logo-dark.png?inline';
	import logoLight from '../../assets/logo-light.png?inline';

	interface Props {
		workspace: Workspace;
		panels: Record<string, { title: string }>;
	}

	let { workspace, panels }: Props = $props();

	/** right-click on a tab */
	function tabMenu(s: EffectSession): MenuItem[] {
		const all = workspace.sessions;
		const i = all.indexOf(s);
		const k = (id: string) => workspace.keymap.label(id);
		const others = all.filter((x) => x !== s).map((x) => x.id);
		const right = all.slice(i + 1).map((x) => x.id);
		const saved = all.filter((x) => !x.dirty).map((x) => x.id);
		return [
			{ label: 'Close', keys: k('file.close'), run: () => closeEffect(workspace, s.id) },
			{ label: 'Close others', disabled: !others.length, run: () => closeEffects(workspace, others) },
			{ label: 'Close to the right', disabled: !right.length, run: () => closeEffects(workspace, right) },
			{ label: 'Close saved', disabled: !saved.length, title: 'Close every effect without unsaved changes', run: () => closeEffects(workspace, saved) },
			{ label: 'Close all', run: () => closeEffects(workspace, all.map((x) => x.id)) },
			{ separator: true },
			{
				label: 'Save',
				keys: k('file.save'),
				run: () => {
					workspace.activeId = s.id;
					save(workspace);
				},
			},
			...(workspace.host.saveAs || workspace.host.download
				? [
						{
							label: workspace.host.saveAs ? 'Save as…' : 'Download a copy',
							run: () => {
								workspace.activeId = s.id;
								save(workspace, true);
							},
						},
					]
				: []),
			...(workspace.host.kind === 'web'
				? [
						{
							label: 'Copy share link',
							run: () => {
								workspace.activeId = s.id;
								void copyShareLink(workspace);
							},
						},
					]
				: []),
			{ separator: true },
			{ label: 'Copy identifier', title: s.identifier, run: () => void navigator.clipboard.writeText(s.identifier) },
			...(s.file.id && !s.file.id.startsWith('example:') ? [{ label: 'Copy path', title: s.file.id, run: () => void navigator.clipboard.writeText(s.file.id!) }] : []),
		];
	}
</script>

<!-- in the desktop app the menu row is the window's title bar: it drags the window, and the window's own buttons
     draw over its end (the titlebar-area-* insets leave them room) -->
<header class="top" class:integrated={workspace.host.kind === 'desktop'}>
	<!-- the menu row, then the open effects on a row of their own -->
	<div class="menurow">
		<button class="brand" title="About Oxygen" onclick={() => workspace.openAbout()}>
			<!-- rendered by tools/logo.mjs; the light one shows in VS Code's light themes -->
			<img class="logo dark" src={logoDark} alt="Oxygen" />
			<img class="logo light" src={logoLight} alt="Oxygen" />
		</button>
		<MenuBar {workspace} {panels} />
		<span class="spacer"></span>
		<div class="actions">
			<button class="btn ghost" title={workspace.keymap.title('Commands', 'app.commands')} onclick={() => (workspace.paletteOpen = true)}>Commands{#if workspace.keymap.label('app.commands')}<kbd>{workspace.keymap.label('app.commands')}</kbd>{/if}</button>
			<button class="btn ghost icon" aria-label="Settings" title={workspace.keymap.title('Settings', 'app.settings')} onclick={() => workspace.openSettings()}>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zm5.3 3.3.1-.9-.1-.9 1.4-1.1-1.4-2.4-1.7.6a5 5 0 0 0-1.5-.9L9.8 1.5H6.2l-.3 1.8a5 5 0 0 0-1.5.9l-1.7-.6-1.4 2.4 1.4 1.1-.1.9.1.9-1.4 1.1 1.4 2.4 1.7-.6c.5.4 1 .7 1.5.9l.3 1.8h3.6l.3-1.8c.5-.2 1-.5 1.5-.9l1.7.6 1.4-2.4z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" /></svg>
			</button>
			{#if workspace.host.game}<GameMenu {workspace} game={workspace.host.game} />{/if}
			<button class="btn primary" title={workspace.keymap.title('Save', 'file.save')} disabled={!workspace.active} onclick={() => save(workspace)}>Save</button>
		</div>
	</div>

	<!-- VS Code has its own editor tabs: one effect per Oxygen editor there -->
	{#if workspace.host.kind !== 'vscode'}
	<div class="tabs" role="tablist" aria-label="Open effects">
		{#each workspace.sessions as s (s.id)}
			<!-- middle click closes, as in browsers and editors -->
			<div
				class="tab"
				class:active={s.id === workspace.activeId}
				role="tab"
				tabindex="-1"
				aria-selected={s.id === workspace.activeId}
				onmousedown={(e) => e.button === 1 && e.preventDefault()}
				onauxclick={(e) => {
					if (e.button !== 1) return;
					e.preventDefault();
					closeEffect(workspace, s.id);
				}}
				oncontextmenu={(e) => openContextMenu(e, tabMenu(s))}
			>
				<button class="tab-name" onclick={() => (workspace.activeId = s.id)} title={s.file.name}>{s.file.name}</button>
				{#if s.dirty}<span class="dirty" aria-label="unsaved changes"></span>{/if}
				<button class="tab-close" aria-label="Close {s.file.name}" onclick={() => closeEffect(workspace, s.id)}>
					<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.3" /></svg>
				</button>
			</div>
		{/each}
		<button class="new" aria-label="New effect" title={workspace.keymap.title('New effect', 'file.new')} onclick={() => workspace.newEffect()}>
			<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5v7M1.5 5h7" stroke="currentColor" stroke-width="1.3" /></svg>
		</button>
	</div>
	{/if}
</header>

<style>
	.top {
		display: flex;
		flex-direction: column;
		background: var(--ox-bg);
		flex: none;
	}
	.menurow {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 32px;
		padding: 0 8px 0 10px;
		border-bottom: 1px solid var(--ox-rule);
	}
	.integrated .menurow {
		-webkit-app-region: drag;
		padding-left: calc(10px + env(titlebar-area-x, 0px));
		padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 8px);
	}
	.integrated .menurow :global(:is(button, a, input, select, [role='menu'], [role='dialog'])) {
		-webkit-app-region: no-drag;
	}
	.spacer {
		flex: 1;
	}
	.brand {
		display: flex;
		align-items: center;
		height: 100%;
		margin-left: -4px;
		padding: 0 2px 0 0;
		border: none;
		background: none;
		cursor: pointer;
	}
	.logo {
		display: block;
		height: 32px;
		width: auto;
		user-select: none;
		-webkit-user-drag: none;
	}
	.logo.light,
	:global(body.ox-follow-vscode.vscode-light) .logo.dark {
		display: none;
	}
	:global(body.ox-follow-vscode.vscode-light) .logo.light {
		display: block;
	}
	.tabs {
		display: flex;
		align-items: stretch;
		height: 30px;
		min-width: 0;
		padding: 0 4px;
		overflow-x: auto;
		scrollbar-width: none;
		border-bottom: 1px solid var(--ox-rule);
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 4px 0 10px;
		color: var(--ox-haze);
		border-bottom: 2px solid transparent;
		max-width: 220px;
	}
	.tab.active {
		color: var(--ox-frost);
		border-bottom-color: var(--ox-lox);
		background: var(--ox-panel);
	}
	.tab:hover {
		color: var(--ox-frost);
	}
	.tab-name {
		border: none;
		background: none;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0;
	}
	.dirty {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		flex: none;
	}
	.tab-close,
	.new {
		width: 20px;
		height: 20px;
		border: none;
		background: none;
		border-radius: var(--ox-radius);
		cursor: pointer;
		display: grid;
		place-items: center;
		color: var(--ox-haze);
		padding: 0;
		flex: none;
	}
	.tab-close svg,
	.new svg {
		width: 10px;
		height: 10px;
	}
	.tab-close {
		opacity: 0;
	}
	.tab:hover .tab-close,
	.tab.active .tab-close,
	.tab-close:focus-visible {
		opacity: 1;
	}
	.tab-close:hover,
	.new:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.new {
		align-self: center;
		margin-left: 4px;
	}
	.actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.btn {
		height: 26px;
		padding: 0 12px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
		color: var(--ox-frost);
	}
	.btn:hover:not(:disabled) {
		background: var(--ox-hover);
	}
	.btn.ghost {
		border-color: transparent;
		color: var(--ox-haze);
	}
	.btn.ghost kbd {
		font: inherit;
		font-size: 11px;
		color: var(--ox-text-dim);
		margin-left: 4px;
	}
	.btn.icon {
		width: 26px;
		padding: 0;
		display: grid;
		place-items: center;
	}
	.btn.icon svg {
		width: 15px;
		height: 15px;
	}
	.btn.ghost:hover:not(:disabled) {
		color: var(--ox-frost);
	}
	.btn.primary {
		background: var(--ox-lox);
		border-color: var(--ox-lox);
		color: #10131c;
		font-weight: 600;
	}
	.btn.primary:hover:not(:disabled) {
		background: #a6c9f7;
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
