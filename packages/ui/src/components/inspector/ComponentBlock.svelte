<script lang="ts">
	import { COMPONENTS, componentInsertionIndex, type ComponentInfo } from '@oxygen/format';
	import type { EffectSession } from '../../state/session.svelte';
	import { componentPath, joinPath } from '../../lib/molang-text';
	import { problemsAt, molangContextFor, orderOf } from '../../lib/field-context';
	import ComponentField from './ComponentField.svelte';
	import FieldRow from '../fields/FieldRow.svelte';
	import MolangInput from '../fields/MolangInput.svelte';
	import VecInput from '../fields/VecInput.svelte';
	import Select from '../fields/Select.svelte';
	import Toggle from '../fields/Toggle.svelte';
	import { menu, type MenuItem } from '../../lib/context-menu.svelte';
	import { parse as parseJsonc } from 'jsonc-parser';

	interface Props {
		session: EffectSession;
		component: ComponentInfo;
		/** off: the component isn't in the file; the row only offers to turn it on */
		enabled?: boolean;
	}

	let { session, component, enabled = true }: Props = $props();
	let open = $state(true);

	/** a group (rate, lifetime, shape) is one row whichever member the file uses */
	const GROUP_LABELS: Record<string, string> = { rate: 'Emitter rate', lifetime: 'Emitter lifetime', shape: 'Shape' };

	const path = $derived(componentPath(component.id));
	const siblings = $derived(component.group ? COMPONENTS.filter((c) => c.group === component.group) : []);
	const title = $derived(!enabled && component.group ? (GROUP_LABELS[component.group] ?? component.label) : component.label);
	const problems = $derived.by(() => {
		void session.version;
		return enabled ? problemsAt(session, path, true) : [];
	});
	const value = $derived.by(() => {
		void session.version;
		return session.doc.get(path);
	});

	/** Turn the component on or off. Off remembers its values, so turning it back on restores them. */
	function setEnabled(on: boolean) {
		if (!on) {
			session.removeComponent(path, `Turn off ${component.label}`);
			return;
		}
		// a group comes back as the member last used, with its values
		const members = siblings.length ? siblings : [component];
		const last = members.find((m) => session.rememberedComponent(componentPath(m.id)) !== undefined) ?? component;
		const remembered = session.rememberedComponent(componentPath(last.id));
		session.doc.set(componentPath(last.id), remembered ?? initialValue(last), `Turn on ${last.label}`, componentInsertionIndex(last.id));
	}

	function initialValue(c: ComponentInfo): unknown {
		return c.valueShape === 'molang-or-vec' ? 1 : c.valueShape === 'plane' ? [0, 1, 0, 0] : c.valueShape === 'blocks' ? ['minecraft:water'] : {};
	}

	/** Swap a group member (Burst → Steady rate): each keeps its own values, a new one starts from the shared fields */
	function switchTo(id: string) {
		if (id === component.id) return;
		const next = COMPONENTS.find((c) => c.id === id)!;
		session.swapComponent(
			path,
			componentPath(id),
			componentInsertionIndex(id),
			(old) => {
				const keep: Record<string, unknown> = {};
				for (const f of next.fields) if (f.key && old[f.key] !== undefined) keep[f.key] = old[f.key];
				return keep;
			},
			`Use ${next.label}`,
		);
	}

	function headerMenu(): MenuItem[] {
		if (!enabled) return [{ label: `Turn on ${title}`, run: () => setEnabled(true) }];
		return [
			{ label: open ? 'Collapse' : 'Expand', run: () => void (open = !open) },
			{ separator: true },
			{ label: 'Copy JSON', run: () => void navigator.clipboard.writeText(JSON.stringify(value, null, '\t')) },
			{
				label: 'Paste JSON',
				title: 'Replace its values with JSON from the clipboard',
				run: async () => {
					const text = await navigator.clipboard.readText().catch(() => '');
					const errors: never[] = [];
					const v = parseJsonc(text, errors, { allowTrailingComma: true });
					if (errors.length || v === undefined) return;
					session.doc.set(path, v, `Paste ${component.label}`);
				},
			},
			{ label: 'Reset to its defaults', title: 'Clear every field, so each takes the game’s default', run: () => session.doc.set(path, initialValue(component), `Reset ${component.label}`) },
			{ separator: true },
			{ label: `Turn off ${component.label}`, danger: true, title: 'Its values come back when you turn it on', run: () => setEnabled(false) },
		];
	}

	const speedIsVector = $derived(component.id === 'minecraft:particle_initial_speed' && Array.isArray(value));
</script>

<section class="block" class:off={!enabled} aria-label={title}>
	<header use:menu={headerMenu}>
		{#if enabled}
			<button class="chev" aria-expanded={open} aria-label="{open ? 'Collapse' : 'Expand'} {component.label}" onclick={() => (open = !open)}>
				<svg viewBox="0 0 8 8" class:closed={!open} aria-hidden="true"><path d="M1.5 2.5l2.5 3 2.5-3" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
			</button>
		{:else}
			<span class="chev" aria-hidden="true"></span>
		{/if}
		{#if enabled && siblings.length > 1}
			<div class="switch">
				<Select value={component.id} label="{component.group} type" options={siblings.map((s) => ({ value: s.id, label: s.label, help: s.help }))} onchange={switchTo} />
			</div>
		{:else}
			<h3 title={component.help}>{title}</h3>
		{/if}
		{#if problems.length}<span class="flag {problems.some((p) => p.severity === 'error') ? 'error' : problems.some((p) => p.severity === 'warning') ? 'warning' : 'info'}" title={problems.map((p) => p.message).join('\n')}></span>{/if}
		<span class="onoff" title={enabled ? `Turn off ${component.label} (its values come back when you turn it on)` : `Turn on ${title}`}>
			<Toggle checked={enabled} label="{title} on" onchange={setEnabled} />
		</span>
	</header>
	{#if enabled && open}
		<p class="help">{component.help}</p>
		{#if component.id === 'minecraft:particle_initial_speed'}
			{@const f = component.fields[0]}
			<FieldRow label={speedIsVector ? 'Velocity' : 'Speed'} phase="spawn" help={f.help} order={orderOf(session, speedIsVector ? joinPath(path, 0) : path)} problems={problemsAt(session, path)} stacked={speedIsVector}>
				<div class="col">
					<Select
						value={speedIsVector ? 'vector' : 'speed'}
						label="Initial speed kind"
						options={[
							{ value: 'speed', label: "Speed along the shape's direction" },
							{ value: 'vector', label: 'Velocity vector' },
						]}
						onchange={(v) => session.switchKind(path, speedIsVector ? 'vector' : 'speed', v, v === 'vector' ? [0, 1, 0] : 1, 'Change initial speed kind')}
					/>
					{#if speedIsVector}
						<VecInput {session} {path} info={f} labels={['X', 'Y', 'Z']} defaults={[0, 0, 0]} baseLabel="Initial velocity" onfocus={(p) => (session.selected = p)} />
					{:else}
						<MolangInput {session} {path} label="Initial speed" placeholder="0" context={molangContextFor(session, path, f, 0)} onfocus={() => (session.selected = path)} />
					{/if}
				</div>
			</FieldRow>
		{:else}
			{#each component.fields as field (field.key)}
				<ComponentField {session} {component} {field} />
			{/each}
		{/if}
	{/if}
</section>

<style>
	.block {
		border-bottom: 1px solid var(--ox-rule);
		padding-bottom: 6px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 30px;
		padding: 0 6px 0 4px;
	}
	h3 {
		margin: 0;
		font-size: var(--ox-title-size);
		font-weight: 600;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.switch {
		flex: 1;
		min-width: 0;
		max-width: 200px;
		font-weight: 600;
	}
	.switch + .flag,
	.switch ~ .onoff {
		margin-left: auto;
	}
	.onoff {
		display: flex;
		align-items: center;
		padding-right: 2px;
	}
	.block.off {
		padding-bottom: 0;
	}
	.block.off header {
		height: 26px;
	}
	.block.off h3 {
		color: var(--ox-text-dim);
		font-weight: 500;
	}
	.chev {
		width: 20px;
		height: 20px;
		border: none;
		background: none;
		color: var(--ox-haze);
		border-radius: var(--ox-radius);
		cursor: pointer;
		display: grid;
		place-items: center;
		flex: none;
		padding: 0;
	}
	.chev svg {
		width: 9px;
		height: 9px;
		transition: transform 0.12s;
	}
	.chev svg.closed {
		transform: rotate(-90deg);
	}
	button.chev:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.help {
		margin: -4px 10px 4px 28px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
		line-height: 16px;
		max-width: 60ch;
	}
	.flag {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex: none;
	}
	.flag.error {
		background: var(--ox-error);
	}
	.flag.warning {
		background: var(--ox-warning);
	}
	.flag.info {
		background: var(--ox-haze);
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
		min-width: 0;
	}
</style>
