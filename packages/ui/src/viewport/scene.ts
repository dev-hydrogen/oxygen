import * as THREE from 'three';
import { ParticleRenderer, type TextureProvider } from 'wintersky/render';
import type { EffectSession } from '../state/session.svelte';
import { GroundGrid } from './grid';
import { sampleTrajectories } from '../lib/sampler';
import { SceneObjects } from './sceneObjects';
import { VibrantPipeline } from './vibrant';
import { EmitterMarkers, FacingOverlay, ShapeGizmo, VelocityOverlay } from './overlays';
import { CameraRig } from './camera';
import { DEFAULT_GIZMOS, type GizmoHit, type Gizmos } from './gizmos';

/** the classic viewport's background */
const BACKDROP = 0x161a26;

export interface ViewportOptions {
	textures: TextureProvider;
	mers?: TextureProvider;
}

/**
 * The 3D preview: camera, helpers and the particle renderer. Owns the render loop for one canvas and
 * drives the active session's simulation from it.
 */
export class ViewportScene {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 2000);
	readonly controls: CameraRig;
	readonly particles: ParticleRenderer;
	private session: EffectSession | null = null;
	private grid = new THREE.Group();
	private marker = new THREE.Group();
	private killPlane: THREE.Mesh;
	private selectRing: THREE.Mesh;
	private paths = new THREE.Group();
	private facing = new FacingOverlay();
	private emitterMarkers = new EmitterMarkers();
	private shapes = new ShapeGizmo();
	private velocities = new VelocityOverlay();
	readonly objects = new SceneObjects();
	private vibrant: VibrantPipeline;
	/** classic, Vibrant Visuals approximation, or both side by side (classic left) */
	renderMode: 'classic' | 'vv' | 'split' = 'classic';
	/** Vibrant Visuals draws the game's sky behind particles; off keeps the classic backdrop, to compare just the particles */
	vvSky = true;
	private pathsKey = '';
	private pathsTimer: ReturnType<typeof setTimeout> | null = null;
	private raf = 0;
	private last = 0;
	private disposed = false;
	showGrid = true;
	showKillPlane = true;
	showMarker = true;
	/** which helpers are drawn (each can be hidden on its own) */
	gizmos: Gizmos = { ...DEFAULT_GIZMOS };
	fps = 0;
	/** keys held for fly movement (W A S D Q E, Shift to go faster) */
	private keys = new Set<string>();
	private onKeyDown = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const k = e.key.toLowerCase();
		if ('wasdqe'.includes(k) && k.length === 1) {
			this.keys.add(k);
			e.preventDefault();
		}
		if (e.key === 'Shift') this.keys.add('shift');
		if (k === 'f' && !e.repeat) this.frameAll();
	};
	private onKeyUp = (e: KeyboardEvent) => {
		this.keys.delete(e.key.toLowerCase());
		if (e.key === 'Shift') this.keys.delete('shift');
	};
	private onBlur = () => this.keys.clear();
	private fpsAcc = 0;
	private fpsFrames = 0;

	constructor(
		private canvas: HTMLCanvasElement,
		options: ViewportOptions,
	) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setClearColor(BACKDROP, 1);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.camera.position.set(3.6, 3.4, 5.2);
		this.controls = new CameraRig(this.camera, canvas, (x, y) => this.pointUnder(x, y));
		this.controls.target.set(0, 0.6, 0);
		this.controls.lookAtTarget();
		this.scene.add(this.controls.pivotMarker);
		canvas.addEventListener('keydown', this.onKeyDown);
		canvas.addEventListener('keyup', this.onKeyUp);
		canvas.addEventListener('blur', this.onBlur);

		this.particles = new ParticleRenderer({ textures: options.textures, mers: options.mers, sortBlended: true });
		this.scene.add(this.particles.group);
		this.buildGrid();
		this.scene.add(this.grid);
		this.buildMarker();
		this.scene.add(this.marker);

		this.killPlane = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({ color: 0xff7470, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
		);
		const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0xff7470, transparent: true, opacity: 0.6 }));
		this.killPlane.add(edge);
		this.killPlane.visible = false;
		this.scene.add(this.killPlane);

		this.selectRing = new THREE.Mesh(
			new THREE.RingGeometry(0.85, 1, 32),
			new THREE.MeshBasicMaterial({ color: 0x93bdf5, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
		);
		this.selectRing.renderOrder = 20;
		this.selectRing.visible = false;
		this.scene.add(this.selectRing);
		this.scene.add(this.paths);
		this.scene.add(this.facing.object, this.emitterMarkers.object, this.shapes.object, this.velocities.object);
		this.scene.add(this.objects.group);
		this.vibrant = new VibrantPipeline(this.renderer, this.scene, this.camera);
		// lights for the block preview only (particles use the game's own lighting model)
		this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3428, 1.6));
		const sun = new THREE.DirectionalLight(0xffffff, 1.4);
		sun.position.set(3, 8, 5);
		this.scene.add(sun);
	}

	private ground = new GroundGrid();
	private scaleBlock: THREE.Object3D | null = null;

	private buildGrid() {
		this.grid.add(this.ground.mesh);
		// one block, for scale
		const block = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x5a6482 }));
		block.position.set(2.5, 0.5, -0.5);
		this.scaleBlock = block;
		this.grid.add(block);
	}

	private buildMarker() {
		const axis = (color: number, to: [number, number, number]) => {
			const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(...to)]);
			return new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
		};
		this.marker.add(axis(0xe86f6f, [0.25, 0, 0]), axis(0x8fd16a, [0, 0.25, 0]), axis(0x6fa8ef, [0, 0, 0.25]));
		const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 24), new THREE.MeshBasicMaterial({ color: 0xdfe5f0, depthTest: false, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
		ring.userData.billboard = true;
		this.marker.add(ring);
		this.marker.renderOrder = 10;
	}

	// a newly shown effect keeps the default view; F (or Frame) frames the particles on request
	setSession(session: EffectSession | null): void {
		this.session = session;
	}

	/** suspended by the host (VS Code tab in the background) */
	private suspended = false;
	private running = false;
	private onVisibility = () => this.updateRunning();

	start(): void {
		document.addEventListener('visibilitychange', this.onVisibility);
		this.updateRunning();
	}

	/** Stop simulating and drawing while nobody can see the viewport (background tabs, hidden webviews) */
	setSuspended(on: boolean): void {
		this.suspended = on;
		this.updateRunning();
	}

	private updateRunning(): void {
		const run = !this.disposed && !this.suspended && document.visibilityState !== 'hidden';
		if (run === this.running) return;
		this.running = run;
		if (!run) {
			cancelAnimationFrame(this.raf);
			return;
		}
		// resume without a giant first step
		this.last = 0;
		const loop = (t: number) => {
			if (!this.running) return;
			this.raf = requestAnimationFrame(loop);
			const dt = this.last ? (t - this.last) / 1000 : 0;
			this.last = t;
			this.frame(dt);
		};
		this.raf = requestAnimationFrame(loop);
	}

	resize(width: number, height: number): void {
		if (width <= 0 || height <= 0) return;
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	/**
	 * The world point under a canvas pixel, for orbiting and zooming around it: the nearest particle within a
	 * few pixels, else the ground when it isn't far off toward the horizon
	 */
	private pointUnder(x: number, y: number): THREE.Vector3 | null {
		const s = this.session;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		this.camera.updateMatrixWorld();
		const v = new THREE.Vector3();
		const p: [number, number, number] = [0, 0, 0];
		let best: THREE.Vector3 | null = null;
		let bestD = 14 * 14;
		const emitters = s ? [...s.world.emitters, ...s.parallel.remote.values()] : [];
		let budget = 20000;
		for (const e of emitters) {
			for (let i = 0; i < e.pool.count && budget > 0; i++, budget--) {
				if (!e.pool.visible[i]) continue;
				e.particleWorldPos(i, p);
				v.set(p[0], p[1], p[2]).project(this.camera);
				if (v.z < -1 || v.z > 1) continue;
				const d = ((v.x + 1) / 2 * w - x) ** 2 + ((1 - v.y) / 2 * h - y) ** 2;
				if (d < bestD) {
					bestD = d;
					best = new THREE.Vector3(p[0], p[1], p[2]);
				}
			}
		}
		if (best) return best;
		const groundY = s?.scene.ground === 'plane' ? (s.scene.groundY ?? 0) : 0;
		const rc = new THREE.Raycaster();
		rc.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
		const hit = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY), new THREE.Vector3());
		if (hit && hit.distanceTo(this.camera.position) <= Math.max(20, this.controls.distance * 3)) return hit;
		return null;
	}

	/** Move the camera and what it looks at together along the view axes */
	private fly(dt: number) {
		if (!this.keys.size) return;
		const dist = this.controls.distance;
		const speed = Math.max(0.5, dist) * (this.keys.has('shift') ? 3 : 1) * dt;
		const fwd = new THREE.Vector3();
		this.camera.getWorldDirection(fwd);
		const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
		const move = new THREE.Vector3();
		if (this.keys.has('w')) move.add(fwd);
		if (this.keys.has('s')) move.sub(fwd);
		if (this.keys.has('d')) move.add(right);
		if (this.keys.has('a')) move.sub(right);
		if (this.keys.has('e')) move.y += 1;
		if (this.keys.has('q')) move.y -= 1;
		if (move.lengthSq() === 0) return;
		move.normalize().multiplyScalar(speed);
		this.controls.translate(move);
	}

	/** Current view, for bookmarks */
	view(): { position: [number, number, number]; target: [number, number, number]; fov: number } {
		return { position: this.camera.position.toArray() as [number, number, number], target: this.controls.target.toArray() as [number, number, number], fov: this.camera.fov };
	}

	setView(v: { position: [number, number, number]; target: [number, number, number]; fov?: number }): void {
		this.camera.position.set(...v.position);
		this.controls.target.set(...v.target);
		if (v.fov) {
			this.camera.fov = v.fov;
			this.camera.updateProjectionMatrix();
		}
		this.controls.lookAtTarget();
	}

	/**
	 * Advance the session by `dt` and draw. The animation loop calls this; headless renderers drive it directly,
	 * with `draw` off for frames nobody looks at.
	 */
	frame(dt: number, draw = true): void {
		this.fly(dt);
		this.controls.update();
		this.controls.updateMarker(this.canvas.clientHeight);
		this.adaptClipping();
		const s = this.session;
		if (s) {
			this.syncWorldCamera(s);
			s.tick(dt);
		}
		if (!draw) return;
		if (s) this.updateHelpers(s);
		this.grid.visible = this.showGrid;
		this.ground.mesh.visible = this.gizmos.ground;
		if (this.scaleBlock) this.scaleBlock.visible = this.gizmos.block;
		this.objects.showEntity = this.gizmos.entity;
		const groundY = s?.scene.ground === 'plane' ? (s.scene.groundY ?? 0) : 0;
		if (this.showGrid) this.ground.update(this.controls.target, this.camera.position.distanceTo(this.controls.target), groundY);
		if (this.scaleBlock) this.scaleBlock.position.y = groundY + 0.5;
		this.draw(s);
		this.fpsAcc += dt;
		this.fpsFrames++;
		if (this.fpsAcc >= 0.5) {
			this.fps = Math.round(this.fpsFrames / this.fpsAcc);
			this.fpsAcc = 0;
			this.fpsFrames = 0;
		}
	}

	private draw(s: EffectSession | null) {
		const mode = s ? this.renderMode : 'classic';
		const r = this.renderer;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		// this thread's emitters and any running in workers
		const all = () => (s ? [...s.world.emitters, ...s.parallel.remote.values()] : []);
		const classic = () => {
			this.particles.vibrant = null;
			this.scene.background = null;
			if (s) this.particles.syncEmitters(all(), this.camera);
		};
		const vibrant = () => {
			this.particles.vibrant = VibrantPipeline.settings(s!.vvLighting, s!.timeOfDay, s!.vvFromPack.lighting);
			// the measured sky, so blended and additive particles sit on what the game shows behind them; or the
			// classic backdrop, run backwards through the tone mapper so it comes out the same
			this.scene.background = this.vvSky ? VibrantPipeline.sky(s!.timeOfDay) : VibrantPipeline.backdrop(s!.vvGrading.toneMapper, BACKDROP);
			this.particles.syncEmitters(all(), this.camera);
		};
		if (mode === 'classic') {
			classic();
			r.render(this.scene, this.camera);
		} else if (mode === 'vv') {
			vibrant();
			this.vibrant.render(s!.vvGrading);
		} else {
			// split: classic on the left half, Vibrant Visuals on the right, same camera
			const half = Math.floor(w / 2);
			classic();
			r.setScissorTest(true);
			r.setScissor(0, 0, half, h);
			r.setViewport(0, 0, half, h);
			this.camera.aspect = half / h;
			this.camera.updateProjectionMatrix();
			r.render(this.scene, this.camera);
			vibrant();
			this.vibrant.render(s!.vvGrading, { x: half, y: 0, w: w - half, h });
			r.setScissorTest(false);
			r.setViewport(0, 0, w, h);
			this.camera.aspect = w / h;
			this.camera.updateProjectionMatrix();
		}
	}

	/** Near/far follow the orbit distance so tiny and huge effects both render (no z-fighting, no clipping) */
	private adaptClipping() {
		const dist = this.camera.position.distanceTo(this.controls.target);
		const near = Math.max(0.001, dist / 2000);
		const far = Math.max(200, dist * 400);
		if (Math.abs(near - this.camera.near) > near * 0.1 || Math.abs(far - this.camera.far) > far * 0.1) {
			this.camera.near = near;
			this.camera.far = far;
			this.camera.updateProjectionMatrix();
		}
	}

	private syncWorldCamera(s: EffectSession) {
		const c = s.world.camera;
		const cam = this.camera;
		cam.updateMatrixWorld();
		const e = cam.matrixWorld.elements;
		c.position = [e[12], e[13], e[14]];
		c.right = [e[0], e[1], e[2]];
		c.up = [e[4], e[5], e[6]];
		c.forward = [-e[8], -e[9], -e[10]];
		c.fovY = cam.fov;
		c.aspect = cam.aspect;
		c.near = cam.near;
		c.far = cam.far;
	}

	private updateHelpers(s: EffectSession) {
		const root = s.rootEmitter ?? s.world.emitters[0];
		const pos = root ? root.position : [0, 0, 0];
		this.marker.visible = this.showMarker && this.gizmos.emitter;
		this.marker.position.set(pos[0], pos[1], pos[2]);
		if (root) this.marker.quaternion.set(root.rotation[0], root.rotation[1], root.rotation[2], root.rotation[3]);
		if (this.showMarker && this.gizmos.children) this.emitterMarkers.update([...s.world.emitters, ...s.parallel.remote.values()], s.world.camera, root?.id ?? null);
		else this.emitterMarkers.object.visible = false;
		if (s.showFacing) this.facing.update(s.world, s.world.camera, s.selection);
		else this.facing.hide();
		if (s.showShape) this.shapes.update([...s.world.emitters, ...s.parallel.remote.values()], s.world.camera);
		else this.shapes.hide();
		if (s.showVelocity) this.velocities.update(s.world);
		else this.velocities.hide();
		const scale = this.camera.position.distanceTo(this.marker.position) * 0.18;
		this.marker.scale.setScalar(Math.max(0.05, scale));
		for (const child of this.marker.children) if (child.userData.billboard) child.quaternion.copy(this.marker.quaternion.clone().invert().multiply(this.camera.quaternion));

		this.updatePaths(s);
		this.objects.sync(s);
		// classic particle lighting: the renderer counts time from sunrise, queries from midnight
		this.particles.lighting = { skyLight: s.scene.skyLight, blockLight: s.scene.blockLight, timeOfDay: (s.timeOfDay - 0.25 + 1) % 1 };

		// inspected particle
		const sel = s.selection;
		const em = sel ? s.world.emitters.find((e) => e.id === sel.emitter) : undefined;
		const idx = em && sel ? em.pool.indexOfId(sel.particle) : -1;
		if (em && sel && sel.particle < 0) {
			// an inspected emitter: the ring sits on it
			this.selectRing.position.set(em.position[0], em.position[1], em.position[2]);
			this.selectRing.quaternion.copy(this.camera.quaternion);
			this.selectRing.scale.setScalar(this.camera.position.distanceTo(this.selectRing.position) * 0.03);
			this.selectRing.visible = true;
		} else if (em && idx >= 0) {
			const p: [number, number, number] = [0, 0, 0];
			em.particleWorldPos(idx, p);
			this.selectRing.position.set(p[0], p[1], p[2]);
			this.selectRing.quaternion.copy(this.camera.quaternion);
			const size = Math.max(Math.abs(em.pool.size[idx * 2]), Math.abs(em.pool.size[idx * 2 + 1]));
			const px = this.camera.position.distanceTo(this.selectRing.position) * 0.012;
			this.selectRing.scale.setScalar(Math.max(size * 1.35, px * 2));
			this.selectRing.visible = true;
		} else this.selectRing.visible = false;

		const kp = s.def?.particle.killPlane;
		if (kp && this.showKillPlane && this.gizmos.killPlane && (kp[0] || kp[1] || kp[2])) {
			// plane: a*x + b*y + c*z + d = 0, relative to the emitter
			const n = new THREE.Vector3(kp[0], kp[1], kp[2]);
			const len = n.length();
			n.divideScalar(len);
			const offset = -kp[3] / len;
			this.killPlane.visible = true;
			this.killPlane.position.set(pos[0] + n.x * offset, pos[1] + n.y * offset, pos[2] + n.z * offset);
			this.killPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
			const size = Math.max(4, this.camera.position.distanceTo(this.controls.target) * 1.5);
			this.killPlane.scale.set(size, size, 1);
		} else this.killPlane.visible = false;
	}

	/** Trajectory ghosts: recomputed (debounced) when the effect changes or the toggle flips */
	private updatePaths(s: EffectSession) {
		const key = s.showPaths ? `${s.id}:${s.version}:${s.spawnMode}` : '';
		if (key === this.pathsKey) return;
		this.pathsKey = key;
		if (this.pathsTimer) clearTimeout(this.pathsTimer);
		if (!key) {
			this.clearPaths();
			return;
		}
		this.pathsTimer = setTimeout(() => {
			this.clearPaths();
			const color = new THREE.Color(0xa3d46c);
			for (const line of sampleTrajectories(s, 10)) {
				const g = new THREE.BufferGeometry().setFromPoints(line.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
				const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
				const l = new THREE.Line(g, m);
				l.renderOrder = 5;
				this.paths.add(l);
				// a dot where each particle starts
				const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color }));
				dot.position.set(line[0][0], line[0][1], line[0][2]);
				this.paths.add(dot);
			}
		}, 200);
	}

	private clearPaths() {
		for (const c of [...this.paths.children]) {
			this.paths.remove(c);
			const o = c as THREE.Mesh;
			o.geometry.dispose();
			(o.material as THREE.Material).dispose();
		}
	}

	/** Place (or with `remove`, delete) a block under a viewport point. Returns false when nothing was hit. */
	paint(x: number, y: number, remove: boolean): boolean {
		const s = this.session;
		if (!s || !s.painting) return false;
		const ray = new THREE.Raycaster();
		ray.setFromCamera(new THREE.Vector2((x / this.canvas.clientWidth) * 2 - 1, -(y / this.canvas.clientHeight) * 2 + 1), this.camera);
		const cell = this.objects.paintTarget(ray, remove, s.scene.ground === 'plane' ? (s.scene.groundY ?? 0) : 0);
		if (!cell) return false;
		s.blocks.set(cell[0], cell[1], cell[2], remove ? null : s.painting);
		s.applyScene(true);
		return true;
	}

	/** The particle drawn under a viewport point (CSS pixels relative to the canvas) */
	pick(x: number, y: number): { emitter: number; particle: number } | null {
		const s = this.session;
		if (!s) return null;
		try {
			// exact: an ID render of what's drawn (facing, texture alpha, which particle is in front)
			const hit = this.particles.pick(this.renderer, this.camera, x, y, this.canvas.clientWidth, this.canvas.clientHeight);
			if (!hit) return null;
			const e = hit.emitter as { id?: number; pool: { id?: ArrayLike<number> } };
			return e.id !== undefined && e.pool.id ? { emitter: e.id, particle: e.pool.id[hit.index] } : null;
		} catch {
			return this.pickNear(x, y);
		}
	}

	/**
	 * The helper under a canvas point: an emitter marker (within a few pixels of its centre), the emitter
	 * shape, the kill plane or the stand-in entity. Hidden helpers can't be hit.
	 */
	pickGizmo(x: number, y: number, only: 'emitter' | 'other' | 'any' = 'any'): GizmoHit | null {
		const s = this.session;
		if (!s) return null;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		this.camera.updateMatrixWorld();
		if (only !== 'other') {
			const root = s.rootEmitter ?? s.world.emitters[0];
			const v = new THREE.Vector3();
			let best: { id: number; d: number } | null = null;
			for (const e of [...s.world.emitters, ...s.parallel.remote.values()]) {
				const shown = e.id === root?.id ? this.showMarker && this.gizmos.emitter : this.showMarker && this.gizmos.children;
				if (!shown) continue;
				v.set(e.position[0], e.position[1], e.position[2]).project(this.camera);
				if (v.z < -1 || v.z > 1) continue;
				const d = Math.hypot(((v.x + 1) / 2) * w - x, ((1 - v.y) / 2) * h - y);
				if (d < 10 && (!best || d < best.d)) best = { id: e.id, d };
			}
			if (best) return { kind: 'emitter', id: best.id };
		}
		if (only === 'emitter') return null;
		const rc = new THREE.Raycaster();
		rc.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
		// lines are hit within a few pixels, whatever the distance
		rc.params.Line = { threshold: this.controls.distance * 0.012 };
		if (this.killPlane.visible && rc.intersectObject(this.killPlane, true).length) return { kind: 'killPlane' };
		if (s.showShape && this.shapes.object.visible && rc.intersectObject(this.shapes.object, true).length) return { kind: 'shape' };
		if (this.gizmos.entity && s.spawnMode === 'entity' && rc.intersectObject(this.objects.entityObject, true).length) return { kind: 'entity' };
		return null;
	}

	/** Fallback when the GPU can't be asked: nearest particle centre, sized by its quad */
	private pickNear(x: number, y: number): { emitter: number; particle: number } | null {
		const s = this.session;
		if (!s) return null;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const v = new THREE.Vector3();
		const p: [number, number, number] = [0, 0, 0];
		let best: { emitter: number; particle: number } | null = null;
		let bestD = Infinity;
		this.camera.updateMatrixWorld();
		for (const e of [...s.world.emitters, ...s.parallel.remote.values()]) {
			for (let i = 0; i < e.pool.count; i++) {
				if (!e.pool.visible[i]) continue;
				e.particleWorldPos(i, p);
				v.set(p[0], p[1], p[2]).project(this.camera);
				if (v.z < -1 || v.z > 1) continue;
				const sx = (v.x * 0.5 + 0.5) * w;
				const sy = (-v.y * 0.5 + 0.5) * h;
				const dist = this.camera.position.distanceTo(new THREE.Vector3(p[0], p[1], p[2]));
				const radiusPx = (Math.max(Math.abs(e.pool.size[i * 2]), Math.abs(e.pool.size[i * 2 + 1])) / (dist * Math.tan((this.camera.fov * Math.PI) / 360))) * (h / 2);
				const d = Math.hypot(sx - x, sy - y);
				const reach = Math.max(8, radiusPx);
				// prefer the closest to the cursor, then the nearest to the camera
				const scoreD = d / reach + v.z * 0.01;
				if (d <= reach && scoreD < bestD) {
					bestD = scoreD;
					best = { emitter: e.id, particle: e.pool.id[i] };
				}
			}
		}
		return best;
	}

	/** Point the camera at the live particles (or the emitter when there are none) */
	frameAll(): void {
		const s = this.session;
		const box = new THREE.Box3();
		const p = new THREE.Vector3();
		const tmp: [number, number, number] = [0, 0, 0];
		if (s) {
			for (const e of [...s.world.emitters, ...s.parallel.remote.values()]) {
				box.expandByPoint(p.set(...e.position));
				for (let i = 0; i < e.pool.count; i++) {
					e.particleWorldPos(i, tmp);
					box.expandByPoint(p.set(tmp[0], tmp[1], tmp[2]));
				}
			}
		}
		if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(2, 2, 2));
		const center = box.getCenter(new THREE.Vector3());
		const radius = Math.max(0.25, box.getSize(new THREE.Vector3()).length() / 2);
		const dir = this.camera.position.clone().sub(this.controls.target).normalize();
		const dist = radius / Math.sin(((this.camera.fov * Math.PI) / 180) / 2) * 1.1;
		this.controls.target.copy(center);
		this.camera.position.copy(center).addScaledVector(dir, dist);
		this.controls.lookAtTarget();
	}

	dispose(): void {
		this.disposed = true;
		this.running = false;
		cancelAnimationFrame(this.raf);
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.canvas.removeEventListener('keydown', this.onKeyDown);
		this.canvas.removeEventListener('keyup', this.onKeyUp);
		this.canvas.removeEventListener('blur', this.onBlur);
		this.controls.dispose();
		this.particles.dispose();
		this.vibrant.dispose();
		this.renderer.dispose();
	}
}
