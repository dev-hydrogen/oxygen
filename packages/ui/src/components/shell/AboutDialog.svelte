<script lang="ts">
	import type { AboutSection, Workspace } from '../../state/workspace.svelte';
	import { CREDITS, DISCORD, HOSTS, MCP_PROMPT, MCP_ZIP, REPO, VERSION, WEBSITE, engineFacts, factsText, systemFacts, type Fact } from '../../lib/about';
	import { releases, type Inline } from '../../lib/markdown';
	import changelog from '../../../../../CHANGELOG.md?raw';
	import logoDark from '../../assets/logo-dark.png?inline';
	import logoLight from '../../assets/logo-light.png?inline';

	/** About Oxygen: the program, what's new, the engine, where it runs, and who made what it's built on */
	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();

	const SECTIONS: { id: AboutSection; label: string }[] = [
		{ id: 'about', label: 'Oxygen' },
		{ id: 'new', label: 'What’s new' },
		{ id: 'agents', label: 'Coding agents' },
		{ id: 'engine', label: 'Engine' },
		{ id: 'system', label: 'System' },
		{ id: 'credits', label: 'Credits' },
	];

	const section = $derived(workspace.aboutSection);
	const notes = releases(changelog);
	const engine = engineFacts();
	let system = $state<Fact[] | null>(null);
	let copied = $state(false);
	let promptCopied = $state(false);

	async function copyPrompt() {
		await navigator.clipboard.writeText(MCP_PROMPT);
		promptCopied = true;
		setTimeout(() => (promptCopied = false), 2000);
	}

	$effect(() => {
		if (workspace.aboutOpen && section === 'system' && !system) void systemFacts(workspace.host).then((f) => (system = f));
	});

	const close = () => (workspace.aboutOpen = false);

	async function copyReport() {
		const sys = system ?? (await systemFacts(workspace.host));
		await navigator.clipboard.writeText(`${factsText('Oxygen', sys)}\n\n${factsText('Engine', engine)}\n`);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	/** links in the changelog point into the repository when they're relative */
	const href = (h: string) => (/^[a-z]+:/i.test(h) ? h : `${REPO}/blob/main/${h.replace(/^\.\//, '')}`);
</script>

<svelte:window onkeydown={(e) => workspace.aboutOpen && e.key === 'Escape' && close()} />

{#snippet inline(parts: Inline[])}{#each parts as p, i (i)}{#if p.kind === 'code'}<code>{p.text}</code>{:else if p.kind === 'bold'}<strong>{p.text}</strong>{:else if p.kind === 'link'}<a href={href(p.href)} target="_blank" rel="noreferrer">{p.text}</a>{:else}{p.text}{/if}{/each}{/snippet}

{#snippet facts(list: Fact[])}
	<dl>
		{#each list as f (f.label)}
			<dt>{f.label}</dt>
			<dd>{#if f.href}<a href={f.href} target="_blank" rel="noreferrer">{f.value}</a>{:else}{f.value}{/if}</dd>
		{/each}
	</dl>
{/snippet}

{#if workspace.aboutOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={close}></div>
	<div class="dialog" role="dialog" aria-modal="true" aria-label="About Oxygen">
		<div class="top">
			<div class="tabs" role="tablist" aria-label="About">
				{#each SECTIONS as s (s.id)}
					<button role="tab" aria-selected={section === s.id} class:on={section === s.id} onclick={() => (workspace.aboutSection = s.id)}>{s.label}</button>
				{/each}
			</div>
			<button class="x" aria-label="Close" onclick={close}>×</button>
		</div>
		<div class="scroll">
			{#if section === 'about'}
				<div class="hero">
					<img class="logo dark" src={logoDark} alt="Oxygen" />
					<img class="logo light" src={logoLight} alt="Oxygen" />
					<p class="version ox-num">Version {VERSION} · {HOSTS[workspace.host.kind]}</p>
					{#if workspace.host.updates && workspace.host.kind !== 'web'}
						{@const u = workspace.update}
						<p class="updates">
							{#if u.state === 'checking'}Checking for updates…
							{:else if u.state === 'current'}Up to date.
							{:else if u.state === 'available' && u.page}Oxygen {u.version} is out. <a href={u.page} target="_blank" rel="noreferrer">Download it</a>
							{:else if u.state === 'available'}Oxygen {u.version} is out. <button class="inline" onclick={() => workspace.host.updates?.download?.()}>Download it</button>
							{:else if u.state === 'downloading'}Downloading Oxygen {u.version}: {u.percent}%
							{:else if u.state === 'ready'}Oxygen {u.version} is ready. <button class="inline" onclick={() => workspace.installUpdate()}>Restart to update</button>
							{:else if u.state === 'error'}{u.message}
							{:else if u.state === 'unsupported'}{u.reason}{/if}
							{#if u.state !== 'checking' && u.state !== 'downloading' && u.state !== 'ready'}<button class="inline" onclick={() => void workspace.checkForUpdates()}>Check for updates</button>{/if}
						</p>
					{/if}
					<p class="pitch">An editor for Minecraft Bedrock particle effects whose preview behaves the way the game does, quirks included: what you see while you work is what players will see.</p>
				</div>
				<div class="links">
					<a class="link" href={WEBSITE} target="_blank" rel="noreferrer">Web app</a>
					<a class="link" href={REPO} target="_blank" rel="noreferrer">Source code</a>
					<a class="link" href={`${REPO}/blob/main/docs/guide.md`} target="_blank" rel="noreferrer">Guide</a>
					<a class="link" href={`${REPO}/blob/main/docs/accuracy.md`} target="_blank" rel="noreferrer">How it matches the game</a>
					<button class="link" onclick={() => (workspace.aboutSection = 'agents')}>For coding agents (MCP)</button>
					<a class="link" href={`${REPO}/issues/new`} target="_blank" rel="noreferrer">Report a problem</a>
					<a class="link" href={DISCORD} target="_blank" rel="noreferrer">Discord</a>
				</div>
				<p class="small">
					A ground-up rewrite of <a href="https://github.com/JannisX11/snowstorm" target="_blank" rel="noreferrer">Snowstorm</a> by JannisX11. Made by
					<a href="https://github.com/dev-hydrogen" target="_blank" rel="noreferrer">Hydrogen</a>. Licensed under the
					<a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">GPL-3.0</a> or later, like Snowstorm; the engine forks keep their own (MIT) licenses. Not an official Minecraft product; not approved by or associated with Mojang or Microsoft.
				</p>
				<div class="actions">
					<button class="btn" onclick={() => (workspace.aboutSection = 'new')}>What’s new in {VERSION}</button>
					<button class="btn" onclick={() => workspace.openSettings()}>Settings…</button>
					<button class="btn" onclick={() => ((workspace.aboutOpen = false), (workspace.shortcutsOpen = true))}>Keyboard shortcuts</button>
				</div>
			{:else if section === 'new'}
				{#each notes as r, i (r.title)}
					<details class="release" open={i === 0}>
						<summary>{r.title}</summary>
						{#each r.blocks as b, k (k)}
							{#if b.kind === 'heading'}<h5>{@render inline(b.text)}</h5>
							{:else if b.kind === 'paragraph'}<p>{@render inline(b.text)}</p>
							{:else}<ul>{#each b.items as item, j (j)}<li>{@render inline(item)}</li>{/each}</ul>{/if}
						{/each}
					</details>
				{/each}
				<a class="small" href={`${REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer">The changelog on GitHub</a>
			{:else if section === 'agents'}
				<p class="lede">
					Oxygen’s MCP server lets coding agents such as Claude Code and Codex create particle effects, check them, simulate them and look at them with the same engine as this editor, and debug how every Molang expression is evaluated.
				</p>
				<p class="small">Copy this prompt into your agent: it downloads the server, installs it and adds it to itself. You need Node.js 22 or newer. Paste it again later to update.</p>
				<pre class="prompt">{MCP_PROMPT}</pre>
				<div class="actions">
					<button class="btn primary" onclick={copyPrompt}>{promptCopied ? 'Copied' : 'Copy the prompt'}</button>
					<a class="btn" href={MCP_ZIP} target="_blank" rel="noreferrer">Download the server</a>
					<a class="btn" href={`${REPO}/blob/main/docs/agents.md`} target="_blank" rel="noreferrer">Setting it up by hand, and every tool</a>
				</div>
			{:else if section === 'engine'}
				<p class="lede">The preview runs Oxygen’s own forks of Snowstorm’s engine and Molang interpreter, changed behaviour by behaviour to match measurements made in the game.</p>
				{@render facts(engine)}
				<p class="small"><a href={`${REPO}/blob/main/docs/accuracy.md`} target="_blank" rel="noreferrer">What was measured, and what's still approximate</a></p>
			{:else if section === 'system'}
				<p class="lede">Where this Oxygen runs. Copy it into a bug report.</p>
				{#if system}{@render facts(system)}{:else}<p class="small">Looking…</p>{/if}
				<div class="actions">
					<button class="btn" onclick={copyReport}>{copied ? 'Copied' : 'Copy for a bug report'}</button>
					<a class="btn" href={`${REPO}/issues/new`} target="_blank" rel="noreferrer">Report a problem</a>
				</div>
			{:else if section === 'credits'}
				<p class="lede">Oxygen is built on the work of others.</p>
				<ul class="credits">
					{#each CREDITS as c (c.name)}
						<li>
							<a href={c.href} target="_blank" rel="noreferrer">{c.name}</a>
							<span class="what">{c.what}</span>
							{#if c.license}<span class="license">{c.license}</span>{/if}
						</li>
					{/each}
				</ul>
				<p class="small">Minecraft is a trademark of Mojang Synergies AB. Vanilla particle textures in previews come from the game’s resource pack.</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: rgba(10, 12, 20, 0.45);
	}
	.dialog {
		position: fixed;
		z-index: 901;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(720px, calc(100vw - 32px));
		height: min(600px, calc(100vh - 64px));
		display: flex;
		flex-direction: column;
		background: var(--ox-float);
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius-float);
		box-shadow: var(--ox-float-shadow);
		overflow: hidden;
	}
	.top {
		display: flex;
		align-items: stretch;
		height: 40px;
		padding: 0 12px 0 8px;
		border-bottom: 1px solid var(--ox-rule);
		flex: none;
	}
	.tabs {
		display: flex;
	}
	.tabs button {
		padding: 0 12px;
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
	}
	.tabs button:hover {
		color: var(--ox-frost);
	}
	.tabs button.on {
		color: var(--ox-frost);
		border-bottom-color: var(--ox-lox);
	}
	.x {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--ox-haze);
		font-size: 18px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ox-frost);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 18px 24px 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		text-align: center;
		padding: 8px 0 4px;
	}
	.logo {
		height: 64px;
		width: auto;
	}
	.logo.light,
	:global(body.ox-follow-vscode.vscode-light) .logo.dark {
		display: none;
	}
	:global(body.ox-follow-vscode.vscode-light) .logo.light {
		display: block;
	}
	.version {
		margin: 0;
		color: var(--ox-lox);
	}
	.updates {
		margin: 0;
		font-size: 11.5px;
		color: var(--ox-haze);
	}
	.inline {
		border: none;
		background: none;
		padding: 0 0 0 4px;
		color: var(--ox-lox);
		text-decoration: underline;
		cursor: pointer;
		font-size: inherit;
	}
	.pitch {
		margin: 4px 0 0;
		max-width: 520px;
		color: var(--ox-frost);
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: center;
	}
	.link,
	.btn {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 12px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-frost);
		text-decoration: none;
		cursor: pointer;
	}
	.link:hover,
	.btn:hover {
		background: var(--ox-hover);
	}
	.btn.primary {
		background: var(--ox-lox);
		border-color: var(--ox-lox);
		color: #10131c;
		font-weight: 600;
	}
	.btn.primary:hover {
		background: #a6c9f7;
	}
	.prompt {
		margin: 0;
		padding: 10px 12px;
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius-float);
		background: var(--ox-input);
		font-family: var(--ox-font-code);
		font-variation-settings: 'MONO' 1;
		font-size: 11.5px;
		line-height: 17px;
		white-space: pre-wrap;
		word-break: break-word;
		user-select: text;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.small,
	.lede {
		margin: 0;
		color: var(--ox-haze);
	}
	.small {
		font-size: 11.5px;
	}
	a {
		color: var(--ox-lox);
	}
	.release {
		border: 1px solid var(--ox-rule);
		border-radius: var(--ox-radius-float);
		padding: 8px 14px;
		background: var(--ox-panel);
	}
	summary {
		cursor: pointer;
		font-weight: 600;
		padding: 2px 0;
	}
	h5 {
		margin: 12px 0 4px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ox-haze);
	}
	.release p {
		margin: 6px 0;
	}
	ul {
		margin: 4px 0;
		padding-left: 18px;
	}
	li {
		margin: 4px 0;
	}
	code {
		font-family: var(--ox-font-code);
		font-variation-settings: 'MONO' 1;
		font-size: 0.95em;
		padding: 0 3px;
		border-radius: 3px;
		background: var(--ox-input);
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: 170px 1fr;
		gap: 6px 14px;
	}
	dt {
		color: var(--ox-haze);
	}
	dd {
		margin: 0;
		word-break: break-word;
	}
	.credits {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.credits li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		margin: 0;
	}
	.credits a {
		min-width: 110px;
	}
	.what {
		flex: 1;
		color: var(--ox-frost);
	}
	.license {
		font-size: 11px;
		color: var(--ox-text-dim);
	}
</style>
