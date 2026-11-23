<script module lang="ts">
	/**
	 * Document ids of the pack's files that were opened, by path: one list for every file browser (the panel, and
	 * the one on the start screen), so an effect opened in one is marked open in the other.
	 */
	const opened = new Map<string, string | null>();
</script>

<script lang="ts">
	import type { PackListing } from '../../host';
	import type { Workspace } from '../../state/workspace.svelte';
	import { joinPath } from '../../lib/molang-text';
	import { menu, type MenuItem } from '../../lib/context-menu.svelte';
	import { GRADING_PATH, LIGHTING_PATH } from '../../lib/pack-files';
	import { textureKey } from '../../state/workspace.svelte';

	/**
	 * The files of the resource pack that was opened (File › Open resource pack folder): its particle effects (a
	 * click opens one), its textures (a click shows one, and can make it the effect's) and the files Vibrant
	 * Visuals reads. An effect opened by itself brings no pack: the list stays empty until one is opened. The web
	 * and desktop apps have it; VS Code has its own Explorer.
	 */
	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);

	let pack = $state.raw<PackListing | null>(null);
	let loading = $state(false);
	let filter = $state('');
	let open = $state<Record<string, boolean>>({ particles: true });
	/** the file shown below the tree */
	let picked = $state<string | null>(null);
	let preview = $state.raw<{ path: string; image?: string | null; text?: string | null; size?: string } | null>(null);

	// the list follows the opened pack, whatever effect is in front
	let asked = 0;
	async function refresh() {
		const mine = ++asked;
		loading = true;
		const next = (await workspace.host.listPack?.().catch(() => null)) ?? null;
		if (mine !== asked) return;
		if (next?.root !== pack?.root || next?.name !== pack?.name) {
			picked = null;
			preview = null;
			opened.clear();
		}
		pack = next;
		loading = false;
	}
	$effect(() => {
		void workspace.packVersion;
		void refresh();
	});

	/** a path on disk inside the pack, as the system writes it (the desktop app) */
	const onDisk = (path: string) => (pack?.root ? `${pack.root}${pack.root.includes('\\') ? '\\' : '/'}${pack.root.includes('\\') ? path.replace(/\//g, '\\') : path}` : null);
	/** no file of its own: hosts that read textures and text by a file's pack then use the opened one */
	const packFile = $derived({ name: pack?.name ?? '', id: null });
	/** whether the effect in front is one of this pack's (always, where the host has one pack for everything) */
	const inPack = $derived(!pack?.root || !session?.file.id || session.file.id.replace(/\\/g, '/').startsWith(`${pack.root.replace(/\\/g, '/')}/`));

	type Kind = 'effect' | 'image' | 'vv' | 'other';
	const kindOf = (path: string): Kind =>
		/\.(png|tga)$/i.test(path) ? 'image' : path.endsWith('.texture_set.json') || path.startsWith('lighting/') || path.startsWith('color_grading/') ? 'vv' : path.startsWith('particles/') && path.endsWith('.json') ? 'effect' : 'other';

	interface Folder {
		name: string;
		path: string;
		folders: Folder[];
		files: { name: string; path: string; kind: Kind }[];
	}
	const tree = $derived.by(() => {
		const root: Folder = { name: '', path: '', folders: [], files: [] };
		const byPath = new Map<string, Folder>([['', root]]);
		const folder = (path: string): Folder => {
			const hit = byPath.get(path);
			if (hit) return hit;
			const cut = path.lastIndexOf('/');
			const made: Folder = { name: path.slice(cut + 1), path, folders: [], files: [] };
			byPath.set(path, made);
			folder(cut < 0 ? '' : path.slice(0, cut)).folders.push(made);
			return made;
		};
		for (const path of pack?.files ?? []) {
			const cut = path.lastIndexOf('/');
			folder(cut < 0 ? '' : path.slice(0, cut)).files.push({ name: path.slice(cut + 1), path, kind: kindOf(path) });
		}
		const sort = (f: Folder) => {
			f.folders.sort((a, b) => a.name.localeCompare(b.name));
			f.files.sort((a, b) => a.name.localeCompare(b.name));
			f.folders.forEach(sort);
		};
		sort(root);
		return root;
	});
	/** with something typed: the matching files, flat */
	const found = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return null;
		return (pack?.files ?? [])
			.filter((p) => p.toLowerCase().includes(q) || pack?.identifiers?.[p]?.toLowerCase().includes(q))
			.sort()
			.slice(0, 300)
			.map((path) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: kindOf(path) }));
	});

	/** the open effect a pack file is, if it's open */
	function sessionOf(path: string) {
		const id = opened.get(path);
		const full = pack?.root ? `${pack.root.replace(/\\/g, '/')}/${path}` : null;
		return workspace.sessions.find((x) => (id && x.file.id === id) || (full && x.file.id?.replace(/\\/g, '/') === full));
	}

	/** `preview`: for a look, in the tab the next look takes (a single click); otherwise it stays open */
	async function openEffect(path: string, preview = false) {
		const there = sessionOf(path);
		if (there) {
			workspace.activeId = there.id;
			if (!preview) there.preview = false;
			return;
		}
		const file = await workspace.host.openPackFile?.(path).catch(() => null);
		if (!file) return workspace.say(`Couldn't open ${path}.`, 'error');
		opened.set(path, file.file.id);
		workspace.open(file, { preview });
	}

	async function show(path: string) {
		picked = path;
		preview = { path };
		const file = packFile;
		if (kindOf(path) === 'image') {
			const image = await workspace.resolveTexture(path, file).catch(() => null);
			if (picked === path) preview = { path, image };
		} else {
			// readPackText looks for a texture of that name first, so the name goes as it is
			const text = (await workspace.host.readPackText?.(path, file).catch(() => null)) ?? null;
			if (picked === path) preview = { path, text };
		}
	}

	const click = (f: { path: string; kind: Kind }) => (f.kind === 'effect' ? void openEffect(f.path, true) : void show(f.path));

	/** the texture path an effect writes for an image: no extension */
	const texturePath = (path: string) => textureKey(path);
	const currentTexture = $derived.by(() => {
		void session?.version;
		return session?.def?.texture ?? '';
	});
	function useTexture(path: string) {
		if (!session) return;
		session.doc.set(joinPath('particle_effect/description', 'basic_render_parameters', 'texture'), texturePath(path), 'Change texture');
		workspace.say(`${session.file.name} now draws ${texturePath(path)}.`);
	}

	/** the file of the Vibrant Visuals panel a pack file is, for the effect shown */
	function vvSection(path: string): 'set' | 'grading' | 'lighting' | null {
		if (!session || !inPack) return null;
		if (path === LIGHTING_PATH) return 'lighting';
		if (path === GRADING_PATH) return 'grading';
		return currentTexture && path === `${currentTexture}.texture_set.json` ? 'set' : null;
	}
	function editVisuals(path: string) {
		const id = vvSection(path);
		if (!id) return;
		workspace.vvSection = { id, at: Date.now() };
		workspace.show('vibrant');
	}

	function fileMenu(f: { path: string; kind: Kind }): MenuItem[] {
		const disk = onDisk(f.path);
		const items: MenuItem[] = [];
		if (f.kind === 'effect') items.push({ label: 'Open', run: () => void openEffect(f.path) });
		if (f.kind === 'image') {
			items.push({ label: 'Show', run: () => void show(f.path) });
			items.push({ label: 'Use as this effect’s texture', disabled: !session || !inPack || currentTexture === texturePath(f.path), title: session && !inPack ? 'The effect in front isn’t in this pack' : undefined, run: () => useTexture(f.path) });
		}
		if (f.kind === 'vv' || f.kind === 'other') items.push({ label: 'Show', run: () => void show(f.path) });
		if (vvSection(f.path)) items.push({ label: 'Edit in Vibrant Visuals', run: () => editVisuals(f.path) });
		items.push({ separator: true });
		if (pack?.identifiers?.[f.path]) items.push({ label: 'Copy the identifier', title: pack.identifiers[f.path], run: () => void navigator.clipboard.writeText(pack!.identifiers![f.path]) });
		items.push({ label: f.kind === 'image' ? 'Copy the texture path' : 'Copy the path', title: f.kind === 'image' ? texturePath(f.path) : f.path, run: () => void navigator.clipboard.writeText(f.kind === 'image' ? texturePath(f.path) : f.path) });
		if (disk && workspace.host.revealFile) items.push({ label: 'Show in its folder', run: () => workspace.host.revealFile!(disk) });
		return items;
	}
</script>

{#snippet row(f: { name: string; path: string; kind: Kind }, depth: number, label = f.name)}
	{@const s = f.kind === 'effect' ? sessionOf(f.path) : undefined}
	{@const identifier = pack?.identifiers?.[f.path]}
	<button
		class="file {f.kind}"
		class:active={s ? s.id === workspace.activeId : picked === f.path}
		class:open={!!s}
		class:peek={!!s?.preview}
		class:used={f.kind === 'image' && inPack && currentTexture === texturePath(f.path)}
		style:--depth={depth}
		title={identifier ? `${identifier}\n${f.path}` : f.path}
		use:menu={() => fileMenu(f)}
		onclick={() => click(f)}
		ondblclick={() => f.kind === 'effect' && void openEffect(f.path)}
	>
		<i aria-hidden="true"></i>
		<!-- an effect's file says what it is by its mark: the room goes to its name and what the effect is called -->
		{#if f.kind === 'effect'}
			{@const base = f.name.replace(/(\.particle)?\.json$/, '')}
			{#if identifier && label === f.name && identifier.slice(identifier.indexOf(':') + 1) === base}
				<!-- named after its effect, as most are: the identifier once, its namespace set back -->
				<span class="name"><span class="ns">{identifier.slice(0, identifier.indexOf(':') + 1)}</span>{base}</span>
			{:else}
				<span class="name">{label.replace(/(\.particle)?\.json$/, '')}</span>
				{#if identifier}<span class="id ox-code">{identifier}</span>{/if}
			{/if}
		{:else}
			<span class="name">{label}</span>
		{/if}
		{#if s?.dirty}<span class="dot" aria-label="unsaved changes"></span>{/if}
	</button>
{/snippet}

{#snippet branch(folder: Folder, depth: number)}
	{#each folder.folders as d (d.path)}
		<button class="folder" style:--depth={depth} aria-expanded={!!open[d.path]} onclick={() => (open[d.path] = !open[d.path])}>
			<svg viewBox="0 0 8 8" class:closed={!open[d.path]} aria-hidden="true"><path d="M1.5 2.5l2.5 3 2.5-3" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
			<span class="name">{d.name}</span>
		</button>
		{#if open[d.path]}{@render branch(d, depth + 1)}{/if}
	{/each}
	{#each folder.files as f (f.path)}{@render row(f, depth)}{/each}
{/snippet}

<div class="files">
	{#if pack}
		<div class="head">
			<span class="pack" title={pack.root ?? pack.name}>{pack.name}</span>
			<button class="tool" aria-label="Refresh" title="Read the pack’s files again" onclick={() => void refresh()}>
				<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 6a3.5 3.5 0 1 1-1.1-2.55" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M9.8 1.5v2.8H7" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
			</button>
			{#if workspace.host.openPack}<button class="tool text" title="Open another resource pack folder" onclick={() => workspace.openPack()}>Open…</button>{/if}
			{#if workspace.host.closePack}<button class="tool" aria-label="Close the pack" title="Close the pack" onclick={() => workspace.closePack()}>×</button>{/if}
		</div>
		<input class="filter" type="search" placeholder="Filter files" aria-label="Filter files" bind:value={filter} />
		<div class="tree" role="tree" aria-label="Files of {pack.name}">
			{#if found}
				{#each found as f (f.path)}{@render row(f, 0, f.path)}{:else}<p class="none">Nothing matches.</p>{/each}
			{:else}
				{@render branch(tree, 0)}
				{#if !pack.files.length}<p class="none">No particles or textures in this folder.</p>{/if}
			{/if}
		</div>
		{#if preview}
			{@const kind = kindOf(preview.path)}
			<div class="preview">
				<div class="phead">
					<span class="ox-code pname" title={preview.path}>{kind === 'image' ? texturePath(preview.path) : preview.path}</span>
					<button class="tool" aria-label="Close the preview" onclick={() => ((preview = null), (picked = null))}>×</button>
				</div>
				{#if kind === 'image'}
					{#if preview.image}
						<img src={preview.image} alt={preview.path} onload={(e) => {
							const img = e.currentTarget as HTMLImageElement;
							if (preview) preview = { ...preview, size: `${img.naturalWidth} × ${img.naturalHeight}` };
						}} />
					{:else if preview.image === null}
						<p class="none">Can’t show this image.</p>
					{/if}
					<div class="pfoot">
						<span class="dim ox-num">{preview.size ?? ''}</span>
						{#if inPack && currentTexture === texturePath(preview.path)}
							<span class="dim">this effect’s texture</span>
						{:else if session && !inPack}
							<span class="dim">the effect in front isn’t in this pack</span>
						{:else}
							<button class="btn" disabled={!session} onclick={() => useTexture(preview!.path)}>Use as texture</button>
						{/if}
					</div>
				{:else}
					{#if preview.text}<pre class="ox-code">{preview.text.slice(0, 6000)}</pre>{:else if preview.text === null}<p class="none">Can’t read this file.</p>{/if}
					{#if vvSection(preview.path)}<div class="pfoot"><span></span><button class="btn" onclick={() => editVisuals(preview!.path)}>Edit in Vibrant Visuals</button></div>{/if}
				{/if}
			</div>
		{/if}
	{:else}
		<div class="empty">
			<p>{loading ? 'Reading the pack…' : 'No resource pack open.'}</p>
			{#if workspace.host.openPack && !loading}<button class="btn" onclick={() => workspace.openPack()}>Open resource pack folder…</button>{/if}
		</div>
	{/if}
</div>

<style>
	.files {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 30px;
		flex: none;
		padding: 0 6px 0 10px;
	}
	.pack {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tool {
		flex: none;
		display: grid;
		place-items: center;
		min-width: 22px;
		height: 22px;
		padding: 0 4px;
		border: none;
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
	}
	.tool:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.tool svg {
		width: 12px;
		height: 12px;
	}
	.filter {
		flex: none;
		height: 22px;
		margin: 0 8px 6px;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
	}
	.filter:focus {
		border-color: var(--ox-lox);
	}
	.tree {
		flex: 1;
		min-height: 60px;
		overflow: auto;
		padding-bottom: 12px;
	}
	.folder,
	.file {
		display: flex;
		align-items: center;
		gap: 5px;
		width: 100%;
		height: 22px;
		padding: 0 8px 0 calc(8px + var(--depth) * 12px);
		border: none;
		background: none;
		color: var(--ox-haze);
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
	}
	.folder:hover,
	.file:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.folder svg {
		width: 9px;
		height: 9px;
		flex: none;
		transition: transform 0.12s;
	}
	.folder svg.closed {
		transform: rotate(-90deg);
	}
	.name {
		flex: 0 1 auto;
		min-width: 36px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ns {
		color: var(--ox-text-dim);
	}
	/* what the effect is called in commands, events and scripts */
	.id {
		flex: 0 10 auto;
		min-width: 0;
		margin-left: auto;
		padding-left: 8px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file.active .id,
	.file:hover .id {
		color: var(--ox-haze);
	}
	/* what kind of file it is: an effect, an image, a file Vibrant Visuals reads */
	.file i {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 2px;
		background: var(--ox-rule-strong);
	}
	.file.effect i {
		border-radius: 50%;
		background: var(--ox-lox);
	}
	.file.image i {
		background: var(--ox-syn-math);
	}
	.file.vv i {
		background: var(--ox-phase-render);
		transform: rotate(45deg) scale(0.85);
	}
	.file.open {
		color: var(--ox-frost);
	}
	.file.peek .name {
		font-style: italic;
	}
	.file.active {
		background: var(--ox-selection);
		color: var(--ox-frost);
	}
	.file.used .name {
		text-decoration: underline;
		text-decoration-color: var(--ox-syn-math);
		text-underline-offset: 3px;
	}
	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		margin-left: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.none {
		margin: 0;
		padding: 6px 10px;
		color: var(--ox-text-dim);
	}
	.preview {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 62%;
		padding: 6px 8px 8px;
		border-top: 1px solid var(--ox-rule);
		overflow: auto;
	}
	.phead {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.pname {
		flex: 1;
		min-width: 0;
		color: var(--ox-haze);
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* fills the panel's width: a 16-pixel texture is drawn many times its size, pixel for pixel */
	.preview img {
		flex: none;
		width: 100%;
		height: min(280px, 34vh);
		object-fit: contain;
		image-rendering: pixelated;
		background: repeating-conic-gradient(var(--ox-input) 0 25%, var(--ox-raised) 0 50%) 0 0 / 12px 12px;
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius);
	}
	.pfoot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	pre {
		margin: 0;
		padding: 6px 8px;
		background: var(--ox-input);
		border-radius: var(--ox-radius);
		color: var(--ox-code-fg);
		font-size: 11.5px;
		line-height: 16px;
		tab-size: 2;
		overflow: auto;
		user-select: text;
	}
	.dim {
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.btn {
		flex: none;
		height: 22px;
		padding: 0 8px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-frost);
		cursor: pointer;
		white-space: nowrap;
	}
	.btn:hover:not(:disabled) {
		background: var(--ox-hover);
	}
	.btn:disabled {
		opacity: 0.4;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding: 12px 10px;
		color: var(--ox-text-dim);
	}
	.empty p {
		margin: 0;
	}
</style>
