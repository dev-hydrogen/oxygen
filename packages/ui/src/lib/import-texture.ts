import { textureKey, type Workspace } from '../state/workspace.svelte';

/** vanilla textures Oxygen has: importing over one gives the effect a texture of its own instead */
const VANILLA = new Set(['textures/particle/particles', 'textures/flame_atlas', 'textures/particle/campfire_smoke', 'textures/particle/soul']);
const TEXTURE = 'particle_effect/description/basic_render_parameters/texture';

/** Ask for a picture file (the host's own dialog, else the browser's) and use it as the open effect's texture */
export async function pickTexture(w: Workspace): Promise<void> {
	if (!w.active) return;
	const file = w.host.pickImage ? await w.host.pickImage() : await browserPick();
	if (file) await importTextureFile(w, file);
}

function browserPick(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/png,image/*';
		input.onchange = () => resolve(input.files?.[0] ?? null);
		input.oncancel = () => resolve(null);
		input.click();
	});
}

/**
 * Use a picture file as the open effect's texture without a resource pack. It stands in for the effect's
 * texture path; an effect without one, or on a vanilla texture, gets `textures/particle/<file name>`.
 */
export async function importTextureFile(w: Workspace, file: File): Promise<void> {
	const s = w.active;
	if (!s) return;
	if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
		w.say(`${file.name} isn't an image.`, 'error');
		return;
	}
	let png: string;
	try {
		png = await toPng(file);
	} catch {
		w.say(`Couldn't read ${file.name} as an image.`, 'error');
		return;
	}
	let path = s.def?.texture ?? '';
	if (!path || VANILLA.has(textureKey(path))) {
		const name =
			file.name
				.replace(/\.[^.]+$/, '')
				.toLowerCase()
				.replace(/[^a-z0-9_.-]+/g, '_')
				.replace(/^_+|_+$/g, '') || 'texture';
		path = `textures/particle/${name}`;
		s.doc.set(TEXTURE, path, 'Use imported texture');
	}
	const kept = w.importTexture(path, png);
	w.say(`Using ${file.name} as ${path}. ${kept ? 'Oxygen keeps it for next time' : 'It lasts until Oxygen closes (too big to keep)'}; it isn't in a pack, so deploying won't include it.`);
}

/** The game reads PNG: other formats are drawn and re-encoded */
async function toPng(file: File): Promise<string> {
	const url = URL.createObjectURL(file);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const i = new Image();
			i.onload = () => resolve(i);
			i.onerror = () => reject(new Error('unreadable'));
			i.src = url;
		});
		const c = document.createElement('canvas');
		c.width = img.naturalWidth;
		c.height = img.naturalHeight;
		c.getContext('2d')!.drawImage(img, 0, 0);
		return c.toDataURL('image/png');
	} finally {
		URL.revokeObjectURL(url);
	}
}
