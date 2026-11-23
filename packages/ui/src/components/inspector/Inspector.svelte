<script lang="ts">
	import { CATEGORIES, COMPONENTS, COMPONENT_BY_ID, MATERIALS, PHASES, type Category, type ComponentInfo, type FieldInfo } from '@oxygen/format';
	import { menu, type MenuItem } from '../../lib/context-menu.svelte';
	import { BASE_MATERIALS, baseMaterial } from '../../lib/materials';
	import type { Workspace } from '../../state/workspace.svelte';
	import type { EffectSession } from '../../state/session.svelte';
	import { componentPath, joinPath, PHASE_VAR } from '../../lib/molang-text';
	import ComponentBlock from './ComponentBlock.svelte';
	import ComponentField from './ComponentField.svelte';
	import Select from '../fields/Select.svelte';
	import { tip } from '../../lib/tip';

	interface Props {
		workspace: Workspace;
		session: EffectSession;
		/** show this category alone: the panel a category has when it's moved out of the Inspector */
		only?: Category;
	}

	let { workspace, session, only }: Props = $props();

	/** a category with a panel of its own is left out here: it's edited there */
	const out = (id: Category) => workspace.openPanels.includes(`cat-${id}`);
	const folded = (id: Category) => !!workspace.inspectorFolded[id];
	function catMenu(id: Category, label: string): MenuItem[] {
		return [
			{ label: folded(id) ? 'Unfold' : 'Fold', run: () => workspace.foldCategory(id) },
			{ label: 'Fold the others', run: () => CATEGORIES.forEach((c) => workspace.foldCategory(c.id, c.id !== id)) },
			{ label: 'Unfold all', disabled: !Object.keys(workspace.inspectorFolded).length, run: () => CATEGORIES.forEach((c) => workspace.foldCategory(c.id, false)) },
			{ separator: true },
			{ label: `Open ${label} in its own tab`, title: 'A panel to move, dock or close like any other. Closing it puts the category back here.', run: () => workspace.show(`cat-${id}`) },
		];
	}

	const components = $derived.by(() => {
		void session.version;
		const c = session.doc.get('particle_effect/components');
		return c && typeof c === 'object' ? Object.keys(c as object) : [];
	});
	const present = $derived(components.map((id) => COMPONENT_BY_ID.get(id)).filter((c): c is ComponentInfo => !!c));
	const unknown = $derived(components.filter((id) => !COMPONENT_BY_ID.has(id)));
	/** every component, on or off, in catalogue order; a group (rate, lifetime, shape) is one row */
	const rows = $derived.by(() => {
		const out: { component: ComponentInfo; enabled: boolean }[] = [];
		const groups = new Set<string>();
		for (const c of COMPONENTS) {
			if (c.group) {
				if (groups.has(c.group)) continue;
				groups.add(c.group);
				const member = present.find((p) => p.group === c.group);
				out.push({ component: member ?? c, enabled: !!member });
			} else out.push({ component: c, enabled: components.includes(c.id) });
		}
		return out;
	});

	const desc = 'particle_effect/description';
	const identifier = $derived.by(() => {
		void session.version;
		return String(session.doc.get(joinPath(desc, 'identifier')) ?? '');
	});
	const material = $derived.by(() => {
		void session.version;
		return String(session.doc.get(joinPath(desc, 'basic_render_parameters', 'material')) ?? 'particles_alpha');
	});
	/** materials this pack defines, beyond the game's four */
	const packMaterials = $derived(Object.keys(session.packMaterials).filter((n) => !BASE_MATERIALS.includes(n)).sort());
	const listed = $derived(BASE_MATERIALS.includes(material) || packMaterials.includes(material));
	/** the name is being typed: Custom… was chosen */
	let customMaterial = $state(false);
	const drawnAs = $derived(MATERIALS.find((m) => m.value === baseMaterial(material, session.packMaterials))?.label ?? 'Cutout');
	function setMaterial(name: string) {
		session.doc.set(joinPath(desc, 'basic_render_parameters', 'material'), name, 'Change material');
	}
	const texture = $derived.by(() => {
		void session.version;
		return String(session.doc.get(joinPath(desc, 'basic_render_parameters', 'texture')) ?? '');
	});

	/** Phase view rows: every field of every present component, in evaluation order */
	const phaseRows = $derived.by(() => {
		void session.version;
		const rows: { component: ComponentInfo; field: FieldInfo; rank: number }[] = [];
		for (const c of present) {
			c.fields.forEach((f, i) => {
				const base = componentPath(c.id);
				const p = f.key ? joinPath(base, ...f.key.split('/')) : base;
				const ref = session.analysis?.byPath.get(p) ?? session.analysis?.byPath.get(joinPath(p, 0));
				rows.push({ component: c, field: f, rank: ref?.rank ?? 10_000 + COMPONENTS.indexOf(c) * 10 + i });
			});
		}
		return rows.sort((a, b) => a.rank - b.rank);
	});
</script>

<div class="inspector">
	<div class="scroll">
		{#if only}
			{@const list = rows.filter((r) => r.component.category === only)}
			{#each list as r (r.component.group ?? r.component.id)}
				<ComponentBlock {session} component={r.component} enabled={r.enabled} />
			{/each}
		{:else}
		<section class="effect" aria-label="Effect">
			<div class="erow">
				<label for="ox-id">Identifier</label>
				<input
					id="ox-id"
					class="ox-code"
					value={identifier}
					placeholder="namespace:name"
					onchange={(e) => session.doc.set(joinPath(desc, 'identifier'), e.currentTarget.value, 'Rename effect')}
				/>
			</div>
			<div class="erow">
				<span class="lab" use:tip={{ where: 'description › basic_render_parameters › material', text: 'How the particles are blended with what is behind them.' }}>Material</span>
				<Select
					value={customMaterial || !listed ? '__custom' : material}
					label="Material"
					options={[
						...MATERIALS,
						...packMaterials.map((n) => ({ value: n, label: n, help: session.packMaterials[n] ? `This pack’s, from ${session.packMaterials[n]}` : 'This pack’s' })),
						{ value: '__custom', label: 'Custom…', help: 'Any other material, by name' },
					]}
					onchange={(v) => {
						customMaterial = v === '__custom';
						if (v !== '__custom') setMaterial(v);
					}}
				/>
			</div>
			{#if customMaterial || !listed}
				<div class="erow">
					<span class="lab ox-code key">material</span>
					<div class="custom">
						<input class="ox-code" aria-label="Material name" value={material} placeholder="particles_…" spellcheck="false" onchange={(e) => e.currentTarget.value.trim() && setMaterial(e.currentTarget.value.trim())} />
						<span class="dim" use:tip={'The preview only draws the game’s four. Another material is drawn as the one it inherits from in the pack’s `materials/particles.material`, else as its name suggests, else as Cutout.'}>drawn as {drawnAs}</span>
					</div>
				</div>
			{/if}
			<div class="erow">
				<label for="ox-tex">Texture</label>
				<input
					id="ox-tex"
					class="ox-code"
					value={texture}
					placeholder="textures/particle/particles"
					onchange={(e) => session.doc.set(joinPath(desc, 'basic_render_parameters', 'texture'), e.currentTarget.value, 'Change texture')}
				/>
			</div>
		</section>

		{#if workspace.inspectorView === 'categories'}
			{#each CATEGORIES as cat (cat.id)}
				{@const list = rows.filter((r) => r.component.category === cat.id)}
				{#if list.length && !out(cat.id)}
					<div class="cat" use:menu={() => catMenu(cat.id, cat.label)}>
						<h2>
							<button class="fold" aria-expanded={!folded(cat.id)} onclick={() => workspace.foldCategory(cat.id)}>
								<svg viewBox="0 0 8 8" class:closed={folded(cat.id)} aria-hidden="true"><path d="M1.5 2.5l2.5 3 2.5-3" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
								{cat.label}
								{#if folded(cat.id)}<span class="count ox-num">{list.filter((r) => r.enabled).length}</span>{/if}
							</button>
						</h2>
						<button class="pop" aria-label="Open {cat.label} in its own tab" use:tip={'Open in its own tab'} onclick={() => workspace.show(`cat-${cat.id}`)}>
							<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5h-2v7h7v-2M7 2.5h2.5V5M9.5 2.5L5.5 6.5" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
						</button>
					</div>
					{#if !folded(cat.id)}
						{#each list as r (r.component.group ?? r.component.id)}
							<ComponentBlock {session} component={r.component} enabled={r.enabled} />
						{/each}
					{/if}
				{/if}
			{/each}
			{#if CATEGORIES.some((c) => out(c.id))}
				<p class="away">In their own tabs: {#each CATEGORIES.filter((c) => out(c.id)) as c, i (c.id)}{i ? ', ' : ''}<button class="link" onclick={() => workspace.show(`cat-${c.id}`)}>{c.label}</button>{/each}</p>
			{/if}
		{:else}
			{#each PHASES as ph (ph.id)}
				{@const rows = phaseRows.filter((r) => r.field.phase === ph.id && !out(r.component.category))}
				{#if rows.length}
					<h2 class="cat phase" style:--phase={PHASE_VAR[ph.id]}><span use:tip={ph.detail}>{ph.label}</span></h2>
					{#each rows as r, i (r.component.id + r.field.key)}
						<div class="prefixed">
							{#if i === 0 || rows[i - 1].component.id !== r.component.id}<span class="owner">{r.component.label}</span>{/if}
							<ComponentField {session} component={r.component} field={r.field} />
						</div>
					{/each}
				{/if}
			{/each}
		{/if}
		{/if}

		{#each unknown as id (id)}
			<div class="unknown">
				<span class="ox-code">{id}</span>
				<span>Not a particle component. The game logs an error and ignores it.</span>
				<button class="link" onclick={() => session.doc.remove(componentPath(id), 'Remove unknown component')}>Remove</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		height: 100%;
		position: relative;
	}
	.scroll {
		flex: 1;
		overflow: auto;
		padding-bottom: 40px;
	}
	.effect {
		padding: 8px 8px 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		border-bottom: 1px solid var(--ox-rule);
	}
	.erow {
		display: grid;
		grid-template-columns: minmax(84px, 34%) 1fr;
		gap: 6px;
		align-items: center;
	}
	.erow label,
	.erow .lab {
		color: var(--ox-haze);
	}
	.erow input {
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
		min-width: 0;
	}
	.erow input:focus {
		border-color: var(--ox-lox);
	}
	.erow .key {
		color: var(--ox-syn-variable);
		font-size: 12px;
	}
	.custom {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.custom input {
		flex: 1;
	}
	.dim {
		flex: none;
		color: var(--ox-text-dim);
		font-size: 11.5px;
		white-space: nowrap;
	}
	h2 {
		margin: 0;
		font-size: var(--ox-title-size);
		font-weight: 600;
	}
	.cat {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 10px 6px 2px 4px;
		color: var(--ox-haze);
	}
	h2.cat {
		padding: 12px 10px 2px;
	}
	.fold {
		display: flex;
		align-items: center;
		gap: 5px;
		height: 22px;
		padding: 0 6px 0 4px;
		border: none;
		border-radius: var(--ox-radius);
		background: none;
		color: inherit;
		font-weight: inherit;
		cursor: pointer;
	}
	.fold:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.fold svg {
		width: 9px;
		height: 9px;
		transition: transform 0.12s;
	}
	.fold svg.closed {
		transform: rotate(-90deg);
	}
	.count {
		color: var(--ox-text-dim);
		font-weight: 400;
	}
	/* out to a tab of its own: there when the heading is pointed at */
	.pop {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		opacity: 0;
	}
	.cat:hover .pop,
	.pop:focus-visible {
		opacity: 1;
	}
	.pop:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.pop svg {
		width: 12px;
		height: 12px;
	}
	.away {
		margin: 14px 10px 0;
		color: var(--ox-text-dim);
	}
	.cat.phase {
		color: var(--phase);
	}
	.prefixed {
		position: relative;
	}
	.owner {
		display: block;
		padding: 4px 10px 0 10px;
		color: var(--ox-text-dim);
		font-size: 11px;
		line-height: 14px;
	}
	.unknown {
		margin: 8px;
		padding: 6px 8px;
		border-left: 2px solid var(--ox-warning);
		background: var(--ox-hover);
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		color: var(--ox-haze);
	}
	.link {
		border: none;
		background: none;
		color: var(--ox-lox);
		cursor: pointer;
		padding: 0;
	}
</style>
