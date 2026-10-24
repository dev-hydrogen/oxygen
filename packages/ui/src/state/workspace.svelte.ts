import { newEffect } from '@oxygen/format';
import { parentInputsFor, spawnsOf } from '@oxygen/effect';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { parseGrading, parseLighting, parseTextureSet } from '@oxygen/scene';
import type { FileRef, Host, OpenedFile, UpdateState } from '../host';
import { EffectSession } from './session.svelte';
import type { Gizmos } from '../viewport/gizmos';
import { KEY_COMMANDS, Keymap, viewCommands } from '../lib/keys';
import { DEFAULT_PREFERENCES, readPreferences, type InspectorView, type Preferences, type RenderMode } from './preferences';

export type LayoutName = 'editor' | 'preview' | 'code' | 'events' | 'curves' | 'look' | 'debug';
export const LAYOUTS: { id: LayoutName; label: string; help: string }[] = [
	{ id: 'editor', label: 'Editor', help: 'Viewport, Inspector and the tool tabs' },
	{ id: 'preview', label: 'Preview', help: 'A large viewport with the Inspector beside it, nothing else' },
	{ id: 'code', label: 'Code with floating preview', help: 'The file as text, full width, with the viewport floating in a corner' },
	{ id: 'events', label: 'Events', help: 'The events graph below the viewport, with the Timeline and the Inspector' },
	{ id: 'curves', label: 'Curves and motion', help: 'Curves and the value graph below the viewport, with the Inspector' },
	{ id: 'look', label: 'Look and lighting', help: 'Viewport, Texture and Vibrant Visuals side by side' },
	{ id: 'debug', label: 'Debugging', help: 'Viewport, Debug and the whole effect in evaluation order' },
];

export type { InspectorView } from './preferences';

/** Sections of the Settings and About dialogs */
export type SettingsSection = 'general' | 'preview' | 'viewport' | 'keyboard' | 'data';
export type AboutSection = 'about' | 'new' | 'agents' | 'engine' | 'system' | 'credits';

/** Open documents, the active one, and app-wide preferences */
export class Workspace {
	sessions = $state<EffectSession[]>([]);
	activeId = $state<string | null>(null);
	/** what the Settings dialog sets (the host keeps it); the defaults until the host's copy arrives */
	prefs = $state<Preferences>(structuredClone(DEFAULT_PREFERENCES));
	/** the host's preferences are in (saving starts then, so the defaults never overwrite them) */
	prefsLoaded = $state(false);
	/** panel titles by id, from the shell: each gets a command keys can be bound to */
	panelTitles = $state<Record<string, { title: string }>>({});
	/** the keys in effect: the defaults with the user's bindings over them */
	keymap = $derived(new Keymap([...KEY_COMMANDS, ...viewCommands(this.panelTitles, LAYOUTS)], this.prefs.keys));
	paletteOpen = $state(false);
	/** the keyboard shortcuts sheet */
	shortcutsOpen = $state(false);
	settingsOpen = $state(false);
	settingsSection = $state<SettingsSection>('general');
	aboutOpen = $state(false);
	aboutSection = $state<AboutSection>('about');
	/** where updating Oxygen stands (hosts that update) */
	update = $state<UpdateState>({ state: 'idle' });
	/** the user asked to check: say how it ended, even when there's nothing new */
	private manualCheck = false;
	/** a key binding is being recorded: keys go to the recorder, not to commands */
	recordingKeys = $state(false);
	/** bumped to ask the viewport to frame the particles */
	frameRequest = $state(0);
	/** asks the viewport for a screenshot (to the clipboard, or saved too) or a GIF (from now, or from the start) */
	captureRequest = $state<{ kind: 'copy' | 'save' | 'gif' | 'gifStart' | 'video' | 'videoStart'; at: number } | null>(null);
	/** Panel the UI asks the shell to reveal (outliner → curves, problems → inspector) */
	reveal = $state<{ panel: string; at: number } | null>(null);
	/** Panel the UI asks the shell to close (View menu) */
	conceal = $state<{ panel: string; at: number } | null>(null);
	/** Panels currently in the layout (the shell keeps this up to date; the View menu checks them) */
	openPanels = $state<string[]>([]);
	/** The host hid this Oxygen instance (a background VS Code tab): viewports stop running */
	suspended = $state(false);
	/** Layout preset the UI asks the shell to apply */
	layoutRequest = $state<{ name: LayoutName; at: number } | null>(null);
	/** bumped when a resource pack is opened or an image is imported: textures resolve again */
	packVersion = $state(0);
	/**
	 * Images imported on their own (no resource pack), by texture path (`textures/particle/spark`) → data URL.
	 * They stand in for the pack's file at that path for every open effect.
	 */
	importedTextures = $state<Record<string, string>>({});
	/** Toast-style status message ("Saved fire.particle.json") */
	notice = $state<{ text: string; kind: 'info' | 'error'; at: number } | null>(null);

	/** Effect JSON fetched from the host by identifier (null = not found) */
	private effectCache = new Map<string, unknown | null>();

	/** everything the host stores for the UI (layout, preferences), so writers never undo each other's changes */
	private settings: Promise<Record<string, unknown>>;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	/** the preferences as last saved or taken from the host, so an unchanged copy isn't saved again */
	private savedPrefs = '';

	constructor(readonly host: Host) {
		this.settings = host.loadSettings().catch(() => ({}));
		void this.settings.then((s) => this.applySettings(s));
		if (host.updates) {
			host.updates.onStatus((s) => this.setUpdate(s));
			void host.updates.status().then((s) => this.setUpdate(s));
		}
	}

	private setUpdate(s: UpdateState): void {
		this.update = s;
		if (!this.manualCheck || s.state === 'checking' || s.state === 'idle') return;
		this.manualCheck = false;
		if (s.state === 'current') this.say(`Oxygen ${s.version} is the newest version.`);
		else if (s.state === 'error') this.say(s.message, 'error');
		else if (s.state === 'unsupported') this.say(s.reason);
	}

	/** Look for a newer Oxygen now, and say what came of it */
	async checkForUpdates(): Promise<void> {
		if (!this.host.updates) return;
		this.manualCheck = true;
		await this.host.updates.check();
	}

	/** Restart (or reload) into the update, after asking when there's unsaved work */
	installUpdate(): void {
		if (!this.host.updates) return;
		const dirty = this.sessions.filter((s) => s.dirty).map((s) => s.file.name);
		const verb = this.host.kind === 'web' ? 'Reload' : 'Restart';
		if (dirty.length && !confirm(`${dirty.join(', ')} ${dirty.length === 1 ? 'has' : 'have'} unsaved changes, which ${verb.toLowerCase()}ing loses. ${verb} anyway? (Cancel, save, then ${verb.toLowerCase()}.)`)) return;
		this.host.updates.install();
	}

	get inspectorView(): InspectorView {
		return this.prefs.inspectorView;
	}
	set inspectorView(v: InspectorView) {
		this.prefs.inspectorView = v;
	}
	/** viewport rendering: the classic renderer, the Vibrant Visuals approximation, or both side by side */
	get renderMode(): RenderMode {
		return this.prefs.renderMode;
	}
	set renderMode(v: RenderMode) {
		this.prefs.renderMode = v;
	}
	/** viewport helpers shown (the ground, the scale block, emitter markers, the kill plane, the entity) */
	get gizmos(): Gizmos {
		return this.prefs.gizmos;
	}
	set gizmos(v: Gizmos) {
		this.prefs.gizmos = v;
	}
	/** Vibrant Visuals shows the game's sky behind particles; off keeps the classic backdrop to compare just the particles */
	get vvSky(): boolean {
		return this.prefs.vvSky;
	}
	set vvSky(v: boolean) {
		this.prefs.vvSky = v;
	}

	/** Settings from the host (at the start, and when another Oxygen editor changed them) */
	applySettings(s: Record<string, unknown>): void {
		this.settings = Promise.resolve(s);
		const prefs = readPreferences(s.preferences, s);
		this.savedPrefs = JSON.stringify(prefs);
		this.prefs = prefs;
		this.prefsLoaded = true;
		// the kept images (another VS Code editor may have changed them), and the ones too big to keep from this run
		const kept = readImportedTextures(s.importedTextures);
		const next = { ...kept };
		for (const [k, v] of Object.entries(this.importedTextures)) if (!this.keptTextures.has(k)) next[k] ??= v;
		this.keptTextures = new Set(Object.keys(kept));
		if (JSON.stringify(next) !== JSON.stringify(this.importedTextures)) {
			this.importedTextures = next;
			this.packVersion++;
		}
	}

	/** texture paths whose imported image is kept with the settings (the rest last until Oxygen closes) */
	private keptTextures = new Set<string>();

	/** A texture path as an image URL: an imported image first, then the host (the file's pack, vanilla sprites) */
	resolveTexture(texture: string, file: FileRef): Promise<string | null> {
		const imported = this.importedTextures[textureKey(texture)];
		return imported ? Promise.resolve(imported) : this.host.resolveTexture(texture, file);
	}

	/**
	 * Use an image for a texture path without a resource pack. Small images are kept with the settings so they
	 * come back next time; bigger ones last until Oxygen closes. Says which.
	 */
	importTexture(texture: string, dataUrl: string): boolean {
		const key = textureKey(texture);
		this.importedTextures = { ...this.importedTextures, [key]: dataUrl };
		this.packVersion++;
		const kept = keepable(this.importedTextures);
		this.keptTextures = new Set(Object.keys(kept));
		this.updateSettings({ importedTextures: Object.keys(kept).length ? kept : undefined });
		return this.keptTextures.has(key);
	}

	/** Stop using an imported image: the path resolves through the pack again */
	removeImportedTexture(texture: string): void {
		const key = textureKey(texture);
		if (!(key in this.importedTextures)) return;
		const next = { ...this.importedTextures };
		delete next[key];
		this.importedTextures = next;
		this.packVersion++;
		const kept = keepable(next);
		this.keptTextures = new Set(Object.keys(kept));
		this.updateSettings({ importedTextures: Object.keys(kept).length ? kept : undefined });
	}

	/** The host's stored settings (layout, preferences) */
	loadSettings(): Promise<Record<string, unknown>> {
		return this.settings;
	}

	/** Change some of the stored settings and keep the rest (`undefined` removes one) */
	updateSettings(patch: Record<string, unknown>): void {
		this.settings = this.settings.then((s) => {
			const next = { ...s, ...patch };
			for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
			this.host.saveSettings(next);
			return next;
		});
	}

	/** Keep the preferences, a moment after the last change (sliders change them many times a second) */
	savePreferences(): void {
		if (!this.prefsLoaded) return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			const prefs = $state.snapshot(this.prefs);
			const json = JSON.stringify(prefs);
			if (json === this.savedPrefs) return;
			this.savedPrefs = json;
			// the viewport's helpers were kept on their own before there were preferences
			this.updateSettings({ preferences: prefs, gizmos: undefined });
		}, 250);
	}

	/** Every preference back to its default (the layout stays) */
	resetPreferences(): void {
		this.prefs = structuredClone(DEFAULT_PREFERENCES);
	}

	openSettings(section?: SettingsSection): void {
		if (section) this.settingsSection = section;
		this.settingsOpen = true;
		this.aboutOpen = false;
		this.shortcutsOpen = false;
		this.paletteOpen = false;
	}

	openAbout(section?: AboutSection): void {
		if (section) this.aboutSection = section;
		this.aboutOpen = true;
		this.settingsOpen = false;
		this.shortcutsOpen = false;
		this.paletteOpen = false;
	}

	/** How a new effect's preview starts */
	private previewDefaults() {
		const p = this.prefs;
		return { spawnMode: p.spawnMode, repeat: p.repeat, speed: p.speed, timeOfDay: p.timeOfDay };
	}

	/** JSON of an effect by identifier: open documents first, then whatever the host already found */
	findEffectJson(id: string): unknown | null {
		const open = this.sessions.find((s) => s.def?.identifier === id);
		if (open) return open.doc.value;
		if (!this.effectCache.has(id)) void this.fetchEffect(id);
		return this.effectCache.get(id) ?? null;
	}

	private async fetchEffect(id: string): Promise<void> {
		this.effectCache.set(id, null);
		const text = await this.host.findEffect?.(id);
		if (!text) return;
		try {
			this.effectCache.set(id, parseJsonc(text, [], { allowTrailingComma: true }));
		} catch {
			return;
		}
		// sessions that spawn this child pick it up
		for (const s of this.sessions) {
			if (s.usesEffect(id)) {
				s.invalidateChildren();
				s.restart();
			}
		}
	}

	get active(): EffectSession | null {
		return this.sessions.find((s) => s.id === this.activeId) ?? null;
	}

	open(file: OpenedFile): EffectSession {
		const existing = file.file.id ? this.sessions.find((s) => s.file.id === file.file.id) : undefined;
		if (existing) {
			this.activeId = existing.id;
			return existing;
		}
		const s = new EffectSession(file.text, file.file, { findChild: (id) => this.findEffectJson(id), defaults: this.previewDefaults() });
		if (this.host.onDocumentChange) {
			s.doc.onChange((c) => {
				if (c.origin !== 'external') this.host.onDocumentChange!(s.file, { edits: c.edits, label: c.label }, s.doc.text);
			});
		}
		// other open effects that spawn this one, or show it in their scene, follow its edits
		s.doc.onChange(() => {
			const id = s.def?.identifier;
			this.updateParentInputs();
			if (!id) return;
			for (const other of this.sessions) {
				if (other === s || !other.usesEffect(id)) continue;
				other.invalidateChildren();
				other.restart();
			}
		});
		this.sessions.push(s);
		this.updateParentInputs();
		this.activeId = s.id;
		void this.loadPackVisuals(s);
		this.openFilesChanged();
		return s;
	}

	/** Tell the host which files are open (it restores them next time) */
	private openFilesChanged(): void {
		this.host.onOpenFilesChanged?.(this.sessions.map((x) => x.file));
	}

	/** what the host found in the pack: parents' pre-effect variables by child identifier (asked once each) */
	private hostParents = new Map<string, Record<string, string> | null>();

	/**
	 * Tell each open effect which of its variables the pre-effects of effects that spawn it set: open
	 * effects as they are now, plus the rest of the pack as the host knows it
	 */
	private updateParentInputs(): void {
		const open = this.sessions.flatMap((p) => spawnsOf(p.doc.value) ?? []);
		for (const s of this.sessions) {
			const id = s.def?.identifier;
			if (!id) continue;
			if (this.host.parentInputs && !this.hostParents.has(id)) {
				this.hostParents.set(id, null);
				void this.host
					.parentInputs(id, s.file)
					.then((r) => {
						this.hostParents.set(id, r ?? {});
						this.updateParentInputs();
					})
					.catch(() => this.hostParents.set(id, {}));
			}
			const merged = { ...(this.hostParents.get(id) ?? {}) };
			for (const [v, from] of Object.entries(parentInputsFor(open, id))) {
				const all = new Set([...(merged[v]?.split(', ') ?? []), ...from.split(', ')]);
				merged[v] = [...all].join(', ');
			}
			s.setParentInputs(merged);
		}
	}

	/** Show the effect with this identifier: switch to it when it's open, otherwise ask the host to open it */
	async showEffect(identifier: string): Promise<EffectSession | null> {
		const open = this.sessions.find((s) => s.def?.identifier === identifier);
		if (open) {
			this.activeId = open.id;
			return open;
		}
		const r = this.host.openEffect ? await this.host.openEffect(identifier) : null;
		if (r === 'shown') return null;
		if (r) return this.open(r);
		this.say(`${identifier} isn't in this pack, so there's nothing to open.`, 'error');
		return null;
	}

	/** Open a file the host remembers (recent files) */
	async openKnown(file: FileRef): Promise<void> {
		const opened = await this.host.openFile?.(file);
		if (opened) this.open(opened);
		else this.say(`${file.name} isn't there anymore.`, 'error');
	}

	/** Lighting, color grading and the texture set for Vibrant Visuals, from the file's pack */
	async loadPackVisuals(s: import('./session.svelte').EffectSession): Promise<void> {
		const read = this.host.readPackText;
		if (!read) return;
		const json = async (path: string) => {
			const text = await read.call(this.host, path, s.file).catch(() => null);
			if (!text) return null;
			// jsonc-parser salvages what it can from anything: a file that isn't JSON counts as missing
			const errors: ParseError[] = [];
			const value = parseJsonc(text, errors, { allowTrailingComma: true });
			return errors.length || !value || typeof value !== 'object' ? null : value;
		};
		const [lighting, grading, set, manifest] = await Promise.all([
			json('lighting/global.json'),
			json('color_grading/color_grading.json'),
			s.def?.texture ? json(`${s.def.texture}.texture_set.json`) : Promise.resolve(null),
			json('manifest.json'),
		]);
		if (lighting) s.vvLighting = parseLighting(lighting);
		if (grading) s.vvGrading = parseGrading(grading);
		s.textureSet = set ? parseTextureSet(set) : null;
		s.textureSetUnsaved = false;
		// a resource pack without the pbr capability turns Vibrant Visuals off in-game while it's active (t65)
		const caps = (manifest as { capabilities?: unknown } | null)?.capabilities;
		const pbr = manifest ? Array.isArray(caps) && caps.includes('pbr') : null;
		s.vvFromPack = { lighting: !!lighting, grading: !!grading, textureSet: !!s.textureSet, pbr };
	}

	newEffect(): EffectSession {
		const n = this.sessions.filter((s) => s.file.id === null).length + 1;
		const name = n === 1 ? 'untitled' : `untitled_${n}`;
		const text = `${JSON.stringify(newEffect(`custom:${name}`), null, '\t')}\n`;
		return this.open({ file: { name: `${name}.particle.json`, id: null }, text });
	}

	close(id: string): void {
		const i = this.sessions.findIndex((s) => s.id === id);
		if (i < 0) return;
		this.sessions[i].dispose();
		this.sessions.splice(i, 1);
		this.updateParentInputs();
		if (this.activeId === id) this.activeId = this.sessions[Math.min(i, this.sessions.length - 1)]?.id ?? null;
		this.openFilesChanged();
	}

	/** Ask the host for a resource pack folder; textures, child effects and pack visuals then come from it */
	async openPack(): Promise<void> {
		const name = await this.host.openPack?.().catch(() => null);
		if (!name) return;
		this.packVersion++;
		this.effectCache.clear();
		this.hostParents.clear();
		for (const s of this.sessions) {
			s.invalidateChildren();
			s.restart();
			void this.loadPackVisuals(s);
		}
		this.updateParentInputs();
		this.say(`Opened ${name}. Textures and child effects now come from it.`);
	}

	async openFiles(): Promise<void> {
		const files = (await this.host.openFiles?.()) ?? [];
		for (const f of files) this.open(f);
	}

	async save(session = this.active): Promise<void> {
		if (!session) return;
		try {
			const file: FileRef | null = await this.host.save(session.file, session.doc.text);
			session.markSaved(file ?? undefined);
			if (file) this.openFilesChanged();
			this.say(`Saved ${session.file.name}${this.host.savedNote?.(session.file) ?? ''}`);
		} catch (e) {
			if ((e as Error).name === 'AbortError') return;
			this.say(`Couldn't save ${session.file.name}: ${(e as Error).message}`, 'error');
		}
	}

	/** Save to a new place the user picks (hosts that can) */
	async saveAs(session = this.active): Promise<void> {
		if (!session || !this.host.saveAs) return;
		try {
			const file = await this.host.saveAs(session.file, session.doc.text);
			if (!file) return;
			session.markSaved(file);
			this.openFilesChanged();
			this.say(`Saved ${session.file.name}${this.host.savedNote?.(session.file) ?? ''}`);
		} catch (e) {
			if ((e as Error).name === 'AbortError') return;
			this.say(`Couldn't save ${session.file.name}: ${(e as Error).message}`, 'error');
		}
	}

	/** Download a copy of the document (web) */
	download(session = this.active): void {
		if (!session || !this.host.download) return;
		this.host.download(session.file, session.doc.text);
	}

	/** Content log entries from the game, routed to the open files they mention */
	applyGameLog(entries: { file: string; level: string; message: string; expression: string | null; path: string | null }[]): void {
		for (const s of this.sessions) {
			const name = s.file.name.toLowerCase();
			const mine = entries.filter((e) => e.file.toLowerCase().split('\\').join('/').endsWith(name));
			if (!mine.length) continue;
			s.gameProblems = mine.map((e) => ({
				path: e.path ?? '',
				severity: e.level === 'error' ? 'error' : e.level === 'warning' ? 'warning' : 'info',
				message: `In-game: ${e.message}${e.expression ? ` (${e.expression})` : ''}`,
				code: 'game-log',
				source: 'game',
			}));
		}
	}

	show(panel: string): void {
		this.reveal = { panel, at: Date.now() };
	}

	hide(panel: string): void {
		this.conceal = { panel, at: Date.now() };
	}

	undo(session = this.active): void {
		if (!session) return;
		if (this.host.undo) this.host.undo(session.file);
		else session.doc.undo();
	}

	redo(session = this.active): void {
		if (!session) return;
		if (this.host.redo) this.host.redo(session.file);
		else session.doc.redo();
	}

	say(text: string, kind: 'info' | 'error' = 'info'): void {
		this.notice = { text, kind, at: Date.now() };
	}
}

/** a texture path without its extension, the way the game looks it up */
export const textureKey = (texture: string) => texture.replace(/\.(png|tga)$/i, '');

/** imported images the settings can carry: the browser keeps settings in a few megabytes of local storage */
const KEEP_EACH = 512 * 1024;
const KEEP_TOTAL = 2 * 1024 * 1024;

function keepable(all: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	let total = 0;
	for (const [k, v] of Object.entries(all)) {
		if (v.length > KEEP_EACH || total + v.length > KEEP_TOTAL) continue;
		out[k] = v;
		total += v.length;
	}
	return out;
}

function readImportedTextures(raw: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v.startsWith('data:image/')) out[k] = v;
	return out;
}
