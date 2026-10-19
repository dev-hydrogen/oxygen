/** What the MCP server asks of the preview page (preview/main.ts) and what it answers. Plain JSON both ways. */

export type Vec3 = [number, number, number];

export type CameraRequest =
	/** frame every particle seen across the sampled times, looking from `angle`; `zoom` > 1 moves closer */
	| { kind: 'auto'; angle: 'iso' | 'front' | 'side' | 'top' | 'bottom'; zoom: number }
	/** a camera bookmark saved in the file's oxygen block */
	| { kind: 'bookmark'; name: string }
	| { kind: 'manual'; position: Vec3; target: Vec3; fov?: number };

export interface RunRequest {
	/** the effect file's text */
	text: string;
	/** display name and absolute path; the page resolves textures and pack files through the server by path */
	file: { name: string; id: string };
	/** every child effect its events reach, as JSON text by identifier */
	effects: Record<string, string>;
	/** the pack's min_engine_version */
	engine: number[] | null;
	/** seconds after the spawn to sample, ascending */
	times: number[];
	/** how the effect is started; null keeps what the file's active scenario says (default /particle) */
	spawn: 'command' | 'script' | 'entity' | null;
	/** Oxygen's Repeat: respawn (or loop in place) when the effect ends; the game plays /particle once */
	repeat: boolean;
	/** draw images (false: statistics only) */
	render: null | {
		width: number;
		height: number;
		mode: 'classic' | 'vv';
		camera: CameraRequest;
		ground: boolean;
		gizmos: boolean;
		/** one labelled contact sheet instead of an image per time */
		sheet: boolean;
	};
	/** query.time_of_day (0 midnight, 0.25 sunrise, 0.5 noon); null keeps the effect's own scene setting */
	timeOfDay: number | null;
	/** what other effects' pre-effects set for this one (variable → their identifiers) */
	parents: Record<string, string>;
	/** other effects playing in the scene, by identifier (their text is in `effects`); null keeps the file's own scene */
	extras: { effect: string; position: Vec3 }[] | null;
	/** the entity it plays on (scene entity settings to change); null keeps the file's own */
	entity: Record<string, unknown> | null;
}

export interface SampleStats {
	/** simulation time of the sample */
	time: number;
	particles: number;
	/** particles the renderer draws (alive, positive size, not culled) */
	visible: number;
	emitters: number;
	/** world-space box around the visible particles */
	bounds: { min: Vec3; max: Vec3 } | null;
	capHit: boolean;
}

export interface RunProblem {
	path: string;
	severity: 'error' | 'warning' | 'info';
	message: string;
	code: string;
	source: string;
}

export interface EmitterSummary {
	effect: string;
	/** how many emitters of this effect ran */
	count: number;
	firstStart: number;
	/** when the last of them ended (null: still running at the last sample) */
	lastEnd: number | null;
	/** events fired by these emitters and their particles: count and first time */
	events: Record<string, { count: number; first: number }>;
}

export interface RunResult {
	identifier: string;
	samples: SampleStats[];
	/** highest live particle count over the run, and when */
	peak: { particles: number; time: number };
	/** set when the effect ended (nothing alive, Repeat off) before the last sample */
	finishedAt: number | null;
	emitters: EmitterSummary[];
	problems: RunProblem[];
	/** texture paths that resolved to nothing: they draw as the magenta-black missing texture */
	missingTextures: string[];
	/** PNG data URLs: one per sample, or a single contact sheet */
	images: string[];
	camera: { position: Vec3; target: Vec3; fov: number } | null;
}

/** The effect and how it plays, without what to sample or draw */
export type SessionRequest = Omit<RunRequest, 'times' | 'render'> & {
	/** what the simulation's camera looks from and at (culling, camera queries, facing); default the editor's */
	camera: { position: Vec3; target: Vec3; fov?: number } | null;
};

export type Phase = 'creation' | 'emitter-update' | 'spawn' | 'particle-update' | 'render' | 'event';

/**
 * A question about the running effect. Every one replays the effect from its spawn on the fixed clock, so `time`
 * picks a frame exactly: the frame that reaches it.
 */
export type InspectQuery =
	| {
			op: 'state';
			time: number;
			particles: { emitter: number | null; effect: string | null; ids: number[] | null; fields: string[] | null; sort: 'id' | 'age' | 'distance' | 'x' | 'y' | 'z' | 'speed'; descending: boolean; limit: number; offset: number; facing: boolean };
			variables: boolean;
	  }
	| { op: 'trace'; time: number; particle: number | 'next' | null; emitter: number | null; frames: number; path: string | null; phase: Phase | null; detail: 'full' | 'brief'; limit: number }
	| { op: 'log'; time: number; frames: number; path: string | null; phase: Phase | null; emitter: number | null; particle: number | null; limit: number; offset: number }
	| { op: 'evaluate'; time: number; expression: string; emitter: number | null; particle: number | null }
	| { op: 'moments'; time: number; expression: string; path: string; when: 'before' | 'after'; effect: string | null; emitter: number | null; particle: number | null; limit: number; parts: boolean }
	| {
			op: 'track';
			from: number;
			to: number;
			every: number;
			particles: number[] | null;
			count: number;
			emitter: number | null;
			attributes: string[];
			path: string | null;
			variables: string[] | null;
	  }
	| { op: 'gif'; from: number; to: number; fps: number; width: number; height: number; mode: 'classic' | 'vv'; camera: CameraRequest; ground: boolean; gizmos: boolean; captions: boolean; previews: number };

export interface InspectRequest extends SessionRequest {
	query: InspectQuery;
}

export interface InspectResult {
	/** the answer, as JSON */
	data: Record<string, unknown>;
	/** base64 GIF, for `gif` */
	gif?: string;
	/** PNG data URLs (a contact sheet of some of the GIF's frames) */
	images?: string[];
	missingTextures: string[];
}

export interface PreviewApi {
	run(request: RunRequest): Promise<RunResult>;
	inspect(request: InspectRequest): Promise<InspectResult>;
}

declare global {
	interface Window {
		oxygenPreview: PreviewApi;
	}
}
