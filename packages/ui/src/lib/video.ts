import { BufferTarget, canEncodeVideo, Mp4OutputFormat, Output, QUALITY_VERY_HIGH, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import type { CaptureImage } from '../viewport/scene';

/**
 * Videos of the viewport, encoded frame by frame with the browser's own encoder (WebCodecs): every frame is a
 * step of the effect at a steady rate, however long each takes to draw. MP4 (H.264) where the browser can make
 * it, else WebM (VP9).
 */
export class VideoRecorder {
	private constructor(
		private output: Output<Mp4OutputFormat | WebMOutputFormat, BufferTarget>,
		private source: VideoSampleSource,
		readonly width: number,
		readonly height: number,
		private fps: number,
		readonly ext: 'mp4' | 'webm',
	) {}

	private frames = 0;

	get count(): number {
		return this.frames;
	}

	/** Start a video of frames this size (rounded down to even sides, which H.264 needs). Throws when the browser can't encode any. */
	static async start(width: number, height: number, fps: number): Promise<VideoRecorder> {
		const w = width & ~1, h = height & ~1;
		if (typeof VideoEncoder === 'undefined') throw new Error("this browser can't encode video (no WebCodecs)");
		const mp4 = await canEncodeVideo('avc', { width: w, height: h });
		if (!mp4 && !(await canEncodeVideo('vp9', { width: w, height: h }))) throw new Error(`this browser can't encode a ${w} × ${h} video`);
		const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
		const source = new VideoSampleSource({ codec: mp4 ? 'avc' : 'vp9', quality: QUALITY_VERY_HIGH, keyFrameInterval: 1 });
		output.addVideoTrack(source, { frameRate: fps });
		await output.start();
		return new VideoRecorder(output, source, w, h, fps, mp4 ? 'mp4' : 'webm');
	}

	/** Add the next frame (opaque; cropped to the video's size). Waits while the encoder catches up. */
	async add(image: CaptureImage): Promise<void> {
		const { width: w, height: h } = this;
		let data: Uint8Array | Uint8ClampedArray = image.data;
		if (image.width !== w || image.height !== h) {
			const cropped = new Uint8ClampedArray(w * h * 4);
			for (let y = 0; y < h; y++) cropped.set(image.data.subarray(y * image.width * 4, (y * image.width + w) * 4), y * w * 4);
			data = cropped;
		}
		const sample = new VideoSample(data, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: this.frames / this.fps, duration: 1 / this.fps });
		try {
			await this.source.add(sample);
		} finally {
			sample.close();
		}
		this.frames++;
	}

	/** The finished file */
	async finish(): Promise<Blob> {
		await this.output.finalize();
		const buffer = this.output.target.buffer;
		if (!buffer) throw new Error('the video came out empty');
		return new Blob([buffer], { type: this.ext === 'mp4' ? 'video/mp4' : 'video/webm' });
	}

	/** Stop without a file */
	async cancel(): Promise<void> {
		await this.output.cancel();
	}
}
