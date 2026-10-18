import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { existsSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { ConnectServer, deployHelper, deployPackDetailed, entryPath, findInstalls, latestContentLog, parseContentLog, particleSpawnCommand, readPack, scriptSpawnCommand } from '@oxygen/gamelink';
import { parentInputsFor, spawnsOf, type EffectSpawns } from '@oxygen/effect';
import type { DesktopFile, DesktopGameStatus, DesktopLogEntry } from './api';

// tests (and side-by-side profiles) can point Oxygen at its own settings folder
if (process.env.OXYGEN_USER_DATA) app.setPath('userData', process.env.OXYGEN_USER_DATA);
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
let settings: Record<string, unknown> = {};
let win: BrowserWindow | null = null;
let currentPack: string | null = null;

function loadSettings() {
	try {
		settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
	} catch {
		settings = {};
	}
}
function storeSettings() {
	try {
		writeFileSync(settingsFile(), JSON.stringify(settings, null, '\t'));
	} catch {
		// settings are a convenience; ignore write failures
	}
}

/** Resource pack root of a file: nearest folder above with manifest.json, else the parent of `particles/` */
function packRoot(file: string | null): string | null {
	// an example (`example:<name>`) isn't a file in any pack
	if (!file || file.startsWith('example:')) return currentPack;
	let dir = dirname(file);
	let particlesParent: string | null = null;
	for (let i = 0; i < 12; i++) {
		if (basename(dir) === 'particles') particlesParent ??= dirname(dir);
		if (existsSync(join(dir, 'manifest.json'))) return dir;
		const up = dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return particlesParent ?? currentPack;
}

function readDesktopFile(path: string): DesktopFile {
	return { path, name: basename(path), text: readFileSync(path, 'utf8') };
}

/** Particle files named on a command line, resolved against the folder it ran in */
function filesFromArgs(argv: string[], cwd: string): string[] {
	return argv
		.slice(app.isPackaged ? 1 : 2)
		.filter((a) => a.endsWith('.json'))
		.map((a) => resolve(cwd, a))
		.filter((a) => existsSync(a));
}

// ---- files opened from outside while Oxygen runs (a file manager, the command line, a coding agent)
/** files that arrived before the window asked for its start files */
let queued: string[] = [];
let rendererStarted = false;
function openRequested(paths: string[]) {
	if (!win) {
		queued.push(...paths);
		if (app.isReady()) createWindow();
		return;
	}
	// a window still loading picks the files up with its start files, and shows itself when ready
	if (!rendererStarted) {
		queued.push(...paths);
		return;
	}
	if (paths.length) win.webContents.send('openRequested', paths.map(readDesktopFile));
	if (win.isMinimized()) win.restore();
	win.show();
	if (process.platform === 'darwin') app.focus({ steal: true });
	else win.focus();
}

// ---- file watching: outside changes flow into the open document; our own saves are ignored
const watchers = new Map<string, FSWatcher>();
const lastText = new Map<string, string>();
function watchFile(path: string) {
	if (watchers.has(path)) return;
	try {
		lastText.set(path, readFileSync(path, 'utf8'));
		let timer: ReturnType<typeof setTimeout> | null = null;
		watchers.set(
			path,
			watch(path, () => {
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => {
					try {
						const text = readFileSync(path, 'utf8');
						if (text !== lastText.get(path)) {
							lastText.set(path, text);
							win?.webContents.send('externalChange', path, text);
						}
					} catch {
						// file removed or locked mid-write; the next event will retry
					}
				}, 120);
			}),
		);
	} catch {
		// unwatchable path (network drive): no outside-change sync
	}
}

// ---- effect lookup by identifier inside a pack
const effectIndex = new Map<string, Map<string, string>>();
function effectPath(root: string, identifier: string): string | null {
	let index = effectIndex.get(root);
	if (!index) {
		index = new Map();
		const walk = (dir: string, depth: number) => {
			if (depth > 6 || !existsSync(dir)) return;
			for (const f of readdirSync(dir)) {
				const p = join(dir, f);
				if (statSync(p).isDirectory()) walk(p, depth + 1);
				else if (f.endsWith('.json')) {
					const m = /"identifier"\s*:\s*"([^"]+)"/.exec(readFileSync(p, 'utf8'));
					if (m) index!.set(m[1], p);
				}
			}
		};
		walk(join(root, 'particles'), 0);
		effectIndex.set(root, index);
	}
	const p = index.get(identifier);
	return p && existsSync(p) ? p : null;
}
/** The bundled examples by identifier: what an example spawns is another example, as on the web */
const examplesDir = () => join(__dirname, 'examples');
let exampleIndex: Map<string, string> | null = null;
function examplePath(identifier: string): string | null {
	if (!exampleIndex) {
		exampleIndex = new Map();
		if (existsSync(examplesDir()))
			for (const f of readdirSync(examplesDir()).filter((f) => f.endsWith('.json'))) {
				const p = join(examplesDir(), f);
				const m = /"identifier"\s*:\s*"([^"]+)"/.exec(readFileSync(p, 'utf8'));
				if (m) exampleIndex.set(m[1], p);
			}
	}
	return exampleIndex.get(identifier) ?? null;
}
/** What the pack's effects (or, without a pack, the examples) set in their pre-effects for an effect they spawn */
function parentInputs(root: string | null, identifier: string): Record<string, string> {
	if (root) effectPath(root, identifier); // builds the index
	examplePath(identifier);
	const index: EffectSpawns[] = [];
	for (const p of [...(root ? (effectIndex.get(root)?.values() ?? []) : []), ...(exampleIndex?.values() ?? [])]) {
		try {
			const s = spawnsOf(JSON.parse(readFileSync(p, 'utf8')));
			if (s) index.push(s);
		} catch {
			// unreadable or not JSON: skip
		}
	}
	return parentInputsFor(index, identifier);
}
/** An effect from the pack, falling back to the examples */
function findEffect(root: string | null, identifier: string): string | null {
	const p = (root ? effectPath(root, identifier) : null) ?? examplePath(identifier);
	return p ? readFileSync(p, 'utf8') : null;
}

// ---- game link
const connect = new ConnectServer(19131);
const installs = findInstalls();
const gameStatus = (): DesktopGameStatus => ({ connected: connect.connected, port: connect.port, installs: installs.map((i) => i.name), error: connect.error });
connect.onStatus = () => win?.webContents.send('gameStatus', gameStatus());

const gameLog: DesktopLogEntry[] = [];
let logPath: string | null = null;
let logOffset = 0;
function pollContentLog() {
	const install = installs[0];
	if (!install) return;
	const latest = latestContentLog(install);
	if (!latest) return;
	if (latest !== logPath) {
		logPath = latest;
		// start at the end: only what happens while Oxygen is open
		logOffset = statSync(latest).size;
		return;
	}
	const size = statSync(latest).size;
	if (size <= logOffset) return;
	const text = readFileSync(latest).subarray(logOffset, size).toString('utf8');
	logOffset = size;
	const entries = parseContentLog(text).filter((e) => e.file);
	if (!entries.length) return;
	for (const e of entries) gameLog.push({ file: e.file, level: e.level, message: e.message, expression: e.expression, path: entryPath(e) });
	if (gameLog.length > 500) gameLog.splice(0, gameLog.length - 500);
	win?.webContents.send('gameLog', gameLog);
}

/** vanilla texture paths → the sprites wintersky bundles (dist/vanilla) */
const VANILLA_TEXTURES: Record<string, string> = {
	'textures/particle/particles': 'particles.png',
	'textures/particle/campfire_smoke': 'campfire_smoke.png',
	'textures/particle/soul': 'soul.png',
	'textures/flame_atlas': 'flame_atlas.png',
};

function registerIpc() {
	ipcMain.handle('openFiles', async () => {
		const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Particle effects', extensions: ['json'] }] });
		return r.canceled ? [] : r.filePaths.map(readDesktopFile);
	});
	ipcMain.handle('save', async (_e, path: string | null, name: string, text: string) => {
		let target = path;
		if (!target) {
			const r = await dialog.showSaveDialog(win!, { defaultPath: name, filters: [{ name: 'Particle effects', extensions: ['json'] }] });
			if (r.canceled || !r.filePath) return null;
			target = r.filePath;
		}
		lastText.set(target, text);
		writeFileSync(target, text);
		watchFile(target);
		return { path: target, name: basename(target) };
	});
	ipcMain.handle('openPack', async () => {
		const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Open a resource pack folder' });
		if (r.canceled || !r.filePaths[0]) return null;
		currentPack = r.filePaths[0];
		effectIndex.delete(currentPack);
		return currentPack;
	});
	ipcMain.handle('readTexture', (_e, file: string | null, texture: string) => {
		const root = packRoot(file) ?? '';
		if (!texture) return null;
		const base = texture.replace(/\.(png|tga)$/i, '');
		const png = join(root, `${base}.png`);
		if (existsSync(png)) return `data:image/png;base64,${readFileSync(png).toString('base64')}`;
		// vanilla paths the pack doesn't override: the sprites wintersky bundles
		// the vanilla sprites wintersky bundles, at the paths the game has them
		const bundled = VANILLA_TEXTURES[base];
		const vanilla = bundled ? join(__dirname, 'vanilla', bundled) : null;
		if (vanilla && existsSync(vanilla)) return `data:image/png;base64,${readFileSync(vanilla).toString('base64')}`;
		return null;
	});
	ipcMain.handle('saveTexture', (_e, file: string | null, texture: string, b64: string) => {
		const root = packRoot(file);
		if (!root) return false;
		writeFileSync(join(root, `${texture.replace(/\.(png|tga)$/i, '')}.png`), Buffer.from(b64, 'base64'));
		return true;
	});
	ipcMain.handle('readPackText', (_e, file: string | null, path: string) => {
		const root = packRoot(file);
		const p = root ? join(root, path) : null;
		return p && existsSync(p) ? readFileSync(p, 'utf8') : null;
	});
	ipcMain.handle('writePackText', (_e, file: string | null, path: string, text: string) => {
		const root = packRoot(file);
		if (!root) return false;
		writeFileSync(join(root, path), text);
		return true;
	});
	ipcMain.handle('findEffect', (_e, file: string | null, identifier: string) => findEffect(packRoot(file), identifier));
	ipcMain.handle('parentInputs', (_e, file: string | null, identifier: string) => parentInputs(packRoot(file), identifier));
	ipcMain.handle('openEffect', (_e, file: string | null, identifier: string): DesktopFile | null => {
		const root = packRoot(file);
		const p = root ? effectPath(root, identifier) : null;
		if (p) return readDesktopFile(p);
		// an example opens as an example (saving it asks where), not as a file inside the app
		const ex = examplePath(identifier);
		return ex ? { path: `example:${basename(ex).replace('.particle.json', '')}`, name: basename(ex), text: readFileSync(ex, 'utf8') } : null;
	});
	ipcMain.handle('examples', () => {
		const dir = join(__dirname, 'examples');
		if (!existsSync(dir)) return [];
		return readdirSync(dir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => ({ name: f.replace('.particle.json', ''), text: readFileSync(join(dir, f), 'utf8') }));
	});
	ipcMain.handle('openedAtStart', () => {
		rendererStarted = true;
		const args = [...filesFromArgs(process.argv, process.cwd()), ...queued];
		queued = [];
		// what was open when Oxygen last closed (closed tabs stay closed)
		const last = ((settings.openFiles as string[]) ?? []).filter((p) => existsSync(p));
		return [...new Set([...args, ...last])].map(readDesktopFile);
	});
	ipcMain.on('watch', (_e, path: string) => {
		watchFile(path);
		// most recently used first
		settings.recent = [path, ...((settings.recent as string[]) ?? []).filter((p) => p !== path)].slice(0, 12);
		storeSettings();
	});
	ipcMain.handle('recent', () => ((settings.recent as string[]) ?? []).filter((p) => existsSync(p)).map((path) => ({ path, name: basename(path), folder: dirname(path) })));
	ipcMain.handle('openPath', (_e, path: string) => (existsSync(path) ? readDesktopFile(path) : null));
	ipcMain.on('openSet', (_e, paths: string[]) => {
		settings.openFiles = paths;
		storeSettings();
	});
	ipcMain.handle('settings', () => settings.ui ?? {});
	ipcMain.on('menuKeys', (_e, keys: Record<string, string | null>) => {
		menuKeys = keys;
		buildMenu();
	});
	ipcMain.handle('about', () => ({ app: app.getVersion(), settings: settingsFile() }));
	ipcMain.on('saveSettings', (_e, s: Record<string, unknown>) => {
		settings.ui = s;
		storeSettings();
	});
	ipcMain.handle('gameStatus', () => gameStatus());
	ipcMain.handle('deploy', (_e, file: string | null) => {
		const root = packRoot(file);
		if (!root || !existsSync(join(root, 'manifest.json'))) throw new Error("This file isn't inside a resource pack with a manifest.json, so there's nothing to deploy.");
		const install = installs[0];
		if (!install) throw new Error('No Minecraft install found.');
		const pack = readPack(root);
		const { target, addedPbr } = deployPackDetailed(pack, install);
		// Oxygen Link: spawns with a variable map for scenarios (enable it once in the test world)
		deployHelper(install);
		return `Deployed “${pack.name}” to ${install.name} (${basename(dirname(target))}).${addedPbr ? ' Its manifest lacks the "pbr" capability, which turns Vibrant Visuals off in-game, so the deployed copy got it for testing. Add it to your manifest before you ship.' : ''}`;
	});
	ipcMain.handle('spawn', async (_e, identifier: string, variables?: Record<string, number | number[]>, offset?: [number, number, number]) => {
		if (variables && Object.keys(variables).length) {
			const r = await connect.command(scriptSpawnCommand(identifier, variables, offset));
			return `Spawned ${identifier} with ${Object.keys(variables).length} variable${Object.keys(variables).length === 1 ? '' : 's'} through Oxygen Link${r.statusMessage ? ` (${r.statusMessage})` : ''}. If nothing appears, turn on the Oxygen Link behavior pack for this world (Edit world → Behavior packs).`;
		}
		const r = await connect.command(particleSpawnCommand(identifier, offset));
		return r.statusMessage || `Spawned ${identifier}`;
	});
	ipcMain.handle('command', async (_e, line: string) => {
		const r = await connect.command(line);
		return r.statusMessage || `Ran /${line}`;
	});
}

/** the keys the app has bound to the menu's commands (Settings › Keyboard), as accelerators */
let menuKeys: Record<string, string | null> = {
	new: 'CmdOrCtrl+Alt+N',
	open: 'CmdOrCtrl+O',
	openPack: null,
	save: 'CmdOrCtrl+S',
	palette: 'CmdOrCtrl+K',
	settings: 'CmdOrCtrl+,',
	about: null,
};

function buildMenu() {
	const send = (cmd: string) => () => win?.webContents.send('menu', cmd);
	// the app handles its keys itself; the menu shows the same ones, and answers them when the app lets one through
	const item = (label: string, cmd: string): MenuItemConstructorOptions => ({ label, click: send(cmd), ...(menuKeys[cmd] ? { accelerator: menuKeys[cmd]! } : {}) });
	const template: MenuItemConstructorOptions[] = [
		{
			label: 'File',
			submenu: [
				item('New effect', 'new'),
				item('Open…', 'open'),
				item('Open resource pack folder…', 'openPack'),
				{ type: 'separator' },
				item('Save', 'save'),
				{ type: 'separator' },
				item('Settings…', 'settings'),
				{ type: 'separator' },
				{ role: 'quit' },
			],
		},
		{ label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
		{ label: 'View', submenu: [item('Commands…', 'palette'), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
		{ label: 'Help', submenu: [{ label: 'Bedrock particle documentation', click: () => void shell.openExternal('https://learn.microsoft.com/minecraft/creator/documents/particleeffects') }, { type: 'separator' }, item('About Oxygen', 'about')] },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
	rendererStarted = false;
	win = new BrowserWindow({
		width: 1480,
		height: 940,
		minWidth: 900,
		minHeight: 600,
		backgroundColor: '#1a1e2c',
		title: 'Oxygen',
		show: false,
		// the app's own top row is the title bar: the window buttons draw over its right end (macOS: its left end)
		titleBarStyle: 'hidden',
		titleBarOverlay: process.platform === 'darwin' ? true : { color: '#1a1e2c', symbolColor: '#dfe5f0', height: 32 },
		trafficLightPosition: { x: 12, y: 9 },
		webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
	});
	// the app draws its own menu bar; the native one stays (macOS shows it, elsewhere it only provides the shortcuts)
	if (process.platform !== 'darwin') win.setMenuBarVisibility(false);
	win.once('ready-to-show', () => win?.show());
	void win.loadFile(join(__dirname, 'renderer', 'index.html'));
	win.on('closed', () => (win = null));
}

// one Oxygen at a time: started again (with files or not), it hands its command line to the running app and quits
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on('second-instance', (_e, argv, cwd) => openRequested(filesFromArgs(argv, cwd)));
	// macOS hands files over by event (Finder, `open -a Oxygen file`), at launch before the app is ready too
	app.on('open-file', (e, path) => {
		e.preventDefault();
		openRequested([path]);
	});
	app.whenReady().then(() => {
		loadSettings();
		registerIpc();
		buildMenu();
		// a taken port moves on to the next free one; the Game menu shows which (or why none)
		void connect.start().then(() => win?.webContents.send('gameStatus', gameStatus()));
		setInterval(pollContentLog, 1500);
		if (!win) createWindow();
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on('window-all-closed', () => {
		connect.stop();
		if (process.platform !== 'darwin') app.quit();
	});
}
