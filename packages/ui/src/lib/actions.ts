import type { Workspace } from '../state/workspace.svelte';
import { flushEdits } from './flush';
import { shareLink } from './share';

/** Actions the command palette and the menu bar both offer */

export function save(workspace: Workspace, as = false): void {
	flushEdits();
	if (as && workspace.host.saveAs) void workspace.saveAs();
	else if (as && workspace.host.download) workspace.download();
	else void workspace.save();
}

export async function copyShareLink(workspace: Workspace): Promise<void> {
	const s = workspace.active;
	if (!s) return;
	flushEdits();
	const url = shareLink(s.doc.text, location.href);
	await navigator.clipboard.writeText(url);
	workspace.say(`Copied a link to ${s.file.name} (${Math.round(url.length / 1024)} KB). The effect travels inside the link.`);
}

/** Close an effect, asking first when it has unsaved changes: save them, drop them, or stay */
export async function closeEffect(workspace: Workspace, id = workspace.activeId): Promise<void> {
	const s = workspace.sessions.find((x) => x.id === id);
	if (!s) return;
	if (s.dirty && workspace.prefs.confirmClose) {
		workspace.activeId = s.id;
		const a = await workspace.ask({
			title: `Save the changes to ${s.file.name}?`,
			message: 'Closing it without saving loses them.',
			actions: [
				{ id: 'cancel', label: 'Cancel', kind: 'quiet' },
				{ id: 'discard', label: 'Don’t save' },
				{ id: 'save', label: 'Save', kind: 'primary' },
			],
		});
		if (a === 'save') {
			flushEdits();
			await workspace.save(s);
			// the save was cancelled or failed: it stays open
			if (s.dirty) return;
		} else if (a !== 'discard') return;
	}
	workspace.close(s.id);
}

/** Close several effects, asking once when any of them has unsaved changes */
export async function closeEffects(workspace: Workspace, ids: string[]): Promise<void> {
	const list = workspace.sessions.filter((x) => ids.includes(x.id));
	const dirty = list.filter((s) => s.dirty);
	if (dirty.length && workspace.prefs.confirmClose) {
		const a = await workspace.ask({
			title: dirty.length === 1 ? `Save the changes to ${dirty[0].file.name}?` : `Save the changes to ${dirty.length} effects?`,
			message: dirty.length === 1 ? 'Closing it without saving loses them.' : `${dirty.map((s) => s.file.name).join(', ')}. Closing them without saving loses the changes.`,
			actions: [
				{ id: 'cancel', label: 'Cancel', kind: 'quiet' },
				{ id: 'discard', label: 'Don’t save' },
				{ id: 'save', label: dirty.length === 1 ? 'Save' : 'Save all', kind: 'primary' },
			],
		});
		if (a === 'save') {
			flushEdits();
			for (const s of dirty) await workspace.save(s);
			if (dirty.some((s) => s.dirty)) return;
		} else if (a !== 'discard') return;
	}
	for (const s of list) workspace.close(s.id);
}

export async function openExample(workspace: Workspace, e: { name: string; load: () => Promise<string> }): Promise<void> {
	if (workspace.host.openExample) return workspace.host.openExample(e.name);
	workspace.open({ file: { name: `${e.name}.particle.json`, id: `example:${e.name}` }, text: await e.load() });
}
