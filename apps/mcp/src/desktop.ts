// Starting the Oxygen desktop app with a file. The app keeps one instance: started again, it hands the file to
// the window already open, which opens it in a tab (or focuses the tab it has).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

interface Launch {
	command: string;
	args: string[];
	/** how Oxygen was found, for the reply */
	via: string;
}

/** The desktop app next to this server when it runs from a clone of the repository (apps/mcp/dist → apps/desktop) */
function repositoryBuild(file: string): Launch | null {
	const dir = resolve(__dirname, '../../desktop');
	if (!existsSync(join(dir, 'dist', 'main.cjs'))) return null;
	try {
		// the electron package's main is the path of its binary; it throws when the binary was never downloaded
		const electron = createRequire(join(dir, 'package.json'))('electron') as unknown;
		if (typeof electron !== 'string' || !existsSync(electron)) return null;
		return { command: electron, args: [dir, file], via: `the desktop build in ${dir}` };
	} catch {
		return null;
	}
}

/** How to start Oxygen with `file`: OXYGEN_DESKTOP, the repository's own build, then an installed app */
export function desktopLaunch(file: string): Launch | null {
	const configured = process.env.OXYGEN_DESKTOP;
	if (configured) return { command: configured, args: [file], via: `OXYGEN_DESKTOP (${configured})` };
	const dev = repositoryBuild(file);
	if (dev) return dev;
	if (process.platform === 'darwin' && ['/Applications', join(homedir(), 'Applications')].some((d) => existsSync(join(d, 'Oxygen.app')))) {
		return { command: 'open', args: ['-a', 'Oxygen', file], via: 'the installed Oxygen.app' };
	}
	if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
		// the installer's default per-user location
		const exe = join(process.env.LOCALAPPDATA, 'Programs', 'Oxygen', 'Oxygen.exe');
		if (existsSync(exe)) return { command: exe, args: [file], via: exe };
	}
	return null;
}

/** Start the process detached (it outlives this server); rejects when it can't be started at all */
export function launchDetached(l: Launch): Promise<void> {
	const { promise, resolve: done, reject } = Promise.withResolvers<void>();
	// agents built on Electron (VS Code, Cursor) start MCP servers with ELECTRON_RUN_AS_NODE, which would make the
	// app's Electron run as plain Node
	const child = spawn(l.command, l.args, { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
	child.once('error', reject);
	child.once('spawn', () => {
		child.unref();
		done();
	});
	return promise;
}
