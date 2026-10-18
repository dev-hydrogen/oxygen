import { COMPONENTS } from '@oxygen/format';
import { molangMetadata } from '@oxygen/metadata';
import type { Host } from '../host';
import ui from '../../package.json';
import wintersky from '../../../../vendor/wintersky/package.json';
import molangjs from '../../../../vendor/molangjs/package.json';

/** What the About dialog says about Oxygen */

export const VERSION = ui.version;
export const REPO = 'https://github.com/dev-hydrogen/oxygen';
export const WEBSITE = 'https://oxygen.hydrogen.exposed';
export const DISCORD = 'https://discord.gg/TEq6PNb25T';

export const HOSTS: Record<Host['kind'], string> = { web: 'Web app', vscode: 'VS Code extension', desktop: 'Desktop app' };

export interface Credit {
	name: string;
	what: string;
	license: string;
	href: string;
}

export const CREDITS: Credit[] = [
	{ name: 'Snowstorm', what: 'by JannisX11: the editor Oxygen is a rewrite of', license: 'GPL-3.0', href: 'https://github.com/JannisX11/snowstorm' },
	{ name: 'Wintersky', what: "by JannisX11: the particle engine, in Oxygen's fork checked against the game", license: 'MIT', href: 'https://github.com/JannisX11/wintersky' },
	{ name: 'MolangJS', what: "by JannisX11: the Molang interpreter, in Oxygen's fork", license: 'MIT', href: 'https://github.com/JannisX11/MolangJS' },
	{ name: 'bedrock-samples', what: "by Mojang: the query list, Molang functions and the particle schema", license: '', href: 'https://github.com/Mojang/bedrock-samples' },
	{ name: 'three.js', what: 'the 3D viewport', license: 'MIT', href: 'https://threejs.org' },
	{ name: 'Svelte', what: 'the interface', license: 'MIT', href: 'https://svelte.dev' },
	{ name: 'CodeMirror', what: 'the Molang and source editors', license: 'MIT', href: 'https://codemirror.net' },
	{ name: 'Dockview', what: 'the panel layout', license: 'MIT', href: 'https://dockview.dev' },
	{ name: 'fflate', what: 'share links', license: 'MIT', href: 'https://github.com/101arrowz/fflate' },
	{ name: 'jsonc-parser', what: 'by Microsoft: editing files without disturbing their formatting', license: 'MIT', href: 'https://github.com/microsoft/node-jsonc-parser' },
	{ name: 'Recursive', what: 'by Arrow Type: the typeface', license: 'OFL-1.1', href: 'https://www.recursive.design' },
	{ name: 'Electron', what: 'the desktop app', license: 'MIT', href: 'https://www.electronjs.org' },
];

export interface Fact {
	label: string;
	value: string;
	href?: string;
}

/** What the engine and the editor's knowledge are built from */
export function engineFacts(): Fact[] {
	const [repo, commit] = molangMetadata.source.split('@');
	return [
		{ label: 'Particle engine', value: `Wintersky ${wintersky.version} (Oxygen fork)`, href: 'https://github.com/dev-hydrogen/oxygen-wintersky' },
		{ label: 'Molang', value: `MolangJS ${molangjs.version} (Oxygen fork)` },
		{ label: 'Game data', value: `Minecraft ${molangMetadata.game}, from ${repo} at ${commit.slice(0, 7)}`, href: `https://github.com/${repo}/tree/${commit}` },
		{ label: 'Queries known', value: `${molangMetadata.queries.length}` },
		{ label: 'Math functions', value: `${molangMetadata.math.length}` },
		{ label: 'Components', value: `${COMPONENTS.length}` },
		{ label: 'Live particles per emitter', value: '1,000 when spawned by /particle or a script (measured in-game), 10,000 on an entity' },
	];
}

function gpu(): { renderer: string; webgl: string; maxTexture: string } {
	try {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
		if (!gl) return { renderer: 'none', webgl: 'not available', maxTexture: '–' };
		const info = gl.getExtension('WEBGL_debug_renderer_info');
		const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
		const out = { renderer, webgl: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL 1', maxTexture: `${gl.getParameter(gl.MAX_TEXTURE_SIZE)} px` };
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		return out;
	} catch {
		return { renderer: 'unknown', webgl: 'unknown', maxTexture: '–' };
	}
}

/** Where Oxygen runs: what a bug report needs */
export async function systemFacts(host: Host): Promise<Fact[]> {
	const g = gpu();
	const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
	const own = (await host.about?.().catch(() => [])) ?? [];
	const threads = nav.hardwareConcurrency ?? 0;
	return [
		{ label: 'Oxygen', value: `${VERSION} (${HOSTS[host.kind]})` },
		...own,
		{ label: 'Platform', value: nav.userAgentData?.platform || navigator.platform || 'unknown' },
		{ label: 'Browser', value: navigator.userAgent },
		{ label: 'Graphics', value: g.renderer },
		{ label: 'WebGL', value: `${g.webgl}, textures up to ${g.maxTexture}` },
		{ label: 'Screen', value: `${screen.width} × ${screen.height}, ${window.devicePixelRatio}× pixels` },
		{ label: 'Processor threads', value: threads ? `${threads} (the preview simulates big scenes on up to ${Math.max(1, Math.min(4, threads - 1))})` : 'unknown' },
		...(nav.deviceMemory ? [{ label: 'Memory', value: `about ${nav.deviceMemory} GB` }] : []),
		{ label: 'Language', value: navigator.language },
	];
}

export const factsText = (title: string, facts: Fact[]) => [title, ...facts.map((f) => `${f.label}: ${f.value}`)].join('\n');
