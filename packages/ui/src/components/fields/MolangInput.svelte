<script lang="ts">
	import { Annotation, EditorState } from '@codemirror/state';
	import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view';
	import { compactMolang, molang, molangTheme, setLenses, setMolangContext, setSiblings, withComments, type MolangContext } from '@oxygen/lang';
	import { fieldComments, writeFieldComments } from '@oxygen/format';
	import { onDestroy, onMount } from 'svelte';
	import type { EffectSession } from '../../state/session.svelte';
	import { molangText } from '../../lib/molang-text';
	import { registerFlush } from '../../lib/flush';
	import { afterRelease } from '../../lib/pointer';

	interface Props {
		session: EffectSession;
		/** JSON path of the value */
		path: string;
		context?: MolangContext;
		multiline?: boolean;
		placeholder?: string;
		/** label for assistive tech */
		label: string;
		/** called when the input gains focus (selects the field) */
		onfocus?: () => void;
		/** create the parent value (e.g. the whole vector) before the first write to a missing path */
		beforeWrite?: () => void;
		/** Editor-only pretty formatting: multi-line with // comments; written back single-line (comments go to the oxygen block) */
		pretty?: boolean;
		/** texts of the other axes of the same vector; what they all share is dimmed */
		siblings?: () => string[];
		/** the selected text, whenever the selection changes (empty when nothing is selected) */
		onselection?: (text: string) => void;
	}

	let { session, path, context = {}, multiline = false, placeholder = '', label, onfocus, beforeWrite, pretty = false, siblings, onselection }: Props = $props();

	const External = Annotation.define<boolean>();
	let host: HTMLDivElement;
	let view: EditorView | null = null;
	/** file text we last wrote (or read), to tell our own echoes from outside changes */
	let synced = '';
	let timer: ReturnType<typeof setTimeout> | null = null;

	/** Molang as stored in the file */
	function rawText(): string {
		return molangText(session.doc.get(path));
	}

	/** What the editor shows for the stored text */
	function display(raw: string): string {
		return pretty && raw ? withComments(raw, fieldComments(session.meta, path)) : raw;
	}

	/** What the file stores for the editor text */
	function toRaw(text: string): { text: string; comments: { before: number; text: string }[] | null } {
		if (!pretty) return { text, comments: null };
		return compactMolang(text);
	}

	function commit() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (!view) return;
		const out = toRaw(view.state.doc.toString());
		const commentsChanged = out.comments !== null && JSON.stringify(fieldComments(session.meta, path)) !== JSON.stringify(out.comments);
		if (out.text === synced && !commentsChanged) return;
		synced = out.text;
		if (out.text.trim() === '') {
			session.doc.remove(path, 'Clear field');
			return;
		}
		session.doc.transact('Edit expression', () => {
			if (!session.doc.has(path)) beforeWrite?.();
			if (rawText() !== out.text) session.doc.setMolang(path, out.text, 'Edit expression');
			if (commentsChanged) writeFieldComments(session.doc, path, out.comments!);
		});
	}

	function schedule() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(commit, 220);
	}

	let unregister: (() => void) | null = null;

	onMount(() => {
		unregister = registerFlush(() => {
			if (timer) commit();
		});
		synced = rawText();
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: display(synced),
				extensions: [
					molang({ context, singleLine: !multiline, onCommit: () => commit(), ownHistory: false }),
					molangTheme,
					cmPlaceholder(placeholder),
					EditorView.contentAttributes.of({ 'aria-label': label }),
					EditorView.updateListener.of((u) => {
						if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) schedule();
						if (u.focusChanged && u.view.hasFocus) onfocus?.();
						if (onselection && (u.selectionSet || u.docChanged)) {
							const m = u.state.selection.main;
							onselection(u.state.sliceDoc(m.from, m.to));
						}
						if (u.focusChanged && !u.view.hasFocus) commit();
					}),
				],
			}),
		});
	});

	// outside changes (undo/redo, other editors, VS Code) flow into the editor
	$effect(() => {
		void session.version;
		const raw = rawText();
		if (!view || raw === synced) return;
		if (timer) return; // a local edit is pending; it will win
		synced = raw;
		const text = display(raw);
		const cur = view.state.doc.toString();
		if (cur === text) return;
		const head = Math.min(view.state.selection.main.head, text.length);
		view.dispatch({ changes: { from: 0, to: cur.length, insert: text }, selection: { anchor: head }, annotations: External.of(true) });
	});

	$effect(() => {
		const ctx = context;
		if (view) setMolangContext(view, ctx);
	});

	$effect(() => {
		void session.version;
		if (view && siblings) view.dispatch({ effects: setSiblings.of(siblings()) });
	});

	// value lenses: what the inspected particle's last evaluation of this field produced
	$effect(() => {
		void session.debugVersion;
		const sel = session.selection;
		if (!view) return;
		const rec = sel ? session.traceFor(path) : undefined;
		const ref = session.analysis?.byPath.get(path);
		const lenses = rec && !timer ? { values: rec.values, result: rec.result, features: ref?.field.expr.program.features } : null;
		// lenses change the text's width: not while a click in it is still held
		return afterRelease(() => view?.dispatch({ effects: setLenses.of(lenses) }));
	});

	onDestroy(() => {
		unregister?.();
		if (timer) commit();
		view?.destroy();
	});
</script>

<div class="molang" class:multiline bind:this={host}></div>

<style>
	.molang {
		min-width: 0;
		flex: 1;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		min-height: 22px;
		cursor: text;
	}
	.molang:hover {
		background: var(--ox-input-hover);
	}
	.molang:focus-within {
		border-color: var(--ox-lox);
		background: var(--ox-input);
	}
	.molang :global(.cm-editor) {
		max-height: 100%;
	}
	.molang:not(.multiline) :global(.cm-content) {
		padding: 1px 0;
		white-space: pre;
	}
	.molang:not(.multiline) :global(.cm-scroller) {
		overflow-x: auto;
		scrollbar-width: none;
	}
	.molang.multiline {
		min-height: 44px;
	}
	.molang :global(.cm-placeholder) {
		color: var(--ox-text-dim);
		font-style: normal;
	}
</style>
