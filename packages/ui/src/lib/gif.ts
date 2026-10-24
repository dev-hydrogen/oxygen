// GIF encoding, for animations of an effect. No Node or browser APIs: the editor, the MCP preview page and its server use it.

/** Straight RGBA pixels, row-major from the top-left */
export interface Rgba {
	width: number;
	height: number;
	data: Uint8Array | Uint8ClampedArray;
}


/** 8×8 ordered dither thresholds (0–63): a fixed pattern, so still parts of an animation don't shimmer */
const BAYER = (() => {
	const m = new Uint8Array(64);
	for (let y = 0; y < 8; y++)
		for (let x = 0; x < 8; x++) {
			let v = 0;
			for (let bit = 0, xs = x, ys = y ^ x; bit < 3; bit++, xs >>= 1, ys >>= 1) v = (v << 2) | ((ys & 1) << 1) | (xs & 1);
			m[y * 8 + x] = v;
		}
	return m;
})();

/** how far (in 0–255 levels) the dither pattern nudges a colour before it's matched to the palette */
const DITHER = 10;

/** colours are counted at 6 bits a channel (a 64-level step is too fine to see after dithering) */
const key = (r: number, g: number, b: number) => ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
const ch = (k: number, c: number) => (c === 0 ? k >> 12 : c === 1 ? (k >> 6) & 63 : k & 63);

/**
 * A palette for one frame: median cut over its colours, splitting the boxes that are wide and much used first.
 */
function quantize(hist: Uint32Array, used: number[], colours: number): Uint8Array {
	type Box = { keys: number[]; weight: number };
	const weigh = (l: number[]) => l.reduce((s, k) => s + hist[k], 0);
	const boxes: Box[] = [{ keys: used.slice(), weight: weigh(used) }];
	const span = (box: Box): [number, number] => {
		let best = -1, axis = 0;
		for (let c = 0; c < 3; c++) {
			let lo = 63, hi = 0;
			for (const k of box.keys) {
				const v = ch(k, c);
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			// green counts most to the eye, blue least
			const w = (hi - lo) * (c === 1 ? 1.2 : c === 0 ? 1 : 0.8);
			if (w > best) {
				best = w;
				axis = c;
			}
		}
		return [best, axis];
	};
	while (boxes.length < colours) {
		let pick = -1, score = 0, axis = 0;
		boxes.forEach((box, i) => {
			if (box.keys.length < 2) return;
			const [w, a] = span(box);
			const sc = w * Math.sqrt(box.weight);
			if (sc > score) {
				score = sc;
				pick = i;
				axis = a;
			}
		});
		if (pick < 0) break;
		const box = boxes[pick];
		box.keys.sort((x, y) => ch(x, axis) - ch(y, axis));
		let acc = 0, cut = 0;
		for (; cut < box.keys.length - 1; cut++) {
			acc += hist[box.keys[cut]];
			if (acc * 2 >= box.weight) break;
		}
		// one colour holding most of the box (a background) still leaves both halves something
		cut = Math.min(cut, box.keys.length - 2);
		const a = box.keys.slice(0, cut + 1), b = box.keys.slice(cut + 1);
		boxes.splice(pick, 1, { keys: a, weight: weigh(a) }, { keys: b, weight: weigh(b) });
	}
	const palette = new Uint8Array(768);
	boxes.forEach((box, i) => {
		let r = 0, g = 0, bl = 0;
		for (const k of box.keys) {
			const n = hist[k];
			r += (ch(k, 0) * 4 + 2) * n;
			g += (ch(k, 1) * 4 + 2) * n;
			bl += (ch(k, 2) * 4 + 2) * n;
		}
		const n = box.weight || 1;
		palette[i * 3] = Math.min(255, Math.round(r / n));
		palette[i * 3 + 1] = Math.min(255, Math.round(g / n));
		palette[i * 3 + 2] = Math.min(255, Math.round(bl / n));
	});
	return palette;
}

/** A growable byte buffer */
class Bytes {
	buf = new Uint8Array(1 << 16);
	length = 0;
	push(...values: number[]): void {
		for (const v of values) this.byte(v);
	}
	byte(v: number): void {
		if (this.length === this.buf.length) {
			const next = new Uint8Array(this.buf.length * 2);
			next.set(this.buf);
			this.buf = next;
		}
		this.buf[this.length++] = v;
	}
	result(): Uint8Array {
		return this.buf.slice(0, this.length);
	}
}

/** GIF LZW (minimum code size 8), written as 255-byte sub-blocks */
function lzw(indices: Uint8Array, out: Bytes): void {
	const block = new Uint8Array(255);
	let fill = 0;
	let bits = 0, acc = 0;
	const flush = () => {
		out.byte(fill);
		for (let i = 0; i < fill; i++) out.byte(block[i]);
		fill = 0;
	};
	const put = (code: number, size: number) => {
		acc |= code << bits;
		bits += size;
		while (bits >= 8) {
			block[fill++] = acc & 255;
			acc >>>= 8;
			bits -= 8;
			if (fill === 255) flush();
		}
	};
	const CLEAR = 256, END = 257;
	let size = 9, next = 258;
	let dict = new Map<number, number>();
	put(CLEAR, size);
	let prefix = indices[0];
	for (let i = 1; i < indices.length; i++) {
		const k = indices[i];
		const key = (prefix << 8) | k;
		const hit = dict.get(key);
		if (hit !== undefined) {
			prefix = hit;
			continue;
		}
		put(prefix, size);
		if (next < 4096) {
			dict.set(key, next++);
			if (next > 1 << size && size < 12) size++;
		} else {
			put(CLEAR, size);
			dict = new Map();
			next = 258;
			size = 9;
		}
		prefix = k;
	}
	put(prefix, size);
	put(END, size);
	if (bits > 0) block[fill++] = acc & 255;
	if (fill) flush();
	out.byte(0);
}

/**
 * Builds an animated GIF a frame at a time, encoding each as it comes (so long recordings fit in memory). Every
 * frame gets its own 256-colour palette from its full colours, and a fixed dither pattern hides the steps
 * between them. See-through GIFs dither partly transparent pixels too, so soft edges fade instead of cutting off.
 */
export class GifEncoder {
	private bytes = new Bytes();
	private hist = new Uint32Array(1 << 18);
	/** colour → palette index for the frame being written (-1: not looked up yet) */
	private nearest = new Int16Array(1 << 18);
	private frames = 0;
	private clock = 0;
	private shown = 0;
	width = 0;
	height = 0;

	/** `transparent` keeps the frames' alpha as GIF can: see-through or not, dithered in between */
	constructor(private transparent = false) {}

	get count(): number {
		return this.frames;
	}

	/** Add a frame shown for `delay` seconds (every frame the size of the first) */
	add(f: Rgba, delay: number): void {
		const out = this.bytes;
		const u16 = (n: number) => out.push(n & 255, (n >> 8) & 255);
		if (!this.frames) {
			this.width = f.width;
			this.height = f.height;
			for (const c of 'GIF89a') out.push(c.charCodeAt(0));
			u16(f.width);
			u16(f.height);
			// no global colour table (each frame brings its own), 8-bit colour resolution
			out.push(0x70, 0, 0);
			// loop forever
			out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
		}
		const { width, height } = this;
		const d = f.data;
		const clear = this.transparent;
		const n = width * height;
		// which pixels show: ordered-dithered coverage for the partly transparent ones
		const show = new Uint8Array(n);
		const hist = this.hist;
		const used: number[] = [];
		for (let y = 0, p = 0; y < height; y++)
			for (let x = 0; x < width; x++, p++) {
				const i = p * 4;
				if (clear) {
					// GIF transparency is all or nothing: a pixel 30 % opaque shows in 30 % of the pattern
					const a = d[i + 3];
					if (a < 8 || (a < 248 && a < (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) * 4)) continue;
				}
				show[p] = 1;
				const k = key(d[i], d[i + 1], d[i + 2]);
				if (!hist[k]++) used.push(k);
			}
		const colours = clear ? 255 : 256;
		const palette = used.length ? quantize(hist, used, colours) : new Uint8Array(768);
		const count = Math.max(1, Math.min(colours, used.length));
		for (const k of used) hist[k] = 0;
		this.nearest.fill(-1);
		const idx = new Uint8Array(n);
		const nearest = this.nearest;
		const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
		for (let y = 0, p = 0; y < height; y++)
			for (let x = 0; x < width; x++, p++) {
				if (!show[p]) {
					idx[p] = 255;
					continue;
				}
				const i = p * 4;
				const o = ((BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5) * DITHER;
				const r = clamp(d[i] + o), g = clamp(d[i + 1] + o), b = clamp(d[i + 2] + o);
				const k = key(r, g, b);
				let best = nearest[k];
				if (best < 0) {
					const kr = (k >> 12) * 4 + 2, kg = ((k >> 6) & 63) * 4 + 2, kb = (k & 63) * 4 + 2;
					let bd = Infinity;
					best = 0;
					for (let c = 0; c < count; c++) {
						const dr = palette[c * 3] - kr, dg = palette[c * 3 + 1] - kg, db = palette[c * 3 + 2] - kb;
						const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
						if (dist < bd) {
							bd = dist;
							best = c;
						}
					}
					nearest[k] = best;
				}
				idx[p] = best;
			}
		// delays are in hundredths of a second: carry the rounding so the total stays right
		this.clock += delay;
		const cs = Math.max(2, Math.round(this.clock * 100) - this.shown);
		this.shown += cs;
		// a see-through frame clears to nothing before the next (disposal 2), or the old ones would show through
		if (clear) out.push(0x21, 0xf9, 4, 0x09, cs & 255, (cs >> 8) & 255, 255, 0);
		else out.push(0x21, 0xf9, 4, 0x04, cs & 255, (cs >> 8) & 255, 0, 0);
		out.push(0x2c);
		u16(0);
		u16(0);
		u16(width);
		u16(height);
		// a local colour table of 256
		out.push(0x87);
		for (const v of palette) out.byte(v);
		out.byte(8);
		lzw(idx, out);
		this.frames++;
	}

	/** The GIF, looping forever */
	finish(): Uint8Array {
		this.bytes.byte(0x3b);
		return this.bytes.result();
	}
}

/** Encode frames (all the same size) as a looping animated GIF; `delays` in seconds per frame */
export function encodeGif(frames: Rgba[], delays: number[], options: { transparent?: boolean } = {}): Uint8Array {
	const gif = new GifEncoder(!!options.transparent);
	frames.forEach((f, n) => gif.add(f, delays[n] ?? delays[delays.length - 1] ?? 0.05));
	return gif.finish();
}
