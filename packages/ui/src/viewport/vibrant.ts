import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AUTO_EXPOSURE, AutoExposure, displayTransform, GENERIC_TONE, GENERIC_TONE_COEFFICIENTS, MEASURED_ADDITIVE_GAIN, measuredParticleLight, particleLight, type GradingModel, type LightingModel, type RGB } from '@oxygen/scene';

/**
 * Bloom fitted to the halo around an emissive wall in-game: strength and the weight of each blur level (finest
 * first). The game's halo fades within about a fifth of the wall's width, so the widest levels stay out.
 */
const BLOOM_STRENGTH = 0.005;
const BLOOM_LEVELS = [0.4, 1, 0.7, 0.05, 0];
import type { VibrantSettings } from 'wintersky/render';

const OPERATOR_ID: Record<GradingModel['toneMapper'], number> = { generic: 0, reinhard: 1, reinhard_luma: 2, reinhard_luminance: 2, hable: 3, aces: 4 };

/**
 * The game's display transform on the HDR frame: exposure, the midtones grade, the tone mapper and the gamma
 * encode, exactly as displayTransform in @oxygen/scene computes it (so backdrops can be solved for on the CPU).
 */
class DisplayPass extends Pass {
	private quad: FullScreenQuad;
	readonly material: THREE.ShaderMaterial;

	constructor() {
		super();
		const g = GENERIC_TONE;
		const f = (x: number) => x.toFixed(9);
		this.material = new THREE.ShaderMaterial({
			uniforms: {
				tDiffuse: { value: null },
				uExposure: { value: 1 },
				uOperator: { value: 0 },
				uSaturation: { value: new THREE.Vector3(1, 1, 1) },
				uContrast: { value: new THREE.Vector3(1, 1, 1) },
				uGain: { value: new THREE.Vector3(1, 1, 1) },
				uOffset: { value: new THREE.Vector3(0, 0, 0) },
				uGamma: { value: 2.2 },
			},
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}`,
			fragmentShader: /* glsl */ `
				uniform sampler2D tDiffuse;
				uniform float uExposure;
				uniform int uOperator;
				uniform vec3 uSaturation;
				uniform vec3 uContrast;
				uniform vec3 uGain;
				uniform vec3 uOffset;
				uniform float uGamma;
				varying vec2 vUv;
				const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
				float generic(float x) {
					x = max(x, 0.0);
					return min(1.0, pow(x, ${f(g.contrast)}) / (pow(x, ${f(g.contrast * g.shoulder)}) * ${f(GENERIC_TONE_COEFFICIENTS.b)} + ${f(GENERIC_TONE_COEFFICIENTS.c)}));
				}
				vec3 hable(vec3 c) {
					c = max(vec3(0.0), c - 0.004);
					return pow((c * (6.2 * c + 0.5)) / (c * (6.2 * c + 1.7) + 0.06), vec3(2.2));
				}
				vec3 aces(vec3 c) {
					const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
					const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
					vec3 v = IN * (c / 0.6);
					v = (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
					return OUT * v;
				}
				vec3 toneMap(vec3 c) {
					float l = dot(c, LUMA);
					if (uOperator == 0) {
						float m = max(c.r, max(c.g, c.b));
						if (m <= 1e-9) return vec3(0.0);
						float t = generic(m);
						vec3 o = max(c, vec3(0.0)) * (t / m);
						return mix(o, vec3(t), pow(t, ${f(g.whitening)}));
					}
					if (uOperator == 1) return c / (1.0 + c);
					if (uOperator == 2) return c * (l > 1e-9 ? 1.0 / (1.0 + l) : 0.0);
					if (uOperator == 3) return hable(c);
					return aces(c);
				}
				void main() {
					vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
					float l = dot(c, LUMA);
					c = l + (c - l) * uSaturation;
					c = 0.18 * pow(max(c, vec3(0.0)) / 0.18, uContrast) * uGain + uOffset;
					c = clamp(toneMap(c), 0.0, 1.0);
					gl_FragColor = vec4(pow(c, vec3(1.0 / uGamma)), 1.0);
				}`,
			depthTest: false,
			depthWrite: false,
		});
		this.quad = new FullScreenQuad(this.material);
	}

	set grading(g: GradingModel) {
		const u = this.material.uniforms;
		u.uOperator.value = OPERATOR_ID[g.toneMapper] ?? 0;
		(u.uSaturation.value as THREE.Vector3).set(...g.saturation);
		(u.uContrast.value as THREE.Vector3).set(...g.contrast);
		(u.uGain.value as THREE.Vector3).set(...g.gain);
		(u.uOffset.value as THREE.Vector3).set(...g.offset);
		u.uGamma.value = g.gamma;
	}

	set exposure(e: number) {
		this.material.uniforms.uExposure.value = e;
	}

	override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
		this.material.uniforms.tDiffuse.value = read.texture;
		renderer.setRenderTarget(this.renderToScreen ? null : write);
		if (this.clear) renderer.clear();
		this.quad.render(renderer);
	}

	override dispose(): void {
		this.material.dispose();
		this.quad.dispose();
	}
}

/** meter grid: each cell averages TAPS × TAPS samples of the HDR frame */
const METER_W = 48;
const METER_H = 27;
const TAPS = 4;
/** the meter's log2 encoding range, so its cells fit an 8-bit RGBA target (readable everywhere) */
const METER_LOG_RANGE = 12;

/**
 * Meters the HDR frame like the game's auto exposure: every pixel's luminance relative to the scene's own, softly
 * clamped (AUTO_EXPOSURE.knee), averaged over the frame. Reads the frame and leaves it as it is.
 */
class MeterPass extends Pass {
	private target = new THREE.WebGLRenderTarget(METER_W, METER_H, { type: THREE.UnsignedByteType, depthBuffer: false });
	private quad: FullScreenQuad;
	private material: THREE.ShaderMaterial;
	private pixels = new Uint8Array(METER_W * METER_H * 4);
	/** the last frame's metered average (1 = the scene with nothing bright in view) */
	value = 1;

	constructor() {
		super();
		this.needsSwap = false;
		this.material = new THREE.ShaderMaterial({
			uniforms: { tDiffuse: { value: null }, uReference: { value: 1 }, uKnee: { value: AUTO_EXPOSURE.knee } },
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}`,
			fragmentShader: /* glsl */ `
				uniform sampler2D tDiffuse;
				uniform float uReference;
				uniform float uKnee;
				varying vec2 vUv;
				void main() {
					vec2 cell = vec2(${1 / METER_W}, ${1 / METER_H});
					vec2 origin = vUv - 0.5 * cell;
					float sum = 0.0;
					for (int i = 0; i < ${TAPS}; i++) {
						for (int j = 0; j < ${TAPS}; j++) {
							vec2 at = origin + (vec2(float(i), float(j)) + 0.5) / ${TAPS.toFixed(1)} * cell;
							float r = max(dot(texture2D(tDiffuse, at).rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0) / uReference;
							sum += r / (1.0 + r / uKnee);
						}
					}
					// log2(1 + mean) over 0..${METER_LOG_RANGE}, split across two bytes
					float v = clamp(log2(1.0 + sum / ${(TAPS * TAPS).toFixed(1)}) / ${METER_LOG_RANGE.toFixed(1)}, 0.0, 1.0) * 255.0;
					float hi = floor(v);
					gl_FragColor = vec4(hi / 255.0, fract(v), 0.0, 1.0);
				}`,
			depthTest: false,
			depthWrite: false,
		});
		this.quad = new FullScreenQuad(this.material);
	}

	/** Luminance the meter counts as 1: the scene's own (the sky behind the particles) */
	set reference(lum: number) {
		this.material.uniforms.uReference.value = Math.max(lum, 1e-5);
	}

	override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
		this.material.uniforms.tDiffuse.value = read.texture;
		const before = renderer.getRenderTarget();
		const scissor = renderer.getScissorTest();
		renderer.setScissorTest(false);
		renderer.setRenderTarget(this.target);
		this.quad.render(renderer);
		renderer.readRenderTargetPixels(this.target, 0, 0, METER_W, METER_H, this.pixels);
		renderer.setRenderTarget(before);
		renderer.setScissorTest(scissor);
		let sum = 0;
		for (let i = 0; i < this.pixels.length; i += 4) sum += Math.pow(2, ((this.pixels[i] + this.pixels[i + 1] / 255) / 255) * METER_LOG_RANGE) - 1;
		this.value = sum / (METER_W * METER_H);
		this.onMetered?.(this.value);
	}

	/** called with each frame's metered average, before bloom and tone mapping run */
	onMetered: ((value: number) => void) | null = null;

	override dispose(): void {
		this.target.dispose();
		this.material.dispose();
		this.quad.dispose();
	}
}

/**
 * How exposure follows the screen: like the game over time, settled at once (single pictures), not at all, or
 * held where it is (a capture drawing the same moment twice)
 */
export type ExposureMode = 'adapt' | 'settled' | 'off' | 'hold';

/**
 * Vibrant Visuals approximation: HDR render, auto exposure, bloom, the pack's tone mapper. Particles are
 * pre-exposed in their shader for the settled scene (lit by the pack's sun/ambient, unlit and MERS-emissive ones
 * glowing); auto exposure then darkens everything when something bright is in view, as the game does.
 */
export class VibrantPipeline {
	private composer: EffectComposer;
	private renderPass: RenderPass;
	private meter: MeterPass;
	private bloom: UnrealBloomPass;
	private display: DisplayPass;
	private size = new THREE.Vector2();
	private adaptation = new AutoExposure();
	/** exposure of the last frame drawn, relative to the settled scene (1 = nothing bright in view) */
	exposure = 1;
	exposureMode: ExposureMode = 'adapt';

	constructor(
		private renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		camera: THREE.Camera,
	) {
		this.composer = new EffectComposer(renderer);
		this.renderPass = new RenderPass(scene, camera);
		this.meter = new MeterPass();
		// only HDR values (emissive, bright lit particles) bloom; strength and radius fitted to the halo around an
		// emissive wall in-game (within 15 levels of 255 from its edge out to a fifth of its width)
		this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_STRENGTH, 0, 1.0);
		this.bloom.compositeMaterial.uniforms.bloomFactors.value = BLOOM_LEVELS;
		this.composer.addPass(this.renderPass);
		this.composer.addPass(this.meter);
		this.display = new DisplayPass();
		this.composer.addPass(this.bloom);
		this.composer.addPass(this.display);
	}

	/** Back to the settled scene's exposure (a fresh start, like arriving somewhere dark) */
	resetExposure(): void {
		this.adaptation.reset();
		this.exposure = 1;
	}

	/** Particle shading inputs for the time of day: measured in-game, scaled by the pack's own lighting if it has one */
	static settings(lighting: LightingModel, timeOfDay: number, fromPack = false): VibrantSettings {
		const p = particleLight(lighting, timeOfDay, fromPack);
		return { light: p.light, haze: p.haze, additive: MEASURED_ADDITIVE_GAIN, emissive: p.emissive, desaturation: lighting.emissiveDesaturation };
	}

	private static solved = new Map<string, THREE.Color>();

	/** The linear HDR colour (at exposure 1) that the display transform turns into `display` (0–1), cached */
	static solve(grading: GradingModel, display: RGB): THREE.Color {
		const key = `${JSON.stringify(grading)}|${display.join(',')}`;
		const hit = VibrantPipeline.solved.get(key);
		if (hit) return hit;
		let c: RGB = display.map((v) => Math.pow(v, 2.2) * 0.5) as RGB;
		for (let it = 0; it < 60; it++) {
			const out = displayTransform(c, grading);
			const err = out.map((o, i) => display[i] - o) as RGB;
			if (Math.max(...err.map(Math.abs)) < 1e-6) break;
			// Gauss-Newton with a numeric Jacobian (columns per input channel)
			const h = Math.max(1e-7, Math.max(...c) * 1e-4);
			const J = [0, 1, 2].map((k) => {
				const d = [...c] as RGB;
				d[k] += h;
				return displayTransform(d, grading).map((o, i) => (o - out[i]) / h);
			});
			const m = new THREE.Matrix3().set(J[0][0], J[1][0], J[2][0], J[0][1], J[1][1], J[2][1], J[0][2], J[1][2], J[2][2]);
			if (Math.abs(m.determinant()) < 1e-18) break;
			const step = new THREE.Vector3(...err).applyMatrix3(m.invert());
			c = [Math.max(1e-7, c[0] + step.x), Math.max(1e-7, c[1] + step.y), Math.max(1e-7, c[2] + step.z)];
		}
		const color = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
		VibrantPipeline.solved.set(key, color);
		return color;
	}

	/** The sky behind particles, linear HDR: what displays as the game's sky near the horizon */
	static sky(timeOfDay: number, grading: GradingModel): THREE.Color {
		return VibrantPipeline.solve(grading, measuredParticleLight(timeOfDay).sky);
	}

	/** The linear colour that displays as `hex` does in the classic view, so Vibrant Visuals can keep the classic backdrop */
	static backdrop(grading: GradingModel, hex: number): THREE.Color {
		const c = new THREE.Color(hex);
		const srgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
		return VibrantPipeline.solve(grading, [srgb(c.r), srgb(c.g), srgb(c.b)]);
	}

	/**
	 * Draw a frame. `dt` is the time since the last one (auto exposure adapts over it); `reference` is the
	 * luminance of the scene behind the particles (linear), which the meter counts as 1.
	 */
	render(grading: GradingModel, viewport?: { x: number; y: number; w: number; h: number }, dt = 0, reference = 1): void {
		const r = this.renderer;
		r.getDrawingBufferSize(this.size);
		const w = viewport ? viewport.w : this.size.x / r.getPixelRatio();
		const h = viewport ? viewport.h : this.size.y / r.getPixelRatio();
		this.composer.setSize(w, h);
		this.display.grading = grading;
		this.meter.reference = reference;
		this.meter.enabled = this.exposureMode !== 'off' && this.exposureMode !== 'hold';
		// the meter runs before bloom and tone mapping, so this frame is already exposed for what it shows
		this.meter.onMetered = (value) => {
			this.exposure = this.exposureMode === 'settled' ? this.adaptation.settle(value) : this.adaptation.step(value, dt);
			this.display.exposure = this.exposure;
			// bloom picks out what is bright after exposure
			this.bloom.threshold = 1 / this.exposure;
		};
		if (this.exposureMode === 'off') this.exposure = 1;
		this.display.exposure = this.exposure;
		this.bloom.threshold = 1 / this.exposure;
		if (viewport) {
			r.setScissorTest(true);
			r.setScissor(viewport.x, viewport.y, viewport.w, viewport.h);
			r.setViewport(viewport.x, viewport.y, viewport.w, viewport.h);
		}
		this.composer.render();
		if (viewport) {
			r.setScissorTest(false);
			r.setViewport(0, 0, this.size.x / r.getPixelRatio(), this.size.y / r.getPixelRatio());
		}
	}

	dispose(): void {
		this.meter.dispose();
		this.composer.dispose();
	}
}
