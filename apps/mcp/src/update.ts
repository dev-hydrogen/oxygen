// A newer release of the server, for copies installed from a release's oxygen-mcp.zip: they ask GitHub at most
// once a day and tell the agent once, in the next tool result. Copies built from a clone don't ask (their
// version is whatever the clone is). OXYGEN_MCP_UPDATE_CHECK=0 turns it off.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'dev-hydrogen/oxygen';
const DAY = 24 * 60 * 60 * 1000;

let notice: string | null = null;
let told = false;

/** 0.10.0 > 0.9.2; a pre-release never counts as newer */
export function newer(candidate: string, than: string): boolean {
	const parse = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()) ?? []).slice(1).map(Number);
	const a = parse(candidate);
	const b = parse(than);
	if (a.length !== 3 || b.length !== 3) return false;
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/** The note an agent gets about a newer release */
export function updateNotice(latest: string, current: string, dir: string): string {
	return [
		`Note for the user: Oxygen's MCP server ${latest} is out (this one is ${current}).`,
		`To update: download https://github.com/${REPO}/releases/latest/download/oxygen-mcp.zip, replace the folder ${dir} with the oxygen-mcp folder inside it, run \`npm install --omit=dev\` and \`npx playwright install chromium\` there, then restart the MCP server.`,
		`What's new: https://github.com/${REPO}/blob/main/CHANGELOG.md`,
	].join(' ');
}

/** Ask GitHub (at most daily) whether this copy is behind; `dir` is where server.cjs lives */
export function startUpdateCheck(current: string, dir: string): void {
	if (process.env.OXYGEN_MCP_UPDATE_CHECK === '0') return;
	// only release copies: the zip puts a package.json named oxygen-mcp next to the server
	try {
		const own = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string };
		if (own.name !== 'oxygen-mcp') return;
	} catch {
		return;
	}
	const cache = join(tmpdir(), 'oxygen-mcp-latest.json');
	void (async () => {
		let latest: string | null = null;
		try {
			const c = existsSync(cache) ? (JSON.parse(readFileSync(cache, 'utf8')) as { at: number; version: string }) : null;
			if (c && Date.now() - c.at < DAY) latest = c.version;
		} catch {
			// a broken cache asks again
		}
		if (!latest) {
			const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
			if (!res.ok) return;
			latest = ((await res.json()) as { tag_name: string }).tag_name.replace(/^v/, '');
			writeFileSync(cache, JSON.stringify({ at: Date.now(), version: latest }));
		}
		if (newer(latest, current)) notice = updateNotice(latest, current, dir);
	})().catch(() => {
		// offline: nothing to say
	});
}

/** The update note, the first time it's asked for after it's known */
export function takeUpdateNotice(): string | null {
	if (!notice || told) return null;
	told = true;
	return notice;
}
