import { describe, expect, it } from 'vitest';
import { chordOf, formatChord, heldKey, KEY_COMMANDS, Keymap, normalizeChord, parseChord, sanitizeOverrides, toAccelerator, viewCommands, worksWhileTyping } from '../src/lib/keys';

const key = (k: string, code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({ key: k, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('chords from key events', () => {
	it('name the main modifier Mod, so bindings carry between platforms', () => {
		expect(chordOf(key('s', 'KeyS', { ctrlKey: true }), false)).toBe('Mod+S');
		expect(chordOf(key('s', 'KeyS', { metaKey: true }), true)).toBe('Mod+S');
		// the other one keeps its own name
		expect(chordOf(key('s', 'KeyS', { ctrlKey: true }), true)).toBe('Ctrl+S');
		expect(chordOf(key('s', 'KeyS', { metaKey: true }), false)).toBe('Meta+S');
	});

	it('put modifiers in one order, and keep Shift out of symbols it typed', () => {
		expect(chordOf(key('S', 'KeyS', { ctrlKey: true, shiftKey: true, altKey: true }), false)).toBe('Mod+Alt+Shift+S');
		expect(chordOf(key('?', 'Slash', { shiftKey: true }), false)).toBe('?');
		expect(chordOf(key('F12', 'F12', { shiftKey: true }), false)).toBe('Shift+F12');
		expect(chordOf(key(' ', 'Space'), false)).toBe('Space');
		expect(chordOf(key('ArrowLeft', 'ArrowLeft', { altKey: true }), false)).toBe('Alt+Left');
	});

	it('read letters by position on layouts without Latin letters, and through macOS Option', () => {
		expect(chordOf(key('ы', 'KeyS', { ctrlKey: true }), false)).toBe('Mod+S');
		expect(chordOf(key('˜', 'KeyN', { metaKey: true, altKey: true }), true)).toBe('Mod+Alt+N');
	});

	it('make a lone modifier a chord of its own, for held keys', () => {
		expect(chordOf(key('Shift', 'ShiftLeft', { shiftKey: true }), false)).toBe('Shift');
		expect(chordOf(key('Control', 'ControlLeft', { ctrlKey: true }), false)).toBe('Mod');
		expect(heldKey(key('W', 'KeyW', { shiftKey: true }), false)).toBe('W');
	});
});

describe('chord text', () => {
	it('round-trips, including the plus key', () => {
		expect(parseChord('Mod++')).toEqual({ mods: ['Mod'], key: '+' });
		// by hand, Ctrl is the main modifier except on macOS
		expect(normalizeChord('shift+ctrl+s', false)).toBe('Mod+Shift+S');
		expect(normalizeChord('shift+ctrl+s', true)).toBe('Ctrl+Shift+S');
		expect(normalizeChord('Cmd+Option+n', true)).toBe('Mod+Alt+N');
		expect(normalizeChord('alt+arrowup', false)).toBe('Alt+Up');
		expect(normalizeChord('f12', false)).toBe('F12');
		expect(normalizeChord('Shift', false)).toBe('Shift');
		expect(normalizeChord('Ctrl', false)).toBe('Mod');
		expect(normalizeChord('', false)).toBeNull();
		expect(normalizeChord('Ctrl+Shift', false)).toBeNull();
	});

	it('reads as each platform writes it', () => {
		expect(formatChord('Mod+Shift+S', false)).toBe('Ctrl+Shift+S');
		expect(formatChord('Mod+Shift+S', true)).toBe('⌘⇧S');
		expect(formatChord('Alt+Up', false)).toBe('Alt+↑');
		expect(toAccelerator('Mod+Alt+N')).toBe('CmdOrCtrl+Alt+N');
		expect(toAccelerator('Mod++')).toBe('CmdOrCtrl+Plus');
		expect(toAccelerator('Shift')).toBeNull();
	});

	it('knows which keys still work while typing', () => {
		expect(worksWhileTyping('Mod+S')).toBe(true);
		expect(worksWhileTyping('F2')).toBe(true);
		expect(worksWhileTyping('Space')).toBe(false);
		expect(worksWhileTyping('Shift+R')).toBe(false);
	});
});

describe('the keymap', () => {
	const commands = [...KEY_COMMANDS, ...viewCommands({ viewport: { title: 'Viewport' } }, [{ id: 'editor', label: 'Editor' }])];

	it('has every default key in canonical spelling, and no two commands sharing one where both act', () => {
		const km = new Keymap(commands, {}, false);
		for (const c of commands) for (const k of c.keys) expect(normalizeChord(k, false)).toBe(k);
		for (const c of commands) for (const k of km.keys(c.id)) expect(km.clashes(k, c.id)).toEqual([]);
	});

	it('takes the user’s keys over the defaults, and an empty list unbinds', () => {
		const km = new Keymap(commands, { 'file.save': ['Mod+Alt+S'], 'preview.play': [] }, false);
		expect(km.find('Mod+S', 'app')).toBeUndefined();
		expect(km.find('Mod+Alt+S', 'app')).toBe('file.save');
		expect(km.find('Space', 'app')).toBeUndefined();
		expect(km.label('file.save')).toBe('Ctrl+Alt+S');
		expect(km.title('Save', 'file.save')).toBe('Save (Ctrl+Alt+S)');
		expect(km.title('Play', 'preview.play')).toBe('Play');
		expect(km.isDefault('file.save')).toBe(false);
		expect(km.isDefault('file.open')).toBe(true);
	});

	it('tells which other commands a key would also run', () => {
		const km = new Keymap(commands, { 'preview.restart': ['W'], 'app.about': ['Mod+D'] }, false);
		expect(km.clashes('W', 'preview.restart')).toEqual(['Fly forward']);
		expect(km.clashes('W', 'camera.forward')).toEqual(['Restart']);
		expect(km.clashes('Mod+D', 'app.about')).toEqual(['Select the next occurrence in Molang editors']);
		// Molang editor keys and camera keys never meet
		const km2 = new Keymap(commands, { 'molang.rename': ['W'] }, false);
		expect(km2.clashes('W', 'molang.rename')).toEqual([]);
	});

	it('drops stored bindings it can’t read', () => {
		expect(sanitizeOverrides({ 'file.save': ['ctrl+s', 'Mod+S', 'shift+ctrl', 3], x: 'Mod+S', y: null }, false)).toEqual({ 'file.save': ['Mod+S'] });
		expect(sanitizeOverrides([1, 2])).toEqual({});
	});
});
