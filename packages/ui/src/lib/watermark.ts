import logo from '../assets/watermark.png?inline';
import type { CaptureImage } from '../viewport/scene';

/** The small Oxygen mark in the corner of screenshots, GIFs and videos (Settings › Viewport › Screenshots and recordings) */

let loading: Promise<HTMLImageElement> | null = null;
/** the mark drawn at the size last asked for (every frame of a recording is the same size) */
let sized: { w: number; h: number; mark: ImageData } | null = null;

function image(): Promise<HTMLImageElement> {
	return (loading ??= new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("the watermark didn't load"));
		img.src = logo;
	}));
}

/** The mark for a picture this size: about 3 % of its shorter side tall, with a faint shadow so it reads on light backgrounds too */
async function markFor(width: number, height: number): Promise<ImageData> {
	if (sized && sized.w === width && sized.h === height) return sized.mark;
	const img = await image();
	const h = Math.max(12, Math.min(64, Math.round(Math.min(width, height) * 0.03)));
	const w = Math.round((h * img.naturalWidth) / img.naturalHeight);
	const pad = Math.ceil(h * 0.15);
	const c = document.createElement('canvas');
	c.width = w + pad * 2;
	c.height = h + pad * 2;
	const g = c.getContext('2d', { willReadFrequently: true })!;
	g.imageSmoothingQuality = 'high';
	g.globalAlpha = 0.8;
	g.shadowColor = 'rgba(0, 0, 0, 0.5)';
	g.shadowBlur = Math.max(1, h * 0.1);
	g.drawImage(img, pad, pad, w, h);
	const mark = g.getImageData(0, 0, c.width, c.height);
	sized = { w: width, h: height, mark };
	return mark;
}

/** Put the mark in the bottom right of a capture (straight alpha, so see-through captures stay right) */
export async function stampWatermark(image: CaptureImage): Promise<void> {
	const mark = await markFor(image.width, image.height);
	const margin = Math.round(Math.min(image.width, image.height) * 0.02);
	const x0 = image.width - mark.width - margin + Math.ceil(mark.height * 0.1);
	const y0 = image.height - mark.height - margin + Math.ceil(mark.height * 0.1);
	const d = image.data;
	const m = mark.data;
	for (let y = 0; y < mark.height; y++) {
		const py = y0 + y;
		if (py < 0 || py >= image.height) continue;
		for (let x = 0; x < mark.width; x++) {
			const px = x0 + x;
			if (px < 0 || px >= image.width) continue;
			const j = (y * mark.width + x) * 4;
			const as = m[j + 3] / 255;
			if (!as) continue;
			const i = (py * image.width + px) * 4;
			const ad = d[i + 3] / 255;
			const a = as + ad * (1 - as);
			for (let k = 0; k < 3; k++) d[i + k] = (m[j + k] * as + d[i + k] * ad * (1 - as)) / a;
			d[i + 3] = a * 255;
		}
	}
}
