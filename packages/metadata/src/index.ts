import molang from '../generated/molang-metadata.json';

export interface MathFunctionInfo {
	name: string;
	params: string[];
	minArgs: number;
	maxArgs: number;
	description: string;
}

export interface QueryInfo {
	name: string;
	minArgs: number;
	maxArgs: number | null;
	returnType: string;
	description: string;
	firstVersion: string;
	lastVersion: string | null;
	sets: string[];
	/** 'any' = usable by world-spawned emitters; 'entity' = needs an emitter attached to an actor */
	context: 'any' | 'entity';
}

export interface MolangMetadata {
	source: string;
	game: string;
	math: MathFunctionInfo[];
	queries: QueryInfo[];
}

export const molangMetadata = molang as MolangMetadata;

const queryIndex = new Map(molangMetadata.queries.map((q) => [q.name, q]));
const mathIndex = new Map(molangMetadata.math.map((m) => [m.name, m]));

/** Look up a query by full or short name (`q.position` / `query.position`). */
export function getQuery(name: string): QueryInfo | undefined {
	const lower = name.toLowerCase();
	return queryIndex.get(lower.startsWith('q.') ? 'query.' + lower.slice(2) : lower);
}

export function getMathFunction(name: string): MathFunctionInfo | undefined {
	return mathIndex.get(name.toLowerCase());
}

/**
 * Query registry for particle Molang: unknown queries are load errors in-game (the field is dropped), and so,
 * going by the game's own metadata, are queries outside the `default` query set: `world_gen` ones (q.heightmap,
 * q.above_top_solid, q.noise, the biome tags) are for world generation and `tags` ones for tag expressions.
 * The game's message says as much: "Either the query does not exist or it is not supported in this context."
 */
export function queryExists(name: string): boolean {
	const q = getQuery(name);
	return q !== undefined && (q.sets.length === 0 || q.sets.includes('default'));
}

/** Why a query that exists can't be used in particle Molang (its query set), or null */
export function queryUnavailable(name: string): string | null {
	const q = getQuery(name);
	if (!q || q.sets.length === 0 || q.sets.includes('default')) return null;
	if (q.sets.includes('world_gen')) return `${q.name} is a world generation query: particle Molang can't use it`;
	return `${q.name} belongs to the game's ${q.sets.join(' and ')} queries, which particle Molang can't use`;
}

/** A load error's message, with why a query that does exist can't be used here put first */
export function explainQueryError(message: string): string {
	const m = /^Failed to resolve query (query\.[a-z0-9_.]+?)\.\s/i.exec(message);
	const why = m ? queryUnavailable(m[1]) : null;
	return why ? `${why}. ${message}` : message;
}
