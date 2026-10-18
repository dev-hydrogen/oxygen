import type { UpdateLink, UpdateState } from '@oxygen/ui';

/** how often an open tab looks for a newer deploy, and how soon it looks again when it comes back into view */
const EVERY = 30 * 60 * 1000;
const AGAIN = 5 * 60 * 1000;

const scriptOf = (html: string) => /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/.exec(html)?.[1] ?? null;
const versionOf = (html: string) => /<meta\s+name="oxygen-version"\s+content="([^"]+)"/.exec(html)?.[1] ?? null;

/**
 * A newer deploy, for a tab that stays open: every build names its main script after its content, so a page whose
 * script differs from this one's is a newer Oxygen, and a reload brings it in. Production builds only.
 */
export function webUpdates(): UpdateLink | undefined {
	if (!import.meta.env.PROD) return undefined;
	const page = document.documentElement.outerHTML;
	const mine = scriptOf(page);
	const myVersion = versionOf(page);
	if (!mine) return undefined;
	let state: UpdateState = { state: 'idle' };
	const listeners: ((s: UpdateState) => void)[] = [];
	const set = (s: UpdateState) => {
		state = s;
		for (const l of listeners) l(s);
	};
	let last = 0;
	async function check(asked: boolean) {
		if (state.state === 'ready' || (!asked && Date.now() - last < AGAIN)) return;
		last = Date.now();
		try {
			const html = await (await fetch('./', { cache: 'no-store' })).text();
			const latest = scriptOf(html);
			const version = versionOf(html);
			if (latest && latest !== mine) set({ state: 'ready', version: version && version !== myVersion ? version : null });
			else if (asked) set({ state: 'current', version: myVersion ?? '' });
		} catch {
			// offline: the next look will tell
			if (asked) set({ state: 'error', message: "Couldn't reach oxygen.hydrogen.exposed to check for a newer version." });
		}
	}
	setInterval(() => void check(false), EVERY);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') void check(false);
	});
	return {
		status: async () => state,
		onStatus: (cb) => listeners.push(cb),
		check: () => check(true),
		install: () => location.reload(),
	};
}
