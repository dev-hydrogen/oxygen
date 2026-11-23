import { applyEdits, modify, parse, type JSONPath } from 'jsonc-parser';
import type { GradingModel, Keyframes, LightingModel, RGB } from '@oxygen/scene';

/**
 * The two pack files Vibrant Visuals draws with, written back from what the panel edits:
 * `color_grading/color_grading.json` and `lighting/global.json`. A file the pack already has keeps its
 * formatting and everything Oxygen doesn't model: only the keys that were changed are set. A pack without the
 * file gets a new one in the game's documented shape, with every value Oxygen models.
 */

export const GRADING_PATH = 'color_grading/color_grading.json';
export const LIGHTING_PATH = 'lighting/global.json';

export type GradingKey = keyof GradingModel;
export type LightingKey = keyof LightingModel;

const FORMAT = { formattingOptions: { insertSpaces: false, tabSize: 1 } };
const tidy = (n: number) => Math.round(n * 1e4) / 1e4;
const vec = (c: RGB) => c.map(tidy);

/** `#rrggbb`, one of the two ways the game takes a colour */
export const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
export function fromHex(hex: string): RGB {
	const h = hex.replace('#', '');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

/** a value for the whole day, or one per time of day */
const keyed = <T>(k: Keyframes<T>, one: (v: T) => unknown): unknown => (typeof k === 'number' || Array.isArray(k) ? one(k as T) : Object.fromEntries(Object.entries(k as Record<string, T>).map(([t, v]) => [t, one(v)])));

const object = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const json = (value: unknown) => `${JSON.stringify(value, null, '\t').replace(/\[\s*([-\d.,\s]+?)\s*\]/g, (_, list: string) => `[${list.split(/\s*,\s*/).join(', ')}]`)}\n`;

function patch(text: string, edits: [JSONPath, unknown][]): string {
	let out = text;
	for (const [path, value] of edits) out = applyEdits(out, modify(out, path, value, FORMAT));
	return out;
}

function gradingValue(g: GradingModel, key: GradingKey): [string[], unknown] {
	if (key === 'toneMapper') return [['tone_mapping', 'operator'], g.toneMapper];
	if (key === 'gamma') return [['color_grading', 'midtones', 'gamma'], [tidy(g.gamma), tidy(g.gamma), tidy(g.gamma)]];
	return [['color_grading', 'midtones', key], vec(g[key])];
}

/** The text of color_grading.json with `changed` set in `existing` (the pack's file), or a new file */
export function gradingFile(g: GradingModel, existing: string | null, changed: Iterable<GradingKey>): string {
	if (existing === null) {
		return json({
			format_version: '1.21.90',
			'minecraft:color_grading_settings': {
				description: { identifier: 'minecraft:default_color_grading' },
				color_grading: { midtones: { contrast: vec(g.contrast), gain: vec(g.gain), gamma: [tidy(g.gamma), tidy(g.gamma), tidy(g.gamma)], offset: vec(g.offset), saturation: vec(g.saturation) } },
				tone_mapping: { operator: g.toneMapper },
			},
		});
	}
	const root: string[] = 'minecraft:color_grading_settings' in object(parse(existing)) ? ['minecraft:color_grading_settings'] : [];
	return patch(
		existing,
		[...changed].map((k) => {
			const [path, value] = gradingValue(g, k);
			return [[...root, ...path], value];
		}),
	);
}

function lightingValue(l: LightingModel, key: LightingKey, orbital: string[]): [string[], unknown] {
	const num = (k: Keyframes<number>) => keyed(k, tidy);
	const col = (k: Keyframes<RGB>) => keyed(k, toHex);
	switch (key) {
		case 'sunIlluminance':
			return [[...orbital, 'sun', 'illuminance'], num(l.sunIlluminance)];
		case 'sunColor':
			return [[...orbital, 'sun', 'color'], col(l.sunColor)];
		case 'moonIlluminance':
			return [[...orbital, 'moon', 'illuminance'], num(l.moonIlluminance)];
		case 'moonColor':
			return [[...orbital, 'moon', 'color'], col(l.moonColor)];
		case 'ambientIlluminance':
			return [['ambient', 'illuminance'], num(l.ambientIlluminance)];
		case 'ambientColor':
			return [['ambient', 'color'], col(l.ambientColor)];
		case 'orbitalOffsetDegrees':
			return [[...orbital, 'orbital_offset_degrees'], tidy(l.orbitalOffsetDegrees)];
		case 'emissiveDesaturation':
			return [['emissive', 'desaturation'], tidy(l.emissiveDesaturation)];
	}
}

const LIGHTING_KEYS: LightingKey[] = ['sunIlluminance', 'sunColor', 'moonIlluminance', 'moonColor', 'orbitalOffsetDegrees', 'emissiveDesaturation', 'ambientIlluminance', 'ambientColor'];

/** The text of lighting/global.json with `changed` set in `existing` (the pack's file), or a new file */
export function lightingFile(l: LightingModel, existing: string | null, changed: Iterable<LightingKey>): string {
	if (existing === null) {
		const settings: Record<string, any> = { description: { identifier: 'minecraft:default_lighting' } };
		for (const k of LIGHTING_KEYS) {
			const [path, value] = lightingValue(l, k, ['directional_lights', 'orbital']);
			let at = settings;
			for (const p of path.slice(0, -1)) at = at[p] ??= {};
			at[path[path.length - 1]] = value;
		}
		return json({ format_version: '1.21.80', 'minecraft:lighting_settings': settings });
	}
	const file = object(parse(existing));
	const wrapped = 'minecraft:lighting_settings' in file;
	const root: string[] = wrapped ? ['minecraft:lighting_settings'] : [];
	// older files put the sun and moon straight under directional_lights; newer ones under its `orbital`
	const lights = object(object(wrapped ? file['minecraft:lighting_settings'] : file).directional_lights);
	const flat = !('orbital' in lights) && ('sun' in lights || 'moon' in lights || 'orbital_offset_degrees' in lights);
	const orbital = flat ? ['directional_lights'] : ['directional_lights', 'orbital'];
	return patch(
		existing,
		[...changed].map((k) => {
			const [path, value] = lightingValue(l, k, orbital);
			return [[...root, ...path], value];
		}),
	);
}
