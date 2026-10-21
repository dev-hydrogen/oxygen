import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, COMPONENT_BY_ID, COMPONENTS, MATERIALS, PHASES, type FieldKind } from '@oxygen/format';
import { getQuery, molangMetadata, queryExists, queryUnavailable } from '@oxygen/metadata';
import { ENTITY_TESTS, TESTS } from '@oxygen/testpack';
import measured from '../../../packages/testpack/fixtures/ingame-1.26.52.json';
import { BUNDLED } from './pack';

/** Oxygen's own guides, copied next to the server at build time */
export const GUIDES: Record<string, { file: string; about: string }> = {
	'game-rules': { file: 'accuracy.md', about: "How the game really runs particles (quirks the docs don't mention), measured in-game" },
	molang: { file: 'molang.md', about: 'Writing Molang in particle files' },
};

function kindText(k: FieldKind): string {
	const unit = 'unit' in k && k.unit ? ` ${k.unit}` : '';
	switch (k.type) {
		case 'molang':
			return `Molang (number or expression)${k.default !== undefined && k.default !== null ? `, default ${k.default}` : ''}${unit}`;
		case 'vec':
			return `[${k.labels.join(', ')}], each Molang${k.default ? `, default [${k.default.join(', ')}]` : ''}${unit}`;
		case 'statements':
			return 'Molang statements (assignments, `;`-separated)';
		case 'number':
			return `number${k.default !== undefined ? `, default ${k.default}` : ''}${k.min !== undefined ? `, min ${k.min}` : ''}${k.max !== undefined ? `, max ${k.max}` : ''}${unit}`;
		case 'bool':
			return `boolean${k.default !== undefined ? `, default ${k.default}` : ''}`;
		case 'enum':
			return `one of ${k.options.map((o) => `"${o.value}"${o.help ? ` (${o.help})` : ''}`).join(', ')}${k.default ? `; default "${k.default}"` : ''}`;
		case 'string':
			return `string${k.default ? `, default "${k.default}"` : ''}`;
		case 'events':
			return 'event name or array of event names';
		case 'timeline':
			return `object: ${k.key === 'time' ? 'seconds' : 'blocks travelled'} → event name(s)`;
		case 'color':
			return 'colour: [r, g, b, a] Molang, "#AARRGGBB", or a gradient { "interpolant": Molang, "gradient": { "<t>": colour } }';
		case 'uv':
			return 'UV: texture_width/height, uv, uv_size (Molang), or a "flipbook" object';
		default:
			return k.type;
	}
}

const USAGE = [
	'Topics:',
	'- components: every component, by category',
	'- <component id>, e.g. minecraft:particle_appearance_billboard: its fields, defaults and when the game evaluates them',
	'- materials: render materials',
	'- phases: the order the game evaluates things in',
	'- queries (optionally with search): Molang queries a particle can use',
	'- <query name>, e.g. q.distance_from_camera: one query',
	'- math: Molang math functions',
	...Object.entries(GUIDES).map(([k, g]) => `- ${k}: ${g.about}`),
	"- measurements (optionally with search): every behaviour Oxygen's test pack measured in Minecraft, test by test, with the recorded result",
].join('\n');

/** The in-game test results: each test's question and what the game did */
function measurements(search: string | null): string {
	const results = (measured as { results: Record<string, { conclusion?: string }> }).results;
	const s = search?.toLowerCase() ?? '';
	const lines = [`Measured in Minecraft ${measured.game} (${measured.date}); Oxygen's engine reproduces every result (on an entity, with its model at rest: Oxygen doesn't play entity animations). What the content log reports at load:`, ...measured.loadLog.map((l: string) => `- ${l}`)];
	for (const t of [...TESTS, ...ENTITY_TESTS]) {
		const conclusion = results[t.id]?.conclusion ?? `not measured yet. Oxygen's assumption: ${t.assumption}`;
		if (s && !`${t.id} ${t.title} ${t.question} ${conclusion}`.toLowerCase().includes(s)) continue;
		lines.push('', `${t.id}. ${t.title}`, `Question: ${t.question}`, `Measured: ${conclusion}`);
	}
	return lines.join('\n');
}

export function reference(topic: string, search: string | null): string {
	const t = topic.trim();
	const lower = t.toLowerCase();
	if (!t || lower === 'help') return USAGE;
	if (lower === 'components') {
		const lines = ['Components (one per group: rate, lifetime, shape). Write them under particle_effect/components.'];
		for (const c of CATEGORIES) {
			lines.push('', `${c.label}:`);
			for (const info of COMPONENTS.filter((x) => x.category === c.id)) lines.push(`- ${info.id}${info.group ? ` [${info.group}]` : ''}: ${info.label}. ${info.help}`);
		}
		return lines.join('\n');
	}
	const component = COMPONENT_BY_ID.get(t) ?? COMPONENT_BY_ID.get(`minecraft:${t}`);
	if (component) {
		const lines = [`${component.id}: ${component.label} (${component.category}${component.group ? `, one ${component.group} component per effect` : ''})`, component.help];
		if (component.valueShape && component.valueShape !== 'object') lines.push(`Value shape: ${component.valueShape} (not an object)`);
		if (component.fields.length) lines.push('', 'Fields:');
		for (const f of component.fields) lines.push(`- ${f.key}${f.required ? ' (required)' : ''}: ${f.label}. ${kindText(f.kind)}. Evaluated in the ${f.phase} phase${f.measured ? ' (default measured in-game)' : ''}. ${f.help}`);
		return lines.join('\n');
	}
	if (lower === 'materials') return ['Materials (description/basic_render_parameters/material):', ...MATERIALS.map((m) => `- ${m.value}: ${m.label}. ${m.help}`)].join('\n');
	if (lower === 'phases') return ['Evaluation phases, in order:', ...PHASES.map((p) => `- ${p.id}: ${p.label}. ${p.detail}`)].join('\n');
	if (lower === 'measurements') return measurements(search);
	if (lower === 'math') return ['Math functions:', ...molangMetadata.math.map((m) => `- ${m.name}(${m.params.join(', ')}): ${m.description}`)].join('\n');
	if (lower === 'queries') {
		const s = search?.toLowerCase() ?? '';
		const found = molangMetadata.queries.filter((q) => !q.lastVersion && queryExists(q.name) && (!s || q.name.includes(s) || q.description.toLowerCase().includes(s)));
		// most queries describe entities; a particle emitter spawned by /particle or a script has none
		const lines = [`${found.length} queries${s ? ` matching "${s}"` : ''}. "entity" ones need an emitter attached to an entity; with /particle they read 0.`];
		for (const q of found) lines.push(`- ${q.name}${q.context === 'entity' ? ' [entity]' : ''}: ${q.description.split(/(?<=\.)\s/)[0]}`);
		return lines.join('\n');
	}
	const q = getQuery(t);
	const unusable = q ? queryUnavailable(q.name) : null;
	if (q && unusable) return [`${q.name} → ${q.returnType}`, q.description, `${unusable}. Going by the game's metadata it's a load error there, so the field falls back to its default (in-game test t66).`].join('\n');
	if (q) return [`${q.name} → ${q.returnType}`, q.description, `Arguments: ${q.minArgs}${q.maxArgs !== q.minArgs ? `–${q.maxArgs ?? 'any'}` : ''}. Context: ${q.context === 'entity' ? 'needs an emitter attached to an entity' : 'any emitter'}. Since ${q.firstVersion}${q.lastVersion ? `, removed after ${q.lastVersion}` : ''}.`].join('\n');
	const guide = GUIDES[lower];
	if (guide) {
		const file = join(BUNDLED.docs, guide.file);
		if (existsSync(file)) return readFileSync(file, 'utf8');
	}
	return `Nothing found for "${t}".\n\n${USAGE}`;
}
