<script lang="ts">
	import { DEFAULT_ENTITY, DEFAULT_PATH, NEW_LOCATOR, locatorsFromGeometry, readMcstructure, type EntitySettings, type Locator, type Motion } from '@oxygen/scene';
	import type { Vec3 } from 'wintersky';
	import { onMount } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import { SPAWN_MODES, type SpawnMode } from '../../state/session.svelte';
	import { componentPath } from '../../lib/molang-text';
	import { tip } from '../../lib/tip';
	import Hint from '../fields/Hint.svelte';
	import Section from '../fields/Section.svelte';
	import Select from '../fields/Select.svelte';
	import Toggle from '../fields/Toggle.svelte';
	import ScrubNumber from '../fields/ScrubNumber.svelte';

	/**
	 * The world the preview plays in. A label in the code voice is a key the game reads from a file (its tip
	 * says which); the rest only set up the preview. What the game does with each is in the Documentation.
	 */
	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const s = $derived(workspace.active);

	/** the sections folded open: the ones set up once and left (blocks, other effects) start closed */
	let open = $state({ spawn: true, entity: true, world: true, blocks: false, effects: false });
	type SectionId = keyof typeof open;
	onMount(() => {
		void workspace.loadSettings().then((saved) => {
			const kept = saved.sceneSections;
			if (kept && typeof kept === 'object') for (const k of Object.keys(open) as SectionId[]) if (typeof (kept as Record<string, unknown>)[k] === 'boolean') open[k] = (kept as Record<SectionId, boolean>)[k];
		});
	});
	function toggle(id: SectionId) {
		open[id] = !open[id];
		workspace.updateSettings({ sceneSections: { ...open } });
	}

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
	const blockName = (id: string) => id.replace('minecraft:', '').replace(/_/g, ' ');
	let block = $state('minecraft:stone');
	// fill box: two corners, inclusive
	let boxFrom = $state<[number, number, number]>([-2, 0, -2]);
	let boxTo = $state<[number, number, number]>([2, 0, 2]);
	let hollow = $state(false);
	const boxSize = $derived(boxFrom.map((v, k) => Math.abs(boxTo[k] - v) + 1));
	const boxCount = $derived(boxSize[0] * boxSize[1] * boxSize[2]);
	const MAX_FILL = 65536;

	// other effects playing in this scene
	const extras = $derived(s?.scene.extras ?? []);
	/** identifiers of the effects in this effect's pack */
	let packIds = $state.raw<string[]>([]);
	$effect(() => {
		void workspace.packVersion;
		const file = s?.file ?? null;
		void (workspace.host.effectIds?.(file) ?? Promise.resolve([])).then((ids) => (packIds = ids)).catch(() => (packIds = []));
	});
	/** what can be added: the other open effects, then the pack's */
	const candidates = $derived([...new Set([...workspace.sessions.filter((x) => x !== s && x.def?.identifier).map((x) => x.def!.identifier), ...packIds])].filter((id) => id !== s?.def?.identifier && !extras.some((x) => x.effect === id)));
	let newExtra = $state('');
	let suggesting = $state(false);
	const suggestions = $derived.by(() => {
		const q = newExtra.trim().toLowerCase();
		return (q ? candidates.filter((id) => id.toLowerCase().includes(q)) : candidates).slice(0, 80);
	});
	function setExtras(list: { effect: string; position: [number, number, number] }[]) {
		s?.setScene({ extras: list.length ? list : undefined });
	}
	function addExtra(picked?: string) {
		const id = (picked ?? newExtra).trim();
		if (!s || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(id)) return;
		setExtras([...extras, { effect: id, position: [3 * (extras.length + 1), 0, 0] }]);
		newExtra = '';
	}

	function fill(remove: boolean) {
		if (!s || boxCount > MAX_FILL) return;
		const n = s.fillBlocks(boxFrom, boxTo, remove ? null : block, hollow && !remove);
		workspace.say(remove ? `Cleared ${n.toLocaleString()} cells.` : `Placed ${n.toLocaleString()} ${blockName(block)} blocks.`);
	}

	const blockCount = $derived.by(() => {
		void s?.blocksVersion;
		return s?.blocks.size ?? 0;
	});
	const motion = $derived<Motion>(s?.scene.entity.motion ?? { kind: 'still' });

	const ent = $derived(s?.scene.entity ?? DEFAULT_ENTITY);
	const locators = $derived(ent.locators ?? []);
	/** the locator whose values are open: the one picked in the list, else the one the effect is on */
	let picked = $state<string | null>(null);
	const current = $derived(locators.find((l) => l.name === picked) ?? locators.find((l) => l.name === ent.locator));
	let models = $state<{ model: string; locators: Locator[] }[]>([]);

	/** the effect takes the world's light only with this component (classic rendering) */
	const lit = $derived.by(() => {
		void s?.version;
		return s?.doc.get(componentPath('minecraft:particle_appearance_lighting')) !== undefined;
	});

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
		// a new locator is made to be used: the effect goes onto it, as adding one always did
		setEntity({ locators: [...locators, { ...NEW_LOCATOR, name }], locator: name });
		picked = name;
	}

	function removeLocator(l: Locator) {
		setEntity({ locators: locators.filter((x) => x !== l), locator: ent.locator === l.name ? '' : ent.locator }, ent.locator === l.name);
		if (picked === l.name) picked = null;
	}

	function renameLocator(raw: string) {
		const name = raw.trim();
		if (!current || !name || name === current.name || locators.some((l) => l.name === name)) return;
		const attached = ent.locator === current.name;
		setEntity({ locators: locators.map((l) => (l === current ? { ...l, name } : l)), locator: attached ? name : ent.locator });
		picked = name;
	}

	function useModel(id: string) {
		const m = models.find((x) => x.model === id);
		if (!m) return;
		const keep = m.locators.some((l) => l.name === ent.locator);
		setEntity({ locators: m.locators, model: m.model, locator: keep ? ent.locator : (m.locators[0]?.name ?? '') });
		picked = null;
		workspace.say(`${m.locators.length} locator${m.locators.length === 1 ? '' : 's'} from ${m.model}.`);
	}

	async function importGeometry(file: File) {
		try {
			const found = locatorsFromGeometry(JSON.parse(await file.text()));
			if (!found.length) return workspace.say(`${file.name} has no geometry in it.`, 'error');
			models = found;
			const first = found.find((m) => m.locators.length) ?? found[0];
			if (!first.locators.length) return workspace.say(`${first.model} has no locators.`, 'error');
			useModel(first.model);
		} catch (e) {
			workspace.say(`Couldn't read ${file.name}: ${(e as Error).message}`, 'error');
		}
	}

	/** Minecraft yaw as a compass direction */
	function facingName(yaw: number): string {
		const names = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'];
		return names[Math.round((((yaw % 360) + 360) % 360) / 45) % 8];
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

	function setMotionValue(key: string, value: number | null) {
		if (!s || value === null || !Number.isFinite(value)) return;
		s.setScene({ entity: { ...s.scene.entity, motion: { ...motion, [key]: value } as Motion } }, false);
	}

	async function importStructure(file: File) {
		if (!s) return;
		try {
			const { info } = readMcstructure(new Uint8Array(await file.arrayBuffer()), s.blocks, [-1, 0, -1]);
			s.applyScene(true);
			s.restart();
			workspace.say(`Placed ${info.blockCount.toLocaleString()} blocks (${info.size.join(' × ')}) from ${file.name}.`);
		} catch (e) {
			workspace.say(`Couldn't read ${file.name}: ${(e as Error).message}`, 'error');
		}
	}

	const DOC = 'guide#effects-on-an-entity';
	/** what each kind of movement is set by, besides its speed */
	const MOTION_FIELDS: Record<string, { key: string; label: string }[]> = {
		circle: [{ key: 'radius', label: 'Radius' }],
		line: [{ key: 'length', label: 'Length' }],
		bob: [{ key: 'height', label: 'Height' }],
	};
</script>

{#snippet vec(label: string, value: readonly number[], step: number, set: (k: number, v: number) => void, name = label)}
	<div class="vec">
		<span>{label}</span>
		{#each [0, 1, 2] as k (k)}<ScrubNumber label="{name} {'xyz'[k]}" value={value[k]} {step} onchange={(v) => set(k, v ?? 0)} />{/each}
	</div>
{/snippet}

<div class="scene">
	{#if s}
		<div class="sections">
		<Section title="Spawn" open={open.spawn} ontoggle={() => toggle('spawn')}>
			<div class="row">
				<span>Spawned by</span>
				<Select value={s.spawnMode} label="Spawned by" options={SPAWN_MODES.map((m) => ({ value: m.id, label: m.label, help: m.help }))} onchange={(v) => s.setSpawnMode(v as SpawnMode)} />
			</div>
			{#if s.spawnMode === 'entity'}
				<!-- the animation's particle_effects entry: its keys, as the file writes them -->
				<div class="group">
					<div class="row">
						<span class="key ox-code" use:tip={{ where: 'animation › particle_effects › locator', text: 'A locator of the entity’s geometry, by name. Left out, the effect sits on the entity itself.' }}>locator</span>
						<div class="inline">
							<Select
								value={ent.locator}
								label="locator"
								options={[{ value: '', label: 'none' }, ...locators.map((l) => ({ value: l.name, label: l.name, help: l.bone ? `on bone ${l.bone}` : undefined }))]}
								onchange={(v) => setEntity({ locator: v })}
							/>
							<Hint label="About locator" where="animation › particle_effects › locator" text="On a locator the effect’s Y axis is flipped: unturned, X points to the entity’s left, Y down and Z behind it. Without one, X points to its right, Y up and Z behind it." doc={DOC} />
						</div>
					</div>
					<div class="row">
						<span class="key ox-code">bind_to_actor</span>
						<div class="inline">
							<Toggle checked={!ent.unbound} label="bind_to_actor" onchange={(v) => setEntity({ unbound: v ? undefined : true })} />
							<Hint label="About bind_to_actor" where="animation › particle_effects › bind_to_actor" text="`false` leaves the effect where the entity stood when it started, on the world’s axes. On a locator it starts at the world origin instead." doc={DOC} />
						</div>
					</div>
					{#if ent.unbound && ent.locator}<p class="state warn">Unbound on a locator: starts at the world origin.</p>{/if}
				</div>
			{:else}
				{@const own = s.scene.emitter}
				{@const pos = own?.position ?? [0, 0, 0]}
				{@const rot = own?.rotation ?? [0, 0, 0]}
				{@render vec('Position', pos, 0.0625, (k, v) => s.placeEmitter(null, { position: pos.map((n, m) => (m === k ? v : n)) as Vec3, rotation: own?.rotation }), 'Emitter position')}
				<div class="vec">
					<span class="withhint">Rotation <Hint label="About the emitter's rotation" text="The game can’t rotate an effect spawned by `/particle` or a script. Preview only, for checking local-space motion." /></span>
					{#each [0, 1, 2] as k (k)}<ScrubNumber label="Emitter rotation {'xyz'[k]} (degrees)" value={rot[k]} step={15} onchange={(v) => s.placeEmitter(null, { position: pos, rotation: rot.map((n, m) => (m === k ? (v ?? 0) : n)) as Vec3 })} />{/each}
				</div>
			{/if}
		</Section>

		<!-- the stand-in entity exists only for an effect an animation plays on it -->
		{#if s.spawnMode === 'entity'}
			<Section title="Entity" open={open.entity} ontoggle={() => toggle('entity')}>
				{@render vec('Position', ent.origin ?? [0, 0, 0], 0.0625, setOrigin, 'Entity position')}
				{#if motion.kind === 'still' || motion.kind === 'bob'}
					<div class="row">
						<span>Yaw</span>
						<div class="inline">
							<ScrubNumber label="Yaw (degrees)" value={ent.yaw ?? 0} step={15} onchange={(v) => setEntity({ yaw: v ?? 0 }, false)} />
							<span class="dim">{facingName(ent.yaw ?? 0)}</span>
						</div>
					</div>
				{/if}
				<div class="row">
					<span use:tip={'Around its position. Effects on the entity move with it; the game adds none of its speed to their particles.'}>Movement</span>
					<Select
						value={motion.kind}
						label="Entity movement"
						options={[
							{ value: 'still', label: 'Still' },
							{ value: 'circle', label: 'Circle' },
							{ value: 'line', label: 'Line', help: 'Back and forth' },
							{ value: 'bob', label: 'Bob', help: 'Up and down' },
							{ value: 'path', label: 'Path', help: 'Through points, at a steady speed' },
						]}
						onchange={setMotion}
					/>
				</div>
				{#if motion.kind !== 'still'}
					<div class="group">
						{#each MOTION_FIELDS[motion.kind] ?? [] as f (f.key)}
							<div class="row"><span>{f.label}</span><ScrubNumber label={f.label} value={(motion as unknown as Record<string, number>)[f.key]} step={0.5} min={0} onchange={(v) => setMotionValue(f.key, v)} /></div>
						{/each}
						<div class="row"><span use:tip={motion.kind === 'bob' ? null : 'Blocks per second'}>Speed</span><ScrubNumber label="Speed" value={motion.speed} step={0.5} min={0} onchange={(v) => setMotionValue('speed', v)} /></div>
						{#if motion.kind === 'path'}
							<div class="row">
								<span>At the end</span>
								<Select
									value={motion.ends}
									label="At the end of the path"
									options={[
										{ value: 'loop', label: 'Loop', help: 'Back to the first point' },
										{ value: 'reverse', label: 'Reverse', help: 'Back the way it came' },
									]}
									onchange={(v) => setPath({ ends: v as PathMotion['ends'] })}
								/>
							</div>
							<div class="points">
								{#each motion.points as p, i (i)}
									<div class="point">
										<span class="dim ox-num">{i + 1}</span>
										{#each [0, 1, 2] as k (k)}
											<ScrubNumber label="Point {i + 1} {'xyz'[k]}" value={p[k]} step={0.5} onchange={(v) => setPoint(i, k, v ?? 0)} />
										{/each}
										<button class="x" aria-label="Remove point {i + 1}" disabled={motion.points.length <= 2} onclick={() => setPath({ points: motion.points.filter((_, j) => j !== i) })}>×</button>
									</div>
								{/each}
								<button class="btn" onclick={addPoint}>Add point</button>
							</div>
						{/if}
					</div>
				{/if}
				<div class="row">
					<span class="key ox-code" use:tip={{ where: 'entity › components › minecraft:scale', text: 'Also scales locator offsets, and an effect on a locator.' }}>scale</span>
					<ScrubNumber label="minecraft:scale" value={ent.scale ?? 1} step={0.1} min={0.01} onchange={(v) => setEntity({ scale: v === null || v === 1 ? undefined : v })} />
				</div>
				<div class="row long">
					<span class="key ox-code" use:tip={{ where: 'entity › components › minecraft:collision_box', text: 'Width and height. `emitter_shape_entity_aabb` fills it.' }}>collision_box</span>
					<div class="inline pair">
						<ScrubNumber label="collision_box width" value={ent.width ?? 0.6} step={0.1} min={0} onchange={(v) => setEntity({ width: v ?? 0.6 })} />
						<ScrubNumber label="collision_box height" value={ent.height ?? 1.8} step={0.1} min={0} onchange={(v) => setEntity({ height: v ?? 1.8 })} />
					</div>
				</div>
				<div class="row">
					<span>Despawns</span>
					<div class="inline">
						<ScrubNumber label="Entity despawns after (seconds)" value={ent.removeAfter ?? null} step={0.5} min={0} allowEmpty placeholder="never" onchange={(v) => setEntity({ removeAfter: v ?? undefined })} />
						<span class="dim">s</span>
						<Hint label="About despawning" text="Seconds after the effect starts. The entity despawns, or the controller state that played the effect ends: its emitters stop and particles in its space vanish. World-space particles carry on." doc={DOC} />
					</div>
				</div>

				<div class="subhead">
					<h4 use:tip={{ where: 'geometry › bones › locators', text: 'The model’s locators. An animation attaches an effect to one by name.' }}>Locators</h4>
					<span class="spacer"></span>
					<button class="btn" onclick={addLocator}>Add</button>
					<label class="btn file" use:tip={'Take the locators of a model (.geo.json)'}>
						Import model
						<input type="file" accept=".json,.geo.json" onchange={(e) => e.currentTarget.files?.[0] && importGeometry(e.currentTarget.files[0])} />
					</label>
				</div>
				{#if models.length > 1}
					<div class="row">
						<span>Model</span>
						<Select value={ent.model ?? ''} label="Model" options={models.map((m) => ({ value: m.model, label: `${m.model} (${m.locators.length})` }))} onchange={useModel} />
					</div>
				{/if}
				{#each locators as l (l.name)}
					<div class="item" class:open={l === current}>
						<button class="name ox-code" aria-expanded={l === current} onclick={() => (picked = l === current && picked ? null : l.name)}>{l.name}</button>
						{#if ent.locator === l.name}<span class="tag">in use</span>{/if}
						<button class="x" aria-label="Remove {l.name}" onclick={() => removeLocator(l)}>×</button>
					</div>
					{#if l === current}
						<div class="group">
							<div class="row">
								<span>Name</span>
								<input class="ox-code text" value={l.name} aria-label="Locator name" onchange={(e) => renameLocator(e.currentTarget.value)} />
							</div>
							{#if l.frame}
								<!-- from a model: resolved through its bones, so there's nothing here to edit -->
								<div class="row"><span>Bone</span><span class="ox-code read">{l.bone ?? '–'}</span></div>
								<div class="row"><span>Offset</span><span class="ox-num read">{l.offset.map((n) => +n.toFixed(2)).join(', ')}</span></div>
							{:else}
								<div class="vec">
									<span class="withhint">Offset <Hint label="About a locator's offset" text="Pixels on the model (16 to a block), whose front is −Z, as a geometry file writes it." /></span>
									{#each [0, 1, 2] as k (k)}<ScrubNumber label="Locator offset {'xyz'[k]}" value={l.offset[k]} step={1} onchange={(v) => setLocator({ offset: l.offset.map((n, j) => (j === k ? (v ?? 0) : n)) as Vec3 })} />{/each}
								</div>
								{@render vec('Rotation', l.rotation ?? [0, 0, 0], 15, (k, v) => setLocator({ rotation: (l.rotation ?? [0, 0, 0]).map((n, j) => (j === k ? v : n)) as Vec3 }), 'Locator rotation')}
							{/if}
						</div>
					{/if}
				{/each}
			</Section>
		{/if}

		<Section title="World" open={open.world} ontoggle={() => toggle('world')}>
			<div class="row">
				<span>Ground</span>
				<Select
					value={s.scene.ground}
					label="Ground"
					options={[
						{ value: 'plane', label: 'Flat', help: 'Particles with collision land on it' },
						{ value: 'none', label: 'None', help: 'Only placed blocks collide' },
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
			{#if !lit && workspace.renderMode === 'classic'}<p class="state">Unlit: no <span class="ox-code">particle_appearance_lighting</span>.</p>{/if}
		</Section>

		<Section title="Blocks" count={blockCount ? blockCount.toLocaleString() : undefined} open={open.blocks} ontoggle={() => toggle('blocks')}>
			<div class="row">
				<span>Block</span>
				<div class="inline">
					<Select value={block} label="Block to place" options={PALETTE.map((b) => ({ value: b, label: blockName(b) }))} onchange={(v) => { block = v; if (s.painting) s.painting = v; }} />
					<button class="btn" class:on={!!s.painting} aria-pressed={!!s.painting} onclick={() => (s.painting = s.painting ? null : block)}>Place</button>
				</div>
			</div>
			{#if s.painting}<p class="state">Click in the viewport places one, Shift+click removes.</p>{/if}
			{@render vec('Fill from', boxFrom, 1, (k, v) => (boxFrom = boxFrom.map((x, j) => (j === k ? Math.round(v) : x)) as [number, number, number]), 'Box from')}
			{@render vec('to', boxTo, 1, (k, v) => (boxTo = boxTo.map((x, j) => (j === k ? Math.round(v) : x)) as [number, number, number]), 'Box to')}
			<div class="actions">
				<label class="check"><input type="checkbox" bind:checked={hollow} /> Hollow</label>
				<button class="btn" disabled={boxCount > MAX_FILL} onclick={() => fill(false)}>Fill</button>
				<button class="btn" disabled={!blockCount || boxCount > MAX_FILL} onclick={() => fill(true)}>Clear box</button>
				<span class="dim ox-num size" class:warn={boxCount > MAX_FILL} use:tip={boxCount > MAX_FILL ? `${boxCount.toLocaleString()} cells: more than the ${MAX_FILL.toLocaleString()} a fill takes` : `${boxCount.toLocaleString()} cells`}>{boxSize.join(' × ')}</span>
			</div>
			<div class="actions split">
				<label class="btn file" use:tip={'Place the blocks of a .mcstructure'}>
					Import structure
					<input type="file" accept=".mcstructure" onchange={(e) => e.currentTarget.files?.[0] && importStructure(e.currentTarget.files[0])} />
				</label>
				<button class="btn" disabled={!blockCount} onclick={() => { s.blocks.clear(); s.applyScene(true); s.restart(); }}>Clear all</button>
			</div>
		</Section>

		<Section title="Other effects" count={extras.length || undefined} open={open.effects} ontoggle={() => toggle('effects')}>
			{#snippet aside()}<Hint label="About other effects" text="Effects playing in the same world as this one. They share temps, particle caps and whole-world queries with it, as in-game." />{/snippet}
			{#each extras as x, i (i)}
				<div class="item">
					<span class="ox-code eid" title={x.effect}>{x.effect}</span>
					<button class="x" aria-label="Remove {x.effect}" onclick={() => setExtras(extras.filter((_, j) => j !== i))}>×</button>
				</div>
				{@render vec('at', x.position, 0.5, (k, v) => setExtras(extras.map((e, j) => (j === i ? { ...e, position: e.position.map((n, m) => (m === k ? v : n)) as [number, number, number] } : e))), x.effect)}
			{/each}
			<div class="add">
				<input
					class="ox-code text"
					placeholder="namespace:effect"
					aria-label="Effect to add"
					role="combobox"
					aria-expanded={suggesting && suggestions.length > 0}
					aria-controls="ox-scene-effects"
					autocomplete="off"
					bind:value={newExtra}
					onfocus={() => (suggesting = true)}
					onblur={() => (suggesting = false)}
					onkeydown={(e) => {
						if (e.key === 'Enter') addExtra();
						else if (e.key === 'Escape') suggesting = false;
						else suggesting = true;
					}}
				/>
				<button class="btn" onclick={() => addExtra()}>Add</button>
				{#if suggesting && suggestions.length}
					<!-- pressing one keeps the field in use, so the list is still there for the next -->
					<div class="suggest" id="ox-scene-effects" role="listbox">
						{#each suggestions as id (id)}
							<button class="ox-code" role="option" aria-selected="false" onmousedown={(e) => e.preventDefault()} onclick={() => addExtra(id)}>{id}</button>
						{/each}
					</div>
				{/if}
			</div>
			{#if !candidates.length && !extras.length}<p class="state">{workspace.host.effectIds ? 'No other effect is open or in this effect’s pack.' : 'No other effect is open.'}</p>{/if}
		</Section>
		</div>

		<div class="foot">
			<span use:tip={{ where: 'this file › oxygen', text: 'The scene is kept in the file’s `oxygen` block, which the game ignores.' }}>Save the scene in the file</span>
			<Toggle checked={s.scene.keepInFile} label="Save the scene in the file" onchange={(v) => s.setScene({ keepInFile: v }, false)} />
		</div>
	{/if}
</div>

<style>
	.scene {
		height: 100%;
		overflow: auto;
		padding-bottom: 20px;
		container-type: inline-size;
	}
	/* wide (among the tool tabs): the sections side by side, each as wide as a side column */
	@container (min-width: 560px) {
		.sections {
			display: grid;
			grid-template-columns: repeat(auto-fill, 290px);
			align-items: start;
		}
		.sections > :global(section) {
			border-right: 1px solid var(--ox-rule);
		}
		.scene .foot {
			justify-content: flex-start;
			gap: 12px;
		}
	}
	h4 {
		margin: 0;
		font-size: var(--ox-title-size);
		color: var(--ox-haze);
		font-weight: 500;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 8px 10px;
		color: var(--ox-haze);
	}
	.subhead {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--ox-rule);
	}
	.spacer {
		flex: 1;
	}
	.row {
		display: grid;
		grid-template-columns: 78px 1fr;
		gap: 8px;
		align-items: center;
		min-height: 22px;
		color: var(--ox-haze);
	}
	/* a key the game reads from a file, written as the file writes it */
	.key {
		color: var(--ox-syn-variable);
		font-size: 12px;
		white-space: nowrap;
	}
	/* what belongs to the choice above it */
	.group {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 2px 0 2px 8px;
		border-left: 2px solid var(--ox-rule-strong);
	}
	.group .row,
	.row.long {
		grid-template-columns: minmax(78px, max-content) 1fr;
	}
	.inline {
		display: flex;
		gap: 6px;
		align-items: center;
		min-width: 0;
	}
	.pair > :global(*) {
		flex: 1;
		min-width: 0;
	}
	.vec {
		display: grid;
		grid-template-columns: 58px repeat(3, minmax(0, 1fr));
		gap: 4px;
		align-items: center;
		color: var(--ox-haze);
	}
	.withhint {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		line-height: 14px;
	}
	.read {
		color: var(--ox-frost);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dim {
		color: var(--ox-text-dim);
	}
	/* said only while it's true */
	.state {
		margin: 0;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.warn {
		color: var(--ox-warning);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 22px;
	}
	.name {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: none;
		background: none;
		color: var(--ox-haze);
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}
	.name:hover,
	.item.open .name {
		color: var(--ox-frost);
	}
	.tag {
		flex: none;
		padding: 0 5px;
		border-radius: 8px;
		background: var(--ox-selection);
		color: var(--ox-lox);
		font-size: 10.5px;
		line-height: 15px;
	}
	.eid {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ox-haze);
	}
	.x {
		flex: none;
		padding: 0 2px;
		border: none;
		background: none;
		color: var(--ox-text-dim);
		cursor: pointer;
	}
	.x:hover {
		color: var(--ox-error);
	}
	.x:disabled {
		visibility: hidden;
	}
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
	.text {
		height: 22px;
		min-width: 0;
		width: 100%;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
	}
	.text:focus {
		border-color: var(--ox-lox);
	}
	.add {
		position: relative;
		display: flex;
		gap: 4px;
	}
	.suggest {
		position: absolute;
		z-index: 5;
		top: 24px;
		left: 0;
		right: 0;
		max-height: 220px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding: 3px;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		box-shadow: var(--ox-float-shadow);
	}
	.suggest button {
		flex: none;
		height: 22px;
		padding: 0 6px;
		border: none;
		border-radius: 2px;
		background: none;
		color: var(--ox-frost);
		font-size: 12px;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.suggest button:hover {
		background: var(--ox-selection);
	}
	.check {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--ox-haze);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.size {
		margin-left: auto;
	}
	.actions.split {
		justify-content: space-between;
		margin-top: 4px;
		padding-top: 8px;
		border-top: 1px solid var(--ox-rule);
	}
	.btn {
		flex: none;
		border: 1px solid var(--ox-rule-strong);
		background: none;
		border-radius: var(--ox-radius);
		height: 22px;
		padding: 0 8px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		color: var(--ox-frost);
		white-space: nowrap;
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
	input[type='range'] {
		flex: 1;
		min-width: 0;
		accent-color: var(--ox-lox);
	}
	.val {
		width: 52px;
		flex: none;
		color: var(--ox-frost);
	}
</style>
