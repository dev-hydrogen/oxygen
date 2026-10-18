import * as THREE from 'three';

/**
 * Viewport camera, like a 3D editor's:
 * - left drag orbits around the point under the cursor (a particle, else the ground), marked while dragging
 * - right drag looks around in place; with W A S D (Q E) held it flies
 * - middle drag (or Shift + left) pans, keeping the grabbed point under the cursor
 * - the wheel moves toward what's under the cursor by a share of the distance to it, so it neither crawls
 *   near an invisible pivot nor overshoots far away
 * No roll: the camera keeps the world's up. `target` is the point it looks at, `focus` ahead; other code
 * (grid, clipping, bookmarks) reads it, and `lookAtTarget` points the camera after setting it.
 */
export class CameraRig {
	readonly target = new THREE.Vector3();
	/** shown while orbiting: what the camera turns around */
	readonly pivotMarker: THREE.Mesh;
	/** Settings › Viewport: how fast dragging turns (1 = a full turn per 1.6 viewport heights), up/down flipped, wheel speed */
	turnSpeed = 1;
	invertY = false;
	zoomSpeed = 1;
	private yaw = 0;
	private pitch = 0;
	private focus = 5;
	private drag: { mode: 'orbit' | 'look' | 'pan'; x: number; y: number; pivot: THREE.Vector3; depth: number; id: number } | null = null;
	/** two-finger touch: pinch moves along the view, the midpoint pans */
	private touches = new Map<number, { x: number; y: number }>();

	constructor(
		private camera: THREE.PerspectiveCamera,
		private dom: HTMLElement,
		/** the world point under a pixel of the canvas (a particle, the ground), or null */
		private pointUnder: (x: number, y: number) => THREE.Vector3 | null,
	) {
		this.pivotMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0x93bdf5, depthTest: false, transparent: true, opacity: 0.9 }));
		this.pivotMarker.renderOrder = 20;
		this.pivotMarker.visible = false;
		dom.addEventListener('pointerdown', this.onDown);
		dom.addEventListener('pointermove', this.onMove);
		dom.addEventListener('pointerup', this.onUp);
		dom.addEventListener('pointercancel', this.onUp);
		dom.addEventListener('wheel', this.onWheel, { passive: false });
		dom.addEventListener('contextmenu', this.onContext);
	}

	get forward(): THREE.Vector3 {
		const cp = Math.cos(this.pitch);
		return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
	}

	/** Point the camera at `target` from where it is (after setting both from outside) */
	lookAtTarget(): void {
		const d = this.target.clone().sub(this.camera.position);
		this.focus = Math.max(0.01, d.length());
		d.normalize();
		this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
		this.yaw = Math.atan2(-d.x, -d.z);
		this.apply();
	}

	/** Write the pose to the camera; the target follows, `focus` ahead */
	update(): void {
		this.apply();
	}

	private apply() {
		const limit = Math.PI / 2 - 0.001;
		this.pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit);
		this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
		this.target.copy(this.camera.position).addScaledVector(this.forward, this.focus);
	}

	/** Move the camera (and what it looks at) by `v`, in world units */
	translate(v: THREE.Vector3): void {
		this.camera.position.add(v);
		this.apply();
	}

	/** how far ahead the camera's attention is: fly speed and the like scale with it */
	get distance(): number {
		return this.focus;
	}

	private local(e: PointerEvent | WheelEvent) {
		const r = this.dom.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
	}

	/** The ray through a canvas pixel */
	private ray(x: number, y: number, w: number, h: number): THREE.Ray {
		const ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
		const rc = new THREE.Raycaster();
		this.camera.updateMatrixWorld();
		rc.setFromCamera(ndc, this.camera);
		return rc.ray;
	}

	/** what's under the cursor, else the point at the current focus distance along its ray */
	private grab(x: number, y: number, w: number, h: number): THREE.Vector3 {
		const hit = this.pointUnder(x, y);
		if (hit) return hit;
		const r = this.ray(x, y, w, h);
		return r.origin.clone().addScaledVector(r.direction, this.focus);
	}

	private depthOf(p: THREE.Vector3): number {
		return Math.max(0.01, p.clone().sub(this.camera.position).dot(this.forward));
	}

	private onContext = (e: Event) => e.preventDefault();

	private onDown = (e: PointerEvent) => {
		const { x, y, w, h } = this.local(e);
		if (e.pointerType === 'touch') {
			this.touches.set(e.pointerId, { x, y });
			if (this.touches.size === 2) this.drag = null;
			if (this.touches.size !== 1) return;
		}
		const mode = e.button === 2 ? 'look' : e.button === 1 || (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey)) ? 'pan' : e.button === 0 ? 'orbit' : null;
		if (!mode) return;
		this.dom.setPointerCapture(e.pointerId);
		const pivot = mode === 'look' ? this.camera.position.clone() : this.grab(x, y, w, h);
		this.drag = { mode, x, y, pivot, depth: this.depthOf(pivot), id: e.pointerId };
		if (mode === 'orbit') {
			// the pivot becomes what the camera attends to: zoom and fly speed follow it
			this.focus = this.depthOf(pivot);
			this.apply();
		}
	};

	private onMove = (e: PointerEvent) => {
		const { x, y, w, h } = this.local(e);
		if (e.pointerType === 'touch' && this.touches.has(e.pointerId) && this.touches.size === 2) {
			const prev = [...this.touches.values()];
			const pm = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
			const pd = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
			this.touches.set(e.pointerId, { x, y });
			const now = [...this.touches.values()];
			const nm = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
			const nd = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
			this.panBy(nm.x - pm.x, nm.y - pm.y, this.focus, h);
			if (pd > 0 && nd > 0) this.dollyToward(nm.x, nm.y, w, h, nd / pd);
			return;
		}
		if (e.pointerType === 'touch') this.touches.set(e.pointerId, { x, y });
		const d = this.drag;
		if (!d || d.id !== e.pointerId) return;
		const dx = x - d.x;
		const dy = y - d.y;
		d.x = x;
		d.y = y;
		if (!dx && !dy) return;
		if (d.mode === 'pan') return this.panBy(dx, dy, d.depth, h);
		const rate = ((2 * Math.PI) / Math.max(400, h * 1.6)) * this.turnSpeed;
		const dYaw = -dx * rate;
		let dPitch = (this.invertY ? dy : -dy) * rate;
		const limit = Math.PI / 2 - 0.001;
		dPitch = THREE.MathUtils.clamp(this.pitch + dPitch, -limit, limit) - this.pitch;
		if (d.mode === 'look') {
			this.yaw += dYaw;
			this.pitch += dPitch;
			this.apply();
			return;
		}
		// orbit: turn the camera's position and its view by the same rotation, so the pivot stays put on screen
		this.pivotMarker.visible = true;
		const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		const offset = this.camera.position.clone().sub(d.pivot);
		offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dYaw);
		right.applyAxisAngle(new THREE.Vector3(0, 1, 0), dYaw);
		offset.applyAxisAngle(right, dPitch);
		this.camera.position.copy(d.pivot).add(offset);
		this.yaw += dYaw;
		this.pitch += dPitch;
		this.apply();
	};

	private onUp = (e: PointerEvent) => {
		this.touches.delete(e.pointerId);
		if (this.drag?.id !== e.pointerId) return;
		if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
		this.drag = null;
		this.pivotMarker.visible = false;
	};

	private onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const { x, y, w, h } = this.local(e);
		// a notch (100 px, 3 lines) moves 15% of the way to what's under the cursor
		const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * h : e.deltaY;
		this.dollyToward(x, y, w, h, Math.pow(0.85, (px * this.zoomSpeed) / 100));
	};

	/** Move along the ray through (x, y) so the distance to what's there scales by 1/`factor` */
	private dollyToward(x: number, y: number, w: number, h: number, factor: number) {
		const r = this.ray(x, y, w, h);
		const hit = this.pointUnder(x, y);
		const dist = hit ? hit.distanceTo(r.origin) : this.focus;
		const step = dist - dist / factor;
		const move = r.direction.clone().multiplyScalar(step);
		this.camera.position.add(move);
		this.focus = Math.max(0.05, (hit ? this.depthOf(hit) : this.focus - move.dot(this.forward)));
		this.apply();
	}

	private panBy(dx: number, dy: number, depth: number, h: number) {
		const perPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / Math.max(1, h);
		const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		const up = new THREE.Vector3().crossVectors(right, this.forward).normalize();
		this.camera.position.addScaledVector(right, -dx * perPixel).addScaledVector(up, dy * perPixel);
		this.apply();
	}

	/** keep the pivot marker a constant size on screen */
	updateMarker(viewportHeight: number): void {
		if (!this.drag || !this.pivotMarker.visible) return;
		this.pivotMarker.position.copy(this.drag.pivot);
		const perPixel = (2 * this.depthOf(this.drag.pivot) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / Math.max(1, viewportHeight);
		this.pivotMarker.scale.setScalar(perPixel * 4);
	}

	dispose(): void {
		this.dom.removeEventListener('pointerdown', this.onDown);
		this.dom.removeEventListener('pointermove', this.onMove);
		this.dom.removeEventListener('pointerup', this.onUp);
		this.dom.removeEventListener('pointercancel', this.onUp);
		this.dom.removeEventListener('wheel', this.onWheel);
		this.dom.removeEventListener('contextmenu', this.onContext);
		this.pivotMarker.geometry.dispose();
		(this.pivotMarker.material as THREE.Material).dispose();
	}
}
