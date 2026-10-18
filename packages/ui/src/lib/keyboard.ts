import { setMolangKeys, type MolangKeyCommand } from '@oxygen/lang';
import type { Workspace } from '../state/workspace.svelte';
import type { FlyAction } from '../viewport/scene';
import { runCommand } from './commands';
import { chordOf, worksWhileTyping, type Keymap } from './keys';

export function inTextField(e: Event): boolean {
	const t = e.target as HTMLElement | null;
	return !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

/**
 * A key pressed anywhere in Oxygen: run the command bound to it. Plain keys (Space, R) wait while a text field
 * has focus; chords with Ctrl, Alt or ⌘ (and function keys) work there too. `only` limits it to some commands.
 */
export function handleKey(w: Workspace, e: KeyboardEvent, only?: (id: string) => boolean): void {
	if (e.defaultPrevented || e.isComposing || w.recordingKeys) return;
	const chord = chordOf(e, w.keymap.mac);
	if (!chord) return;
	if (inTextField(e) && !worksWhileTyping(chord)) return;
	const id = w.keymap.find(chord, 'app');
	if (!id || (only && !only(id))) return;
	// the dialogs keep the keys to themselves, apart from those that switch between them
	if ((w.settingsOpen || w.aboutOpen) && id !== 'app.settings' && id !== 'app.about') return;
	if (runCommand(w, id)) e.preventDefault();
}

const MOLANG: MolangKeyCommand[] = ['rename', 'definition', 'references', 'comment', 'format'];

/** Hand the Molang editors their keys */
export function bindMolangKeys(keymap: Keymap): void {
	const tests: Partial<Record<MolangKeyCommand, (e: KeyboardEvent) => boolean>> = {};
	for (const id of MOLANG) {
		const keys = keymap.keys(`molang.${id}`);
		tests[id] = (e) => {
			const c = chordOf(e, keymap.mac);
			return !!c && keys.includes(c);
		};
	}
	setMolangKeys(tests);
}

const FLY: FlyAction[] = ['forward', 'back', 'left', 'right', 'up', 'down', 'fast'];

/** The viewport's held keys */
export function flyKeys(keymap: Keymap): Record<FlyAction, string[]> {
	return Object.fromEntries(FLY.map((a) => [a, keymap.keys(`camera.${a}`)])) as Record<FlyAction, string[]>;
}
