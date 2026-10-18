// Launches the built Electron app and checks: window opens, files passed on the command line open,
// outside edits to the file reach the open document, starting it again hands files to the running window,
// the game link menu is present.
//   node tools/desktop-test.mjs [--packaged apps/desktop/release/win-unpacked/Oxygen.exe]
import { _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

delete process.env.ELECTRON_RUN_AS_NODE;
const dir = mkdtempSync(join(tmpdir(), 'oxygen-desktop-'));
const file = join(dir, 'sparks.particle.json');
writeFileSync(file, readFileSync('apps/vscode/test/fixture/RP/particles/sparks.particle.json', 'utf8'));

let failures = 0;
const check = (ok, what) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) failures++;
};

const appDir = resolve('apps/desktop');
// the packaged app (electron-builder output) instead of the development build
const packaged = process.argv.includes('--packaged') ? resolve(process.argv[process.argv.indexOf('--packaged') + 1]) : null;
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '0', OXYGEN_USER_DATA: join(dir, 'profile') };
const launch = (files) =>
	electron.launch({
		...(packaged ? { executablePath: packaged, args: files } : { args: [appDir, ...files] }),
		cwd: appDir,
		env,
	});
if (packaged) console.log(`info testing ${packaged}`);
const app = await launch([file]);
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.waitForFunction(() => window.oxygen?.active?.file.name === 'sparks.particle.json', null, { timeout: 20000 });
check(true, 'the file passed on the command line opens');
check((await page.locator('button:has-text("Game")').count()) > 0, 'the game link menu is available');

const before = await page.evaluate(() => window.oxygen.active.doc.get('particle_effect/components/minecraft:emitter_rate_steady/spawn_rate'));
writeFileSync(file, readFileSync(file, 'utf8').replace('"spawn_rate": 10', '"spawn_rate": 77'));
await page.waitForFunction(() => window.oxygen.active.doc.get('particle_effect/components/minecraft:emitter_rate_steady/spawn_rate') === 77, null, { timeout: 10000 }).catch(() => {});
const after = await page.evaluate(() => window.oxygen.active.doc.get('particle_effect/components/minecraft:emitter_rate_steady/spawn_rate'));
check(before === 10 && after === 77, `editing the file on disk updates the open document (${before} → ${after})`);
const dirty = await page.evaluate(() => window.oxygen.active.dirty);
check(dirty === false, 'a file changed on disk without local edits stays clean');

// started again with another file while it runs, Oxygen hands the file to the open window and quits
const second = join(dir, 'second.particle.json');
writeFileSync(second, readFileSync(file, 'utf8').replace(/"identifier":\s*"[^"]+"/, '"identifier": "test:second"'));
const binary = packaged ?? createRequire(join(appDir, 'package.json'))('electron');
const handedOver = await promisify(execFile)(binary, packaged ? [second] : [appDir, second], { cwd: appDir, env, timeout: 20000 }).then(
	() => true,
	() => false,
);
await page.waitForFunction(() => window.oxygen?.active?.file.name === 'second.particle.json', null, { timeout: 10000 }).catch(() => {});
const tabs = await page.evaluate(() => window.oxygen.sessions.map((s) => s.file.name));
check(handedOver && tabs.length === 2 && tabs.includes('second.particle.json'), `starting Oxygen again with a file opens it in the running window (${tabs.join(', ')})`);
await page.evaluate(() => window.oxygen.close(window.oxygen.active.id));

await page.waitForTimeout(800);
await page.screenshot({ path: 'test-results/ui/desktop.png' });
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

// closing the last tab shows the start screen, with the file under Recent
await page.evaluate(() => window.oxygen.close(window.oxygen.active.id));
await page.waitForSelector('.start', { timeout: 5000 }).catch(() => {});
check((await page.locator('.start').count()) === 1, 'with nothing open, the start screen shows');
await page.waitForSelector('.start .item:has-text("sparks.particle.json")', { timeout: 5000 }).catch(() => {});
check((await page.locator('.start .item:has-text("sparks.particle.json")').count()) === 1, 'the file is listed under Recent');
await page.screenshot({ path: 'test-results/ui/desktop-start.png' });
await app.close();

// a restart restores what was open (nothing here), not every file ever opened
const again = await launch([]);
const page2 = await again.firstWindow();
await page2.waitForSelector('.start', { timeout: 20000 }).catch(() => {});
const open = await page2.evaluate(() => window.oxygen?.sessions.length ?? -1);
check(open === 0, `a restart doesn't reopen the closed tab (${open} open)`);
await page2.locator('.start .item:has-text("sparks.particle.json")').click();
await page2.waitForFunction(() => window.oxygen?.active?.file.name === 'sparks.particle.json', null, { timeout: 5000 }).catch(() => {});
check((await page2.evaluate(() => window.oxygen?.active?.file.name)) === 'sparks.particle.json', 'clicking a recent file opens it');

// Settings: the native menu shows the keys bound in Oxygen, and opens Settings and About
const menuItem = (top, label) =>
	again.evaluate(({ Menu }, [top, label]) => {
		const item = Menu.getApplicationMenu()?.items.find((i) => i.label === top)?.submenu?.items.find((i) => i.label === label);
		return item ? { accelerator: item.accelerator ?? null } : null;
	}, [top, label]);
check((await menuItem('File', 'Save'))?.accelerator === 'CmdOrCtrl+S', 'the native menu shows Save on Ctrl+S');
await page2.evaluate(() => (window.oxygen.prefs.keys = { 'file.save': ['Mod+Alt+S'], 'app.settings': [] }));
await page2.waitForTimeout(300);
const rebound = [await menuItem('File', 'Save'), await menuItem('File', 'Settings…')];
check(rebound[0]?.accelerator === 'CmdOrCtrl+Alt+S' && rebound[1] && !rebound[1].accelerator, `the native menu follows rebound keys (${JSON.stringify(rebound)})`);
await again.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'Settings…').click());
await page2.waitForFunction(() => window.oxygen.settingsOpen, null, { timeout: 3000 }).catch(() => {});
check(await page2.evaluate(() => window.oxygen.settingsOpen), 'File › Settings… opens Settings');
await again.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'Help').submenu.items.find((i) => i.label === 'About Oxygen').click());
await page2.waitForFunction(() => window.oxygen.aboutOpen, null, { timeout: 3000 }).catch(() => {});
const about = await page2.evaluate(() => window.oxygen.host.about());
check(await page2.evaluate(() => window.oxygen.aboutOpen) && about.some((f) => f.label === 'Electron' && /^\d+\./.test(f.value)), `Help › About opens About, which knows the Electron version (${about.find((f) => f.label === 'Electron')?.value})`);
await page2.evaluate(() => (window.oxygen.aboutOpen = false));
// interface zoom (desktop only) zooms the whole window, and preferences land in settings.json
const dpr = await page2.evaluate(() => window.devicePixelRatio);
await page2.evaluate(() => (window.oxygen.prefs.zoom = 1.25));
await page2.waitForTimeout(600);
const zoomed = await page2.evaluate(() => window.devicePixelRatio);
check(Math.abs(zoomed / dpr - 1.25) < 0.01, `interface zoom 125% zooms the window (${dpr} → ${zoomed} device pixels per CSS pixel)`);
const stored = JSON.parse(readFileSync(join(dir, 'profile', 'settings.json'), 'utf8')).ui?.preferences;
check(stored?.zoom === 1.25 && stored?.keys?.['file.save']?.[0] === 'Mod+Alt+S', 'preferences are kept in settings.json');
await page2.evaluate(() => {
	window.oxygen.prefs.zoom = 1;
	window.oxygen.prefs.keys = {};
});
// updates: a development build says it doesn't update (tools/update-test.mjs checks a packaged one)
await page2.evaluate(() => window.oxygen.checkForUpdates());
await page2.waitForFunction(() => window.oxygen.update.state === 'unsupported', null, { timeout: 5000 }).catch(() => {});
check((await page2.evaluate(() => window.oxygen.update.state)) === 'unsupported', 'Help › Check for updates in a development build says updates come with the installed app');
await page2.waitForTimeout(300);

// baseline: a light effect, to tell the display's refresh cap from the cost of the heavy scene below
await page2.waitForTimeout(2500);
const baseFps = await page2.evaluate(() => Number(document.querySelector('[data-fps]')?.getAttribute('data-fps') ?? 0));
console.log(`info a light effect renders at ${baseFps} fps`);

// heavy scenes spread independent emitters over worker threads (the desktop CSP allows them)
const heavy = {
	format_version: '1.10.0',
	particle_effect: {
		description: { identifier: 'bench:heavy', basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' } },
		components: {
			'minecraft:emitter_rate_instant': { num_particles: 8000 },
			'minecraft:emitter_lifetime_once': { active_time: 100 },
			'minecraft:particle_lifetime_expression': { max_lifetime: 100 },
			'minecraft:particle_motion_parametric': { relative_position: ['math.cos(v.particle_age * 90 + v.particle_random_1 * 360) * 3', 'v.particle_random_2', 'math.sin(v.particle_age * 90 + v.particle_random_1 * 360) * 3'] },
			'minecraft:particle_appearance_billboard': { size: [0.05, 0.05], facing_camera_mode: 'rotate_xyz' },
		},
	},
};
await page2.evaluate((text) => window.oxygen.open({ file: { name: 'heavy.particle.json', id: null }, text }), JSON.stringify(heavy));
await page2.evaluate(() => {
	const s = window.oxygen.active;
	s.setSpawnMode('entity');
	for (let i = 0; i < 3; i++) s.spawn();
});
await page2.waitForFunction(() => window.oxygen.active.parallel.engaged, null, { timeout: 10000 }).catch(() => {});
const par = await page2.evaluate(() => ({ engaged: window.oxygen.active.parallel.engaged, unavailable: window.oxygen.active.parallel.unavailable, remote: window.oxygen.active.parallel.remote.size }));
check(par.engaged && par.remote > 1, `independent emitters run on worker threads (${JSON.stringify(par)})`);
// the real GPU draws every particle (Electron): read the viewport's frame rate once it settles
await page2.waitForTimeout(3000);
const fps = await page2.evaluate(() => Number(document.querySelector('[data-fps]')?.getAttribute('data-fps') ?? 0));
check(fps >= 55, `32,000 particles render at ${fps} fps (display refresh caps it)`);
await page2.evaluate(() => (window.oxygen.active.playing = false));
await page2.waitForFunction(() => !window.oxygen.active.parallel.engaged, null, { timeout: 10000 }).catch(() => {});
const back = await page2.evaluate(() => ({ local: window.oxygen.active.world.emitters.length, particles: window.oxygen.active.world.particleCount }));
check(back.local === 4 && back.particles === 32000, `pausing brings them back (${JSON.stringify(back)})`);

// an example's child effects are the other examples: the finale's rockets burst
const finale = readFileSync(new URL('../packages/ui/static/examples/finale_launcher.particle.json', import.meta.url), 'utf8');
await page2.evaluate((text) => {
	for (const s of [...window.oxygen.sessions]) window.oxygen.close(s.id);
	window.oxygen.open({ file: { name: 'finale_launcher.particle.json', id: 'example:finale_launcher' }, text });
}, finale);
await page2.waitForTimeout(3000);
const spawned = await page2.evaluate(() => [...new Set(window.oxygen.active.world.emitters.map((e) => e.def.identifier))].sort());
check(spawned.includes('oxygen:finale_rocket') && spawned.includes('oxygen:finale_burst'), `an example's child effects play (${spawned.join(', ')})`);
await again.close();
process.exit(failures ? 1 : 0);
