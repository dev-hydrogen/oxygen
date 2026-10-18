// Checks the desktop app's updates end to end, on the platform it runs on: packages the app, packages a newer
// version (0.99.0) as an update feed served from this machine, starts the packaged app pointed at that feed and
// checks it finds the update, downloads it (by itself, and when asked with automatic updates off) and offers
// to restart. It stops there: installing would replace the Oxygen installed on this machine.
//   node tools/update-test.mjs        (pnpm test:update)
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

delete process.env.ELECTRON_RUN_AS_NODE;
const desktop = resolve('apps/desktop');
const feedDir = resolve(desktop, 'release-update-test');
const NEWER = '0.99.0';
let failures = 0;
const check = (ok, what) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) failures++;
};

const builder = (args) => execFileSync(process.execPath, [resolve(desktop, 'node_modules/electron-builder/cli.js'), '--publish', 'never', ...args], { cwd: desktop, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });

// the app as it is (built as for a release, which gives the installed app its update settings), and the same app
// as a newer release
execFileSync(process.execPath, ['build.mjs'], { cwd: desktop, stdio: 'inherit' });
builder([]);
rmSync(feedDir, { recursive: true, force: true });
builder([`--config.directories.output=${feedDir}`, `--config.extraMetadata.version=${NEWER}`]);
const feedFile = { win32: 'latest.yml', linux: 'latest-linux.yml', darwin: 'latest-mac.yml' }[process.platform];
check(existsSync(join(feedDir, feedFile)), `the newer build writes ${feedFile}`);

const unpacked = { win32: 'release/win-unpacked/Oxygen.exe', linux: 'release/linux-unpacked/oxygen', darwin: 'release/mac-arm64/Oxygen.app/Contents/MacOS/Oxygen' }[process.platform];
const resources = { win32: 'release/win-unpacked/resources', linux: 'release/linux-unpacked/resources', darwin: 'release/mac-arm64/Oxygen.app/Contents/Resources' }[process.platform];
check(existsSync(resolve(desktop, resources, 'app-update.yml')), 'the packaged app knows where its updates come from (app-update.yml)');
const server = createServer((req, res) => {
	const file = join(feedDir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
	if (!file.startsWith(feedDir) || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end();
	res.writeHead(200, { 'content-length': statSync(file).size });
	createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feed = `http://127.0.0.1:${server.address().port}/`;

async function run(automatic) {
	const dir = mkdtempSync(join(tmpdir(), 'oxygen-update-'));
	mkdirSync(join(dir, 'profile'));
	writeFileSync(join(dir, 'profile', 'settings.json'), JSON.stringify({ ui: { preferences: { autoUpdate: automatic } } }));
	const app = await electron.launch({ executablePath: resolve(desktop, unpacked), env: { ...process.env, OXYGEN_USER_DATA: join(dir, 'profile'), OXYGEN_UPDATE_FEED: feed } });
	const page = await app.firstWindow();
	await page.waitForFunction(() => !!window.oxygen, null, { timeout: 20000 });
	// the first check runs a few seconds after the start
	await page.waitForFunction(() => ['available', 'downloading', 'ready', 'error'].includes(window.oxygen.update.state), null, { timeout: 60000 }).catch(() => {});
	if (!automatic) {
		const offered = await page.evaluate(() => JSON.parse(JSON.stringify(window.oxygen.update)));
		check(offered.state === 'available' && offered.version === NEWER, `with automatic updates off, ${NEWER} is offered, not downloaded (${JSON.stringify(offered)})`);
		await page.locator('footer .update').click();
	}
	await page.waitForFunction(() => ['ready', 'error'].includes(window.oxygen.update.state), null, { timeout: 180000 }).catch(() => {});
	const ready = await page.evaluate(() => JSON.parse(JSON.stringify(window.oxygen.update)));
	check(ready.state === 'ready' && ready.version === NEWER, `${automatic ? 'by itself' : 'when asked'}, ${NEWER} downloads and waits for a restart (${JSON.stringify(ready)})`);
	const label = await page.locator('footer .update').textContent().catch(() => null);
	check(label?.includes(`Restart to update to ${NEWER}`), `the status bar offers the restart ("${label?.trim()}")`);
	if (automatic) await page.screenshot({ path: 'test-results/ui/desktop-update.png' });
	await app.close();
	rmSync(dir, { recursive: true, force: true });
}

mkdirSync('test-results/ui', { recursive: true });
await run(true);
await run(false);
server.close();
// the download cache electron-updater keeps per app
const cache = { win32: join(process.env.LOCALAPPDATA ?? '', '@oxygendesktop-updater'), linux: join(homedir(), '.cache', '@oxygendesktop-updater'), darwin: join(homedir(), 'Library', 'Caches', '@oxygendesktop-updater') }[process.platform];
rmSync(cache, { recursive: true, force: true });
rmSync(feedDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
