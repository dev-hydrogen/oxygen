<script lang="ts">
	import { decimalsFor, parseNumberText, showNumber } from '../../lib/numbers';

	interface Props {
		value: number | null;
		onchange: (value: number | null) => void;
		label: string;
		/** change per 4 px of drag and per arrow key (Shift ×10, Alt ×0.1) */
		step?: number;
		min?: number;
		max?: number;
		placeholder?: string;
		/** clearing the text sets null instead of being rejected */
		allowEmpty?: boolean;
	}

	let { value, onchange, label, step = 0.1, min, max, placeholder = '', allowEmpty = false }: Props = $props();

	let input: HTMLInputElement;
	/** text while typing, or the live value while dragging */
	let draft = $state<string | null>(null);
	let invalid = $state(false);
	let scrubbing = $state(false);
	let drag: { x: number; start: number; moved: boolean } | null = null;

	const shown = $derived(draft ?? (value === null ? '' : showNumber(value)));

	function clamp(n: number): number {
		if (min !== undefined && n < min) n = min;
		if (max !== undefined && n > max) n = max;
		return n;
	}

	function stepFor(e: { shiftKey: boolean; altKey: boolean }): number {
		return e.shiftKey ? step * 10 : e.altKey ? step / 10 : step;
	}

	function commitText() {
		if (draft === null) return;
		const n = parseNumberText(draft);
		if (n === undefined || (n === null && !allowEmpty)) {
			invalid = true;
			return;
		}
		invalid = false;
		draft = null;
		const out = n === null ? null : clamp(n);
		if (out !== value) onchange(out);
	}

	function nudge(dir: number, e: { shiftKey: boolean; altKey: boolean }) {
		const base = parseNumberText(draft ?? '') ?? value ?? 0;
		const s = stepFor(e);
		const n = clamp(Number((base + dir * s).toFixed(decimalsFor(s))));
		draft = null;
		invalid = false;
		onchange(n);
	}

	function down(e: PointerEvent) {
		// a focused field is being typed in; only drag from the resting state
		if (e.button !== 0 || document.activeElement === input) return;
		e.preventDefault();
		drag = { x: e.clientX, start: value ?? 0, moved: false };
		sent = value;
		input.setPointerCapture(e.pointerId);
	}

	/** what dragging last handed out: it applies as it goes, at most every few frames */
	let sent: number | null = null;
	let sendTimer: ReturnType<typeof setTimeout> | null = null;
	function send() {
		sendTimer = null;
		const n = draft === null ? null : Number(draft);
		if (n === null || !Number.isFinite(n) || n === sent) return;
		sent = n;
		onchange(n);
	}

	function move(e: PointerEvent) {
		if (!drag) return;
		const dx = e.clientX - drag.x;
		if (!drag.moved && Math.abs(dx) < 3) return;
		drag.moved = true;
		scrubbing = true;
		const s = stepFor(e);
		draft = showNumber(clamp(drag.start + Math.round(dx / 4) * s), decimalsFor(s));
		sendTimer ??= setTimeout(send, 30);
	}

	function up(e: PointerEvent) {
		if (!drag) return;
		const d = drag;
		drag = null;
		scrubbing = false;
		if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
		if (d.moved) {
			if (sendTimer) clearTimeout(sendTimer);
			const n = draft === null ? null : Number(draft);
			draft = null;
			if (n !== null && n !== sent && n !== value) onchange(n);
			sent = null;
			sendTimer = null;
		} else {
			input.focus();
			input.select();
		}
	}
</script>

<span class="wrap">
<input
	bind:this={input}
	class="scrub ox-num"
	class:invalid
	class:scrubbing
	type="text"
	inputmode="decimal"
	spellcheck="false"
	aria-label={label}
	title={invalid ? 'Not a number. Arithmetic like 1/3 or math.pi/2 works.' : `Drag, scroll or use the arrows to change it (Shift ×10, Alt ×0.1), or type a number`}
	value={shown}
	{placeholder}
	oninput={(e) => {
		draft = e.currentTarget.value;
		invalid = false;
		// a complete number applies as it's typed; the text stays as written until the field is left
		const n = parseNumberText(draft);
		if (typeof n === 'number' && clamp(n) !== value) onchange(clamp(n));
	}}
	onblur={commitText}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onkeydown={(e) => {
		if (e.key === 'Enter') {
			commitText();
			if (!invalid) e.currentTarget.blur();
		} else if (e.key === 'Escape') {
			draft = null;
			invalid = false;
			e.currentTarget.blur();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			nudge(e.key === 'ArrowUp' ? 1 : -1, e);
		}
	}}
	onwheel={(e) => {
		// only while typing in it, so scrolling past a field doesn't change it
		if (document.activeElement !== input || !e.deltaY) return;
		e.preventDefault();
		nudge(e.deltaY < 0 ? 1 : -1, e);
	}}
/>
<span class="steps">
	<button type="button" tabindex="-1" aria-label="{label}: decrease" title="Decrease (Shift ×10, Alt ×0.1)" onpointerdown={(e) => e.preventDefault()} onclick={(e) => nudge(-1, e)}>−</button>
	<button type="button" tabindex="-1" aria-label="{label}: increase" title="Increase (Shift ×10, Alt ×0.1)" onpointerdown={(e) => e.preventDefault()} onclick={(e) => nudge(1, e)}>+</button>
</span>
</span>

<style>
	.wrap {
		position: relative;
		display: block;
		width: 100%;
		min-width: 0;
	}
	.steps {
		position: absolute;
		top: 1px;
		right: 1px;
		bottom: 1px;
		display: none;
	}
	.wrap:hover .steps,
	.wrap:focus-within .steps {
		display: flex;
	}
	.steps button {
		width: 16px;
		border: none;
		padding: 0;
		background: var(--ox-raised);
		color: var(--ox-haze);
		cursor: pointer;
		font-size: 12px;
		line-height: 1;
	}
	.steps button:hover {
		color: var(--ox-frost);
		background: var(--ox-hover);
	}
	.scrub {
		width: 100%;
		min-width: 0;
		height: 22px;
		padding: 0 6px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		outline: none;
		cursor: ew-resize;
		text-align: left;
	}
	.scrub:hover {
		background: var(--ox-input-hover);
	}
	.scrub:focus {
		cursor: text;
		border-color: var(--ox-lox);
		background: var(--ox-input);
	}
	.scrub.scrubbing {
		border-color: var(--ox-lox);
		color: var(--ox-lox);
	}
	.scrub.invalid {
		border-color: var(--ox-error);
	}
	.scrub::placeholder {
		color: var(--ox-text-dim);
	}
</style>
