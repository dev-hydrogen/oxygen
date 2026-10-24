import { sanitizeOverrides, type KeyOverrides } from '../lib/keys';
import { CAMERA_MOVES, type CameraMove } from '../lib/camera-moves';
import { DEFAULT_GIZMO_LIMITS, DEFAULT_GIZMOS, GIZMO_LIMIT_CHOICES, type GizmoLimits, type Gizmos } from '../viewport/gizmos';

/** How a new effect starts playing: the preview's own controls change it per effect afterwards */
export type SpawnModeId = 'command' | 'script' | 'entity';
export type RenderMode = 'classic' | 'vv' | 'split';
export type InspectorView = 'categories' | 'phases';

/** Everything the Settings dialog sets, kept by the host between visits */
export interface Preferences {
	// general
	/** ask before closing an effect with unsaved changes */
	confirmClose: boolean;
	/** desktop app: download and install updates by themselves (off: only tell about them) */
	autoUpdate: boolean;
	/** how long status messages stay in the status bar, in seconds */
	noticeSeconds: number;
	/** desktop app: the whole interface's zoom (1 = 100%) */
	zoom: number;
	/** text size in Molang editors and the source view, in px (0: the default, VS Code's editor size in VS Code) */
	codeSize: number;
	inspectorView: InspectorView;

	// a new effect's preview
	spawnMode: SpawnModeId;
	repeat: boolean;
	speed: number;
	/** query.time_of_day for effects that don't save a scene of their own */
	timeOfDay: number;
	renderMode: RenderMode;
	vvSky: boolean;

	// viewport
	/** vertical field of view, degrees */
	fov: number;
	/** orbit and look-around speed (1 = default) */
	turnSpeed: number;
	invertY: boolean;
	/** how far a wheel notch moves (1 = default) */
	zoomSpeed: number;
	/** W A S D flying speed (1 = default) and the factor the fast key multiplies it by */
	flySpeed: number;
	fastFactor: number;
	/** 0 = the screen's own (up to 2×); otherwise this many pixels per CSS pixel, for speed or sharpness */
	resolution: number;
	/** the classic viewport's background, #rrggbb */
	background: string;
	showFps: boolean;
	gizmos: Gizmos;
	/** at most this many of each helper */
	gizmoLimits: GizmoLimits;

	// screenshots and GIFs of the viewport
	/** a screenshot's size, times the viewport's */
	captureScale: number;
	/** no background behind the particles */
	captureTransparent: boolean;
	/** the grid, emitter markers, the entity and other helpers in the picture */
	captureHelpers: boolean;
	/** how long GIFs and videos record; 0: until the effect ends (at most RECORD_LIMIT seconds) */
	gifSeconds: number;
	gifFps: number;
	/** a GIF's longest side, in pixels */
	gifSize: number;
	/** GIFs leave out the background (dithered where particles are translucent); screenshots have their own */
	gifTransparent: boolean;
	/** a video's longest side, in pixels */
	videoSize: number;
	videoFps: number;
	/** the small Oxygen mark in the bottom right of screenshots, GIFs and videos */
	watermark: boolean;
	/** how the camera moves while a GIF or video records */
	recordCamera: CameraMove;

	// keyboard
	keys: KeyOverrides;
}

export const DEFAULT_BACKGROUND = '#161a26';

export const DEFAULT_PREFERENCES: Preferences = {
	confirmClose: true,
	autoUpdate: true,
	noticeSeconds: 3.5,
	zoom: 1,
	codeSize: 0,
	inspectorView: 'categories',
	spawnMode: 'command',
	repeat: true,
	speed: 1,
	timeOfDay: 0.5,
	renderMode: 'classic',
	vvSky: true,
	fov: 70,
	turnSpeed: 1,
	invertY: false,
	zoomSpeed: 1,
	flySpeed: 1,
	fastFactor: 3,
	resolution: 0,
	background: DEFAULT_BACKGROUND,
	showFps: true,
	gizmos: { ...DEFAULT_GIZMOS },
	gizmoLimits: { ...DEFAULT_GIZMO_LIMITS },
	captureScale: 2,
	captureTransparent: true,
	captureHelpers: false,
	gifSeconds: 0,
	gifFps: 25,
	gifSize: 720,
	gifTransparent: false,
	videoSize: 1080,
	videoFps: 60,
	watermark: true,
	recordCamera: 'still',
	keys: {},
};

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2];
export const CAPTURE_SCALES = [1, 2, 3, 4];
export const GIF_RATES = [10, 15, 20, 25, 30, 50];
export const GIF_SIZES = [360, 480, 720, 1080, 1440];
export const VIDEO_RATES = [24, 25, 30, 50, 60];
export const VIDEO_SIZES = [720, 1080, 1440, 2160];
/** the longest a recording runs when it waits for the effect to end */
export const RECORD_LIMIT = 60;
/** how long "until the effect ends" records an effect that repeats forever (Repeat, or looping on an entity) */
export const RECORD_REPEATING = 10;

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

/**
 * Preferences from whatever was stored (older versions, hand edits, imports): unknown keys dropped, values
 * clamped to what the dialog offers, anything missing or broken at its default. `legacy` is the rest of the
 * stored settings, for values kept elsewhere before there was a Settings dialog.
 */
export function readPreferences(stored: unknown, legacy: Record<string, unknown> = {}): Preferences {
	const s = (stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) as Record<string, unknown>;
	const d = DEFAULT_PREFERENCES;
	const savedGizmos = (s.gizmos ?? legacy.gizmos) as Record<string, unknown> | undefined;
	const gizmos = { ...DEFAULT_GIZMOS };
	if (savedGizmos && typeof savedGizmos === 'object') for (const k of Object.keys(gizmos) as (keyof Gizmos)[]) gizmos[k] = bool(savedGizmos[k], gizmos[k]);
	const savedLimits = (s.gizmoLimits ?? {}) as Record<string, unknown>;
	const gizmoLimits = { ...DEFAULT_GIZMO_LIMITS };
	for (const k of Object.keys(gizmoLimits) as (keyof GizmoLimits)[]) if (GIZMO_LIMIT_CHOICES[k].includes(savedLimits[k] as number)) gizmoLimits[k] = savedLimits[k] as number;
	const background = typeof s.background === 'string' && /^#[0-9a-f]{6}$/i.test(s.background) ? s.background.toLowerCase() : d.background;
	return {
		confirmClose: bool(s.confirmClose, d.confirmClose),
		autoUpdate: bool(s.autoUpdate, d.autoUpdate),
		noticeSeconds: num(s.noticeSeconds, 1, 30, d.noticeSeconds),
		zoom: num(s.zoom, 0.5, 2, d.zoom),
		codeSize: s.codeSize === 0 ? 0 : num(s.codeSize, 9, 24, d.codeSize),
		inspectorView: oneOf(s.inspectorView, ['categories', 'phases'], d.inspectorView),
		spawnMode: oneOf(s.spawnMode, ['command', 'script', 'entity'], d.spawnMode),
		repeat: bool(s.repeat, d.repeat),
		speed: SPEEDS.includes(s.speed as number) ? (s.speed as number) : d.speed,
		timeOfDay: num(s.timeOfDay, 0, 1, d.timeOfDay),
		renderMode: oneOf(s.renderMode, ['classic', 'vv', 'split'], d.renderMode),
		vvSky: bool(s.vvSky, d.vvSky),
		fov: num(s.fov, 20, 120, d.fov),
		turnSpeed: num(s.turnSpeed, 0.1, 5, d.turnSpeed),
		invertY: bool(s.invertY, d.invertY),
		zoomSpeed: num(s.zoomSpeed, 0.1, 5, d.zoomSpeed),
		flySpeed: num(s.flySpeed, 0.1, 10, d.flySpeed),
		fastFactor: num(s.fastFactor, 1, 20, d.fastFactor),
		resolution: num(s.resolution, 0, 3, d.resolution),
		background,
		showFps: bool(s.showFps, d.showFps),
		gizmos,
		gizmoLimits,
		captureScale: CAPTURE_SCALES.includes(s.captureScale as number) ? (s.captureScale as number) : d.captureScale,
		captureTransparent: bool(s.captureTransparent, d.captureTransparent),
		captureHelpers: bool(s.captureHelpers, d.captureHelpers),
		gifSeconds: num(s.gifSeconds, 0, RECORD_LIMIT, d.gifSeconds),
		gifFps: GIF_RATES.includes(s.gifFps as number) ? (s.gifFps as number) : d.gifFps,
		gifSize: GIF_SIZES.includes(s.gifSize as number) ? (s.gifSize as number) : d.gifSize,
		gifTransparent: bool(s.gifTransparent, d.gifTransparent),
		videoSize: VIDEO_SIZES.includes(s.videoSize as number) ? (s.videoSize as number) : d.videoSize,
		videoFps: VIDEO_RATES.includes(s.videoFps as number) ? (s.videoFps as number) : d.videoFps,
		watermark: bool(s.watermark, d.watermark),
		recordCamera: CAMERA_MOVES.some((m) => m.id === s.recordCamera) ? (s.recordCamera as CameraMove) : d.recordCamera,
		keys: sanitizeOverrides(s.keys),
	};
}

/** The settings that differ from the defaults (what an export holds, and what "modified" marks) */
export function changedPreferences(p: Preferences): Partial<Preferences> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(p)) {
		const d = (DEFAULT_PREFERENCES as unknown as Record<string, unknown>)[k];
		if (JSON.stringify(v) !== JSON.stringify(d)) out[k] = v;
	}
	if (out.keys && !Object.keys(out.keys as object).length) delete out.keys;
	return out as Partial<Preferences>;
}
