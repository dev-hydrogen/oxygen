// Updating the desktop app from GitHub Releases. Windows and Linux (the AppImage) download a new version in the
// background and install it on restart (electron-updater, reading the latest.yml files the release carries).
// macOS can only install signed apps, so there it checks the latest release and says where to get it.
import { app, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { DesktopUpdateState } from './api';

const REPO = 'dev-hydrogen/oxygen';
/** how often to look again while Oxygen stays open */
const EVERY = 4 * 60 * 60 * 1000;

let state: DesktopUpdateState = { state: 'idle' };
let send: (s: DesktopUpdateState) => void = () => {};
let automatic = true;
let started = false;

function set(s: DesktopUpdateState) {
	state = s;
	send(s);
}

/** 0.10.0 > 0.9.2; a pre-release (0.3.0-beta) never counts as newer */
export function newer(candidate: string, than: string): boolean {
	const parse = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()) ?? []).slice(1).map(Number);
	const a = parse(candidate);
	const b = parse(than);
	if (a.length !== 3 || b.length !== 3) return false;
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/** this copy installs its updates itself, or only learns about them */
function installs(): boolean {
	if (process.env.OXYGEN_UPDATE_FEED) return true;
	if (!app.isPackaged) return false;
	if (process.platform === 'win32') return true;
	// an AppImage knows where it lives; other Linux packages don't update this way
	return process.platform === 'linux' && !!process.env.APPIMAGE;
}

/** The latest release on GitHub, for copies that can't install updates themselves */
async function checkRelease(): Promise<void> {
	set({ state: 'checking' });
	try {
		const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
		if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
		const latest = (await res.json()) as { tag_name: string; html_url: string };
		const version = latest.tag_name.replace(/^v/, '');
		set(newer(version, app.getVersion()) ? { state: 'available', version, page: latest.html_url } : { state: 'current', version: app.getVersion() });
	} catch (e) {
		set({ state: 'error', message: `Couldn't check for updates: ${(e as Error).message}` });
	}
}

export function updateState(): DesktopUpdateState {
	return state;
}

/** Look for a newer version now */
export async function checkForUpdates(): Promise<void> {
	if (!app.isPackaged && !process.env.OXYGEN_UPDATE_FEED) {
		set({ state: 'unsupported', reason: 'This is a development build: updates come with the installed app.' });
		return;
	}
	if (!installs()) return checkRelease();
	try {
		await autoUpdater.checkForUpdates();
	} catch (e) {
		set({ state: 'error', message: `Couldn't check for updates: ${(e as Error).message}` });
	}
}

export function downloadUpdate(): void {
	if (state.state !== 'available' || state.page) return;
	set({ state: 'downloading', version: state.version, percent: 0 });
	autoUpdater.downloadUpdate().catch((e: Error) => set({ state: 'error', message: `The update didn't download: ${e.message}` }));
}

/** Quit and install the downloaded update, then start again */
export function installUpdate(): void {
	if (state.state === 'ready') autoUpdater.quitAndInstall(false, true);
}

/** Download updates by themselves (Settings › General); off still checks and tells */
export function setAutomatic(on: boolean): void {
	automatic = on;
	autoUpdater.autoDownload = on;
	autoUpdater.autoInstallOnAppQuit = on;
}

/** Start checking: soon after launch, then every few hours */
export function startUpdates(notify: (s: DesktopUpdateState) => void, automaticByDefault: boolean): void {
	send = notify;
	if (started) return;
	started = true;
	setAutomatic(automaticByDefault);
	autoUpdater.logger = null;
	autoUpdater.allowPrerelease = false;
	autoUpdater.allowDowngrade = false;
	// tests point a copy at an update feed of their own
	if (process.env.OXYGEN_UPDATE_FEED) {
		autoUpdater.forceDevUpdateConfig = !app.isPackaged;
		autoUpdater.setFeedURL({ provider: 'generic', url: process.env.OXYGEN_UPDATE_FEED });
	}
	autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
	autoUpdater.on('update-not-available', () => set({ state: 'current', version: app.getVersion() }));
	autoUpdater.on('update-available', (info) => set(automatic ? { state: 'downloading', version: info.version, percent: 0 } : { state: 'available', version: info.version }));
	autoUpdater.on('download-progress', (p) => {
		const version = state.state === 'downloading' || state.state === 'available' ? state.version : '';
		set({ state: 'downloading', version, percent: Math.round(p.percent) });
	});
	autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
	autoUpdater.on('error', (e) => set({ state: 'error', message: `Updating failed: ${e?.message ?? String(e)}` }));
	setTimeout(() => void checkForUpdates(), 10_000);
	setInterval(() => void checkForUpdates(), EVERY);
}
