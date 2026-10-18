/**
 * Key chords and the keymap: which keys run which command, with the user's own bindings over the defaults.
 *
 * A chord is text like `Mod+Shift+S`: modifiers in a fixed order, then the key. `Mod` is the platform's main
 * modifier (Ctrl, ⌘ on macOS), so defaults and recorded bindings carry between platforms; `Ctrl` on macOS and
 * `Meta` elsewhere name the other one. Keys are what the key types (`S`, `?`, `F2`, `Space`, `Up`), so a
 * binding follows the keyboard layout; letters fall back to their position on layouts without Latin letters.
 */

export const MODIFIERS = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const NAMED: Record<string, string> = {
	' ': 'Space',
	Spacebar: 'Space',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	Escape: 'Esc',
	Esc: 'Esc',
	Del: 'Delete',
	Control: 'Ctrl',
	Shift: 'Shift',
	Alt: 'Alt',
	AltGraph: 'Alt',
	Meta: 'Meta',
	OS: 'Meta',
};

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

/** The key of an event as a chord names it (no modifiers), or null for keys that name nothing (dead keys) */
export function keyName(e: KeyLike): string | null {
	const k = e.key;
	if (!k || k === 'Dead' || k === 'Unidentified' || k === 'Process') return /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : null;
	if (NAMED[k]) return NAMED[k];
	// layouts without Latin letters, and macOS's Option combinations (⌥N types ˜): the letter at that position
	if (/^Key[A-Z]$/.test(e.code) && !/^[a-z]$/i.test(k)) return e.code.slice(3);
	if (k.length === 1) return k.toUpperCase();
	return k;
}

const isModifierKey = (key: string) => key === 'Ctrl' || key === 'Shift' || key === 'Alt' || key === 'Meta';
/** a key typed with Shift whose character already says so (`?`, `!`, `+`): Shift isn't part of its chord */
const isSymbol = (key: string) => key.length === 1 && !/[A-Z0-9]/.test(key);

/** The chord an event makes. A lone modifier is a chord of its own (`Shift`), for keys held down. */
export function chordOf(e: KeyLike, mac = isMac()): string | null {
	const key = keyName(e);
	if (!key) return null;
	if (isModifierKey(key)) return mac && key === 'Meta' ? 'Mod' : !mac && key === 'Ctrl' ? 'Mod' : key;
	const mods = new Set<Modifier>();
	if (mac ? e.metaKey : e.ctrlKey) mods.add('Mod');
	if (mac && e.ctrlKey) mods.add('Ctrl');
	if (!mac && e.metaKey) mods.add('Meta');
	if (e.altKey) mods.add('Alt');
	if (e.shiftKey && !isSymbol(key)) mods.add('Shift');
	return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+');
}

const MODIFIER_NAMES: Record<string, Modifier> = { mod: 'Mod', cmd: 'Mod', command: 'Mod', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', opt: 'Alt', shift: 'Shift', meta: 'Meta', win: 'Meta', super: 'Meta' };

/** A chord's modifiers and key. `Mod++` is Mod and the plus key. Names that aren't modifiers are dropped. */
export function parseChord(chord: string): { mods: Modifier[]; key: string } {
	const plus = chord.endsWith('++') || chord === '+';
	const parts = (plus ? chord.slice(0, -1) : chord).split('+').filter(Boolean);
	const last = plus ? '+' : (parts.pop() ?? '');
	const mods = parts.map((p) => MODIFIER_NAMES[p.toLowerCase()]).filter(Boolean);
	const named = Object.entries(NAMED).find(([k]) => k.length > 1 && k.toLowerCase() === last.toLowerCase())?.[1];
	const key = last.length === 1 ? last.toUpperCase() : (MODIFIER_NAMES[last.toLowerCase()] ?? named ?? last.charAt(0).toUpperCase() + last.slice(1));
	return { mods: MODIFIERS.filter((m) => mods.includes(m)), key };
}

/**
 * The canonical spelling of a chord (modifier order, key names), or null when it isn't one. Written by hand,
 * `Ctrl` means the main modifier where that's Ctrl (everywhere but macOS).
 */
export function normalizeChord(chord: string, mac = isMac()): string | null {
	if (typeof chord !== 'string' || !chord.trim()) return null;
	const raw = parseChord(chord.trim());
	if (!raw.key || raw.key.includes('+')) return raw.key === '+' ? [...raw.mods, '+'].join('+') : null;
	const mods = mac ? raw.mods : MODIFIERS.filter((m) => raw.mods.includes(m) || (m === 'Mod' && raw.mods.includes('Ctrl'))).filter((m) => m !== 'Ctrl');
	let key = raw.key;
	if (!mac && key === 'Ctrl') key = 'Mod';
	if (key === 'Mod' || isModifierKey(key)) return mods.length ? null : key;
	return [...mods, key].join('+');
}

const MAC_SYMBOL: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
const KEY_SYMBOL: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' };

/** The parts of a chord as they're shown on key caps: `Ctrl`, `Shift`, `S` (macOS: `⌘`, `⇧`, `S`) */
export function chordParts(chord: string, mac = isMac()): string[] {
	const { mods, key } = parseChord(chord);
	const shown = mods.map((m) => (mac ? MAC_SYMBOL[m] : m === 'Mod' ? 'Ctrl' : m === 'Meta' ? 'Win' : m));
	const k = !mods.length && isModifierKey(key) ? (mac ? MAC_SYMBOL[key] : key) : key === 'Mod' ? (mac ? '⌘' : 'Ctrl') : (KEY_SYMBOL[key] ?? key);
	return [...shown, k];
}

/** A chord as text: `Ctrl+Shift+S`, `⌘⇧S` */
export function formatChord(chord: string, mac = isMac()): string {
	return chordParts(chord, mac).join(mac ? '' : '+');
}

/** The chord as an Electron menu accelerator, or null when Electron can't show it */
export function toAccelerator(chord: string): string | null {
	const { mods, key } = parseChord(chord);
	if (!key || isModifierKey(key) || key === 'Mod') return null;
	const names: Record<Modifier, string> = { Mod: 'CmdOrCtrl', Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Meta: 'Super' };
	return [...mods.map((m) => names[m]), key === '+' ? 'Plus' : key].join('+');
}

/** A chord that does nothing in a text field by itself (it has Ctrl, Alt, ⌘ or is a function key), so it can run a command while typing */
export function worksWhileTyping(chord: string): boolean {
	const { mods, key } = parseChord(chord);
	return mods.some((m) => m !== 'Shift') || /^F\d{1,2}$/.test(key);
}

// ------------------------------------------------------------------------------------------- commands

/**
 * Where a binding acts. `app`: anywhere in Oxygen (plain keys only outside text fields), `camera`: held in the
 * viewport, `molang`: in Molang editors.
 */
export type KeyScope = 'app' | 'camera' | 'molang';

export interface KeyCommand {
	id: string;
	label: string;
	group: string;
	/** default chords */
	keys: string[];
	scope: KeyScope;
	help?: string;
}

/** Keys Molang editors handle themselves (CodeMirror's own): shown in the sheet, and binding them elsewhere warns */
export const EDITOR_KEYS: { keys: string; label: string }[] = [
	{ keys: 'Mod+Space', label: 'Complete' },
	{ keys: 'Mod+D', label: 'Select the next occurrence' },
	{ keys: 'Mod+F', label: 'Find and replace' },
	{ keys: 'Mod+Shift+[', label: 'Fold' },
	{ keys: 'Mod+Shift+]', label: 'Unfold' },
	{ keys: 'Mod+A', label: 'Select all' },
	{ keys: 'Mod+C', label: 'Copy' },
	{ keys: 'Mod+X', label: 'Cut' },
	{ keys: 'Mod+V', label: 'Paste' },
];

/** Chords browsers keep for themselves: the web app never sees them */
export const BROWSER_KEYS = ['Mod+W', 'Mod+T', 'Mod+N', 'Mod+Shift+W', 'Mod+Shift+T', 'Mod+Shift+N', 'Mod+Tab', 'Mod+Shift+Tab', 'Mod+Q'];

/** Every command a key can run, with its default keys. Commands that depend on the host appear everywhere here. */
export const KEY_COMMANDS: KeyCommand[] = [
	{ id: 'file.new', label: 'New effect', group: 'File', keys: ['Mod+Alt+N'], scope: 'app' },
	{ id: 'file.open', label: 'Open files…', group: 'File', keys: ['Mod+O'], scope: 'app' },
	{ id: 'file.openPack', label: 'Open resource pack folder…', group: 'File', keys: [], scope: 'app' },
	{ id: 'file.save', label: 'Save', group: 'File', keys: ['Mod+S'], scope: 'app' },
	{ id: 'file.saveAs', label: 'Save as…', group: 'File', keys: ['Mod+Shift+S'], scope: 'app', help: 'The web app downloads a copy' },
	{ id: 'file.share', label: 'Copy share link', group: 'File', keys: [], scope: 'app', help: 'Web app' },
	{ id: 'file.close', label: 'Close effect', group: 'File', keys: [], scope: 'app' },
	{ id: 'file.nextEffect', label: 'Next open effect', group: 'File', keys: [], scope: 'app' },
	{ id: 'file.previousEffect', label: 'Previous open effect', group: 'File', keys: [], scope: 'app' },

	{ id: 'edit.undo', label: 'Undo', group: 'Edit', keys: ['Mod+Z'], scope: 'app', help: 'One history for every editor' },
	{ id: 'edit.redo', label: 'Redo', group: 'Edit', keys: ['Mod+Y', 'Mod+Shift+Z'], scope: 'app' },
	{ id: 'edit.findVariable', label: 'Find uses of a variable…', group: 'Edit', keys: [], scope: 'app' },

	{ id: 'app.commands', label: 'Commands', group: 'Oxygen', keys: ['Mod+K', 'Mod+Shift+P'], scope: 'app' },
	{ id: 'app.settings', label: 'Settings', group: 'Oxygen', keys: ['Mod+,'], scope: 'app' },
	{ id: 'app.shortcuts', label: 'Keyboard shortcuts', group: 'Oxygen', keys: ['?'], scope: 'app' },
	{ id: 'app.about', label: 'About Oxygen', group: 'Oxygen', keys: [], scope: 'app' },

	{ id: 'preview.play', label: 'Play / pause', group: 'Preview', keys: ['Space'], scope: 'app' },
	{ id: 'preview.restart', label: 'Restart', group: 'Preview', keys: ['R'], scope: 'app' },
	{ id: 'preview.step', label: 'Step one frame (paused)', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.frame', label: 'Frame the particles', group: 'Preview', keys: ['F'], scope: 'app' },
	{ id: 'preview.repeat', label: 'Repeat on / off', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.slower', label: 'Slower playback', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.faster', label: 'Faster playback', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.paths', label: 'Trajectory paths on / off', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.facing', label: 'Facing axes on / off', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.velocity', label: 'Velocity arrows on / off', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.shape', label: 'Emitter shape on / off', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.render.classic', label: 'Render classic', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.render.vv', label: 'Render Vibrant Visuals', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.render.split', label: 'Render classic | Vibrant side by side', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.vvSky', label: 'Sky behind Vibrant Visuals on / off', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.spawn.command', label: 'Spawn as /particle', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.spawn.script', label: 'Spawn as a script', group: 'Preview', keys: [], scope: 'app' },
	{ id: 'preview.spawn.entity', label: 'Spawn on an entity', group: 'Preview', keys: [], scope: 'app' },

	{ id: 'view.inspector.categories', label: 'Inspector by category', group: 'View', keys: [], scope: 'app' },
	{ id: 'view.inspector.phases', label: 'Inspector by phase', group: 'View', keys: [], scope: 'app' },

	{ id: 'camera.forward', label: 'Fly forward', group: 'Camera', keys: ['W'], scope: 'camera' },
	{ id: 'camera.back', label: 'Fly back', group: 'Camera', keys: ['S'], scope: 'camera' },
	{ id: 'camera.left', label: 'Fly left', group: 'Camera', keys: ['A'], scope: 'camera' },
	{ id: 'camera.right', label: 'Fly right', group: 'Camera', keys: ['D'], scope: 'camera' },
	{ id: 'camera.up', label: 'Fly up', group: 'Camera', keys: ['E'], scope: 'camera' },
	{ id: 'camera.down', label: 'Fly down', group: 'Camera', keys: ['Q'], scope: 'camera' },
	{ id: 'camera.fast', label: 'Fly faster (held with the others)', group: 'Camera', keys: ['Shift'], scope: 'camera' },

	{ id: 'molang.rename', label: 'Rename a variable everywhere', group: 'Molang editors', keys: ['F2'], scope: 'molang' },
	{ id: 'molang.definition', label: 'Go to where it is set', group: 'Molang editors', keys: ['F12'], scope: 'molang', help: 'Ctrl+click does it too' },
	{ id: 'molang.references', label: 'List its uses', group: 'Molang editors', keys: ['Shift+F12'], scope: 'molang' },
	{ id: 'molang.comment', label: 'Comment (kept in the oxygen block)', group: 'Molang editors', keys: ['Mod+/'], scope: 'molang' },
	{ id: 'molang.format', label: 'Format', group: 'Molang editors', keys: ['Alt+Shift+F'], scope: 'molang' },
];

/** Panels and layouts get a command each (no keys by default) */
export function viewCommands(panels: Record<string, { title: string }>, layouts: { id: string; label: string }[]): KeyCommand[] {
	return [
		...Object.entries(panels).map(([id, p]) => ({ id: `view.panel.${id}`, label: `Show or hide ${p.title}`, group: 'View', keys: [], scope: 'app' as const })),
		...layouts.map((l) => ({ id: `view.layout.${l.id}`, label: `Layout: ${l.label}`, group: 'View', keys: [], scope: 'app' as const })),
	];
}

/** User bindings: command id → its chords (an empty list unbinds it). Unknown chords are dropped. */
export type KeyOverrides = Record<string, string[]>;

export function sanitizeOverrides(value: unknown, mac = isMac()): KeyOverrides {
	const out: KeyOverrides = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
	for (const [id, keys] of Object.entries(value)) {
		if (!Array.isArray(keys)) continue;
		out[id] = [...new Set(keys.map((k) => normalizeChord(k, mac)).filter((k): k is string => !!k))];
	}
	return out;
}

const overlaps = (a: KeyScope, b: KeyScope) => a === b || a === 'app' || b === 'app';

/** The keys in effect: each command's defaults, or the user's own */
export class Keymap {
	private byId = new Map<string, KeyCommand>();
	private bound = new Map<string, string[]>();

	constructor(
		readonly commands: KeyCommand[],
		readonly overrides: KeyOverrides = {},
		readonly mac = isMac(),
	) {
		for (const c of commands) {
			this.byId.set(c.id, c);
			this.bound.set(c.id, overrides[c.id] ?? c.keys);
		}
	}

	command(id: string): KeyCommand | undefined {
		return this.byId.get(id);
	}

	keys(id: string): string[] {
		return this.bound.get(id) ?? [];
	}

	isDefault(id: string): boolean {
		const c = this.byId.get(id);
		return !c || !(id in this.overrides) || sameKeys(this.overrides[id], c.keys);
	}

	/** The first key of a command as text (`Ctrl+S`), for menus and tooltips */
	label(id: string): string | undefined {
		const k = this.keys(id)[0];
		return k ? formatChord(k, this.mac) : undefined;
	}

	/** `text (key)`, or the text alone when the command has no key */
	title(text: string, id: string): string {
		const k = this.label(id);
		return k ? `${text} (${k})` : text;
	}

	/** The command a chord runs in a scope */
	find(chord: string, scope: KeyScope): string | undefined {
		for (const c of this.commands) if (c.scope === scope && this.keys(c.id).includes(chord)) return c.id;
		return undefined;
	}

	/** Other commands (and editor keys) the chord would also trigger, where the command's scope meets theirs */
	clashes(chord: string, id: string): string[] {
		const self = this.byId.get(id);
		if (!self) return [];
		const out: string[] = [];
		for (const c of this.commands) if (c.id !== id && overlaps(c.scope, self.scope) && this.keys(c.id).includes(chord)) out.push(c.label);
		// a held camera key takes plain keys only: a binding with Shift still flies (Shift is "faster")
		if (self.scope !== 'camera') {
			for (const e of EDITOR_KEYS) if (e.keys === chord) out.push(`${e.label} in Molang editors`);
		}
		return out;
	}
}

export function sameKeys(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** The key a held camera binding matches: its key alone (Shift is the "faster" key, so it's left out) */
export function heldKey(e: KeyLike, mac = isMac()): string | null {
	const key = keyName(e);
	if (!key) return null;
	if (isModifierKey(key)) return chordOf(e, mac);
	return key;
}
