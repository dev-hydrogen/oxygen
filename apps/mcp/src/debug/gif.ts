// GIF encoding, for animations of an effect. No Node or browser APIs: the preview page and the server both use it.

/** Straight RGBA pixels, row-major from the top-left */
export interface Rgba {
	width: number;
	height: number;
	data: Uint8Array | Uint8ClampedArray;
}

/**
 * One 256-colour palette for a whole animation (median cut over a 15-bit histogram of every frame), so colours
 * stay put from frame to frame. Returns the palette and a bin → palette index map.
 */
function quantize(frames: Rgba[]): { palette: Uint8Array; lookup: Uint8Array } {
	const hist = new Uint32Array(32768);
	for (const f of frames) {
		const d = f.data;
		for (let i = 0; i < d.length; i += 4) hist[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)]++;
	}
	const bins: number[] = [];
	for (let b = 0; b < 32768; b++) if (hist[b]) bins.push(b);
	const ch = (b: number, c: number) => (c === 0 ? b >> 10 : c === 1 ? (b >> 5) & 31 : b & 31);
	type Box = { bins: number[]; weight: number };
	const boxes: Box[] = [{ bins, weight: bins.reduce((s, b) => s + hist[b], 0) }];
	const span = (box: Box): [number, number] => {
		let best = 0, axis = 0;
		for (let c = 0; c < 3; c++) {
			let lo = 31, hi = 0;
			for (const b of box.bins) {
				const v = ch(b, c);
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			if (hi - lo > best) {
				best = hi - lo;
				axis = c;
			}
		}
		return [best, axis];
	};
	while (boxes.length < 256) {
		// split the box that matters most: wide and heavily used
		let pick = -1, score = 0, axis = 0;
		boxes.forEach((box, i) => {
			if (box.bins.length < 2) return;
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
		box.bins.sort((x, y) => ch(x, axis) - ch(y, axis));
		let acc = 0, cut = 0;
		for (; cut < box.bins.length - 1; cut++) {
			acc += hist[box.bins[cut]];
			if (acc * 2 >= box.weight) break;
		}
		const a = box.bins.slice(0, cut + 1), b = box.bins.slice(cut + 1);
		const w = (l: number[]) => l.reduce((s, x) => s + hist[x], 0);
		boxes.splice(pick, 1, { bins: a, weight: w(a) }, { bins: b, weight: w(b) });
	}
	const palette = new Uint8Array(768);
	boxes.forEach((box, i) => {
		let r = 0, g = 0, bl = 0;
		for (const b of box.bins) {
			const n = hist[b];
			r += ((b >> 10) * 8 + 4) * n;
			g += (((b >> 5) & 31) * 8 + 4) * n;
			bl += ((b & 31) * 8 + 4) * n;
		}
		const n = box.weight || 1;
		palette[i * 3] = Math.round(r / n);
		palette[i * 3 + 1] = Math.round(g / n);
		palette[i * 3 + 2] = Math.round(bl / n);
	});
	const lookup = new Uint8Array(32768);
	const count = boxes.length;
	for (const b of bins) {
		const r = (b >> 10) * 8 + 4, g = ((b >> 5) & 31) * 8 + 4, bl = (b & 31) * 8 + 4;
		let best = 0, bd = Infinity;
		for (let i = 0; i < count; i++) {
			const dr = palette[i * 3] - r, dg = palette[i * 3 + 1] - g, db = palette[i * 3 + 2] - bl;
			const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
			if (d < bd) {
				bd = d;
				best = i;
			}
		}
		lookup[b] = best;
	}
	return { palette, lookup };
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

/** Encode frames (all the same size) as a looping animated GIF; `delays` in seconds per frame */
export function encodeGif(frames: Rgba[], delays: number[]): Uint8Array {
	const { width, height } = frames[0];
	const { palette, lookup } = quantize(frames);
	const bytes = new Bytes();
	const u16 = (n: number) => bytes.push(n & 255, (n >> 8) & 255);
	for (const c of 'GIF89a') bytes.push(c.charCodeAt(0));
	u16(width);
	u16(height);
	bytes.push(0xf7, 0, 0); // global colour table of 256, 8-bit colour resolution
	for (const v of palette) bytes.byte(v);
	// loop forever
	bytes.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
	let clock = 0, shown = 0;
	frames.forEach((f, n) => {
		// delays are in hundredths of a second: carry the rounding so the total stays right
		clock += delays[n] ?? delays[delays.length - 1] ?? 0.05;
		const cs = Math.max(2, Math.round(clock * 100) - shown);
		shown += cs;
		bytes.push(0x21, 0xf9, 4, 0x04, cs & 255, (cs >> 8) & 255, 0, 0);
		bytes.push(0x2c);
		u16(0);
		u16(0);
		u16(width);
		u16(height);
		bytes.push(0);
		const idx = new Uint8Array(width * height);
		const d = f.data;
		for (let i = 0, p = 0; i < d.length; i += 4, p++) idx[p] = lookup[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)];
		bytes.byte(8);
		lzw(idx, bytes);
	});
	bytes.byte(0x3b);
	return bytes.result();
}
