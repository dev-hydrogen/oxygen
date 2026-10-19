import type { Scenario } from '@oxygen/format';
import type { CameraState, ContentError, PlaneCollider, PortableEmitter, Quat, SpawnContext, Vec3 } from 'wintersky';

/** What a simulation worker needs to run part of an effect exactly like the main thread would */
export interface SimSetup {
	engine: string | readonly number[] | null;
	seed: number;
	caps: Record<SpawnContext, number>;
	/** effect JSON by identifier: the root and every child its events can spawn */
	effects: Record<string, unknown>;
	blocks: { palette: unknown[]; blocks: number[] } | null;
	planes: PlaneCollider[];
	scenario: Scenario | null;
	/** entity_aabb of the stand-in entity's locator, for attached emitters */
	aabb: { min: Vec3; max: Vec3 } | null;
	/** this worker's own id range, so emitters and particles it creates never collide with others */
	emitterBase: number;
	particleBase: number;
	/** the main world's clock when the emitters move over */
	time: number;
	frame: number;
}

/** Everything outside the simulation that one frame reads */
export interface FrameInputs {
	dt: number;
	camera: CameraState;
	cull: boolean;
	timeOfDay: number;
	/** the stand-in entity (entity spawn mode), and its locator's transform for attached emitters */
	entity: { position: Vec3; velocity: Vec3; yaw: number } | null;
	attachment: { position: Vec3; rotation: Quat; scale: number; alive: boolean } | null;
}

export type ToSim =
	| { type: 'setup'; setup: SimSetup }
	| { type: 'adopt'; emitters: PortableEmitter[] }
	| { type: 'step'; seq: number; inputs: FrameInputs }
	/** hand every emitter back */
	| { type: 'recall'; seq: number }
	| { type: 'clear' };

/** Every emitter's particles of one frame, end to end (one array per attribute, not one per emitter) */
export interface PackedArrays {
	pos: Float32Array;
	size: Float32Array;
	rot: Float32Array;
	facing: Float32Array;
	uv: Float32Array;
	color: Uint8Array;
	visible: Uint8Array;
	local: Uint8Array;
	id: Uint32Array;
}

/** One emitter's state after a frame: what drawing, markers, picking and stats need */
export interface RemoteFrame {
	id: number;
	parentId: number | null;
	effect: string;
	count: number;
	culled: boolean;
	localSpace: boolean;
	expired: boolean;
	position: Vec3;
	rotation: Quat;
	activeTime: number;
	sleepTime: number;
	cap: number;
	/** where this emitter's particles start in the frame's packed arrays */
	offset: number;
}

export type FromSim =
	| { type: 'frame'; seq: number; time: number; emitters: RemoteFrame[]; packed: PackedArrays; errors: ContentError[] | null }
	| { type: 'recalled'; seq: number; emitters: PortableEmitter[] }
	| { type: 'failed'; message: string };
