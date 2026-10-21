<script lang="ts">
	import type { InputValue, SceneSource } from '@oxygen/format';
	import type { Value } from 'molangjs';
	import ScrubNumber from '../fields/ScrubNumber.svelte';
	import MolangText from '../fields/MolangText.svelte';
	import { evalKeys, inputKind, SCENE_SOURCES, type InputKind, type InputType } from '../../lib/inputs';
	import { showNumber } from '../../lib/numbers';

	interface Props {
		/** shown name: `v.size`, `q.position(1)` */
		name: string;
		kind: 'variable' | 'query';
		type: InputType;
		/** a query called with changing arguments: offers a per-argument table */
		dynamic?: boolean;
		value: InputValue | undefined;
		/** what the preview used last (live) */
		live?: Value | undefined;
		/** how to show it instead, when it isn't one value (a struct query's members) */
		liveText?: string;
		/** argument lists this query was called with, for filling a table */
		seenArgs?: string[];
		onchange: (value: InputValue | undefined) => void;
		pinned?: boolean;
		onpin?: (on: boolean) => void;
		description?: string;
	}

	let { name, kind, type, dynamic = false, value, live, liveText, seenArgs = [], onchange, pinned = false, onpin, description }: Props = $props();

	const mode = $derived<InputKind | 'none'>(value === undefined ? 'none' : inputKind(value));
	const MODES = $derived<{ id: InputKind | 'none'; label: string }[]>([
		{ id: 'none', label: kind === 'query' ? 'Live' : 'Not set' },
		{ id: 'constant', label: 'Value' },
		...(dynamic ? [{ id: 'table' as const, label: 'Per argument' }] : []),
		{ id: 'molang', label: 'Molang' },
		{ id: 'keys', label: 'Keyframes' },
		{ id: 'scene', label: 'Scene' },
	]);

	function liveNumber(): number {
		return typeof live === 'number' && Number.isFinite(live) ? Number(showNumber(live, 4)) : 0;
	}

	function current(): number {
		if (typeof value === 'number') return value;
		return liveNumber();
	}

	function setMode(m: InputKind | 'none') {
		switch (m) {
			case 'none':
				return onchange(undefined);
			case 'constant':
				return onchange(type === 'string' ? (typeof live === 'string' ? live : '') : type === 'bool' ? 1 : current());
			case 'molang':
				return onchange({ molang: typeof value === 'number' ? String(value) : 'math.sin(q.anim_time * 90)' });
			case 'keys': {
				const v = current();
				return onchange({ keys: [[0, v], [1, v === 0 ? 1 : v * 2]] });
			}
			case 'table':
				return onchange({ table: Object.fromEntries(seenArgs.slice(0, 8).map((a) => [a, type === 'string' ? '' : 0])), fallback: type === 'string' ? '' : 0 });
			case 'scene':
				return onchange({ scene: 'time' });
		}
	}

	function showValue(v: Value | undefined): string {
		if (v === undefined) return kind === 'query' ? 'none' : '';
		if (typeof v === 'string') return `'${v}'`;
		return showNumber(v, 3);
	}

	// keyframes
	const keys = $derived(value && typeof value === 'object' && 'keys' in value ? value : null);
	function setKeys(patch: Partial<{ keys: [number, number][]; loop: boolean; step: boolean }>) {
		if (!keys) return;
		const next = { ...keys, ...patch };
		if (!next.loop) delete next.loop;
		if (!next.step) delete next.step;
		onchange(next);
	}
	function setKey(i: number, at: 0 | 1, n: number | null) {
		if (!keys || n === null) return;
		const list = keys.keys.map((k) => [...k] as [number, number]);
		list[i][at] = n;
		setKeys({ keys: list });
	}
	function addKey() {
		if (!keys) return;
		const last = keys.keys[keys.keys.length - 1] ?? [0, 0];
		setKeys({ keys: [...keys.keys, [Number((last[0] + 1).toFixed(3)), last[1]]] });
	}
	const spark = $derived.by(() => {
		if (!keys || !keys.keys.length) return '';
		const ts = keys.keys.map((k) => k[0]);
		const t0 = Math.min(...ts);
		const t1 = Math.max(...ts, t0 + 1e-6);
		const span = t1 - t0;
		const pts: [number, number][] = [];
		for (let i = 0; i <= 48; i++) {
			const t = t0 - span * 0.1 + (span * 1.2 * i) / 48;
			pts.push([i, evalKeys(keys.keys, t, keys.loop, keys.step)]);
		}
		const lo = Math.min(...pts.map((p) => p[1]));
		const hi = Math.max(...pts.map((p) => p[1]), lo + 1e-6);
		return pts.map(([x, y]) => `${(x / 48) * 100},${18 - ((y - lo) / (hi - lo)) * 16}`).join(' ');
	});

	// per-argument table
	const table = $derived(value && typeof value === 'object' && 'table' in value ? value : null);
	let newArgs = $state('');
	function setTable(entries: [string, number | string][], fallback = table?.fallback) {
		onchange({ table: Object.fromEntries(entries), ...(fallback === undefined ? {} : { fallback }) });
	}
	function addRow(args: string) {
		const a = args.trim();
		if (!table || !a || a in table.table) return;
		setTable([...Object.entries(table.table), [a, type === 'string' ? '' : 0]]);
		newArgs = '';
	}
</script>

<div class="input" class:pinned class:set={mode !== 'none'} title={description}>
	<span class="name ox-code">{name}</span>
	<select class="mode" aria-label="How the preview supplies {name}" value={mode} onchange={(e) => setMode(e.currentTarget.value as InputKind | 'none')}>
		{#each MODES as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
	</select>
	<div class="editor">
		{#if mode === 'none'}
			<span class="dim">{kind === 'query' ? (live === undefined ? 'nothing supplies this (reads 0.0)' : 'from the scene') : 'unset: reading it aborts the expression'}</span>
		{:else if mode === 'constant'}
			{#if typeof value === 'string'}
				<input class="text ox-code" aria-label="{name} text" value={value} onchange={(e) => onchange(e.currentTarget.value)} />
			{:else if type === 'bool'}
				<label class="bool"><input type="checkbox" checked={value === 1} onchange={(e) => onchange(e.currentTarget.checked ? 1 : 0)} /> {value === 1 ? 'true (1.0)' : 'false (0.0)'}</label>
			{:else}
				<ScrubNumber label="{name} value" value={typeof value === 'number' ? value : 0} onchange={(n) => onchange(n ?? 0)} />
			{/if}
			<span class="kind" role="radiogroup" aria-label="{name} type">
				<button role="radio" aria-checked={typeof value !== 'string'} title="A number" onclick={() => typeof value === 'string' && onchange(Number.isFinite(Number(value)) && value.trim() !== '' ? Number(value) : 0)}>123</button>
				<button role="radio" aria-checked={typeof value === 'string'} title="Text (a Molang string)" onclick={() => typeof value !== 'string' && onchange(typeof value === 'number' && type !== 'bool' ? String(value) : '')}>abc</button>
			</span>
		{:else if mode === 'molang' && value && typeof value === 'object' && 'molang' in value}
			<MolangText label="{name} Molang" value={value.molang} placeholder="math.sin(q.anim_time * 90)" onchange={(t) => onchange({ molang: t })} />
		{:else if mode === 'scene' && value && typeof value === 'object' && 'scene' in value}
			<select class="grow" aria-label="{name} scene source" value={value.scene} onchange={(e) => onchange({ scene: e.currentTarget.value as SceneSource })}>
				{#each SCENE_SOURCES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
			</select>
		{:else if keys}
			<svg class="spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><polyline points={spark} /></svg>
		{:else if table}
			<span class="dim">{Object.keys(table.table).length} argument value{Object.keys(table.table).length === 1 ? '' : 's'}</span>
		{/if}
	</div>
	<span class="live ox-num" title="What the preview used last">{liveText ?? showValue(live)}</span>
	{#if onpin}
		<button class="pin" class:on={pinned} aria-pressed={pinned} disabled={mode === 'none'} title={pinned ? 'Pinned: written before every update. The game never does this.' : 'Pin: write this value before every update instead of only at spawn'} onclick={() => onpin?.(!pinned)}>
			<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 2h4l-.5 4 2.5 2v1H4V8l2.5-2zM8 9v5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>
		</button>
	{:else}
		<span></span>
	{/if}

	{#if keys}
		<div class="more">
			{#each keys.keys as k, i (i)}
				<div class="kv">
					<span class="dim">at</span>
					<ScrubNumber label="Key {i + 1} time" value={k[0]} min={0} step={0.05} onchange={(n) => setKey(i, 0, n)} />
					<span class="dim">s =</span>
					<ScrubNumber label="Key {i + 1} value" value={k[1]} onchange={(n) => setKey(i, 1, n)} />
					<button class="x" aria-label="Remove key {i + 1}" disabled={keys.keys.length < 2} onclick={() => setKeys({ keys: keys.keys.filter((_, j) => j !== i) })}>×</button>
				</div>
			{/each}
			<div class="opts">
				<button class="link" onclick={addKey}>Add key</button>
				<label><input type="checkbox" checked={!!keys.loop} onchange={(e) => setKeys({ loop: e.currentTarget.checked })} /> Loop</label>
				<label><input type="checkbox" checked={!!keys.step} onchange={(e) => setKeys({ step: e.currentTarget.checked })} /> Hold between keys</label>
			</div>
		</div>
	{:else if table}
		<div class="more">
			{#each Object.entries(table.table) as [args, v] (args)}
				<div class="kv">
					<span class="ox-code args">{name.replace(/\(.*$/, '')}({args})</span>
					{#if typeof v === 'string'}
						<input class="text ox-code" aria-label="Value for ({args})" value={v} onchange={(e) => setTable(Object.entries(table.table).map(([a, x]) => [a, a === args ? e.currentTarget.value : x]))} />
					{:else}
						<ScrubNumber label="Value for ({args})" value={v} onchange={(n) => setTable(Object.entries(table.table).map(([a, x]) => [a, a === args ? (n ?? 0) : x]))} />
					{/if}
					<button class="x" aria-label="Remove ({args})" onclick={() => setTable(Object.entries(table.table).filter(([a]) => a !== args))}>×</button>
				</div>
			{/each}
			<div class="kv">
				<span class="dim args">anything else</span>
				{#if typeof table.fallback === 'string'}
					<input class="text ox-code" aria-label="Fallback value" value={table.fallback} onchange={(e) => setTable(Object.entries(table.table), e.currentTarget.value)} />
				{:else}
					<ScrubNumber label="Fallback value" value={table.fallback ?? null} allowEmpty placeholder="live" onchange={(n) => setTable(Object.entries(table.table), n ?? undefined)} />
				{/if}
				<span></span>
			</div>
			<div class="opts">
				<input class="text ox-code add" placeholder="arguments, e.g. 2 or 'head'" aria-label="Add argument value" bind:value={newArgs} onkeydown={(e) => e.key === 'Enter' && addRow(newArgs)} />
				<button class="link" onclick={() => addRow(newArgs)}>Add</button>
				{#each seenArgs.filter((a) => !(a in table.table)).slice(0, 6) as a (a)}
					<button class="chip ox-code" title="Seen in the preview" onclick={() => addRow(a)}>{a}</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.input {
		display: grid;
		grid-template-columns: minmax(90px, 1.1fr) 122px minmax(110px, 2fr) 54px 22px;
		gap: 4px 6px;
		align-items: center;
		padding: 3px 10px;
		border-top: 1px solid var(--ox-rule);
	}
	.input.pinned {
		background: var(--ox-hatch);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ox-haze);
	}
	.input.set .name {
		color: var(--ox-frost);
	}
	select,
	.text {
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
		min-width: 0;
		padding: 0 6px;
	}
	select:focus,
	.text:focus {
		border-color: var(--ox-lox);
	}
	select option {
		background: var(--ox-float);
	}
	.editor {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.editor .text,
	.grow {
		flex: 1;
	}
	.dim {
		color: var(--ox-text-dim);
		font-size: 11.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.live {
		color: var(--ox-text-dim);
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11.5px;
	}
	.kind {
		flex: none;
		display: flex;
		height: 22px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		overflow: hidden;
	}
	.kind button {
		width: 28px;
		border: none;
		background: none;
		color: var(--ox-text-dim);
		font-size: 10.5px;
		cursor: pointer;
		padding: 0;
	}
	.kind button:hover {
		color: var(--ox-frost);
	}
	.kind button[aria-checked='true'] {
		color: var(--ox-frost);
		background: var(--ox-selection);
	}
	.bool {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ox-haze);
	}
	.pin {
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		border: none;
		background: none;
		color: var(--ox-text-dim);
		border-radius: var(--ox-radius);
		cursor: pointer;
	}
	.pin:hover:not(:disabled) {
		color: var(--ox-frost);
		background: var(--ox-hover);
	}
	.pin.on {
		color: var(--ox-lox);
	}
	.pin:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.spark {
		flex: 1;
		height: 20px;
		background: var(--ox-input);
		border-radius: var(--ox-radius);
	}
	.spark polyline {
		fill: none;
		stroke: var(--ox-lox);
		stroke-width: 1.2;
		vector-effect: non-scaling-stroke;
	}
	.more {
		grid-column: 2 / -1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-bottom: 4px;
	}
	.kv {
		display: grid;
		grid-template-columns: auto 1fr auto 1fr 22px;
		gap: 4px;
		align-items: center;
	}
	.more .kv:has(.args) {
		grid-template-columns: minmax(80px, 1fr) 1fr 22px;
	}
	.args {
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
		height: 22px;
	}
	.x:hover:not(:disabled) {
		color: var(--ox-error);
	}
	.opts {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		color: var(--ox-haze);
		padding-top: 2px;
	}
	.opts label {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.add {
		flex: 1;
		min-width: 120px;
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		color: var(--ox-lox);
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
	.chip {
		border: none;
		padding: 0 6px;
		height: 18px;
		border-radius: 2px;
		background: var(--ox-raised);
		color: var(--ox-haze);
		cursor: pointer;
	}
	.chip:hover {
		color: var(--ox-frost);
	}
</style>
