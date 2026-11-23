<script lang="ts">
	import type { FileRef } from '../../host';
	import type { Workspace } from '../../state/workspace.svelte';
	import FilesPanel from '../panels/FilesPanel.svelte';
	// the README's banner (docs/media/logo-on-dark.png, from tools/logo.mjs) at 2/5 of its size
	import banner from '../../assets/logo-banner-dark.png?inline';

	/** Shown when no effect is open: start something, reopen something, browse the opened pack, or learn from an example */
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

	// a pack opened from here has nowhere else to show while this screen covers the panels: its files go here
	let hasPack = $state(false);
	$effect(() => {
		void workspace.packVersion;
		void (workspace.host.listPack?.() ?? Promise.resolve(null)).then((p) => (hasPack = !!p)).catch(() => (hasPack = false));
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
	<div class="inner" class:wide={hasPack}>
		<header>
			<h1><img class="logo" src={banner} alt="Oxygen: particle IDE for Minecraft Bedrock" /></h1>
		</header>

		<div class="actions">
			<button class="primary" onclick={() => workspace.newEffect()}>New effect {#if km.label('file.new')}<kbd>{km.label('file.new')}</kbd>{/if}</button>
			{#if workspace.host.openFiles}<button onclick={() => workspace.openFiles()}>Open files… {#if km.label('file.open')}<kbd>{km.label('file.open')}</kbd>{/if}</button>{/if}
			{#if workspace.host.openPack}
				<button onclick={() => workspace.openPack()}>Open resource pack…</button>
			{/if}
		</div>

		<div class="cols">
			{#if hasPack}
				<section class="pack">
					<h2>Resource pack</h2>
					<div class="files"><FilesPanel {workspace} /></div>
				</section>
			{/if}
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
	.inner.wide {
		width: min(1040px, calc(100% - 48px));
	}
	h1 {
		margin: -24px 0 -28px -28px;
	}
	.logo {
		display: block;
		width: 416px;
		max-width: 100%;
		height: auto;
		user-select: none;
		-webkit-user-drag: none;
	}
	.pack {
		min-width: 0;
	}
	.files {
		height: min(520px, 60vh);
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius-float);
		background: var(--ox-panel);
		overflow: hidden;
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
</style>
