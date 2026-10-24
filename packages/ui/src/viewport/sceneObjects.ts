import * as THREE from 'three';
import { blockColor, collisionBoxes, type Motion } from '@oxygen/scene';
import type { EffectSession } from '../state/session.svelte';

/**
 * Preview-world geometry: blocks (drawn as their collision boxes, tinted by type; passable blocks such as
 * water or plants as translucent cubes) and the entity stand-in with its locators: a dot for each, and the axes of
 * the frame the effect is attached to (X red, Y green, Z blue).
 */
export class SceneObjects {
	readonly group = new THREE.Group();
	private blocks = new THREE.Group();
	private entity = new THREE.Group();
	/** the stand-in entity's box, for clicking it */
	get entityObject(): THREE.Object3D {
		return this.entity;
	}
	/** the collision box (scaled to the entity's size) */
	private box: THREE.LineSegments;
	/** the axes of the frame the effect sits in */
	private axes = new THREE.AxesHelper(0.5);
	/** a dot at every locator */
	private dots: THREE.Points;
	private dotsKey = '';
	/** the entity's waypoint path, when it walks one */
	private path = new THREE.Group();
	private pathKey = '';
	private blocksKey = '';
	private unitBox = new THREE.BoxGeometry(1, 1, 1);
	private pickMeshes: THREE.Object3D[] = [];

	constructor() {
		this.group.add(this.blocks, this.entity);
		// entity: its collision box with a nose showing which way it faces
		this.box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), new THREE.LineBasicMaterial({ color: 0xdfe5f0, transparent: true, opacity: 0.6 }));
		const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 12), new THREE.MeshBasicMaterial({ color: 0x93bdf5 }));
		nose.rotation.x = Math.PI / 2;
		nose.position.set(0, 0.9, 0.42);
		nose.name = 'nose';
		this.entity.add(this.box, nose);
		const axesMat = this.axes.material as THREE.LineBasicMaterial;
		axesMat.depthTest = false;
		axesMat.transparent = true;
		this.axes.renderOrder = 15;
		this.dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x93bdf5, size: 6, sizeAttenuation: false, depthTest: false, transparent: true }));
		this.dots.renderOrder = 15;
		this.group.add(this.axes, this.dots, this.path);
	}

	private rebuildPath(m: Extract<Motion, { kind: 'path' }>, o: [number, number, number]) {
		for (const c of [...this.path.children]) {
			this.path.remove(c);
			const o = c as THREE.Line | THREE.Points;
			o.geometry.dispose();
			(o.material as THREE.Material).dispose();
		}
		const pts = m.points.map((p) => new THREE.Vector3(p[0] + o[0], p[1] + o[1] + 0.02, p[2] + o[2]));
		if (!pts.length) return;
		const line = new (m.ends === 'loop' && pts.length > 2 ? THREE.LineLoop : THREE.Line)(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineDashedMaterial({ color: 0x93bdf5, dashSize: 0.25, gapSize: 0.15, transparent: true, opacity: 0.8 }),
		);
		line.computeLineDistances();
		const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: 0x93bdf5, size: 6, sizeAttenuation: false }));
		this.path.add(line, dots);
	}

	/** the entity stand-in, its locator and its path can be hidden (the blocks stay) */
	showEntity = true;

	sync(s: EffectSession): void {
		const key = `${s.id}:${s.blocks.version}`;
		if (key !== this.blocksKey) {
			this.blocksKey = key;
			this.rebuildBlocks(s);
		}
		const onEntity = s.spawnMode === 'entity';
		const shown = onEntity && this.showEntity && s.entity.alive;
		this.entity.visible = shown;
		this.axes.visible = shown;
		this.dots.visible = shown;
		const motion = s.scene.entity.motion;
		this.path.visible = onEntity && this.showEntity && motion.kind === 'path';
		if (this.path.visible && motion.kind === 'path') {
			const origin = s.scene.entity.origin ?? [0, 0, 0];
			const key = JSON.stringify([motion, origin]);
			if (key !== this.pathKey) {
				this.pathKey = key;
				this.rebuildPath(motion, origin);
			}
		}
		if (shown) {
			const e = s.entity;
			const set = s.scene.entity;
			this.entity.position.set(e.position[0], e.position[1], e.position[2]);
			// Minecraft yaw turns the other way round Y from three's
			this.entity.rotation.set(0, (-e.yaw * Math.PI) / 180, 0);
			const sc = e.scale;
			this.box.scale.set((set.width ?? 0.6) * sc, (set.height ?? 1.8) * sc, (set.width ?? 0.6) * sc);
			const nose = this.entity.getObjectByName('nose');
			nose?.position.set(0, (set.height ?? 1.8) * sc * 0.9, ((set.width ?? 0.6) * sc) / 2 + 0.12);
			const f = e.frame();
			this.axes.position.set(...f.position);
			this.axes.quaternion.set(...f.rotation);
			this.axes.scale.setScalar(f.scale);
			const pts = e.locators.map((l) => e.frame(l.name).position);
			const key = pts.map((p) => p.map((n) => n.toFixed(3)).join(',')).join(';');
			if (key !== this.dotsKey) {
				this.dotsKey = key;
				this.dots.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
				this.dots.geometry.computeBoundingSphere();
			}
		}
	}

	private rebuildBlocks(s: EffectSession) {
		for (const c of [...this.blocks.children]) {
			this.blocks.remove(c);
			const m = c as THREE.InstancedMesh;
			(m.material as THREE.Material).dispose();
			m.dispose?.();
		}
		this.pickMeshes = [];
		// group instances by (color, translucent)
		const batches = new Map<string, { color: number; translucent: boolean; mats: THREE.Matrix4[] }>();
		const m4 = new THREE.Matrix4();
		for (const [x, y, z, b] of s.blocks.entries()) {
			const boxes = collisionBoxes(b.name, b.states ?? {});
			const translucent = boxes.length === 0;
			const color = blockColor(b.name);
			const k = `${color}:${translucent}`;
			let batch = batches.get(k);
			if (!batch) batches.set(k, (batch = { color, translucent, mats: [] }));
			const list = translucent ? [[0, 0, 0, 1, 1, 1] as const] : boxes;
			for (const bx of list) {
				const sx = bx[3] - bx[0],
					sy = bx[4] - bx[1],
					sz = bx[5] - bx[2];
				m4.makeScale(sx, sy, sz).setPosition(x + bx[0] + sx / 2, y + bx[1] + sy / 2, z + bx[2] + sz / 2);
				batch.mats.push(m4.clone());
			}
		}
		for (const b of batches.values()) {
			const mat = new THREE.MeshLambertMaterial({ color: b.color, transparent: b.translucent, opacity: b.translucent ? 0.35 : 1, depthWrite: !b.translucent });
			const mesh = new THREE.InstancedMesh(this.unitBox, mat, b.mats.length);
			b.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
			mesh.instanceMatrix.needsUpdate = true;
			this.blocks.add(mesh);
			this.pickMeshes.push(mesh);
		}
	}

	/**
	 * Where a click would place a block: the cell next to the hit face of a block, or the cell above the
	 * ground. `remove` returns the clicked block's cell instead.
	 */
	paintTarget(ray: THREE.Raycaster, remove: boolean, groundY = 0): [number, number, number] | null {
		const hits = ray.intersectObjects(this.pickMeshes, false);
		if (hits.length) {
			const h = hits[0];
			const n = h.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0);
			if (h.object instanceof THREE.InstancedMesh && h.instanceId !== undefined) {
				const m = new THREE.Matrix4();
				h.object.getMatrixAt(h.instanceId, m);
				n.transformDirection(m).round();
			}
			const inside = h.point.clone().addScaledVector(n, -0.01);
			const cell = remove ? inside : h.point.clone().addScaledVector(n, 0.5);
			return [Math.floor(cell.x), Math.floor(cell.y), Math.floor(cell.z)];
		}
		if (remove) return null;
		const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
		const p = new THREE.Vector3();
		if (!ray.ray.intersectPlane(ground, p)) return null;
		// the first whole cell at or above the ground's surface
		return [Math.floor(p.x), Math.ceil(groundY - 1e-6), Math.floor(p.z)];
	}
}
