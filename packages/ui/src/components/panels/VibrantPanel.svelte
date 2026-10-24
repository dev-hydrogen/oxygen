<script lang="ts">
	import { generateMers, lightAt, writeTextureSet, type TextureSet } from '@oxygen/scene';
	import type { Workspace } from '../../state/workspace.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const s = $derived(workspace.active);
	let note = $state<string | null>(null);
	let busy = $state(false);

	const light = $derived(s ? lightAt(s.vvLighting, s.timeOfDay) : null);
	const texture = $derived.by(() => {
		void s?.version;
		return s?.def?.texture ?? '';
	});
	const base = $derived(texture.split('/').pop() ?? '');
	const set = $derived(s?.textureSet ?? null);
	const lux = (rgb: [number, number, number]) => Math.round((rgb[0] + rgb[1] + rgb[2]) / 3).toLocaleString();

	/**
	 * What glows, in the texture set's terms: nothing (no metalness/emissive/roughness values), the whole texture
	 * (one uniform value) or the bright parts (a per-texel map made from the texture)
	 */
	type Glow = 'none' | 'whole' | 'bright';
	const glow = $derived<Glow>(!set || set.mers === null ? 'none' : Array.isArray(set.mers) ? 'whole' : 'bright');
	/** uniform values: metalness, emissive, roughness, subsurface (0–255) */
	const uniform = $derived(Array.isArray(set?.mers) ? (set!.mers as number[]) : [0, 255, 204, 0]);

	// the bright-parts map: rebuilt from the texture as these change, and previewed before it's saved
	let threshold = $state(0.6);
	let strength = $state(1);
	let roughness = $state(0.8);
	let source: ImageData | null = null;
	let sourceFor = '';
	let mapPreview = $state<string | null>(null);

	function updateSet(patch: Partial<TextureSet>) {
		if (!s) return;
		s.textureSet = { color: set?.color ?? base ?? null, mers: set?.mers ?? null, normal: set?.normal ?? null, heightmap: set?.heightmap ?? null, formatVersion: set?.formatVersion ?? '1.21.30', ...patch };
		s.textureSetUnsaved = true;
		note = null;
	}

	function choose(g: Glow) {
		if (!s || g === glow) return;
		if (g === 'none') updateSet({ mers: null });
		else if (g === 'whole') updateSet({ mers: [0, 255, 204, 0] });
		else void buildMap();
	}

	async function loadSource(): Promise<ImageData> {
		if (source && sourceFor === texture) return source;
		const url = await workspace.resolveTexture(texture, s!.file);
		if (!url) throw new Error(`“${texture}” isn't in the pack, so there's nothing to make a glow map from.`);
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const i = new Image();
			i.crossOrigin = 'anonymous';
			i.onload = () => resolve(i);
			i.onerror = () => reject(new Error(`Couldn't load ${texture}`));
			i.src = url;
		});
		const c = document.createElement('canvas');
		c.width = img.width;
		c.height = img.height;
		const ctx = c.getContext('2d')!;
		ctx.drawImage(img, 0, 0);
		source = ctx.getImageData(0, 0, c.width, c.height);
		sourceFor = texture;
		return source;
	}

	/** Make the glow map from the texture's bright parts and preview it (nothing is written yet) */
	async function buildMap() {
		if (!s || !texture) return;
		busy = true;
		try {
			const data = await loadSource();
			const c = document.createElement('canvas');
			c.width = data.width;
			c.height = data.height;
			c.getContext('2d')!.putImageData(new ImageData(generateMers(data.data, { threshold, strength, roughness }), data.width, data.height), 0, 0);
			const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
			if (s.glowDraft) URL.revokeObjectURL(s.glowDraft.url);
			const name = `${base}_mers`;
			s.glowDraft = { name, url: URL.createObjectURL(blob), blob };
			mapPreview = c.toDataURL();
			updateSet({ mers: name });
		} catch (e) {
			note = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	let rebuild: ReturnType<typeof setTimeout> | undefined;
	function tweakMap() {
		clearTimeout(rebuild);
		rebuild = setTimeout(() => void buildMap(), 120);
	}

	/** Write the texture set, and the glow map if there is one, next to the texture in the pack */
	async function save() {
		if (!s || !s.textureSet) return;
		busy = true;
		try {
			let downloaded = false;
			if (glow === 'bright' && s.glowDraft) {
				const mapPath = `${texture}_mers`;
				const ok = (await workspace.host.saveTexture?.(mapPath, s.file, s.glowDraft.blob)) ?? false;
				if (!ok) {
					download(s.glowDraft.blob, `${base}_mers.png`);
					downloaded = true;
				}
			}
			const text = `${JSON.stringify(writeTextureSet(s.textureSet), null, '\t')}\n`;
			const path = `${texture}.texture_set.json`;
			const ok = (await workspace.host.writePackText?.(path, s.file, text)) ?? false;
			if (!ok) {
				download(new Blob([text], { type: 'application/json' }), `${base}.texture_set.json`);
				downloaded = true;
			}
			s.textureSetUnsaved = false;
			if (!downloaded) await workspace.loadPackVisuals(s);
			note = downloaded ? 'Downloaded. Put the files next to the texture in your pack.' : `Saved next to ${texture} in the pack.`;
		} catch (e) {
			note = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function download(blob: Blob, name: string) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
	}

	const GLOWS: { id: Glow; label: string; help: string }[] = [
		{ id: 'none', label: 'Nothing', help: 'Lit by the world like a block: dimmer at night and in caves' },
		{ id: 'whole', label: 'The whole particle', help: 'Every part shines with the same strength' },
		{ id: 'bright', label: 'Its bright parts', help: 'Light parts of the texture glow, dark parts stay lit by the world' },
	];
</script>

<div class="vv">
	{#if s && light}
		<p class="intro">
			How the effect looks with Vibrant Visuals, Minecraft's newer lighting. It's matched to the game and uses your pack's lighting
			settings. Switch the viewport to Vibrant Visuals or Split to see it.
		</p>
		{#if workspace.renderMode === 'classic'}
			<div class="actions pad"><button class="btn" onclick={() => (workspace.renderMode = 'split')}>Show Classic and Vibrant side by side</button></div>
		{/if}
		{#if s.vvFromPack.pbr === false}
			<p class="warn">
				Your pack's manifest.json doesn't turn on Vibrant Visuals (<code class="ox-code">"capabilities": ["pbr"]</code>), so players won't see these
				effects. The preview shows them anyway, and the desktop app's Deploy turns it on in the copy it puts in the game.
			</p>
		{/if}

		<section>
			<h3>What glows</h3>
			<p class="note">
				In Vibrant Visuals, particles are lit by the world like blocks. To make one glow, its texture needs a texture set: a small file next to the
				texture that says how much each part glows. Pick what should glow, watch the viewport, then save.
			</p>
			{#if !texture}
				<p class="note">This effect has no texture yet.</p>
			{:else}
				<div class="choices" role="radiogroup" aria-label="What glows">
					{#each GLOWS as g (g.id)}
						<button class="choice" role="radio" aria-checked={glow === g.id} disabled={busy} onclick={() => choose(g.id)}>
							<span class="clabel">{g.label}</span>
							<span class="chelp">{g.help}</span>
						</button>
					{/each}
				</div>

				{#if glow === 'whole'}
					<div class="row">
						<span>Glow</span>
						<input type="range" min="0" max="255" step="1" value={uniform[1]} aria-label="Glow strength" oninput={(e) => updateSet({ mers: uniform.map((x, k) => (k === 1 ? Number(e.currentTarget.value) : x)) })} />
						<span class="val ox-num">{Math.round((uniform[1] / 255) * 100)}%</span>
					</div>
					<details>
						<summary>Surface</summary>
						{#each [['Shininess', 2, true], ['Metal', 0, false], ['Light passing through', 3, false]] as [label, i, invert] (label)}
							{@const raw = uniform[i as number] ?? 0}
							{@const shown = invert ? 255 - raw : raw}
							<div class="row">
								<span>{label}</span>
								<input
									type="range"
									min="0"
									max="255"
									step="1"
									value={shown}
									aria-label={String(label)}
									oninput={(e) => {
										const v = Number(e.currentTarget.value);
										updateSet({ mers: uniform.map((x, k) => (k === i ? (invert ? 255 - v : v) : x)) });
									}}
								/>
								<span class="val ox-num">{Math.round((shown / 255) * 100)}%</span>
							</div>
						{/each}
					</details>
				{:else if glow === 'bright'}
					<div class="row">
						<span>Glows above</span>
						<input type="range" min="0" max="1" step="0.01" bind:value={threshold} oninput={tweakMap} aria-label="Brightness that starts to glow" />
						<span class="val ox-num">{Math.round(threshold * 100)}%</span>
					</div>
					<div class="row">
						<span>Glow</span>
						<input type="range" min="0" max="2" step="0.05" bind:value={strength} oninput={tweakMap} aria-label="Glow strength" />
						<span class="val ox-num">{Math.round(strength * 100)}%</span>
					</div>
					<details>
						<summary>Surface</summary>
						<div class="row">
							<span>Shininess</span>
							<input type="range" min="0" max="1" step="0.01" value={1 - roughness} oninput={(e) => ((roughness = 1 - Number(e.currentTarget.value)), tweakMap())} aria-label="Shininess" />
							<span class="val ox-num">{Math.round((1 - roughness) * 100)}%</span>
						</div>
					</details>
					{#if mapPreview}
						<div class="map">
							<img src={mapPreview} alt="Glow map: green is how much each part glows" />
							<span class="note">The glow map: the greener a part, the more it glows.</span>
						</div>
					{:else if typeof set?.mers === 'string' && !s.glowDraft}
						<p class="note">Uses {set.mers}.png from the pack. Move a slider to make a new one from the texture.</p>
					{/if}
				{/if}

				<div class="actions">
					<button class="primary" disabled={busy || !s.textureSetUnsaved} onclick={save}>Save to pack</button>
					<span class="state" role="status">
						{#if busy}Working…{:else if note}{note}{:else if s.textureSetUnsaved}Not saved yet{:else if s.vvFromPack.textureSet}Saved in the pack{/if}
					</span>
				</div>
				<p class="note files">
					Saves <code class="ox-code">{base}.texture_set.json</code>{#if glow === 'bright'} and <code class="ox-code">{base}_mers.png</code>{/if} next to the texture.
				</p>
			{/if}
		</section>

		<section>
			<h3>Light</h3>
			<div class="row">
				<span>Time of day</span>
				<input type="range" min="0" max="1" step="0.01" value={s.timeOfDay} aria-label="Time of day" oninput={(e) => (s.timeOfDay = Number(e.currentTarget.value))} />
			</div>
			<details>
				<summary>Details</summary>
				<div class="grid ox-num">
					<span>Lighting</span><span>{s.vvFromPack.lighting ? "your pack's lighting/global.json" : "the game's default lighting"}</span>
					<span>Tone mapper</span><span>{s.vvGrading.toneMapper}{s.vvFromPack.grading ? '' : ' (default)'}</span>
					<span>Sun or moon</span><span>{lux(light.directional)} lux</span>
					<span>Sky</span><span>{lux(light.ambient)} lux</span>
				</div>
				<p class="note">Lit and unlit particles look the same in Vibrant Visuals: both take the world's light. Additive particles come out a bit brighter.</p>
			</details>
		</section>
	{/if}
</div>

<style>
	.vv {
		height: 100%;
		overflow: auto;
		padding-bottom: 20px;
	}
	.intro {
		margin: 8px 10px;
		color: var(--ox-haze);
		max-width: 64ch;
	}
	section {
		padding: 6px 10px 10px;
		border-top: 1px solid var(--ox-rule);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h3 {
		margin: 4px 0;
		font-size: var(--ox-title-size);
		font-weight: 600;
	}
	.grid {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 2px 10px;
		margin: 4px 0;
	}
	.grid > span:nth-child(odd),
	.row > span:first-child {
		color: var(--ox-haze);
	}
	.row {
		display: grid;
		grid-template-columns: 110px 1fr auto;
		gap: 8px;
		align-items: center;
	}
	input[type='range'] {
		accent-color: var(--ox-lox);
	}
	.val {
		width: 44px;
		text-align: right;
	}
	.choices {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 6px;
		margin: 4px 0;
	}
	.choice {
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-align: left;
		padding: 6px 8px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
		color: var(--ox-frost);
	}
	.choice:hover {
		background: var(--ox-hover);
	}
	.choice[aria-checked='true'] {
		border-color: var(--ox-lox);
		box-shadow: 0 0 0 1px var(--ox-lox);
	}
	.clabel {
		font-weight: 600;
	}
	.chelp {
		color: var(--ox-text-dim);
		font-size: 11.5px;
		line-height: 15px;
	}
	details {
		margin: 2px 0;
	}
	summary {
		color: var(--ox-haze);
		cursor: pointer;
		margin-bottom: 4px;
	}
	.map {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 4px;
	}
	.map img {
		width: 96px;
		height: 96px;
		object-fit: contain;
		image-rendering: pixelated;
		background: #000;
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius);
	}
	.warn {
		margin: 6px 10px;
		padding: 6px 8px;
		border-left: 2px solid var(--ox-warning);
		background: var(--ox-hover);
		color: var(--ox-frost);
		font-size: 12px;
	}
	.note {
		margin: 0;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.files {
		margin-top: 2px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
	}
	.actions.pad {
		margin: 0 10px 8px;
	}
	.state {
		color: var(--ox-haze);
		font-size: 12px;
	}
	.btn,
	.primary {
		height: 24px;
		padding: 0 10px;
		border-radius: var(--ox-radius);
		cursor: pointer;
	}
	.btn {
		border: 1px solid var(--ox-rule-strong);
		background: none;
		color: var(--ox-frost);
	}
	.primary {
		background: var(--ox-lox);
		color: #10131c;
		border: none;
		font-weight: 600;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
