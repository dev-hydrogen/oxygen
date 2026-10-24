import * as vscode from 'vscode';
import type { PackIndex } from './pack';
import type { TextEdit, ToExtension, ToWebview } from './protocol';
import { aboutVsCode, answerRequest, localRoots, saveCapture, webviewHtml, writePackFile } from './webview';

/**
 * Oxygen as a custom text editor. The VS Code TextDocument stays the source of truth:
 * - Oxygen's edits arrive as minimal text edits and are applied in order as WorkspaceEdits (so VS Code owns
 *   undo/redo, dirty state and saving);
 * - changes made anywhere else are sent back as the new text; Oxygen diffs it into its model, so open editors
 *   keep their cursor and nothing is re-imported.
 */
export class OxygenEditorProvider implements vscode.CustomTextEditorProvider {
	/** open Oxygen editors by document URI */
	private panels = new Map<string, Set<vscode.WebviewPanel>>();
	/** layouts asked for before the editor opened, applied once its webview is ready */
	private pendingLayout = new Map<string, 'editor' | 'code' | 'debug'>();

	constructor(
		private context: vscode.ExtensionContext,
		private pack: PackIndex,
	) {}

	async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
		const webview = panel.webview;
		webview.options = { enableScripts: true, localResourceRoots: localRoots(this.context.extensionUri) };
		const init = (): ToWebview => ({
			type: 'init',
			text: document.getText(),
			version: document.version,
			name: document.uri.path.split('/').pop() ?? 'particle.json',
			uri: document.uri.toString(),
			mode: 'full',
			settings: this.context.globalState.get('oxygen.ui') ?? {},
			theme: vscode.workspace.getConfiguration('oxygen').get('theme', 'vscode'),
			about: aboutVsCode(this.context),
		});
		// the document travels in the HTML, so the editor starts without a round trip
		webview.html = webviewHtml(webview, this.context.extensionUri, init());

		/** document version after the last edit we applied for Oxygen; anything else is an outside change */
		let ownVersion = -1;
		let queue: Promise<void> = Promise.resolve();
		const post = (m: ToWebview) => void webview.postMessage(m);
		const key = document.uri.toString();
		if (!this.panels.has(key)) this.panels.set(key, new Set());
		this.panels.get(key)!.add(panel);

		const applyEdits = async (edits: TextEdit[], label: string) => {
			for (const e of edits) {
				const we = new vscode.WorkspaceEdit();
				we.replace(document.uri, new vscode.Range(document.positionAt(e.offset), document.positionAt(e.offset + e.length)), e.content, { needsConfirmation: false, label });
				ownVersion = document.version + 1;
				const ok = await vscode.workspace.applyEdit(we);
				if (!ok) {
					// the document moved under us: resynchronise Oxygen with the real text
					ownVersion = -1;
					post({ type: 'external', text: document.getText(), version: document.version });
					return;
				}
				ownVersion = document.version;
			}
		};

		const sub = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) return;
			if (e.document.version === ownVersion) return; // our own edit echoing back
			post({ type: 'external', text: document.getText(), version: document.version });
		});

		webview.onDidReceiveMessage((msg: ToExtension) => {
			switch (msg.type) {
				case 'ready':
					// started from the HTML: only catch it up if the document moved meanwhile
					if (msg.embedded === undefined) post(init());
					else if (msg.embedded !== document.version) post({ type: 'external', text: document.getText(), version: document.version });
					if (this.pendingLayout.has(key)) {
						post({ type: 'layout', name: this.pendingLayout.get(key)! });
						this.pendingLayout.delete(key);
					}
					break;
				case 'edit':
					queue = queue.then(() => applyEdits(msg.edits, msg.label)).catch(() => undefined);
					break;
				case 'undo':
				case 'redo':
					queue = queue.then(async () => {
						await vscode.commands.executeCommand(msg.type);
					});
					break;
				case 'save':
					queue = queue.then(async () => {
						await document.save();
					});
					break;
				case 'settings':
					void this.context.globalState.update('oxygen.ui', msg.settings);
					// the other open editors take the same preferences
					for (const set of this.panels.values()) for (const other of set) if (other !== panel) void other.webview.postMessage({ type: 'settings', settings: msg.settings } satisfies ToWebview);
					break;
				case 'request':
					void answerRequest(webview, this.pack, document.uri, msg);
					break;
				case 'openExample':
					void this.pack.examples.open(msg.name);
					break;
				case 'writeText':
					void writePackFile(webview, this.pack, document.uri, msg.id, msg.path, new TextEncoder().encode(msg.text));
					break;
				case 'writeTexture':
					void writePackFile(webview, this.pack, document.uri, msg.id, `${msg.path.replace(/\.(png|tga)$/i, '')}.png`, Uint8Array.from(atob(msg.pngBase64), (c) => c.charCodeAt(0)));
					break;
				case 'saveCapture':
					void saveCapture(webview, document.uri, msg.id, msg.name, Uint8Array.from(atob(msg.base64), (c) => c.charCodeAt(0)));
					break;
			}
		});

		// background tabs keep their state (retainContextWhenHidden) but stop simulating
		const viewState = panel.onDidChangeViewState((e) => post({ type: 'visibility', visible: e.webviewPanel.visible }));
		panel.onDidDispose(() => {
			viewState.dispose();
			sub.dispose();
			this.panels.get(key)?.delete(panel);
		});
	}

	/** Switch an open Oxygen editor's layout, or the next one to open for this file */
	layout(uri: vscode.Uri, name: 'editor' | 'code' | 'debug'): boolean {
		const all = [...(this.panels.get(uri.toString()) ?? [])];
		const targets = all.some((p) => p.active) ? all.filter((p) => p.active) : all;
		for (const p of targets) void p.webview.postMessage({ type: 'layout', name } satisfies ToWebview);
		if (!targets.length) this.pendingLayout.set(uri.toString(), name);
		return targets.length > 0;
	}
}
