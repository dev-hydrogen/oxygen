<script lang="ts">
	import { tick } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import { changedPreferences, readPreferences } from '../../state/preferences';
	import { SECTIONS, SETTINGS, defaultOf, getPref, isModified, searchSettings, setPref, type SettingRow } from '../../lib/settings-schema';
	import { VERSION } from '../../lib/about';
	import Toggle from '../fields/Toggle.svelte';
	import Select from '../fields/Select.svelte';
	import KeyboardSettings from './KeyboardSettings.svelte';

	/** Settings: every preference, by section, with search; keys in their own section */
	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	let query = $state('');
	let search = $state<HTMLInputElement>();
	let importer = $state<HTMLInputElement>();

	const kind = $derived(workspace.host.kind);
	const rows = $derived(SETTINGS.filter((r) => !r.hosts || r.hosts.includes(kind)));
	const section = $derived(workspace.settingsSection);
	const found = $derived(searchSettings(rows, query));
	/** a search looks through every section; otherwise the chosen one */
	const shown = $derived(query.trim() ? found : rows.filter((r) => r.section === section));
	const showKeys = $derived(query.trim() ? true : section === 'keyboard');
	const changedIn = (id: string) => rows.filter((r) => r.section === id && isModified(workspace.prefs, r.key)).length + (id === 'keyboard' ? Object.keys(workspace.prefs.keys).length : 0);

	/** shown rows under their section and group headings */
	const grouped = $derived.by(() => {
		const out: { title: string; rows: SettingRow[] }[] = [];
		for (const r of shown) {
			const title = query.trim() ? `${SECTIONS.find((s) => s.id === r.section)?.label} › ${r.group}` : r.group;
			const last = out[out.length - 1];
			if (last?.title === title) last.rows.push(r);
			else out.push({ title, rows: [r] });
		}
		return out;
	});

	$effect(() => {
		if (!workspace.settingsOpen) return;
		query = '';
		void tick().then(() => search?.focus());
	});

	const close = () => {
		workspace.settingsOpen = false;
		workspace.recordingKeys = false;
	};

	const value = (r: SettingRow) => getPref(workspace.prefs, r.key);
	const set = (r: SettingRow, v: unknown) => setPref(workspace.prefs, r.key, v);
	const reset = (r: SettingRow) => set(r, structuredClone(defaultOf(r.key)));

	function exportSettings() {
		const text = `${JSON.stringify({ oxygen: VERSION, preferences: changedPreferences($state.snapshot(workspace.prefs)) }, null, '\t')}\n`;
		if (kind === 'vscode') {
			void navigator.clipboard.writeText(text).then(() => workspace.say('Copied your settings as JSON. Import them from a file in another Oxygen.'));
			return;
		}
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
		a.download = 'oxygen-settings.json';
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	async function importSettings(file: File | undefined) {
		if (!file) return;
		try {
			const json = JSON.parse(await file.text());
			const prefs = json && typeof json === 'object' && 'preferences' in json ? json.preferences : json;
			workspace.prefs = readPreferences({ ...$state.snapshot(workspace.prefs), ...prefs });
			workspace.say(`Imported settings from ${file.name}.`);
		} catch (e) {
			workspace.say(`Couldn't read ${file.name}: ${(e as Error).message}`, 'error');
		}
		if (importer) importer.value = '';
	}

	function resetAll() {
		if (!confirm('Put every setting, keys included, back to how Oxygen comes? The panel layout stays.')) return;
		workspace.resetPreferences();
		workspace.say('Settings are back to their defaults.');
	}

	const where: Record<string, string> = {
		web: 'In this browser, for this site (clearing the site’s data forgets them).',
		vscode: 'In VS Code’s storage for the extension, on this machine.',
		desktop: 'In settings.json in Oxygen’s app data folder.',
	};

	function key(e: KeyboardEvent) {
		if (e.key === 'Escape' && !workspace.recordingKeys) {
			e.preventDefault();
			if (query) query = '';
			else close();
		}
	}
</script>

<svelte:window onkeydown={(e) => workspace.settingsOpen && key(e)} />

{#if workspace.settingsOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={close}></div>
	<div class="dialog" role="dialog" aria-modal="true" aria-label="Settings">
		<nav aria-label="Settings sections">
			<h3>Settings</h3>
			<input class="search" type="search" placeholder="Search settings and keys" aria-label="Search settings" bind:this={search} bind:value={query} />
			{#each SECTIONS as s (s.id)}
				{@const n = changedIn(s.id)}
				<button class="section" class:on={!query.trim() && section === s.id} title={s.help} onclick={() => ((workspace.settingsSection = s.id), (query = ''))}>
					<span>{s.label}</span>
					{#if n}<span class="badge" title="{n} changed from the default">{n}</span>{/if}
				</button>
			{/each}
		</nav>
		<div class="content">
			<div class="top">
				<h4>{query.trim() ? `Results for “${query.trim()}”` : SECTIONS.find((s) => s.id === section)?.label}</h4>
				<button class="x" aria-label="Close settings" onclick={close}>×</button>
			</div>
			<div class="scroll">
				{#if !query.trim() && SECTIONS.find((s) => s.id === section)}<p class="lede">{SECTIONS.find((s) => s.id === section)?.help}{section === 'preview' ? '. Each effect’s own controls in the viewport change it for that effect.' : '.'}</p>{/if}
				{#each grouped as g (g.title)}
					<section>
						<h5>{g.title}</h5>
						{#each g.rows as r (r.key)}
							{@const v = value(r)}
							{@const changed = isModified(workspace.prefs, r.key)}
							<div class="row" class:changed>
								<div class="what">
									<span class="label">{r.label}</span>
									{#if r.help}<span class="help">{r.help}</span>{/if}
								</div>
								<div class="control">
									{#if r.control.type === 'toggle'}
										<Toggle checked={v as boolean} label={r.label} onchange={(x) => set(r, x)} />
									{:else if r.control.type === 'select'}
										<div class="select"><Select value={String(v)} options={r.control.options} label={r.label} onchange={(x) => set(r, typeof defaultOf(r.key) === 'number' ? Number(x) : x)} /></div>
									{:else if r.control.type === 'range'}
										<input type="range" min={r.control.min} max={r.control.max} step={r.control.step} value={v as number} aria-label={r.label} oninput={(e) => set(r, Number(e.currentTarget.value))} />
										<span class="val ox-num">{r.control.format(v as number)}</span>
									{:else if r.control.type === 'color'}
										<input type="color" value={v as string} aria-label={r.label} oninput={(e) => set(r, e.currentTarget.value)} />
										<span class="val ox-num">{v}</span>
									{/if}
									<button class="reset" class:hidden={!changed} disabled={!changed} title="Back to the default" aria-label="Reset {r.label}" onclick={() => reset(r)}>↺</button>
								</div>
							</div>
						{/each}
					</section>
				{/each}

				{#if showKeys}
					{#if query.trim()}<h5 class="keyhead">Keyboard</h5>{/if}
					<KeyboardSettings {workspace} {query} />
				{/if}

				{#if !query.trim() && section === 'data'}
					<section>
						<h5>Where they’re kept</h5>
						<p class="text">{workspace.host.settingsLocation ?? where[kind]} The panel layout is kept with them.</p>
					</section>
					<section>
						<h5>Move them</h5>
						<div class="actions">
							<button class="btn" onclick={exportSettings}>{kind === 'vscode' ? 'Copy settings as JSON' : 'Export settings…'}</button>
							<button class="btn" onclick={() => importer?.click()}>Import settings…</button>
							<input class="file" type="file" accept=".json,application/json" bind:this={importer} onchange={(e) => importSettings(e.currentTarget.files?.[0])} />
						</div>
						<p class="text dim">Exports hold only what you changed. Importing sets those and keeps the rest.</p>
					</section>
					<section>
						<h5>Start over</h5>
						<div class="actions">
							<button class="btn" onclick={() => (workspace.layoutRequest = { name: 'editor', at: Date.now() })}>Reset the panel layout</button>
							<button class="btn danger" onclick={resetAll}>Reset all settings</button>
						</div>
					</section>
				{/if}
				{#if query.trim() && !found.length && !showKeys}<p class="text">Nothing matches.</p>{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: rgba(10, 12, 20, 0.45);
	}
	.dialog {
		position: fixed;
		z-index: 901;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(940px, calc(100vw - 32px));
		height: min(680px, calc(100vh - 64px));
		display: flex;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		overflow: hidden;
	}
	nav {
		width: 210px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 10px;
		background: var(--ox-panel);
		border-right: 1px solid var(--ox-rule);
	}
	h3 {
		margin: 0 6px 10px;
		font-size: 13.5px;
		font-weight: 600;
	}
	.search {
		height: 28px;
		margin-bottom: 10px;
		padding: 0 8px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: var(--ox-input);
		outline: none;
	}
	.search:focus {
		border-color: var(--ox-lox);
	}
	.section {
		display: flex;
		align-items: center;
		height: 28px;
		padding: 0 8px;
		border: none;
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-haze);
		text-align: left;
		cursor: pointer;
	}
	.section span:first-child {
		flex: 1;
	}
	.section:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.section.on {
		background: var(--ox-selection);
		color: var(--ox-frost);
	}
	.badge {
		min-width: 16px;
		padding: 0 4px;
		border-radius: 8px;
		background: rgba(147, 189, 245, 0.2);
		color: var(--ox-lox);
		font-size: 10.5px;
		text-align: center;
		line-height: 16px;
	}
	.content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.top {
		display: flex;
		align-items: center;
		height: 44px;
		padding: 0 14px 0 20px;
		border-bottom: 1px solid var(--ox-rule);
	}
	h4 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}
	.x {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--ox-haze);
		font-size: 18px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ox-frost);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 12px 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.lede {
		margin: 0;
		color: var(--ox-haze);
	}
	h5,
	.keyhead {
		margin: 0 0 4px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ox-haze);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 40px;
		padding: 5px 8px;
		border-left: 2px solid transparent;
		border-radius: var(--ox-radius);
	}
	.row:hover {
		background: var(--ox-hover);
	}
	.row.changed {
		border-left-color: var(--ox-lox);
	}
	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.help {
		font-size: 11.5px;
		color: var(--ox-text-dim);
	}
	.control {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.select {
		width: 220px;
	}
	input[type='range'] {
		width: 170px;
		accent-color: var(--ox-lox);
	}
	input[type='color'] {
		width: 34px;
		height: 22px;
		padding: 0;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
	}
	.val {
		min-width: 92px;
		color: var(--ox-haze);
		font-size: 11.5px;
	}
	.reset {
		width: 22px;
		height: 22px;
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		border-radius: var(--ox-radius);
	}
	.reset:hover:not(:disabled) {
		color: var(--ox-frost);
		background: var(--ox-hover);
	}
	.reset.hidden {
		visibility: hidden;
	}
	.text {
		margin: 0;
		color: var(--ox-frost);
	}
	.dim {
		margin-top: 6px;
		color: var(--ox-text-dim);
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.btn {
		height: 28px;
		padding: 0 12px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-frost);
		cursor: pointer;
	}
	.btn:hover {
		background: var(--ox-hover);
	}
	.btn.danger {
		color: var(--ox-error);
		border-color: rgba(255, 116, 112, 0.4);
	}
	.file {
		display: none;
	}
</style>
