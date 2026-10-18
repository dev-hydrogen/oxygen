import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { analyzeEffect, type EffectAnalysis, type Problem } from '@oxygen/effect';
import { COMPONENT_BY_ID, componentInsertionIndex, formatDiff, JsonDocument, newEffect, readMeta, semanticDiff, validateEffect } from '@oxygen/format';
import { queryExists } from '@oxygen/metadata';
import { ParticleWorld, type EffectDefinition, type EventNode, type SpawnContext } from 'wintersky';
import { effectIndex, examples, packEngine, packRoot, parentInputs } from './pack';

export type SpawnMode = 'command' | 'script' | 'entity';

/** One open particle file with its compiled definition and the problems the editor would show */
export interface LoadedEffect {
	path: string;
	root: string | null;
	doc: JsonDocument;
	def: EffectDefinition;
	analysis: EffectAnalysis;
	problems: Problem[];
	/** what other effects in the pack (or the examples) set for this one in their pre-effects */
	parents: Record<string, string>;
	engine: number[] | null;
}

function canonicalVar(k: string): string {
	const lower = k.toLowerCase();
	return lower.startsWith('v.') ? `variable.${lower.slice(2)}` : lower.startsWith('variable.') ? lower : `variable.${lower}`;
}

/**
 * Compile and analyze an effect the way the editor's session does: syntax, a definition that failed to load,
 * the effect-wide analysis (with the active scenario's variables and the parents' pre-effects as inputs) and
 * Mojang's schema as notes
 */
export function analyze(path: string, text: string, spawn: SpawnMode = 'command'): LoadedEffect {
	const root = packRoot(path);
	const engine = packEngine(root);
	const doc = new JsonDocument(text);
	const world = new ParticleWorld({ engine, queryExists });
	const def = world.loadEffect(doc.value, engine);
	const parents = def.identifier ? parentInputs(effectIndex(root), def.identifier) : {};
	const external: Record<string, string> = {};
	const meta = readMeta(doc);
	const sc = (meta.activeScenario && meta.scenarios?.find((s) => s.name === meta.activeScenario)) || null;
	for (const k of Object.keys(sc?.variables ?? {})) external[canonicalVar(k)] = `scenario “${sc!.name}”`;
	if (sc?.preEffect) for (const m of sc.preEffect.matchAll(/\b(?:v|variable)\.([a-z_][a-z0-9_]*)\s*=(?!=)/gi)) external[`variable.${m[1].toLowerCase()}`] = `scenario “${sc.name}” pre-effect`;
	const mode = sc?.spawn ?? spawn;
	const analysis = analyzeEffect(def, { external, parents, cap: world.options.particleCap[mode as SpawnContext], spawnContext: mode });
	const problems: Problem[] = [];
	for (const p of doc.problems) problems.push({ path: '', severity: 'error', message: `${p.message} at offset ${p.offset} (the game can't read this file)`, code: 'json', source: 'json', from: p.offset, to: p.offset + p.length });
	if (def.failed) problems.push({ path: def.failed.path, severity: 'error', message: `${def.failed.reason}. Nothing from this file runs.`, code: 'failed', source: 'effect' });
	problems.push(...analysis.problems);
	// the game is more lenient than Mojang's schema, so these are notes, not warnings
	for (const s of validateEffect(doc)) problems.push({ path: s.path, severity: 'info', message: `Schema: ${s.message}`, code: 'schema', source: 'schema' });
	return { path, root, doc, def, analysis, problems, parents, engine };
}

export function load(path: string, spawn?: SpawnMode): LoadedEffect {
	return analyze(path, readFileSync(path, 'utf8'), spawn);
}

const SEVERITY_RANK: Record<Problem['severity'], number> = { error: 0, warning: 1, info: 2 };

/** Problems as lines an agent can act on: severity, JSON path, message, code; notes only when asked */
export function formatProblems(all: { severity: Problem['severity']; path: string; message: string; code: string }[], withInfo: boolean): string {
	// the same problem can arrive twice (a parse error reported per pass)
	const problems = [...new Map(all.map((p) => [`${p.severity}|${p.path}|${p.message}`, p])).values()];
	const shown = problems.filter((p) => withInfo || p.severity !== 'info').sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
	const hidden = problems.length - shown.length;
	const counts = (['error', 'warning', 'info'] as const)
		.map((s) => {
			const n = problems.filter((p) => p.severity === s).length;
			return `${n} ${s}${n === 1 || s === 'info' ? '' : 's'}`;
		})
		.join(', ');
	const lines = [`Problems: ${counts}${hidden ? ` (${hidden} info notes hidden; pass include_info to see them)` : ''}`];
	for (const p of shown) lines.push(`- [${p.severity}] ${p.path || '(file)'}: ${p.message} (${p.code})`);
	return lines.join('\n');
}

/** What one event node does, in a line */
function describeEvent(n: EventNode): string {
	const parts: string[] = [];
	if (n.sequence?.length) parts.push(`sequence of ${n.sequence.length}: ${n.sequence.map(describeEvent).join(' → ')}`);
	if (n.randomize?.length) parts.push(`random choice of ${n.randomize.length}: ${n.randomize.map((r) => `${r.weight}× ${describeEvent(r.node)}`).join(' | ')}`);
	if (n.particleEffect?.effect) parts.push(`spawns ${n.particleEffect.effect} (${n.particleEffect.type})`);
	if (n.sound) parts.push(`plays sound ${n.sound.event}`);
	if (n.expression) parts.push('runs an expression');
	return parts.join('; ') || 'does nothing';
}

/** A short, structured description of the effect: what it's made of and how its parts connect */
export function summarize(e: LoadedEffect): string {
	const { def, doc, analysis } = e;
	const components = doc.get('particle_effect/components');
	const lines = [`${def.identifier || '(no identifier)'} — ${basename(e.path)}`, `format_version ${def.formatVersion || '?'}, material ${def.material || '?'}, texture ${def.texture || '?'}`];
	lines.push(e.root ? `Pack: ${e.root}${e.engine ? ` (min_engine_version ${e.engine.join('.')})` : ''}` : 'Pack: none found (no manifest.json above the file and no particles/ folder)');
	lines.push('', 'Components:');
	for (const id of components && typeof components === 'object' ? Object.keys(components) : []) {
		const info = COMPONENT_BY_ID.get(id);
		lines.push(`- ${id}${info ? ` (${info.label}, ${info.category})` : ' (unknown to the game: ignored)'}`);
	}
	if (def.curves.length) lines.push('', 'Curves:', ...def.curves.map((c) => `- ${c.name} (${c.type})`));
	if (def.events.size) {
		lines.push('', 'Events:');
		for (const [name, node] of def.events) lines.push(`- ${name}: ${describeEvent(node)}`);
	}
	const vars = analysis.variables.filter((v) => !v.builtin);
	if (vars.length) {
		lines.push('', 'Variables:');
		for (const v of vars) {
			const from = v.external ? `set by ${v.external}` : v.curve ? 'set by a curve' : v.writes.length ? `set in ${v.writes.map((w) => w.label).join(', ')}` : 'never set';
			lines.push(`- ${v.name.replace(/^variable\./, 'v.')}: ${from}; read in ${v.reads.map((r) => r.label).join(', ') || 'nothing'}`);
		}
	}
	if (Object.keys(e.parents).length) lines.push('', `Set by parent effects' pre-effects: ${Object.entries(e.parents).map(([v, p]) => `${v} (${p})`).join(', ')}`);
	const meta = readMeta(doc);
	if (meta.scenarios?.length) lines.push('', `Scenarios: ${meta.scenarios.map((s) => s.name + (s.name === meta.activeScenario ? ' (active)' : '')).join(', ')}`);
	if (meta.cameras?.length) lines.push(`Camera bookmarks: ${meta.cameras.map((c) => c.name).join(', ')}`);
	return lines.join('\n');
}

export type EditOp =
	| { op: 'set'; path: string; value: unknown }
	| { op: 'molang'; path: string; expression: string }
	| { op: 'remove'; path: string }
	| { op: 'insert'; path: string; value: unknown; index?: number }
	| { op: 'rename'; path: string; to: string };

/** `components/…`, `curves/…`, `events/…` and `description/…` are short for the same path under `particle_effect/` */
export function fullPath(path: string): string {
	const p = path.replace(/^\/+/, '');
	return /^(components|curves|events|description)(\/|$)/.test(p) ? `particle_effect/${p}` : p;
}

/**
 * Apply edits as one change, the way Oxygen edits files: surgical text edits that keep formatting, key order,
 * comments and number spelling. Throws (and changes nothing) when an edit can't apply.
 */
export function applyEdits(text: string, ops: EditOp[]): { text: string; diff: string } {
	const doc = new JsonDocument(text);
	if (doc.problems.length) throw new Error(`The file isn't valid JSON (${doc.problems[0].message} at offset ${doc.problems[0].offset}); fix it as text first.`);
	const before = doc.value;
	doc.transact('Agent edit', () => {
		ops.forEach((o, i) => {
			const path = fullPath(o.path);
			const where = `edit ${i + 1} (${o.op} ${path})`;
			const parts = path.split('/');
			switch (o.op) {
				case 'set': {
					// a new component goes where the editor puts it, in the catalog's order
					const isComponent = parts.length === 3 && parts[0] === 'particle_effect' && parts[1] === 'components';
					const order = isComponent && !doc.has(path) ? componentInsertionIndex(parts[2]) : undefined;
					doc.set(path, o.value, 'Agent edit', order);
					break;
				}
				case 'molang':
					doc.setMolang(path, o.expression);
					break;
				case 'remove':
					if (!doc.has(path)) throw new Error(`${where}: nothing at that path`);
					doc.remove(path);
					break;
				case 'insert': {
					const arr = doc.node(path);
					if (arr && arr.type !== 'array') throw new Error(`${where}: the value there isn't an array`);
					doc.insert(path, o.value, o.index);
					break;
				}
				case 'rename':
					if (!doc.has(path)) throw new Error(`${where}: nothing at that path`);
					if (doc.node(path)?.parent?.type !== 'property') throw new Error(`${where}: only object keys can be renamed`);
					doc.renameKey(path, o.to);
					break;
			}
			if (doc.problems.length) throw new Error(`${where} broke the JSON: ${doc.problems[0].message}`);
		});
	});
	return { text: doc.text, diff: formatDiff(semanticDiff(before, doc.value), 'before', 'after') };
}

/**
 * Check a whole new text for a file the way applyEdits checks an edit, and describe the change in the game's terms
 * (empty for a new file). Throws when the text isn't valid JSON, so nothing broken gets written.
 */
export function rewriteDiff(before: string | null, after: string): string {
	const doc = new JsonDocument(after);
	if (doc.problems.length) throw new Error(`The text isn't valid JSON (${doc.problems[0].message} at offset ${doc.problems[0].offset}); nothing was written.`);
	if (before === null) return '';
	const old = new JsonDocument(before);
	// a file that didn't parse before can't be compared field by field
	return old.problems.length ? "The file before wasn't valid JSON: no field-by-field comparison." : formatDiff(semanticDiff(old.value, doc.value), 'before', 'after');
}

/**
 * Text for a new effect: Oxygen's starting effect, or a copy of a bundled example under a new identifier.
 * `children` lists the effects the example spawns, which come from the examples unless the pack has them.
 */
export function newEffectText(identifier: string, template: string | null): { text: string; children: string[] } {
	if (!template) return { text: `${JSON.stringify(newEffect(identifier), null, '\t')}\n`, children: [] };
	const file = examples().get(template);
	if (!file) throw new Error(`No example named "${template}". Examples: ${[...examples().keys()].join(', ')}`);
	const doc = new JsonDocument(readFileSync(file, 'utf8'));
	doc.set('particle_effect/description/identifier', identifier);
	const world = new ParticleWorld({ queryExists });
	const children = new Set<string>();
	const walk = (n: EventNode) => {
		if (n.particleEffect?.effect) children.add(n.particleEffect.effect);
		n.sequence?.forEach(walk);
		n.randomize?.forEach((r) => walk(r.node));
	};
	for (const n of world.loadEffect(doc.value).events.values()) walk(n);
	return { text: doc.text, children: [...children] };
}
