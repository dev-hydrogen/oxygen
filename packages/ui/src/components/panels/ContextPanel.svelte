<script lang="ts">
	import { writeMeta, type InputValue, type Scenario } from '@oxygen/format';
	import { getQuery } from '@oxygen/metadata';
	import { onDestroy, onMount } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import { PHASE_VAR } from '../../lib/molang-text';
	import { queryInputType } from '../../lib/inputs';
	import { splitMember } from '../../lib/queries';
	import { showNumber } from '../../lib/numbers';
	import { STRUCT_QUERIES } from 'molangjs';
	import InputEditor from '../context/InputEditor.svelte';
	import ScrubNumber from '../fields/ScrubNumber.svelte';
	import MolangText from '../fields/MolangText.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);

	const scenarios = $derived.by(() => {
		void session?.version;
		return session?.meta.scenarios ?? [];
	});
	const active = $derived(session?.scenario ?? null);
	const variables = $derived.by(() => {
		void session?.version;
		return (session?.analysis.variables ?? []).filter((v) => !v.builtin);
	});
	const short = (n: string) => n.replace(/^variable\./, 'v.').replace(/^temp\./, 't.').replace(/^context\./, 'c.');
	const canon = (n: string) => n.toLowerCase().replace(/^v\./, 'variable.').replace(/^t\./, 'temp.').replace(/^c\./, 'context.');
	const isTemp = (n: string) => /^(t|temp)\./i.test(n);
	const isContext = (n: string) => /^(c|context)\./i.test(n);
	/** variables, then temps, then context values */
	const order = (n: string) => (isContext(n) ? 2 : isTemp(n) ? 1 : 0);

	/** variables and temps the effect reads but never sets, the context values it reads, plus any the scenario supplies */
	const inputNames = $derived.by(() => {
		void session?.version;
		const names = new Set<string>();
		for (const v of variables) if (!v.writes.length && !v.curve && v.reads.length) names.add(short(v.name));
		for (const t of session?.analysis.tempInputs ?? []) names.add(short(t));
		for (const c of session?.analysis.contextInputs ?? []) names.add(short(c));
		for (const k of Object.keys(active?.variables ?? {})) names.add(short(canon(k)));
		return [...names].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
	});
	const queries = $derived.by(() => {
		void session?.version;
		return session?.analysis.queries ?? [];
	});

	// live values: what the preview used last, refreshed a few times a second
	let tick = $state(0);
	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		timer = setInterval(() => tick++, 250);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
		if (session) session.queries.recording = false;
	});
	$effect(() => {
		const s = session;
		if (!s) return;
		s.queries.recording = true;
		return () => (s.queries.recording = false);
	});
	/** what the preview used last for a call; a struct query (q.bone_origin) has a value per member, given as text */
	function liveQuery(signature: string) {
		void tick;
		return session?.queries.last.get(signature) ?? structLive(signature);
	}
	function structLive(signature: string): string | undefined {
		void tick;
		const last = session?.queries.last;
		const open = signature.indexOf('(');
		const members = STRUCT_QUERIES[signature.slice(0, open)];
		if (!last || !members) return undefined;
		const values = members.map((m) => last.get(`${signature.slice(0, open)}.${m}${signature.slice(open)}`));
		if (values.every((v) => v === undefined)) return undefined;
		return members.map((m, i) => `${m} ${typeof values[i] === 'number' ? showNumber(values[i] as number, 3) : '–'}`).join(', ');
	}
	function seenArgs(name: string): string[] {
		void tick;
		const out = new Set<string>();
		for (const sig of session?.queries.last.keys() ?? []) {
			// a struct query's calls are recorded per member: q.bone_origin.x('head')
			if (sig.startsWith(`${name}(`) || (STRUCT_QUERIES[name] && sig.startsWith(`${name}.`))) out.add(sig.slice(sig.indexOf('(') + 1, -1));
		}
		return [...out].sort();
	}
	function liveVar(name: string) {
		void tick;
		return isContext(name) ? session?.contextValue(name) : isTemp(name) ? session?.tempValue(name) : session?.variableValue(name);
	}

	function save(list: Scenario[], activeName: string | null | undefined, label: string) {
		if (!session) return;
		session.doc.transact(label, () => {
			writeMeta(session.doc, 'scenarios', list.length ? list : undefined, label);
			writeMeta(session.doc, 'activeScenario', activeName ?? undefined, label);
		});
	}

	function freeName(base: string): string {
		let n = 1;
		while (scenarios.some((s) => s.name === `${base} ${n}`)) n++;
		return `${base} ${n}`;
	}

	/** Change the active scenario; editing an input with none active starts one */
	function update(patch: (s: Scenario) => Scenario, label = 'Edit scenario') {
		if (!session) return;
		if (!active) {
			const created = patch({ name: freeName('Scenario') });
			save([...scenarios, created], created.name, label);
			return;
		}
		const next = patch(active);
		save(
			scenarios.map((s) => (s.name === active.name ? next : s)),
			next.name,
			label,
		);
	}

	function setVariable(name: string, value: InputValue | undefined) {
		update((s) => {
			const vars = { ...(s.variables ?? {}) };
			for (const k of Object.keys(vars)) if (canon(k) === canon(name)) delete vars[k];
			if (value !== undefined) vars[name] = value;
			const pinned = value === undefined ? s.pinned?.filter((p) => canon(p) !== canon(name)) : s.pinned;
			return { ...s, variables: Object.keys(vars).length ? vars : undefined, pinned: pinned?.length ? pinned : undefined };
		}, 'Edit scenario variable');
	}

	/** Give every variable that has no value yet the same one (one undo step) */
	function fillUnset(value: number | string) {
		const missing = inputNames.filter((n) => variableInput(n) === undefined);
		if (!missing.length) return;
		update((s) => ({ ...s, variables: { ...(s.variables ?? {}), ...Object.fromEntries(missing.map((n) => [n, value])) } }), 'Fill scenario variables');
	}

	/** variables holding a plain number, which the "all numbers" controls change together */
	const numeric = $derived(inputNames.filter((n) => typeof variableInput(n) === 'number'));
	let allValue = $state<number | null>(null);

	/** queries set to a plain number */
	const numericQueries = $derived(Object.keys(active?.queries ?? {}).filter((k) => typeof active?.queries?.[k] === 'number'));
	let allQueryValue = $state<number | null>(null);

	/** Change every plain-number variable (or query) at once (one undo step) */
	function changeAll(f: (v: number) => number, label: string, field: 'variables' | 'queries' = 'variables') {
		if (!(field === 'variables' ? numeric : numericQueries).length) return;
		update((s) => {
			const vals = { ...(s[field] ?? {}) };
			for (const k of Object.keys(vals)) if (typeof vals[k] === 'number') vals[k] = Math.round(f(vals[k] as number) * 1e6) / 1e6;
			return { ...s, [field]: vals };
		}, label);
	}
	const stepOf = (e: MouseEvent) => (e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1);

	function clearVariables() {
		update((s) => ({ ...s, variables: undefined, pinned: undefined }), 'Clear scenario variables');
	}

	function variableInput(name: string): InputValue | undefined {
		const vars = active?.variables;
		if (!vars) return undefined;
		for (const [k, v] of Object.entries(vars)) if (canon(k) === canon(name)) return v;
		return undefined;
	}

	function isPinned(name: string): boolean {
		return !!active?.pinned?.some((p) => canon(p) === canon(name));
	}

	function setPinned(name: string, on: boolean) {
		update(
			(s) => {
				const list = (s.pinned ?? []).filter((p) => canon(p) !== canon(name));
				if (on) list.push(name);
				return { ...s, pinned: list.length ? list : undefined };
			},
			on ? 'Pin variable' : 'Unpin variable',
		);
	}

	/** dynamic calls (`q.x(?)`) are configured by bare name, literal ones by exact signature */
	function queryKey(q: { signature: string; name: string; args: (string | number | null)[] }): string {
		return q.args.some((a) => a === null) ? q.name : q.signature;
	}

	function setQuery(key: string, value: InputValue | undefined) {
		update((s) => {
			const qs = { ...(s.queries ?? {}) };
			if (value === undefined) delete qs[key];
			else qs[key] = value;
			return { ...s, queries: Object.keys(qs).length ? qs : undefined };
		}, 'Edit scenario query');
	}

	let addingVar = $state('');
	function addVariable() {
		const t = addingVar.trim();
		if (!/^(v|variable|t|temp|c|context)\.[a-z_][a-z0-9_]*$/i.test(t)) return;
		setVariable(short(canon(t)), 0);
		addingVar = '';
	}
	let addingQuery = $state('');
	function addQuery() {
		const t = addingQuery.trim().replace(/^q\./i, 'query.');
		const name = t.replace(/\(.*$/, '').toLowerCase();
		// one member of a struct query can have its own value: q.bone_origin.y('head')
		const info = getQuery(splitMember(name)[0]);
		if (!info) return;
		setQuery(t.includes('(') ? name + t.slice(t.indexOf('(')) : name, queryInputType(info.returnType) === 'string' ? '' : 0);
		addingQuery = '';
	}
	/** queries the scenario doesn't set and the scene didn't answer last time (they read 0.0) */
	const unsuppliedQueries = $derived.by(() => {
		void tick;
		const out: string[] = [];
		for (const q of queries) {
			const key = queryKey(q);
			if (active?.queries?.[key] !== undefined) continue;
			const sigs = key === q.name ? seenArgs(q.name).map((a) => `${q.name}(${a})`) : [q.signature];
			if (sigs.every((s) => liveQuery(s) === undefined)) out.push(key);
		}
		return out;
	});

	/** Give every query nothing supplies the same value (one undo step) */
	function fillUnsupplied(value: number | string) {
		const keys = unsuppliedQueries;
		if (!keys.length) return;
		update((s) => ({ ...s, queries: { ...(s.queries ?? {}), ...Object.fromEntries(keys.map((k) => [k, value])) } }), 'Fill scenario queries');
	}

	function clearQueries() {
		update((s) => ({ ...s, queries: undefined }), 'Clear scenario queries');
	}

	/** queries set in the scenario that the effect doesn't call (or calls differently) */
	const extraQueries = $derived(Object.keys(active?.queries ?? {}).filter((k) => !queries.some((q) => queryKey(q) === k)));

	function rename(name: string) {
		const t = name.trim();
		if (!active || !t || t === active.name || scenarios.some((s) => s.name === t)) return;
		update((s) => ({ ...s, name: t }), 'Rename scenario');
	}
	function duplicate() {
		if (!active) return;
		const copy: Scenario = { ...structuredClone($state.snapshot(active)), name: freeName(`${active.name.replace(/ \d+$/, '')} copy`) };
		save([...scenarios, copy], copy.name, 'Duplicate scenario');
	}
	function remove() {
		if (!active) return;
		save(
			scenarios.filter((s) => s.name !== active.name),
			null,
			'Delete scenario',
		);
	}
	function addScenario() {
		const name = freeName('Scenario');
		save([...scenarios, { name }], name, 'Add scenario');
	}
</script>

<div class="context">
	{#if session}
		<section>
			<div class="head">
				<h3>Scenario</h3>
				<select aria-label="Active scenario" value={active?.name ?? ''} onchange={(e) => save(scenarios, e.currentTarget.value || null, 'Switch scenario')}>
					<option value="">None (as spawned in-game)</option>
					{#each scenarios as s (s.name)}<option value={s.name}>{s.name}</option>{/each}
				</select>
				<span class="spacer"></span>
				{#if active}
					<button class="btn" onclick={duplicate}>Duplicate</button>
					<button class="btn" onclick={remove}>Delete</button>
				{/if}
				<button class="btn" onclick={addScenario}>New</button>
			</div>
			{#if active}
				<label class="row pad">
					<span>Name</span>
					<input value={active.name} onchange={(e) => rename(e.currentTarget.value)} />
				</label>
			{/if}
			<p class="note pad">
				{#if active}
					A scenario stands in for what an entity or script hands the effect. It's saved in the file's oxygen block, which the game ignores.
				{:else}
					Nothing outside the effect supplies values, as when it's spawned with /particle. Setting any input below starts a scenario.
				{/if}
			</p>
		</section>

		<section>
			<div class="head">
				<h3>Variables in</h3>
				<span class="dim ox-num">{inputNames.length}</span>
				<span class="spacer"></span>
				{#if inputNames.length}
					<span class="dim">Fill unset with</span>
					<button class="btn ox-num" title="Every variable without a value gets 0" onclick={() => fillUnset(0)}>0</button>
					<button class="btn ox-num" title="Every variable without a value gets 1" onclick={() => fillUnset(1)}>1</button>
					<button class="btn ox-code" title="Every variable without a value gets an empty string" onclick={() => fillUnset('')}>''</button>
					<button class="btn" disabled={!active?.variables} title="Remove every value set here" onclick={clearVariables}>Clear</button>
				{/if}
			</div>
			{#each inputNames as name (name)}
				{@const value = variableInput(name)}
				<InputEditor
					{name}
					kind="variable"
					type={typeof value === 'string' ? 'string' : 'number'}
					{value}
					live={liveVar(name)}
					pinned={isPinned(name)}
					onpin={(on) => setPinned(name, on)}
					onchange={(v) => setVariable(name, v)}
				/>
			{:else}
				<p class="note pad">The effect sets every variable it reads.</p>
			{/each}
			{#if numeric.length > 1}
				<div class="allrow pad">
					<span class="dim">All {numeric.length} numbers</span>
					<span class="allset">
						<ScrubNumber label="Set every number to" value={allValue} allowEmpty placeholder="set to…" onchange={(n) => {
							allValue = n;
							if (n !== null) changeAll(() => n, 'Set scenario numbers');
						}} />
					</span>
					<button class="btn ox-num" title="Lower every number by 0.1 (Shift 1, Alt 0.01)" onclick={(e) => changeAll((v) => v - stepOf(e), 'Nudge scenario numbers')}>−</button>
					<button class="btn ox-num" title="Raise every number by 0.1 (Shift 1, Alt 0.01)" onclick={(e) => changeAll((v) => v + stepOf(e), 'Nudge scenario numbers')}>+</button>
					<button class="btn ox-num" title="Halve every number" onclick={() => changeAll((v) => v / 2, 'Scale scenario numbers')}>×½</button>
					<button class="btn ox-num" title="Double every number" onclick={() => changeAll((v) => v * 2, 'Scale scenario numbers')}>×2</button>
				</div>
			{/if}
			<div class="adder pad">
				<input class="ox-code" placeholder="v.name, t.name or c.name" aria-label="Add a variable" bind:value={addingVar} onkeydown={(e) => e.key === 'Enter' && addVariable()} />
				<button class="btn" onclick={addVariable}>Add variable</button>
			</div>
			<p class="note pad">Variables (v.) are handed over once, before creation_expression, like a Script API variable map. Temps (t.) go into the temp store all effects share just before the effect starts, as a parent's event leaves them before it spawns a child. Context values (c.) are there for every expression, as the caller supplies them; Molang can't set them. Pinned ones are written again before every update, which the game never does.</p>
			<div class="pre pad">
				<span>Pre-effect script</span>
				<MolangText
					label="Pre-effect script"
					multiline
					value={active?.preEffect ?? ''}
					placeholder="v.size = 2; v.color = 'red';"
					onchange={(t) => update((s) => ({ ...s, preEffect: t.trim() ? t : undefined }), 'Edit pre-effect script')}
				/>
			</div>
		</section>

		<section>
			<div class="head">
				<h3>Queries</h3>
				<span class="dim ox-num">{queries.length + extraQueries.length}</span>
				<span class="spacer"></span>
				{#if unsuppliedQueries.length}
					<span class="dim">Fill {unsuppliedQueries.length} unsupplied with</span>
					<button class="btn ox-num" title="Every query nothing supplies gets 0" onclick={() => fillUnsupplied(0)}>0</button>
					<button class="btn ox-num" title="Every query nothing supplies gets 1" onclick={() => fillUnsupplied(1)}>1</button>
					<button class="btn ox-code" title="Every query nothing supplies gets an empty string" onclick={() => fillUnsupplied('')}>''</button>
				{/if}
				{#if queries.length || extraQueries.length}
					<button class="btn" disabled={!active?.queries} title="Remove every query value set here" onclick={clearQueries}>Clear</button>
				{/if}
			</div>
			{#each queries as q (q.signature)}
				{@const key = queryKey(q)}
				{@const info = getQuery(q.name)}
				<InputEditor
					name={q.signature.replace(/^query\./, 'q.')}
					kind="query"
					type={queryInputType(info?.returnType)}
					dynamic={key === q.name}
					value={active?.queries?.[key]}
					live={key === q.name ? undefined : liveQuery(q.signature)}
					liveText={key === q.name ? undefined : structLive(q.signature)}
					seenArgs={key === q.name ? seenArgs(q.name) : []}
					description={info?.description}
					onchange={(v) => setQuery(key, v)}
				/>
				<div class="uses">
					{#each q.uses as u (u.path)}<button class="use" style:--phase={PHASE_VAR[u.phase]} onclick={() => (session.selected = u.path)}>{u.label}</button>{/each}
				</div>
			{/each}
			{#each extraQueries as key (key)}
				{@const name = key.replace(/\(.*$/, '')}
				<InputEditor
					name={key.replace(/^query\./, 'q.')}
					kind="query"
					type={queryInputType(getQuery(splitMember(name)[0])?.returnType)}
					dynamic={!key.includes('(')}
					value={active?.queries?.[key]}
					live={liveQuery(key)}
					liveText={structLive(key)}
					seenArgs={seenArgs(name)}
					description={getQuery(splitMember(name)[0])?.description}
					onchange={(v) => setQuery(key, v)}
				/>
			{/each}
			{#if numericQueries.length > 1}
				<div class="allrow pad">
					<span class="dim">All {numericQueries.length} numbers</span>
					<span class="allset">
						<ScrubNumber label="Set every query number to" value={allQueryValue} allowEmpty placeholder="set to…" onchange={(n) => {
							allQueryValue = n;
							if (n !== null) changeAll(() => n, 'Set scenario query numbers', 'queries');
						}} />
					</span>
					<button class="btn ox-num" title="Lower every number by 0.1 (Shift 1, Alt 0.01)" onclick={(e) => changeAll((v) => v - stepOf(e), 'Nudge scenario query numbers', 'queries')}>−</button>
					<button class="btn ox-num" title="Raise every number by 0.1 (Shift 1, Alt 0.01)" onclick={(e) => changeAll((v) => v + stepOf(e), 'Nudge scenario query numbers', 'queries')}>+</button>
					<button class="btn ox-num" title="Halve every number" onclick={() => changeAll((v) => v / 2, 'Scale scenario query numbers', 'queries')}>×½</button>
					<button class="btn ox-num" title="Double every number" onclick={() => changeAll((v) => v * 2, 'Scale scenario query numbers', 'queries')}>×2</button>
				</div>
			{/if}
			<div class="adder pad">
				<input class="ox-code" placeholder="q.property('ns:name')" aria-label="Add a query value" bind:value={addingQuery} onkeydown={(e) => e.key === 'Enter' && addQuery()} />
				<button class="btn" onclick={addQuery}>Add query</button>
			</div>
			<p class="note pad">Camera, time, position and stand-in entity queries follow the live scene unless set here. A call with changing arguments can take a value per argument.</p>
		</section>

		<section>
			<div class="head"><h3>Data flow</h3><span class="dim ox-num">{variables.length}</span></div>
			<table>
				<thead><tr><th>Name</th><th>Set by</th><th>Read by</th></tr></thead>
				<tbody>
					{#each variables as v (v.name)}
						<tr class:unset={!v.writes.length && !v.external && !v.curve}>
							<td class="ox-code">
								{short(v.name)}
								{#if !v.builtin}<button class="ren" title="Rename everywhere (F2 in an editor)" aria-label="Rename {short(v.name)}" onclick={() => (session.renameRequest = v.name)}>Rename</button>{/if}
							</td>
							<td>
								{#if v.curve}<span class="chip">curve</span>{/if}
								{#if v.external}<span class="chip ext">{v.external}</span>{/if}
								{#each v.writes as w (w.path)}<button class="use" style:--phase={PHASE_VAR[w.phase]} onclick={() => (session.selected = w.path)}>{w.label}</button>{/each}
								{#if !v.writes.length && !v.external && !v.curve}<span class="warn">nothing</span>{/if}
							</td>
							<td>
								{#each v.reads as r (r.path)}<button class="use" style:--phase={PHASE_VAR[r.phase]} onclick={() => (session.selected = r.path)}>{r.label}</button>{/each}
							</td>
						</tr>
					{:else}
						<tr><td colspan="3" class="dim">This effect uses no variables yet.</td></tr>
					{/each}
				</tbody>
			</table>
			{#if session.analysis.temps.length}
				<p class="note pad">Temps in use: <span class="ox-code">{session.analysis.temps.map((t) => t.replace('temp.', 't.')).join(', ')}</span>. In-game, temps are global: other effects can see and overwrite them.</p>
			{/if}
		</section>
	{:else}
		<p class="note pad">No effect open.</p>
	{/if}
</div>

<style>
	.context {
		height: 100%;
		overflow: auto;
	}
	section {
		border-bottom: 1px solid var(--ox-rule);
		padding-bottom: 8px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px 4px;
	}
	h3 {
		margin: 0;
		font-size: var(--ox-title-size);
		font-weight: 600;
	}
	select,
	input {
		height: 22px;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
		min-width: 0;
	}
	select:focus,
	input:focus {
		border-color: var(--ox-lox);
	}
	select option {
		background: var(--ox-float);
	}
	.spacer {
		flex: 1;
	}
	.allrow {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-top: 6px;
		padding-bottom: 2px;
		border-top: 1px solid var(--ox-rule);
	}
	.allset {
		width: 90px;
	}
	.btn {
		border: 1px solid var(--ox-rule-strong);
		background: none;
		border-radius: var(--ox-radius);
		height: 22px;
		padding: 0 8px;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn:hover:not(:disabled) {
		background: var(--ox-hover);
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.row {
		display: grid;
		grid-template-columns: 76px 1fr;
		gap: 6px;
		align-items: center;
		color: var(--ox-haze);
	}
	.note {
		margin: 4px 0 0;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.pad {
		padding-left: 10px;
		padding-right: 10px;
	}
	.dim {
		color: var(--ox-text-dim);
	}
	.adder {
		display: flex;
		gap: 6px;
		padding-top: 6px;
	}
	.adder input {
		flex: 1;
	}
	.pre {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 8px;
		color: var(--ox-haze);
	}
	.uses {
		display: flex;
		flex-wrap: wrap;
		gap: 0 8px;
		padding: 0 10px 3px 16px;
	}
	.uses .use {
		font-size: 11px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-weight: 500;
		color: var(--ox-text-dim);
		padding: 2px 10px;
	}
	td {
		padding: 3px 10px;
		vertical-align: top;
		border-top: 1px solid var(--ox-rule);
	}
	tr.unset td:first-child {
		color: var(--ox-error);
	}
	.use {
		display: block;
		border: none;
		background: none;
		padding: 0 0 0 6px;
		margin: 1px 0;
		color: var(--ox-haze);
		cursor: pointer;
		text-align: left;
		border-left: var(--ox-phase-bar) solid var(--phase);
	}
	.use:hover {
		color: var(--ox-frost);
	}
	.chip {
		display: inline-block;
		padding: 0 5px;
		border-radius: 2px;
		background: var(--ox-raised);
		color: var(--ox-haze);
		font-size: 11px;
		margin-right: 4px;
	}
	.chip.ext {
		background: var(--ox-hatch), var(--ox-raised);
	}
	.warn {
		color: var(--ox-error);
	}
	.ren {
		display: block;
		border: none;
		background: none;
		padding: 0;
		color: var(--ox-text-dim);
		font-family: var(--ox-font-ui);
		font-variation-settings: 'MONO' 0;
		font-size: 11px;
		cursor: pointer;
	}
	.ren:hover {
		color: var(--ox-lox);
	}
</style>
