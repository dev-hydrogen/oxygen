<script lang="ts">
	import { tick } from 'svelte';
	import type { DocsPage, Workspace } from '../../state/workspace.svelte';
	import { REPO } from '../../lib/about';
	import { parseMarkdown, type Block, type Inline } from '../../lib/markdown';
	import guide from '../../../../../docs/guide.md?raw';
	import molang from '../../../../../docs/molang.md?raw';
	import accuracy from '../../../../../docs/accuracy.md?raw';

	/**
	 * The Documentation, as a reader that takes the window: the guide, Molang and how the preview matches the
	 * game, with every section in the list on the left and a search over all three. What the panels don't spell
	 * out lives here.
	 */
	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();

	type Heading = Extract<Block, { kind: 'heading' }>;
	const PAGES: { id: DocsPage; label: string; file: string; blocks: Block[] }[] = [
		{ id: 'guide', label: 'Using Oxygen', file: 'guide.md', blocks: parseMarkdown(guide) },
		{ id: 'molang', label: 'Writing Molang', file: 'molang.md', blocks: parseMarkdown(molang) },
		{ id: 'accuracy', label: 'How it matches the game', file: 'accuracy.md', blocks: parseMarkdown(accuracy) },
	];

	const plain = (parts: Inline[]) => parts.map((p) => p.text).join('');
	const textOf = (b: Block): string =>
		b.kind === 'paragraph' ? plain(b.text) : b.kind === 'list' ? b.items.map(plain).join('\n') : b.kind === 'table' ? [b.head, ...b.rows].map((r) => r.map(plain).join(' ')).join('\n') : b.kind === 'code' ? b.text : '';

	/** every section of every page with its text, for the search: a heading and what follows it up to the next */
	const INDEX = PAGES.flatMap((p) => {
		const out: { page: DocsPage; pageLabel: string; id: string | undefined; title: string; text: string }[] = [];
		let at = { page: p.id, pageLabel: p.label, id: undefined as string | undefined, title: p.label, text: '' };
		for (const b of p.blocks) {
			if (b.kind === 'heading' && b.level >= 2) {
				if (at.text.trim()) out.push(at);
				at = { page: p.id, pageLabel: p.label, id: b.id, title: b.plain.replace(/[`*]/g, ''), text: '' };
			} else if (b.kind !== 'heading') at.text += `${textOf(b)}\n`;
		}
		if (at.text.trim()) out.push(at);
		return out;
	});

	const page = $derived(PAGES.find((p) => p.id === workspace.docsAt.page) ?? PAGES[0]);
	/** the page's sections, each with the smaller ones under it */
	const sections = $derived.by(() => {
		const out: { head: Heading; subs: Heading[] }[] = [];
		for (const b of page.blocks) {
			if (b.kind !== 'heading') continue;
			if (b.level === 2) out.push({ head: b, subs: [] });
			else if (b.level === 3 && out.length) out[out.length - 1].subs.push(b);
		}
		return out;
	});
	const next = $derived(PAGES[PAGES.indexOf(page) + 1] ?? null);

	let scroller = $state<HTMLElement>();
	let search = $state<HTMLInputElement>();
	/** the section scrolled to, marked in the list */
	let current = $state('');
	let query = $state('');

	const found = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 2) return null;
		const out: { page: DocsPage; pageLabel: string; id: string | undefined; title: string; before: string; match: string; after: string }[] = [];
		for (const s of INDEX) {
			const inTitle = s.title.toLowerCase().includes(q);
			const at = s.text.toLowerCase().indexOf(q);
			if (!inTitle && at < 0) continue;
			const from = Math.max(0, at - 50);
			out.push({
				...s,
				before: at < 0 ? '' : `${from > 0 ? '…' : ''}${s.text.slice(from, at).replace(/\s+/g, ' ')}`,
				match: at < 0 ? '' : s.text.slice(at, at + q.length),
				after: at < 0 ? s.text.slice(0, 90).replace(/\s+/g, ' ') : s.text.slice(at + q.length, at + q.length + 70).replace(/\s+/g, ' '),
			});
			if (out.length >= 60) break;
		}
		return out;
	});

	const close = () => (workspace.docsOpen = false);

	// go where a link, a hint, the list or a search result asked
	$effect(() => {
		const at = workspace.docsAt;
		if (!workspace.docsOpen) return;
		void tick().then(() => {
			const target = at.anchor ? scroller?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(at.anchor)}"]`) : null;
			if (target) target.scrollIntoView({ block: 'start' });
			else scroller?.scrollTo({ top: 0 });
			current = at.anchor ?? '';
		});
	});

	function onScroll() {
		if (!scroller) return;
		const top = scroller.getBoundingClientRect().top + 32;
		let at = '';
		for (const h of scroller.querySelectorAll<HTMLElement>('[data-anchor]')) {
			if (h.getBoundingClientRect().top > top) break;
			at = h.dataset.anchor ?? '';
		}
		current = at;
	}

	function key(e: KeyboardEvent) {
		if (!workspace.docsOpen) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			if (query) query = '';
			else close();
		} else if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !(e.target instanceof HTMLInputElement))) {
			e.preventDefault();
			search?.focus();
			search?.select();
		}
	}

	/** a link to another page of the Documentation opens here; the rest are the repository's or the web's */
	function target(href: string): { page: DocsPage; anchor?: string } | null {
		const [file, anchor] = href.split('#');
		const p = file ? PAGES.find((x) => x.file === file.replace(/^\.\//, '')) : page;
		return p ? { page: p.id, anchor: anchor || undefined } : null;
	}
	const outside = (href: string) => (/^[a-z]+:/i.test(href) ? href : `${REPO}/blob/main/docs/${href.replace(/^\.\//, '')}`);
</script>

<svelte:window onkeydown={key} />

{#snippet inline(parts: Inline[])}{#each parts as p, i (i)}{#if p.kind === 'code'}<code class="ox-code">{p.text}</code>{:else if p.kind === 'bold'}<strong>{p.text}</strong>{:else if p.kind === 'italic'}<em>{p.text}</em>{:else if p.kind === 'link'}{@const t = target(p.href)}{#if t}<button class="link" onclick={() => workspace.openDocs(t.page, t.anchor)}>{p.text}</button>{:else}<a href={outside(p.href)} target="_blank" rel="noreferrer">{p.text}</a>{/if}{:else}{p.text}{/if}{/each}{/snippet}

{#if workspace.docsOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={close}></div>
	<div class="dialog" role="dialog" aria-modal="true" aria-label="Documentation">
		<nav aria-label="Documentation">
			<div class="navtop">
				<h3>Documentation</h3>
				<input class="search" type="search" placeholder="Search the documentation" aria-label="Search the documentation" bind:this={search} bind:value={query} />
			</div>
			<div class="navlist">
				{#if found}
					{#each found as r (r.page + (r.id ?? ''))}
						<button class="result" onclick={() => workspace.openDocs(r.page, r.id)}>
							<span class="rtitle">{r.title}<span class="rpage">{r.pageLabel}</span></span>
							<span class="rtext">{r.before}{#if r.match}<mark>{r.match}</mark>{/if}{r.after}</span>
						</button>
					{:else}
						<p class="none">Nothing in the documentation matches “{query.trim()}”.</p>
					{/each}
				{:else}
					{#each PAGES as p (p.id)}
						<button class="page" class:on={p.id === page.id} onclick={() => workspace.openDocs(p.id)}>{p.label}</button>
						{#if p.id === page.id}
							<div class="sections">
								{#each sections as s (s.head.id)}
									<button class="section" class:on={current === s.head.id} onclick={() => workspace.openDocs(p.id, s.head.id)}>{s.head.plain}</button>
									{#each s.subs as sub (sub.id)}
										<button class="section sub" class:on={current === sub.id} onclick={() => workspace.openDocs(p.id, sub.id)}>{sub.plain}</button>
									{/each}
								{/each}
							</div>
						{/if}
					{/each}
				{/if}
			</div>
		</nav>
		<div class="content">
			<button class="x" aria-label="Close the documentation" title="Close (Esc)" onclick={close}>×</button>
			<div class="scroll" bind:this={scroller} onscroll={onScroll}>
				<article>
					<h2>{page.label}</h2>
					{#each page.blocks as b, i (i)}
						{#if b.kind === 'heading'}
							{#if b.level === 2}<h3 data-anchor={b.id}>{@render inline(b.text)}</h3>
							{:else if b.level > 2}<h4 data-anchor={b.id}>{@render inline(b.text)}</h4>{/if}
						{:else if b.kind === 'paragraph'}<p>{@render inline(b.text)}</p>
						{:else if b.kind === 'list'}<ul>{#each b.items as item, j (j)}<li>{@render inline(item)}</li>{/each}</ul>
						{:else if b.kind === 'code'}<pre class="ox-code">{b.text}</pre>
						{:else}
							<table>
								<thead><tr>{#each b.head as c, j (j)}<th>{@render inline(c)}</th>{/each}</tr></thead>
								<tbody>{#each b.rows as r, j (j)}<tr>{#each r as c, k (k)}<td>{@render inline(c)}</td>{/each}</tr>{/each}</tbody>
							</table>
						{/if}
					{/each}
					{#if next}<button class="next" onclick={() => workspace.openDocs(next.id)}>Next: {next.label}</button>{/if}
				</article>
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: rgba(10, 12, 20, 0.6);
	}
	/* a reader, not a pop-up: it takes the window */
	.dialog {
		position: fixed;
		z-index: 901;
		inset: 20px;
		margin: 0 auto;
		max-width: 1480px;
		display: flex;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		overflow: hidden;
	}
	nav {
		width: 300px;
		flex: none;
		display: flex;
		flex-direction: column;
		background: var(--ox-panel);
		border-right: 1px solid var(--ox-rule);
	}
	.navtop {
		flex: none;
		padding: 18px 16px 12px;
	}
	nav h3 {
		margin: 0 0 12px;
		font-size: 15px;
		font-weight: 600;
	}
	.search {
		width: 100%;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: var(--ox-input);
		font-size: 13px;
		outline: none;
	}
	.search:focus {
		border-color: var(--ox-lox);
	}
	.navlist {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 10px 20px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.page,
	.section,
	.result {
		flex: none;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.page {
		min-height: 32px;
		margin-top: 4px;
		padding: 0 8px;
		border-radius: var(--ox-radius);
		color: var(--ox-haze);
		font-size: 13.5px;
		font-weight: 600;
	}
	.page.on {
		color: var(--ox-frost);
	}
	.sections {
		display: flex;
		flex-direction: column;
		margin: 0 0 8px 10px;
		border-left: 1px solid var(--ox-rule-strong);
	}
	.section {
		margin-left: -1px;
		padding: 5px 8px 5px 12px;
		border-left: 2px solid transparent;
		color: var(--ox-haze);
		font-size: 13px;
		line-height: 18px;
	}
	.section.sub {
		padding-left: 24px;
		font-size: 12.5px;
	}
	.page:hover,
	.section:hover {
		color: var(--ox-frost);
		background: var(--ox-hover);
	}
	.section.on {
		border-left-color: var(--ox-lox);
		color: var(--ox-frost);
		background: var(--ox-selection);
	}
	.result {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 7px 8px;
		border-radius: var(--ox-radius);
	}
	.result:hover {
		background: var(--ox-hover);
	}
	.rtitle {
		color: var(--ox-frost);
		font-size: 13px;
		font-weight: 600;
	}
	.rpage {
		margin-left: 8px;
		color: var(--ox-text-dim);
		font-size: 11.5px;
		font-weight: 400;
	}
	.rtext {
		color: var(--ox-haze);
		font-size: 12px;
		line-height: 17px;
	}
	mark {
		background: rgba(147, 189, 245, 0.3);
		color: var(--ox-frost);
		border-radius: 2px;
	}
	.none {
		margin: 0;
		padding: 8px;
		color: var(--ox-haze);
	}
	.content {
		flex: 1;
		min-width: 0;
		position: relative;
		display: flex;
	}
	.x {
		position: absolute;
		top: 10px;
		right: 18px;
		z-index: 1;
		width: 30px;
		height: 30px;
		border: none;
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-haze);
		font-size: 22px;
		line-height: 1;
		cursor: pointer;
	}
	.x:hover {
		background: var(--ox-hover);
		color: var(--ox-frost);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 28px 56px 80px;
		scroll-behavior: smooth;
	}
	/* reading text: larger than the panels', a measure that's comfortable to follow, quiet body under bright terms */
	article {
		max-width: 74ch;
		font-size: 15px;
		line-height: 25px;
		color: #c2cadb;
	}
	article h2 {
		margin: 0 0 12px;
		font-size: 28px;
		font-weight: 650;
		line-height: 34px;
		letter-spacing: -0.01em;
		color: var(--ox-frost);
	}
	article h3 {
		margin: 40px 0 10px;
		padding-top: 18px;
		border-top: 1px solid var(--ox-rule-strong);
		font-size: 20px;
		font-weight: 600;
		line-height: 26px;
		color: var(--ox-frost);
		scroll-margin-top: 4px;
	}
	article h4 {
		margin: 26px 0 8px;
		font-size: 16px;
		font-weight: 600;
		color: var(--ox-frost);
		scroll-margin-top: 12px;
	}
	article p {
		margin: 0 0 14px;
	}
	article ul {
		margin: 0 0 14px;
		padding-left: 20px;
	}
	article li {
		margin-bottom: 9px;
		padding-left: 2px;
	}
	article li::marker {
		color: var(--ox-text-dim);
	}
	article code {
		padding: 1px 5px;
		border-radius: 3px;
		background: var(--ox-input);
		color: var(--ox-syn-variable);
		font-size: 13.5px;
	}
	article pre {
		margin: 0 0 16px;
		padding: 12px 14px;
		border-radius: var(--ox-radius);
		background: var(--ox-input);
		color: var(--ox-code-fg);
		font-size: 13.5px;
		line-height: 21px;
		overflow-x: auto;
	}
	article strong {
		font-weight: 600;
		color: var(--ox-frost);
	}
	/* the names of things in the window */
	article em {
		font-style: italic;
		color: var(--ox-frost);
	}
	article a,
	.link {
		color: var(--ox-lox);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		cursor: pointer;
	}
	table {
		width: 100%;
		margin: 0 0 16px;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 7px 16px 7px 0;
		border-bottom: 1px solid var(--ox-rule);
		text-align: left;
		vertical-align: top;
	}
	th {
		color: var(--ox-haze);
		font-size: 13px;
		font-weight: 500;
	}
	.next {
		margin-top: 36px;
		height: 34px;
		padding: 0 14px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-frost);
		font-size: 14px;
		cursor: pointer;
	}
	.next:hover {
		background: var(--ox-hover);
	}
	@media (prefers-reduced-motion: reduce) {
		.scroll {
			scroll-behavior: auto;
		}
	}
</style>
