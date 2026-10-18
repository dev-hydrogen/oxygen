<script lang="ts">
	import { createDockview, type AddPanelPositionOptions, type DockviewApi } from 'dockview-core';
	import { mount, onDestroy, onMount, unmount, type Component } from 'svelte';
	import type { LayoutName, Workspace } from '../state/workspace.svelte';
	import { bindMolangKeys, handleKey } from '../lib/keyboard';
	import { toAccelerator } from '../lib/keys';
	import ContextPanel from './panels/ContextPanel.svelte';
	import CurvesPanel from './panels/CurvesPanel.svelte';
	import EventsPanel from './panels/EventsPanel.svelte';
	import DebugPanel from './panels/DebugPanel.svelte';
	import PipelinePanel from './panels/PipelinePanel.svelte';
	import GraphPanel from './panels/GraphPanel.svelte';
	import ScenePanel from './panels/ScenePanel.svelte';
	import TexturePanel from './panels/TexturePanel.svelte';
	import VibrantPanel from './panels/VibrantPanel.svelte';
	import ExpressionPanel from './panels/ExpressionPanel.svelte';
	import InspectorPanel from './panels/InspectorPanel.svelte';
	import Outliner from './panels/Outliner.svelte';
	import Problems from './panels/Problems.svelte';
	import SourcePanel from './panels/SourcePanel.svelte';
	import Viewport from './panels/Viewport.svelte';
	import TimelinePanel from './panels/TimelinePanel.svelte';
	import PanelHost from './shell/PanelHost.svelte';
	import StartScreen from './shell/StartScreen.svelte';
	import StatusBar from './shell/StatusBar.svelte';
	import TopBar from './shell/TopBar.svelte';
	import CommandPalette from './shell/CommandPalette.svelte';
	import RenameDialog from './shell/RenameDialog.svelte';
	import ShortcutsDialog from './shell/ShortcutsDialog.svelte';
	import SettingsDialog from './shell/SettingsDialog.svelte';
	import AboutDialog from './shell/AboutDialog.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	let dockEl: HTMLDivElement;
	let api: DockviewApi | null = null;

	const PANELS: Record<string, { title: string; component: Component<{ workspace: Workspace }> }> = {
		viewport: { title: 'Viewport', component: Viewport },
		inspector: { title: 'Inspector', component: InspectorPanel },
		outliner: { title: 'Outliner', component: Outliner },
		expression: { title: 'Expression', component: ExpressionPanel },
		problems: { title: 'Problems', component: Problems },
		context: { title: 'Context', component: ContextPanel },
		source: { title: 'Source', component: SourcePanel },
		curves: { title: 'Curves', component: CurvesPanel },
		events: { title: 'Events', component: EventsPanel },
		debug: { title: 'Debug', component: DebugPanel },
		timeline: { title: 'Timeline', component: TimelinePanel },
		pipeline: { title: 'Pipeline', component: PipelinePanel },
		graph: { title: 'Graph', component: GraphPanel },
		scene: { title: 'Scene', component: ScenePanel },
		texture: { title: 'Texture', component: TexturePanel },
		vibrant: { title: 'Vibrant Visuals', component: VibrantPanel },
	};
	// every panel gets a command keys can be bound to
	// svelte-ignore state_referenced_locally
	workspace.panelTitles = Object.fromEntries(Object.entries(PANELS).map(([id, p]) => [id, { title: p.title }]));

	function defaultLayout(a: DockviewApi) {
		a.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
		a.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' }, initialWidth: 420 });
		a.addPanel({ id: 'outliner', component: 'outliner', title: 'Outliner', position: { referencePanel: 'viewport', direction: 'left' }, initialWidth: 210 });
		a.addPanel({ id: 'expression', component: 'expression', title: 'Expression', position: { referencePanel: 'viewport', direction: 'below' }, initialHeight: 230 });
		a.addPanel({ id: 'problems', component: 'problems', title: 'Problems', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'context', component: 'context', title: 'Context', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'curves', component: 'curves', title: 'Curves', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'events', component: 'events', title: 'Events', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'texture', component: 'texture', title: 'Texture', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'graph', component: 'graph', title: 'Graph', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'pipeline', component: 'pipeline', title: 'Pipeline', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'debug', component: 'debug', title: 'Debug', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'timeline', component: 'timeline', title: 'Timeline', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'source', component: 'source', title: 'Source', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'scene', component: 'scene', title: 'Scene', position: { referencePanel: 'outliner', direction: 'below' } });
		a.addPanel({ id: 'vibrant', component: 'vibrant', title: 'Vibrant Visuals', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		// initialWidth/Height only hint; set the starting sizes explicitly
		a.getPanel('inspector')?.group.api.setSize({ width: 420 });
		a.getPanel('outliner')?.group.api.setSize({ width: 210 });
		a.getPanel('expression')?.group.api.setSize({ height: 230 });
	}

	/** The file as text, full width, with the preview floating in a corner (drag or close it) */
	function codeLayout(a: DockviewApi) {
		a.addPanel({ id: 'source', component: 'source', title: 'Source' });
		a.addPanel({ id: 'outliner', component: 'outliner', title: 'Outliner', position: { referencePanel: 'source', direction: 'left' } });
		a.addPanel({ id: 'problems', component: 'problems', title: 'Problems', position: { referencePanel: 'source', direction: 'below' } });
		a.addPanel({ id: 'context', component: 'context', title: 'Context', position: { referencePanel: 'problems', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'expression', component: 'expression', title: 'Expression', position: { referencePanel: 'problems', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', floating: { position: { bottom: 48, right: 24 }, width: 460, height: 320 } });
		a.getPanel('outliner')?.group.api.setSize({ width: 200 });
		a.getPanel('problems')?.group.api.setSize({ height: 190 });
		a.getPanel('source')?.api.setActive();
	}

	/** Viewport with the debugger beside it and the whole effect, in order, below */
	function debugLayout(a: DockviewApi) {
		a.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
		a.addPanel({ id: 'debug', component: 'debug', title: 'Debug', position: { referencePanel: 'viewport', direction: 'right' } });
		a.addPanel({ id: 'context', component: 'context', title: 'Context', position: { referencePanel: 'debug', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'expression', component: 'expression', title: 'Expression', position: { referencePanel: 'viewport', direction: 'below' } });
		a.addPanel({ id: 'timeline', component: 'timeline', title: 'Timeline', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'graph', component: 'graph', title: 'Graph', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'pipeline', component: 'pipeline', title: 'Pipeline', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'problems', component: 'problems', title: 'Problems', position: { referencePanel: 'expression', direction: 'within' }, inactive: true });
		a.getPanel('debug')?.group.api.setSize({ width: 460 });
		a.getPanel('expression')?.group.api.setSize({ height: 340 });
		a.getPanel('debug')?.api.setActive();
	}

	/** A large viewport and the Inspector, nothing else */
	function previewLayout(a: DockviewApi) {
		a.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
		a.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' } });
		a.getPanel('inspector')?.group.api.setSize({ width: 400 });
	}

	/** The events graph under the viewport, with the timeline beside it and the Inspector on the right */
	function eventsLayout(a: DockviewApi) {
		a.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
		a.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' } });
		a.addPanel({ id: 'events', component: 'events', title: 'Events', position: { referencePanel: 'viewport', direction: 'below' } });
		a.addPanel({ id: 'timeline', component: 'timeline', title: 'Timeline', position: { referencePanel: 'events', direction: 'within' }, inactive: true });
		a.addPanel({ id: 'context', component: 'context', title: 'Context', position: { referencePanel: 'events', direction: 'within' }, inactive: true });
		a.getPanel('inspector')?.group.api.setSize({ width: 380 });
		a.getPanel('events')?.group.api.setSize({ height: 420 });
		a.getPanel('events')?.api.setActive();
	}

	/** Curves and the value graph under the viewport, for timing how things move and change */
	function curvesLayout(a: DockviewApi) {
		a.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
		a.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' } });
		a.addPanel({ id: 'curves', component: 'curves', title: 'Curves', position: { referencePanel: 'viewport', direction: 'below' } });
		a.addPanel({ id: 'graph', component: 'graph', title: 'Graph', position: { referencePanel: 'curves', direction: 'right' } });
		a.addPanel({ id: 'expression', component: 'expression', title: 'Expression', position: { referencePanel: 'graph', direction: 'within' }, inactive: true });
		a.getPanel('inspector')?.group.api.setSize({ width: 380 });
		a.getPanel('curves')?.group.api.setSize({ height: 360 });
		a.getPanel('curves')?.api.setActive();
	}

	/** The viewport beside the texture and Vibrant Visuals, for how the effect looks */
	function lookLayout(a: DockviewApi) {
		a.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
		a.addPanel({ id: 'texture', component: 'texture', title: 'Texture', position: { referencePanel: 'viewport', direction: 'right' } });
		a.addPanel({ id: 'vibrant', component: 'vibrant', title: 'Vibrant Visuals', position: { referencePanel: 'texture', direction: 'below' } });
		a.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'texture', direction: 'within' }, inactive: true });
		a.getPanel('texture')?.group.api.setSize({ width: 460 });
		a.getPanel('texture')?.api.setActive();
	}

	function applyLayout(name: LayoutName) {
		if (!api) return;
		api.clear();
		if (name === 'code') codeLayout(api);
		else if (name === 'debug') debugLayout(api);
		else if (name === 'preview') previewLayout(api);
		else if (name === 'events') eventsLayout(api);
		else if (name === 'curves') curvesLayout(api);
		else if (name === 'look') lookLayout(api);
		else defaultLayout(api);
	}

	/** the tool tabs that share the group below the viewport */
	const TOOL_TABS = ['expression', 'problems', 'context', 'curves', 'events', 'texture', 'graph', 'pipeline', 'debug', 'timeline', 'source', 'vibrant'];

	/** Where a closed panel comes back: the side columns to their side, the tool tabs into their group */
	function homeOf(a: DockviewApi, id: string): { position?: AddPanelPositionOptions; size?: { width?: number; height?: number } } {
		const docked = (p: string) => a.getPanel(p)?.group.api.location.type === 'grid';
		// the side columns run the window's full height, at its edges
		if (id === 'inspector') return { position: { direction: 'right' }, size: { width: 420 } };
		if (id === 'outliner') return docked('scene') ? { position: { referencePanel: 'scene', direction: 'above' } } : { position: { direction: 'left' }, size: { width: 210 } };
		if (id === 'scene') return docked('outliner') ? { position: { referencePanel: 'outliner', direction: 'below' } } : { position: { direction: 'left' }, size: { width: 210 } };
		const tab = TOOL_TABS.find((p) => p !== id && docked(p));
		if (id === 'viewport') return tab ? { position: { referencePanel: tab, direction: 'above' } } : {};
		if (tab) return { position: { referencePanel: tab, direction: 'within' } };
		return docked('viewport') ? { position: { referencePanel: 'viewport', direction: 'below' }, size: { height: 230 } } : {};
	}

	/** Show a panel, re-adding it where it belongs if the user closed it */
	export function showPanel(id: string) {
		if (!api) return;
		const p = api.getPanel(id);
		if (p) return p.api.setActive();
		if (!PANELS[id]) return;
		const home = homeOf(api, id);
		const added = api.addPanel({ id, component: id, title: PANELS[id].title, floating: false, ...(home.position ? { position: home.position } : {}) });
		if (home.size) added.group.api.setSize(home.size);
	}

	onMount(() => {
		api = createDockview(dockEl, {
			theme: { name: 'oxygen', className: 'ox-dock', colorScheme: 'dark', gap: 0 },
			createComponent: (options) => {
				const element = document.createElement('div');
				element.className = 'ox-panel';
				let instance: ReturnType<typeof mount> | null = null;
				let waiting: { dispose(): void } | null = null;
				return {
					element,
					init: (params) => {
						const def = PANELS[options.name];
						if (!def) return;
						const show = () => {
							instance ??= mount(PanelHost, { target: element, props: { component: def.component, workspace, title: def.title } });
						};
						// a panel behind another tab is built when it's first shown, so opening an editor only
						// pays for what's on screen
						if (params.api.isVisible) show();
						else {
							const sub = params.api.onDidVisibilityChange((e) => {
								if (!e.isVisible) return;
								sub.dispose();
								show();
							});
							waiting = sub;
						}
					},
					dispose: () => {
						waiting?.dispose();
						if (instance) unmount(instance);
					},
				};
			},
		});
		// double-click a tab to give its panel the whole window, again to restore (as in VS Code)
		dockEl.addEventListener('dblclick', (e) => {
			if (!api || !(e.target as HTMLElement).closest('.dv-tab')) return;
			if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
			else if (api.activePanel) api.maximizeGroup(api.activePanel);
		});
		// the View menu checks the panels that are open
		const trackPanels = () => (workspace.openPanels = api ? api.panels.map((p) => p.id) : []);
		api.onDidAddPanel(trackPanels);
		api.onDidRemovePanel(trackPanels);
		let restored = false;
		void workspace.loadSettings().then((settings) => {
			if (restored || !api) return;
			const layout = settings.layout;
			if (layout) {
				try {
					api.fromJSON(layout as Parameters<DockviewApi['fromJSON']>[0]);
					restored = true;
				} catch {
					api.clear();
				}
			}
			if (!restored) defaultLayout(api);
			restored = true;
			trackPanels();
			api.onDidLayoutChange(() => {
				if (api) workspace.updateSettings({ layout: api.toJSON() });
			});
		});
		window.addEventListener('keydown', onKey);
	});

	$effect(() => {
		const r = workspace.reveal;
		if (r) showPanel(r.panel);
	});

	$effect(() => {
		const c = workspace.conceal;
		if (c) api?.getPanel(c.panel)?.api.close();
	});

	$effect(() => {
		const l = workspace.layoutRequest;
		if (l) applyLayout(l.name);
	});

	onDestroy(() => {
		window.removeEventListener('keydown', onKey);
		api?.dispose();
	});

	const onKey = (e: KeyboardEvent) => handleKey(workspace, e);

	// preferences: kept by the host, and applied where they act
	$effect(() => {
		void $state.snapshot(workspace.prefs);
		workspace.savePreferences();
	});
	$effect(() => bindMolangKeys(workspace.keymap));
	$effect(() => {
		const zoom = workspace.prefs.zoom;
		if (workspace.prefsLoaded) workspace.host.setZoom?.(zoom);
	});
	// the desktop app's native menu shows (and answers to) the same keys
	$effect(() => {
		const km = workspace.keymap;
		const menu: Record<string, string> = { new: 'file.new', open: 'file.open', openPack: 'file.openPack', save: 'file.save', palette: 'app.commands', settings: 'app.settings', about: 'app.about' };
		workspace.host.setMenuKeys?.(Object.fromEntries(Object.entries(menu).map(([cmd, id]) => [cmd, km.keys(id).map(toAccelerator).find((a) => a) ?? null])));
	});
	const codeSize = $derived(workspace.prefs.codeSize);
</script>

<div class="ox-root app" style:--ox-code-size={codeSize ? `${codeSize}px` : undefined} style:--ox-code-line={codeSize ? `${Math.round(codeSize * 1.54)}px` : undefined}>
	<TopBar {workspace} panels={PANELS} />
	<div class="dockwrap">
		<div class="dock" bind:this={dockEl}></div>
		{#if !workspace.sessions.length && workspace.host.kind !== 'vscode'}<StartScreen {workspace} />{/if}
	</div>
	<StatusBar {workspace} onproblems={() => showPanel('problems')} />
	<CommandPalette {workspace} panels={PANELS} />
	<RenameDialog {workspace} />
	<ShortcutsDialog {workspace} />
	<SettingsDialog {workspace} />
	<AboutDialog {workspace} />
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--ox-bg);
	}
	.dockwrap {
		flex: 1;
		min-height: 0;
		position: relative;
		display: flex;
	}
	.dock {
		flex: 1;
		min-height: 0;
		position: relative;
	}
	:global(.ox-panel) {
		height: 100%;
		overflow: hidden;
		background: var(--ox-panel);
	}
</style>
