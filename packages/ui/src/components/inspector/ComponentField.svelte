<script lang="ts">
	import type { ComponentInfo, FieldInfo } from '@oxygen/format';
	import type { EffectSession } from '../../state/session.svelte';
	import { molangContextFor, orderOf, problemsAt } from '../../lib/field-context';
	import { joinPath, componentPath } from '../../lib/molang-text';
	import FieldRow from '../fields/FieldRow.svelte';
	import MolangInput from '../fields/MolangInput.svelte';
	import NumberInput from '../fields/NumberInput.svelte';
	import Select from '../fields/Select.svelte';
	import Toggle from '../fields/Toggle.svelte';
	import VecInput from '../fields/VecInput.svelte';
	import ListInput from '../fields/ListInput.svelte';
	import ColorField from '../fields/ColorField.svelte';
	import UvField from '../fields/UvField.svelte';
	import TimelineField from '../fields/TimelineField.svelte';
	import MiniGraph from '../fields/MiniGraph.svelte';
	import { getContext } from 'svelte';
	import { afterRelease } from '../../lib/pointer';
	import { menu, type MenuItem } from '../../lib/context-menu.svelte';
	import { molangText } from '../../lib/molang-text';
	import type { Workspace } from '../../state/workspace.svelte';

	interface Props {
		session: EffectSession;
		component: ComponentInfo;
		field: FieldInfo;
	}

	let { session, component, field }: Props = $props();

	const base = $derived(componentPath(component.id));
	const path = $derived(field.key ? joinPath(base, ...field.key.split('/')) : base);
	const label = $derived(`${component.label} › ${field.label}`);
	const value = $derived.by(() => {
		void session.version;
		return session.doc.get(path);
	});
	const firstAxisPath = $derived(field.kind.type === 'vec' ? joinPath(path, 0) : path);
	const order = $derived.by(() => {
		void session.version;
		return orderOf(session, firstAxisPath);
	});
	const problems = $derived.by(() => {
		void session.version;
		void session.runtimeProblems;
		return problemsAt(session, path);
	});
	const selected = $derived(session.selected === path || (session.selected?.startsWith(`${path}/`) ?? false));
	const stacked = $derived(field.kind.type === 'statements' || field.kind.type === 'vec' || field.kind.type === 'uv' || field.kind.type === 'color' || field.kind.type === 'timeline');

	const workspace = getContext<Workspace | undefined>('oxygen.workspace');
	/** the selected Molang value inside this field, when it changes over time (constants and statements have nothing to plot) */
	const graphPath = $derived.by(() => {
		void session.version;
		const sel = session.selected;
		if (!selected || !sel) return null;
		const ref = session.analysis?.byPath.get(sel);
		if (!ref || ref.field.broken || ref.field.constant !== null || !ref.expectsValue) return null;
		return sel;
	});
	/** the graph shown: it changes once the click that selected the field is over, so nothing moves under it */
	let shownGraph = $state<string | null>(null);
	$effect(() => {
		const p = graphPath;
		return afterRelease(() => (shownGraph = p));
	});

	function select(p = path) {
		// a click on the row bubbles up after an axis editor took focus: keep that more specific selection
		if (p === path && session.selected?.startsWith(`${path}/`)) return;
		session.selected = p;
	}

	function fieldMenu(): MenuItem[] {
		const text = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
		return [
			{ label: 'Show its graph', disabled: !graphPath && !(session.analysis?.byPath.get(path)?.field.constant === null), run: () => { select(); workspace?.show('graph'); } },
			{ separator: true },
			{ label: 'Copy the value', disabled: value === undefined, title: text, run: () => void navigator.clipboard.writeText(field.kind.type === 'molang' || field.kind.type === 'statements' ? molangText(value) : text) },
			{
				label: 'Paste the value',
				run: async () => {
					const t = (await navigator.clipboard.readText().catch(() => '')).trim();
					if (!t) return;
					let v: unknown = t;
					try {
						v = JSON.parse(t);
					} catch {
						// Molang text
					}
					if (field.kind.type === 'molang' || field.kind.type === 'statements') session.doc.setMolang(path, typeof v === 'string' || typeof v === 'number' ? String(v) : t, `Paste ${field.label}`);
					else set(v, field.label);
				},
			},
			{ separator: true },
			{ label: 'Reset to the default', disabled: value === undefined, run: () => set(undefined) },
		];
	}

	function set(v: unknown, what = field.label) {
		if (v === undefined) session.doc.remove(path, `Reset ${what}`);
		else session.doc.set(path, v, `Edit ${what}`);
	}

	const shapeDir = $derived.by(() => {
		if (field.kind.type !== 'shape-direction') return 'custom';
		if (value === 'inwards' || value === 'outwards') return value;
		if (Array.isArray(value)) return 'custom';
		return field.kind.allowOutwards ? 'outwards' : 'custom';
	});

	const planeNormal = $derived.by(() => {
		if (value === 'x' || value === 'y' || value === 'z') return value;
		if (Array.isArray(value)) return 'custom';
		return 'y';
	});

	const bbDir = $derived.by(() => {
		const d = value as { mode?: string; min_speed_threshold?: number; custom_direction?: unknown } | undefined;
		return d && typeof d === 'object' ? d : {};
	});
</script>

<div class="menuwrap" use:menu={fieldMenu}>
<FieldRow label={field.label} phase={field.phase} help={field.help} {order} {problems} {selected} {stacked} onselect={() => select()}>
	{#if field.kind.type === 'molang'}
		<MolangInput {session} {path} {label} placeholder={field.kind.default === null || field.kind.default === undefined ? 'not set' : String(field.kind.default)} context={molangContextFor(session, path, field)} onfocus={() => select()} />
	{:else if field.kind.type === 'statements'}
		<MolangInput {session} {path} {label} multiline placeholder="v.example = 1;" context={molangContextFor(session, path, field)} onfocus={() => select()} />
	{:else if field.kind.type === 'vec'}
		<VecInput {session} {path} info={field} labels={field.kind.labels} defaults={field.kind.default ?? field.kind.labels.map(() => 0)} baseLabel={label} onfocus={(p) => select(p)} />
	{:else if field.kind.type === 'number'}
		<NumberInput {session} {path} {label} fallback={field.kind.default} step={field.kind.step ?? 1} min={field.kind.min} max={field.kind.max} unit={field.kind.unit} />
	{:else if field.kind.type === 'bool'}
		<div class="inline">
			<Toggle checked={value === true || (value === undefined && field.kind.default === true)} {label} onchange={(v) => set(v)} />
		</div>
	{:else if field.kind.type === 'enum'}
		<Select value={typeof value === 'string' ? value : (field.kind.default ?? '')} options={field.kind.options} {label} onchange={(v) => set(v)} />
	{:else if field.kind.type === 'string'}
		<input class="text" aria-label={label} value={typeof value === 'string' ? value : ''} placeholder={field.kind.placeholder} onchange={(e) => set(e.currentTarget.value || undefined)} />
	{:else if field.kind.type === 'events' || field.kind.type === 'blocks'}
		<ListInput
			items={Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []}
			{label}
			placeholder={field.kind.type === 'events' ? 'event name' : 'minecraft:block'}
			suggestions={field.kind.type === 'events' ? [...session.def.events.keys()] : []}
			onchange={(list) => set(list.length ? (field.kind.type === 'events' && list.length === 1 ? list[0] : list) : undefined)}
		/>
	{:else if field.kind.type === 'plane'}
		<div class="plane">
			{#each ['A', 'B', 'C', 'D'] as k, i (k)}
				<NumberInput {session} path={joinPath(path, i)} label="{label} {k}" step={0.1} />
			{/each}
		</div>
	{:else if field.kind.type === 'shape-direction'}
		<div class="col">
			<Select
				value={shapeDir}
				{label}
				options={[...(field.kind.allowOutwards ? [{ value: 'outwards', label: 'Outwards' }, { value: 'inwards', label: 'Inwards' }] : []), { value: 'custom', label: 'Custom vector' }]}
				onchange={(v) => session.switchKind(path, shapeDir, v, v === 'custom' ? [0, 1, 0] : v, `Edit ${field.label}`)}
			/>
			{#if shapeDir === 'custom'}
				<VecInput {session} {path} info={field} labels={['X', 'Y', 'Z']} defaults={[0, 0, 0]} baseLabel={label} onfocus={(p) => select(p)} />
			{/if}
		</div>
	{:else if field.kind.type === 'plane-normal'}
		<div class="col">
			<Select
				value={planeNormal}
				{label}
				options={[
					{ value: 'x', label: 'X axis' },
					{ value: 'y', label: 'Y axis (flat)' },
					{ value: 'z', label: 'Z axis' },
					{ value: 'custom', label: 'Custom vector' },
				]}
				onchange={(v) => session.switchKind(path, planeNormal, v, v === 'custom' ? [0, 1, 0] : v === 'y' ? undefined : v, `Edit ${field.label}`)}
			/>
			{#if planeNormal === 'custom'}
				<VecInput {session} {path} info={field} labels={['X', 'Y', 'Z']} defaults={[0, 1, 0]} baseLabel={label} onfocus={(p) => select(p)} />
			{/if}
		</div>
	{:else if field.kind.type === 'billboard-direction'}
		<div class="col">
			<Select
				value={bbDir.mode === 'custom' ? 'custom' : 'derive_from_velocity'}
				{label}
				options={[
					{ value: 'derive_from_velocity', label: 'From velocity' },
					{ value: 'custom', label: 'Custom (Molang)' },
				]}
				onchange={(v) => session.switchKind(path, bbDir.mode === 'custom' ? 'custom' : 'derive_from_velocity', v, v === 'custom' ? { mode: 'custom', custom_direction: [0, 0, 1] } : undefined, `Edit ${field.label}`)}
			/>
			{#if bbDir.mode === 'custom'}
				<VecInput {session} path={joinPath(path, 'custom_direction')} info={field} labels={['X', 'Y', 'Z']} defaults={[0, 0, 0]} baseLabel="{label} custom" onfocus={(p) => select(p)} />
			{:else}
				<div class="sub">
					<span class="sublabel">Min speed</span>
					<NumberInput {session} path={joinPath(path, 'min_speed_threshold')} label="{label} min speed" fallback={0.01} step={0.01} unit="blocks/s" />
				</div>
			{/if}
		</div>
	{:else if field.kind.type === 'color'}
		<ColorField {session} {path} {label} onfocus={(p) => select(p)} />
	{:else if field.kind.type === 'uv'}
		<UvField {session} {path} {label} info={field} onfocus={(p) => select(p)} />
	{:else if field.kind.type === 'timeline' || field.kind.type === 'looping-distance'}
		<TimelineField {session} {path} {label} mode={field.kind.type === 'looping-distance' ? 'looping' : field.kind.key} />
	{:else if field.kind.type === 'collision-events'}
		<TimelineField {session} {path} {label} mode="collision" />
	{/if}
	{#if shownGraph}<MiniGraph {session} path={shownGraph} onexpand={() => workspace?.show('graph')} />{/if}
</FieldRow>
</div>

<style>
	.menuwrap {
		display: contents;
	}
	.inline {
		display: flex;
		align-items: center;
		height: 22px;
	}
	.text {
		flex: 1;
		min-width: 0;
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
	}
	.text:focus {
		border-color: var(--ox-lox);
	}
	.plane {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 3px;
		flex: 1;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
		min-width: 0;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.sublabel {
		color: var(--ox-text-dim);
		white-space: nowrap;
	}
</style>
