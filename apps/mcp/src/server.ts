// Oxygen for coding agents: an MCP server (stdio) that creates, edits, checks, simulates and renders Minecraft
// Bedrock particle effects with Oxygen's own engine, analysis and viewport.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readMeta } from '@oxygen/format';
import { z } from 'zod';
import { PreviewBrowser } from './browser';
import { desktopLaunch, launchDetached } from './desktop';
import { analyze, applyEdits, formatProblems, load, newEffectText, rewriteDiff, summarize, type EditOp, type SpawnMode } from './effects';
import { BUNDLED, childEffects, effectIndex, examples, packRoot, textureFile } from './pack';
import type { CameraRequest, RunRequest, RunResult, Vec3 } from './protocol';
import { reference } from './reference';
import { entitySchema, sessionRequest, type EntityArgs } from './requests';
import { existing, text, tool } from './util';
import { registerDebugTools } from './debug-tools';
import { registerGameTools } from './game';
import { startUpdateCheck } from './update';

/** the package version, put in by build.mjs */
declare const OXYGEN_MCP_VERSION: string;
const VERSION = OXYGEN_MCP_VERSION;

const browser = new PreviewBrowser();

const spawnSchema = z
	.enum(['command', 'script', 'entity'])
	.optional()
	.describe("How the effect is started: 'command' (/particle, the default), 'script' (Script API spawnParticle) or 'entity' (attached to an entity, which loops looping emitters). The file's active scenario can set it too.");
const pathSchema = z.string().describe('Path to the .particle.json / particles/*.json file (absolute, or relative to the working directory)');
const othersSchema = z
	.array(
		z.object({
			effect: z.string().describe('Identifier, looked up in the pack, then the bundled examples'),
			position: z.array(z.number()).length(3).optional().describe('Where it plays (default: 3 blocks apart along +X)'),
		}),
	)
	.max(8)
	.optional()
	.describe("Other effects playing in the same scene, like the Scene panel's \"Other effects\". Default: the ones the file's scene keeps; [] for none");


/** Sample times: given ones, or `samples` evenly spread over `duration` (the first a frame in) */
function sampleTimes(times: number[] | undefined, duration: number, samples: number): number[] {
	const raw = times?.length ? times : Array.from({ length: samples }, (_, i) => (duration * (i + 1)) / samples);
	const out = [...new Set(raw.map((t) => Math.min(60, Math.max(1 / 60, t))))].sort((a, b) => a - b);
	if (out.length > 24) throw new Error('At most 24 sample times');
	return out;
}

function runRequest(path: string, o: { times: number[]; spawn?: SpawnMode; repeat: boolean; timeOfDay?: number; render: RunRequest['render']; others?: { effect: string; position?: number[] }[]; entity?: EntityArgs }): { request: RunRequest; missingChildren: string[] } {
	const { request, missingChildren } = sessionRequest(path, o);
	const { camera: _camera, ...rest } = request;
	return { request: { ...rest, times: o.times, render: o.render }, missingChildren };
}

/** The numbers of a run, as a report */
function report(r: RunResult & { pageErrors: string[] }, path: string, missingChildren: string[], withInfo: boolean): string {
	const lines = [`${r.identifier}: ${r.samples.length} samples. Peak ${r.peak.particles} live particles at ${r.peak.time} s.${r.finishedAt !== null ? ` Everything ended at ${r.finishedAt} s.` : ''}`, ''];
	lines.push('| time (s) | live | drawn | emitters | bounds min → max (blocks) |', '| --- | --- | --- | --- | --- |');
	for (const s of r.samples) {
		const b = s.bounds ? `[${s.bounds.min.join(', ')}] → [${s.bounds.max.join(', ')}]` : '—';
		lines.push(`| ${s.time} | ${s.particles}${s.capHit ? ' (cap)' : ''} | ${s.visible} | ${s.emitters} | ${b} |`);
	}
	if (r.emitters.length) {
		lines.push('', 'Emitters and events:');
		for (const em of r.emitters) {
			const evs = Object.entries(em.events).map(([n, ev]) => `${n} ×${ev.count} (first ${ev.first} s)`);
			lines.push(`- ${em.effect}: ${em.count} emitter${em.count === 1 ? '' : 's'}, from ${em.firstStart} s${em.lastEnd !== null ? ` to ${em.lastEnd} s` : ', still running'}${evs.length ? `; events ${evs.join(', ')}` : ''}`);
		}
	}
	if (missingChildren.length) lines.push('', `Effects not found in the pack or the examples (they don't play): ${missingChildren.join(', ')}`);
	if (r.missingTextures.length) {
		const root = packRoot(path);
		const notes = r.missingTextures.map((t) => `${t}${textureFile(root, t).tga ? ' (only a TGA exists; the preview reads PNG)' : ''}`);
		lines.push('', `Missing textures (drawn as the magenta-black missing texture): ${notes.join(', ')}`);
	}
	lines.push('', formatProblems(r.problems, withInfo));
	if (r.pageErrors.length) lines.push('', `Preview page errors: ${r.pageErrors.slice(0, 5).join(' | ')}`);
	return lines.join('\n');
}

const server = new McpServer({ name: 'oxygen', version: VERSION }, {
	instructions: [
		'Oxygen is a Minecraft Bedrock particle editor whose engine was checked against the game. Use these tools to author particle effects (JSON files under a resource pack\'s particles/ folder):',
		'1. reference (topic "components", a component id, "game-rules", "queries") to learn the format and the game\'s real behaviour.',
		'2. create_effect to start from Oxygen\'s template or a bundled example (list_examples).',
		'3. edit_effect for formatting-preserving edits by JSON path, write_effect to replace the whole text; read_effect / check_effect to see structure and problems.',
		'4. simulate_effect for numbers over time (particle counts, bounds, events); preview_effect to see it rendered.',
		'5. open_in_editor to show the effect to the user in the Oxygen desktop app, which follows later edits live.',
		'To understand or debug how an effect is evaluated: inspect_effect (every particle and emitter at a moment, with variable maps), trace_effect (every Molang evaluation of a particle with the value of each part), log_effect (all evaluations of a frame in order), evaluate_molang (Molang inside the effect; with `at`, at the exact moment a field runs for each particle, which is what each particle saw when particles share variables), track_effect (values over time) and analyze_molang. record_gif saves an animation.',
		'game_* tools reach Minecraft itself: deploy the pack, spawn the effect through /connect, read the content log.',
		'Paths in edits look like components/minecraft:particle_appearance_billboard/size or events/pop/particle_effect/effect.',
	].join('\n'),
});

server.registerTool(
	'list_examples',
	{
		title: 'List bundled examples',
		description: 'The example effects bundled with Oxygen (each checked in Minecraft), usable as templates for create_effect.',
		annotations: { readOnlyHint: true },
	},
	() =>
		tool(() => {
			const lines = ['Examples (name: identifier, components):'];
			for (const [name, file] of examples()) {
				const e = analyze(file, readFileSync(file, 'utf8'));
				const components = e.doc.get('particle_effect/components');
				const comps = (components && typeof components === 'object' ? Object.keys(components) : []).map((c) => c.replace('minecraft:', ''));
				lines.push(`- ${name}: ${e.def.identifier}; ${e.def.material}; ${comps.join(', ')}${e.def.events.size ? `; events ${[...e.def.events.keys()].join(', ')}` : ''}`);
			}
			return text(lines.join('\n'));
		}),
);

server.registerTool(
	'reference',
	{
		title: 'Particle format reference',
		description:
			'Look up the particle format and the game\'s behaviour: topic "components" (all components), a component id such as "minecraft:emitter_shape_sphere" (fields, defaults, evaluation phase), "materials", "phases", "queries" (with search), a query such as "q.distance_from_camera", "math", "game-rules" (measured in-game quirks: read this before designing effects) or "molang".',
		inputSchema: { topic: z.string().describe('What to look up; "help" lists topics'), search: z.string().optional().describe('Filter for the "queries" topic') },
		annotations: { readOnlyHint: true },
	},
	({ topic, search }) => tool(() => text(reference(topic, search ?? null))),
);

server.registerTool(
	'create_effect',
	{
		title: 'Create a particle effect',
		description: "Write a new particle effect file: Oxygen's starting effect (a small steady fountain) or a copy of a bundled example under a new identifier. Returns its summary and problems.",
		inputSchema: {
			path: pathSchema,
			identifier: z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/, 'namespace:name, lowercase').describe('The effect identifier, e.g. "mypack:spark_burst"'),
			template: z.string().optional().describe('A bundled example to start from (see list_examples); omit for the starting effect'),
			overwrite: z.boolean().optional().describe('Replace an existing file (default false)'),
		},
	},
	({ path, identifier, template, overwrite }) =>
		tool(() => {
			const p = resolve(path);
			if (existsSync(p) && !overwrite) throw new Error(`${p} already exists; pass overwrite: true to replace it, or use edit_effect`);
			if (extname(p) !== '.json') throw new Error('Particle files end in .json (Oxygen opens *.particle.json by default)');
			const { text: body, children } = newEffectText(identifier, template ?? null);
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, body);
			const e = load(p);
			const lines = [`Created ${p}`, '', summarize(e), '', formatProblems(e.problems, false)];
			const index = effectIndex(e.root);
			const fromExamples = children.filter((c) => index.get(c)?.startsWith(BUNDLED.examples) ?? true);
			if (fromExamples.length) lines.push('', `This example spawns ${fromExamples.join(', ')}. The preview finds them among the bundled examples, but the game needs them in the pack: create them too (create_effect with their example as template, keeping their identifiers) or point the events at your own effects.`);
			if (!e.root) lines.push('', 'No resource pack around this file (no manifest.json above it and no particles/ folder): pack textures and child effects can\'t be found.');
			return text(lines.join('\n'));
		}),
);

server.registerTool(
	'read_effect',
	{
		title: 'Read a particle effect',
		description: 'Summarize an effect: identifier, material, texture, components, curves, events (what they spawn), variables (where set and read), scenarios, plus its problems. Optionally the file text.',
		inputSchema: {
			path: pathSchema,
			include_text: z.boolean().optional().describe('Also return the file text (default false)'),
			include_info: z.boolean().optional().describe('Also list info-level notes such as schema hints (default false)'),
		},
		annotations: { readOnlyHint: true },
	},
	({ path, include_text, include_info }) =>
		tool(() => {
			const e = load(existing(path));
			const parts = [summarize(e), '', formatProblems(e.problems, !!include_info)];
			if (include_text) parts.push('', '```json', e.doc.text.trimEnd(), '```');
			return text(parts.join('\n'));
		}),
);

const editSchema = z.discriminatedUnion('op', [
	z.object({ op: z.literal('set'), path: z.string(), value: z.unknown().describe('Any JSON value; creates missing parents') }),
	z.object({ op: z.literal('molang'), path: z.string(), expression: z.string().describe('Molang source; kept as a number when it is one and the field held a number') }),
	z.object({ op: z.literal('remove'), path: z.string() }),
	z.object({ op: z.literal('insert'), path: z.string().describe('Path of an array'), value: z.unknown(), index: z.number().int().optional().describe('Default: append') }),
	z.object({ op: z.literal('rename'), path: z.string().describe('Path of an object key'), to: z.string() }),
]);

server.registerTool(
	'edit_effect',
	{
		title: 'Edit a particle effect',
		description:
			'Apply edits by JSON path as one change, keeping the file\'s formatting, key order and comments (Oxygen\'s surgical edits). Paths are slash-separated; "components/", "curves/", "events/" and "description/" are short for the same under "particle_effect/". Use "~1" for a "/" inside a key. A new component is placed in canonical order. All edits apply or none do. Returns what changed (in the game\'s terms) and the problems afterwards.',
		inputSchema: {
			path: pathSchema,
			edits: z.array(editSchema).min(1),
			dry_run: z.boolean().optional().describe("Report the change and its problems without writing the file"),
			include_info: z.boolean().optional(),
		},
	},
	({ path, edits, dry_run, include_info }) =>
		tool(() => {
			const p = existing(path);
			const before = readFileSync(p, 'utf8');
			const { text: after, diff } = applyEdits(before, edits as EditOp[]);
			if (!dry_run && after !== before) writeFileSync(p, after);
			const e = analyze(p, after);
			return text([dry_run ? 'Dry run: nothing written.' : after === before ? 'No change.' : `Saved ${p}.`, '', diff.trimEnd(), '', formatProblems(e.problems, !!include_info)].join('\n'));
		}),
);

server.registerTool(
	'write_effect',
	{
		title: 'Write a particle effect',
		description:
			"Write a particle file's whole text: a new file, or a rewrite where edit_effect would need a long list of edits. The text replaces the file as given (edit_effect keeps the file's formatting and comments; this doesn't). Text that isn't valid JSON is refused. Returns what changed (in the game's terms), or the summary of a new file, and the problems.",
		inputSchema: {
			path: pathSchema,
			text: z.string().describe('The complete file text'),
			dry_run: z.boolean().optional().describe('Report the change and its problems without writing the file'),
			include_info: z.boolean().optional(),
		},
	},
	({ path, text: body, dry_run, include_info }) =>
		tool(() => {
			const p = resolve(path);
			if (extname(p) !== '.json') throw new Error('Particle files end in .json (Oxygen opens *.particle.json by default)');
			const before = existsSync(p) ? readFileSync(p, 'utf8') : null;
			const diff = rewriteDiff(before, body);
			if (!dry_run && body !== before) {
				mkdirSync(dirname(p), { recursive: true });
				writeFileSync(p, body);
			}
			const e = analyze(p, body);
			const head = dry_run ? 'Dry run: nothing written.' : body === before ? 'No change.' : before === null ? `Created ${p}.` : `Saved ${p}.`;
			return text([head, '', before === null ? summarize(e) : diff.trimEnd(), '', formatProblems(e.problems, !!include_info)].join('\n'));
		}),
);

server.registerTool(
	'check_effect',
	{
		title: 'Check a particle effect',
		description: "List an effect's problems the way Oxygen reports them: JSON errors, fields the game drops, Molang errors, unset variable reads (which abort the expression in-game), structural mistakes and schema notes. Static only; simulate_effect adds runtime problems.",
		inputSchema: { path: pathSchema, spawn: spawnSchema, include_info: z.boolean().optional() },
		annotations: { readOnlyHint: true },
	},
	({ path, spawn, include_info }) => tool(() => text(formatProblems(load(existing(path), spawn).problems, !!include_info))),
);

server.registerTool(
	'simulate_effect',
	{
		title: 'Simulate a particle effect',
		description:
			"Run the effect in Oxygen's game-faithful engine (fixed 60 fps clock, same seed every time) and report numbers at sample times: live and drawn particles, emitters, the bounding box of the particles, the cap; which emitters and events ran and when; and the problems, including runtime ones (unset variables read, division by zero, cap reached). Child effects come from the pack, then the bundled examples.",
		inputSchema: {
			path: pathSchema,
			duration: z.number().positive().max(60).optional().describe('Seconds to simulate (default 3)'),
			samples: z.number().int().min(1).max(24).optional().describe('How many evenly spaced samples (default 6)'),
			times: z.array(z.number().min(0).max(60)).optional().describe('Exact sample times in seconds (overrides duration and samples)'),
			spawn: spawnSchema,
			entity: entitySchema,
			repeat: z.boolean().optional().describe("Oxygen's Repeat: start the effect again when it ends (default false: /particle plays once, like the game)"),
			others: othersSchema,
			include_info: z.boolean().optional(),
		},
		annotations: { readOnlyHint: true },
	},
	({ path, duration, samples, times, spawn, entity, repeat, others, include_info }) =>
		tool(async () => {
			const p = existing(path);
			const { request, missingChildren } = runRequest(p, { times: sampleTimes(times, duration ?? 3, samples ?? 6), spawn, repeat: !!repeat, render: null, others, entity });
			return text(report(await browser.run(request), p, missingChildren, !!include_info));
		}),
);

const cameraSchema = z
	.object({
		angle: z.enum(['iso', 'front', 'side', 'top', 'bottom']).optional().describe('Direction to look from when framing automatically (default iso)'),
		zoom: z.number().positive().optional().describe('Automatic framing: >1 closer, <1 further (default 1)'),
		position: z.array(z.number()).length(3).optional().describe('Manual camera position (with target)'),
		target: z.array(z.number()).length(3).optional().describe('Manual point to look at (with position)'),
		fov: z.number().min(10).max(120).optional().describe('Vertical field of view in degrees (default 70)'),
		bookmark: z.string().optional().describe("A camera saved in the file's oxygen block"),
	})
	.optional()
	.describe('Default: frame every particle seen across the sample times, from the iso angle');

server.registerTool(
	'preview_effect',
	{
		title: 'Render a particle effect',
		description:
			"Render the effect with Oxygen's viewport (the same renderer as the editor, matched to the game) at sample times and return the pictures, by default as one labelled contact sheet, plus the simulate_effect numbers. The ground grid is at y=0 and the small outlined cube is one block. Optionally saves the PNGs.",
		inputSchema: {
			path: pathSchema,
			times: z.array(z.number().min(0).max(60)).max(9).optional().describe('Seconds after the spawn to show (default [0.25, 0.75, 1.5, 3])'),
			width: z.number().int().min(64).max(1920).optional().describe('Pixels per picture (default 480)'),
			height: z.number().int().min(64).max(1920).optional().describe('Pixels per picture (default 360)'),
			camera: cameraSchema,
			mode: z.enum(['classic', 'vv']).optional().describe("'classic' (default) or 'vv' for the Vibrant Visuals approximation (uses the pack's lighting and texture sets)"),
			time_of_day: z.number().min(0).max(1).optional().describe('0 midnight, 0.25 sunrise, 0.5 noon (lighting, query.time_of_day)'),
			ground: z.boolean().optional().describe('Draw the ground grid and the one-block reference (default true)'),
			gizmos: z.boolean().optional().describe('Draw emitter markers, spawn shapes and the kill plane (default false)'),
			sheet: z.boolean().optional().describe('One contact sheet (default true) instead of a picture per time'),
			save_to: z.string().optional().describe('Write the PNG(s) here: a .png file, or a folder for one file per picture'),
			return_images: z.boolean().optional().describe('Put the pictures in the reply (default true). false needs save_to: only the numbers and the saved paths come back'),
			spawn: spawnSchema,
			entity: entitySchema,
			repeat: z.boolean().optional().describe("Oxygen's Repeat (default false: /particle plays once, like the game)"),
			others: othersSchema,
			include_info: z.boolean().optional(),
		},
		annotations: { readOnlyHint: false },
	},
	(a) =>
		tool(async () => {
			const p = existing(a.path);
			if (a.return_images === false && !a.save_to) throw new Error('return_images: false needs save_to, or the pictures would be lost');
			const c = a.camera ?? {};
			let camera: CameraRequest;
			if (c.bookmark) camera = { kind: 'bookmark', name: c.bookmark };
			else if (c.position && c.target) camera = { kind: 'manual', position: [c.position[0], c.position[1], c.position[2]], target: [c.target[0], c.target[1], c.target[2]], fov: c.fov };
			else if (c.position || c.target) throw new Error('A manual camera needs both position and target');
			else camera = { kind: 'auto', angle: c.angle ?? 'iso', zoom: c.zoom ?? 1 };
			const times = sampleTimes(a.times ?? [0.25, 0.75, 1.5, 3], 0, 0);
			const sheet = a.sheet ?? true;
			const { request, missingChildren } = runRequest(p, {
				times,
				spawn: a.spawn,
				repeat: !!a.repeat,
				timeOfDay: a.time_of_day,
				render: { width: a.width ?? 480, height: a.height ?? 360, mode: a.mode ?? 'classic', camera, ground: a.ground ?? true, gizmos: !!a.gizmos, sheet },
				others: a.others,
				entity: a.entity,
			});
			const r = await browser.run(request);
			const pngs = r.images.map((url) => url.replace(/^data:image\/png;base64,/, ''));
			const lines = [report(r, p, missingChildren, !!a.include_info)];
			if (r.camera) lines.push('', `Camera: position [${r.camera.position.map((x) => +x.toFixed(3)).join(', ')}], target [${r.camera.target.map((x) => +x.toFixed(3)).join(', ')}], fov ${r.camera.fov}`);
			if (a.save_to) {
				const out = resolve(a.save_to);
				const name = (r.identifier.split(':').pop() ?? 'effect').replace(/[^a-z0-9_.-]/gi, '_');
				let files: string[];
				if (extname(out).toLowerCase() === '.png') {
					if (pngs.length > 1) throw new Error('Several pictures need a folder for save_to (or sheet: true)');
					files = [out];
				} else files = pngs.map((_, i) => join(out, pngs.length === 1 ? `${name}.png` : `${name}_${r.samples[i].time}s.png`));
				mkdirSync(dirname(files[0]), { recursive: true });
				pngs.forEach((b64, i) => writeFileSync(files[i], Buffer.from(b64, 'base64')));
				lines.push('', `Saved ${files.join(', ')}`);
			}
			const images = a.return_images === false ? [] : pngs.map((data) => ({ type: 'image' as const, data, mimeType: 'image/png' }));
			return { content: [{ type: 'text', text: lines.join('\n') }, ...images] };
		}),
);

server.registerTool(
	'open_in_editor',
	{
		title: 'Open in Oxygen',
		description:
			"Open the file in the Oxygen desktop app for the user: starts the app, or hands the file to the one running, which opens it in a tab or focuses its tab. The app follows the file on disk, so later changes from these tools show there live (a tab with unsaved changes keeps them). Oxygen is found through OXYGEN_DESKTOP (its executable), the desktop build of the repository this server was built in, or an installed app.",
		inputSchema: { path: pathSchema },
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	({ path }) =>
		tool(async () => {
			const p = existing(path);
			const launch = desktopLaunch(p);
			if (!launch) throw new Error('Oxygen desktop not found: install it, build it in this repository (pnpm --filter @oxygen/desktop build), or set OXYGEN_DESKTOP to its executable.');
			await launchDetached(launch);
			return text(`Opening ${p} in Oxygen (via ${launch.via}).`);
		}),
);

registerDebugTools(server, browser);
registerGameTools(server);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		void browser.close().finally(() => process.exit(0));
	});
}
process.stdin.on('close', () => void browser.close());

startUpdateCheck(VERSION, __dirname);
server.connect(new StdioServerTransport()).catch((e) => {
	console.error(e);
	process.exit(1);
});
