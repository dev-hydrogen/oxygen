/** What a right-click menu holds */

export interface MenuAction {
	label: string;
	/** the key bound to the same command, for the right column */
	keys?: string;
	run?: () => void | Promise<void>;
	/** a toggle or a choice: shows a check */
	checked?: boolean;
	disabled?: boolean;
	title?: string;
	/** removes or discards something */
	danger?: boolean;
}
export type MenuItem = MenuAction | { separator: true } | { heading: string };

/** Separators and headings only where there's something to separate */
export function tidyMenu(items: MenuItem[]): MenuItem[] {
	const out: MenuItem[] = [];
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if ('separator' in it) {
			if (out.length && !('separator' in out[out.length - 1])) out.push(it);
		} else if ('heading' in it) {
			const next = items[i + 1];
			if (next && !('separator' in next) && !('heading' in next)) out.push(it);
		} else out.push(it);
	}
	while (out.length && 'separator' in out[out.length - 1]) out.pop();
	return out;
}
