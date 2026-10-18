import { mountOxygen, type FileRef, type Host } from '@oxygen/ui';
import type { ToExtension, ToWebview } from '../src/protocol';
import './theme.css';

/**
 * Oxygen inside a VS Code webview. VS Code owns the document: Oxygen's edits go out as minimal text edits,
 * outside changes come in as text, and undo/redo/save are VS Code's.
 */
declare function acquireVsCodeApi(): { postMessage(m: ToExtension): void; getState(): unknown; setState(s: unknown): void };
const vscode = acquireVsCodeApi();
const post = (m: ToExtension) => vscode.postMessage(m);

let nextRequest = 1;
const pending = new Map<number, (v: unknown) => void>();
/**
 * Ask the extension and wait for its reply. A reply that never comes (the extension failed, the editor
 * is going away) resolves as null after a while, so nothing waiting on it stays in memory.
 */
function ask(message: (id: number) => ToExtension, timeoutMs = 20000): Promise<unknown> {
	const id = nextRequest++;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			resolve(null);
		}, timeoutMs);
		pending.set(id, (v) => {
			clearTimeout(timer);
			resolve(v);
		});
		post(message(id));
	});
}
async function request<T>(kind: 'texture' | 'effect' | 'text' | 'openEffect' | 'parents' | 'examples' | 'example', arg: string): Promise<T | null> {
	return ((await ask((id) => ({ type: 'request', id, kind, arg }))) as T) ?? null;
}

let settings: Record<string, unknown> = {};
let about: { label: string; value: string }[] = [];

const host: Host = {
	kind: 'vscode',
	async save() {
		post({ type: 'save' });
		return null;
	},
	// the bundled examples; one opens in an editor of its own, as a new untitled document
	async examples() {
		const names = (await request<string[]>('examples', '')) ?? [];
		return names.map((name) => ({ name, load: async () => (await request<string>('example', name)) ?? '' }));
	},
	openExample: (name) => post({ type: 'openExample', name }),
	resolveTexture: (texture) => request<string>('texture', texture),
	findEffect: (identifier) => request<string>('effect', identifier),
	parentInputs: async (identifier) => (await request<Record<string, string>>('parents', identifier)) ?? {},
	openEffect: async (identifier) => ((await request<boolean>('openEffect', identifier)) ? 'shown' : null),
	readPackText: (path) => request<string>('text', path),
	writePackText: async (path, _file, text) => (await ask((id) => ({ type: 'writeText', id, path, text }))) === true,
	saveTexture: async (texture, _file, png) => {
		const bytes = new Uint8Array(await png.arrayBuffer());
		let s = '';
		for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		return (await ask((id) => ({ type: 'writeTexture', id, path: texture, pngBase64: btoa(s) }))) === true;
	},
	async loadSettings() {
		return settings;
	},
	saveSettings(s) {
		settings = s;
		post({ type: 'settings', settings: s });
	},
	settingsLocation: 'In VS Code’s storage for the extension, on this machine. Each open Oxygen editor reads them when it opens.',
	about: async () => about,
	onDocumentChange(_file: FileRef, change) {
		post({ type: 'edit', edits: change.edits, label: change.label });
	},
	undo: () => post({ type: 'undo' }),
	redo: () => post({ type: 'redo' }),
};

let app: ReturnType<typeof mountOxygen> | null = null;

function start(m: Extract<ToWebview, { type: 'init' }>) {
	if (app) return;
	settings = m.settings ?? {};
	about = m.about ?? [];
	document.body.classList.toggle('ox-follow-vscode', m.theme !== 'oxygen');
	app = mountOxygen(document.getElementById('app')!, host, { mode: m.mode });
	(window as unknown as { oxygen: unknown }).oxygen = app.workspace;
	if (m.text) app.workspace.open({ file: { name: m.name, id: m.uri }, text: m.text });
	// the skeleton the HTML painted goes once the editor has drawn its first frame
	requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('ox-boot')?.remove()));
}

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
	const m = e.data;
	switch (m.type) {
		case 'init': {
			start(m);
			break;
		}
		case 'external': {
			const s = app?.workspace.active;
			if (s && s.doc.text !== m.text) s.doc.setText(m.text, 'external', 'Changed in VS Code');
			break;
		}
		case 'open': {
			if (!app) break;
			const w = app.workspace;
			for (const s of [...w.sessions]) w.close(s.id);
			w.open({ file: { name: m.name, id: m.uri }, text: m.text });
			break;
		}
		case 'reply': {
			pending.get(m.id)?.(m.value);
			pending.delete(m.id);
			break;
		}
		case 'settings': {
			settings = m.settings;
			app?.workspace.applySettings(m.settings);
			break;
		}
		case 'visibility': {
			if (app) app.workspace.suspended = !m.visible;
			break;
		}
		case 'layout': {
			if (app) app.workspace.layoutRequest = { name: m.name, at: Date.now() };
			break;
		}
	}
});

// the extension embeds the first message in the HTML; without it (older hosts) it's sent on ready
const embedded = document.getElementById('ox-init')?.textContent;
const first = embedded ? (JSON.parse(embedded) as Extract<ToWebview, { type: 'init' }>) : null;
if (first) start(first);
post({ type: 'ready', embedded: first?.version });
