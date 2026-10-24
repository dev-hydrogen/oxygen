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

/** Close an effect, asking first when it has unsaved changes */
export function closeEffect(workspace: Workspace, id = workspace.activeId): void {
	const s = workspace.sessions.find((x) => x.id === id);
	if (!s) return;
	if (s.dirty && workspace.prefs.confirmClose && !confirm(`${s.file.name} has unsaved changes. Close it anyway?`)) return;
	workspace.close(s.id);
}

/** Close several effects, asking once when any of them has unsaved changes */
export function closeEffects(workspace: Workspace, ids: string[]): void {
	const list = workspace.sessions.filter((x) => ids.includes(x.id));
	const dirty = list.filter((s) => s.dirty);
	if (dirty.length && workspace.prefs.confirmClose && !confirm(`${dirty.length === 1 ? `${dirty[0].file.name} has` : `${dirty.length} effects have`} unsaved changes. Close ${list.length === 1 ? 'it' : 'them'} anyway?`)) return;
	for (const s of list) workspace.close(s.id);
}

export async function openExample(workspace: Workspace, e: { name: string; load: () => Promise<string> }): Promise<void> {
	if (workspace.host.openExample) return workspace.host.openExample(e.name);
	workspace.open({ file: { name: `${e.name}.particle.json`, id: `example:${e.name}` }, text: await e.load() });
}
