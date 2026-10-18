/** Messages between the extension host and the Oxygen webview */

export interface TextEdit {
	offset: number;
	length: number;
	content: string;
}

export type ToWebview =
	| { type: 'init'; text: string; version: number; name: string; uri: string; mode: 'full' | 'preview'; settings: Record<string, unknown>; theme: 'vscode' | 'oxygen'; about?: { label: string; value: string }[] }
	/** Another Oxygen editor changed the settings (preferences, keys) */
	| { type: 'settings'; settings: Record<string, unknown> }
	/** The document changed outside Oxygen (typing in a text editor, undo, git): replace the text */
	| { type: 'external'; text: string; version: number }
	/** Switch the preview to another file (preview view follows the active editor) */
	| { type: 'open'; text: string; version: number; name: string; uri: string }
	| { type: 'reply'; id: number; value: unknown }
	/** Apply a layout preset (editor, code with floating preview, debugging) */
	| { type: 'layout'; name: 'editor' | 'code' | 'debug' }
	/** The panel or view was hidden or shown: hidden ones stop simulating */
	| { type: 'visibility'; visible: boolean };

export type ToExtension =
	/** the webview is listening; `embedded`: the document version it was given in its HTML (no init needed) */
	| { type: 'ready'; embedded?: number }
	/** Oxygen edited the document; edits apply in order, each relative to the text after the previous one */
	| { type: 'edit'; edits: TextEdit[]; label: string }
	| { type: 'undo' }
	| { type: 'redo' }
	| { type: 'save' }
	| { type: 'settings'; settings: Record<string, unknown> }
	| { type: 'request'; id: number; kind: 'texture' | 'effect' | 'text' | 'openEffect' | 'parents' | 'examples' | 'example'; arg: string }
	/** open a bundled example in an editor of its own */
	| { type: 'openExample'; name: string }
	| { type: 'writeText'; id: number; path: string; text: string }
	| { type: 'writeTexture'; id: number; path: string; pngBase64: string };
