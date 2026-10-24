<script lang="ts">
	import type { EffectSession } from '../../state/session.svelte';
	import { parseColorInput, round3, toBedrockHex, toCss, type RGBA } from '../../lib/color';
	import ScrubNumber from './ScrubNumber.svelte';
	import { molangContextFor } from '../../lib/field-context';
	import { joinPath } from '../../lib/molang-text';
	import MolangInput from './MolangInput.svelte';
	import Select from './Select.svelte';
	import ColorPicker from './ColorPicker.svelte';

	interface Props {
		session: EffectSession;
		path: string;
		label: string;
		onfocus?: (path: string) => void;
	}

	let { session, path, label, onfocus }: Props = $props();

	const value = $derived.by(() => {
		void session.version;
		return session.doc.get(path);
	});

	type Mode = 'hex' | 'channels' | 'gradient';
	const mode = $derived<Mode>(
		value && typeof value === 'object' && !Array.isArray(value) ? 'gradient' : Array.isArray(value) ? 'channels' : 'hex',
	);

	let reading = $state<string | null>(null);
	/** an 8-digit hex that was just entered, which could also be read alpha-last */
	let lastAmbiguous = $state<{ text: string; at: string; alphaLast: boolean } | null>(null);

	/** Constant RGBA of a color value, or null when any channel is Molang */
	function constant(v: unknown): RGBA | null {
		if (v === undefined) return [1, 1, 1, 1];
		if (typeof v === 'string') return parseColorInput(v)?.rgba ?? null;
		if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return [v[0], v[1], v[2], v[3] ?? 1] as RGBA;
		return null;
	}

	/** What to draw for a color whose channels may be Molang: its numbers, grey where a channel is an expression */
	function shown(v: unknown): RGBA {
		const c = constant(v);
		if (c) return c;
		if (!Array.isArray(v)) return [0.5, 0.5, 0.5, 1];
		return [0, 1, 2, 3].map((i) => (typeof v[i] === 'number' ? v[i] : i === 3 && v[i] === undefined ? 1 : 0.5)) as RGBA;
	}

	/** each kind remembers what it held, so going back to it restores the work */
	function setMode(m: string) {
		const c = constant(value) ?? [1, 1, 1, 1];
		if (m === 'hex') session.switchKind(path, mode, m, toBedrockHex(c), 'Use a color');
		else if (m === 'channels') session.switchKind(path, mode, m, c.map(round3), 'Use per-channel Molang');
		else session.switchKind(path, mode, m, { gradient: { '0.0': toBedrockHex(c), '1.0': '#00FFFFFF' }, interpolant: 'v.particle_age / v.particle_lifetime' }, 'Use a gradient');
	}

	function writeHex(text: string, at = path, alphaLast = false) {
		const parsed = parseColorInput(text, alphaLast);
		if (!parsed) {
			reading = `Couldn't read “${text}” as a color`;
			lastAmbiguous = null;
			return;
		}
		reading = parsed.reading;
		lastAmbiguous = parsed.ambiguous ? { text, at, alphaLast } : null;
		session.doc.set(at, toBedrockHex(parsed.rgba), 'Edit color');
	}

	function pasteHex(e: ClipboardEvent, at = path) {
		const t = e.clipboardData?.getData('text');
		if (!t) return;
		e.preventDefault();
		writeHex(t, at);
	}

	/** Set a color's alpha (0–100 %) keeping its RGB */
	function setAlpha(at: string, c: RGBA, pct: number | null) {
		const a = Math.min(1, Math.max(0, (pct ?? 100) / 100));
		session.doc.set(at, toBedrockHex([c[0], c[1], c[2], a]), 'Edit alpha');
	}

	/** Set a color's RGB from the picker keeping its alpha */
	/** a pick from the color picker: while it's dragged the preview follows a few times a second */
	let pickTimer: ReturnType<typeof setTimeout> | null = null;
	let pickPending: { at: string; c: RGBA } | null = null;
	function writePick() {
		if (pickTimer) clearTimeout(pickTimer);
		pickTimer = null;
		const p = pickPending;
		pickPending = null;
		// a stop written as channels stays channels
		if (p) session.doc.set(p.at, Array.isArray(session.doc.get(p.at)) ? p.c.map(round3) : toBedrockHex(p.c), 'Edit color');
	}
	function pick(at: string, c: RGBA, done: boolean) {
		pickPending = { at, c };
		if (done) writePick();
		else pickTimer ??= setTimeout(writePick, 80);
	}

	const stops = $derived.by(() => {
		if (mode !== 'gradient') return [];
		const g = (value as { gradient?: unknown }).gradient;
		if (Array.isArray(g)) return g.map((c, i) => ({ key: g.length > 1 ? i / (g.length - 1) : 0, rawKey: String(i), color: c, evenly: true }));
		if (g && typeof g === 'object') return Object.entries(g as Record<string, unknown>).map(([k, c]) => ({ key: parseFloat(k), rawKey: k, color: c, evenly: false })).sort((a, b) => a.key - b.key);
		return [];
	});

	const gradientCss = $derived(
		stops.length
			? `linear-gradient(90deg, ${stops.map((s) => `${toCss(shown(s.color))} ${(Math.min(1, Math.max(0, s.key)) * 100).toFixed(1)}%`).join(', ')})`
			: 'none',
	);

	function exactPositions() {
		const g: Record<string, unknown> = {};
		for (const s of stops) g[s.key.toFixed(2)] = s.color;
		session.doc.set(joinPath(path, 'gradient'), g, 'Use exact stop positions');
	}

	function moveStop(rawKey: string, text: string) {
		const k = Number(text);
		if (!Number.isFinite(k)) return;
		const g = { ...((value as { gradient: Record<string, unknown> }).gradient ?? {}) };
		const color = g[rawKey];
		delete g[rawKey];
		g[String(k)] = color;
		session.doc.set(joinPath(path, 'gradient'), g, 'Move gradient stop');
	}

	function addStop() {
		const g = (value as { gradient?: unknown }).gradient;
		if (Array.isArray(g)) session.doc.insert(joinPath(path, 'gradient'), '#FFFFFFFF', undefined, 'Add gradient stop');
		else {
			const keys = stops.map((s) => s.key);
			const k = keys.length ? Math.min(1, (keys[keys.length - 1] + 1) / 2) : 0.5;
			session.doc.set(joinPath(path, 'gradient', k.toFixed(2)), '#FFFFFFFF', 'Add gradient stop');
		}
	}

	/** A stop as [r, g, b, a] Molang (the game evaluates the stops its interpolant uses), or back to a hex color */
	function setStopKind(at: string, color: unknown, channels: boolean) {
		const c = shown(color);
		if (channels) session.switchKind(at, 'hex', 'channels', c.map(round3), 'Use Molang for a gradient stop');
		else session.switchKind(at, 'channels', 'hex', toBedrockHex(c), 'Use a color for a gradient stop');
	}

	function removeStop(rawKey: string) {
		session.doc.remove(joinPath(path, 'gradient', rawKey), 'Remove gradient stop');
	}
</script>

<div class="color">
	<div class="head">
		<Select
			value={mode}
			label="{label} kind"
			options={[
				{ value: 'hex', label: 'Color' },
				{ value: 'channels', label: 'Per-channel Molang' },
				{ value: 'gradient', label: 'Gradient' },
			]}
			onchange={setMode}
		/>
	</div>

	{#if mode === 'hex'}
		{@const c = constant(value) ?? [1, 1, 1, 1]}
		<div class="hexrow">
			<ColorPicker value={c} label="{label} picker" oninput={(x) => pick(path, x, false)} onchange={(x) => pick(path, x, true)} />
			<input
				class="hex ox-code"
				aria-label="{label} hex"
				value={typeof value === 'string' ? value : toBedrockHex(c)}
				onchange={(e) => writeHex(e.currentTarget.value)}
				onpaste={(e) => pasteHex(e)}
			/>
			<span class="alpha" title="Alpha, in percent"><ScrubNumber label="{label} alpha" value={Math.round(c[3] * 1000) / 10} min={0} max={100} step={1} onchange={(v) => setAlpha(path, c, v)} /></span>
		</div>
		{@render readingNote()}
	{:else if mode === 'channels'}
		{@const c = constant(value)}
		{#each ['R', 'G', 'B', 'A'] as ch, i (ch)}
			{@const p = joinPath(path, i)}
			<div class="axis">
				<span class="tag" aria-hidden="true">{ch}</span>
				<MolangInput {session} path={p} label="{label} {ch}" placeholder="1" context={molangContextFor(session, p, undefined, 1)} onfocus={() => onfocus?.(p)} />
			</div>
		{/each}
		{#if c}<div class="bar" style:--c={toCss(c)}></div>{/if}
	{:else}
		{@const ip = joinPath(path, 'interpolant')}
		<div class="axis">
			<span class="tag wide" aria-hidden="true">at</span>
			<MolangInput {session} path={ip} label="{label} interpolant" placeholder="0" context={molangContextFor(session, ip, undefined, 0)} onfocus={() => onfocus?.(ip)} />
		</div>
		<div class="gradient" style:--g={gradientCss}></div>
		{#each stops as s (s.rawKey)}
			{@const sp = joinPath(path, 'gradient', s.rawKey)}
			{@const sc = constant(s.color)}
			{@const channels = Array.isArray(s.color)}
			<div class="stop">
				{#if s.evenly}
					<span class="key ox-num" title="Evenly spaced">{s.key.toFixed(2)}</span>
				{:else}
					<input class="key ox-num" aria-label="Stop position" value={s.rawKey} onchange={(e) => moveStop(s.rawKey, e.currentTarget.value)} />
				{/if}
				{#if sc}
					<ColorPicker value={sc} label="Stop color picker" oninput={(x) => pick(sp, x, false)} onchange={(x) => pick(sp, x, true)} />
				{:else}
					<span class="dot" style:--c={toCss(shown(s.color))}></span>
				{/if}
				{#if channels}
					<span class="fill"></span>
				{:else}
					<input
						class="hex ox-code"
						aria-label="Stop color"
						value={typeof s.color === 'string' ? s.color : JSON.stringify(s.color)}
						onchange={(e) => writeHex(e.currentTarget.value, sp)}
						onpaste={(e) => pasteHex(e, sp)}
					/>
					{#if sc}<span class="alpha" title="Alpha, in percent"><ScrubNumber label="Stop alpha" value={Math.round(sc[3] * 1000) / 10} min={0} max={100} step={1} onchange={(v) => setAlpha(sp, sc, v)} /></span>{/if}
				{/if}
				<button
					class="icon fx"
					class:on={channels}
					aria-label="Molang channels"
					aria-pressed={channels}
					title={channels ? 'Use a color for this stop' : 'Write this stop as R, G, B, A Molang'}
					onclick={() => setStopKind(sp, s.color, !channels)}>ƒ</button
				>
				<button class="icon" aria-label="Remove stop" onclick={() => removeStop(s.rawKey)}>×</button>
			</div>
			{#if channels}
				{#each ['R', 'G', 'B', 'A'] as ch, i (ch)}
					{@const p = joinPath(sp, i)}
					<div class="axis stopch">
						<span class="tag" aria-hidden="true">{ch}</span>
						<MolangInput {session} path={p} label="Stop {s.rawKey} {ch}" placeholder="1" context={molangContextFor(session, p, undefined, 1)} onfocus={() => onfocus?.(p)} />
					</div>
				{/each}
			{/if}
		{/each}
		<div class="gactions">
			<button class="link" onclick={addStop}>Add stop</button>
			{#if stops[0]?.evenly}<button class="link" onclick={exactPositions}>Set exact positions</button>{/if}
		</div>
		{@render readingNote()}
	{/if}
</div>

{#snippet readingNote()}
	{#if reading}
		<p class="reading">
			{reading}.
			{#if lastAmbiguous}
				{@const a = lastAmbiguous}
				<!-- keep focus in the hex field: a blur would commit it first and replace this link -->
				<button class="link" onmousedown={(e) => e.preventDefault()} onclick={() => writeHex(a.text, a.at, !a.alphaLast)}>{a.alphaLast ? 'Read it as #AARRGGBB instead' : 'It was #RRGGBBAA (alpha last)'}</button>
			{/if}
		</p>
	{/if}
{/snippet}

<style>
	.color {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
		min-width: 0;
	}
	.head {
		display: flex;
	}
	.hexrow,
	.stop,
	.axis {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.axis {
		align-items: flex-start;
	}
	.dot,
	.bar,
	.gradient {
		background:
			linear-gradient(var(--c, transparent), var(--c, transparent)),
			repeating-conic-gradient(#555 0 25%, #888 0 50%) 0 0 / 8px 8px;
	}
	.hex,
	.key {
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
		min-width: 0;
	}
	.hex {
		flex: 1;
	}
	.hex:focus,
	.key:focus {
		border-color: var(--ox-lox);
	}
	.key {
		width: 48px;
		flex: none;
		line-height: 22px;
		color: var(--ox-haze);
	}
	span.key {
		background: none;
	}
	.alpha {
		width: 52px;
		flex: none;
		position: relative;
	}
	.alpha::after {
		content: '%';
		position: absolute;
		right: 5px;
		top: 3px;
		color: var(--ox-text-dim);
		pointer-events: none;
		font-size: 11px;
	}
	.alpha :global(.scrub) {
		padding-right: 16px;
	}
	.dot {
		width: 14px;
		height: 14px;
		border-radius: 2px;
		flex: none;
		border: 1px solid var(--ox-rule-strong);
	}
	.bar {
		height: 6px;
		border-radius: 2px;
		margin-left: 16px;
	}
	.gradient {
		--c: transparent;
		height: 14px;
		border-radius: var(--ox-radius);
		background:
			var(--g),
			repeating-conic-gradient(#555 0 25%, #888 0 50%) 0 0 / 8px 8px;
		margin-left: 16px;
		border: 1px solid var(--ox-rule-strong);
	}
	.tag {
		width: 12px;
		flex: none;
		line-height: 22px;
		color: var(--ox-text-dim);
		font-size: 11px;
		text-align: center;
	}
	.tag.wide {
		width: 12px;
	}
	.icon {
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		width: 20px;
		height: 20px;
		border-radius: var(--ox-radius);
	}
	.icon:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.fill {
		flex: 1;
	}
	.icon.on {
		color: var(--ox-lox);
	}
	.stopch {
		padding-left: 52px;
	}
	.gactions {
		display: flex;
		gap: 10px;
		padding-left: 16px;
	}
	.link {
		border: none;
		background: none;
		color: var(--ox-lox);
		cursor: pointer;
		padding: 0;
	}
	.link:hover {
		text-decoration: underline;
	}
	.reading {
		margin: 0;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
</style>
