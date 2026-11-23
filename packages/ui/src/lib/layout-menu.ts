import { LAYOUTS, type Workspace } from '../state/workspace.svelte';
import type { MenuItem } from './menu-items';

/**
 * How the window is arranged: a preset to set it to, and how the Inspector groups its fields. One list for the
 * layout button in the top bar and for the View menu, so the two can't drift apart.
 */
export function layoutMenuItems(workspace: Workspace): MenuItem[] {
	const k = (id: string) => workspace.keymap.label(id);
	const current = LAYOUTS.find((l) => l.id === workspace.layoutName) ?? LAYOUTS[0];
	return [
		{ heading: 'Layout' },
		...LAYOUTS.map((l): MenuItem => ({ label: l.label, title: l.help, checked: l.id === current.id, keys: k(`view.layout.${l.id}`), run: () => workspace.applyLayout(l.id) })),
		{ label: `Reset ${current.label}`, title: 'Put the panels back where this layout starts', run: () => workspace.applyLayout(current.id) },
		{ separator: true },
		{ heading: 'Inspector grouped by' },
		{ label: 'Category', title: 'Emitter, Shape, Motion, Lifetime, Appearance, Logic', checked: workspace.inspectorView === 'categories', keys: k('view.inspector.categories'), run: () => void (workspace.inspectorView = 'categories') },
		{ label: 'Evaluation phase', title: 'Every field in the order the game runs it', checked: workspace.inspectorView === 'phases', keys: k('view.inspector.phases'), run: () => void (workspace.inspectorView = 'phases') },
	];
}
