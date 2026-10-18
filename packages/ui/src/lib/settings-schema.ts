import type { Host } from '../host';
import { DEFAULT_PREFERENCES, SPEEDS, type Preferences } from '../state/preferences';
import type { SettingsSection } from '../state/workspace.svelte';

/** The rows of the Settings dialog: what each preference is called, explained, and set with */

export type Control =
	| { type: 'toggle' }
	| { type: 'select'; options: { value: string; label: string }[] }
	| { type: 'range'; min: number; max: number; step: number; format: (v: number) => string }
	| { type: 'color' };

export interface SettingRow {
	section: SettingsSection;
	/** heading the row sits under in its section */
	group: string;
	/** path into the preferences: `fov`, `gizmos.ground` */
	key: string;
	label: string;
	help?: string;
	control: Control;
	/** only where these hosts run Oxygen */
	hosts?: Host['kind'][];
	/** what applying it means, when that's not "now" */
	note?: string;
}

export const SECTIONS: { id: SettingsSection; label: string; help: string }[] = [
	{ id: 'general', label: 'General', help: 'Editing, text and messages' },
	{ id: 'preview', label: 'Preview', help: 'How effects start playing, and how they are drawn' },
	{ id: 'viewport', label: 'Viewport', help: 'Camera, resolution and helpers' },
	{ id: 'keyboard', label: 'Keyboard', help: 'Every command and the keys that run it' },
	{ id: 'data', label: 'Settings data', help: 'Export, import and reset' },
];

const times = (v: number) => `${v.toFixed(2).replace(/\.?0+$/, '')}×`;
const clock = (t: number) => {
	const minutes = Math.round(t * 24 * 60) % (24 * 60);
	const name = t === 0 || t === 1 ? ' (midnight)' : t === 0.25 ? ' (sunrise)' : t === 0.5 ? ' (noon)' : t === 0.75 ? ' (sunset)' : '';
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}${name}`;
};

export const SETTINGS: SettingRow[] = [
	// general
	{ section: 'general', group: 'Editing', key: 'confirmClose', label: 'Ask before closing an effect with unsaved changes', control: { type: 'toggle' }, hosts: ['web', 'desktop'] },
	{
		section: 'general',
		group: 'Editing',
		key: 'inspectorView',
		label: 'Inspector shows fields',
		help: 'By category groups components as the format does; by phase follows the order the game evaluates them in',
		control: {
			type: 'select',
			options: [
				{ value: 'categories', label: 'By category' },
				{ value: 'phases', label: 'By phase' },
			],
		},
	},
	{
		section: 'general',
		group: 'Text',
		key: 'codeSize',
		label: 'Code text size',
		help: 'Molang editors and the Source panel',
		control: { type: 'select', options: [{ value: '0', label: 'Default' }, ...[10, 11, 12, 13, 14, 15, 16, 18, 20, 22].map((n) => ({ value: String(n), label: `${n} px` }))] },
	},
	{
		section: 'general',
		group: 'Text',
		key: 'zoom',
		label: 'Interface zoom',
		help: 'Everything in the window. Ctrl+= and Ctrl+- zoom too, until the next start.',
		control: { type: 'range', min: 0.5, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
		hosts: ['desktop'],
	},
	{
		section: 'general',
		group: 'Updates',
		key: 'autoUpdate',
		label: 'Download and install updates by themselves',
		help: 'Updates download in the background and install when Oxygen restarts. Off, Oxygen only says when there is one. On macOS it always says where to get it.',
		control: { type: 'toggle' },
		hosts: ['desktop'],
	},
	{
		section: 'general',
		group: 'Messages',
		key: 'noticeSeconds',
		label: 'Status messages stay for',
		help: '“Saved …”, “Copied a link …” and errors, in the status bar',
		control: { type: 'range', min: 1, max: 30, step: 0.5, format: (v) => `${v} s` },
	},

	// preview
	{
		section: 'preview',
		group: 'A newly opened effect',
		key: 'spawnMode',
		label: 'Is spawned by',
		help: 'How the game would spawn it: the particle cap, looping and the queries available depend on it. An effect whose scene says otherwise keeps its own.',
		control: {
			type: 'select',
			options: [
				{ value: 'command', label: '/particle' },
				{ value: 'script', label: 'Script API' },
				{ value: 'entity', label: 'Entity' },
			],
		},
	},
	{ section: 'preview', group: 'A newly opened effect', key: 'repeat', label: 'Repeats', help: 'Looping effects loop in place; others play again when they end', control: { type: 'toggle' } },
	{ section: 'preview', group: 'A newly opened effect', key: 'speed', label: 'Plays at', control: { type: 'select', options: SPEEDS.map((s) => ({ value: String(s), label: `${s}×` })) } },
	{
		section: 'preview',
		group: 'A newly opened effect',
		key: 'timeOfDay',
		label: 'Time of day',
		help: 'query.time_of_day, and the Vibrant Visuals sky and lighting. Effects that keep a scene in their file use its time.',
		control: { type: 'range', min: 0, max: 1, step: 0.01, format: clock },
	},
	{
		section: 'preview',
		group: 'Drawing',
		key: 'renderMode',
		label: 'Rendering',
		help: 'Vibrant Visuals is an approximation from the pack’s lighting, color grading and texture sets',
		control: {
			type: 'select',
			options: [
				{ value: 'classic', label: 'Classic' },
				{ value: 'vv', label: 'Vibrant Visuals' },
				{ value: 'split', label: 'Classic | Vibrant side by side' },
			],
		},
	},
	{ section: 'preview', group: 'Drawing', key: 'vvSky', label: 'Sky behind Vibrant Visuals', help: 'Off keeps the classic background, so only the particles differ', control: { type: 'toggle' } },

	// viewport
	{ section: 'viewport', group: 'Camera', key: 'fov', label: 'Field of view', help: 'Vertical, in degrees. A saved view brings its own.', control: { type: 'range', min: 30, max: 110, step: 1, format: (v) => `${v}°` } },
	{ section: 'viewport', group: 'Camera', key: 'turnSpeed', label: 'Turning speed', help: 'Dragging to orbit, and right-dragging to look around', control: { type: 'range', min: 0.25, max: 3, step: 0.05, format: times } },
	{ section: 'viewport', group: 'Camera', key: 'invertY', label: 'Invert up and down', help: 'Dragging up turns the camera down', control: { type: 'toggle' } },
	{ section: 'viewport', group: 'Camera', key: 'zoomSpeed', label: 'Wheel speed', help: 'How far a wheel notch moves toward what’s under the cursor', control: { type: 'range', min: 0.25, max: 3, step: 0.05, format: times } },
	{ section: 'viewport', group: 'Camera', key: 'flySpeed', label: 'Flying speed', help: 'Holding the fly keys (Keyboard › Camera)', control: { type: 'range', min: 0.25, max: 5, step: 0.05, format: times } },
	{ section: 'viewport', group: 'Camera', key: 'fastFactor', label: 'Flying faster multiplies it by', control: { type: 'range', min: 1, max: 10, step: 0.5, format: times } },
	{
		section: 'viewport',
		group: 'Picture',
		key: 'resolution',
		label: 'Resolution',
		help: 'Fewer pixels draw faster on slow graphics; more look sharper on high-density screens',
		control: {
			type: 'select',
			options: [
				{ value: '0', label: 'The screen’s (up to 2×)' },
				{ value: '0.5', label: 'Half (fastest)' },
				{ value: '1', label: '1×' },
				{ value: '1.5', label: '1.5×' },
				{ value: '2', label: '2×' },
				{ value: '3', label: '3× (sharpest)' },
			],
		},
	},
	{ section: 'viewport', group: 'Picture', key: 'background', label: 'Background', help: 'Behind classic rendering, and behind Vibrant Visuals with its sky off', control: { type: 'color' } },
	{ section: 'viewport', group: 'Picture', key: 'showFps', label: 'Show the frame rate', control: { type: 'toggle' } },
	{ section: 'viewport', group: 'Helpers', key: 'gizmos.ground', label: 'Ground grid', help: 'Particles still collide with the ground when it’s hidden', control: { type: 'toggle' } },
	{ section: 'viewport', group: 'Helpers', key: 'gizmos.block', label: 'Reference block', help: 'A one-block outline, for scale', control: { type: 'toggle' } },
	{ section: 'viewport', group: 'Helpers', key: 'gizmos.emitter', label: 'Emitter', help: 'The effect’s own emitter: its axes and ring', control: { type: 'toggle' } },
	{ section: 'viewport', group: 'Helpers', key: 'gizmos.children', label: 'Child emitters', help: 'Emitters its events spawn', control: { type: 'toggle' } },
	{ section: 'viewport', group: 'Helpers', key: 'gizmos.killPlane', label: 'Kill plane', control: { type: 'toggle' } },
	{ section: 'viewport', group: 'Helpers', key: 'gizmos.entity', label: 'Entity', help: 'The stand-in entity, its locator and its path, when an effect is spawned on it', control: { type: 'toggle' } },
];

export function getPref(p: Preferences, key: string): unknown {
	return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], p);
}

export function setPref(p: Preferences, key: string, value: unknown): void {
	const parts = key.split('.');
	const last = parts.pop()!;
	const target = parts.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, p as unknown as Record<string, unknown>);
	target[last] = value;
}

export const defaultOf = (key: string) => getPref(DEFAULT_PREFERENCES, key);

export const isModified = (p: Preferences, key: string) => JSON.stringify(getPref(p, key)) !== JSON.stringify(defaultOf(key));

/** The rows a search finds: by label, help or group */
export function searchSettings(rows: SettingRow[], query: string): SettingRow[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter((r) => `${r.label} ${r.help ?? ''} ${r.group} ${r.key}`.toLowerCase().includes(q));
}
