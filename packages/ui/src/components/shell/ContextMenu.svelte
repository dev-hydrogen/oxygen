<script lang="ts">
	import { tick } from 'svelte';
	import { closeContextMenu, contextMenu, type MenuAction, type MenuItem } from '../../lib/context-menu.svelte';

	/** The one right-click menu, at the pointer, kept inside the window */
	let el = $state<HTMLDivElement>();
	let pos = $state({ x: 0, y: 0 });
	const open = $derived(contextMenu.open);

	const isAction = (i: MenuItem): i is MenuAction => 'label' in i;

	$effect(() => {
		const m = open;
		if (!m) return;
		pos = { x: m.x, y: m.y };
		void tick().then(() => {
			if (!el) return;
			const r = el.getBoundingClientRect();
			// flip to the other side of the pointer when it would run off the window
			pos = {
				x: m.x + r.width > innerWidth - 4 ? Math.max(4, m.x - r.width) : m.x,
				y: m.y + r.height > innerHeight - 4 ? Math.max(4, innerHeight - 4 - r.height) : m.y,
			};
			el.focus();
		});
	});

	function choose(item: MenuAction) {
		if (item.disabled) return;
		closeContextMenu();
		void item.run?.();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeContextMenu();
			return;
		}
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
		e.preventDefault();
		const entries = [...(el?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
		if (!entries.length) return;
		const at = entries.indexOf(document.activeElement as HTMLElement);
		const next = e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : e.key === 'ArrowDown' ? (at + 1) % entries.length : (at - 1 + entries.length) % entries.length;
		entries[next].focus();
	}

	function outside(e: PointerEvent) {
		if (open && el && !el.contains(e.target as Node)) closeContextMenu();
	}
</script>

<svelte:window onpointerdowncapture={outside} onblur={() => closeContextMenu()} onresize={() => closeContextMenu()} />

{#if open}
	<div class="ctx" role="menu" tabindex="-1" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px" onkeydown={onKey} oncontextmenu={(e) => e.preventDefault()}>
		{#each open.items as item, k (k)}
			{#if 'separator' in item}
				<div class="sep" role="separator"></div>
			{:else if 'heading' in item}
				<div class="heading">{item.heading}</div>
			{:else if isAction(item)}
				<button class="item" class:danger={item.danger} role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} disabled={item.disabled} title={item.title} onclick={() => choose(item)}>
					<span class="check">
						{#if item.checked}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>{/if}
					</span>
					<span class="label">{item.label}</span>
					{#if item.keys}<span class="keys">{item.keys}</span>{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.ctx {
		position: fixed;
		z-index: 400;
		min-width: 200px;
		max-width: 360px;
		max-height: calc(100vh - 8px);
		overflow-y: auto;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		padding: 4px;
		display: flex;
		flex-direction: column;
		outline: none;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 10px 0 4px;
		border: none;
		background: none;
		border-radius: var(--ox-radius);
		color: var(--ox-frost);
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		flex: none;
	}
	.item:hover:not(:disabled),
	.item:focus-visible {
		background: var(--ox-selection);
		outline: none;
	}
	.item:disabled {
		color: var(--ox-text-dim);
		cursor: default;
	}
	.item.danger:not(:disabled) {
		color: var(--ox-error);
	}
	.check {
		width: 14px;
		flex: none;
		display: grid;
		place-items: center;
		color: var(--ox-lox);
	}
	.check svg {
		width: 12px;
		height: 12px;
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.keys {
		color: var(--ox-text-dim);
		font-size: 11px;
		padding-left: 18px;
	}
	.heading {
		padding: 6px 10px 2px 24px;
		font-size: 11px;
		color: var(--ox-text-dim);
		flex: none;
	}
	.sep {
		height: 1px;
		margin: 4px 2px;
		background: var(--ox-rule);
		flex: none;
	}
</style>
