import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleLineComment } from '@codemirror/commands';
import { bracketMatching, codeFolding, foldGutter, foldKeymap, foldService, indentUnit, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState, Facet, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
	Decoration,
	drawSelection,
	EditorView,
	rectangularSelection,
	hoverTooltip,
	keymap,
	showTooltip,
	ViewPlugin,
	type DecorationSet,
	type KeyBinding,
	type Tooltip,
	type ViewUpdate,
} from '@codemirror/view';
import { classify, complete, diagnose, hoverAt, prettyMolang, sharedRanges, signatureAt, variableAt, type MolangContext } from './service';

export * from './service';
export { quickFixes, applyEdits, type QuickFix, type TextEdit } from './fixes';
export { extractToVariable, findExpression, moveStatements, type ExtractResult } from './extract';
import { quickFixes } from './fixes';
export { valueLenses, setLenses, type LensData, type LensValues } from './lenses';
import { valueLenses } from './lenses';

/** The surrounding-effect context for a Molang editor. Reconfigure through `molangContextCompartment`. */
export const molangContext = Facet.define<MolangContext, MolangContext>({
	combine: (values) => values[values.length - 1] ?? {},
});

export const molangContextCompartment = new Compartment();

/** Swap the context of an existing editor (cheap; keeps the document and selection) */
export function setMolangContext(view: EditorView, ctx: MolangContext): void {
	view.dispatch({ effects: molangContextCompartment.reconfigure(molangContext.of(ctx)) });
}

// Comment toggling needs a language with commentTokens; Molang has no syntax tree of its own here.
const molangStream = StreamLanguage.define({
	name: 'molang',
	token(stream) {
		stream.next();
		return null;
	},
	languageData: { commentTokens: { line: '//' } },
});

// ---------------------------------------------------------------------------- highlighting

const markCache = new Map<string, Decoration>();
function mark(cls: string): Decoration {
	let m = markCache.get(cls);
	if (!m) {
		m = Decoration.mark({ class: cls });
		markCache.set(cls, m);
	}
	return m;
}

function buildHighlights(view: EditorView): DecorationSet {
	const src = view.state.doc.toString();
	const ranges = [];
	for (const t of classify(src)) {
		if (t.to <= t.from) continue;
		let cls = `cm-mo-${t.cls}`;
		if (t.cls === 'bracket') cls = t.depth === -1 ? 'cm-mo-bracket-bad' : `cm-mo-bracket-${(t.depth ?? 0) % 3}`;
		ranges.push(mark(cls).range(t.from, t.to));
	}
	return Decoration.set(ranges, true);
}

const highlighter = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildHighlights(view);
		}
		update(u: ViewUpdate) {
			if (u.docChanged) this.decorations = buildHighlights(u.view);
		}
	},
	{ decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------- completion

/** Completions; single-line editors get snippets on one line (fields save their text as typed) */
const completionSource = (singleLine: boolean) => (context: CompletionContext): CompletionResult | null => {
	const ctx = context.state.facet(molangContext);
	const src = context.state.doc.toString();
	const r = complete(src, context.pos, ctx, context.explicit);
	if (!r) return null;
	const options: Completion[] = r.items.map((i) =>
		i.snippet
			? snippetCompletion(singleLine ? i.snippet.replace(/\n\s*/g, ' ') : i.snippet, { label: i.label, type: 'text', detail: i.detail, info: i.info, boost: -1 })
			: { label: i.label, apply: i.apply, type: i.type, detail: i.detail, info: i.info, boost: i.boost },
	);
	return { from: r.from, to: r.to, options, validFor: /^[A-Za-z0-9_]*$/ };
};

// ---------------------------------------------------------------------------- hover

const hover = hoverTooltip((view, pos) => {
	const info = hoverAt(view.state.doc.toString(), pos, view.state.facet(molangContext));
	if (!info) return null;
	return {
		pos: info.from,
		end: info.to,
		above: true,
		create() {
			const dom = document.createElement('div');
			dom.className = 'cm-mo-hover';
			const title = document.createElement('div');
			title.className = 'cm-mo-hover-title';
			title.textContent = info.signature ?? info.title;
			dom.append(title);
			if (info.value !== null && info.value !== undefined) {
				const v = document.createElement('div');
				v.className = 'cm-mo-hover-value';
				v.textContent = `= ${typeof info.value === 'number' ? formatNumber(info.value) : `'${info.value}'`}`;
				dom.append(v);
			}
			const body = document.createElement('div');
			body.className = 'cm-mo-hover-body';
			body.textContent = info.body;
			dom.append(body);
			return { dom };
		},
	};
});

export function formatNumber(n: number): string {
	if (Number.isNaN(n)) return 'NaN';
	if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
	const r = Math.round(n * 1e4) / 1e4;
	return String(r);
}

// ---------------------------------------------------------------------------- signature help

function signatureTooltip(state: EditorState): Tooltip | null {
	const sel = state.selection.main;
	if (!sel.empty) return null;
	const sig = signatureAt(state.doc.toString(), sel.head);
	if (!sig) return null;
	return {
		pos: sig.open,
		above: true,
		strictSide: false,
		arrow: false,
		create() {
			const dom = document.createElement('div');
			dom.className = 'cm-mo-signature';
			const name = document.createElement('span');
			name.textContent = `${sig.name}(`;
			dom.append(name);
			sig.params.forEach((p, i) => {
				if (i) dom.append(', ');
				const s = document.createElement('span');
				s.textContent = p;
				if (i === sig.active) s.className = 'cm-mo-signature-active';
				dom.append(s);
			});
			dom.append(')');
			return { dom };
		},
	};
}

const signatureField = StateField.define<Tooltip | null>({
	create: signatureTooltip,
	update(value, tr) {
		if (!tr.docChanged && !tr.selection) return value;
		return signatureTooltip(tr.state);
	},
	provide: (f) => showTooltip.from(f),
});

// ---------------------------------------------------------------------------- diagnostics

const molangLinter = linter(
	(view) => {
		const src = view.state.doc.toString();
		const ctx = view.state.facet(molangContext);
		const len = src.length;
		return diagnose(src, ctx).map(
			(d): Diagnostic => ({
				from: Math.min(d.from, len),
				to: Math.min(Math.max(d.to, d.from), len),
				severity: d.severity,
				message: d.message,
				source: d.code,
				actions: quickFixes(src, d, ctx).map((fix) => ({
					name: fix.title,
					apply: (v: EditorView) => {
						// only if the text is still what the fix was computed for
						if (v.state.doc.toString() === src) v.dispatch({ changes: fix.edits, userEvent: 'input.fix' });
					},
				})),
			}),
		);
	},
	{ delay: 150 },
);

// ---------------------------------------------------------------------------- commands

function variableCommand(pick: (ctx: MolangContext) => ((v: string) => void) | undefined) {
	return (view: EditorView): boolean => {
		const ctx = view.state.facet(molangContext);
		const name = variableAt(view.state.doc.toString(), view.state.selection.main.head);
		const run = pick(ctx);
		if (!name || !run) return false;
		run(name);
		return true;
	};
}
const gotoDefinition = variableCommand((c) => c.onDefinition);
const findReferences = variableCommand((c) => c.onReferences);

/** Ctrl+click (Cmd on macOS) on a variable goes to where it's set, like VS Code */
const definitionClick = EditorView.domEventHandlers({
	mousedown(e, view) {
		if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
		const ctx = view.state.facet(molangContext);
		if (!ctx.onDefinition) return false;
		const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
		const name = pos === null ? null : variableAt(view.state.doc.toString(), pos);
		if (!name) return false;
		e.preventDefault();
		ctx.onDefinition(name);
		return true;
	},
});

function renameAtCursor(view: EditorView): boolean {
	const ctx = view.state.facet(molangContext);
	const name = variableAt(view.state.doc.toString(), view.state.selection.main.head);
	if (!name || !ctx.onRename) return false;
	ctx.onRename(name);
	return true;
}

// ---------------------------------------------------------------------------- shared text across stacked axes

export const setSiblings = StateEffect.define<string[] | null>();
const sharedMark = Decoration.mark({ class: 'cm-mo-shared' });
const sharedField = StateField.define<{ siblings: string[] | null; index: number; deco: DecorationSet }>({
	create: () => ({ siblings: null, index: 0, deco: Decoration.none }),
	update(value, tr) {
		let siblings = value.siblings;
		for (const e of tr.effects) if (e.is(setSiblings)) siblings = e.value;
		if (siblings === value.siblings && !tr.docChanged) return value;
		if (!siblings) return { siblings, index: 0, deco: Decoration.none };
		const texts = [tr.state.doc.toString(), ...siblings];
		// identical axes: dimming everything would only make it look disabled
		if (siblings.every((t) => t === texts[0])) return { siblings, index: 0, deco: Decoration.none };
		const ranges = sharedRanges(texts, 0).filter((r) => r.to > r.from).map((r) => sharedMark.range(r.from, r.to));
		return { siblings, index: 0, deco: Decoration.set(ranges, true) };
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function formatDocument(view: EditorView): boolean {
	const src = view.state.doc.toString();
	const pretty = prettyMolang(src, 64, view.state.facet(molangContext).features);
	if (pretty === src) return false;
	view.dispatch({ changes: { from: 0, to: src.length, insert: pretty } });
	return true;
}

// ---------------------------------------------------------------------------- folding

/** Where the bracket opened at `open` closes (skipping strings and `//` comments), or -1 */
function matchingClose(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const c = text[i];
		if (c === "'") {
			const end = text.indexOf("'", i + 1);
			if (end < 0) return -1;
			i = end;
		} else if (c === '/' && text[i + 1] === '/') {
			const nl = text.indexOf('\n', i);
			if (nl < 0) return -1;
			i = nl;
		} else if (c === '(' || c === '{' || c === '[') depth++;
		else if (c === ')' || c === '}' || c === ']') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** Fold the innermost bracket a line opens and doesn't close (pretty-printed calls, loop bodies) */
const bracketFolding = foldService.of((state, lineStart, lineEnd) => {
	const line = state.doc.sliceString(lineStart, lineEnd);
	const stack: number[] = [];
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === "'") {
			const end = line.indexOf("'", i + 1);
			if (end < 0) break;
			i = end;
		} else if (c === '/' && line[i + 1] === '/') break;
		else if (c === '(' || c === '{' || c === '[') stack.push(i);
		else if ((c === ')' || c === '}' || c === ']') && stack.length) stack.pop();
	}
	if (!stack.length) return null;
	const text = state.doc.toString();
	const open = lineStart + stack[stack.length - 1];
	const close = matchingClose(text, open);
	if (close < 0 || close <= lineEnd) return null;
	return { from: open + 1, to: close };
});

// ---------------------------------------------------------------------------- bundle

export interface MolangEditorOptions {
	context?: MolangContext;
	/** Single-line field editor: Enter commits instead of inserting a newline */
	singleLine?: boolean;
	onCommit?: (view: EditorView) => void;
	lint?: boolean;
	/** Use CodeMirror's own undo history (off when the host owns undo) */
	ownHistory?: boolean;
}

/** Molang editor commands whose keys the app can rebind (Settings › Keyboard) */
export type MolangKeyCommand = 'rename' | 'definition' | 'references' | 'comment' | 'format';

const KEY_COMMANDS: Record<MolangKeyCommand, (view: EditorView) => boolean> = {
	rename: renameAtCursor,
	definition: gotoDefinition,
	references: findReferences,
	comment: toggleLineComment,
	format: formatDocument,
};

/** the app's bindings: which key events run each command (null: the defaults below) */
let boundKeys: Partial<Record<MolangKeyCommand, (e: KeyboardEvent) => boolean>> | null = null;

/** Rebind the Molang editor commands, in every editor at once: each gets a test for its key events */
export function setMolangKeys(keys: Partial<Record<MolangKeyCommand, (e: KeyboardEvent) => boolean>> | null): void {
	boundKeys = keys;
}

const reboundKeys = Prec.highest(
	EditorView.domEventHandlers({
		keydown(e, view) {
			if (!boundKeys) return false;
			for (const [id, test] of Object.entries(boundKeys) as [MolangKeyCommand, (e: KeyboardEvent) => boolean][]) {
				if (test(e) && KEY_COMMANDS[id](view)) {
					e.preventDefault();
					return true;
				}
			}
			return false;
		},
	}),
);

/** a default key, until the app rebinds the commands */
const byDefault = (id: MolangKeyCommand) => (view: EditorView) => !boundKeys && KEY_COMMANDS[id](view);

export function molang(options: MolangEditorOptions = {}): Extension {
	const keys: KeyBinding[] = [
		// Tab accepts the highlighted suggestion like Enter (VS Code does both); without a list open it falls through
		{ key: 'Tab', run: acceptCompletion },
		{ key: 'Shift-Alt-f', run: byDefault('format') },
		{ key: 'F2', run: byDefault('rename') },
		{ key: 'F12', run: byDefault('definition') },
		{ key: 'Shift-F12', run: byDefault('references') },
		{ key: 'Mod-/', run: byDefault('comment') },
		...closeBracketsKeymap,
		...completionKeymap,
	];
	if (options.singleLine) {
		keys.unshift({
			key: 'Enter',
			run: (view: EditorView) => {
				options.onCommit?.(view);
				return true;
			},
		});
	} else keys.push(indentWithTab);
	// several cursors (Ctrl+D adds the next occurrence, Alt+drag a column), find/replace and folding
	// mouse like VS Code: Alt+click adds a cursor, Shift+Alt+drag selects a column, Ctrl+click goes to the definition
	const power: Extension[] = [
		EditorState.allowMultipleSelections.of(true),
		EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
		drawSelection(),
		rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
		definitionClick,
		highlightSelectionMatches(),
		keymap.of(searchKeymap.filter((k) => options.singleLine ? k.key === 'Mod-d' : true)),
	];
	if (!options.singleLine) power.push(search({ top: true }), codeFolding(), foldGutter({ openText: '▾', closedText: '▸' }), bracketFolding, keymap.of(foldKeymap));
	return [
		new LanguageSupport(molangStream),
		power,
		molangContextCompartment.of(molangContext.of(options.context ?? {})),
		indentUnit.of('  '),
		highlighter,
		valueLenses(),
		sharedField,
		bracketMatching(),
		closeBrackets(),
		autocompletion({ override: [completionSource(!!options.singleLine)], icons: false, activateOnTyping: true }),
		hover,
		signatureField,
		options.lint === false ? [] : [molangLinter, options.singleLine ? [] : lintGutter()],
		options.ownHistory === false ? [] : [history(), keymap.of(historyKeymap)],
		reboundKeys,
		// CodeMirror's own Mod-/ comments too: ours (above) does, as long as it's bound there
		keymap.of([...keys, ...defaultKeymap.filter((k) => k.key !== 'Mod-/')]),
		options.singleLine ? EditorView.contentAttributes.of({ 'aria-multiline': 'false' }) : EditorView.lineWrapping,
	];
}

/**
 * Editor theme driven by CSS custom properties so it follows the app theme (and VS Code's, in the webview).
 * Set the `--ox-*` variables (packages/ui/src/styles/tokens.css) on a parent element.
 */
export const molangTheme = EditorView.theme(
	{
		'&': { color: 'var(--ox-code-fg)', backgroundColor: 'transparent', fontSize: 'var(--ox-code-size, 13px)' },
		'.cm-content': { fontFamily: 'var(--ox-font-code)', caretColor: 'var(--ox-lox)', padding: '3px 0' },
		'.cm-line': { padding: '0 6px' },
		'&.cm-focused': { outline: 'none' },
		'&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ox-lox)', borderLeftWidth: '2px' },
		'.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--ox-selection) !important' },
		'.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--ox-haze)' },
		'.cm-foldGutter .cm-gutterElement': { color: 'var(--ox-text-dim)', cursor: 'pointer', padding: '0 2px' },
		'.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--ox-frost)' },
		'.cm-foldPlaceholder': { backgroundColor: 'var(--ox-raised)', border: 'none', color: 'var(--ox-haze)', padding: '0 4px', margin: '0 2px' },
		'.cm-selectionMatch': { backgroundColor: 'rgba(147, 189, 245, 0.12)' },
		'.cm-searchMatch': { backgroundColor: 'rgba(242, 193, 78, 0.22)', outline: '1px solid rgba(242, 193, 78, 0.45)' },
		'.cm-searchMatch-selected': { backgroundColor: 'rgba(242, 193, 78, 0.45)' },
		'.cm-panels': { backgroundColor: 'var(--ox-raised)', color: 'var(--ox-frost)', borderBottom: '1px solid var(--ox-rule)' },
		'.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--ox-rule)' },
		'.cm-search': { fontFamily: 'var(--ox-font-ui)', fontSize: '12px', padding: '4px 6px' },
		'.cm-search input, .cm-search button': { font: 'inherit', fontSize: '12px' },
		'.cm-search .cm-textfield': { backgroundColor: 'var(--ox-input)', border: '1px solid var(--ox-rule-strong)', borderRadius: '3px', color: 'var(--ox-frost)' },
		'.cm-search .cm-button': { backgroundImage: 'none', backgroundColor: 'transparent', border: '1px solid var(--ox-rule-strong)', borderRadius: '3px', color: 'var(--ox-frost)' },
		'.cm-search label': { color: 'var(--ox-haze)' },
		'.cm-matchingBracket': { backgroundColor: 'var(--ox-bracket-match)', outline: 'none' },
		'.cm-nonmatchingBracket': { color: 'var(--ox-error)' },
		'.cm-tooltip': {
			backgroundColor: 'var(--ox-float)',
			color: 'var(--ox-frost)',
			border: '1px solid var(--ox-rule-strong)',
			borderRadius: '6px',
			fontFamily: 'var(--ox-font-ui)',
			fontSize: '12.5px',
			boxShadow: 'var(--ox-float-shadow)',
		},
		'.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--ox-font-code)', maxHeight: '18em' },
		'.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px', lineHeight: '20px' },
		'.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--ox-selection)', color: 'var(--ox-frost)' },
		'.cm-completionDetail': { color: 'var(--ox-haze)', fontStyle: 'normal', fontFamily: 'var(--ox-font-ui)', marginLeft: '1em' },
		'.cm-completionInfo': { padding: '6px 10px', maxWidth: '28em', lineHeight: '18px', whiteSpace: 'pre-line' },
		'.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--ox-lox)' },
		'.cm-mo-hover': { padding: '6px 10px', maxWidth: '30em', lineHeight: '18px' },
		'.cm-mo-hover-title': { fontFamily: 'var(--ox-font-code)', color: 'var(--ox-frost)' },
		'.cm-mo-hover-value': { fontFamily: 'var(--ox-font-code)', color: 'var(--ox-lox)' },
		'.cm-mo-hover-body': { color: 'var(--ox-haze)', marginTop: '4px', whiteSpace: 'pre-line' },
		'.cm-mo-signature': { padding: '3px 8px', fontFamily: 'var(--ox-font-code)', color: 'var(--ox-haze)' },
		'.cm-mo-signature-active': { color: 'var(--ox-frost)', fontWeight: '600' },
		'.cm-diagnostic': { fontFamily: 'var(--ox-font-ui)', padding: '4px 8px', borderLeftWidth: '2px' },
		'.cm-diagnostic-error': { borderLeftColor: 'var(--ox-error)' },
		'.cm-diagnostic-warning': { borderLeftColor: 'var(--ox-warning)' },
		'.cm-diagnostic-info': { borderLeftColor: 'var(--ox-haze)' },
		'.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--ox-error) 1px', textUnderlineOffset: '3px' },
		'.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--ox-warning) 1px', textUnderlineOffset: '3px' },
		'.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted var(--ox-haze) 1px', textUnderlineOffset: '3px' },
		'.cm-mo-variable': { color: 'var(--ox-syn-variable)' },
		'.cm-mo-builtin': { color: 'var(--ox-syn-variable)', fontStyle: 'italic' },
		'.cm-mo-temp': { color: 'var(--ox-syn-temp)' },
		'.cm-mo-context': { color: 'var(--ox-syn-context)' },
		'.cm-mo-query': { color: 'var(--ox-syn-query)' },
		'.cm-mo-math': { color: 'var(--ox-syn-math)' },
		'.cm-mo-unknown': { color: 'var(--ox-frost)', textDecoration: 'underline dotted var(--ox-haze)' },
		'.cm-mo-number': { color: 'var(--ox-syn-number)' },
		'.cm-mo-string': { color: 'var(--ox-syn-string)' },
		'.cm-mo-keyword': { color: 'var(--ox-syn-keyword)', fontWeight: '600' },
		'.cm-mo-operator': { color: 'var(--ox-haze)' },
		'.cm-mo-punct': { color: 'var(--ox-haze)' },
		'.cm-mo-comment': { color: 'var(--ox-syn-comment)', fontStyle: 'italic' },
		'.cm-mo-error': { color: 'var(--ox-error)' },
		'.cm-mo-bracket-0': { color: 'var(--ox-syn-bracket-0)' },
		'.cm-mo-bracket-1': { color: 'var(--ox-syn-bracket-1)' },
		'.cm-mo-bracket-2': { color: 'var(--ox-syn-bracket-2)' },
		'.cm-mo-bracket-bad': { color: 'var(--ox-error)', textDecoration: 'underline wavy var(--ox-error) 1px' },
		// what the other axes share reads dimmed, so the differences stand out; while editing everything is full strength
		'&:not(.cm-focused) .cm-mo-shared, &:not(.cm-focused) .cm-mo-shared span': { opacity: '0.45' },
	},
	{ dark: true },
);
