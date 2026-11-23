<script lang="ts">
	import { DEFAULT_GRADING, DEFAULT_LIGHTING, generateMers, lightAt, parseGrading, parseLighting, writeTextureSet, type GradingModel, type Keyframes, type LightingModel, type RGB, type TextureSet, type ToneMapper } from '@oxygen/scene';
	import { parse as parseJsonc } from 'jsonc-parser';
	import { onMount } from 'svelte';
	import type { Workspace } from '../../state/workspace.svelte';
	import Hint from '../fields/Hint.svelte';
	import KeyframeList from '../fields/KeyframeList.svelte';
	import ScrubNumber from '../fields/ScrubNumber.svelte';
	import Section from '../fields/Section.svelte';
	import Select from '../fields/Select.svelte';
	import { GRADING_PATH, LIGHTING_PATH, gradingFile, lightingFile, type GradingKey, type LightingKey } from '../../lib/pack-files';
	import { tip } from '../../lib/tip';

	/**
	 * The three pack files Vibrant Visuals draws a particle with: its texture's texture set
	 * (`<texture>.texture_set.json`), and the pack-wide `color_grading/color_grading.json` and
	 * `lighting/global.json`. Each is edited with its own keys and values, previewed at once, shown as the text
	 * Save writes, and written to the pack only by its Save.
	 */
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

	/** how the file gives metalness, emissive, roughness and subsurface: not at all, as values, or as a texture */
	type Mers = 'none' | 'values' | 'texture';
	const mers = $derived<Mers>(!set || set.mers === null ? 'none' : Array.isArray(set.mers) ? 'values' : 'texture');
	const NEW_VALUES = [0, 255, 204, 0];
	/** the values for the whole texture, 0–255: three in an older texture set (no subsurface), else four */
	const values = $derived(Array.isArray(set?.mers) ? (set!.mers as number[]) : NEW_VALUES);
	/** the key the file gets: the game has one for three values and one for four (or a texture) */
	const mersKey = $derived(mers === 'values' && values.length === 3 ? 'metalness_emissive_roughness' : 'metalness_emissive_roughness_subsurface');
	/** the file's text, with a list of values on one line, as texture sets are written */
	const fileOf = (t: TextureSet) => JSON.stringify(writeTextureSet(t), null, '\t').replace(/\[\s*([-\d.,\s]+?)\s*\]/g, (_, list: string) => `[${list.split(/\s*,\s*/).join(', ')}]`);
	/** the file as Save writes it */
	const fileText = $derived(set ? fileOf(set) : null);

	const CHANNELS = [
		{ name: 'metalness', channel: 'red', help: '0 is not a metal; 255 is one, which mirrors its surroundings tinted by its colour.' },
		{ name: 'emissive', channel: 'green', help: 'How much it shines with its own colour whatever the light. In the game even low values glow strongly: 8 to 24 suits soft, translucent textures.' },
		{ name: 'roughness', channel: 'blue', help: '0 is mirror-smooth, 255 is matte.' },
		{ name: 'subsurface', channel: 'alpha', help: 'How much light passes through it.' },
	];

	// the MERS texture made from the colour texture: rebuilt as these change, and previewed before it's saved
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

	function choose(m: Mers) {
		if (!s || m === mers) return;
		if (m === 'none') updateSet({ mers: null });
		else if (m === 'values') updateSet({ mers: [...NEW_VALUES] });
		else void buildMap();
	}

	const setValue = (i: number, v: number) => updateSet({ mers: values.map((x, k) => (k === i ? Math.max(0, Math.min(255, Math.round(v))) : x)) });

	async function loadSource(): Promise<ImageData> {
		if (source && sourceFor === texture) return source;
		const url = await workspace.resolveTexture(texture, s!.file);
		if (!url) throw new Error(`“${texture}” isn't in the pack, so there's nothing to make a MERS texture from.`);
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

	/** Make the MERS texture from the colour texture's bright parts and preview it (nothing is written yet) */
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

	// a MERS texture already in the pack, shown as it is
	let packMap = $state<string | null>(null);
	$effect(() => {
		const name = typeof set?.mers === 'string' ? set.mers : null;
		const file = s?.file;
		packMap = null;
		if (!name || !file || s?.glowDraft) return;
		let stale = false;
		void workspace.resolveTexture(`${texture.slice(0, texture.length - base.length)}${name}`, file).then((url) => {
			if (!stale) packMap = url;
		});
		return () => (stale = true);
	});
	const shownMap = $derived(s?.glowDraft ? mapPreview : packMap);

	/** Write the texture set, and the MERS texture if one was made, next to the texture in the pack */
	async function save() {
		if (!s || !s.textureSet) return;
		busy = true;
		try {
			let downloaded = false;
			if (mers === 'texture' && s.glowDraft) {
				const mapPath = `${texture}_mers`;
				const ok = (await workspace.host.saveTexture?.(mapPath, s.file, s.glowDraft.blob)) ?? false;
				if (!ok) {
					download(s.glowDraft.blob, `${base}_mers.png`);
					downloaded = true;
				}
			}
			const text = `${fileOf(s.textureSet)}\n`;
			const path = `${texture}.texture_set.json`;
			const ok = (await workspace.host.writePackText?.(path, s.file, text)) ?? false;
			if (!ok) {
				download(new Blob([text], { type: 'application/json' }), `${base}.texture_set.json`);
				downloaded = true;
			}
			s.textureSetUnsaved = false;
			if (!downloaded) await workspace.loadPackVisuals(s);
			note = downloaded ? 'Downloaded. Put the files next to the texture in your pack.' : null;
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

	const MODES: { id: Mers; label: string; help: string }[] = [
		{ id: 'none', label: 'Not set', help: 'The key is left out: the particle is lit by the world like a block, dimmer at night and in caves.' },
		{ id: 'values', label: 'Values', help: 'One value each for the whole texture: `[metalness, emissive, roughness, subsurface]`.' },
		{ id: 'texture', label: 'Texture', help: 'A PNG next to the texture that holds the four values for every pixel, in its red, green, blue and alpha.' },
	];
	const DOC = 'guide#vibrant-visuals-and-glow';

	// ---------------------------------------------------------------- which files are folded open
	let open = $state({ set: true, grading: false, lighting: false });
	type SectionId = keyof typeof open;
	onMount(() => {
		void workspace.loadSettings().then((saved) => {
			const kept = saved.vvSections;
			if (kept && typeof kept === 'object') for (const k of Object.keys(open) as SectionId[]) if (typeof (kept as Record<string, unknown>)[k] === 'boolean') open[k] = (kept as Record<SectionId, boolean>)[k];
		});
	});
	function toggle(id: SectionId) {
		open[id] = !open[id];
		workspace.updateSettings({ vvSections: { ...open } });
	}
	// the file browser asks for the file it was shown
	$effect(() => {
		const asked = workspace.vvSection;
		if (asked) open[asked.id] = true;
	});

	// ---------------------------------------------------------------- color grading and lighting: the pack's, for every effect in it
	const TONE_MAPPERS: ToneMapper[] = ['generic', 'aces', 'hable', 'reinhard', 'reinhard_luma', 'reinhard_luminance'];
	let gradingNote = $state<string | null>(null);
	let lightingNote = $state<string | null>(null);
	/** the time of day as lighting/global.json counts it: from noon */
	const lightTime = $derived(s ? (((s.timeOfDay - 0.5) % 1) + 1) % 1 : 0);

	function setGrading<K extends GradingKey>(key: K, value: GradingModel[K]) {
		if (!s) return;
		s.vvGrading = { ...s.vvGrading, [key]: value };
		if (!s.gradingEdits.includes(key)) s.gradingEdits = [...s.gradingEdits, key];
		gradingNote = null;
	}
	function setLighting(key: LightingKey, value: LightingModel[LightingKey]) {
		if (!s) return;
		s.vvLighting = { ...s.vvLighting, [key]: value };
		if (!s.lightingEdits.includes(key)) s.lightingEdits = [...s.lightingEdits, key];
		lightingNote = null;
	}

	/** each file as its Save writes it: the pack's own text with the changed keys set, or a new file */
	const gradingText = $derived(s && (s.vvFiles.grading !== null || s.gradingEdits.length) ? gradingFile(s.vvGrading, s.vvFiles.grading, s.gradingEdits as GradingKey[]) : null);
	const lightingText = $derived(s && (s.vvFiles.lighting !== null || s.lightingEdits.length) ? lightingFile(s.vvLighting, s.vvFiles.lighting, s.lightingEdits as LightingKey[]) : null);

	/** Drop what was changed here: back to the pack's file, or the game's defaults without one */
	function revert(kind: 'grading' | 'lighting') {
		if (!s) return;
		const text = s.vvFiles[kind];
		const file = text === null ? null : parseJsonc(text, [], { allowTrailingComma: true });
		if (kind === 'grading') {
			s.vvGrading = file ? parseGrading(file) : DEFAULT_GRADING;
			s.gradingEdits = [];
		} else {
			s.vvLighting = file ? parseLighting(file) : DEFAULT_LIGHTING;
			s.lightingEdits = [];
		}
	}

	async function saveFile(kind: 'grading' | 'lighting') {
		const text = kind === 'grading' ? gradingText : lightingText;
		if (!s || text === null) return;
		const path = kind === 'grading' ? GRADING_PATH : LIGHTING_PATH;
		busy = true;
		let said: string | null = null;
		try {
			const ok = (await workspace.host.writePackText?.(path, s.file, text)) ?? false;
			if (!ok) {
				download(new Blob([text], { type: 'application/json' }), path.split('/').pop()!);
				said = `Downloaded. Put it at ${path} in your pack.`;
			}
			s.vvFiles = { ...s.vvFiles, [kind]: text };
			s.vvFromPack = { ...s.vvFromPack, [kind]: true };
			if (kind === 'grading') s.gradingEdits = [];
			else s.lightingEdits = [];
		} catch (e) {
			said = (e as Error).message;
		} finally {
			busy = false;
		}
		if (kind === 'grading') gradingNote = said;
		else lightingNote = said;
	}
</script>


{#snippet status(unsaved: boolean, inPack: boolean, message: string | null)}
	<span class="state" role="status">{#if busy}Working…{:else if message}{message}{:else if unsaved}Not saved{:else if inPack}In the pack{:else}Not in the pack{/if}</span>
{/snippet}

{#snippet vec3(key: 'saturation' | 'contrast' | 'gain' | 'offset', help: string)}
	<div class="row">
		<span class="key ox-code" use:tip={{ where: `color_grading › midtones › ${key}`, text: help }}>{key}</span>
		<div class="trio">
			{#each [0, 1, 2] as k (k)}<ScrubNumber label="{key} {'RGB'[k]}" value={s!.vvGrading[key][k]} step={0.05} onchange={(v) => setGrading(key, s!.vvGrading[key].map((x, j) => (j === k ? (v ?? 0) : x)) as RGB)} />{/each}
		</div>
	</div>
{/snippet}

{#snippet lightRows(title: string, where: string, illuminance: LightingKey, color: LightingKey, step: number)}
	<div class="keyline"><span class="key ox-code" use:tip={{ where, text: 'Its strength in lux, and its colour, for the whole day or by time of day.' }}>{title}</span></div>
	<div class="group">
		<div class="row top">
			<span class="key ox-code">illuminance</span>
			<KeyframeList kind="number" label="{title} illuminance" value={s!.vvLighting[illuminance] as Keyframes<number>} {step} min={0} now={lightTime} onchange={(v) => setLighting(illuminance, v)} />
		</div>
		<div class="row top">
			<span class="key ox-code">color</span>
			<KeyframeList kind="color" label="{title} color" value={s!.vvLighting[color] as Keyframes<RGB>} now={lightTime} onchange={(v) => setLighting(color, v)} />
		</div>
	</div>
{/snippet}

<div class="vv">
	{#if s && light}
		{#if workspace.renderMode === 'classic'}
			<p class="notice">The viewport is drawing Classic only. <button class="btn" onclick={() => (workspace.renderMode = 'split')}>Show Classic and Vibrant side by side</button></p>
		{/if}
		{#if s.vvFromPack.pbr === false}
			<p class="warn">
				This pack’s manifest.json lacks <code class="ox-code">"capabilities": ["pbr"]</code>, so players won’t see Vibrant Visuals.
				<Hint label="About the pbr capability" where="manifest.json › capabilities" text="The preview shows Vibrant Visuals anyway. The desktop app’s Deploy adds the capability to the copy it puts in the game." doc={DOC} />
			</p>
		{/if}

		<Section title="Texture set" open={open.set} ontoggle={() => toggle('set')}>
			{#snippet aside()}
				<Hint label="About texture sets" where={texture ? `${texture}.texture_set.json` : 'texture_set.json'} text="A file next to the texture, with the same name. It is all a particle has to say about Vibrant Visuals: what its surface is like, and whether it shines by itself." doc={DOC} />
				<span class="spacer"></span>
				{#if texture}{@render status(s.textureSetUnsaved, s.vvFromPack.textureSet, note)}{/if}
				<button class="primary" disabled={busy || !s.textureSetUnsaved} use:tip={`Writes ${base}.texture_set.json${mers === 'texture' && s.glowDraft ? ` and ${base}_mers.png` : ''} next to the texture`} onclick={save}>Save to pack</button>
			{/snippet}
			{#if !texture}
				<p class="note">This effect has no texture yet.</p>
			{:else}
				<div class="cols">
					<div class="edit">
						<div class="row">
							<span class="key ox-code" use:tip={{ where: 'minecraft:texture_set › color', text: 'The colour texture, by its file name next to this file.' }}>color</span>
							<span class="ox-code read">{typeof (set?.color ?? base) === 'string' ? (set?.color ?? base) : JSON.stringify(set?.color)}</span>
						</div>

						<div class="keyline">
							<span class="key ox-code">{mersKey}</span>
							<Hint label="About {mersKey}" where={`minecraft:texture_set › ${mersKey}`} text="Four numbers that say how the surface takes light, known as MERS: metalness, emissive, roughness and subsurface. `emissive` is the one that makes a particle glow." doc={DOC} />
						</div>
						<div class="choices" role="radiogroup" aria-label={mersKey}>
							{#each MODES as m (m.id)}
								<button class="choice" role="radio" aria-checked={mers === m.id} disabled={busy} use:tip={m.help} onclick={() => choose(m.id)}>{m.label}</button>
							{/each}
						</div>

						{#if mers === 'values'}
							<div class="group">
								{#each values as v, i (i)}
									{@const c = CHANNELS[i]}
									<div class="row slider">
										<span class="key ox-code" use:tip={c.help}>{c.name}</span>
										<input type="range" min="0" max="255" step="1" value={v} aria-label={c.name} oninput={(e) => setValue(i, Number(e.currentTarget.value))} />
										<span class="num"><ScrubNumber label={c.name} value={v} step={1} min={0} max={255} onchange={(x) => setValue(i, x ?? 0)} /></span>
									</div>
								{/each}
							</div>
						{:else if mers === 'texture'}
							<div class="group">
								<div class="row named">
									<span>Texture</span>
									<span class="ox-code read">{set?.mers}.png</span>
									<span class="dim">{s.glowDraft ? 'made here, not saved' : 'in the pack'}</span>
								</div>
								<div class="keyline sub">
									<span>Make it from the colour texture</span>
									<Hint label="About making the MERS texture" text="For every pixel: `emissive` (green) rises with the pixel’s brightness above the threshold, times the gain; `roughness` (blue) is the same everywhere; `metalness` (red) is 0. Alpha is the colour texture’s." doc={DOC} />
								</div>
								<div class="row slider">
									<span use:tip={'Pixels brighter than this (0–255) are emissive'}>Threshold</span>
									<input type="range" min="0" max="1" step="0.01" bind:value={threshold} oninput={tweakMap} aria-label="Brightness above which a pixel is emissive" />
									<span class="num ox-num">{Math.round(threshold * 255)}</span>
								</div>
								<div class="row slider">
									<span use:tip={'Multiplies emissive above the threshold'}>Gain</span>
									<input type="range" min="0" max="2" step="0.05" bind:value={strength} oninput={tweakMap} aria-label="Emissive gain" />
									<span class="num ox-num">×{strength.toFixed(2)}</span>
								</div>
								<div class="row slider">
									<span class="key ox-code" use:tip={CHANNELS[2].help}>roughness</span>
									<input type="range" min="0" max="1" step="0.01" bind:value={roughness} oninput={tweakMap} aria-label="roughness" />
									<span class="num ox-num">{Math.round(roughness * 255)}</span>
								</div>
							</div>
						{/if}
						{#if set?.normal}<div class="row"><span class="key ox-code">normal</span><span class="ox-code read">{set.normal}</span></div>{/if}
						{#if set?.heightmap && !set.normal}<div class="row"><span class="key ox-code">heightmap</span><span class="ox-code read">{set.heightmap}</span></div>{/if}
					</div>

					<!-- what the edits come to: the file, and the texture it names -->
					<div class="file">
						<h4 class="ox-code">{texture}.texture_set.json</h4>
						{#if fileText}
							<pre class="ox-code">{fileText}</pre>
						{:else}
							<p class="note">No file: without a texture set the particle is lit by the world like a block.</p>
						{/if}
						{#if mers === 'texture' && shownMap}
							<h4 class="ox-code">{set?.mers}.png</h4>
							<div class="map">
								<img src={shownMap} alt="The MERS texture" />
								<div class="legend">
									{#each CHANNELS as c (c.name)}<span><i class={c.channel}></i>{c.channel}: {c.name}</span>{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</Section>

		<Section title="Color grading" open={open.grading} ontoggle={() => toggle('grading')}>
			{#snippet aside()}
				<Hint label="About color grading" where={GRADING_PATH} text="The grade and the tone mapper every Vibrant Visuals frame goes through, for the whole pack. Oxygen previews the midtones and the tone mapper; shadows, highlights and temperature stay as the file has them." doc={DOC} />
				<span class="spacer"></span>
				{@render status(s.gradingEdits.length > 0, s.vvFromPack.grading, gradingNote)}
				{#if s.gradingEdits.length}<button class="btn" onclick={() => revert('grading')}>Revert</button>{/if}
				<button class="primary" disabled={busy || !s.gradingEdits.length} use:tip={`Writes ${GRADING_PATH}`} onclick={() => saveFile('grading')}>Save to pack</button>
			{/snippet}
			<div class="cols">
				<div class="edit">
					<div class="row">
						<span class="key ox-code" use:tip={{ where: 'tone_mapping › operator', text: 'How bright colours are brought into what a screen can show.' }}>operator</span>
						<Select value={s.vvGrading.toneMapper} label="Tone mapping operator" options={TONE_MAPPERS.map((t) => ({ value: t, label: t }))} onchange={(v) => setGrading('toneMapper', v as ToneMapper)} />
					</div>
					<div class="keyline"><span class="key ox-code" use:tip={{ where: 'color_grading › midtones', text: 'Red, green and blue, each graded on its own.' }}>midtones</span></div>
					<div class="group">
						{@render vec3('saturation', '1 leaves colours as they are; 0 is grey.')}
						{@render vec3('contrast', 'Around mid grey: above 1 pushes values apart.')}
						{@render vec3('gain', 'Multiplies the colour.')}
						{@render vec3('offset', 'Added to the colour.')}
						<div class="row">
							<span class="key ox-code" use:tip={{ where: 'color_grading › midtones › gamma', text: 'The final encode: display = colour ^ (1 / gamma). Written as the same value for red, green and blue.' }}>gamma</span>
							<div class="trio"><ScrubNumber label="gamma" value={s.vvGrading.gamma} step={0.05} min={0.1} onchange={(v) => setGrading('gamma', v ?? 2.2)} /></div>
						</div>
					</div>
				</div>
				<div class="file">
					<h4 class="ox-code">{GRADING_PATH}</h4>
					{#if gradingText}<pre class="ox-code">{gradingText}</pre>{:else}<p class="note">No file in the pack: the game’s default grading.</p>{/if}
				</div>
			</div>
		</Section>

		<Section title="Lighting" open={open.lighting} ontoggle={() => toggle('lighting')}>
			{#snippet aside()}
				<Hint label="About lighting" where={LIGHTING_PATH} text="The sun, the moon and the ambient light by time of day, for the whole pack. Times count from noon: 0 is noon, 0.5 midnight. The preview scales its measured particle light by how these differ from the game’s defaults; lit and unlit particles look the same in Vibrant Visuals." doc="accuracy#vibrant-visuals" />
				<span class="spacer"></span>
				{@render status(s.lightingEdits.length > 0, s.vvFromPack.lighting, lightingNote)}
				{#if s.lightingEdits.length}<button class="btn" onclick={() => revert('lighting')}>Revert</button>{/if}
				<button class="primary" disabled={busy || !s.lightingEdits.length} use:tip={`Writes ${LIGHTING_PATH}`} onclick={() => saveFile('lighting')}>Save to pack</button>
			{/snippet}
			<div class="cols">
				<div class="edit">
					<div class="row slider">
						<span use:tip={'The same time of day as Scene › World'}>Time of day</span>
						<input type="range" min="0" max="1" step="0.01" value={s.timeOfDay} aria-label="Time of day" oninput={(e) => (s.timeOfDay = Number(e.currentTarget.value))} />
						<span class="num ox-num" use:tip={'As the file counts it: from noon'}>{lightTime.toFixed(2)}</span>
					</div>
					<div class="facts">
						<span>Sun or moon now</span><span class="ox-num">{lux(light.directional)} lux</span>
						<span>Ambient now</span><span class="ox-num">{lux(light.ambient)} lux</span>
					</div>
					{@render lightRows('sun', 'directional_lights › orbital › sun', 'sunIlluminance', 'sunColor', 1)}
					{@render lightRows('moon', 'directional_lights › orbital › moon', 'moonIlluminance', 'moonColor', 0.01)}
					{@render lightRows('ambient', 'ambient', 'ambientIlluminance', 'ambientColor', 0.01)}
					<div class="row long">
						<span class="key ox-code" use:tip={{ where: 'directional_lights › orbital › orbital_offset_degrees', text: 'How far the sun’s and moon’s path leans from straight overhead.' }}>orbital_offset_degrees</span>
						<ScrubNumber label="orbital_offset_degrees" value={s.vvLighting.orbitalOffsetDegrees} step={1} onchange={(v) => setLighting('orbitalOffsetDegrees', v ?? 0)} />
					</div>
					<div class="row long">
						<span class="key ox-code" use:tip={{ where: 'emissive › desaturation', text: '0 to 1: how much of its colour an emissive surface loses in the light it gives off.' }}>desaturation</span>
						<ScrubNumber label="emissive desaturation" value={s.vvLighting.emissiveDesaturation} step={0.05} min={0} max={1} onchange={(v) => setLighting('emissiveDesaturation', v ?? 0)} />
					</div>
				</div>
				<div class="file">
					<h4 class="ox-code">{LIGHTING_PATH}</h4>
					{#if lightingText}<pre class="ox-code tall">{lightingText}</pre>{:else}<p class="note">No file in the pack: the game’s default lighting.</p>{/if}
				</div>
			</div>
		</Section>
	{/if}
</div>

<style>
	.vv {
		height: 100%;
		overflow: auto;
		container-type: inline-size;
	}
	.edit,
	.file {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.file {
		margin-top: 8px;
	}
	/* wide (its usual place, under the viewport): each file's editor beside the text it writes */
	@container (min-width: 760px) {
		.cols {
			display: grid;
			grid-template-columns: minmax(340px, 500px) minmax(0, 1fr);
			gap: 16px;
		}
		.file {
			margin-top: 0;
			padding-left: 16px;
			border-left: 1px solid var(--ox-rule);
		}
	}
	h4 {
		margin: 0;
		font-size: 12px;
		font-weight: 500;
		color: var(--ox-haze);
		overflow-wrap: anywhere;
	}
	.notice {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 6px 10px;
		border-bottom: 1px solid var(--ox-rule);
		color: var(--ox-haze);
	}
	.spacer {
		flex: 1;
	}
	.row {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr);
		gap: 8px;
		align-items: center;
		min-height: 22px;
		color: var(--ox-haze);
	}
	.row.slider {
		grid-template-columns: 96px minmax(0, 1fr) 64px;
	}
	.row.top {
		align-items: start;
	}
	.row.top > .key {
		line-height: 22px;
	}
	.row.long {
		grid-template-columns: max-content minmax(0, 120px);
		justify-content: space-between;
	}
	.trio {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 4px;
	}
	/* a key the file holds, written as the file writes it */
	.key {
		color: var(--ox-syn-variable);
		font-size: 12px;
		white-space: nowrap;
	}
	.keyline {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
	}
	.keyline.sub {
		color: var(--ox-haze);
	}
	.read {
		color: var(--ox-frost);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row.named {
		grid-template-columns: 96px minmax(0, 1fr) auto;
	}
	.named .read {
		grid-column: auto;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 2px 0 2px 8px;
		border-left: 2px solid var(--ox-rule-strong);
	}
	.num {
		text-align: right;
		color: var(--ox-frost);
	}
	.dim {
		color: var(--ox-text-dim);
		font-size: 11.5px;
		white-space: nowrap;
	}
	input[type='range'] {
		min-width: 0;
		accent-color: var(--ox-lox);
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.choice {
		height: 24px;
		padding: 0 10px;
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
	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 2px 12px;
		margin-top: 2px;
		color: var(--ox-frost);
	}
	.facts > span:nth-child(odd) {
		color: var(--ox-haze);
	}
	pre {
		margin: 0;
		padding: 8px 10px;
		background: var(--ox-input);
		border-radius: var(--ox-radius);
		color: var(--ox-code-fg);
		font-size: 12px;
		line-height: 18px;
		tab-size: 2;
		overflow: auto;
		user-select: text;
	}
	pre.tall {
		max-height: 420px;
	}
	.map {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.map img {
		width: 128px;
		height: 128px;
		object-fit: contain;
		image-rendering: pixelated;
		background: #000;
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius);
	}
	.legend {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--ox-haze);
	}
	.legend i {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 2px;
	}
	.legend .red {
		background: #e0564f;
	}
	.legend .green {
		background: #5fc462;
	}
	.legend .blue {
		background: #5b8fe6;
	}
	.legend .alpha {
		background: repeating-conic-gradient(var(--ox-haze) 0 25%, transparent 0 50%) 0 0 / 4px 4px;
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
	.state {
		color: var(--ox-haze);
		font-size: 12px;
	}
	.btn,
	.primary {
		flex: none;
		height: 24px;
		padding: 0 10px;
		border-radius: var(--ox-radius);
		cursor: pointer;
		white-space: nowrap;
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
