import { mountOxygen, readShareHash, type FileRef, type Host, type OpenedFile } from '@oxygen/ui';
import { parentInputsFor, spawnsOf, type EffectSpawns } from '@oxygen/effect';
import { allStored, getStored, putStored, touchStored } from './store';
import { webUpdates } from './updates';

/**
 * Browser host. With the File System Access API (Chromium) files open and save in place; without it (Firefox,
 * Safari) Save keeps the document in the browser, under the same entry each time, and Download hands out a copy.
 * Either way Recent and the files open last time survive a reload (store.ts).
 * Textures resolve against an opened pack folder, then the sprites wintersky bundles for vanilla paths.
 */

type Permission = 'granted' | 'denied' | 'prompt';
type FileHandle = {
	kind?: 'file';
	name: string;
	getFile(): Promise<File>;
	createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
	queryPermission?(o: { mode: 'readwrite' }): Promise<Permission>;
	requestPermission?(o: { mode: 'readwrite' }): Promise<Permission>;
};
type DirHandle = {
	name: string;
	kind: 'directory';
	getDirectoryHandle(n: string): Promise<DirHandle>;
	getFileHandle(n: string): Promise<FileHandle>;
	values(): AsyncIterable<(FileHandle & { kind: 'file' }) | DirHandle>;
};
type Pickers = {
	showOpenFilePicker?: (o: unknown) => Promise<FileHandle[]>;
	showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
	showDirectoryPicker?: () => Promise<DirHandle>;
};
const pickers = window as unknown as Pickers;

/** picked files by document id (`handle:…`); stored too, so they can be reopened after a reload */
const handles = new Map<string, FileHandle>();

const newId = (kind: 'handle' | 'local') => `${kind}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Keep a picked file's handle under a document id */
function remember(h: FileHandle, id = newId('handle')): string {
	handles.set(id, h);
	void putStored({ id, name: h.name, handle: h, used: Date.now() }).catch(() => {});
	return id;
}

/** Write access to a picked file; after a reload Chromium asks again, which needs a click (`ask`) */
async function permitted(h: FileHandle, ask: boolean): Promise<boolean> {
	if (!h.queryPermission) return true;
	if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
	return ask && (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

async function writeTo(h: FileHandle, text: string): Promise<void> {
	const out = await h.createWritable();
	await out.write(text);
	await out.close();
}

function downloadText(name: string, text: string): void {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Without file pickers: keep the document in the browser, overwriting its entry once it has one */
async function saveInBrowser(file: FileRef, text: string): Promise<FileRef | null> {
	const id = file.id?.startsWith('local:') ? file.id : newId('local');
	await putStored({ id, name: file.name, text, used: Date.now() });
	return id === file.id ? null : { name: file.name, id, where: 'in this browser' };
}

const exampleModules = import.meta.glob('../../../packages/ui/static/examples/*.particle.json', { query: '?raw', import: 'default' });
const builtinTextures: Record<string, string> = {
	'textures/particle/particles': new URL('../../../vendor/wintersky/assets/particles.png', import.meta.url).href,
	// vanilla keeps the flame atlas outside textures/particle (Snowstorm's textures/particle/flame_atlas isn't in the game)
	'textures/flame_atlas': new URL('../../../vendor/wintersky/assets/flame_atlas.png', import.meta.url).href,
	'textures/particle/campfire_smoke': new URL('../../../vendor/wintersky/assets/campfire_smoke.png', import.meta.url).href,
	'textures/particle/soul': new URL('../../../vendor/wintersky/assets/soul.png', import.meta.url).href,
};
const fileTextures = new Map<string, string>();

/** An opened resource pack: a folder handle (Chromium, writable) or the files of a picked folder (read-only) */
interface Pack {
	name: string;
	/** a file by pack-relative path */
	get(path: string): Promise<File | null>;
	/** the .json files under particles/ (with a handle when they can be saved in place) */
	particles(): Promise<{ file: File; handle?: FileHandle }[]>;
}
let pack: Pack | null = null;

function folderPack(root: DirHandle): Pack {
	return {
		name: root.name,
		async get(path) {
			const parts = path.split('/').filter(Boolean);
			try {
				let dir = root;
				for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
				return await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
			} catch {
				return null;
			}
		},
		async particles() {
			const out: { file: File; handle?: FileHandle }[] = [];
			const walk = async (dir: DirHandle, depth: number) => {
				if (depth > 6) return;
				for await (const h of dir.values()) {
					if (h.kind === 'directory') await walk(h, depth + 1);
					else if (h.name.endsWith('.json')) out.push({ file: await h.getFile(), handle: h });
				}
			};
			try {
				await walk(await root.getDirectoryHandle('particles'), 0);
			} catch {
				// no particles folder
			}
			return out;
		},
	};
}

/** A folder picked through `<input webkitdirectory>`: every file is there, none can be written */
function filesPack(files: File[]): Pack {
	// webkitRelativePath is "<folder>/<path in the pack>"
	const byPath = new Map(files.map((f) => [f.webkitRelativePath.split('/').slice(1).join('/'), f]));
	return {
		name: files[0]?.webkitRelativePath.split('/')[0] ?? 'pack',
		get: async (path) => byPath.get(path.split('/').filter(Boolean).join('/')) ?? null,
		particles: async () => [...byPath].filter(([p]) => p.startsWith('particles/') && p.endsWith('.json')).map(([, file]) => ({ file })),
	};
}

async function readPackFile(path: string): Promise<File | null> {
	if (!pack) return null;
	for (const ext of ['.png', '.tga', '']) {
		const f = await pack.get(path + ext);
		if (f) return f;
	}
	return null;
}

/** The identifier an effect file declares (not just any mention: events name other effects too) */
const identifierOf = (text: string) => /"identifier"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null;

/** identifier → effect in the opened pack's particles folder (built on first use) */
let packEffects: Promise<Map<string, { name: string; text: string; handle?: FileHandle }>> | null = null;
function packEffectIndex(): Promise<Map<string, { name: string; text: string; handle?: FileHandle }>> {
	if (!pack) return Promise.resolve(new Map());
	packEffects ??= (async () => {
		const index = new Map<string, { name: string; text: string; handle?: FileHandle }>();
		for (const { file, handle } of await pack!.particles()) {
			const text = await file.text();
			const id = identifierOf(text);
			if (id) index.set(id, { name: file.name, text, handle });
		}
		return index;
	})();
	return packEffects;
}

const pickerTypes = [{ description: 'Particle effect', accept: { 'application/json': ['.json'] } }];

/** A file input, resolving with what was picked (empty when cancelled) */
function pickFiles(setup: (input: HTMLInputElement) => void): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		setup(input);
		input.onchange = () => resolve([...(input.files ?? [])]);
		input.oncancel = () => resolve([]);
		input.click();
	});
}

const host: Host = {
	kind: 'web',
	updates: webUpdates(),
	async openFiles(): Promise<OpenedFile[]> {
		if (pickers.showOpenFilePicker) {
			try {
				const picked = await pickers.showOpenFilePicker({ multiple: true, types: pickerTypes });
				return Promise.all(picked.map(async (h) => ({ file: { name: h.name, id: remember(h) }, text: await (await h.getFile()).text() })));
			} catch {
				return [];
			}
		}
		const files = await pickFiles((input) => {
			input.accept = '.json';
			input.multiple = true;
		});
		return Promise.all(files.map(async (f) => ({ file: { name: f.name, id: null }, text: await f.text() })));
	},
	async save(file: FileRef, text: string): Promise<FileRef | null> {
		let handle = file.id ? handles.get(file.id) : undefined;
		if (!handle && file.id?.startsWith('handle:')) {
			handle = (await getStored(file.id))?.handle as FileHandle | undefined;
			if (handle) handles.set(file.id, handle);
		}
		if (handle) {
			if (!(await permitted(handle, true))) throw new Error('the browser didn’t allow writing to it');
			await writeTo(handle, text);
			void touchStored(file.id!);
			return null;
		}
		if (pickers.showSaveFilePicker) return host.saveAs!(file, text);
		return saveInBrowser(file, text);
	},
	// without a save picker there's nowhere to choose: Download a copy takes its place (and its shortcut)
	saveAs: pickers.showSaveFilePicker
		? async (file: FileRef, text: string): Promise<FileRef | null> => {
				const h = await pickers.showSaveFilePicker!({ suggestedName: file.name, types: pickerTypes });
				await writeTo(h, text);
				return { name: h.name, id: remember(h) };
			}
		: undefined,
	savedNote: (file) => (file.id?.startsWith('local:') ? ' in this browser (File › Download a copy puts it on disk)' : null),
	download: (file, text) => downloadText(file.name, text),
	async recentFiles() {
		return (await allStored())
			.sort((a, b) => b.used - a.used)
			.slice(0, 12)
			.map((f) => ({ name: f.name, id: f.id, where: f.text !== undefined ? 'in this browser' : 'on disk' }));
	},
	async openFile(file) {
		const stored = file.id ? await getStored(file.id) : undefined;
		if (!stored) return null;
		void touchStored(stored.id);
		if (stored.text !== undefined) return { file: { name: stored.name, id: stored.id, where: 'in this browser' }, text: stored.text };
		const h = stored.handle as FileHandle;
		try {
			if (!(await permitted(h, true))) return null;
			handles.set(stored.id, h);
			return { file: { name: h.name, id: stored.id }, text: await (await h.getFile()).text() };
		} catch {
			return null;
		}
	},
	onOpenFilesChanged(files) {
		localStorage.setItem('oxygen.openFiles', JSON.stringify(files.flatMap((f) => (f.id ? [f.id] : []))));
	},
	async examples() {
		return Object.entries(exampleModules)
			.map(([path, load]) => ({ name: path.split('/').pop()!.replace('.particle.json', ''), load: load as () => Promise<string> }))
			.sort((a, b) => a.name.localeCompare(b.name));
	},
	async readPackText(path: string) {
		// readPackFile tries the name as given last, after .png/.tga
		const f = await readPackFile(path);
		return f ? f.text() : null;
	},
	async findEffect(identifier: string) {
		const inPack = (await packEffectIndex()).get(identifier);
		if (inPack) return inPack.text;
		for (const e of await host.examples()) {
			const text = await e.load();
			if (identifierOf(text) === identifier) return text;
		}
		return null;
	},
	async parentInputs(identifier: string) {
		const index: EffectSpawns[] = [];
		const add = (text: string) => {
			try {
				const s = spawnsOf(JSON.parse(text));
				if (s) index.push(s);
			} catch {
				// not JSON: skip
			}
		};
		for (const e of (await packEffectIndex()).values()) add(e.text);
		for (const e of await host.examples()) add(await e.load());
		return parentInputsFor(index, identifier);
	},
	async openEffect(identifier: string) {
		const inPack = (await packEffectIndex()).get(identifier);
		// a read-only pack's effect saves into the browser like any other unsaved document
		if (inPack) return { file: { name: inPack.name, id: inPack.handle ? remember(inPack.handle) : null }, text: inPack.handle ? await (await inPack.handle.getFile()).text() : inPack.text };
		for (const e of await host.examples()) {
			const text = await e.load();
			if (identifierOf(text) === identifier) return { file: { name: `${e.name}.particle.json`, id: `example:${e.name}` }, text };
		}
		return null;
	},
	async resolveTexture(texture: string) {
		const key = texture.replace(/\.(png|tga)$/i, '');
		const fromPack = await readPackFile(key);
		if (fromPack) {
			const cached = fileTextures.get(key);
			if (cached) return cached;
			const url = URL.createObjectURL(fromPack);
			fileTextures.set(key, url);
			return url;
		}
		return builtinTextures[key] ?? null;
	},
	async loadSettings() {
		try {
			return JSON.parse(localStorage.getItem('oxygen.settings') ?? '{}');
		} catch {
			return {};
		}
	},
	saveSettings(settings) {
		localStorage.setItem('oxygen.settings', JSON.stringify(settings));
	},
	async openPack() {
		let next: Pack | null = null;
		if (pickers.showDirectoryPicker) {
			try {
				next = folderPack(await pickers.showDirectoryPicker());
			} catch {
				return null;
			}
		} else {
			// no folder handles (Firefox, Safari): read the folder's files once; edits to textures download instead
			const files = await pickFiles((input) => (input.webkitdirectory = true));
			if (!files.length) return null;
			next = filesPack(files);
		}
		pack = next;
		packEffects = null;
		for (const url of fileTextures.values()) URL.revokeObjectURL(url);
		fileTextures.clear();
		return pack.name;
	},
};

const { workspace } = mountOxygen(document.getElementById('app')!, host);

/** Reopen the files that were open last time; picked files need permission again, so those wait in Recent */
async function restoreOpenFiles(ids: string[]): Promise<void> {
	const examples = await host.examples();
	for (const id of ids) {
		try {
			if (id.startsWith('example:')) {
				const e = examples.find((x) => `example:${x.name}` === id);
				if (e) workspace.open({ file: { name: `${e.name}.particle.json`, id }, text: await e.load() });
				continue;
			}
			const stored = await getStored(id);
			if (!stored) continue;
			if (stored.text !== undefined) {
				workspace.open({ file: { name: stored.name, id, where: 'in this browser' }, text: stored.text });
				continue;
			}
			const h = stored.handle as FileHandle;
			if (!(await permitted(h, false))) continue;
			handles.set(id, h);
			workspace.open({ file: { name: h.name, id }, text: await (await h.getFile()).text() });
		} catch {
			// gone or unreadable: it stays out
		}
	}
}

// the files open last time; a share link opens its effect on top; a first visit starts with an example so the
// first screen shows something moving
const lastOpen = (() => {
	try {
		const v = JSON.parse(localStorage.getItem('oxygen.openFiles') ?? 'null');
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
	} catch {
		return null;
	}
})();
void (async () => {
	if (lastOpen) await restoreOpenFiles(lastOpen);
	const shared = readShareHash(location.hash);
	if (shared) workspace.open({ file: { name: 'shared.particle.json', id: null }, text: shared });
	else if (!lastOpen && !workspace.sessions.length) {
		const list = await host.examples();
		const first = list.find((e) => e.name === 'fire') ?? list[0];
		if (first && !workspace.sessions.length) workspace.open({ file: { name: `${first.name}.particle.json`, id: `example:${first.name}` }, text: await first.load() });
	}
})();

// drop particle files anywhere to open them
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
	e.preventDefault();
	for (const f of [...(e.dataTransfer?.files ?? [])]) if (f.name.endsWith('.json')) workspace.open({ file: { name: f.name, id: null }, text: await f.text() });
});

// offline use: cache the app shell (production builds only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js');

// debugging handle for headless UI checks
(window as unknown as { oxygen: unknown }).oxygen = workspace;
