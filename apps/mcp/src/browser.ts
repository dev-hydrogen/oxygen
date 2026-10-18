import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { BUNDLED, packRoot, packText, textureFile } from './pack';
import type { RunRequest, RunResult } from './protocol';

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.json': 'application/json',
};

/** a run that takes longer than this is stuck: the browser is restarted */
const RUN_TIMEOUT_MS = 180_000;

/**
 * Oxygen's viewport in headless Chromium (software WebGL), fed by a local server that hands it the preview page
 * and the files of the effect's pack. Started on first use and kept for later calls; runs one request at a time.
 */
export class PreviewBrowser {
	private server: Server | null = null;
	private browser: Browser | null = null;
	private page: Promise<Page> | null = null;
	private queue: Promise<unknown> = Promise.resolve();
	/** errors the page logged during the current run */
	private pageErrors: string[] = [];

	run(request: RunRequest): Promise<RunResult & { pageErrors: string[] }> {
		const next = this.queue.then(() => this.runNow(request));
		this.queue = next.catch(() => undefined);
		return next;
	}

	private async runNow(request: RunRequest): Promise<RunResult & { pageErrors: string[] }> {
		const page = await this.open();
		this.pageErrors = [];
		const { promise: timeout, reject } = Promise.withResolvers<never>();
		const timer = setTimeout(() => reject(new Error(`The preview took longer than ${RUN_TIMEOUT_MS / 1000} s; try fewer or earlier sample times.`)), RUN_TIMEOUT_MS);
		try {
			const result = await Promise.race([page.evaluate((r) => window.oxygenPreview.run(r), request), timeout]);
			return { ...result, pageErrors: [...this.pageErrors] };
		} catch (e) {
			// a stuck, crashed or half-finished page is replaced on the next call
			await this.close();
			// page.evaluate prefixes the page's error and appends the page's stack: keep the message
			const message = e instanceof Error ? e.message : String(e);
			throw new Error(message.replace(/^page\.evaluate: (Error: )?/, '').split('\n    at ')[0]);
		} finally {
			clearTimeout(timer);
		}
	}

	private open(): Promise<Page> {
		this.page ??= this.start().catch((e) => {
			this.page = null;
			throw e;
		});
		return this.page;
	}

	private async start(): Promise<Page> {
		const index = join(BUNDLED.preview, 'index.html');
		if (!existsSync(index)) throw new Error(`The preview page isn't built (${index} is missing): run \`pnpm --filter @oxygen/mcp build\`.`);
		const root = resolve(BUNDLED.preview);
		const server = createServer((req, res) => {
			const url = new URL(req.url ?? '/', 'http://localhost');
			const file = url.searchParams.get('file') ?? '';
			const path = url.searchParams.get('path') ?? '';
			if (url.pathname === '/api/texture') {
				const png = file ? textureFile(packRoot(file), path).png : null;
				if (png) res.writeHead(200, { 'content-type': 'image/png' }).end(readFileSync(png));
				else res.writeHead(404).end();
				return;
			}
			if (url.pathname === '/api/pack-text') {
				const text = file ? packText(packRoot(file), path) : null;
				if (text !== null) res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(text);
				else res.writeHead(404).end();
				return;
			}
			const target = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
			if (target.startsWith(root) && existsSync(target) && statSync(target).isFile()) res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' }).end(readFileSync(target));
			else res.writeHead(404).end();
		});
		const { promise: listening, resolve: ready } = Promise.withResolvers<void>();
		server.listen(0, '127.0.0.1', ready);
		await listening;
		this.server = server;
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('The preview server has no port');
		try {
			this.browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
		} catch (e) {
			await this.close();
			throw new Error(`Couldn't start headless Chromium for the preview. Install it with \`npx playwright install chromium\`.\n${e instanceof Error ? e.message : String(e)}`);
		}
		const page = await this.browser.newPage({ deviceScaleFactor: 1 });
		page.on('pageerror', (e) => this.pageErrors.push(e.message));
		page.on('console', (m) => {
			// pack files that aren't there (lighting, texture sets) are expected 404s, reported in their own terms
			if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) this.pageErrors.push(m.text());
		});
		page.on('crash', () => void this.close());
		await page.goto(`http://127.0.0.1:${address.port}/index.html`);
		await page.waitForFunction(() => !!window.oxygenPreview);
		return page;
	}

	async close(): Promise<void> {
		this.page = null;
		const browser = this.browser;
		const server = this.server;
		this.browser = null;
		this.server = null;
		await browser?.close().catch(() => undefined);
		server?.close();
	}
}
