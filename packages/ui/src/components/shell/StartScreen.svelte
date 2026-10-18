<script lang="ts">
	import type { FileRef } from '../../host';
	import type { Workspace } from '../../state/workspace.svelte';

	/** Shown when no effect is open: start something, reopen something, or learn from an example */
	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const km = $derived(workspace.keymap);
	let recent = $state<FileRef[]>([]);
	let examples = $state<{ name: string; load: () => Promise<string> }[]>([]);

	$effect(() => {
		void workspace.host.recentFiles?.().then((r) => (recent = r));
		void workspace.host.examples().then((e) => (examples = e));
	});

	function folder(f: FileRef): string {
		if (f.where) return f.where;
		const id = f.id ?? '';
		const cut = Math.max(id.lastIndexOf('/'), id.lastIndexOf('\\'));
		return cut > 0 ? id.slice(0, cut) : '';
	}

	async function openExample(e: { name: string; load: () => Promise<string> }) {
		workspace.open({ file: { name: `${e.name}.particle.json`, id: `example:${e.name}` }, text: await e.load() });
	}
</script>

<div class="start">
	<div class="inner">
		<header>
			<h1>Oxygen</h1>
			<p>A particle IDE for Minecraft Bedrock that shows what the game actually renders.</p>
		</header>

		<div class="actions">
			<button class="primary" onclick={() => workspace.newEffect()}>New effect {#if km.label('file.new')}<kbd>{km.label('file.new')}</kbd>{/if}</button>
			{#if workspace.host.openFiles}<button onclick={() => workspace.openFiles()}>Open files… {#if km.label('file.open')}<kbd>{km.label('file.open')}</kbd>{/if}</button>{/if}
			{#if workspace.host.openPack}
				<button onclick={() => workspace.openPack()}>Open resource pack…</button>
			{/if}
		</div>

		<div class="cols">
			{#if workspace.host.recentFiles}
				<section>
					<h2>Recent</h2>
					{#each recent as f (f.id)}
						<button class="item" title={f.where ? f.name : (f.id ?? '')} onclick={() => workspace.openKnown(f)}>
							<span class="name">{f.name}</span>
							<span class="where">{folder(f)}</span>
						</button>
					{:else}
						<p class="dim">Files you open show up here.</p>
					{/each}
				</section>
			{/if}
			<section>
				<h2>Examples</h2>
				<div class="examples">
					{#each examples as e (e.name)}
						<button class="item ex" onclick={() => openExample(e)}>{e.name.replace(/_/g, ' ')}</button>
					{/each}
				</div>
			</section>
		</div>

		<p class="tip dim">{km.label('app.commands') ?? 'The Commands button'} opens the command palette: every action, panel and layout is there.</p>
	</div>
</div>

<style>
	.start {
		position: absolute;
		inset: 0;
		z-index: 40;
		display: grid;
		place-items: center;
		background: var(--ox-bg);
		overflow: auto;
	}
	.inner {
		width: min(720px, calc(100% - 48px));
		padding: 32px 0;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	h1 {
		margin: 0;
		font-size: 26px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	header p {
		margin: 4px 0 0;
		color: var(--ox-haze);
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.actions button {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.actions button:hover {
		background: var(--ox-hover);
	}
	.actions .primary {
		background: var(--ox-lox);
		border-color: var(--ox-lox);
		color: var(--ox-night);
		font-weight: 600;
	}
	.actions .primary:hover {
		background: #a8caf7;
	}
	kbd {
		font: inherit;
		font-size: 11px;
		opacity: 0.65;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 24px;
	}
	h2 {
		margin: 0 0 6px;
		font-size: var(--ox-title-size);
		font-weight: 600;
		color: var(--ox-haze);
	}
	.item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		padding: 5px 8px;
		border: none;
		border-radius: var(--ox-radius);
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.item:hover {
		background: var(--ox-hover);
	}
	.name {
		color: var(--ox-lox);
	}
	.where {
		font-size: 11.5px;
		color: var(--ox-text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	.examples {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 2px;
	}
	.ex {
		color: var(--ox-lox);
		text-transform: capitalize;
	}
	.dim {
		color: var(--ox-text-dim);
	}
	.tip {
		margin: 0;
		font-size: 11.5px;
	}
</style>
