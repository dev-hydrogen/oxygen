// The debugging tools: what the engine holds at a moment, every Molang evaluation and the value of each of its
// parts, Molang evaluated where a field runs, values over time, and animations. They replay the effect in the
// editor's own session (the preview page), from the spawn, on the same fixed clock as simulate_effect.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PreviewBrowser } from './browser';
import { PARTICLE_FIELDS } from './debug/records';
import { analyzeMolang, evaluateStandalone } from './molang';
import type { CameraRequest, InspectQuery, InspectResult, Phase, Vec3 } from './protocol';
import { sessionRequest, type PlayOptions } from './requests';
import { data, existing, tool } from './util';

const PHASES = ['creation', 'emitter-update', 'spawn', 'particle-update', 'render', 'event'] as const;
const vec3 = z.array(z.number()).length(3);

const path = z.string().describe('Path to the particle file (absolute, or relative to the working directory)');
const time = z.number().min(0).max(120).describe('Seconds after the spawn. The effect replays from the spawn at 60 fps, so this picks one frame: the one that reaches it');
const play = {
	spawn: z.enum(['command', 'script', 'entity']).optional().describe("How it's started: 'command' (/particle, default), 'script' (Script API) or 'entity' (on an entity, which loops looping emitters)"),
	repeat: z.boolean().optional().describe("Oxygen's Repeat (default false: /particle plays once, like the game)"),
	time_of_day: z.number().min(0).max(1).optional().describe('query.time_of_day: 0 midnight, 0.25 sunrise, 0.5 noon'),
	others: z.array(z.object({ effect: z.string(), position: vec3.optional() })).max(8).optional().describe('Other effects playing in the same world (shared temps, counts)'),
	sim_camera: z
		.object({ position: vec3, target: vec3, fov: z.number().min(10).max(120).optional() })
		.optional()
		.describe("Where the simulation's camera is (culling, q.distance_from_camera, camera-facing). Default: the editor's starting view"),
};

type PlayArgs = { spawn?: 'command' | 'script' | 'entity'; repeat?: boolean; time_of_day?: number; others?: { effect: string; position?: number[] }[]; sim_camera?: { position: number[]; target: number[]; fov?: number } };

const playOptions = (a: PlayArgs): PlayOptions => ({
	spawn: a.spawn,
	repeat: !!a.repeat,
	timeOfDay: a.time_of_day,
	others: a.others,
	camera: a.sim_camera ? { position: a.sim_camera.position as Vec3, target: a.sim_camera.target as Vec3, fov: a.sim_camera.fov } : null,
});

export function registerDebugTools(server: McpServer, browser: PreviewBrowser): void {
	const ask = async (file: string, a: PlayArgs, query: InspectQuery): Promise<InspectResult & { missingChildren: string[]; pageErrors: string[] }> => {
		const { request, missingChildren } = sessionRequest(existing(file), playOptions(a));
		const res = await browser.inspect({ ...request, query });
		if (typeof res.data.error === 'string') throw new Error(res.data.error);
		return { ...res, missingChildren };
	};
	const notes = (r: { missingChildren: string[]; missingTextures: string[]; pageErrors: string[] }) =>
		[
			r.missingChildren.length ? `Child effects not found (they don't play): ${r.missingChildren.join(', ')}` : '',
			r.pageErrors.length ? `Preview page errors: ${r.pageErrors.slice(0, 3).join(' | ')}` : '',
		]
			.filter(Boolean)
			.join('\n');
	const headline = (first: string, r: Parameters<typeof notes>[0]) => [first, notes(r)].filter(Boolean).join('\n');

	server.registerTool(
		'inspect_effect',
		{
			title: 'Inspect the engine at a moment',
			description:
				"Everything the engine holds at one moment of the effect: each particle (stable id, emitter, world position, velocity and speed, age, lifetime, its four v.particle_random values, rotation, and what render preparation computed: size, UV in texture pixels, packed colour 0–255, visible, facing direction), summary statistics, every emitter (lifetime and rate state, loop, cap, culled, randoms, and its variable map: v.* belongs to the emitter and all its particles share it), the last value of each query call, and the global temps. Filter, sort and page the particles; `facing` explains each listed particle's quad orientation.",
			inputSchema: {
				path,
				time,
				emitter: z.number().int().optional().describe('Only particles of this emitter id'),
				effect: z.string().optional().describe('Only particles of emitters running this identifier'),
				ids: z.array(z.number().int()).optional().describe('Only these particle ids'),
				fields: z.array(z.enum(PARTICLE_FIELDS)).optional().describe('Particle fields to include (default all)'),
				sort: z.enum(['id', 'age', 'distance', 'x', 'y', 'z', 'speed']).optional().describe('distance = from the camera'),
				descending: z.boolean().optional(),
				limit: z.number().int().min(0).max(5000).optional().describe('Particles to list (default 30; statistics cover all)'),
				offset: z.number().int().min(0).optional(),
				facing: z.boolean().optional(),
				variables: z.boolean().optional().describe('Include emitter variable maps (default true)'),
				...play,
			},
			annotations: { readOnlyHint: true },
		},
		(a) =>
			tool(async () => {
				const r = await ask(a.path, a, {
					op: 'state',
					time: a.time,
					particles: { emitter: a.emitter ?? null, effect: a.effect ?? null, ids: a.ids ?? null, fields: a.fields ?? null, sort: a.sort ?? 'id', descending: !!a.descending, limit: a.limit ?? 30, offset: a.offset ?? 0, facing: !!a.facing },
					variables: a.variables !== false,
				});
				return data(headline(`State at ${r.data.time} s (frame ${r.data.frame}): ${r.data.liveParticles} particles, ${r.data.liveEmitters} emitters.`, r), r.data);
			}),
	);

	server.registerTool(
		'trace_effect',
		{
			title: 'Trace Molang evaluations',
			description:
				"The debugger. Replays the effect to `time` and records every Molang evaluation of one particle (and its emitter) during that frame (or `frames` frames), in the order the game runs them: phase (creation, emitter-update, spawn, particle-update, render, event), field, source, result, the value of every part of the expression (variables, queries, math calls, sub-expressions; parts inside loops list each pass), the variables it changed (before → after) and the temps it touched. `particle`: a particle id, or 'next' for the first particle spawned in that frame, traced from its very first evaluation (shape, speed, lifetime…). Without `particle`, the emitter's own evaluations and all its particles'. Constant fields are never evaluated, so they don't appear.",
			inputSchema: {
				path,
				time,
				particle: z.union([z.number().int(), z.literal('next')]).optional(),
				emitter: z.number().int().optional().describe("Emitter id (default: the particle's, else the effect's own)"),
				frames: z.number().int().min(1).max(60).optional().describe('Frames to trace (default 1)'),
				field: z.string().optional().describe('Only fields whose JSON path contains this'),
				phase: z.enum(PHASES).optional(),
				detail: z.enum(['full', 'brief']).optional().describe('brief: field, source and result only'),
				limit: z.number().int().min(1).max(5000).optional().describe('Records per frame (default 200)'),
				...play,
			},
			annotations: { readOnlyHint: true },
		},
		(a) =>
			tool(async () => {
				const r = await ask(a.path, a, {
					op: 'trace',
					time: a.time,
					particle: a.particle ?? null,
					emitter: a.emitter ?? null,
					frames: a.frames ?? 1,
					path: a.field ?? null,
					phase: (a.phase as Phase) ?? null,
					detail: a.detail ?? 'full',
					limit: a.limit ?? 200,
				});
				return data(headline(`Trace of ${JSON.stringify(r.data.selection)}:`, r), r.data);
			}),
	);

	server.registerTool(
		'log_effect',
		{
			title: 'Log every evaluation of a frame',
			description:
				'Replays the effect to `time` and lists every Molang evaluation of every emitter and particle during that frame (or `frames` frames) in execution order, the way the game interleaves them: per emitter, its update, then its spawns, then each particle in pool order (per-particle update, motion, ageing, events, expiry), then render preparation. Field, emitter, particle and result for each. Filter by field, phase, emitter or particle; page with offset.',
			inputSchema: {
				path,
				time,
				frames: z.number().int().min(1).max(60).optional(),
				field: z.string().optional().describe('Only fields whose JSON path contains this'),
				phase: z.enum(PHASES).optional(),
				emitter: z.number().int().optional(),
				particle: z.number().int().optional(),
				limit: z.number().int().min(1).max(20000).optional().describe('Default 300'),
				offset: z.number().int().min(0).optional(),
				...play,
			},
			annotations: { readOnlyHint: true },
		},
		(a) =>
			tool(async () => {
				const r = await ask(a.path, a, {
					op: 'log',
					time: a.time,
					frames: a.frames ?? 1,
					path: a.field ?? null,
					phase: (a.phase as Phase) ?? null,
					emitter: a.emitter ?? null,
					particle: a.particle ?? null,
					limit: a.limit ?? 300,
					offset: a.offset ?? 0,
				});
				return data(headline(`${r.data.evaluations} evaluations:`, r), r.data);
			}),
	);

	server.registerTool(
		'evaluate_molang',
		{
			title: 'Evaluate Molang',
			description:
				"Evaluate a Molang expression with the game's rules: 32-bit floats, degrees, an unset variable or temp aborts the whole expression (it gives 0), `??`, loop/break/continue, statements without `return` give 0. Three ways:\n" +
				"1. With `path`, `time` and `at` (a field's JSON path): at the exact moment that field is evaluated in that frame, for every particle (or one `particle`), just before or after it runs, in the same environment: the emitter's variable map as the particles before it left it, the particle's own built-ins and curves, queries, temps. This is what each particle really saw, so it's the way to check effects that pass values between particles through shared variables (index counters like `v.i = v.next; v.next = v.next + 1;`, render-pass layouts) or through temps. The frame plays on unchanged.\n" +
				'2. With `path` and `time` only: in an emitter (`emitter`, default the effect\'s own) or a particle (`particle`) as that frame left it. Shared variables then hold whatever the last writer left.\n' +
				'3. Without `path`: standalone, with `variables`, `temps` and `queries` you give.\n' +
				'Returns the value, whether it aborted, the value of every part, and the variables it set. Nothing in the effect changes.',
			inputSchema: {
				expression: z.string(),
				path: path.optional(),
				time: time.optional(),
				at: z.string().optional().describe("A field's JSON path, e.g. particle_effect/components/minecraft:particle_appearance_billboard/size/0 or …/minecraft:particle_initialization/per_update_expression"),
				when: z.enum(['before', 'after']).optional().describe('With `at`: before the field runs (default: what it reads) or after (what it left)'),
				effect: z.string().optional().describe('With `at`: only that effect’s field, when child effects share the path'),
				particle: z.number().int().optional(),
				emitter: z.number().int().optional(),
				limit: z.number().int().min(1).max(10000).optional().describe('With `at`: results to return (default 200)'),
				parts: z.boolean().optional().describe('With `at`: every part’s value in each result (default: when one particle is asked for)'),
				variables: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe("Standalone: v.* values, e.g. {'v.size': 0.5}"),
				temps: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe('Standalone: t.* values'),
				queries: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe("Standalone: query values by name or exact call, e.g. {'q.time_of_day': 0.5, 'query.position(1)': 2}"),
				engine: z.union([z.string(), z.array(z.number())]).optional().describe('Standalone: the min_engine_version whose Molang rules apply'),
				...play,
			},
			annotations: { readOnlyHint: true },
		},
		(a) =>
			tool(async () => {
				if (!a.path) {
					if (a.at) throw new Error('`at` needs the effect: give `path` (and `time`).');
					return data('Standalone evaluation:', evaluateStandalone({ expression: a.expression, variables: a.variables, temps: a.temps, queries: a.queries, engine: a.engine ?? null }));
				}
				const t = a.time ?? 0;
				if (a.at) {
					const r = await ask(a.path, a, {
						op: 'moments',
						time: t,
						expression: a.expression,
						path: a.at.replace(/^\/+/, '').replace(/^(components|curves|events)\//, 'particle_effect/$1/'),
						when: a.when ?? 'before',
						effect: a.effect ?? null,
						emitter: a.emitter ?? null,
						particle: a.particle ?? null,
						limit: a.limit ?? 200,
						parts: a.parts ?? a.particle !== undefined,
					});
					return data(headline(`${r.data.evaluations} moments (${r.data.moment}) in the frame reaching ${r.data.time} s:`, r), r.data);
				}
				const r = await ask(a.path, a, { op: 'evaluate', time: t, expression: a.expression, emitter: a.emitter ?? null, particle: a.particle ?? null });
				return data(headline(`At ${r.data.time} s:`, r), r.data);
			}),
	);

	server.registerTool(
		'analyze_molang',
		{
			title: 'Analyze Molang',
			description:
				"Check an expression without running it: errors and warnings as the game's loader reports them (unknown queries and math, particle-only restrictions, string maths, missing return, nested ternaries and mixed &&/|| that older pack versions group differently), whether it's constant or a statement list, the variables, temps and queries it reads and writes (and what it reads before writing), the rules for a pack's min_engine_version, formatted versions, and optionally the syntax tree and the JavaScript Oxygen compiles it to.",
			inputSchema: {
				expression: z.string(),
				engine: z.union([z.string(), z.array(z.number())]).optional().describe("The pack's min_engine_version (default: latest rules)"),
				version: z.number().int().optional().describe('A per-expression version ({"expression", "version"} form)'),
				expects_value: z.boolean().optional().describe('The field uses the value (size, rate…), not only statements (creation_expression). Default true'),
				ast: z.boolean().optional(),
				js: z.boolean().optional(),
			},
			annotations: { readOnlyHint: true },
		},
		(a) => tool(() => data('Analysis:', analyzeMolang({ expression: a.expression, engine: a.engine ?? null, version: a.version ?? null, expectsValue: a.expects_value, ast: a.ast, js: a.js }))),
	);

	server.registerTool(
		'track_effect',
		{
			title: 'Track values over time',
			description:
				"Follow values frame by frame from `from` to `to`. One of: particle attributes (`attributes`: position, velocity, speed, age, size, color, rotation, uv, visible, facing) for given `particles` or the first `count` particles seen; a field's value (`field`: JSON path) at each evaluation, per particle over its age (or per emitter for emitter fields); or emitter `variables` as each frame leaves them. Rows are [time, age, values…] with the column names given once.",
			inputSchema: {
				path,
				from: z.number().min(0).max(120).optional().describe('Default 0'),
				to: z.number().min(0).max(120).optional().describe('Default 3'),
				every: z.number().int().min(1).optional().describe('Record every Nth frame (default: about 300 rows at most)'),
				particles: z.array(z.number().int()).optional(),
				count: z.number().int().min(1).max(200).optional().describe('Default 5'),
				emitter: z.number().int().optional(),
				attributes: z.array(z.enum(['position', 'velocity', 'speed', 'age', 'size', 'color', 'rotation', 'uv', 'visible', 'facing'])).optional(),
				field: z.string().optional(),
				variables: z.array(z.string()).optional().describe('Emitter variables, e.g. ["v.index", "v.next"] (the effect’s own emitter unless `emitter`)'),
				...play,
			},
			annotations: { readOnlyHint: true },
		},
		(a) =>
			tool(async () => {
				const r = await ask(a.path, a, {
					op: 'track',
					from: a.from ?? 0,
					to: a.to ?? 3,
					every: a.every ?? 0,
					particles: a.particles ?? null,
					count: a.count ?? 5,
					emitter: a.emitter ?? null,
					attributes: a.attributes ?? [],
					path: a.field ?? null,
					variables: a.variables ?? null,
				});
				return data(headline('Values over time:', r), r.data);
			}),
	);

	server.registerTool(
		'record_gif',
		{
			title: 'Record a GIF',
			description:
				"Record the effect as an animated GIF with Oxygen's viewport (the editor's renderer), from `from` to `to` seconds at `fps`, and save it (default: a file in the system's temp folder; the path comes back). The reply also shows a few of the frames on one sheet. The camera frames everything the animation shows unless given or taken from a saved view. Up to 240 frames.",
			inputSchema: {
				path,
				from: z.number().min(0).max(120).optional().describe('Default 0'),
				to: z.number().min(0).max(120).optional().describe('Default 3'),
				fps: z.number().min(1).max(50).optional().describe('Default 20 (the simulation still steps at 60)'),
				width: z.number().int().min(64).max(1280).optional().describe('Default 480'),
				height: z.number().int().min(64).max(1280).optional().describe('Default 320'),
				camera: z
					.object({
						angle: z.enum(['iso', 'front', 'side', 'top', 'bottom']).optional(),
						zoom: z.number().positive().optional(),
						position: vec3.optional(),
						target: vec3.optional(),
						fov: z.number().min(10).max(120).optional(),
						bookmark: z.string().optional(),
					})
					.optional(),
				mode: z.enum(['classic', 'vv']).optional(),
				ground: z.boolean().optional(),
				gizmos: z.boolean().optional(),
				captions: z.boolean().optional().describe('Time and particle count on each frame (default true)'),
				save_to: z.string().optional().describe('A .gif file, or a folder'),
				previews: z.number().int().min(0).max(16).optional().describe('Frames shown in the reply (default 6; 0 for none)'),
				...play,
			},
		},
		(a) =>
			tool(async () => {
				const c = a.camera ?? {};
				let camera: CameraRequest;
				if (c.bookmark) camera = { kind: 'bookmark', name: c.bookmark };
				else if (c.position && c.target) camera = { kind: 'manual', position: c.position as Vec3, target: c.target as Vec3, fov: c.fov };
				else if (c.position || c.target) throw new Error('A manual camera needs both position and target');
				else camera = { kind: 'auto', angle: c.angle ?? 'iso', zoom: c.zoom ?? 1 };
				const from = a.from ?? 0;
				const to = Math.max(from, a.to ?? 3);
				const r = await ask(a.path, a, {
					op: 'gif',
					from,
					to,
					fps: a.fps ?? 20,
					width: a.width ?? 480,
					height: a.height ?? 320,
					mode: a.mode ?? 'classic',
					camera,
					ground: a.ground ?? true,
					gizmos: !!a.gizmos,
					captions: a.captions ?? true,
					previews: a.previews ?? 6,
				});
				const name = (existing(a.path).split(/[\\/]/).pop() ?? 'effect').replace(/\.particle\.json$|\.json$/i, '');
				let out = a.save_to ? resolve(a.save_to) : join(tmpdir(), 'oxygen-gifs', `${name}-${Date.now()}.gif`);
				if (extname(out).toLowerCase() !== '.gif') out = join(out, `${name}.gif`);
				mkdirSync(dirname(out), { recursive: true });
				writeFileSync(out, Buffer.from(r.gif!, 'base64'));
				const d = r.data as { frames: number; fps: number; from: number; to: number; size: number[]; bytes: number };
				const lines = [headline(`Saved ${out}: ${d.frames} frames at ${d.fps} fps (${d.from}–${d.to} s), ${d.size.join('×')}, ${Math.round(d.bytes / 1024)} KB.`, r)];
				if (r.missingTextures.length) lines.push(`Missing textures (drawn magenta and black): ${r.missingTextures.join(', ')}`);
				lines.push(JSON.stringify(r.data));
				const images = (r.images ?? []).map((url) => ({ type: 'image' as const, data: url.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' }));
				return { content: [{ type: 'text', text: lines.join('\n') }, ...images] };
			}),
	);
}

