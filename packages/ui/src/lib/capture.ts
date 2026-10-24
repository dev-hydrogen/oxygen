import type { Host } from '../host';
import { RECORD_LIMIT, type Preferences } from '../state/preferences';
import type { CaptureImage, CaptureOptions } from '../viewport/scene';

/** Screenshots and GIFs of the viewport: drawing options from the settings, and where the result goes */

export function screenshotOptions(p: Preferences): CaptureOptions {
	return { scale: p.captureScale, transparent: p.captureTransparent, helpers: p.captureHelpers };
}

/** A GIF keeps to `gifSize` on its longest side; a length of 0 records until the effect ends */
export function gifOptions(p: Preferences): CaptureOptions & { seconds: number; fps: number } {
	return { scale: 4, maxSide: p.gifSize, transparent: p.gifTransparent, helpers: p.captureHelpers, seconds: p.gifSeconds || RECORD_LIMIT, fps: p.gifFps };
}

/** A video always has the background (MP4 can't leave it out) */
export function videoOptions(p: Preferences): CaptureOptions & { seconds: number; fps: number } {
	return { scale: 4, maxSide: p.videoSize, transparent: false, helpers: p.captureHelpers, seconds: p.gifSeconds || RECORD_LIMIT, fps: p.videoFps };
}

export function toPng(image: CaptureImage): Promise<Blob> {
	const c = document.createElement('canvas');
	c.width = image.width;
	c.height = image.height;
	c.getContext('2d')!.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
	return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be encoded'))), 'image/png'));
}

/** `aurora-2026-10-21-14-03-22.png` */
export function captureName(identifier: string, ext: 'png' | 'gif' | 'mp4' | 'webm'): string {
	const base = (identifier.split(':').pop() || 'effect').replace(/[^a-z0-9_.-]+/gi, '_');
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${base}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${ext}`;
}

/** Put a PNG on the clipboard. False when the browser or webview won't. */
export async function copyImage(png: Blob): Promise<boolean> {
	try {
		if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Keep a capture: the host's way (desktop: the Pictures folder; VS Code: asks where), else a download. Resolves
 * with where it went, in words, or null when the user cancelled.
 */
export async function keepCapture(host: Host, name: string, data: Blob): Promise<{ where: string; path: string | null } | null> {
	if (host.saveCapture) {
		const path = await host.saveCapture(name, data);
		return path ? { where: path, path } : null;
	}
	const url = URL.createObjectURL(data);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
	return { where: `your downloads as ${name}`, path: null };
}
