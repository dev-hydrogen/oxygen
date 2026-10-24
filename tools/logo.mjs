// Renders the logo: the app icon, the name, and an orbit of pixel particles with bloom, in two layouts.
//   node tools/logo.mjs
//   → docs/media/logo-on-dark.png, docs/media/logo-on-light.png       (README banner, transparent)
//   → packages/ui/src/assets/logo-dark.png, logo-light.png             (the app's top bar)
//   → packages/ui/src/assets/watermark.png                             (the corner of screenshots and recordings)
//   node tools/logo.mjs watermark                                      (just the layouts named)
// Needs network access for the Outfit font (Google Fonts).
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Sizes are logical pixels; `k` scales the trail's scatter and the head's sparks with the orbit */
const LAYOUTS = {
	banner: {
		W: 1040, H: 400, S: 2, texel: 3, k: 1,
		orbit: { cx: 588, cy: 206, rx: 345, ry: 96, tilt: -6, head: 0.3, span: 1.78 },
		trail: 620, sparks: 26,
		icon: { x: 70, y: 110, s: 180 },
		name: { size: 150, x: 300, y: 245, glow: 28 },
		tagline: { size: 27, x: 306, y: 300 },
		bloom: [[6, 0.9], [16, 0.7], [36, 0.55]],
		files: { dark: 'docs/media/logo-on-dark.png', light: 'docs/media/logo-on-light.png' },
	},
	// 32 logical pixels tall, drawn at 4× for sharp HiDPI screens
	app: {
		W: 120, H: 32, S: 4, texel: 1, k: 0.16,
		orbit: { cx: 66, cy: 17, rx: 44, ry: 9.5, tilt: -6, head: 0.3, span: 1.78 },
		trail: 150, sparks: 7,
		icon: { x: 2, y: 6, s: 20 },
		name: { size: 17, x: 28, y: 22.5, glow: 12 },
		tagline: null,
		bloom: [[1, 0.8], [2.5, 0.6], [5, 0.45]],
		files: { dark: 'packages/ui/src/assets/logo-dark.png', light: 'packages/ui/src/assets/logo-light.png' },
	},
	// the app layout without the icon, for the corner of screenshots and recordings (128 px tall: sharp up to 4K)
	watermark: {
		W: 100, H: 32, S: 4, texel: 1, k: 0.16,
		orbit: { cx: 47, cy: 17, rx: 44, ry: 9.5, tilt: -6, head: 0.3, span: 1.78 },
		trail: 150, sparks: 7,
		icon: null,
		name: { size: 17, x: 9, y: 22.5, glow: 12 },
		tagline: null,
		bloom: [[1, 0.8], [2.5, 0.6], [5, 0.45]],
		files: { dark: 'packages/ui/src/assets/watermark.png' },
	},
};

const page = /* html */ `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;600&display=block">
</head><body style="margin:0;background:transparent"><script>
// a seeded random, so the logo is the same every time
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// pixel sprites ('#' full, '+' half): a dot, a cross, a sparkle and a round puff
const SPRITES = {
	dot: ['#'],
	cross: ['.+.', '+#+', '.+.'],
	sparkle: ['..+..', '..#..', '+###+', '..#..', '..+..'],
	puff: ['.++.', '+##+', '+##+', '.++.'],
};

// colour along the trail: white-blue head through blue and violet to a pink tail
const STOPS = [[0, [235, 245, 255]], [0.12, [147, 189, 245]], [0.45, [129, 140, 248]], [0.75, [192, 132, 252]], [1, [244, 114, 182]]];
function trailColor(t) {
	for (let i = 1; i < STOPS.length; i++) {
		if (t <= STOPS[i][0]) {
			const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i];
			const f = (t - t0) / (t1 - t0);
			return 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',') + ')';
		}
	}
	return 'rgb(244,114,182)';
}

window.render = (L, light) => {
	seed = 7;
	const { W, H, S, texel: TEXEL, k } = L;
	const O = { ...L.orbit, tilt: (L.orbit.tilt * Math.PI) / 180, head: L.orbit.head * Math.PI, span: L.orbit.span * Math.PI };

	function makeCanvas() {
		const c = document.createElement('canvas');
		c.width = W * S;
		c.height = H * S;
		const g = c.getContext('2d');
		g.scale(S, S);
		g.imageSmoothingEnabled = false;
		return [c, g];
	}
	function sprite(g, name, x, y, color, alpha) {
		const rows = SPRITES[name];
		const n = rows.length;
		// snap to the texel grid so every particle stays crisp
		const ox = Math.round(x / TEXEL) * TEXEL - Math.floor(n / 2) * TEXEL;
		const oy = Math.round(y / TEXEL) * TEXEL - Math.floor(n / 2) * TEXEL;
		for (let r = 0; r < n; r++)
			for (let c = 0; c < rows[r].length; c++) {
				const ch = rows[r][c];
				if (ch === '.') continue;
				g.globalAlpha = alpha * (ch === '#' ? 1 : 0.45);
				g.fillStyle = color;
				g.fillRect(ox + c * TEXEL, oy + r * TEXEL, TEXEL, TEXEL);
			}
		g.globalAlpha = 1;
	}
	// the orbit: an ellipse around the name, tilted a little; the head sits low on the right
	function orbitPoint(a, r = 1) {
		const x = Math.cos(a) * O.rx * r, y = Math.sin(a) * O.ry * r;
		const c = Math.cos(O.tilt), s = Math.sin(O.tilt);
		return [O.cx + x * c - y * s, O.cy + x * s + y * c];
	}
	function particles() {
		const list = [];
		// the trail, densest and brightest at the head
		for (let i = 0; i < L.trail; i++) {
			const t = Math.pow(rnd(), 1.5); // 0 at the head
			const a = O.head - t * O.span;
			const spread = 0.025 + t * 0.16;
			const [x, y] = orbitPoint(a, 1 + (rnd() - 0.5) * spread * 2);
			const drift = t * 26 * k;
			const name = t < 0.08 ? (rnd() < 0.5 ? 'sparkle' : 'puff') : t < 0.4 ? (rnd() < 0.35 ? 'cross' : rnd() < 0.5 ? 'puff' : 'dot') : rnd() < 0.2 ? 'cross' : 'dot';
			list.push({ x: x + (rnd() - 0.5) * drift, y: y + (rnd() - 0.5) * drift - t * 10 * k, t, name, front: Math.sin(a) > -0.05, alpha: Math.max(0.12, 1 - t * 0.85) });
		}
		// a burst of sparks thrown off the head
		const [hx, hy] = orbitPoint(O.head);
		for (let i = 0; i < L.sparks; i++) {
			const ang = rnd() * Math.PI * 2, d = (18 + rnd() * 70) * k;
			list.push({ x: hx + Math.cos(ang) * d * 1.4, y: hy + Math.sin(ang) * d * 0.7, t: 0.05 + rnd() * 0.2, name: rnd() < 0.3 ? 'cross' : 'dot', front: true, alpha: 0.5 + rnd() * 0.5 });
		}
		// the head itself
		list.push({ x: hx, y: hy, t: 0, name: 'sparkle', front: true, alpha: 1, big: true });
		return list;
	}
	function drawParticles(g, list, front) {
		for (const p of list) {
			if (p.front !== front) continue;
			const color = light && p.t < 0.1 ? 'rgb(96,140,230)' : trailColor(p.t);
			const alpha = Math.max(light ? 0.3 : 0, p.alpha) * (front ? 1 : light ? 0.7 : 0.55);
			if (p.big && TEXEL > 1) {
				// a larger sparkle: the same sprite at twice the texel size
				g.save();
				g.translate(p.x, p.y);
				g.scale(2, 2);
				sprite(g, 'sparkle', 0, 0, color, alpha);
				g.restore();
			} else sprite(g, p.big ? 'sparkle' : p.name, p.x, p.y, color, alpha);
		}
	}
	function bloom(target, layer, strength) {
		const [b, bg] = makeCanvas();
		bg.setTransform(1, 0, 0, 1, 0, 0);
		for (const [blur, alpha] of L.bloom) {
			bg.clearRect(0, 0, b.width, b.height);
			bg.filter = 'blur(' + blur * S + 'px)';
			bg.drawImage(layer, 0, 0);
			bg.filter = 'none';
			target.setTransform(1, 0, 0, 1, 0, 0);
			target.globalCompositeOperation = 'lighter';
			target.globalAlpha = alpha * strength;
			target.drawImage(b, 0, 0);
			target.globalAlpha = 1;
			target.globalCompositeOperation = 'source-over';
			target.setTransform(S, 0, 0, S, 0, 0);
		}
	}
	function icon(g) {
		if (!L.icon) return;
		const { x, y, s } = L.icon, r = (s * 14) / 64, u = s / 64;
		g.fillStyle = '#1a1e2c';
		g.beginPath();
		g.roundRect(x, y, s, s, r);
		g.fill();
		g.strokeStyle = '#93bdf5';
		g.lineWidth = 5 * u;
		g.beginPath();
		g.arc(x + 25 * u, y + 34 * u, 15 * u, 0, Math.PI * 2);
		g.stroke();
		g.fillStyle = '#93bdf5';
		g.beginPath();
		g.arc(x + 46 * u, y + 20 * u, 7 * u, 0, Math.PI * 2);
		g.fill();
	}
	function text(g) {
		const n = L.name;
		g.textBaseline = 'alphabetic';
		g.font = '600 ' + n.size + 'px Outfit';
		g.fillStyle = light ? '#1a1e2c' : '#eef3fc';
		if (!light) {
			g.shadowColor = 'rgba(147,189,245,0.35)';
			g.shadowBlur = n.glow; // device pixels: shadows ignore the canvas transform
		}
		g.fillText('Oxygen', n.x, n.y);
		g.shadowBlur = 0;
		if (L.tagline) {
			g.font = '300 ' + L.tagline.size + 'px Outfit';
			g.fillStyle = light ? '#4a5470' : '#9aa6c2';
			g.fillText('Particle IDE for Minecraft Bedrock', L.tagline.x, L.tagline.y);
		}
	}

	const [out, g] = makeCanvas();
	const list = particles();
	for (const front of [false, true]) {
		const [layer, lg] = makeCanvas();
		drawParticles(lg, list, front);
		if (!light) bloom(g, layer, front ? 1 : 0.6);
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.drawImage(layer, 0, 0);
		g.setTransform(S, 0, 0, S, 0, 0);
		if (!front) {
			icon(g);
			text(g);
		}
	}
	return out.toDataURL('image/png');
};
</script></body></html>`;

const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(page, { waitUntil: 'networkidle' });
await p.evaluate(() => Promise.all([document.fonts.load('600 150px Outfit'), document.fonts.load('300 27px Outfit')]));
if (!(await p.evaluate(() => document.fonts.check('600 150px Outfit')))) throw new Error('The Outfit font did not load (needs network access)');
const only = process.argv.slice(2);
for (const [name, L] of Object.entries(LAYOUTS))
	for (const [variant, light] of [['dark', false], ['light', true]]) {
		const file = L.files[variant];
		if (!file || (only.length && !only.includes(name))) continue;
		const url = await p.evaluate(([l, li]) => window.render(l, li), [L, light]);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
		console.log('saved', file);
	}
await b.close();
