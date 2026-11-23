<script lang="ts">
	import type { Workspace } from '../../state/workspace.svelte';
	import { molangContextFor, orderOf } from '../../lib/field-context';
	import { joinPath, PHASE_NAME, PHASE_VAR } from '../../lib/molang-text';
	import MolangInput from '../fields/MolangInput.svelte';
	import { tip } from '../../lib/tip';
	import ProgramView from './ProgramView.svelte';
	import { extractToVariable, moveStatements, prettyMolang } from '@oxygen/lang';
	import { componentInsertionIndex } from '@oxygen/format';
	import { canonicalVariable } from '@oxygen/effect';
	import { molangText } from '../../lib/molang-text';
	import { fieldTarget } from '../../lib/field-target';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);

	/**
	 * The selected Molang field: an axis or a vector's own path gives the whole vector, and fields that hold a plain
	 * number or aren't in the file yet count too (field-target.ts)
	 */
	const target = $derived.by(() => {
		const s = session;
		if (!s?.selected) return null;
		void s.version;
		return fieldTarget(s, s.selected);
	});

	const refs = $derived(target ? target.axes : []);

	/** a vector that isn't in the file yet: write its defaults, then each axis can be edited */
	function addVector() {
		const s = session;
		const t = target;
		if (!s || !t || t.info?.kind.type !== 'vec') return;
		const kind = t.info.kind;
		s.doc.set(t.base, kind.default ?? Array.from({ length: kind.size }, () => 0), `Add ${t.info.label.toLowerCase()}`);
	}
	const AXES = ['X', 'Y', 'Z', 'W'];
	/** one field (or vector) with room, or every expression of the effect in evaluation order */
	let mode = $state<'field' | 'effect'>('field');
	const showing = $derived(mode === 'field' && target ? 'field' : 'effect');

	// Shift+F12 (or F12 on a variable nothing sets): list everything that uses it
	let lastReferences = 0;
	$effect(() => {
		const r = session?.referencesRequest;
		if (!session || !r || r.at === lastReferences) return;
		lastReferences = r.at;
		session.programFilter = r.name.replace(/^variable\./, 'v.');
		mode = 'effect';
		workspace.show('expression');
	});

	// extract a selected subexpression into a variable set in the first axis (X runs before Y and Z)
	let selection = $state('');
	let extractName = $state('');
	let extractError = $state<string | null>(null);
	let nameInput = $state<HTMLInputElement>();
	const shownSelection = $derived(selection.replace(/\s+/g, ' ').trim());
	$effect(() => {
		void target?.base;
		selection = '';
		extractError = null;
	});

	// statement fields, in evaluation order: statements can move between them
	const STATEMENT_FIELDS = [
		{ component: 'minecraft:emitter_initialization', key: 'creation_expression', label: 'Emitter creation (once)' },
		{ component: 'minecraft:emitter_initialization', key: 'per_update_expression', label: 'Emitter update (every update)' },
		{ component: 'minecraft:particle_initialization', key: 'per_update_expression', label: 'Particle update (each particle)' },
		{ component: 'minecraft:particle_initialization', key: 'per_render_expression', label: 'Particle render (each particle, before drawing)' },
	].map((f) => ({ ...f, path: joinPath('particle_effect', 'components', f.component, f.key) }));
	const statementField = $derived(target?.kind === 'single' ? STATEMENT_FIELDS.find((f) => f.path === target.base) : undefined);
	let moveTarget = $state('');

	function move() {
		const s = session;
		if (!s || !statementField) return;
		const dest = STATEMENT_FIELDS.find((f) => f.path === moveTarget);
		if (!dest) return void (extractError = 'Choose where the statements go.');
		const r = moveStatements(molangText(s.doc.get(statementField.path)), selection, molangText(s.doc.get(dest.path)));
		if ('error' in r) return void (extractError = r.error);
		s.doc.transact('Move statements', () => {
			const componentPath = joinPath('particle_effect', 'components', dest.component);
			if (!s.doc.has(componentPath)) s.doc.set(componentPath, {}, 'Move statements', componentInsertionIndex(dest.component));
			if (r.from) s.doc.setMolang(statementField.path, r.from, 'Move statements');
			else s.doc.remove(statementField.path, 'Move statements');
			s.doc.setMolang(dest.path, r.to, 'Move statements');
		});
		workspace.say(`Moved ${r.moved} statement${r.moved === 1 ? '' : 's'} to ${dest.label.replace(/ \(.*\)$/, '').toLowerCase()}. Check Problems: what they read may not be set yet there.`);
		selection = '';
		extractError = null;
	}

	function extract() {
		const s = session;
		if (!s || !refs.length) return;
		const c = canonicalVariable(extractName || 'shared');
		if ('error' in c) return void (extractError = c.error);
		if (s.analysis.variables.some((v) => v.name === c.name)) return void (extractError = `${c.name.replace(/^variable\./, 'v.')} is already used in this effect. Pick a new name.`);
		const name = c.name.replace(/^variable\./, 'v.');
		const texts = refs.map((r) => molangText(s.doc.get(r.path)));
		const r = extractToVariable(texts, selection, name);
		if ('error' in r) return void (extractError = r.error);
		s.doc.transact(`Extract ${name}`, () => {
			refs.forEach((ref, i) => {
				if (r.texts[i] !== texts[i]) s.doc.setMolang(ref.path, r.texts[i], `Extract ${name}`);
			});
		});
		workspace.say(`${name} is now computed ${refs.length > 1 ? 'once in X' : 'first'} and used in ${r.occurrences} place${r.occurrences === 1 ? '' : 's'}.`);
		selection = '';
		extractName = '';
		extractError = null;
	}
</script>

<div class="expr">
	{#if session}
		<div class="modes" role="tablist" aria-label="Expression view">
			<button role="tab" aria-selected={showing === 'field'} disabled={!target} title={target ? '' : 'Select a Molang field first'} onclick={() => (mode = 'field')}>Selected field</button>
			<button role="tab" aria-selected={showing === 'effect'} onclick={() => (mode = 'effect')}>Whole effect, in order</button>
		</div>
	{/if}
	{#if session && showing === 'effect'}
		<ProgramView {session} />
	{:else if session && target && target.missing && target.kind === 'vector'}
			<div class="empty">
				<p>{target.info?.label ?? 'This field'} isn't in the file yet, so the game uses {target.axes.map((a) => a.fallback ?? 0).join(', ')}.</p>
				<button class="btn" onclick={addVector}>Add it with those values</button>
			</div>
{:else if session && target && refs.length}
		{@const first = refs[0]}
		<header style:--phase={PHASE_VAR[first.phase]}>
			<span class="phase">{PHASE_NAME[first.phase]}</span>
			<span class="title">{target.kind === 'vector' ? first.label.replace(/ [XYZWRGBAUVH]$/, '') : first.label}</span>
			<span class="order ox-num">step {orderOf(session, first.path) ?? '–'}</span>
			{#if target.kind === 'vector'}<span class="hint" use:tip={'Each axis sees variables the one before it set'}>{refs.map((_, i) => AXES[i]).join(' → ')}</span>{/if}
		</header>
		<div class="editors">
			{#each refs as ref, i (ref.path)}
				<div class="axis">
					{#if target.kind === 'vector'}<span class="tag">{AXES[i]}</span>{/if}
					{#key ref.path}
						<MolangInput
							session={session}
							path={ref.path}
							label={ref.label}
							multiline
							pretty
							context={molangContextFor(session, ref.path, target.info ?? undefined, ref.fallback)}
							placeholder={ref.fallback === null ? '' : String(ref.fallback)}
							siblings={target.kind === 'vector' ? () => refs.filter((r) => r.path !== ref.path).map((r) => prettyMolang(molangText(session.doc.get(r.path)))) : undefined}
							onselection={(t) => {
								selection = t;
								extractError = null;
							}}
						/>
					{/key}
				</div>
			{/each}
		</div>
		{#if shownSelection && statementField}
			<div class="extract">
				<span class="what">Move these statements to</span>
				<select aria-label="Where the statements go" bind:value={moveTarget}>
					<option value="" disabled>choose a phase</option>
					{#each STATEMENT_FIELDS.filter((f) => f.path !== statementField.path) as f (f.path)}<option value={f.path}>{f.label}</option>{/each}
				</select>
				<button class="btn" onmousedown={(e) => e.preventDefault()} onclick={move}>Move</button>
				{#if extractError}<span class="err">{extractError}</span>{/if}
			</div>
		{:else if shownSelection}
			<div class="extract">
				<span class="what">Compute <code class="ox-code">{shownSelection.length > 48 ? `${shownSelection.slice(0, 46)}…` : shownSelection}</code> once{refs.length > 1 ? ' in X' : ''} as</span>
				<input
					bind:this={nameInput}
					class="ox-code"
					placeholder="v.shared"
					aria-label="Name of the new variable"
					bind:value={extractName}
					onkeydown={(e) => e.key === 'Enter' && extract()}
				/>
				<button class="btn" onclick={extract}>Extract</button>
				{#if extractError}<span class="err">{extractError}</span>{/if}
			</div>
		{/if}
	{:else}
		<div class="empty">Select a Molang field in the Inspector.</div>
	{/if}
</div>

<style>
	.expr {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.modes {
		display: flex;
		gap: 2px;
		padding: 4px 8px 0;
		border-bottom: 1px solid var(--ox-rule);
	}
	.modes button {
		border: none;
		background: none;
		padding: 3px 8px 5px;
		color: var(--ox-haze);
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}
	.modes button[aria-selected='true'] {
		color: var(--ox-frost);
		border-bottom-color: var(--ox-lox);
	}
	.modes button:disabled {
		color: var(--ox-text-dim);
		cursor: default;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 6px 10px;
		border-bottom: 1px solid var(--ox-rule);
		border-left: var(--ox-phase-bar) solid var(--phase);
		flex-wrap: wrap;
	}
	.phase {
		color: var(--phase);
		font-weight: 600;
	}
	.title {
		color: var(--ox-frost);
	}
	.order {
		color: var(--ox-text-dim);
	}
	.hint {
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.editors {
		flex: 1;
		overflow: auto;
		padding: 6px 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.axis {
		display: flex;
		gap: 6px;
		align-items: flex-start;
	}
	.tag {
		width: 14px;
		line-height: 26px;
		color: var(--ox-text-dim);
		text-align: center;
		flex: none;
	}
	.axis:focus-within .tag {
		color: var(--ox-lox);
	}
	.extract {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border-top: 1px solid var(--ox-rule);
		background: var(--ox-raised);
	}
	.extract .what {
		color: var(--ox-haze);
	}
	.extract code {
		color: var(--ox-code-fg);
	}
	.extract select {
		height: 22px;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
	}
	.extract select option {
		background: var(--ox-float);
	}
	.extract input {
		width: 140px;
		height: 22px;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
	}
	.extract input:focus {
		border-color: var(--ox-lox);
	}
	.extract .btn {
		height: 22px;
		padding: 0 10px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
	}
	.extract .btn:hover {
		background: var(--ox-hover);
	}
	.extract .err {
		color: var(--ox-error);
		font-size: 11.5px;
	}
	.empty {
		margin: auto;
		color: var(--ox-haze);
		padding: 20px;
		text-align: center;
	}
</style>
