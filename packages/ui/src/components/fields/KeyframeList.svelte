<script lang="ts">
	import type { Keyframes, RGB } from '@oxygen/scene';
	import { fromHex, toHex } from '../../lib/pack-files';
	import ScrubNumber from './ScrubNumber.svelte';

	/**
	 * A value a pack file gives either once or per time of day (`{ "0.25": 400, "0.5": 1 }`): one row when it's a
	 * single value, a row per key otherwise. Times are the file's own, 0 to 1.
	 */
	interface Props {
		value: Keyframes<number> | Keyframes<RGB>;
		kind: 'number' | 'color';
		/** what it is, for screen readers ("sun illuminance") */
		label: string;
		step?: number;
		min?: number;
		/** the file's time now, where a new key goes */
		now: number;
		onchange: (value: Keyframes<number> | Keyframes<RGB>) => void;
	}

	let { value, kind, label, step = 1, min, now, onchange }: Props = $props();

	type One = number | RGB;
	const single = $derived(typeof value === 'number' || Array.isArray(value));
	const keys = $derived(
		single
			? []
			: Object.entries(value as Record<string, One>)
					// `i`: where it is in the file, which is what a row stays tied to while its time is dragged past another's
					.map(([t, v], i) => ({ i, t, at: parseFloat(t), v }))
					.sort((a, b) => a.at - b.at),
	);
	/** a key's name: never a whole number alone ("0.0", as the game's files write it), so the keys keep their order */
	const time = (n: number) => {
		const t = Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4;
		return Number.isInteger(t) ? `${t}.0` : String(t);
	};

	function setKey(t: string, v: One) {
		onchange({ ...(value as Record<string, One>), [t]: v } as Keyframes<number> | Keyframes<RGB>);
	}
	function moveKey(t: string, to: number) {
		const next: Record<string, One> = {};
		for (const [k, v] of Object.entries(value as Record<string, One>)) next[k === t ? time(to) : k] = v;
		onchange(next as Keyframes<number> | Keyframes<RGB>);
	}
	function removeKey(t: string) {
		const next = { ...(value as Record<string, One>) };
		delete next[t];
		const left = Object.values(next);
		// one key left says the same as a single value
		onchange((left.length === 1 ? left[0] : next) as Keyframes<number> | Keyframes<RGB>);
	}
	/** a new key at the time shown, with the value of the key before it */
	function addKey() {
		if (single) return onchange({ '0.0': value as One, [time(now) === '0.0' ? '0.5' : time(now)]: value as One } as Keyframes<number> | Keyframes<RGB>);
		const before = [...keys].reverse().find((k) => k.at <= now) ?? keys[keys.length - 1];
		let t = now;
		while (keys.some((k) => k.t === time(t))) t += 0.01;
		setKey(time(t), before.v);
	}
</script>

{#snippet editor(v: One, set: (v: One) => void, what: string)}
	{#if kind === 'number'}
		<ScrubNumber label={what} value={v as number} {step} {min} onchange={(x) => set(x ?? 0)} />
	{:else}
		<span class="color">
			<input type="color" value={toHex(v as RGB)} aria-label={what} oninput={(e) => set(fromHex(e.currentTarget.value))} />
			<span class="ox-code hex">{toHex(v as RGB)}</span>
		</span>
	{/if}
{/snippet}

<div class="keys">
	{#if single}
		<div class="key one">
			{@render editor(value as One, (v) => onchange(v as Keyframes<number> | Keyframes<RGB>), label)}
			<button class="link" onclick={addKey}>By time of day</button>
		</div>
	{:else}
		{#each keys as k (k.i)}
			<div class="key">
				<span class="t"><ScrubNumber label="{label}: time of key at {k.t}" value={k.at} step={0.01} min={0} max={1} onchange={(x) => x !== null && moveKey(k.t, x)} /></span>
				{@render editor(k.v, (v) => setKey(k.t, v), `${label} at ${k.t}`)}
				<button class="x" aria-label="Remove the key at {k.t}" onclick={() => removeKey(k.t)}>×</button>
			</div>
		{/each}
		<button class="link" onclick={addKey}>Add a key at {time(now)}</button>
	{/if}
</div>

<style>
	.keys {
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-items: flex-start;
		min-width: 0;
	}
	.key {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr) 18px;
		gap: 4px;
		align-items: center;
		width: 100%;
	}
	.key.one {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.color {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	input[type='color'] {
		width: 30px;
		height: 20px;
		padding: 0;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		cursor: pointer;
	}
	.hex {
		color: var(--ox-haze);
		font-size: 12px;
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--ox-lox);
		font-size: 11.5px;
		cursor: pointer;
		white-space: nowrap;
	}
	.link:hover {
		text-decoration: underline;
	}
	.x {
		padding: 0;
		border: none;
		background: none;
		color: var(--ox-text-dim);
		cursor: pointer;
	}
	.x:hover {
		color: var(--ox-error);
	}
</style>
