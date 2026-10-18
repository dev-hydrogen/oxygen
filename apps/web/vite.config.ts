import { cloudflare } from '@cloudflare/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** The page says which Oxygen it is, so an open tab can tell a newer deploy apart (src/updates.ts) */
const version: Plugin = {
	name: 'oxygen-version',
	transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'oxygen-version', content: JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version }, injectTo: 'head' }],
};

export default defineConfig(({ mode }) => ({
	// the Cloudflare build (`cf deploy --mode cloudflare`) adds the plugin; a plain build stays a folder of files
	plugins: [svelte(), version, ...(mode === 'cloudflare' ? [cloudflare()] : [])],
	// relative asset paths: the app works from any folder (GitHub Pages serves it under /<repo>/)
	base: './',
	// strictPort: say "port in use" rather than falling back to 5179+, which Windows often reserves (Hyper-V/WSL)
	server: { port: 5178, strictPort: true, fs: { allow: ['../..'] } },
	build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
	optimizeDeps: { exclude: ['@oxygen/ui'] },
}));
