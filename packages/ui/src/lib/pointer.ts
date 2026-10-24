/**
 * Whether a mouse button is held anywhere in the window. Things that change the layout or a text field's
 * contents (graphs appearing under a field, value lenses) wait for the release: moving text under a held
 * button makes the editor select from the click to wherever the text went.
 */

let held = 0;
let waiting: (() => void)[] = [];
let listening = false;

function listen(): void {
	if (listening || typeof window === 'undefined') return;
	listening = true;
	window.addEventListener('pointerdown', (e) => (held = e.buttons), true);
	const release = (e: PointerEvent) => {
		held = e.type === 'pointerup' ? e.buttons : 0;
		if (held) return;
		const run = waiting;
		waiting = [];
		// after the click has landed (CodeMirror places the cursor on mouseup)
		setTimeout(() => run.forEach((f) => f()), 0);
	};
	window.addEventListener('pointerup', release, true);
	window.addEventListener('pointercancel', release, true);
	window.addEventListener('blur', () => release(new PointerEvent('pointercancel')));
}

listen();

export function pointerHeld(): boolean {
	listen();
	return held !== 0;
}

/** Run `f` now, or once no button is held. Returns a function that cancels a wait. */
export function afterRelease(f: () => void): () => void {
	listen();
	if (!held) {
		f();
		return () => {};
	}
	waiting.push(f);
	return () => {
		waiting = waiting.filter((x) => x !== f);
	};
}
