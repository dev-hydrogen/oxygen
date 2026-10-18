import { mount, unmount } from 'svelte';
import App from './components/App.svelte';
import PreviewApp from './components/PreviewApp.svelte';
import type { Host } from './host';
import { Workspace } from './state/workspace.svelte';
import './styles/tokens.css';
import './styles/dockview.css';
import './styles/base.css';

export type { FileRef, Host, OpenedFile } from './host';
export { Workspace } from './state/workspace.svelte';
export { EffectSession } from './state/session.svelte';
export { readShareHash, shareLink } from './lib/share';
export { ViewportScene } from './viewport/scene';
export { DEFAULT_GIZMOS, type Gizmos } from './viewport/gizmos';
export { createMersProvider, createTextureProvider } from './lib/textures';

/**
 * Mount the Oxygen editor into an element. `mode: 'preview'` mounts only the viewport (for a file edited in
 * another editor). Returns the workspace (to open files) and a disposer.
 */
export function mountOxygen(target: HTMLElement, host: Host, options: { mode?: 'full' | 'preview' } = {}): { workspace: Workspace; destroy: () => void } {
	const workspace = new Workspace(host);
	const app = mount(options.mode === 'preview' ? PreviewApp : App, { target, props: { workspace } });
	return {
		workspace,
		destroy: () => unmount(app),
	};
}
