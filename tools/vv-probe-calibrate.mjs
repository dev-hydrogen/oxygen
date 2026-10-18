// Renders a scene from a resource pack in Oxygen's Vibrant Visuals approximation with the in-game camera, so it
// can be compared pixel for pixel with a capture from the game. Needs the dev server (pnpm --filter @oxygen/web dev).
//   node tools/vv-probe-calibrate.mjs --pack <rp folder> --effect <identifier> --out <png>
//     [--size 1600x851] [--fov 85] [--camera x,y,z] [--target x,y,z] [--time 0] [--wait 6]
//     [--exposure adapt|settled|off] [--emissive-scale k [--emissive-gamma g]] [--bloom strength,radius[,w0,w1,w2,w3,w4]] [--gpu]
// The camera is relative to the effect's origin. --wait is how long the effect plays (seconds of wall clock)
// before the picture, like the delay between spawning and capturing in-game.
import { chromium } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const vec = (s) => s.split(',').map(Number);
const url = opt('url', 'http://localhost:5178/');
const pack = resolve(opt('pack')).replace(/\\/g, '/');
const [width, height] = opt('size', '1600x851').split('x').map(Number);

/** every file in the pack, so the fake folder can list them (child effects are found by listing) */
const files = [];
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else files.push(relative(pack, p).replace(/\\/g, '/'));
	}
};
walk(pack);

const browser = await chromium.launch({ args: args.includes('--gpu') ? ['--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: width + 400, height: height + 300 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.addInitScript(
	([root, list]) => {
		const dir = (path) => ({
			kind: 'directory',
			name: path.split('/').pop(),
			async getDirectoryHandle(n) {
				if (!list.some((f) => `${root}/${f}`.startsWith(`${path}/${n}/`))) throw new DOMException('missing', 'NotFoundError');
				return dir(`${path}/${n}`);
			},
			async getFileHandle(n) {
				if (!list.includes(`${path}/${n}`.slice(root.length + 1))) throw new DOMException('missing', 'NotFoundError');
				const res = await fetch(`/@fs/${path}/${n}`);
				const blob = await res.blob();
				return { kind: 'file', name: n, getFile: async () => new File([blob], n) };
			},
			async *values() {
				const prefix = path === root ? '' : `${path.slice(root.length + 1)}/`;
				const seen = new Set();
				for (const f of list) {
					if (!f.startsWith(prefix)) continue;
					const rest = f.slice(prefix.length);
					const name = rest.split('/')[0];
					if (seen.has(name)) continue;
					seen.add(name);
					yield rest.includes('/') ? dir(`${path}/${name}`) : await this.getFileHandle(name);
				}
			},
		});
		window.showDirectoryPicker = async () => dir(root);
	},
	[pack, files],
);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.oxygen && !!window.__oxScene);
await page.evaluate(() => window.oxygen.openPack());

const camera = vec(opt('camera', '0,1.62,-17'));
const target = vec(opt('target', '0,4.92,0'));
await page.evaluate(
	async ([id, time, exposure, scale, w, h, camera, target, fov, bloom]) => {
		const ws = window.oxygen;
		const opened = await ws.host.openEffect(id);
		if (!opened) throw new Error(`${id} isn't in the pack`);
		for (const s of [...ws.sessions]) ws.close(s.id);
		ws.open(opened);
		ws.renderMode = 'vv';
		// play once, like /particle (the editor's Repeat would spawn the children again every loop)
		ws.active.loopPreview = false;
		ws.active.restart();
		ws.active.timeOfDay = time;
		ws.active.scene = { ...ws.active.scene, ground: 'none' };
		const sc = window.__oxScene;
		if (scale !== null) {
			const P = sc.particles;
			P._orig ??= P.syncEmitters.bind(P);
			P.syncEmitters = (e, c) => {
				if (P.vibrant) P.vibrant = { ...P.vibrant, emissive: P.vibrant.emissive * scale[0], ...(scale[1] ? { emissiveGamma: scale[1] } : {}) };
				return P._orig(e, c);
			};
		}
		// the viewport alone, at the game's aspect
		const c = sc.canvas;
		Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', width: `${w}px`, height: `${h}px`, zIndex: '99999' });
		sc.resize(w, h);
		sc.showMarker = false;
		sc.showGrid = false;
		sc.showKillPlane = false;
		sc.gizmos = { ...sc.gizmos, ground: false, block: false, emitter: false, children: false, killPlane: false };
		sc.setView({ position: camera, target, fov });
		sc.vvExposure = exposure;
		sc.resetExposure();
		if (bloom) {
			sc.vibrant.bloom.strength = bloom[0];
			sc.vibrant.bloom.radius = bloom[1];
			// optional per-level weights (finest first)
			if (bloom.length > 2) sc.vibrant.bloom.compositeMaterial.uniforms.bloomFactors.value = bloom.slice(2);
		}
	},
	[opt('effect'), Number(opt('time', '0')), opt('exposure', 'adapt'), args.includes('--emissive-scale') ? [Number(opt('emissive-scale')), Number(opt('emissive-gamma', '0'))] : null, width, height, camera, target, Number(opt('fov', '85')), args.includes('--bloom') ? vec(opt('bloom')) : null],
);
await page.waitForTimeout(Number(opt('wait', '6')) * 1000);
const exposure = await page.evaluate(() => window.__oxScene.vvExposureValue);
await page.screenshot({ path: opt('out'), clip: { x: 0, y: 0, width, height } });
console.log(`saved ${opt('out')}  exposure ${exposure.toFixed(3)}`);
await browser.close();
