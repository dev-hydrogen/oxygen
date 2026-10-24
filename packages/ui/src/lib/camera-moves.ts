/** Camera moves for recordings: each a path from the view the recording starts at, round what it looks at */

export type CameraMove = 'still' | 'orbit' | 'sway' | 'push' | 'pull' | 'rise' | 'spiral';

export const CAMERA_MOVES: { id: CameraMove; label: string; help: string }[] = [
	{ id: 'still', label: 'Still', help: 'The view as it is' },
	{ id: 'orbit', label: 'Orbit', help: 'Once round, at an even speed: the end meets the start, so a looping GIF loops' },
	{ id: 'sway', label: 'Sway', help: 'Side to side and back, 30° each way' },
	{ id: 'push', label: 'Push in', help: 'Closer, slowing down at the end' },
	{ id: 'pull', label: 'Pull back', help: 'Further away, slowing down at the end' },
	{ id: 'rise', label: 'Rise', help: 'Up and over, looking down, with a quarter turn' },
	{ id: 'spiral', label: 'Spiral', help: 'Once round while rising and coming closer' },
];

/** how long one move takes when a recording runs until the effect ends (its length isn't known in advance) */
export const CAMERA_MOVE_SECONDS = 8;

type V3 = [number, number, number];
export interface View {
	position: V3;
	target: V3;
}

const ease = (f: number) => {
	const t = Math.min(1, Math.max(0, f));
	return t * t * (3 - 2 * t);
};

/**
 * Where the camera is `f` of the way through a move (0 the start, 1 the end; orbit and sway carry on past 1),
 * from the view `start`. The camera always looks at the start's target.
 */
export function cameraAt(move: CameraMove, start: View, f: number): View {
	const [tx, ty, tz] = start.target;
	const dx = start.position[0] - tx, dy = start.position[1] - ty, dz = start.position[2] - tz;
	const r0 = Math.hypot(dx, dy, dz) || 1;
	const az0 = Math.atan2(dx, dz);
	const el0 = Math.asin(Math.max(-1, Math.min(1, dy / r0)));
	let r = r0, az = az0, el = el0;
	const TAU = Math.PI * 2;
	switch (move) {
		case 'still':
			return { position: [...start.position], target: [...start.target] };
		case 'orbit':
			az = az0 + TAU * f;
			break;
		case 'sway':
			az = az0 + (Math.PI / 6) * Math.sin(TAU * f);
			break;
		case 'push':
			r = r0 * (1 - 0.4 * ease(f));
			break;
		case 'pull':
			r = r0 * (1 + 0.6 * ease(f));
			break;
		case 'rise': {
			const e = ease(f);
			el = el0 + (Math.min(Math.PI * 0.42, el0 + Math.PI / 5) - el0) * e;
			az = az0 + (Math.PI / 2) * e;
			break;
		}
		case 'spiral': {
			az = az0 + TAU * f;
			const e = ease(f);
			el = el0 + (Math.min(Math.PI * 0.4, el0 + Math.PI / 6) - el0) * e;
			r = r0 * (1 - 0.25 * e);
			break;
		}
	}
	const c = Math.cos(el);
	return { position: [tx + r * c * Math.sin(az), ty + r * Math.sin(el), tz + r * c * Math.cos(az)], target: [tx, ty, tz] };
}
