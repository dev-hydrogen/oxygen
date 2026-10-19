<script lang="ts">
	import type { FieldInfo } from '@oxygen/format';
	import type { EffectSession } from '../../state/session.svelte';
	import { molangContextFor } from '../../lib/field-context';
	import { joinPath } from '../../lib/molang-text';
	import MolangInput from './MolangInput.svelte';
	import NumberInput from './NumberInput.svelte';
	import Select from './Select.svelte';
	import Toggle from './Toggle.svelte';
	import UvThumb from './UvThumb.svelte';
	import VecInput from './VecInput.svelte';

	interface Props {
		session: EffectSession;
		path: string;
		label: string;
		info: FieldInfo;
		onfocus?: (path: string) => void;
	}

	let { session, path, label, info, onfocus }: Props = $props();

	const uv = $derived.by(() => {
		void session.version;
		const v = session.doc.get(path);
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
	});
	const mode = $derived(!uv ? 'whole' : uv.flipbook ? 'flipbook' : 'area');

	function setMode(m: string) {
		const tw = (uv?.texture_width as number) ?? 16;
		const th = (uv?.texture_height as number) ?? 16;
		// each kind remembers what it held, so going back to it restores the work
		if (m === 'whole') session.switchKind(path, mode, m, undefined, 'Use the whole texture');
		else if (m === 'area') session.switchKind(path, mode, m, { texture_width: tw, texture_height: th, uv: [0, 0], uv_size: [tw, th] }, 'Use a texture area');
		else
			session.switchKind(
				path,
				mode,
				m,
				{ texture_width: tw, texture_height: th, flipbook: { base_UV: [0, 0], size_UV: [8, 8], step_UV: [8, 0], frames_per_second: 8, max_frame: 4, stretch_to_lifetime: false, loop: true } },
				'Use a flipbook',
			);
	}

	const fb = $derived(joinPath(path, 'flipbook'));
	const flip = $derived((uv?.flipbook as Record<string, unknown>) ?? {});
</script>

<div class="uv">
	<div class="top">
		<div class="kind">
			<Select
				value={mode}
				label="{label} kind"
				options={[
					{ value: 'whole', label: 'Whole texture' },
					{ value: 'area', label: 'Texture area' },
					{ value: 'flipbook', label: 'Flipbook' },
				]}
				onchange={setMode}
			/>
		</div>
		<UvThumb {session} {uv} />
	</div>
	{#if uv}
		<div class="pair">
			<span class="sub">Texture</span>
			<NumberInput {session} path={joinPath(path, 'texture_width')} label="{label} texture width" fallback={1} unit="px" />
			<span class="x">×</span>
			<NumberInput {session} path={joinPath(path, 'texture_height')} label="{label} texture height" fallback={1} unit="px" />
		</div>
	{/if}
	{#if mode === 'area'}
		<div class="group">
			<span class="sub">Position</span>
			<VecInput {session} path={joinPath(path, 'uv')} {info} labels={['U', 'V']} defaults={[0, 0]} baseLabel="{label} position" {onfocus} />
		</div>
		<div class="group">
			<span class="sub">Size</span>
			<VecInput {session} path={joinPath(path, 'uv_size')} {info} labels={['W', 'H']} defaults={[(uv?.texture_width as number) ?? 1, (uv?.texture_height as number) ?? 1]} baseLabel="{label} size" {onfocus} />
		</div>
	{:else if mode === 'flipbook'}
		<div class="group">
			<span class="sub">First frame</span>
			<VecInput {session} path={joinPath(fb, 'base_UV')} {info} labels={['U', 'V']} defaults={[0, 0]} baseLabel="{label} first frame" {onfocus} />
		</div>
		<div class="pair">
			<span class="sub">Frame size</span>
			<NumberInput {session} path={joinPath(fb, 'size_UV', 0)} label="{label} frame width" unit="px" />
			<span class="x">×</span>
			<NumberInput {session} path={joinPath(fb, 'size_UV', 1)} label="{label} frame height" unit="px" />
		</div>
		<div class="pair">
			<span class="sub">Step</span>
			<NumberInput {session} path={joinPath(fb, 'step_UV', 0)} label="{label} step U" unit="px" />
			<span class="x">,</span>
			<NumberInput {session} path={joinPath(fb, 'step_UV', 1)} label="{label} step V" unit="px" />
		</div>
		<div class="pair">
			<span class="sub">Frames</span>
			<MolangInput {session} path={joinPath(fb, 'max_frame')} label="{label} max frame" placeholder="1" context={molangContextFor(session, joinPath(fb, 'max_frame'), undefined, 1)} />
		</div>
		<div class="pair">
			<span class="sub">Speed</span>
			<NumberInput {session} path={joinPath(fb, 'frames_per_second')} label="{label} frames per second" unit="fps" />
		</div>
		<div class="pair">
			<span class="sub">Fit lifetime</span>
			<Toggle checked={flip.stretch_to_lifetime === true} label="{label} stretch to lifetime" onchange={(v) => session.doc.set(joinPath(fb, 'stretch_to_lifetime'), v, 'Edit flipbook')} />
			<span class="sub gap">Loop</span>
			<Toggle checked={flip.loop === true} label="{label} loop" onchange={(v) => session.doc.set(joinPath(fb, 'loop'), v, 'Edit flipbook')} />
		</div>
	{/if}
</div>

<style>
	.uv {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
		min-width: 0;
	}
	.top {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		min-width: 0;
	}
	.kind {
		flex: 1;
		min-width: 0;
	}
	.pair,
	.group {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.group {
		align-items: flex-start;
	}
	.sub {
		width: 70px;
		flex: none;
		color: var(--ox-text-dim);
		line-height: 22px;
		white-space: nowrap;
	}
	.sub.gap {
		width: auto;
		margin-left: 12px;
	}
	.x {
		color: var(--ox-text-dim);
	}
</style>
