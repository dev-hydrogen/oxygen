import { mountOxygen, type FileRef, type Host } from '@oxygen/ui';
import type { DesktopApi, DesktopFile } from '../src/api';

/** Oxygen in Electron: native files, pack folders, outside-change sync and the game link */
const desk = (window as unknown as { oxygenDesktop: DesktopApi }).oxygenDesktop;

const toBase64 = async (blob: Blob) => {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
};

const statusListeners: ((s: Awaited<ReturnType<DesktopApi['gameStatus']>>) => void)[] = [];
desk.onGameStatus((s) => statusListeners.forEach((cb) => cb(s)));

const host: Host = {
	kind: 'desktop',
	async openFiles() {
		const files = await desk.openFiles();
		for (const f of files) desk.watch(f.path);
		return files.map((f) => ({ file: { name: f.name, id: f.path }, text: f.text }));
	},
	async openPack() {
		const dir = await desk.openPack();
		return dir ? (dir.split(/[\\/]/).filter(Boolean).pop() ?? dir) : null;
	},
	async save(file: FileRef, text: string) {
		const r = await desk.save(file.id, file.name, text);
		// the save dialog was cancelled: nothing to report
		if (!r) throw new DOMException('Save cancelled', 'AbortError');
		return r.path === file.id ? null : { name: r.name, id: r.path };
	},
	async saveAs(file: FileRef, text: string) {
		const r = await desk.save(null, file.name, text);
		if (!r) throw new DOMException('Save cancelled', 'AbortError');
		return { name: r.name, id: r.path };
	},
	async examples() {
		return (await desk.examples()).map((e) => ({ name: e.name, load: async () => e.text }));
	},
	resolveTexture: (texture, file) => desk.readTexture(file.id, texture),
	saveTexture: async (texture, file, png) => desk.saveTexture(file.id, texture, await toBase64(png)),
	findEffect: (identifier) => desk.findEffect(app.workspace.active?.file.id ?? null, identifier),
	parentInputs: (identifier, file) => desk.parentInputs(file.id, identifier),
	async openEffect(identifier) {
		const f = await desk.openEffect(app.workspace.active?.file.id ?? null, identifier);
		if (!f) return null;
		// an example opens as an example: there's no file to watch
		if (!f.path.startsWith('example:')) desk.watch(f.path);
		return { file: { name: f.name, id: f.path }, text: f.text };
	},
	readPackText: (path, file) => desk.readPackText(file.id, path),
	writePackText: (path, file, text) => desk.writePackText(file.id, path, text),
	async recentFiles() {
		return (await desk.recent()).map((r) => ({ name: r.name, id: r.path }));
	},
	async openFile(file) {
		const f = file.id ? await desk.openPath(file.id) : null;
		if (!f) return null;
		desk.watch(f.path);
		return { file: { name: f.name, id: f.path }, text: f.text };
	},
	onOpenFilesChanged: (files) => desk.setOpenFiles(files.flatMap((f) => (f.id ? [f.id] : []))),
	loadSettings: () => desk.settings(),
	saveSettings: (s) => desk.saveSettings(s),
	settingsLocation: 'In settings.json in Oxygen’s app data folder (About › System shows where).',
	setZoom: (factor) => desk.setZoom(factor),
	setMenuKeys: (keys) => desk.setMenuKeys(keys),
	about: async () => {
		const a = await desk.about();
		return [
			{ label: 'Electron', value: `${a.electron} (Chromium ${a.chrome}, Node ${a.node})` },
			{ label: 'Operating system', value: a.platform },
			{ label: 'Settings file', value: a.settings },
		];
	},
	game: {
		status: () => desk.gameStatus(),
		onStatus: (cb) => statusListeners.push(cb),
		deploy: (file) => desk.deploy(file.id),
		spawn: (identifier, variables, offset) => desk.spawn(identifier, variables, offset),
		reload: () => desk.command('reload all'),
	},
};

const app = mountOxygen(document.getElementById('app')!, host);
const w = app.workspace;
(window as unknown as { oxygen: unknown }).oxygen = w;

desk.onExternalChange((path, text) => {
	const s = w.sessions.find((x) => x.file.id === path);
	if (!s || s.doc.text === text) return;
	if (s.dirty) {
		// never overwrite unsaved work
		w.say(`${s.file.name} changed on disk. Your unsaved edits are kept; save to overwrite the file or close and reopen it to load the disk version.`, 'error');
		return;
	}
	s.doc.setText(text, 'external', 'Changed on disk');
	s.markSaved();
});
desk.onGameLog((entries) => w.applyGameLog(entries));
desk.onMenu((cmd) => {
	if (cmd === 'new') w.newEffect();
	else if (cmd === 'open') void w.openFiles();
	else if (cmd === 'save') void w.save();
	else if (cmd === 'palette') w.paletteOpen = true;
	else if (cmd === 'openPack') void w.openPack();
	else if (cmd === 'settings') w.openSettings();
	else if (cmd === 'about') w.openAbout();
});

// reopen what was open last time (or files passed on the command line); otherwise the start screen. Files opened
// from outside later arrive the same way; one already open gets its tab focused.
const openAll = (files: DesktopFile[]) => {
	for (const f of files) {
		desk.watch(f.path);
		w.open({ file: { name: f.name, id: f.path }, text: f.text });
	}
};
desk.onOpenRequested(openAll);
void desk.openedAtStart().then(openAll);
