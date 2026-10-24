import * as vscode from 'vscode';
import type { PackIndex } from './pack';
import type { ToExtension, ToWebview } from './protocol';

/**
 * HTML shell for the Oxygen webview bundle (dist/webview). `init` is the first message, embedded so the
 * webview starts on the document without asking for it; the skeleton paints in the editor's colors at once,
 * so opening a file never flashes an empty panel.
 */
/** What About › System says about VS Code and the extension */
export function aboutVsCode(context: vscode.ExtensionContext): { label: string; value: string }[] {
	return [
		{ label: 'VS Code', value: `${vscode.version} (${vscode.env.appName}, ${vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop'})` },
		{ label: 'Extension', value: `${context.extension.id} ${(context.extension.packageJSON as { version?: string }).version ?? ''}` },
	];
}

export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, init?: ToWebview): string {
	const dist = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'index.js'));
	const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'index.css'));
	const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
	// 'unsafe-eval': the Molang compiler turns expressions into functions (new Function), nothing else does
	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} data: blob:`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`font-src ${webview.cspSource} data:`,
		`script-src 'nonce-${nonce}' 'unsafe-eval'`,
		`connect-src ${webview.cspSource} data: blob:`,
		// heavy scenes run part of the simulation in workers built from an inlined script
		`worker-src blob:`,
	].join('; ');
	// JSON inside a script element: `<` escaped so the text can't close it
	const embedded = init ? `<script nonce="${nonce}" id="ox-init" type="application/json">${JSON.stringify(init).replace(/</g, '\\u003c')}</script>` : '';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${style}" />
<style>
html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); overflow: hidden; }
#ox-boot { position: fixed; inset: 0; display: grid; grid-template-rows: 32px 1fr; z-index: 1000; background: var(--vscode-editor-background); pointer-events: none; }
#ox-boot > .bar { border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25)); }
#ox-boot > .body { display: grid; grid-template-columns: 210px 1fr 420px; }
#ox-boot > .body > div { border-right: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25)); }
#ox-boot > .body > div:last-child { border: none; background: var(--vscode-sideBar-background, transparent); }
</style>
</head>
<body class="ox-follow-vscode">
${init?.type === 'init' && init.mode === 'full' ? '<div id="ox-boot" aria-hidden="true"><div class="bar"></div><div class="body"><div></div><div></div><div></div></div></div>' : ''}
<div id="app"></div>
${embedded}
<script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
}

/** Answer texture/effect requests from a webview showing `file` */
export async function answerRequest(webview: vscode.Webview, pack: PackIndex, file: vscode.Uri, msg: Extract<ToExtension, { type: 'request' }>): Promise<void> {
	let value: unknown = null;
	try {
		if (msg.kind === 'texture') {
			const uri = await pack.texture(file, msg.arg);
			value = uri ? webview.asWebviewUri(uri).toString() : null;
		} else if (msg.kind === 'text') {
			const root = await pack.root(file);
			if (root) {
				try {
					value = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, msg.arg)));
				} catch {
					value = null;
				}
			}
		} else if (msg.kind === 'effect') {
			// from the pack, else (an example's children, or a file outside any pack) from the examples
			const uri = await pack.effect(file, msg.arg);
			if (uri) value = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
			else value = (await pack.examples.byIdentifier(msg.arg))?.text ?? null;
		} else if (msg.kind === 'parents') {
			value = (await pack.root(file)) ? await pack.parentInputs(file, msg.arg) : await pack.examples.parentInputs(msg.arg);
		} else if (msg.kind === 'openEffect') {
			// each file gets its own Oxygen editor in VS Code
			const uri = await pack.effect(file, msg.arg);
			if (uri) {
				await vscode.commands.executeCommand('vscode.openWith', uri, 'oxygen.particleEditor');
				value = true;
			} else {
				const example = await pack.examples.byIdentifier(msg.arg);
				value = example ? await pack.examples.open(example.name) : null;
			}
		} else if (msg.kind === 'examples') {
			value = (await pack.examples.all()).map((e) => e.name);
		} else if (msg.kind === 'example') {
			value = (await pack.examples.byName(msg.arg))?.text ?? null;
		}
	} catch {
		value = null;
	}
	void webview.postMessage({ type: 'reply', id: msg.id, value } satisfies ToWebview);
}

/** Write a pack file (texture set JSON or a PNG) for a webview showing `file` */
export async function writePackFile(webview: vscode.Webview, pack: PackIndex, file: vscode.Uri, id: number, path: string, bytes: Uint8Array): Promise<void> {
	let ok = false;
	try {
		const root = await pack.root(file);
		if (root) {
			await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, path), bytes);
			ok = true;
		}
	} catch {
		ok = false;
	}
	void webview.postMessage({ type: 'reply', id, value: ok } satisfies ToWebview);
}

/** Ask where to keep a screenshot or GIF (next to the effect to start with) and write it there */
export async function saveCapture(webview: vscode.Webview, file: vscode.Uri, id: number, name: string, bytes: Uint8Array): Promise<void> {
	let path: string | null = null;
	try {
		const ext = name.split('.').pop() ?? 'png';
		const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(file, '..', name), filters: { [ext === 'gif' ? 'GIF' : ext === 'mp4' ? 'MP4 video' : ext === 'webm' ? 'WebM video' : 'PNG']: [ext] } });
		if (target) {
			await vscode.workspace.fs.writeFile(target, bytes);
			path = target.fsPath;
		}
	} catch {
		path = null;
	}
	void webview.postMessage({ type: 'reply', id, value: path } satisfies ToWebview);
}

export function localRoots(extensionUri: vscode.Uri): vscode.Uri[] {
	return [vscode.Uri.joinPath(extensionUri, 'dist'), ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)];
}
