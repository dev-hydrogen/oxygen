import { DEFAULT_GRADING, DEFAULT_LIGHTING, parseGrading, parseLighting } from '@oxygen/scene';
import { describe, expect, it } from 'vitest';
import { fromHex, gradingFile, lightingFile, toHex } from '../src/lib/pack-files';

describe('pack files the Vibrant Visuals panel writes', () => {
	it('sets only the changed keys in a pack’s color grading, keeping the rest as written', () => {
		const pack = [
			'{',
			'  // the pack’s own grade',
			'  "format_version": "1.21.90",',
			'  "minecraft:color_grading_settings": {',
			'    "color_grading": {',
			'      "midtones": { "contrast": [1.3, 1.3, 1.3], "saturation": 1.2 },',
			'      "shadows": { "enabled": true, "shadowsMax": 0.1 }',
			'    },',
			'    "tone_mapping": { "operator": "reinhard" }',
			'  }',
			'}',
			'',
		].join('\n');
		const out = gradingFile({ ...DEFAULT_GRADING, toneMapper: 'aces', gain: [1, 0.9, 0.8] }, pack, ['toneMapper', 'gain']);
		expect(out).toContain('// the pack’s own grade');
		expect(out).toContain('"shadows": { "enabled": true, "shadowsMax": 0.1 }');
		expect(out).toContain('"saturation": 1.2');
		const read = JSON.parse(out.replace(/\/\/.*$/gm, ''));
		expect(read['minecraft:color_grading_settings'].tone_mapping.operator).toBe('aces');
		expect(read['minecraft:color_grading_settings'].color_grading.midtones.gain).toEqual([1, 0.9, 0.8]);
		// nothing changed: the file as it was
		expect(gradingFile(DEFAULT_GRADING, pack, [])).toBe(pack);
	});

	it('writes a new color grading file Oxygen reads back the same', () => {
		const g = { ...DEFAULT_GRADING, toneMapper: 'hable' as const, offset: [0.01, 0, 0] as [number, number, number], gamma: 2.4 };
		const file = JSON.parse(gradingFile(g, null, []));
		expect(file.format_version).toBe('1.21.90');
		expect(parseGrading(file)).toEqual(g);
	});

	it('writes lighting where the pack’s file keeps it: under orbital, or straight under directional_lights', () => {
		const l = { ...DEFAULT_LIGHTING, sunIlluminance: { '0.0': 50000, '0.5': 1 }, moonColor: [1, 0.5, 0] as [number, number, number], emissiveDesaturation: 0.3 };
		const changed = ['sunIlluminance', 'moonColor', 'emissiveDesaturation'] as const;
		const nested = lightingFile(l, '{\n\t"format_version": "1.21.80",\n\t"minecraft:lighting_settings": {\n\t\t"directional_lights": { "orbital": { "sun": { "illuminance": 100 } } },\n\t\t"sky": { "intensity": 0.5 }\n\t}\n}\n', changed);
		const a = JSON.parse(nested)['minecraft:lighting_settings'];
		expect(a.directional_lights.orbital.sun.illuminance).toEqual({ '0.0': 50000, '0.5': 1 });
		expect(a.directional_lights.orbital.moon.color).toBe('#ff8000');
		expect(a.emissive.desaturation).toBe(0.3);
		expect(a.sky).toEqual({ intensity: 0.5 });
		// the older shape, with no wrapper and no orbital
		const flat = JSON.parse(lightingFile(l, '{ "format_version": "1.21.40", "directional_lights": { "sun": { "illuminance": 100 } } }', changed));
		expect(flat.directional_lights.sun.illuminance).toEqual({ '0.0': 50000, '0.5': 1 });
		expect(flat.directional_lights.moon.color).toBe('#ff8000');
		expect(flat.directional_lights.orbital).toBeUndefined();
	});

	it('writes a new lighting file Oxygen reads back the same', () => {
		const l = { ...DEFAULT_LIGHTING, ambientIlluminance: 0.5, orbitalOffsetDegrees: 12 };
		const file = JSON.parse(lightingFile(l, null, []));
		expect(file['minecraft:lighting_settings'].description.identifier).toBe('minecraft:default_lighting');
		const back = parseLighting(file);
		expect(back.ambientIlluminance).toBe(0.5);
		expect(back.orbitalOffsetDegrees).toBe(12);
		expect(back.sunIlluminance).toEqual(DEFAULT_LIGHTING.sunIlluminance);
		// colours go through #rrggbb: the same to a 255th
		const [t, c] = Object.entries(DEFAULT_LIGHTING.sunColor as Record<string, [number, number, number]>)[0];
		expect((back.sunColor as Record<string, [number, number, number]>)[t].map((v) => Math.round(v * 255))).toEqual(c.map((v) => Math.round(v * 255)));
		expect(fromHex(toHex([1, 0.5, 0])).map((v) => Math.round(v * 255))).toEqual([255, 128, 0]);
	});
});
