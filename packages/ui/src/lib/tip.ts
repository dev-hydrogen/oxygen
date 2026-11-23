/**
 * Explanations on demand, so panels don't carry them as text: `use:tip` shows one when the pointer rests on
 * something (or it takes keyboard focus), and the Hint component's "?" pins one open. One popover for the
 * whole app, drawn in the top layer so a panel's scrolling or clipping never cuts it.
 */

export interface TipContent {
	/** what it is or does; blank lines separate paragraphs, `backticks` mark code */
	text: string;
	/** the file and key that hold it, for state the game reads (`animation › particle_effects › bind_to_actor`) */
	where?: string;
	/** a section of the Documentation with the mechanics (`guide#effects-on-an-entity`); offered when pinned */
	doc?: string;
}

export type Tip = string | TipContent | null | undefined | false;

const HOVER_MS = 380;
const GAP = 6;

let box: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let pinned = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let openDocs: ((section: string) => void) | null = null;
const pinListeners = new Set<() => void>();

/** The shell says how a tip's Documentation link opens */
export function setDocsOpener(open: ((section: string) => void) | null): void {
	openDocs = open;
}

const content = (t: Tip): TipContent | null => (!t ? null : typeof t === 'string' ? (t.trim() ? { text: t } : null) : t.text.trim() ? t : null);

/** text with `code` spans, as nodes (never HTML strings) */
function inline(text: string): Node[] {
	return text.split(/(`[^`]+`)/).map((part) => {
		if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
			const code = document.createElement('code');
			code.className = 'ox-code';
			code.textContent = part.slice(1, -1);
			return code;
		}
		return document.createTextNode(part);
	});
}

function ensure(anchor: HTMLElement): HTMLDivElement {
	if (!box) {
		box = document.createElement('div');
		box.className = 'ox-tip';
		box.addEventListener('pointerdown', (e) => e.stopPropagation());
	}
	// inside the app's root, where the theme's colours are set
	const root = anchor.closest('.ox-root') ?? document.body;
	if (box.parentElement !== root) root.append(box);
	return box;
}

function place(el: HTMLDivElement, anchor: HTMLElement): void {
	const a = anchor.getBoundingClientRect();
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const below = a.bottom + GAP + h <= vh - 4 || a.top - GAP - h < 4;
	el.style.left = `${Math.round(Math.max(4, Math.min(a.left, vw - w - 4)))}px`;
	el.style.top = `${Math.round(below ? a.bottom + GAP : a.top - GAP - h)}px`;
}

function show(anchor: HTMLElement, tip: TipContent, pin: boolean): void {
	const el = ensure(anchor);
	el.replaceChildren();
	if (tip.where) {
		const where = document.createElement('div');
		where.className = 'ox-tip-where ox-code';
		where.textContent = tip.where;
		el.append(where);
	}
	for (const para of tip.text.split(/\n{2,}/)) {
		const p = document.createElement('p');
		p.append(...inline(para.trim()));
		el.append(p);
	}
	if (pin && tip.doc && openDocs) {
		const link = document.createElement('button');
		link.className = 'ox-tip-doc';
		link.textContent = 'Documentation';
		const section = tip.doc;
		link.addEventListener('click', () => {
			hide();
			openDocs?.(section);
		});
		el.append(link);
	}
	el.classList.toggle('pinned', pin);
	el.setAttribute('role', pin ? 'note' : 'tooltip');
	if (typeof el.showPopover === 'function') {
		el.popover = 'manual';
		if (!el.matches(':popover-open')) el.showPopover();
	} else el.classList.add('open');
	place(el, anchor);
	owner = anchor;
	if (pinned !== pin) {
		pinned = pin;
		for (const l of pinListeners) l();
	}
}

function hide(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	if (!box || !owner) return;
	if (typeof box.hidePopover === 'function' && box.matches(':popover-open')) box.hidePopover();
	box.classList.remove('open');
	owner = null;
	if (pinned) {
		pinned = false;
		for (const l of pinListeners) l();
	}
}

/** The tip pinned open on `anchor`, if any (the Hint button shows itself pressed) */
export const isPinned = (anchor: HTMLElement | undefined): boolean => pinned && !!anchor && owner === anchor;
export function onPinChange(listener: () => void): () => void {
	pinListeners.add(listener);
	return () => pinListeners.delete(listener);
}

/** Pin a tip open on `anchor` until Esc or a press elsewhere; again on the same anchor closes it */
export function togglePinned(anchor: HTMLElement, tip: Tip): void {
	const c = content(tip);
	if (isPinned(anchor) || !c) return hide();
	show(anchor, c, true);
}

if (typeof window !== 'undefined') {
	window.addEventListener('pointerdown', (e) => {
		if (!owner) return;
		// a press on the anchor of a pinned tip is its own toggle
		if (pinned && e.target instanceof Node && owner.contains(e.target)) return;
		hide();
	});
	window.addEventListener('keydown', (e) => {
		if (owner && (e.key === 'Escape' || !pinned)) hide();
	});
	window.addEventListener('scroll', () => owner && !pinned && hide(), true);
	window.addEventListener('blur', () => owner && hide());
}

/** Show `value` while the pointer rests on the node, or it has keyboard focus */
export function tip(node: HTMLElement, value: Tip) {
	let current = value;
	const enter = () => {
		if (pinned) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			const c = content(current);
			if (c && node.isConnected && !pinned) show(node, c, false);
		}, HOVER_MS);
	};
	const leave = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		if (owner === node && !pinned) hide();
	};
	const focus = () => {
		const c = content(current);
		if (c && !pinned && node.matches(':focus-visible')) show(node, c, false);
	};
	node.addEventListener('pointerenter', enter);
	node.addEventListener('pointerleave', leave);
	node.addEventListener('focus', focus);
	node.addEventListener('blur', leave);
	return {
		update(next: Tip) {
			current = next;
			if (owner === node && !pinned) {
				const c = content(next);
				if (c) show(node, c, false);
				else hide();
			}
		},
		destroy() {
			node.removeEventListener('pointerenter', enter);
			node.removeEventListener('pointerleave', leave);
			node.removeEventListener('focus', focus);
			node.removeEventListener('blur', leave);
			if (owner === node) hide();
		},
	};
}
