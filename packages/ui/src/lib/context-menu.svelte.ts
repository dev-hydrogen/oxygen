/** Right-click menus: one at a time, drawn by the shell's ContextMenu wherever it was asked for */
import { EditorView } from '@codemirror/view';
import { tidyMenu, type MenuAction, type MenuItem } from './menu-items';

export { tidyMenu, type MenuAction, type MenuItem };

class MenuState {
	open = $state.raw<{ x: number; y: number; items: MenuItem[] } | null>(null);
}

export const contextMenu = new MenuState();

/** Text the browser's own menu serves better (copy, paste, spelling) */
export function isTextTarget(target: EventTarget | null): boolean {
	return target instanceof Element && !!target.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, .cm-editor, [contenteditable="true"]');
}

/** Open a menu at the pointer. An empty list leaves the event to whatever is around it. */
export function openContextMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]): boolean {
	const list = tidyMenu(items);
	if (!list.length) return false;
	e.preventDefault?.();
	e.stopPropagation?.();
	contextMenu.open = { x: e.clientX, y: e.clientY, items: list };
	return true;
}

export function closeContextMenu(): void {
	contextMenu.open = null;
}

/**
 * Cut, copy, paste and select all for the text field (or Molang editor) at `target`, done on that field. The
 * desktop app has no menu of its own for them, so text fields need these in Oxygen's.
 */
export function textItems(target: EventTarget | null): MenuItem[] {
	if (!(target instanceof Element)) return [];
	const clip = navigator.clipboard;
	const cmEl = target.closest('.cm-editor');
	const view = cmEl instanceof HTMLElement ? EditorView.findFromDOM(cmEl) : null;
	if (view) {
		const { from, to } = view.state.selection.main;
		const picked = view.state.sliceDoc(from, to);
		const put = (text: string) => {
			view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
			view.focus();
		};
		return [
			{ label: 'Cut', keys: 'Ctrl+X', disabled: from === to || view.state.readOnly, run: () => void clip?.writeText(picked).then(() => put('')) },
			{ label: 'Copy', keys: 'Ctrl+C', disabled: from === to, run: () => void clip?.writeText(picked) },
			{ label: 'Paste', keys: 'Ctrl+V', disabled: !clip?.readText || view.state.readOnly, run: () => void clip.readText().then(put) },
			{ label: 'Select all', keys: 'Ctrl+A', run: () => { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus(); } },
		];
	}
	const field = target.closest('input, textarea');
	if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || !isTextTarget(field)) return [];
	const start = field.selectionStart ?? 0;
	const end = field.selectionEnd ?? start;
	const picked = field.value.slice(start, end);
	const locked = field.readOnly || field.disabled;
	const put = (text: string) => {
		field.focus();
		field.setRangeText(text, start, end, 'end');
		// as if typed: the field's own handlers see it
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('change', { bubbles: true }));
	};
	return [
		{ label: 'Cut', keys: 'Ctrl+X', disabled: start === end || locked, run: () => void clip?.writeText(picked).then(() => put('')) },
		{ label: 'Copy', keys: 'Ctrl+C', disabled: start === end, run: () => void clip?.writeText(picked) },
		{ label: 'Paste', keys: 'Ctrl+V', disabled: !clip?.readText || locked, run: () => void clip.readText().then(put) },
		{ label: 'Select all', keys: 'Ctrl+A', run: () => { field.focus(); field.select(); } },
	];
}

/**
 * `use:menu={() => items}`: right-click (or the menu key) opens these items. In a text field (a Molang editor,
 * a number box) the menu starts with cutting, copying and pasting its text.
 */
export function menu(node: HTMLElement, items: () => MenuItem[]) {
	let get = items;
	const handler = (e: MouseEvent) => {
		if (e.defaultPrevented) return;
		const text = isTextTarget(e.target) ? textItems(e.target) : [];
		openContextMenu(e, text.length ? [...text, { separator: true }, ...get()] : get());
	};
	node.addEventListener('contextmenu', handler);
	return {
		update(next: () => MenuItem[]) {
			get = next;
		},
		destroy() {
			node.removeEventListener('contextmenu', handler);
		},
	};
}
