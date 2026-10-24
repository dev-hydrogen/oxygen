<script lang="ts">
	import { DEFAULT_ENTITY, DEFAULT_PATH, NEW_LOCATOR, locatorsFromGeometry, readMcstructure, type EntitySettings, type Locator, type Motion } from '@oxygen/scene';
	import type { Vec3 } from 'wintersky';
	import type { Workspace } from '../../state/workspace.svelte';
	import Select from '../fields/Select.svelte';
	import Toggle from '../fields/Toggle.svelte';
	import ScrubNumber from '../fields/ScrubNumber.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const s = $derived(workspace.active);

	const PALETTE = [
		'minecraft:stone',
		'minecraft:grass_block',
		'minecraft:dirt',
		'minecraft:sand',
		'minecraft:oak_planks',
		'minecraft:glass',
		'minecraft:stone_slab',
		'minecraft:oak_fence',
		'minecraft:snow_layer',
		'minecraft:water',
		'minecraft:short_grass',
		'minecraft:lava',
	];
	let block = $state('minecraft:stone');
	let importNote = $state<string | null>(null);
	// fill box: two corners, inclusive
	let boxFrom = $state<[number, number, number]>([-2, 0, -2]);
	let boxTo = $state<[number, number, number]>([2, 0, 2]);
	let hollow = $state(false);
	const boxSize = $derived(boxFrom.map((v, k) => Math.abs(boxTo[k] - v) + 1));
	const boxCount = $derived(boxSize[0] * boxSize[1] * boxSize[2]);
	const MAX_FILL = 65536;

	// other effects playing in this scene
	const extras = $derived(s?.scene.extras ?? []);
	const candidates = $derived(workspace.sessions.filter((x) => x !== s && x.def?.identifier).map((x) => x.def!.identifier));
	let newExtra = $state('');
	function setExtras(list: { effect: string; position: [number, number, number] }[]) {
		s?.setScene({ extras: list.length ? list : undefined });
	}
	function addExtra() {
		const id = newExtra.trim();
		if (!s || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(id)) return;
		setExtras([...extras, { effect: id, position: [3 * (extras.length + 1), 0, 0] }]);
		newExtra = '';
	}

	function fill(remove: boolean) {
		if (!s || boxCount > MAX_FILL) return;
		const n = s.fillBlocks(boxFrom, boxTo, remove ? null : block, hollow && !remove);
		importNote = remove ? `Cleared ${n.toLocaleString()} cells.` : `Placed ${n.toLocaleString()} ${block.replace('minecraft:', '').replace(/_/g, ' ')} blocks.`;
	}

	const blockCount = $derived.by(() => {
		void s?.blocksVersion;
		return s?.blocks.size ?? 0;
	});
	const motion = $derived<Motion>(s?.scene.entity.motion ?? { kind: 'still' });

	const ent = $derived(s?.scene.entity ?? DEFAULT_ENTITY);
	const locators = $derived(ent.locators ?? []);
	const current = $derived(ent.locator ? locators.find((l) => l.name === ent.locator) : undefined);
	let models = $state<{ model: string; locators: Locator[] }[]>([]);
	let geoNote = $state<string | null>(null);

	function setEntity(patch: Partial<EntitySettings>, restart = true) {
		if (!s) return;
		s.setScene({ entity: { ...s.scene.entity, ...patch } }, restart);
	}

	/** a locator's place and turn are read every frame: the effect follows without starting over */
	function setLocator(patch: Partial<Locator>) {
		if (!current) return;
		setEntity({ locators: locators.map((l) => (l === current ? { ...l, ...patch } : l)) }, false);
	}

	function setOrigin(k: number, v: number) {
		if (!s) return;
		const o = (ent.origin ?? [0, 0, 0]).map((n, j) => (j === k ? v : n)) as Vec3;
		setEntity({ origin: o.some((n) => n) ? o : undefined }, false);
		s.entity.update(0);
	}

	function uniqueName(base: string): string {
		let name = base;
		for (let i = 2; locators.some((l) => l.name === name); i++) name = `${base}_${i}`;
		return name;
	}

	function addLocator() {
		const name = uniqueName(NEW_LOCATOR.name);
		setEntity({ locators: [...locators, { ...NEW_LOCATOR, name }], locator: name });
	}

	function removeLocator() {
		if (!current) return;
		setEntity({ locators: locators.filter((l) => l !== current), locator: '' });
	}

	function renameLocator(raw: string) {
		const name = raw.trim();
		if (!current || !name || name === current.name || locators.some((l) => l.name === name)) return;
		setEntity({ locators: locators.map((l) => (l === current ? { ...l, name } : l)), locator: name });
	}

	function useModel(id: string) {
		const m = models.find((x) => x.model === id);
		if (!m) return;
		const keep = m.locators.some((l) => l.name === ent.locator);
		setEntity({ locators: m.locators, model: m.model, locator: keep ? ent.locator : (m.locators[0]?.name ?? '') });
		geoNote = `${m.locators.length} locator${m.locators.length === 1 ? '' : 's'} from ${m.model}.`;
	}

	async function importGeometry(file: File) {
		try {
			const found = locatorsFromGeometry(JSON.parse(await file.text()));
			if (!found.length) {
				geoNote = `${file.name} has no geometry in it.`;
				return;
			}
			models = found;
			const first = found.find((m) => m.locators.length) ?? found[0];
			if (!first.locators.length) {
				geoNote = `${first.model} has no locators.`;
				return;
			}
			useModel(first.model);
		} catch (e) {
			geoNote = `Couldn't read ${file.name}: ${(e as Error).message}`;
		}
	}

	/** Minecraft yaw as a compass direction */
	function facingName(yaw: number): string {
		const names = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'];
		return `facing ${names[Math.round((((yaw % 360) + 360) % 360) / 45) % 8]}`;
	}

	function setMotion(kind: string) {
		if (!s) return;
		const m: Motion =
			kind === 'circle'
				? { kind, radius: 2, speed: 2 }
				: kind === 'line'
					? { kind, length: 6, speed: 3 }
					: kind === 'bob'
						? { kind, height: 1, speed: 1 }
						: kind === 'path'
							? { kind, points: DEFAULT_PATH.map((p) => [...p] as [number, number, number]), speed: 2, ends: 'loop' }
							: { kind: 'still' };
		s.setScene({ entity: { ...s.scene.entity, motion: m } });
	}

	type PathMotion = Extract<Motion, { kind: 'path' }>;
	/** Change the path; the entity carries on along the new one without restarting the effect */
	function setPath(patch: Partial<PathMotion>) {
		if (!s || motion.kind !== 'path') return;
		s.setScene({ entity: { ...s.scene.entity, motion: { ...motion, ...patch } } }, false);
	}
	function setPoint(i: number, axis: number, value: number) {
		if (motion.kind !== 'path') return;
		setPath({ points: motion.points.map((p, j) => (j === i ? (p.map((v, k) => (k === axis ? value : v)) as [number, number, number]) : p)) });
	}
	/** a new point carries on in the direction of the last stretch */
	function addPoint() {
		if (motion.kind !== 'path') return;
		const pts = motion.points;
		const last = pts[pts.length - 1] ?? [0, 0, 0];
		const prev = pts[pts.length - 2];
		const next = (prev ? last.map((v, k) => v + (v - prev[k])) : [last[0] + 2, last[1], last[2]]) as [number, number, number];
		setPath({ points: [...pts, next] });
	}

	function setMotionValue(key: string, value: number) {
		if (!s || !Number.isFinite(value)) return;
		s.setScene({ entity: { ...s.scene.entity, motion: { ...motion, [key]: value } as Motion } }, false);
	}

	async function importStructure(file: File) {
		if (!s) return;
		try {
			const { info } = readMcstructure(new Uint8Array(await file.arrayBuffer()), s.blocks, [-1, 0, -1]);
			s.applyScene(true);
			s.restart();
			importNote = `Placed ${info.blockCount.toLocaleString()} blocks (${info.size.join(' × ')}) from ${file.name}.`;
		} catch (e) {
			importNote = `Couldn't read ${file.name}: ${(e as Error).message}`;
		}
	}
</script>

<div class="scene">
	{#if s}
		<section>
			<h3>Ground and blocks</h3>
			<div class="row">
				<span>Ground</span>
				<Select
					value={s.scene.ground}
					label="Ground"
					options={[
						{ value: 'plane', label: 'Flat ground', help: 'Particles with collision land on it' },
						{ value: 'none', label: 'No ground', help: 'Only placed blocks collide' },
					]}
					onchange={(v) => s.setScene({ ground: v as 'plane' | 'none' })}
				/>
			</div>
			{#if s.scene.ground === 'plane'}
				<div class="row">
					<span>Height</span>
					<ScrubNumber label="Ground height" value={s.scene.groundY ?? 0} step={0.5} onchange={(v) => s.setScene({ groundY: v ?? 0 })} />
				</div>
			{/if}
			<div class="row">
				<span>Block</span>
				<Select value={block} label="Block to place" options={PALETTE.map((b) => ({ value: b, label: b.replace('minecraft:', '').replace(/_/g, ' ') }))} onchange={(v) => (block = v)} />
			</div>
			<div class="actions">
				<button class="btn" class:on={!!s.painting} aria-pressed={!!s.painting} onclick={() => (s.painting = s.painting ? null : block)}>
					{s.painting ? 'Stop placing' : 'Place blocks'}
				</button>
				<label class="btn file">
					Import .mcstructure
					<input type="file" accept=".mcstructure" onchange={(e) => e.currentTarget.files?.[0] && importStructure(e.currentTarget.files[0])} />
				</label>
				<button class="btn" disabled={!blockCount} onclick={() => { s.blocks.clear(); s.applyScene(true); s.restart(); }}>Clear blocks</button>
			</div>
			<p class="note">
				{#if s.painting}Click in the viewport to place {s.painting.replace('minecraft:', '').replace(/_/g, ' ')}; Shift+click removes.{:else}{blockCount ? `${blockCount.toLocaleString()} blocks. ` : ''}Particles collide with each block's real collision box, and Kill/Only-in-blocks components test them.{/if}
			</p>
			<div class="fill">
				<span class="lbl">Fill box</span>
				<div class="corner">
					<span class="dim">from</span>
					{#each [0, 1, 2] as k (k)}<ScrubNumber label="Box from {'xyz'[k]}" value={boxFrom[k]} step={1} onchange={(v) => (boxFrom = boxFrom.map((x, j) => (j === k ? Math.round(v ?? 0) : x)) as [number, number, number])} />{/each}
				</div>
				<div class="corner">
					<span class="dim">to</span>
					{#each [0, 1, 2] as k (k)}<ScrubNumber label="Box to {'xyz'[k]}" value={boxTo[k]} step={1} onchange={(v) => (boxTo = boxTo.map((x, j) => (j === k ? Math.round(v ?? 0) : x)) as [number, number, number])} />{/each}
				</div>
				<div class="actions">
					<label class="check"><input type="checkbox" bind:checked={hollow} /> Hollow</label>
					<button class="btn" disabled={boxCount > MAX_FILL} onclick={() => fill(false)}>Fill</button>
					<button class="btn" disabled={!blockCount || boxCount > MAX_FILL} onclick={() => fill(true)}>Clear area</button>
				</div>
				<p class="note">{boxSize.join(' × ')} = {boxCount.toLocaleString()} cells{boxCount > MAX_FILL ? `, more than ${MAX_FILL.toLocaleString()}: make it smaller` : ''}. Walls, floors at any height and pillars work for testing collision and the in-blocks components.</p>
			</div>
			{#if importNote}<p class="note">{importNote}</p>{/if}
		</section>

		{#if s.spawnMode !== 'entity'}
			{@const own = s.scene.emitter}
			<section>
				<h3>Emitter</h3>
				<div class="vec">
					<span class="dim">Spawns at</span>
					{#each [0, 1, 2] as k (k)}
						<ScrubNumber label="Emitter position {'xyz'[k]}" value={(own?.position ?? [0, 0, 0])[k]} step={0.0625} onchange={(v) => s.placeEmitter(null, { position: (own?.position ?? [0, 0, 0]).map((n, m) => (m === k ? (v ?? 0) : n)) as [number, number, number], rotation: own?.rotation })} />
					{/each}
				</div>
				<div class="vec">
					<span class="dim">Turned</span>
					{#each [0, 1, 2] as k (k)}
						<ScrubNumber label="Emitter turn about {'xyz'[k]} (degrees)" value={(own?.rotation ?? [0, 0, 0])[k]} step={15} onchange={(v) => s.placeEmitter(null, { position: own?.position ?? [0, 0, 0], rotation: (own?.rotation ?? [0, 0, 0]).map((n, m) => (m === k ? (v ?? 0) : n)) as [number, number, number] })} />
					{/each}
				</div>
				<p class="note">Where /particle or the Script API spawns the effect. Right-click the emitter in the viewport to move it (G) or turn it (R) with handles. The game can't turn an emitter spawned this way, only an entity or a locator can, so a turn here is for previewing local-space motion.</p>
			</section>
		{/if}

		<section>
			<h3>Entity</h3>
			<div class="row">
				<span>Spawn on it</span>
				<div class="inline">
					<Toggle checked={s.spawnMode === 'entity'} label="Attach the effect to the entity" onchange={(v) => s.setSpawnMode(v ? 'entity' : 'command')} />
				</div>
			</div>
			<p class="note">An animation or controller plays the effect on the entity. Looping emitters loop there, and each emitter still holds at most 1,000 particles.</p>
			<div class="row">
				<span>Follows it</span>
				<div class="inline">
					<Toggle checked={!ent.unbound} label="The effect follows the entity (bind_to_actor)" onchange={(v) => setEntity({ unbound: v ? undefined : true })} />
				</div>
			</div>
			{#if ent.unbound}
				<p class="note">bind_to_actor is false: the effect starts where the entity stands and stays there. With a locator the game starts it at the world origin instead, and so does Oxygen.</p>
			{/if}
			<div class="row">
				<span>Locator</span>
				<Select
					value={ent.locator}
					label="Locator"
					options={[{ value: '', label: 'None (the entity itself)', help: 'locator left out: the effect sits where the entity stands' }, ...locators.map((l) => ({ value: l.name, label: l.name, help: l.bone ? `on bone ${l.bone}` : undefined }))]}
					onchange={(v) => setEntity({ locator: v })}
				/>
			</div>
			{#if current}
				<div class="loc">
					<div class="row">
						<span>Name</span>
						<input class="ox-code text" value={current.name} aria-label="Locator name" onchange={(e) => renameLocator(e.currentTarget.value)} />
					</div>
					{#if current.frame}
						<p class="note">From {ent.model ?? 'the model'}{current.bone ? `, bone ${current.bone}` : ''}: at {current.offset.map((n) => +n.toFixed(2)).join(', ')} with its bones' rotation{current.ignoreScale ? ', ignoring the entity’s scale' : ''}.</p>
					{:else}
						<div class="vec">
							<span class="dim">Offset</span>
							{#each [0, 1, 2] as k (k)}<ScrubNumber label="Locator offset {'xyz'[k]}" value={current.offset[k]} step={1} onchange={(v) => setLocator({ offset: current.offset.map((n, j) => (j === k ? (v ?? 0) : n)) as Vec3 })} />{/each}
						</div>
						<div class="vec">
							<span class="dim">Rotation</span>
							{#each [0, 1, 2] as k (k)}<ScrubNumber label="Locator rotation {'xyz'[k]}" value={(current.rotation ?? [0, 0, 0])[k]} step={15} onchange={(v) => setLocator({ rotation: (current.rotation ?? [0, 0, 0]).map((n, j) => (j === k ? (v ?? 0) : n)) as Vec3 })} />{/each}
						</div>
						<p class="note">As a geometry file writes them: offset in pixels (16 to a block) on the model, whose front is -Z; rotation in degrees.</p>
					{/if}
				</div>
			{/if}
			<div class="actions">
				<button class="btn" onclick={addLocator}>Add locator</button>
				{#if current}<button class="btn" onclick={removeLocator}>Remove</button>{/if}
				<label class="btn file">
					Import from a model
					<input type="file" accept=".json,.geo.json" onchange={(e) => e.currentTarget.files?.[0] && importGeometry(e.currentTarget.files[0])} />
				</label>
			</div>
			{#if models.length > 1}
				<div class="row">
					<span>Model</span>
					<Select value={ent.model ?? ''} label="Model" options={models.map((m) => ({ value: m.model, label: `${m.model} (${m.locators.length})` }))} onchange={useModel} />
				</div>
			{/if}
			{#if geoNote}<p class="note">{geoNote}</p>{/if}
			<p class="note">
				{#if ent.locator}On a locator the effect’s axes are the locator’s with Y flipped, as in-game: an unturned locator points X to the entity’s left, Y down and Z behind it. The viewport draws them.{:else}Without a locator the effect’s axes are the entity’s: X to its right, Y up, Z behind it.{/if}
			</p>
			<div class="row">
				<span>Movement</span>
				<Select
					value={motion.kind}
					label="Entity movement"
					options={[
						{ value: 'still', label: 'Standing still' },
						{ value: 'circle', label: 'Walking in a circle' },
						{ value: 'line', label: 'Walking back and forth' },
						{ value: 'bob', label: 'Bobbing up and down' },
						{ value: 'path', label: 'Along a path' },
					]}
					onchange={setMotion}
				/>
			</div>
			<div class="vec">
				<span class="dim">{motion.kind === 'still' ? 'Stands at' : 'Around'}</span>
				{#each [0, 1, 2] as k (k)}<ScrubNumber label="Entity position {'xyz'[k]}" value={(ent.origin ?? [0, 0, 0])[k]} step={0.0625} onchange={(v) => setOrigin(k, v ?? 0)} />{/each}
			</div>
			<p class="note">Click the entity, a locator or a path point in the viewport to move it with handles or the arrow keys.</p>
			{#if motion.kind === 'still' || motion.kind === 'bob'}
				<div class="row">
					<span>Facing</span>
					<div class="inline">
						<ScrubNumber label="Facing (yaw)" value={ent.yaw ?? 0} step={15} onchange={(v) => setEntity({ yaw: v ?? 0 }, false)} />
						<span class="dim">{facingName(ent.yaw ?? 0)}</span>
					</div>
				</div>
			{/if}
			{#if motion.kind === 'circle'}
				<div class="row"><span>Radius</span><input class="num ox-num" value={motion.radius} onchange={(e) => setMotionValue('radius', Number(e.currentTarget.value))} /></div>
				<div class="row"><span>Speed</span><input class="num ox-num" value={motion.speed} onchange={(e) => setMotionValue('speed', Number(e.currentTarget.value))} /></div>
			{:else if motion.kind === 'line'}
				<div class="row"><span>Length</span><input class="num ox-num" value={motion.length} onchange={(e) => setMotionValue('length', Number(e.currentTarget.value))} /></div>
				<div class="row"><span>Speed</span><input class="num ox-num" value={motion.speed} onchange={(e) => setMotionValue('speed', Number(e.currentTarget.value))} /></div>
			{:else if motion.kind === 'bob'}
				<div class="row"><span>Height</span><input class="num ox-num" value={motion.height} onchange={(e) => setMotionValue('height', Number(e.currentTarget.value))} /></div>
				<div class="row"><span>Speed</span><input class="num ox-num" value={motion.speed} onchange={(e) => setMotionValue('speed', Number(e.currentTarget.value))} /></div>
			{:else if motion.kind === 'path'}
				<div class="row"><span>Speed</span><input class="num ox-num" value={motion.speed} title="Blocks per second" onchange={(e) => setMotionValue('speed', Number(e.currentTarget.value))} /></div>
				<div class="row">
					<span>At the end</span>
					<Select
						value={motion.ends}
						label="At the end of the path"
						options={[
							{ value: 'loop', label: 'Back to the first point' },
							{ value: 'reverse', label: 'Back the way it came' },
						]}
						onchange={(v) => setPath({ ends: v as PathMotion['ends'] })}
					/>
				</div>
				<div class="points">
					{#each motion.points as p, i (i)}
						<div class="point">
							<span class="at ox-num">{i + 1}</span>
							{#each [0, 1, 2] as k (k)}
								<ScrubNumber label="Point {i + 1} {'xyz'[k]}" value={p[k]} step={0.5} onchange={(v) => setPoint(i, k, v ?? 0)} />
							{/each}
							<button class="x" aria-label="Remove point {i + 1}" disabled={motion.points.length <= 2} onclick={() => setPath({ points: motion.points.filter((_, j) => j !== i) })}>×</button>
						</div>
					{/each}
					<button class="btn" onclick={addPoint}>Add point</button>
				</div>
				<p class="note">Points are x, y, z in blocks; the entity walks between them at a steady speed, facing where it goes. The viewport draws the path while the effect is on the entity.</p>
			{/if}
			{#if motion.kind !== 'still'}
				<p class="note">Moving the entity moves effects on it, but adds nothing to their particles' speed: the game ignores emitter_local_space velocity for entities.</p>
			{/if}
			<div class="row">
				<span>Scale</span>
				<ScrubNumber label="Entity scale" value={ent.scale ?? 1} step={0.1} min={0.01} onchange={(v) => setEntity({ scale: v === null || v === 1 ? undefined : v })} />
			</div>
			<div class="row">
				<span>Size</span>
				<div class="inline pair">
					<ScrubNumber label="Collision box width" value={ent.width ?? 0.6} step={0.1} min={0} onchange={(v) => setEntity({ width: v ?? 0.6 })} />
					<ScrubNumber label="Collision box height" value={ent.height ?? 1.8} step={0.1} min={0} onchange={(v) => setEntity({ height: v ?? 1.8 })} />
				</div>
			</div>
			<p class="note">minecraft:scale and the collision box (width, height), which entity_aabb fills. The scale also grows locator offsets and the effect’s size on a locator.</p>
			<div class="row">
				<span>Goes away</span>
				<div class="inline">
					<ScrubNumber label="Entity goes away after (seconds)" value={ent.removeAfter ?? null} step={0.5} min={0} allowEmpty placeholder="never" onchange={(v) => setEntity({ removeAfter: v ?? undefined })} />
					<span class="dim">s after the effect starts</span>
				</div>
			</div>
			<p class="note">When the entity despawns, or the animation-controller state that played the effect ends, its emitters stop and particles in its space vanish; world-space ones carry on.</p>
		</section>

		<section>
			<h3>Other effects</h3>
			{#each extras as x, i (i)}
				<div class="extra">
					<span class="ox-code eid" title={x.effect}>{x.effect}</span>
					<button class="x" aria-label="Remove {x.effect}" onclick={() => setExtras(extras.filter((_, j) => j !== i))}>×</button>
					<span class="at">at</span>
					{#each [0, 1, 2] as k (k)}
						<ScrubNumber
							label="{x.effect} {'xyz'[k]}"
							value={x.position[k]}
							step={0.5}
							onchange={(v) => setExtras(extras.map((e, j) => (j === i ? { ...e, position: e.position.map((n, m) => (m === k ? (v ?? 0) : n)) as [number, number, number] } : e)))}
						/>
					{/each}
				</div>
			{/each}
			<div class="add">
				<input class="ox-code" list="ox-scene-effects" placeholder="namespace:effect" aria-label="Effect to add" bind:value={newExtra} onkeydown={(e) => e.key === 'Enter' && addExtra()} />
				<datalist id="ox-scene-effects">{#each candidates as id (id)}<option value={id}></option>{/each}</datalist>
				<button class="btn" onclick={addExtra}>Add</button>
			</div>
			<p class="note">They play in the same world as this effect, so temps, particle caps and whole-world queries interact as they do in-game. Open effects and ones in the pack can be added.</p>
		</section>

		<section>
			<h3>Lighting</h3>
			<div class="row">
				<span>Time of day</span>
				<div class="inline">
					<input type="range" min="0" max="1" step="0.01" value={s.timeOfDay} aria-label="Time of day" oninput={(e) => (s.timeOfDay = Number(e.currentTarget.value))} />
					<span class="val ox-num">{['midnight', 'sunrise', 'noon', 'sunset'][Math.round(s.timeOfDay * 4) % 4]}</span>
				</div>
			</div>
			<div class="row">
				<span>Sky light</span>
				<div class="inline">
					<input type="range" min="0" max="15" step="1" value={s.scene.skyLight} aria-label="Sky light" oninput={(e) => s.setScene({ skyLight: Number(e.currentTarget.value) }, false)} />
					<span class="val ox-num">{s.scene.skyLight}</span>
				</div>
			</div>
			<div class="row">
				<span>Block light</span>
				<div class="inline">
					<input type="range" min="0" max="15" step="1" value={s.scene.blockLight} aria-label="Block light" oninput={(e) => s.setScene({ blockLight: Number(e.currentTarget.value) }, false)} />
					<span class="val ox-num">{s.scene.blockLight}</span>
				</div>
			</div>
			<p class="note">Only effects with Lit by world change with light; the rest stay fully bright, as in-game.</p>
		</section>

		<section>
			<div class="row">
				<span>Keep in file</span>
				<div class="inline">
					<Toggle checked={s.scene.keepInFile} label="Keep this scene in the file" onchange={(v) => s.setScene({ keepInFile: v }, false)} />
				</div>
			</div>
			<p class="note">Saved in the file's oxygen block, which the game ignores.</p>
		</section>
	{/if}
</div>

<style>
	.points {
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-items: flex-start;
	}
	.point {
		display: grid;
		grid-template-columns: 22px repeat(3, minmax(0, 1fr)) 18px;
		gap: 3px;
		align-items: center;
		width: 100%;
	}
	.x:disabled {
		visibility: hidden;
	}
	.loc {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 4px 0 2px 8px;
		border-left: 2px solid var(--ox-rule);
	}
	.vec {
		display: grid;
		grid-template-columns: 58px repeat(3, minmax(0, 1fr));
		gap: 4px;
		align-items: center;
	}
	.text {
		height: 22px;
		min-width: 0;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
	}
	.text:focus {
		border-color: var(--ox-lox);
	}
	.pair > :global(*) {
		flex: 1;
		min-width: 0;
	}
	.extra {
		display: grid;
		grid-template-columns: 22px repeat(3, minmax(0, 1fr));
		gap: 3px;
		align-items: center;
		margin-bottom: 6px;
	}
	.extra .eid {
		grid-column: 1 / 4;
	}
	.extra .x {
		justify-self: end;
	}
	.at {
		color: var(--ox-text-dim);
		font-size: 11px;
	}
	.eid {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ox-haze);
	}
	.x {
		border: none;
		background: none;
		color: var(--ox-text-dim);
		cursor: pointer;
	}
	.x:hover {
		color: var(--ox-error);
	}
	.add {
		display: flex;
		gap: 4px;
		margin-top: 4px;
	}
	.add input {
		flex: 1;
		min-width: 0;
		height: 22px;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
	}
	.add input:focus {
		border-color: var(--ox-lox);
	}
	.fill {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--ox-rule);
	}
	.lbl {
		color: var(--ox-haze);
	}
	.corner {
		display: grid;
		grid-template-columns: 34px repeat(3, 1fr);
		gap: 4px;
		align-items: center;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--ox-haze);
	}
	.dim {
		color: var(--ox-text-dim);
	}
	.scene {
		height: 100%;
		overflow: auto;
		padding-bottom: 20px;
	}
	section {
		padding: 6px 10px 10px;
		border-bottom: 1px solid var(--ox-rule);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h3 {
		margin: 4px 0;
		font-size: var(--ox-title-size);
		font-weight: 600;
	}
	.row {
		display: grid;
		grid-template-columns: 96px 1fr;
		gap: 8px;
		align-items: center;
		color: var(--ox-haze);
	}
	.inline {
		display: flex;
		gap: 8px;
		align-items: center;
		min-width: 0;
	}
	.note {
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.note {
		margin: 2px 0 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
	}
	.btn {
		border: 1px solid var(--ox-rule-strong);
		background: none;
		border-radius: var(--ox-radius);
		height: 24px;
		padding: 0 10px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		color: var(--ox-frost);
	}
	.btn:hover:not(:disabled) {
		background: var(--ox-hover);
	}
	.btn.on {
		border-color: var(--ox-lox);
		color: var(--ox-lox);
	}
	.btn:disabled {
		opacity: 0.4;
	}
	.file input {
		display: none;
	}
	.num {
		width: 72px;
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
	}
	.num:focus {
		border-color: var(--ox-lox);
	}
	input[type='range'] {
		flex: 1;
		accent-color: var(--ox-lox);
	}
	.val {
		width: 60px;
		color: var(--ox-frost);
	}
</style>
