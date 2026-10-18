import { analyzeEffect, type EffectAnalysis, type Problem } from '@oxygen/effect';
import { TimelineRecorder } from './timeline';
import { JsonDocument, readMeta, validateEffect, type DocumentChange, type OxygenMeta, type Scenario } from '@oxygen/format';
import { queryExists } from '@oxygen/metadata';
import { ParticleWorld, type EffectDefinition, type EmitterInstance, type LogEntry, type SpawnContext, type TraceRecord, type WorldSnapshot } from 'wintersky';
import type { FileRef } from '../host';
import { PreviewQueries } from '../lib/queries';
import type { Value } from 'molangjs';
import { PARALLEL_THRESHOLD, ParallelSim, type RemoteEmitter } from '../sim/parallel';
import { applyPinned, scenarioQuery, scenarioVariables, type InputScene } from '../lib/inputs';
import { BlockWorld, DEFAULT_ENTITY, DEFAULT_GRADING, DEFAULT_LIGHTING, EntityDummy, type EntitySettings, type GradingModel, type LightingModel, type TextureSet } from '@oxygen/scene';
import { writeMeta } from '@oxygen/format';

export interface SceneSettings {
	ground: 'plane' | 'none';
	/** height of the flat ground's surface */
	groundY?: number;
	entity: EntitySettings;
	/** classic lighting: 0–15 */
	skyLight: number;
	blockLight: number;
	/** saved into the file's oxygen block when on */
	keepInFile: boolean;
	/**
	 * Other effects playing in the same scene. They share this world, so temps, caps and global queries
	 * interact the way they do in-game.
	 */
	extras?: { effect: string; position: [number, number, number] }[];
}

export const DEFAULT_SCENE: SceneSettings = { ground: 'plane', entity: DEFAULT_ENTITY, skyLight: 15, blockLight: 0, keepInFile: false };

export type SpawnMode = 'command' | 'script' | 'entity';

export const SPAWN_MODES: { id: SpawnMode; label: string; help: string }[] = [
	{ id: 'command', label: '/particle', help: 'Spawned by a command: one loop, 1000 live particles' },
	{ id: 'script', label: 'Script API', help: 'spawnParticle with a variable map: one loop, 1000 live particles' },
	{ id: 'entity', label: 'Entity', help: 'Attached to an entity: loops, 10,000 live particles' },
];

let nextId = 1;

export interface PreviewStats {
	particles: number;
	emitters: number;
	cap: number;
	time: number;
	capHit: boolean;
	/** threads simulating (1 = just this one) */
	threads?: number;
}

/**
 * One open particle file: its text document, the compiled definition, the analysis and a live simulation.
 * The document is the source of truth; everything else is derived from it after each change.
 */
/** components read once, when the emitter starts (or fires its burst): edits show on a fresh start */
const READ_AT_START = /^minecraft:emitter_(initialization|lifetime_(once|looping|expression)|rate_(instant|manual)|local_space)$/;
/** how far back the preview can be scrubbed, and how often it keeps a snapshot to replay from (seconds) */
const HISTORY_SECONDS = 30;
const HISTORY_STEP = 0.1;
/** components read when a particle is created: with a burst nothing new is created, so edits need a fresh start */
const READ_AT_CREATION = /^minecraft:(emitter_shape_\w+|particle_initial_(speed|spin)|particle_lifetime_expression)$/;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether an edit only shows after the effect starts over. Appearance, motion, curves and the like are read
 * every frame, so those edits run in place (EffectSession.hotSwap).
 */
export function editNeedsRestart(before: unknown, after: unknown): boolean {
	type Json = Record<string, unknown> | undefined;
	const a = (before ?? {}) as Record<string, unknown>;
	const b = (after ?? {}) as Record<string, unknown>;
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
		if (k === 'particle_effect') continue;
		if (k === 'oxygen') {
			// saved camera views don't touch the simulation; scenarios and the scene do
			const { cameras: _a, ...ma } = (a[k] ?? {}) as Record<string, unknown>;
			const { cameras: _b, ...mb } = (b[k] ?? {}) as Record<string, unknown>;
			if (!same(ma, mb)) return true;
		} else if (!same(a[k], b[k])) return true;
	}
	const pa = (a.particle_effect ?? {}) as Record<string, Json>;
	const pb = (b.particle_effect ?? {}) as Record<string, Json>;
	if (pa.description?.identifier !== pb.description?.identifier) return true;
	// events fire again from the start (creation events have already run)
	if (!same(pa.events, pb.events)) return true;
	const ca = (pa.components ?? {}) as Record<string, unknown>;
	const cb = (pb.components ?? {}) as Record<string, unknown>;
	const burst = 'minecraft:emitter_rate_instant' in cb || 'minecraft:emitter_rate_manual' in cb;
	for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
		if (same(ca[k], cb[k])) continue;
		if (READ_AT_START.test(k)) return true;
		if (burst && READ_AT_CREATION.test(k)) return true;
	}
	return false;
}

export class EffectSession {
	readonly id = `fx${nextId++}`;
	file = $state<FileRef>({ name: 'untitled.particle.json', id: null });
	readonly doc: JsonDocument;
	/** bumps on every document change (drives derived UI) */
	version = $state(0);
	/** text as last saved (or opened); dirty compares against it, so undoing back clears the dot */
	savedText = $state('');
	def = $state.raw<EffectDefinition>(null!);
	analysis = $state.raw<EffectAnalysis>(null!);
	meta = $state.raw<OxygenMeta>({ version: 1 });
	staticProblems = $state.raw<Problem[]>([]);
	runtimeProblems = $state.raw<Problem[]>([]);
	/** what the game's content log said about this file */
	gameProblems = $state.raw<Problem[]>([]);
	/** selected field or component path */
	selected = $state<string | null>(null);
	/** a variable the user asked to rename (F2, Context panel); the shell shows the rename dialog */
	renameRequest = $state<string | null>(null);
	/** Shift+F12 on a variable: the Expression panel lists everything that uses it */
	referencesRequest = $state<{ name: string; at: number } | null>(null);
	/** filter of the Expression panel's whole-effect view */
	programFilter = $state('');
	/** where cards were dragged in the Events graph, as offsets from the automatic layout (this session only) */
	eventLayout = $state<Record<string, { dx: number; dy: number }>>({});

	// preview
	readonly world: ParticleWorld;
	playing = $state(true);
	/** the effect ran to its end (nothing left alive) with Repeat off: playback stopped there, and Play replays it */
	finished = $state(false);
	speed = $state(1);
	/** Re-trigger the effect when its emitter ends (old particles keep living, #91) */
	private _loopPreview = $state(true);
	/**
	 * Repeat: looping effects loop in place the way they do on an entity (seamlessly, even for /particle, which plays
	 * one loop in-game); other effects spawn again once they end. Changing it restarts the preview.
	 */
	get loopPreview(): boolean {
		return this._loopPreview;
	}
	set loopPreview(on: boolean) {
		if (on === this._loopPreview) return;
		this._loopPreview = on;
		this.restart();
	}
	spawnMode = $state<SpawnMode>('command');
	stats = $state<PreviewStats>({ particles: 0, emitters: 0, cap: 1000, time: 0, capHit: false });
	/** Scene time of day for query.time_of_day (midnight 0, sunrise 0.25, noon 0.5) */
	timeOfDay = $state(0.5);
	scene = $state<SceneSettings>({ ...DEFAULT_SCENE });
	/** blocks of the preview world (not reactive; `blocksVersion` bumps on change) */
	readonly blocks = new BlockWorld();
	blocksVersion = $state(0);
	readonly entity = new EntityDummy(DEFAULT_ENTITY);
	// Vibrant Visuals inputs read from the pack (defaults when the pack has none)
	vvLighting = $state.raw<LightingModel>(DEFAULT_LIGHTING);
	vvGrading = $state.raw<GradingModel>(DEFAULT_GRADING);
	textureSet = $state.raw<TextureSet | null>(null);
	/** a glow map made in the Vibrant Visuals panel and previewed before it's saved: the texture set names it */
	glowDraft = $state.raw<{ name: string; url: string; blob: Blob } | null>(null);
	/** the texture set (or glow map) changed in the panel and isn't in the pack yet */
	textureSetUnsaved = $state(false);
	/** which VV inputs came from the pack; `pbr`: its manifest opts into Vibrant Visuals (null: no manifest found) */
	vvFromPack = $state<{ lighting: boolean; grading: boolean; textureSet: boolean; pbr: boolean | null }>({ lighting: false, grading: false, textureSet: false, pbr: null });
	/** Texture being painted: shown in the preview instead of the file until saved */
	textureOverride = $state<{ path: string; url: string } | null>(null);
	/** placing blocks with clicks in the viewport */
	painting = $state<string | null>(null);
	private lastDt = 1 / 60;
	readonly queries: PreviewQueries;
	/** the active scenario, cached for the simulation's hot paths */
	private activeScenario: Scenario | null = null;
	/** query names the active scenario sets (by name or call): others skip the lookup entirely */
	private scenarioQueryNames = new Set<string>();
	private sceneCache: { world: ParticleWorld | null; frame: number; scene: InputScene } = { world: null, frame: -1, scene: null! };

	// debugger
	/** Particle under inspection (stable ids) */
	selection = $state<{ emitter: number; particle: number } | null>(null);
	/** Evaluations of the selected particle (and its emitter) in the last frame, in order */
	traces = $state.raw<TraceRecord[]>([]);
	/** Record every evaluation of the last frame */
	logging = $state(false);
	log = $state.raw<LogEntry[]>([]);
	/** Where evaluation stepping stopped inside a frame (null when between frames) */
	halt = $state.raw<{ phase: string; path: string; emitter: number; particle: number; step: number } | null>(null);
	debugVersion = $state(0);
	private frameStart: WorldSnapshot | null = null;
	/** particle count, emitter lives and fired events over time (Timeline panel) */
	readonly timeline = new TimelineRecorder();
	/** bumped when the timeline has news worth redrawing (a few times a second while playing) */
	timelineVersion = $state(0);

	/** rolling history for scrubbing: a snapshot every few frames, oldest first */
	private history: { time: number; snap: WorldSnapshot; dts: number[] }[] = [];
	/** simulation time since the last history snapshot */
	private historySince = 0;
	/** where scrubbing left the world (history entry, frames replayed); playing on from there forks history */
	private scrubAt: { index: number; frames: number } | null = null;
	/** span that can be scrubbed (seconds of simulation time) */
	historyRange = $state<{ from: number; to: number }>({ from: 0, to: 0 });
	private evalStep = 0;
	private publishTimer = 0;
	/** the spawned effect's own emitter (it may be running in a worker: see `rootEmitter`) */
	private rootId: number | null = null;
	/** heavy scenes spread independent emitter trees over worker threads */
	readonly parallel: ParallelSim;
	private sinceSpawn = 0;
	/** the root emitter's loop length, remembered for when it's gone from the world */
	private rootPeriod = 0;
	private statsTimer = 0;
	private unsubscribe: () => void;
	readonly engine: string | readonly number[] | null;
	/** Show where sample particles travel over their lifetime (3D trajectory ghosts) */
	showPaths = $state(false);
	/** Draw each particle's real axes and the direction they were built from */
	showFacing = $state(false);
	/** Outline where particles spawn (emitter shapes) */
	showShape = $state(true);
	/** Draw particle velocities */
	showVelocity = $state(false);

	/** child effect JSON by identifier, supplied by the workspace */
	private findChild: (id: string) => unknown | null;
	private childDefs = new Map<string, EffectDefinition | null>();

	constructor(text: string, file: FileRef, options: { engine?: string | readonly number[] | null; findChild?: (id: string) => unknown | null } = {}) {
		this.findChild = options.findChild ?? (() => null);
		this.file = file;
		this.doc = new JsonDocument(text);
		this.savedText = text;
		this.engine = options.engine ?? null;
		this.world = new ParticleWorld({ engine: this.engine, queryExists, seed: 0x0ae1 });
		this.world.resolveEffect = (id) => this.resolveChild(id);
		this.queries = new PreviewQueries({
			override: (name, args, world) => (this.scenarioQueryNames.has(name) ? scenarioQuery(this.activeScenario, name, args, this.inputScene(world)) : undefined),
			timeOfDay: () => this.timeOfDay,
			lastDelta: () => this.lastDt,
			entity: () => (this.spawnMode === 'entity' ? this.entity : null),
		});
		this.world.queries = this.queries;
		this.world.beforeUpdate = (w) => this.applyPinned(w);
		this.timeline.attach(this.world);
		this.parallel = new ParallelSim({
			world: this.world,
			setup: () => ({
				engine: this.engine,
				seed: 0x0ae1,
				caps: this.world.options.particleCap as Record<SpawnContext, number>,
				effects: this.effectJsonClosure(),
				blocks: this.blocks.size ? (this.blocks.toJSON() as { palette: unknown[]; blocks: number[] }) : null,
				planes: this.world.planes,
				scenario: this.activeScenario ? $state.snapshot(this.activeScenario) : null,
				aabb: this.spawnMode === 'entity' ? (this.entity.attachment(this.scene.entity.locator).aabb ?? null) : null,
			}),
			definition: (id) => (id === this.def?.identifier ? this.def : this.resolveChild(id)),
			attachment: () => (this.spawnMode === 'entity' ? this.entity.attachment(this.scene.entity.locator) : null),
			frameInputs: (dt) => {
				const c = this.world.camera;
				const onEntity = this.spawnMode === 'entity';
				const t = onEntity ? this.entity.attachment(this.scene.entity.locator).getTransform() : null;
				return {
					dt,
					camera: { ...c, position: [...c.position], forward: [...c.forward], up: [...c.up], right: [...c.right] },
					cull: this.world.cullEmitters,
					timeOfDay: this.timeOfDay,
					entity: onEntity ? { position: [...this.entity.position], velocity: [...this.entity.velocity], yaw: this.entity.yaw } : null,
					attachment: t ? { position: [...t.position], rotation: [...t.rotation], velocity: [...t.velocity] } : null,
				};
			},
			contentErrors: (errors) => {
				for (const e of errors) this.world.errors.set(`${e.code}|${e.path}|${e.node}`, e);
			},
			failed: () => this.restart(),
		});
		this.unsubscribe = this.doc.onChange((c) => this.onChange(c));
		this.loadScene();
		this.rebuild();
		// the active scenario can say how it's spawned (an effect made for an entity opens on the entity)
		const spawn = this.scenario?.spawn;
		if (spawn && spawn !== this.spawnMode && SPAWN_MODES.some((m) => m.id === spawn)) {
			this.spawnMode = spawn;
			this.rebuild();
		}
		this.applyScene();
		this.restart();
	}

	/** The spawned effect's own emitter, wherever it runs */
	get rootEmitter(): EmitterInstance | RemoteEmitter | null {
		const id = this.rootId;
		if (id === null) return null;
		return this.world.emitters.find((e) => e.id === id) ?? this.parallel.remote.get(id) ?? null;
	}

	/** Every effect a worker might need, as JSON by identifier: this one and every child its events reach */
	private effectJsonClosure(): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		if (this.def) out[this.def.identifier] = this.doc.value;
		const queue = [...this.childIds(), ...(this.scene.extras ?? []).map((x) => x.effect)];
		const walk = (n: import('wintersky').EventNode, into: string[]) => {
			if (n.particleEffect?.effect) into.push(n.particleEffect.effect);
			n.sequence?.forEach((x) => walk(x, into));
			n.randomize?.forEach((r) => walk(r.node, into));
		};
		while (queue.length) {
			const id = queue.shift()!;
			if (id in out) continue;
			const json = this.findChild(id);
			if (!json) continue;
			out[id] = json;
			const def = this.resolveChild(id);
			for (const e of def?.events.values() ?? []) walk(e, queue);
		}
		return out;
	}

	/** Child effects compile into this session's world (definitions are bound to its symbol table) */
	private resolveChild(id: string): EffectDefinition | null {
		if (id === this.def?.identifier) return this.def;
		if (this.childDefs.has(id)) return this.childDefs.get(id)!;
		const json = this.findChild(id);
		const def = json ? this.world.loadEffect(json, this.engine) : null;
		if (def) this.childDefs.set(id, def);
		return def;
	}

	/** A child effect's definition (compiled in this session's world), or null when it can't be found */
	childDefinition(id: string): EffectDefinition | null {
		return this.resolveChild(id);
	}

	/** Identifiers of effects spawned by this effect's events */
	childIds(): string[] {
		const out = new Set<string>();
		const walk = (n: import('wintersky').EventNode) => {
			if (n.particleEffect?.effect) out.add(n.particleEffect.effect);
			n.sequence?.forEach(walk);
			n.randomize?.forEach((r) => walk(r.node));
		};
		for (const e of this.def?.events.values() ?? []) walk(e);
		return [...out];
	}

	/** This effect spawns `id` through its events (or its children's), or its scene shows it */
	usesEffect(id: string): boolean {
		const seen = new Set<string>();
		const queue = [...this.childIds(), ...(this.scene.extras ?? []).map((x) => x.effect)];
		const walk = (n: import('wintersky').EventNode) => {
			if (n.particleEffect?.effect) queue.push(n.particleEffect.effect);
			n.sequence?.forEach(walk);
			n.randomize?.forEach((r) => walk(r.node));
		};
		while (queue.length) {
			const next = queue.shift()!;
			if (next === id) return true;
			if (seen.has(next)) continue;
			seen.add(next);
			for (const e of this.resolveChild(next)?.events.values() ?? []) walk(e);
		}
		return false;
	}

	/** Bumped when child effects are forgotten (one changed or arrived), for views that show them */
	childrenVersion = $state(0);

	/** Forget compiled children (a child file changed or arrived) */
	invalidateChildren(): void {
		this.childDefs.clear();
		this.childrenVersion++;
	}

	get dirty(): boolean {
		void this.version;
		return this.doc.text !== this.savedText;
	}

	get identifier(): string {
		return this.def?.identifier || '(no identifier)';
	}

	get problems(): Problem[] {
		return [...this.staticProblems, ...this.runtimeProblems, ...this.gameProblems];
	}

	get scenario(): Scenario | null {
		const name = this.meta.activeScenario;
		return (name && this.meta.scenarios?.find((s) => s.name === name)) || null;
	}

	private onChange(change: DocumentChange) {
		void change;
		this.version++;
		const before = this.builtFrom;
		const old = this.def;
		this.rebuild();
		if (this.finished) {
			// stopped at the end: show the edit by playing it again
			this.restart();
			this.playing = true;
		} else if (old && !old.failed && !this.def.failed && !this.parallel.engaged && !editNeedsRestart(before, this.builtFrom)) this.hotSwap(old);
		else this.restart();
	}

	/** the document value the current definition was built from */
	private builtFrom: unknown = null;

	/**
	 * Let the running emitters carry on with the edited definition: live particles stay and pick up
	 * appearance, motion and curve edits at once (no restart, so dragging a UV or a curve doesn't stutter)
	 */
	private hotSwap(old: EffectDefinition): void {
		this.world.swapEffect(old, this.def);
		// recorded history and debug replays hold the old definition
		this.frameStart = null;
		this.lastFrameStart = null;
		this.halt = null;
		this.scrubAt = null;
		this.markHistoryStart();
		if (!this.playing) this.world.prepareRender();
	}

	/**
	 * Variables that open effects which spawn this one set in their pre-effects (variable → who), kept up
	 * to date by the workspace
	 */
	parentInputs: Record<string, string> = {};

	/** Re-run the analysis only (the definition stays): what the effect's parents provide changed */
	setParentInputs(inputs: Record<string, string>): void {
		if (JSON.stringify(inputs) === JSON.stringify(this.parentInputs)) return;
		this.parentInputs = inputs;
		if (!this.def) return;
		const { analysis, problems } = this.analyze(this.def);
		this.analysis = analysis;
		this.staticProblems = problems;
	}

	/** Recompile the definition and re-run analysis from the current text */
	rebuild(): void {
		const value = this.doc.value;
		this.builtFrom = value;
		this.meta = readMeta(this.doc);
		const def = this.world.loadEffect(value, this.engine);
		const { analysis, problems } = this.analyze(def);
		this.def = def;
		this.analysis = analysis;
		this.staticProblems = problems;
		this.world.errors.clear();
		this.runtimeProblems = [];
	}

	private analyze(def: EffectDefinition): { analysis: EffectAnalysis; problems: Problem[] } {
		const external: Record<string, string> = {};
		const sc = this.scenario;
		this.activeScenario = sc;
		this.scenarioQueryNames = new Set(Object.keys(sc?.queries ?? {}).map((k) => k.replace(/\(.*$/, '').toLowerCase()));
		for (const k of Object.keys(sc?.variables ?? {})) external[canonicalVar(k)] = `scenario “${sc!.name}”`;
		if (sc?.preEffect) for (const m of sc.preEffect.matchAll(/\b(?:v|variable)\.([a-z_][a-z0-9_]*)\s*=(?!=)/gi)) external[`variable.${m[1].toLowerCase()}`] = `scenario “${sc.name}” pre-effect`;
		const analysis = analyzeEffect(def, { external, parents: this.parentInputs, cap: this.capFor(this.spawnMode), spawnContext: this.spawnMode });
		const problems: Problem[] = [];
		for (const p of this.doc.problems) problems.push({ path: '', severity: 'error', message: `${p.message} (the game can't read this file)`, code: 'json', source: 'json', from: p.offset, to: p.offset + p.length });
		if (def.failed) problems.push({ path: def.failed.path, severity: 'error', message: `${def.failed.reason}. Nothing from this file runs.`, code: 'failed', source: 'effect' });
		problems.push(...analysis.problems);
		try {
			// the game is more lenient than Mojang's schema, so these are notes, not warnings
			for (const s of validateEffect(this.doc)) problems.push({ path: s.path, severity: 'info', message: `Schema: ${s.message}`, code: 'schema', source: 'schema' });
		} catch {
			// schema metadata unavailable (offline build) — the game's own rules above still apply
		}
		return { analysis, problems };
	}

	capFor(mode: SpawnMode): number {
		return this.world.options.particleCap[mode as SpawnContext];
	}

	/** Play or pause; at the end of an effect that has finished, play it again from the start */
	togglePlay(): void {
		if (!this.playing && this.finished) {
			this.restart();
			this.playing = true;
		} else this.playing = !this.playing;
	}

	/** Clear the simulation and spawn the effect again */
	restart(): void {
		this.finished = false;
		this.parallel.reset();
		this.world.clear();
		this.rootId = null;
		this.frameStart = null;
		this.lastFrameStart = null;
		this.halt = null;
		this.history = [];
		this.scrubAt = null;
		this.historyRange = { from: 0, to: 0 };
		this.timeline.reset();
		this.spawn();
		this.markHistoryStart();
		this.timelineVersion++;
	}

	/** Snapshot the current moment as where scrubbing can go back to (time 0 after a restart) */
	private markHistoryStart(): void {
		this.historySince = 0;
		this.history = [{ time: this.world.time, snap: this.world.snapshot(), dts: [] }];
		this.historyRange = { from: this.world.time, to: this.world.time };
	}

	/** Spawn the effect once more (keeps existing particles) */
	spawn(): void {
		if (!this.def || this.def.failed) return;
		const sc = this.scenario;
		const onEntity = this.spawnMode === 'entity';
		// Repeat loops a looping lifetime in place (no new emitter, so no hitch at the boundary)
		const loop = (d: EffectDefinition) => (this.loopPreview && d.emitter.lifetime?.type === 'looping' ? true : undefined);
		this.rootId = this.world.spawn(this.def, {
			position: [0, 0, 0],
			attachment: onEntity ? this.entity.attachment(this.scene.entity.locator) : null,
			context: this.spawnMode,
			variables: scenarioVariables(sc, this.inputScene()),
			preEffect: sc?.preEffect ?? null,
			loop: loop(this.def),
		}).id;
		for (const x of this.scene.extras ?? []) {
			const def = this.resolveChild(x.effect);
			if (def && !def.failed) this.world.spawn(def, { position: [...x.position], context: this.spawnMode, loop: loop(def) });
		}
		// creation events fire on spawn
		this.timeline.commitEvents(this.world.time);
		this.sinceSpawn = 0;
	}

	/** Current value of a variable in the effect's own emitter (null before it runs) */
	variableValue(name: string): Value | undefined {
		const slot = this.world.symbols.variables.get(name.toLowerCase().replace(/^v\./, 'variable.'));
		const root = this.rootEmitter;
		return slot === undefined || !root || !('vars' in root) ? undefined : root.vars[slot];
	}

		/** What time- and scene-driven inputs see this frame (in the live world or a sampling copy) */
	inputScene(w: ParticleWorld = this.world): InputScene {
		const cache = this.sceneCache;
		if (cache.world === w && cache.frame === w.frame) return cache.scene;
		const scene: InputScene = {
			time: w.time,
			timeOfDay: this.timeOfDay,
			entity: this.spawnMode === 'entity' ? this.entity : null,
			camera: w.camera,
			origin: (w === this.world ? this.rootEmitter?.position : w.emitters[0]?.position) ?? [0, 0, 0],
		};
		this.sceneCache = { world: w, frame: w.frame, scene };
		return scene;
	}

	/** Pinned scenario variables are written into the effect's own emitters before every update */
	applyPinned(w: ParticleWorld = this.world): void {
		if (this.activeScenario?.pinned?.length) applyPinned(w, this.activeScenario, this.inputScene(w));
	}

	/** Restore a scene kept in the file */
	private loadScene(): void {
		const saved = readMeta(this.doc).scene as (Partial<SceneSettings> & { blocks?: { palette: []; blocks: number[] }; timeOfDay?: number }) | undefined;
		if (!saved) return;
		this.scene = { ...DEFAULT_SCENE, ...saved, keepInFile: true, entity: { ...DEFAULT_ENTITY, ...(saved.entity ?? {}) } };
		if (typeof saved.timeOfDay === 'number') this.timeOfDay = saved.timeOfDay;
		if (saved.blocks) for (const [x, y, z, b] of BlockWorld.fromJSON(saved.blocks).entries()) this.blocks.set(x, y, z, b);
	}

	/** Push scene settings into the simulation (and the file, when kept there) */
	applyScene(save = false): void {
		const sc = this.scene;
		// solid below the surface (an upward plane is solid where y < d)
		this.world.planes = sc.ground === 'plane' ? [{ normal: [0, 1, 0], d: sc.groundY ?? 0, block: 'minecraft:grass_block' }] : [];
		this.world.blocks = this.blocks.size ? this.blocks : null;
		this.entity.settings = sc.entity;
		this.blocksVersion = this.blocks.version;
		if (save && sc.keepInFile) {
			const { keepInFile, ...rest } = sc;
			void keepInFile;
			const blocks = this.blocks.size && this.blocks.size <= 20000 ? this.blocks.toJSON() : undefined;
			writeMeta(this.doc, 'scene', { ...rest, timeOfDay: this.timeOfDay, blocks }, 'Edit scene');
		}
	}

	/** Fill (or with null, clear) every cell of a box, corners inclusive; `hollow` only fills the shell */
	fillBlocks(a: [number, number, number], b: [number, number, number], block: string | null, hollow = false): number {
		const lo = [0, 1, 2].map((k) => Math.min(a[k], b[k]));
		const hi = [0, 1, 2].map((k) => Math.max(a[k], b[k]));
		let n = 0;
		for (let x = lo[0]; x <= hi[0]; x++)
			for (let y = lo[1]; y <= hi[1]; y++)
				for (let z = lo[2]; z <= hi[2]; z++) {
					const shell = x === lo[0] || x === hi[0] || y === lo[1] || y === hi[1] || z === lo[2] || z === hi[2];
					if (hollow && !shell) continue;
					this.blocks.set(x, y, z, block);
					n++;
				}
		this.applyScene(true);
		this.restart();
		return n;
	}

	/** Change scene settings; restarts so the change is visible from the start */
	setScene(patch: Partial<SceneSettings>, restart = true): void {
		const wasKept = this.scene.keepInFile;
		this.scene = { ...this.scene, ...patch };
		if (wasKept && !this.scene.keepInFile) writeMeta(this.doc, 'scene', undefined, 'Remove scene from file');
		this.applyScene(true);
		if (restart) this.restart();
	}

	setSpawnMode(mode: SpawnMode): void {
		this.spawnMode = mode;
		this.rebuild();
		this.restart();
	}

	/** Inspect a particle (null clears). Tracing costs nothing until something is selected. */
	select(sel: { emitter: number; particle: number } | null): void {
		if (sel && this.withWholeWorld(() => this.select(sel))) {
			this.selection = sel;
			return;
		}
		this.selection = sel;
		this.world.debug.select = sel ? { emitter: sel.emitter, particle: sel.particle } : null;
		if (!sel) this.traces = [];
		if (!this.playing && sel) this.retraceFrame();
	}

	setLogging(on: boolean): void {
		if (on && this.withWholeWorld(() => this.setLogging(on))) return;
		this.logging = on;
		this.world.debug.log = on;
		if (!on) this.log = [];
		else if (!this.playing) this.retraceFrame();
	}

	/** Re-run the last frame from its start so traces/log exist while paused */
	private retraceFrame(): void {
		if (this.frameStart) return;
		const snap = this.lastFrameStart ?? this.frameStartFromHistory();
		if (!snap) return;
		this.lastFrameStart = snap;
		this.world.restore(snap);
		this.world.log.length = 0;
		this.world.step(this.lastDt);
		this.publish(true);
	}

	/** The state at the start of the last frame, replayed from the newest history snapshot */
	private frameStartFromHistory(): WorldSnapshot | null {
		if (this.scrubAt) return null;
		// right after a snapshot the newest entry has no frames yet: the last frame belongs to the one before
		let i = this.history.length - 1;
		if (i > 0 && !this.history[i].dts.length) i--;
		const h = this.history[i];
		if (!h || !h.dts.length) return null;
		this.world.restore(h.snap);
		for (let k = 0; k < h.dts.length - 1; k++) this.world.step(h.dts[k]);
		this.lastDt = h.dts[h.dts.length - 1];
		return this.world.snapshot();
	}
	private lastFrameStart: WorldSnapshot | null = null;

	private publish(force = false): void {
		if (!force && this.publishTimer < 0.1) return;
		this.publishTimer = 0;
		if (this.selection) this.traces = [...this.world.traces];
		if (this.logging) this.log = this.world.log.slice();
		this.debugVersion++;
	}

	/** Run evaluations one at a time inside the next frame (deterministic replay from the frame start) */
	stepEvaluation(): void {
		if (this.withWholeWorld(() => this.stepEvaluation())) return;
		this.playing = false;
		if (!this.frameStart) {
			this.frameStart = this.world.snapshot();
			this.evalStep = 0;
		}
		this.evalStep++;
		this.world.restore(this.frameStart);
		this.world.log.length = 0;
		this.world.debug.haltAfter = this.evalStep;
		const halted = this.world.step(this.lastDt);
		this.world.debug.haltAfter = null;
		if (halted) this.halt = { ...halted.at, step: this.evalStep };
		else this.finishFrame();
		this.publish(true);
	}

	private finishFrame(): void {
		this.lastFrameStart = this.frameStart;
		this.frameStart = null;
		this.halt = null;
		this.evalStep = 0;
	}

	/** Advance the preview by a real-time delta (seconds) */
	tick(dt: number): void {
		if (this.playing) {
			if (this.scrubAt) {
				// playing on from a scrubbed moment forks history: drop the old future
				const { index, frames } = this.scrubAt;
				const steps: number[] = [];
				for (let k = index; k < this.history.length; k++) steps.push(...this.history[k].dts);
				this.history.length = index + 1;
				this.history[index].dts = steps.slice(0, frames);
				this.historySince = 0;
				this.scrubAt = null;
				this.timeline.truncateAfter(this.world.time);
			}
			if (this.frameStart) {
				this.world.restore(this.frameStart);
				this.finishFrame();
			}
			const step = Math.min(dt, 0.1) * this.speed;
			this.lastDt = step;
			this.entity.update(step);
			const debugging = !!this.selection || this.logging;
			// while debugging, keep the frame start so the frame can be replayed exactly; otherwise it's
			// rebuilt from history when needed (a snapshot every frame is megabytes at 10k particles)
			this.lastFrameStart = debugging ? this.world.snapshot() : null;
			if (debugging) this.world.log.length = 0;
			this.timeline.discardPending();
			this.world.step(step);
			this.parallel.step(step);
			this.record(step);
			this.recordTimeline();
			if (debugging) {
				this.publishTimer += dt;
				this.publish();
			}
			this.sinceSpawn += step;
			const root = this.rootEmitter;
			if (root) this.rootPeriod = root.activeTime + root.sleepTime;
			// an expired root with no particles left is removed from the world: that's ended too
			const ended = this.rootId !== null && (!root || root.expired);
			if (this.loopPreview && ended && this.sinceSpawn >= Math.max(1, this.rootPeriod)) this.spawn();
			else if (!this.loopPreview && this.rootId !== null && !this.world.emitters.length && !this.parallel.remote.size) {
				// everything it spawned is gone: stop the clock here, like the end of a video
				this.finished = true;
				this.playing = false;
				this.refreshStats();
			}
		} else {
			this.world.prepareRender();
		}
		this.statsTimer += dt;
		if (this.statsTimer > 0.25) {
			this.statsTimer = 0;
			if (this.playing) this.timelineVersion++;
			this.considerParallel();
			this.refreshStats();
		}
	}

	/**
	 * Spread heavy scenes over worker threads while they just play; bring everything back to this thread
	 * when something needs the whole world here (pausing, inspecting, the log, stepping, scrubbing).
	 */
	private considerParallel(): void {
		const p = this.parallel;
		const whole = !this.playing || !!this.selection || this.logging || !!this.frameStart || !!this.halt || !!this.scrubAt;
		if (p.engaged) {
			if (whole || this.world.particleCount + p.particleCount < PARALLEL_THRESHOLD * 0.6) void p.recall();
		} else if (!whole) p.engage();
	}

	/** Run `then` with every emitter back on this thread */
	private withWholeWorld(then: () => void): boolean {
		if (!this.parallel.engaged) return false;
		void this.parallel.recall().then(then);
		return true;
	}

	private recordTimeline(): void {
		this.timeline.frame(this.world.time, [...this.world.emitters, ...this.parallel.remote.values()], this.world.particleCount + this.parallel.particleCount);
	}

	/**
	 * Keep a snapshot every 0.1 s of simulation time (whatever the display's frame rate) and the exact step of every
	 * frame between them: up to 30 s back
	 */
	private record(dt: number): void {
		// with emitters in workers this world is only part of the scene: no history to scrub through
		if (this.parallel.engaged) {
			this.history = [];
			this.historyRange = { from: this.world.time, to: this.world.time };
			return;
		}
		this.history[this.history.length - 1]?.dts.push(dt);
		this.historySince += dt;
		if (this.historySince < HISTORY_STEP) return;
		this.historySince = 0;
		if (this.world.particleCount > 20000) return;
		this.history.push({ time: this.world.time, snap: this.world.snapshot(), dts: [] });
		// about 140 bytes a particle per snapshot: stay near 128 MB (30 s of history for most effects, less when huge)
		const keep = Math.max(40, Math.min(HISTORY_SECONDS / HISTORY_STEP, Math.floor(128e6 / Math.max(1, this.world.particleCount * 140))));
		if (this.history.length > keep) this.history.splice(0, this.history.length - keep);
		this.historyRange = { from: this.history[0].time, to: this.world.time };
	}

	/**
	 * Go back (or forward, within the recorded span) to simulation time `t`: restore the nearest snapshot
	 * before it and replay forward with the recorded step size. Particle identities are preserved.
	 */
	scrubTo(t: number): void {
		if (this.withWholeWorld(() => this.scrubTo(t))) return;
		this.playing = false;
		// back before the end: Play continues from here rather than replaying
		this.finished = false;
		this.frameStart = null;
		this.halt = null;
		let i = this.history.length - 1;
		while (i > 0 && this.history[i].time > t) i--;
		const h = this.history[i];
		if (!h) return;
		this.world.restore(h.snap);
		// replay the recorded frames exactly, so states match what was shown
		const steps: number[] = [];
		for (let k = i; k < this.history.length; k++) steps.push(...this.history[k].dts);
		let n = 0;
		while (n < steps.length && this.world.time + steps[n] * 0.5 < t) this.world.step(steps[n++]);
		this.timeline.discardPending();
		this.world.prepareRender();
		// the recorded future stays until playback resumes from here
		this.scrubAt = { index: i, frames: n };
		this.timelineVersion++;
		this.lastFrameStart = null;
		this.publish(true);
		this.refreshStats();
	}
	stepFrame(dt = 1 / 60): void {
		if (this.withWholeWorld(() => this.stepFrame(dt))) return;
		if (this.frameStart) {
			this.world.restore(this.frameStart);
			this.world.log.length = 0;
			this.world.step(this.lastDt);
			this.finishFrame();
		} else {
			this.lastDt = dt * this.speed;
			this.lastFrameStart = this.world.snapshot();
			this.world.log.length = 0;
			this.timeline.discardPending();
			this.world.step(this.lastDt);
			this.recordTimeline();
		}
		this.timelineVersion++;
		this.sinceSpawn += this.lastDt;
		this.publish(true);
		this.refreshStats();
	}

	/** Last trace of a field for the selected particle (value lenses) */
	traceFor(path: string): TraceRecord | undefined {
		void this.debugVersion;
		for (let i = this.traces.length - 1; i >= 0; i--) if (this.traces[i].path === path) return this.traces[i];
		return undefined;
	}

	/** Recount the preview stats and the runtime problems (playback does this a few times a second) */
	refreshStats(): void {
		const cap = this.capFor(this.spawnMode);
		let capHit = false;
		for (const e of this.world.emitters) if (e.pool.count >= e.cap) capHit = true;
		for (const e of this.parallel.remote.values()) if (e.cap && e.pool.count >= e.cap) capHit = true;
		this.stats = {
			particles: this.world.particleCount + this.parallel.particleCount,
			emitters: this.world.emitters.length + this.parallel.remote.size,
			cap,
			time: this.world.time,
			capHit,
			threads: this.parallel.engaged ? 1 + this.parallel.lanesInUse : 1,
		};
		const runtime: Problem[] = [];
		for (const e of this.world.errors.values()) {
			runtime.push({
				path: e.path,
				severity: e.code === 'cap' ? 'info' : 'warning',
				message: runtimeMessage(e.code, e.detail) + (e.count > 1 ? ` (${e.count}×)` : ''),
				code: e.code,
				source: 'runtime',
			});
		}
		if (runtime.length !== this.runtimeProblems.length || runtime.some((p, i) => p.message !== this.runtimeProblems[i]?.message)) this.runtimeProblems = runtime;
	}

	markSaved(file?: FileRef): void {
		if (file) this.file = file;
		this.savedText = this.doc.text;
	}

	/**
	 * What a field held in each of its kinds (a colour as a gradient, then as per-channel Molang) and what a
	 * component held before it was turned off, so switching back restores the work. Kept in memory only.
	 */
	private kindMemory = new Map<string, unknown>();

	/** Switch the value at `path` from one kind to another, restoring what the new kind last held */
	switchKind(path: string, from: string, to: string, fresh: unknown, label: string): void {
		if (from === to) return;
		const current = this.doc.get(path);
		if (current !== undefined) this.kindMemory.set(`${path}\u0000${from}`, structuredClone($state.snapshot(current)));
		const back = this.kindMemory.get(`${path}\u0000${to}`);
		const next = back !== undefined ? structuredClone(back) : fresh;
		if (next === undefined) this.doc.remove(path, label);
		else this.doc.set(path, next, label);
	}

	/** Turn a component off, remembering its values for when it's turned back on */
	removeComponent(path: string, label: string): void {
		const current = this.doc.get(path);
		if (current !== undefined) this.kindMemory.set(`${path}\u0000component`, structuredClone($state.snapshot(current)));
		this.doc.remove(path, label);
	}

	/** What a component held before it was turned off, if it was this session */
	rememberedComponent(path: string): unknown {
		const v = this.kindMemory.get(`${path}\u0000component`);
		return v === undefined ? undefined : structuredClone(v);
	}

	/** Swap one component for another in a single step (a burst for a steady rate), each keeping its own values */
	swapComponent(from: string, to: string, toIndex: Parameters<JsonDocument['set']>[3], carry: (old: Record<string, unknown>) => Record<string, unknown>, label: string): void {
		const old = this.doc.get(from);
		if (old !== undefined) this.kindMemory.set(`${from}\u0000component`, structuredClone($state.snapshot(old)));
		const back = this.rememberedComponent(to);
		const next = back ?? carry(old && typeof old === 'object' ? (old as Record<string, unknown>) : {});
		this.doc.transact(label, () => {
			this.doc.remove(from);
			this.doc.set(to, next, label, toIndex);
		});
	}

	dispose(): void {
		this.unsubscribe();
		this.parallel.dispose();
		this.world.clear();
	}
}

function canonicalVar(k: string): string {
	const lower = k.toLowerCase();
	return lower.startsWith('v.') ? `variable.${lower.slice(2)}` : lower.startsWith('variable.') ? lower : `variable.${lower}`;
}

function runtimeMessage(code: string, detail?: string): string {
	switch (code) {
		case 'unset-variable':
			return 'An unset variable was read, so the game aborted this expression (0)';
		case 'div-zero':
			return 'Division by zero evaluated to 0';
		case 'string-math':
			return 'A string was used in arithmetic';
		case 'unknown-query':
			return `Query ${detail ?? ''} has no value in this preview`;
		case 'cap':
			return `Reached the live particle cap: ${detail ?? ''}`;
		case 'missing-effect':
			return `Child effect ${detail ?? ''} isn't loaded`;
		case 'missing-event':
			return `Event ${detail ?? ''} isn't defined`;
		default:
			return `${code}${detail ? `: ${detail}` : ''}`;
	}
}
