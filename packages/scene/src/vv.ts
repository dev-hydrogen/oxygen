/**
 * Vibrant Visuals approximation: lighting (lighting/global.json) and color grading (color_grading/*.json)
 * read from the pack, with vanilla's (Mojang's bedrock-samples resource pack) as defaults. Calibrated against screenshots
 * where available; everything here is an approximation and the UI says so.
 */

export type RGB = [number, number, number];

/** Keyframes: a constant, or { "<time 0–1>": value } where 0 is noon (sun highest), 0.5 midnight */
export type Keyframes<T> = T | Record<string, T>;

export interface LightingModel {
	sunIlluminance: Keyframes<number>;
	sunColor: Keyframes<RGB>;
	moonIlluminance: Keyframes<number>;
	moonColor: Keyframes<RGB>;
	ambientIlluminance: Keyframes<number>;
	ambientColor: Keyframes<RGB>;
	orbitalOffsetDegrees: number;
	emissiveDesaturation: number;
}

export type ToneMapper = 'aces' | 'hable' | 'reinhard' | 'reinhard_luma' | 'reinhard_luminance' | 'generic';

/**
 * A pack's color_grading.json: the midtones grade (per channel) applied before tone mapping, the tone mapper,
 * and the final gamma encode. Shadows, highlights and temperature aren't modelled.
 */
export interface GradingModel {
	toneMapper: ToneMapper;
	saturation: RGB;
	contrast: RGB;
	gain: RGB;
	offset: RGB;
	/** applied to the final color after grading and tone mapping: display = color^(1/gamma) */
	gamma: number;
}

const WHITE: RGB = [1, 1, 1];
const rgb255 = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255];

/**
 * Vanilla's lighting/global.json (Mojang's bedrock-samples resource pack), the lighting every in-game measurement
 * here was taken with. A pack's own lighting is compared against it.
 */
export const DEFAULT_LIGHTING: LightingModel = {
	sunIlluminance: { '0.0': 100, '0.05': 100, '0.282': 1, '0.2915': 0.01, '0.292': 0, '0.709': 0, '0.719': 1, '0.95': 100, '1.0': 100 },
	sunColor: {
		'0.140811': rgb255(255, 173, 81),
		'0.216944': rgb255(255, 155, 82),
		'0.242908': rgb255(255, 127, 0),
		'0.269504': rgb255(255, 127, 0),
		'0.314561': rgb255(255, 154, 154),
		'0.506998': rgb255(255, 105, 0),
		'0.717949': rgb255(255, 133, 133),
		'0.801062': rgb255(255, 173, 81),
		'1.0': rgb255(255, 227, 215),
	},
	moonIlluminance: { '0.0': 0, '0.2': 0, '0.225': 0.4, '0.735': 0.4, '0.75': 0, '1.0': 0 },
	moonColor: rgb255(163, 182, 255),
	ambientIlluminance: 0.02,
	ambientColor: WHITE,
	orbitalOffsetDegrees: 0,
	emissiveDesaturation: 0,
};

/**
 * The 'generic' tone curve ("hand-tuned by Mojang's artists, keeps a bit more hue saturation at high luminance"),
 * here as Lottes' parametric curve x^a / (x^(a·d)·b + c) through mid grey 0.18 → 0.267. It runs on each colour's
 * brightest channel and scales the colour by the same factor, so a colour keeps its hue as it brightens (a strongly
 * tinted glow compresses like its brightest channel, not like its luminance); only right at the top, by
 * curve^whitening, does it move towards white (the core of an over-bright pink glow turns pale). Fitted in-game at
 * night, after vanilla's grading, to grey emissive alpha ramps, a pink emissive glow from centre to edge and how far
 * the scene darkened under auto exposure (rms 4.3 levels of 255).
 */
export const GENERIC_TONE = { contrast: 0.81, shoulder: 0.977, hdrMax: 201.7, midIn: 0.18, midOut: 0.267, whitening: 24 } as const;

const genericCoefficients = (() => {
	const { contrast: a, shoulder: d, hdrMax: h, midIn: mi, midOut: mo } = GENERIC_TONE;
	const span = (h ** (a * d) - mi ** (a * d)) * mo;
	return { b: (-(mi ** a) + h ** a * mo) / span, c: (h ** (a * d) * mi ** a - h ** a * mi ** (a * d) * mo) / span };
})();

/** b and c of the generic curve, for shaders */
export const GENERIC_TONE_COEFFICIENTS = genericCoefficients;

/** The generic tone curve on one value (display linear, 0–1) */
export function genericTone(x: number): number {
	const { contrast: a, shoulder: d } = GENERIC_TONE;
	const v = Math.max(0, x);
	return Math.min(1, v ** a / (v ** (a * d) * genericCoefficients.b + genericCoefficients.c));
}

/** Vanilla's color_grading.json */
export const DEFAULT_GRADING: GradingModel = { toneMapper: 'generic', saturation: [1.05, 1.05, 1.05], contrast: [1.15, 1.15, 1.15], gain: [1, 1, 1], offset: [0, 0, 0], gamma: 2.2 };

/** A color_grading.json with nothing set: no grading, the generic tone mapper, gamma 2.2 */
const NEUTRAL_GRADING: GradingModel = { toneMapper: 'generic', saturation: [1, 1, 1], contrast: [1, 1, 1], gain: [1, 1, 1], offset: [0, 0, 0], gamma: 2.2 };

const luminance = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Tone mappers on linear HDR, as Oxygen's output pass runs them (three.js's formulas for aces and hable) */
export function toneMap(c: RGB, op: ToneMapper): RGB {
	switch (op) {
		case 'generic': {
			const m = Math.max(...c);
			if (m <= 1e-9) return [0, 0, 0];
			const t = genericTone(m);
			const w = Math.pow(t, GENERIC_TONE.whitening);
			return c.map((v) => {
				const o = Math.max(0, v) * (t / m);
				return o + (t - o) * w;
			}) as RGB;
		}
		case 'reinhard':
			return c.map((v) => clamp01(v / (1 + v))) as RGB;
		case 'reinhard_luma':
		case 'reinhard_luminance': {
			// Reinhard on luminance: colours keep their hue as they brighten
			const l = luminance(c);
			const k = l > 1e-9 ? 1 / (1 + l) : 0;
			return c.map((v) => clamp01(v * k)) as RGB;
		}
		case 'hable':
			return c.map((x) => ((y) => Math.pow((y * (6.2 * y + 0.5)) / (y * (6.2 * y + 1.7) + 0.06), 2.2))(Math.max(0, x - 0.004))) as RGB;
		case 'aces': {
			const m = (a: number[], v: RGB): RGB => [a[0] * v[0] + a[3] * v[1] + a[6] * v[2], a[1] * v[0] + a[4] * v[1] + a[7] * v[2], a[2] * v[0] + a[5] * v[1] + a[8] * v[2]];
			const IN = [0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
			const OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
			const v = m(IN, c.map((x) => x / 0.6) as RGB).map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081)) as RGB;
			return m(OUT, v).map(clamp01) as RGB;
		}
	}
}

/**
 * What the game puts on screen for a linear HDR colour (already exposed): the midtones grade (saturation, then
 * contrast around mid grey, gain and offset), the tone mapper, then the gamma encode. 0–1 display values.
 */
export function displayTransform(c: RGB, g: GradingModel): RGB {
	const l = luminance(c);
	const sat = c.map((x, i) => l + (x - l) * g.saturation[i]) as RGB;
	const graded = sat.map((x, i) => 0.18 * Math.pow(Math.max(x, 0) / 0.18, g.contrast[i]) * g.gain[i] + g.offset[i]) as RGB;
	return toneMap(graded, g.toneMapper).map((x) => Math.pow(clamp01(x), 1 / g.gamma)) as RGB;
}

function parseColor(v: unknown): RGB | null {
	if (typeof v === 'string') {
		const h = v.replace('#', '');
		if (/^[0-9a-f]{8}$/i.test(h)) return [parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, parseInt(h.slice(6, 8), 16) / 255];
		if (/^[0-9a-f]{6}$/i.test(h)) return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
		return null;
	}
	if (Array.isArray(v) && v.length >= 3) {
		const n = v.map(Number);
		const scale = n.some((x) => x > 1) ? 1 / 255 : 1;
		return [n[0] * scale, n[1] * scale, n[2] * scale];
	}
	return null;
}

function keyframes<T>(raw: unknown, parse: (v: unknown) => T | null, fallback: Keyframes<T>): Keyframes<T> {
	if (raw === undefined || raw === null) return fallback;
	const direct = parse(raw);
	if (direct !== null) return direct;
	if (typeof raw === 'object' && !Array.isArray(raw)) {
		const out: Record<string, T> = {};
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			const p = parse(v);
			if (p !== null && !Number.isNaN(parseFloat(k))) out[k] = p;
		}
		if (Object.keys(out).length) return out;
	}
	return fallback;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Read a lighting/global.json (any format_version that uses `minecraft:lighting_settings` or top-level keys) */
export function parseLighting(json: unknown): LightingModel {
	const root = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
	const s = ((root['minecraft:lighting_settings'] as Record<string, unknown>) ?? root) as Record<string, any>;
	const dl = s.directional_lights ?? {};
	const orb = dl.orbital ?? dl;
	const d = DEFAULT_LIGHTING;
	return {
		sunIlluminance: keyframes(orb.sun?.illuminance, num, d.sunIlluminance),
		sunColor: keyframes(orb.sun?.color, parseColor, d.sunColor),
		moonIlluminance: keyframes(orb.moon?.illuminance, num, d.moonIlluminance),
		moonColor: keyframes(orb.moon?.color, parseColor, d.moonColor),
		ambientIlluminance: keyframes(s.ambient?.illuminance, num, d.ambientIlluminance),
		ambientColor: keyframes(s.ambient?.color, parseColor, d.ambientColor),
		orbitalOffsetDegrees: num(orb.orbital_offset_degrees) ?? num(dl.orbital_offset_degrees) ?? d.orbitalOffsetDegrees,
		emissiveDesaturation: num(s.emissive?.desaturation) ?? d.emissiveDesaturation,
	};
}

export function parseGrading(json: unknown): GradingModel {
	const root = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
	const s = root['minecraft:color_grading_settings'] ?? root;
	const op = s.tone_mapping?.operator;
	const known: ToneMapper[] = ['aces', 'hable', 'reinhard', 'reinhard_luma', 'reinhard_luminance', 'generic'];
	const mid = s.color_grading?.midtones ?? {};
	const vec = (v: unknown, fallback: RGB): RGB =>
		Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number') ? [v[0], v[1], v[2]] : typeof v === 'number' ? [v, v, v] : fallback;
	const n = NEUTRAL_GRADING;
	const gamma = vec(mid.gamma, [n.gamma, n.gamma, n.gamma]);
	return {
		toneMapper: known.includes(op as ToneMapper) ? (op as ToneMapper) : n.toneMapper,
		saturation: vec(mid.saturation, n.saturation),
		contrast: vec(mid.contrast, n.contrast),
		gain: vec(mid.gain, n.gain),
		offset: vec(mid.offset, n.offset),
		gamma: (gamma[0] + gamma[1] + gamma[2]) / 3 || n.gamma,
	};
}

/** Evaluate keyframes at lighting time t (0 = noon) with linear interpolation, wrapping around */
export function sample<T extends number | RGB>(kf: Keyframes<T>, t: number): T {
	if (typeof kf === 'number' || Array.isArray(kf)) return kf as T;
	const keys = Object.keys(kf)
		.map((k) => ({ t: parseFloat(k), v: kf[k] }))
		.sort((a, b) => a.t - b.t);
	if (!keys.length) return 0 as T;
	const x = ((t % 1) + 1) % 1;
	let i = keys.findIndex((k) => k.t > x);
	if (i === -1) i = keys.length;
	const a = keys[(i - 1 + keys.length) % keys.length];
	const b = keys[i % keys.length];
	const span = ((b.t - a.t + 1) % 1) || 1;
	const f = (((x - a.t + 1) % 1) / span) || 0;
	const lerp = (p: number, q: number) => p + (q - p) * f;
	if (typeof a.v === 'number') return lerp(a.v, b.v as number) as T;
	const av = a.v as RGB, bv = b.v as RGB;
	return [lerp(av[0], bv[0]), lerp(av[1], bv[1]), lerp(av[2], bv[2])] as T;
}

export interface LightState {
	/** world-space direction towards the sun (or moon at night) */
	direction: RGB;
	/** directional light radiance contribution (lux) */
	directional: RGB;
	/** ambient (lux) */
	ambient: RGB;
	/** exposure that maps a white diffuse surface in this light to mid grey (auto exposure) */
	exposure: number;
}

/** Light at a query time of day (query.time_of_day: midnight 0, sunrise 0.25, noon 0.5) */
export function lightAt(m: LightingModel, timeOfDay: number): LightState {
	const t = timeOfDay - 0.5; // lighting keyframes count from noon
	const angle = t * Math.PI * 2;
	const sunUp: RGB = [Math.sin(angle), Math.cos(angle), Math.sin((m.orbitalOffsetDegrees * Math.PI) / 180)];
	const sunE = sample(m.sunIlluminance, t);
	const moonE = sample(m.moonIlluminance, t);
	const day = sunUp[1] > -0.05;
	const sc = day ? sample(m.sunColor, t) : sample(m.moonColor, t);
	const e = day ? sunE : moonE;
	const dir: RGB = day ? sunUp : [-sunUp[0], -sunUp[1], -sunUp[2]];
	const len = Math.hypot(...dir) || 1;
	const ac = sample(m.ambientColor, t);
	const ae = sample(m.ambientIlluminance, t);
	const total = e * Math.max(0, dir[1] / len) + ae;
	// white diffuse radiance L = E / π; aim it at ~0.5 before tone mapping
	const exposure = 0.5 / Math.max(1e-4, total / Math.PI);
	return {
		direction: [dir[0] / len, dir[1] / len, dir[2] / len],
		directional: [sc[0] * e, sc[1] * e, sc[2] * e],
		ambient: [ac[0] * ae, ac[1] * ae, ac[2] * ae],
		exposure,
	};
}

// ---- particle light measured in-game (Oxygen test pack t65, 1.26.52, vanilla lighting, 'Performance' preset)

/**
 * What Vibrant Visuals does to a particle, fitted to screenshots of flat grey probes (64, 128, 255) and an
 * emissive one, for Oxygen's pipeline: hdr = albedo × light + haze (+ albedo × MERS emissive × emissive), then
 * vanilla's grading, the generic tone curve and its gamma encode (tools/vv-fit.py --times). Lit and unlit particles
 * look the same. `sky` is the background near the horizon as displayed. Fits are within 1.3 to 9.5 levels of 255 (sunset is the hardest). These are for the settled scene: auto exposure darkens it when something bright is in view.
 *
 * Emissive light grows linearly with the MERS emissive channel and is weighted by alpha like any other light;
 * it is just very strong (at night an emissive of 255 is about 40× a white diffuse surface), so a translucent
 * texel shows as almost fully bright once its alpha passes a few percent, and soft alpha edges turn into the
 * texture's pixel steps. The night strength comes from emissive alpha ramps (the t65 probe saturates at night).
 */
export interface ParticleLight {
	light: RGB;
	haze: RGB;
	emissive: number;
	/** the sky behind particles near the horizon as the game displays it (0–1, gamma encoded) */
	sky: RGB;
}

/**
 * Emissive strength at midnight, from emissive alpha ramps in-game rendered end to end (tools/vv-probe-calibrate.mjs,
 * with bloom and auto exposure). The t65 probe, saturated at night, only bounds it: at least 169.
 */
const NIGHT_EMISSIVE = 156;

/** Additive particles in-game are lit this much brighter than others of the same colour (all four times fit, rms 4.5) */
export const MEASURED_ADDITIVE_GAIN = 4.3;

/** by query.time_of_day: midnight 0, sunrise 0.25, noon 0.5, sunset 0.75 */
export const MEASURED_PARTICLE_LIGHT: Record<string, ParticleLight> = {
	'0': { light: [0.0364, 0.0445, 0.0654], haze: [0.0006, 0.0007, 0.0007], emissive: NIGHT_EMISSIVE, sky: rgb255(45, 44, 46) },
	'0.25': { light: [0.1299, 0.1669, 0.2511], haze: [0.0009, 0.0001, 0.0005], emissive: 26.598, sky: rgb255(66, 74, 95) },
	'0.5': { light: [0.8785, 1.1181, 1.7594], haze: [0.0299, 0.0316, 0.0367], emissive: 17.442, sky: rgb255(174, 187, 224) },
	'0.75': { light: [0.2585, 0.2638, 0.3369], haze: [0.0049, 0.0033, 0.0053], emissive: 11.047, sky: rgb255(134, 119, 135) },
};

/** The measured particle light at a time of day, interpolated between the measured times (wrapping) */
export function measuredParticleLight(timeOfDay: number): ParticleLight {
	const at = <K extends keyof ParticleLight>(k: K) => Object.fromEntries(Object.entries(MEASURED_PARTICLE_LIGHT).map(([t, v]) => [t, v[k]])) as Record<string, ParticleLight[K]>;
	return {
		light: sample(at('light'), timeOfDay),
		haze: sample(at('haze'), timeOfDay),
		emissive: sample(at('emissive'), timeOfDay),
		sky: sample(at('sky'), timeOfDay),
	};
}

/**
 * Particle light for a pack: the measured vanilla values, scaled per channel by how the pack's own
 * lighting/global.json differs from the default at that time (so a warmer or dimmer pack reads warmer or dimmer).
 */
export function particleLight(lighting: LightingModel, timeOfDay: number, fromPack: boolean): ParticleLight {
	const m = measuredParticleLight(timeOfDay);
	if (!fromPack) return m;
	const total = (l: LightState): RGB => {
		const f = 0.35 + 0.65 * Math.max(0, l.direction[1]);
		return [0, 1, 2].map((i) => (l.directional[i] * f + l.ambient[i]) * (l.exposure / Math.PI)) as RGB;
	};
	const a = total(lightAt(lighting, timeOfDay));
	const b = total(lightAt(DEFAULT_LIGHTING, timeOfDay));
	const r = [0, 1, 2].map((i) => (b[i] > 1e-6 ? a[i] / b[i] : 1)) as RGB;
	const mul = (v: RGB): RGB => [v[0] * r[0], v[1] * r[1], v[2] * r[2]];
	return { light: mul(m.light), haze: mul(m.haze), emissive: m.emissive, sky: m.sky };
}

// ---- auto exposure (measured in-game: 1.26.52, 'Visuals' preset, midnight, emissive walls of 0.8 to 24 % of the
// screen appearing and vanishing in front of the camera; recorded at 60 fps and fitted, rms 0.17 in log exposure)

/**
 * Vibrant Visuals meters what's on screen. Each pixel's luminance, relative to the scene's own, is softly clamped
 * at `knee` (an emissive wall 300× brighter than the night meters only about half as much as one 2,500× brighter),
 * and averaged. The average follows the frames through a low-pass filter, slowly while it rises and quickly while
 * it falls; exposure is a power of it, never more than the settled scene's and never below `floor` of it.
 *
 * What that looks like: an emissive particle in view at night darkens everything else within half a second (a
 * wall covering 1 % of the screen took exposure to 0.26×, 3 % to 0.2×, 8 % and more to the 0.17× floor). When it
 * goes, exposure holds for about a second while the meter's average falls back, then recovers over about 3 s.
 */
export const AUTO_EXPOSURE = {
	/**
	 * What the meter counts as 1, as a multiple of the luminance of the sky behind particles: the scene in view
	 * averages brighter than the horizon sky (in the measurement, a lit ground filled the lower half)
	 */
	reference: 1.72,
	knee: 760,
	power: 0.9,
	floor: 0.173,
	/** time constants of the metered average (s) */
	rise: 3.8,
	fall: 0.665,
} as const;

/** One pixel's contribution to the meter: its luminance relative to the scene's own, softly clamped */
export function meterWeight(relativeLuminance: number): number {
	const r = Math.max(0, relativeLuminance);
	return r / (1 + r / AUTO_EXPOSURE.knee);
}

/** Exposure (relative to the settled scene's) for a metered average */
export function exposureFor(meter: number): number {
	return Math.min(1, Math.max(AUTO_EXPOSURE.floor, Math.pow(Math.max(meter, 1e-6), -AUTO_EXPOSURE.power)));
}

/** The game's eye adaptation: feed it each drawn frame's metered average and the time since the last one */
export class AutoExposure {
	/** the filtered metered average; 1 is the scene with nothing bright in view */
	meter = 1;

	get exposure(): number {
		return exposureFor(this.meter);
	}

	/** Adapt over `dt` seconds towards a frame that meters `frame` */
	step(frame: number, dt: number): number {
		if (dt > 0) {
			const tau = frame > this.meter ? AUTO_EXPOSURE.rise : AUTO_EXPOSURE.fall;
			this.meter += (frame - this.meter) * (1 - Math.exp(-dt / tau));
		}
		return this.exposure;
	}

	/** Jump to what a frame settles at (pictures of a single moment) */
	settle(frame: number): number {
		this.meter = frame;
		return this.exposure;
	}

	reset(): void {
		this.meter = 1;
	}
}

// ---- texture sets (textures/particle/foo.texture_set.json)

export interface TextureSet {
	color: string | number[] | null;
	/** metalness_emissive_roughness or metalness_emissive_roughness_subsurface: texture name or uniform values */
	mers: string | number[] | null;
	normal: string | null;
	heightmap: string | null;
	formatVersion: string;
}

export function parseTextureSet(json: unknown): TextureSet | null {
	const root = (json && typeof json === 'object' ? json : null) as Record<string, any> | null;
	const s = root?.['minecraft:texture_set'];
	if (!s) return null;
	const val = (v: unknown) => (typeof v === 'string' || Array.isArray(v) ? (v as string | number[]) : null);
	return {
		color: val(s.color),
		mers: val(s.metalness_emissive_roughness_subsurface ?? s.metalness_emissive_roughness),
		normal: typeof s.normal === 'string' ? s.normal : null,
		heightmap: typeof s.heightmap === 'string' ? s.heightmap : null,
		formatVersion: String(root?.format_version ?? '1.21.30'),
	};
}

export function writeTextureSet(set: TextureSet): object {
	const s: Record<string, unknown> = {};
	if (set.color !== null) s.color = set.color;
	if (set.mers !== null) {
		const key = (Array.isArray(set.mers) ? set.mers.length === 4 : true) ? 'metalness_emissive_roughness_subsurface' : 'metalness_emissive_roughness';
		s[key] = set.mers;
	}
	if (set.normal) s.normal = set.normal;
	else if (set.heightmap) s.heightmap = set.heightmap;
	return { format_version: set.formatVersion, 'minecraft:texture_set': s };
}

/**
 * Generate MERS pixels from a color texture: metalness 0, emissive from brightness above a threshold,
 * constant roughness, no subsurface. Alpha follows the color texture.
 */
export function generateMers(rgba: ArrayLike<number>, opts: { threshold: number; strength: number; roughness: number }): Uint8ClampedArray<ArrayBuffer> {
	const out = new Uint8ClampedArray(new ArrayBuffer(rgba.length));
	for (let i = 0; i < rgba.length; i += 4) {
		const l = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
		const e = l <= opts.threshold ? 0 : Math.min(1, ((l - opts.threshold) / Math.max(1e-3, 1 - opts.threshold)) * opts.strength);
		out[i] = 0;
		out[i + 1] = Math.round(e * 255);
		out[i + 2] = Math.round(opts.roughness * 255);
		out[i + 3] = rgba[i + 3];
	}
	return out;
}
