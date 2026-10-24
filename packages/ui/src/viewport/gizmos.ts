/** Viewport helpers that can be hidden one by one */
export interface Gizmos {
	/** the ground plane and its grid */
	ground: boolean;
	/** the one-block outline, for scale */
	block: boolean;
	/** the effect's own emitter (axes and ring) */
	emitter: boolean;
	/** emitters its events spawn */
	children: boolean;
	killPlane: boolean;
	/** the stand-in entity, its locator and its path */
	entity: boolean;
}
export const DEFAULT_GIZMOS: Gizmos = { ground: true, block: true, emitter: true, children: true, killPlane: true, entity: true };

/** What a click on the viewport hit, other than a particle */
export type GizmoHit =
	| { kind: 'emitter'; id: number }
	| { kind: 'shape' }
	| { kind: 'killPlane' }
	| { kind: 'entity' }
	| { kind: 'locator'; name: string }
	| { kind: 'waypoint'; index: number }
	| { kind: 'block'; cell: [number, number, number] };

/**
 * What the viewport's move handles are on: dragged, or nudged with the arrow keys. `emitter` is the effect's own
 * emitter where it isn't on the entity; `extra` one of the scene's other effects.
 */
export type MoveTarget =
	| { kind: 'entity' }
	| { kind: 'locator'; name: string }
	| { kind: 'waypoint'; index: number }
	| { kind: 'block'; cell: [number, number, number] }
	| { kind: 'emitter' }
	| { kind: 'extra'; index: number };

/** Targets that turn as well as move (the entity only about the vertical, as it does in-game) */
export const canTurn = (t: MoveTarget | null): boolean => !!t && (t.kind === 'entity' || t.kind === 'emitter' || t.kind === 'extra');

export const sameTarget = (a: MoveTarget | null, b: MoveTarget | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * How many of each helper the viewport draws at most. Past the limit a sample is drawn, and a particle keeps
 * its helper for as long as it lives, so they don't jump from particle to particle.
 */
export interface GizmoLimits {
	/** particles with facing axes */
	facing: number;
	/** particles with velocity lines */
	velocity: number;
	/** emitter markers */
	emitters: number;
	/** emitters with their shape outlined */
	shapes: number;
}
export const DEFAULT_GIZMO_LIMITS: GizmoLimits = { facing: 500, velocity: 2000, emitters: 1000, shapes: 256 };
export const GIZMO_LIMIT_CHOICES: Record<keyof GizmoLimits, number[]> = {
	facing: [64, 200, 500, 1000, 2000, 5000],
	velocity: [256, 1000, 2000, 5000, 10000, 20000],
	emitters: [256, 1000, 2000, 5000],
	shapes: [64, 256, 1000],
};
