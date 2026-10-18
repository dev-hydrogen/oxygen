import * as vscode from 'vscode';
import { isParticleDocument, type PackIndex } from './pack';
import type { ToExtension, ToWebview } from './protocol';
import { aboutVsCode, answerRequest, localRoots, webviewHtml } from './webview';

/** Live preview of the particle file in the active text editor (lite mode) */
export class PreviewViewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | null = null;
	private current: vscode.TextDocument | null = null;
	private ready = false;
	private disposables: vscode.Disposable[] = [];

	constructor(
		private context: vscode.ExtensionContext,
		private pack: PackIndex,
	) {
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor((ed) => {
				if (ed && isParticleDocument(ed.document)) this.show(ed.document);
			}),
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (this.current && e.document === this.current && e.contentChanges.length) this.post({ type: 'external', text: e.document.getText(), version: e.document.version });
			}),
		);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		this.ready = false;
		view.webview.options = { enableScripts: true, localResourceRoots: localRoots(this.context.extensionUri) };
		view.webview.html = webviewHtml(view.webview, this.context.extensionUri);
		view.webview.onDidReceiveMessage((msg: ToExtension) => {
			if (msg.type === 'ready') {
				this.ready = true;
				const doc = this.current ?? vscode.window.activeTextEditor?.document;
				const text = doc && isParticleDocument(doc) ? doc.getText() : '';
				if (doc && isParticleDocument(doc)) this.current = doc;
				this.post({ type: 'init', text, version: doc?.version ?? 0, name: doc?.uri.path.split('/').pop() ?? '', uri: doc?.uri.toString() ?? '', mode: 'preview', settings: this.context.globalState.get('oxygen.ui') ?? {}, theme: vscode.workspace.getConfiguration('oxygen').get('theme', 'vscode'), about: aboutVsCode(this.context) });
			} else if (msg.type === 'request' && this.current) void answerRequest(view.webview, this.pack, this.current.uri, msg);
			else if (msg.type === 'openExample') void this.pack.examples.open(msg.name);
		});
		view.onDidChangeVisibility(() => this.post({ type: 'visibility', visible: view.visible }));
		view.onDidDispose(() => {
			this.view = null;
			this.ready = false;
		});
	}

	show(doc: vscode.TextDocument): void {
		if (this.current === doc) return;
		this.current = doc;
		this.post({ type: 'open', text: doc.getText(), version: doc.version, name: doc.uri.path.split('/').pop() ?? '', uri: doc.uri.toString() });
	}

	private post(m: ToWebview) {
		if (this.view && this.ready) void this.view.webview.postMessage(m);
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
	}
}
