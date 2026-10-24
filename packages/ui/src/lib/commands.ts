import type { EffectSession, SpawnMode } from '../state/session.svelte';
import type { LayoutName, Workspace } from '../state/workspace.svelte';
import { SPEEDS } from '../state/preferences';
import { closeEffect, copyShareLink, save } from './actions';
import { flushEdits } from './flush';
import { pickTexture } from './import-texture';

/**
 * What each key command does (lib/keys.ts names them and their keys). Menus and the palette show the same
 * commands with the keys the user bound; a command that can't run here (no effect open, a host without the
 * feature) lets its key through.
 */
interface Runner {
	run: (w: Workspace, s: EffectSession | null) => void;
	/** can it run now (default: always) */
	when?: (w: Workspace, s: EffectSession | null) => boolean;
}

const needsEffect = (_w: Workspace, s: EffectSession | null) => !!s;
const stepSpeed = (s: EffectSession, by: number) => {
	const i = SPEEDS.indexOf(s.speed);
	s.speed = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? SPEEDS.indexOf(1) : i) + by))];
};
const cycle = (w: Workspace, by: number) => {
	const n = w.sessions.length;
	if (n < 2) return;
	const i = w.sessions.findIndex((x) => x.id === w.activeId);
	w.activeId = w.sessions[(i + by + n) % n].id;
};
const spawn = (mode: SpawnMode): Runner => ({ run: (_w, s) => s?.setSpawnMode(mode), when: needsEffect });

const RUNNERS: Record<string, Runner> = {
	'file.new': { run: (w) => void w.newEffect(), when: (w) => w.host.kind !== 'vscode' },
	'file.open': { run: (w) => void w.openFiles(), when: (w) => !!w.host.openFiles },
	'file.openPack': { run: (w) => void w.openPack(), when: (w) => !!w.host.openPack },
	'file.importTexture': { run: (w) => void pickTexture(w), when: needsEffect },
	'file.save': { run: (w) => save(w), when: needsEffect },
	'file.saveAs': { run: (w) => save(w, true), when: (w, s) => !!s && !!(w.host.saveAs || w.host.download) },
	'file.share': { run: (w) => void copyShareLink(w), when: (w, s) => !!s && w.host.kind === 'web' },
	'file.close': { run: (w) => closeEffect(w), when: (w, s) => !!s && w.host.kind !== 'vscode' },
	'file.nextEffect': { run: (w) => cycle(w, 1), when: (w) => w.sessions.length > 1 },
	'file.previousEffect': { run: (w) => cycle(w, -1), when: (w) => w.sessions.length > 1 },

	'edit.undo': {
		run: (w, s) => {
			// Molang editors leave undo to the document, so one history covers every editor
			flushEdits();
			s!.doc.history.seal();
			w.undo(s!);
		},
		when: needsEffect,
	},
	'edit.redo': {
		run: (w, s) => {
			flushEdits();
			w.redo(s!);
		},
		when: needsEffect,
	},
	'edit.findVariable': {
		run: (_w, s) => {
			s!.programFilter = 'v.';
			s!.referencesRequest = { name: 'v.', at: Date.now() };
		},
		when: needsEffect,
	},

	'app.commands': { run: (w) => void (w.paletteOpen = !w.paletteOpen) },
	'app.settings': { run: (w) => (w.settingsOpen ? (w.settingsOpen = false) : w.openSettings()) },
	'app.shortcuts': { run: (w) => void (w.shortcutsOpen = !w.shortcutsOpen) },
	'app.about': { run: (w) => (w.aboutOpen ? (w.aboutOpen = false) : w.openAbout()) },

	'preview.play': { run: (_w, s) => s!.togglePlay(), when: needsEffect },
	'preview.restart': { run: (_w, s) => s!.restart(), when: needsEffect },
	'preview.step': { run: (_w, s) => s!.stepFrame(), when: (_w, s) => !!s && !s.playing },
	'preview.frame': { run: (w) => void (w.frameRequest = Date.now()), when: needsEffect },
	'preview.repeat': { run: (_w, s) => void (s!.loopPreview = !s!.loopPreview), when: needsEffect },
	'preview.copyScreenshot': { run: (w) => void (w.captureRequest = { kind: 'copy', at: Date.now() }), when: needsEffect },
	'preview.saveScreenshot': { run: (w) => void (w.captureRequest = { kind: 'save', at: Date.now() }), when: needsEffect },
	'preview.recordGif': { run: (w) => void (w.captureRequest = { kind: 'gif', at: Date.now() }), when: needsEffect },
	'preview.recordGifStart': { run: (w) => void (w.captureRequest = { kind: 'gifStart', at: Date.now() }), when: needsEffect },
	'preview.recordVideo': { run: (w) => void (w.captureRequest = { kind: 'video', at: Date.now() }), when: needsEffect },
	'preview.recordVideoStart': { run: (w) => void (w.captureRequest = { kind: 'videoStart', at: Date.now() }), when: needsEffect },
	'preview.slower': { run: (_w, s) => stepSpeed(s!, -1), when: needsEffect },
	'preview.faster': { run: (_w, s) => stepSpeed(s!, 1), when: needsEffect },
	'preview.paths': { run: (_w, s) => void (s!.showPaths = !s!.showPaths), when: needsEffect },
	'preview.facing': { run: (_w, s) => void (s!.showFacing = !s!.showFacing), when: needsEffect },
	'preview.velocity': { run: (_w, s) => void (s!.showVelocity = !s!.showVelocity), when: needsEffect },
	'preview.shape': { run: (_w, s) => void (s!.showShape = !s!.showShape), when: needsEffect },
	'preview.render.classic': { run: (w) => void (w.renderMode = 'classic') },
	'preview.render.vv': { run: (w) => void (w.renderMode = 'vv') },
	'preview.render.split': { run: (w) => void (w.renderMode = 'split') },
	'preview.vvSky': { run: (w) => void (w.vvSky = !w.vvSky) },
	'preview.spawn.command': spawn('command'),
	'preview.spawn.script': spawn('script'),
	'preview.spawn.entity': spawn('entity'),

	'view.inspector.categories': { run: (w) => void (w.inspectorView = 'categories') },
	'view.inspector.phases': { run: (w) => void (w.inspectorView = 'phases') },
};

function runnerOf(id: string): Runner | undefined {
	if (RUNNERS[id]) return RUNNERS[id];
	const panel = /^view\.panel\.(.+)$/.exec(id)?.[1];
	if (panel)
		return {
			run: (w) => (w.openPanels.includes(panel) ? w.hide(panel) : w.show(panel)),
			when: (w) => !!w.panelTitles[panel],
		};
	const layout = /^view\.layout\.(.+)$/.exec(id)?.[1];
	if (layout) return { run: (w) => void (w.layoutRequest = { name: layout as LayoutName, at: Date.now() }) };
	return undefined;
}

/** Can the command run now */
export function canRun(w: Workspace, id: string): boolean {
	const r = runnerOf(id);
	return !!r && (r.when?.(w, w.active) ?? true);
}

/** Run a command; false when it can't run now */
export function runCommand(w: Workspace, id: string): boolean {
	const r = runnerOf(id);
	if (!r || !(r.when?.(w, w.active) ?? true)) return false;
	r.run(w, w.active);
	return true;
}
