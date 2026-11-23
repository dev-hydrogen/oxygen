<script lang="ts">
	import { evaluateCurve, type CurveDefinition, type MolangField } from 'wintersky';
	import { MolangAbort } from 'molangjs';
	import type { Workspace } from '../../state/workspace.svelte';
	import { molangContextFor } from '../../lib/field-context';
	import { joinPath } from '../../lib/molang-text';
	import MolangInput from '../fields/MolangInput.svelte';
	import Select from '../fields/Select.svelte';

	interface Props {
		workspace: Workspace;
	}

	let { workspace }: Props = $props();
	const session = $derived(workspace.active);
	let canvas = $state<HTMLCanvasElement>();
	let width = $state(400);
	const height = 220;

	const names = $derived.by(() => {
		void session?.version;
		const c = session?.doc.get('particle_effect/curves');
		return c && typeof c === 'object' ? Object.keys(c as object) : [];
	});
	let chosen = $state<string | null>(null);
	/** follow the selection when it points into a curve */
	const current = $derived.by(() => {
		const sel = session?.selected ?? '';
		const m = /^particle_effect\/curves\/([^/]+)/.exec(sel);
		const fromSel = m ? m[1].replace(/~1/g, '/').replace(/~0/g, '~') : null;
		const name = fromSel && names.includes(fromSel) ? fromSel : chosen && names.includes(chosen) ? chosen : names[0];
		return name ?? null;
	});
	const base = $derived(current ? joinPath('particle_effect/curves', current) : '');
	const raw = $derived.by(() => {
		void session?.version;
		return (base ? session?.doc.get(base) : null) as { type?: string; nodes?: unknown; input?: unknown; horizontal_range?: unknown } | null;
	});
	const def = $derived.by((): CurveDefinition | null => {
		void session?.version;
		return session?.def.curves.find((c) => c.name === current) ?? null;
	});
	const type = $derived((raw?.type as string) ?? 'linear');

	// ---------------------------------------------------------------- values, with what's being dragged

	/** values being dragged (Molang field path → number): drawn at once, written to the file a few times a second */
	let draft = $state<Record<string, number>>({});
	/** a bezier_chain key being dragged sideways: its key in the file → where it is now */
	let keyDraft = $state<{ from: string; to: number } | null>(null);

	/** Evaluate a node or setting with a copy of the emitter's variables (no side effects on the preview) */
	function value(f: MolangField | null): number {
		if (!f) return 0;
		const d = draft[f.path];
		if (d !== undefined) return d;
		if (f.constant !== null) return f.constant;
		const s = session;
		const e = s?.world.emitters[0];
		if (!s || !e) return 0;
		const env = s.world.createEnv(e.vars.slice());
		env.q = () => 0;
		try {
			const v = f.expr.run(env);
			return typeof v === 'number' ? v : 0;
		} catch (err) {
			if (err instanceof MolangAbort) return 0;
			return 0;
		}
	}

	type RawChainNode = { value?: unknown; left_value?: unknown; right_value?: unknown; slope?: unknown; left_slope?: unknown; right_slope?: unknown };
	const rawChain = $derived(raw?.nodes && typeof raw.nodes === 'object' && !Array.isArray(raw.nodes) ? (raw.nodes as Record<string, RawChainNode>) : {});

	/** the chain as drawn: each key with its text in the file, where a dragged one is now, sorted */
	const chainView = $derived.by(() => {
		const c = def;
		if (!c || c.type !== 'bezier_chain') return [];
		const keys = Object.keys(rawChain);
		return c.chain
			.map((n) => {
				const rawKey = keys.find((k) => parseFloat(k) === n.key) ?? String(n.key);
				return { ...n, key: keyDraft?.from === rawKey ? keyDraft.to : n.key, rawKey, raw: rawChain[rawKey] ?? {} };
			})
			.sort((a, b) => a.key - b.key);
	});

	const rangeValue = $derived(def?.range ? value(def.range) || 1 : 1);

	/** The curve's value at input `x`, as drawn (drafts included) */
	function evalAt(x: number): number {
		const c = def;
		if (!c) return 0;
		const cc = c.type === 'bezier_chain' ? { ...c, chain: chainView } : c;
		return evaluateCurve(cc, (f) => (f === c.input ? x : f === c.range ? rangeValue : value(f)));
	}

	function slopeAt(x: number, lo: number, hi: number): number {
		const h = Math.max(1e-4, (hi - lo) * 1e-3);
		const a = Math.max(lo, x - h);
		const b = Math.min(hi, x + h);
		return b > a ? (evalAt(b) - evalAt(a)) / (b - a) : 0;
	}

	const round = (v: number) => Math.round(v * 1000) / 1000;
	/** chain keys as the file writes them ("0.5", "1.0") */
	const keyText = (k: number) => (Number.isInteger(round(k)) ? round(k).toFixed(1) : String(round(k)));

	// ---------------------------------------------------------------- writing

	const pending = new Map<string, number>();
	let flushTimer: ReturnType<typeof setTimeout> | null = null;

	/** Show `v` for these fields now; write it to the file soon (one undo step per drag) */
	function put(docPath: string, fields: string[], v: number) {
		for (const f of fields) draft[f] = v;
		pending.set(docPath, v);
		flushTimer ??= setTimeout(flush, 70);
	}

	function flush() {
		if (flushTimer) clearTimeout(flushTimer);
		flushTimer = null;
		const s = session;
		if (!s || !pending.size) return;
		const writes = [...pending];
		pending.clear();
		s.doc.transact('Drag curve', () => {
			for (const [p, v] of writes) s.doc.set(p, v, 'Drag curve');
		});
	}

	// ---------------------------------------------------------------- what's on the graph

	interface Handle {
		id: string;
		x: number;
		y: number;
		/** on the curve; a control point that shapes it; a slope handle */
		role: 'node' | 'control' | 'tangent';
		/** the point a control or slope handle belongs to (drawn as a line) */
		from?: { x: number; y: number };
		/** the node it belongs to, by index (control points of bezier and catmull_rom curves) */
		anchor?: number;
		/** Molang, not a number: shown at its current value, edited as text */
		molang: boolean;
		/** the field selected when it's clicked */
		select: string;
		/** chain key it belongs to (the row to highlight) */
		chainKey?: string;
		/** what dragging it reads as */
		tip: (x: number, y: number) => string;
		drag?: (x: number, y: number) => void;
		/** dragging sideways moves it (chain keys) */
		movesX?: boolean;
	}

	interface View {
		x0: number;
		x1: number;
		y0: number;
		y1: number;
	}

	const graph = $derived.by(() => {
		const c = def;
		if (!c) return null;
		const range = rangeValue;
		const handles: Handle[] = [];
		/** where the curve is defined; it holds its end values outside */
		let lo = 0;
		let hi = range;
		const numeric = (f: MolangField) => f.constant !== null || draft[f.path] !== undefined;
		if (c.type === 'bezier_chain') {
			const ch = chainView;
			ch.forEach((n, i) => {
				const np = joinPath(base, 'nodes', n.rawKey);
				const vl = value(n.leftValue);
				const vr = value(n.rightValue);
				const splitV = n.raw.left_value !== undefined || n.raw.right_value !== undefined;
				const splitS = n.raw.left_slope !== undefined || n.raw.right_slope !== undefined;
				const prev = ch[i - 1];
				const next = ch[i + 1];
				const minKey = prev ? prev.key + 0.001 : -Infinity;
				const maxKey = next ? next.key - 0.001 : Infinity;
				const moveKey = (x: number) => (keyDraft = { from: n.rawKey, to: Math.min(maxKey, Math.max(minKey, x)) });
				const point = (side: 'both' | 'left' | 'right'): Handle => {
					const field = side === 'right' ? n.rightValue : n.leftValue;
					const fields = side === 'both' ? [n.leftValue.path, n.rightValue.path] : [field.path];
					const docPath = joinPath(np, side === 'both' ? 'value' : side === 'left' ? 'left_value' : 'right_value');
					const molang = side === 'both' ? !numeric(n.leftValue) || !numeric(n.rightValue) : !numeric(field);
					return {
						id: `${n.rawKey}:${side}`,
						x: n.key,
						y: side === 'right' ? vr : vl,
						role: 'node',
						molang,
						select: docPath,
						chainKey: n.rawKey,
						movesX: true,
						tip: (x, y) => `key ${keyText(x)} · ${side === 'left' ? 'before ' : side === 'right' ? 'after ' : ''}${fmt(y)}`,
						drag: (x, y) => {
							moveKey(x);
							put(docPath, fields, y);
						},
					};
				};
				if (splitV) handles.push(point('left'), point('right'));
				else handles.push(point('both'));
				// slope handles a third of the way to the neighbouring keys, where the game puts the control points
				const slopeHandle = (side: 'left' | 'right', span: number, at: number): Handle => {
					const field = side === 'left' ? n.leftSlope : n.rightSlope;
					const s = value(field);
					const dx = span / 3;
					const docPath = joinPath(np, splitS ? `${side}_slope` : 'slope');
					const fields = splitS ? [field.path] : [n.leftSlope.path, n.rightSlope.path];
					const sign = side === 'left' ? -1 : 1;
					return {
						id: `${n.rawKey}:${side}-slope`,
						x: n.key + sign * dx,
						y: at + sign * s * dx,
						role: 'tangent',
						from: { x: n.key, y: at },
						molang: !numeric(field),
						select: docPath,
						chainKey: n.rawKey,
						tip: (_x, y) => `slope ${fmt((sign * (y - at)) / dx)}`,
						drag: (_x, y) => put(docPath, fields, round((sign * (y - at)) / dx)),
					};
				};
				if (prev) handles.push(slopeHandle('left', n.key - prev.key, vl));
				if (next) handles.push(slopeHandle('right', next.key - n.key, vr));
			});
			lo = ch.length ? ch[0].key : 0;
			hi = ch.length ? ch[ch.length - 1].key : 1;
		} else {
			const n = c.nodes.length;
			c.nodes.forEach((node, i) => {
				let t: number;
				let role: Handle['role'] = 'node';
				let anchor: number | null = null;
				if (c.type === 'catmull_rom' && n >= 4) {
					t = (i - 1) / (n - 3);
					// the first and last nodes aren't on the curve: they set the slope at its ends
					if (i === 0 || i === n - 1) {
						role = 'control';
						anchor = i === 0 ? 1 : n - 2;
					}
				} else if (c.type === 'bezier' && n === 4) {
					t = i / 3;
					// the middle nodes pull the curve towards them without it passing through
					if (i === 1 || i === 2) {
						role = 'control';
						anchor = i === 1 ? 0 : 3;
					}
				} else t = n > 1 ? i / (n - 1) : 0;
				const docPath = joinPath(base, 'nodes', i);
				handles.push({
					id: `node:${i}`,
					x: t * range,
					y: value(node),
					role,
					molang: !numeric(node),
					select: docPath,
					tip: (_x, y) => `node ${i} · ${fmt(y)}`,
					drag: (_x, y) => put(docPath, [node.path], y),
					anchor: anchor ?? undefined,
				});
			});
			// lines from control points to the nodes they belong to
			for (const h of handles) if (h.anchor !== undefined) h.from = { x: handles[h.anchor].x, y: handles[h.anchor].y };
		}
		const xs = [lo, hi, ...handles.map((h) => h.x)];
		let x0 = Math.min(...xs);
		let x1 = Math.max(...xs);
		if (x1 - x0 < 1e-6) x1 = x0 + 1;
		const padX = (x1 - x0) * 0.06;
		x0 -= padX;
		x1 += padX;
		const samples: [number, number][] = [];
		const N = 240;
		for (let k = 0; k <= N; k++) {
			const x = x0 + ((x1 - x0) * k) / N;
			samples.push([x, evalAt(x)]);
		}
		const ys = [...samples.map((s) => s[1]), ...handles.map((h) => h.y)];
		let y0 = Math.min(...ys);
		let y1 = Math.max(...ys);
		if (y1 - y0 < 1e-6) {
			y0 -= 0.5;
			y1 += 0.5;
		}
		const padY = (y1 - y0) * 0.12;
		return { samples, handles, lo, hi, view: { x0, x1, y0: y0 - padY, y1: y1 + padY } as View };
	});

	/** the view stays put while something is dragged, so the point stays under the pointer */
	let frozen = $state<View | null>(null);
	const view = $derived(frozen ?? graph?.view ?? { x0: 0, x1: 1, y0: 0, y1: 1 });

	const PAD = { l: 42, r: 12, t: 12, b: 22 };
	const sx = (x: number) => PAD.l + ((x - view.x0) / (view.x1 - view.x0 || 1)) * (width - PAD.l - PAD.r);
	const sy = (y: number) => PAD.t + (1 - (y - view.y0) / (view.y1 - view.y0 || 1)) * (height - PAD.t - PAD.b);
	const fx = (px: number) => view.x0 + ((px - PAD.l) / (width - PAD.l - PAD.r)) * (view.x1 - view.x0);
	const fy = (py: number) => view.y0 + (1 - (py - PAD.t) / (height - PAD.t - PAD.b)) * (view.y1 - view.y0);

	let dragging = $state<Handle | null>(null);
	let selectedId = $state<string | null>(null);
	let hover = $state<{ x: number; px: number } | null>(null);
	let tip = $state<{ px: number; py: number; text: string } | null>(null);

	const selectedHandle = $derived(graph?.handles.find((h) => h.id === selectedId) ?? null);

	$effect(() => {
		const g = graph;
		const cv = canvas;
		void view;
		void hover;
		void tip;
		void selectedId;
		if (!cv) return;
		const dpr = window.devicePixelRatio || 1;
		cv.width = width * dpr;
		cv.height = height * dpr;
		const ctx = cv.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		if (!g) return;
		const css = getComputedStyle(cv);
		const col = (v: string) => css.getPropertyValue(v).trim() || '#888';
		ctx.font = '11px ' + col('--ox-font-ui');
		// outside its keys or range the curve holds its end values: shade those stretches
		ctx.fillStyle = 'rgba(223, 229, 240, 0.035)';
		if (sx(g.lo) > PAD.l) ctx.fillRect(PAD.l, PAD.t, sx(g.lo) - PAD.l, height - PAD.t - PAD.b);
		if (sx(g.hi) < width - PAD.r) ctx.fillRect(sx(g.hi), PAD.t, width - PAD.r - sx(g.hi), height - PAD.t - PAD.b);
		// grid
		ctx.strokeStyle = col('--ox-rule');
		ctx.fillStyle = col('--ox-text-dim');
		ctx.lineWidth = 1;
		for (const y of niceTicks(view.y0, view.y1, 4)) {
			ctx.beginPath();
			ctx.moveTo(PAD.l, Math.round(sy(y)) + 0.5);
			ctx.lineTo(width - PAD.r, Math.round(sy(y)) + 0.5);
			ctx.stroke();
			ctx.fillText(fmt(y), 4, sy(y) + 4);
		}
		for (const x of niceTicks(view.x0, view.x1, 6)) {
			ctx.beginPath();
			ctx.moveTo(Math.round(sx(x)) + 0.5, PAD.t);
			ctx.lineTo(Math.round(sx(x)) + 0.5, height - PAD.b);
			ctx.stroke();
			ctx.fillText(fmt(x), sx(x) - 8, height - 6);
		}
		// how control points and slopes pull on the curve
		ctx.setLineDash([3, 3]);
		ctx.strokeStyle = col('--ox-haze');
		ctx.lineWidth = 1;
		for (const h of g.handles) {
			if (!h.from) continue;
			ctx.beginPath();
			ctx.moveTo(sx(h.from.x), sy(h.from.y));
			ctx.lineTo(sx(h.x), sy(h.y));
			ctx.stroke();
		}
		// a step: the value arriving at a key and the value leaving it
		const steps = new Map<string, Handle[]>();
		for (const h of g.handles) if (h.role === 'node' && h.chainKey && /:(left|right)$/.test(h.id)) steps.set(h.chainKey, [...(steps.get(h.chainKey) ?? []), h]);
		for (const [, pair] of steps) {
			if (pair.length !== 2) continue;
			ctx.beginPath();
			ctx.moveTo(sx(pair[0].x), sy(pair[0].y));
			ctx.lineTo(sx(pair[1].x), sy(pair[1].y));
			ctx.stroke();
		}
		ctx.setLineDash([]);
		// curve
		ctx.strokeStyle = col('--ox-phase-particle');
		ctx.lineWidth = 1.7;
		ctx.beginPath();
		g.samples.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
		ctx.stroke();
		// handles
		for (const h of g.handles) {
			const x = sx(h.x);
			const y = sy(h.y);
			const hot = dragging?.id === h.id || selectedId === h.id;
			const accent = col('--ox-lox');
			ctx.beginPath();
			if (h.molang) {
				ctx.moveTo(x, y - 5);
				ctx.lineTo(x + 5, y);
				ctx.lineTo(x, y + 5);
				ctx.lineTo(x - 5, y);
				ctx.closePath();
				ctx.strokeStyle = accent;
				ctx.lineWidth = 1.5;
				ctx.stroke();
			} else if (h.role === 'control') {
				ctx.rect(x - 4, y - 4, 8, 8);
				ctx.fillStyle = col('--ox-panel');
				ctx.fill();
				ctx.strokeStyle = hot ? accent : col('--ox-frost');
				ctx.lineWidth = 1.5;
				ctx.stroke();
			} else if (h.role === 'tangent') {
				ctx.arc(x, y, 3.5, 0, Math.PI * 2);
				ctx.fillStyle = col('--ox-panel');
				ctx.fill();
				ctx.strokeStyle = hot ? accent : col('--ox-haze');
				ctx.lineWidth = 1.3;
				ctx.stroke();
			} else {
				ctx.arc(x, y, hot ? 5 : 4.5, 0, Math.PI * 2);
				ctx.fillStyle = hot ? accent : col('--ox-frost');
				ctx.fill();
			}
		}
		// readouts: what's being dragged, or the curve under the pointer
		const label = (text: string, px: number, py: number) => {
			const w = ctx.measureText(text).width + 10;
			const lx = Math.min(width - PAD.r - w, Math.max(PAD.l, px + 10));
			const ly = Math.max(PAD.t, py - 26);
			ctx.fillStyle = col('--ox-float');
			ctx.fillRect(lx, ly, w, 17);
			ctx.fillStyle = col('--ox-frost');
			ctx.fillText(text, lx + 5, ly + 12);
		};
		if (tip) label(tip.text, tip.px, tip.py);
		else if (hover) {
			ctx.strokeStyle = col('--ox-rule-strong');
			ctx.beginPath();
			ctx.moveTo(Math.round(hover.px) + 0.5, PAD.t);
			ctx.lineTo(Math.round(hover.px) + 0.5, height - PAD.b);
			ctx.stroke();
			const y = evalAt(hover.x);
			ctx.beginPath();
			ctx.arc(hover.px, sy(y), 2.5, 0, Math.PI * 2);
			ctx.fillStyle = col('--ox-phase-particle');
			ctx.fill();
			label(`${fmt(hover.x)} → ${fmt(y)}`, hover.px, sy(y));
		}
	});

	function tickStep(a: number, b: number, n: number): number {
		const span = b - a;
		if (!(span > 0)) return 1;
		const step0 = span / n;
		const mag = Math.pow(10, Math.floor(Math.log10(step0)));
		return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
	}
	function niceTicks(a: number, b: number, n: number): number[] {
		const step = tickStep(a, b, n);
		const out: number[] = [];
		for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
		return out;
	}
	function fmt(v: number) {
		return String(Math.round(v * 1000) / 1000);
	}
	/** snap to a tenth of the grid spacing; Shift drags freely */
	function snap(v: number, a: number, b: number, n: number, free: boolean): number {
		if (free) return round(v);
		const s = tickStep(a, b, n) / 10;
		return round(Math.round(v / s) * s);
	}

	function local(e: PointerEvent | MouseEvent) {
		const r = canvas!.getBoundingClientRect();
		return { px: e.clientX - r.left, py: e.clientY - r.top };
	}

	function hit(px: number, py: number): Handle | null {
		if (!graph) return null;
		let best: Handle | null = null;
		let bd = 10;
		for (const h of graph.handles) {
			// numbers before Molang, nodes before the handles drawn under them
			const d = Math.hypot(sx(h.x) - px, sy(h.y) - py) + (h.molang ? 2 : 0) + (h.role === 'tangent' ? 1 : 0);
			if (d < bd) {
				bd = d;
				best = h;
			}
		}
		return best;
	}

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		const { px, py } = local(e);
		const h = hit(px, py);
		if (!h || !session) return;
		selectedId = h.id;
		session.selected = h.select;
		if (h.molang || !h.drag) return; // Molang is edited as text below
		frozen = { ...view };
		dragging = h;
		canvas!.setPointerCapture(e.pointerId);
		session.doc.history.seal();
		// one drag is one undo step, however long it pauses
		session.doc.history.mergeMs = Infinity;
	}

	function move(e: PointerEvent) {
		const { px, py } = local(e);
		if (!dragging) {
			hover = px >= PAD.l && px <= width - PAD.r ? { x: fx(px), px } : null;
			canvas!.style.cursor = hit(px, py) ? 'grab' : 'crosshair';
			return;
		}
		const v = frozen!;
		const x = snap(fx(px), v.x0, v.x1, 6, e.shiftKey);
		const y = snap(fy(py), v.y0, v.y1, 4, e.shiftKey);
		// grow the view when dragging past its edge
		if (y > v.y1 || y < v.y0) frozen = { ...v, y0: Math.min(v.y0, y), y1: Math.max(v.y1, y) };
		dragging.drag!(dragging.movesX ? x : dragging.x, y);
		tip = { px, py, text: dragging.tip(dragging.movesX ? (keyDraft?.to ?? x) : dragging.x, y) };
	}

	function up(e: PointerEvent) {
		if (!dragging || !session) return;
		canvas!.releasePointerCapture(e.pointerId);
		flush();
		const kd = keyDraft;
		if (kd) {
			const next = keyText(kd.to);
			if (next !== kd.from && !(next in rawChain)) {
				session.doc.renameKey(joinPath(base, 'nodes', kd.from), next, 'Move curve key');
				if (selectedId?.startsWith(`${kd.from}:`)) selectedId = `${next}:${selectedId.slice(kd.from.length + 1)}`;
			}
		}
		session.doc.history.mergeMs = 800;
		session.doc.history.seal();
		draft = {};
		keyDraft = null;
		dragging = null;
		frozen = null;
		tip = null;
	}

	/** double-click a bezier chain to add a key there, on the curve as it is */
	function dbl(e: MouseEvent) {
		if (type !== 'bezier_chain') return;
		const { px, py } = local(e);
		if (hit(px, py)) return;
		addKey(round(fx(px)));
	}

	function key(e: KeyboardEvent) {
		if ((e.key === 'Delete' || e.key === 'Backspace') && selectedHandle && session) {
			e.preventDefault();
			const h = selectedHandle;
			if (h.chainKey) session.doc.remove(joinPath(base, 'nodes', h.chainKey), 'Remove curve key');
			else if (type !== 'bezier' && h.id.startsWith('node:')) session.doc.remove(joinPath(base, 'nodes', Number(h.id.slice(5))), 'Remove curve node');
			selectedId = null;
		}
	}

	// ---------------------------------------------------------------- editing

	/** A key on the curve as it is (its value and slope there), so adding it doesn't change the shape */
	function addKey(at?: number) {
		if (!session || !base) return;
		const keys = chainView.map((n) => n.key);
		let x = at;
		if (x === undefined) {
			if (!keys.length) x = 0;
			else if (keys.length === 1) x = keys[0] + 1;
			else {
				// the middle of the widest gap
				let best = 0;
				for (let i = 1; i < keys.length - 1; i++) if (keys[i + 1] - keys[i] > keys[best + 1] - keys[best]) best = i;
				x = (keys[best] + keys[best + 1]) / 2;
			}
		}
		const k = keyText(x);
		if (k in rawChain) return;
		const lo = keys.length ? Math.min(keys[0], x) : x - 1;
		const hi = keys.length ? Math.max(keys[keys.length - 1], x) : x + 1;
		session.doc.set(joinPath(base, 'nodes', k), { value: round(evalAt(x)), slope: round(keys.length > 1 ? slopeAt(x, lo, hi) : 0) }, 'Add curve key');
		selectedId = `${k}:both`;
	}

	/** a different value arriving at a key than leaving it (a step), or one value */
	function toggleStep(k: string, split: boolean) {
		const s = session;
		if (!s) return;
		const np = joinPath(base, 'nodes', k);
		const n = rawChain[k] ?? {};
		s.doc.transact(split ? 'Join curve key values' : 'Split curve key values', () => {
			if (split) {
				const v = n.left_value ?? n.right_value ?? n.value ?? 0;
				s.doc.remove(joinPath(np, 'left_value'));
				s.doc.remove(joinPath(np, 'right_value'));
				s.doc.set(joinPath(np, 'value'), v);
			} else {
				const v = n.value ?? 0;
				s.doc.set(joinPath(np, 'left_value'), v);
				s.doc.set(joinPath(np, 'right_value'), v);
				s.doc.remove(joinPath(np, 'value'));
			}
		});
	}

	/** a different slope arriving at a key than leaving it (a corner), or one slope */
	function toggleBreak(k: string, split: boolean) {
		const s = session;
		if (!s) return;
		const np = joinPath(base, 'nodes', k);
		const n = rawChain[k] ?? {};
		s.doc.transact(split ? 'Join curve key slopes' : 'Break curve key slope', () => {
			if (split) {
				const v = n.left_slope ?? n.right_slope ?? n.slope ?? 0;
				s.doc.remove(joinPath(np, 'left_slope'));
				s.doc.remove(joinPath(np, 'right_slope'));
				s.doc.set(joinPath(np, 'slope'), v);
			} else {
				const v = n.slope ?? 0;
				s.doc.set(joinPath(np, 'left_slope'), v);
				s.doc.set(joinPath(np, 'right_slope'), v);
				s.doc.remove(joinPath(np, 'slope'));
			}
		});
	}

	function moveKey(from: string, text: string) {
		const k = Number(text);
		if (!session || !Number.isFinite(k)) return;
		const next = keyText(k);
		if (next === from || next in rawChain) return;
		session.doc.renameKey(joinPath(base, 'nodes', from), next, 'Move curve key');
	}

	/** Change the type, keeping the curve's shape: the new nodes are sampled from the curve as it is */
	function setType(t: string) {
		const s = session;
		const c = def;
		if (!s || !base || !c || t === type) return;
		let from = 0;
		let to = rangeValue;
		if (c.type === 'bezier_chain' && chainView.length) {
			from = chainView[0].key;
			to = chainView[chainView.length - 1].key;
			if (to - from < 1e-6) to = from + 1;
		}
		const f = (u: number) => evalAt(from + (to - from) * u);
		const count = c.type === 'bezier_chain' ? chainView.length : c.type === 'catmull_rom' ? c.nodes.length - 2 : c.nodes.length;
		const n = Math.min(8, Math.max(t === 'linear' ? 2 : 3, count));
		const samples = Array.from({ length: n }, (_, i) => round(f(i / (n - 1))));
		s.doc.transact('Change curve type', () => {
			s.doc.set(joinPath(base, 'type'), t);
			if (t === 'bezier_chain') {
				const chain: Record<string, { value: number; slope: number }> = {};
				samples.forEach((v, i) => {
					const x = from + ((to - from) * i) / (n - 1);
					chain[keyText(x)] = { value: v, slope: round(slopeAt(x, from, to)) };
				});
				s.doc.set(joinPath(base, 'nodes'), chain);
				s.doc.remove(joinPath(base, 'horizontal_range'));
			} else {
				let nodes: number[];
				if (t === 'linear') nodes = samples;
				else if (t === 'catmull_rom') {
					// end nodes continue the first and last stretch, so the ends aren't bent
					nodes = [round(2 * samples[0] - samples[1]), ...samples, round(2 * samples[n - 1] - samples[n - 2])];
				} else {
					// the cubic through the curve's values at 0, ⅓, ⅔ and 1
					const p0 = f(0);
					const p3 = f(1);
					const A = 27 * f(1 / 3) - 8 * p0 - p3;
					const B = 27 * f(2 / 3) - p0 - 8 * p3;
					nodes = [p0, (2 * A - B) / 18, (2 * B - A) / 18, p3].map(round);
				}
				s.doc.set(joinPath(base, 'nodes'), nodes);
				if (c.type === 'bezier_chain') s.doc.set(joinPath(base, 'horizontal_range'), round(to));
				else if (raw?.horizontal_range === undefined) s.doc.set(joinPath(base, 'horizontal_range'), 1);
			}
		});
		selectedId = null;
	}

	function rename(next: string) {
		if (!session || !current) return;
		let n = next.trim().toLowerCase();
		if (!n) return;
		if (n.startsWith('v.')) n = `variable.${n.slice(2)}`;
		if (!n.startsWith('variable.')) n = `variable.${n}`;
		if (n === current || names.includes(n)) return;
		session.doc.renameKey(base, n, 'Rename curve');
		chosen = n;
	}

	const nodeList = $derived(Array.isArray(raw?.nodes) ? (raw!.nodes as unknown[]) : []);
	const selectedKey = $derived(selectedHandle?.chainKey ?? null);
	const selectedNode = $derived(selectedHandle?.id.startsWith('node:') ? Number(selectedHandle.id.slice(5)) : null);
	const nodeRole = (i: number) =>
		type === 'bezier' && (i === 1 || i === 2) ? 'control point' : type === 'catmull_rom' && nodeList.length >= 4 && (i === 0 || i === nodeList.length - 1) ? 'end slope' : null;
</script>

<div class="curves" bind:clientWidth={width}>
	{#if session && current && raw}
		<div class="head">
			<select aria-label="Curve" value={current} onchange={(e) => (chosen = e.currentTarget.value)}>
				{#each names as n (n)}<option value={n}>{n.replace(/^variable\./, 'v.')}</option>{/each}
			</select>
			<input class="name ox-code" aria-label="Curve variable" value={current.replace(/^variable\./, 'v.')} onchange={(e) => rename(e.currentTarget.value)} />
			<div class="type">
				<Select
					value={type}
					label="Curve type"
					options={[
						{ value: 'linear', label: 'Linear' },
						{ value: 'catmull_rom', label: 'Catmull-Rom' },
						{ value: 'bezier', label: 'Bezier (4 nodes)' },
						{ value: 'bezier_chain', label: 'Bezier chain (keyed)' },
					]}
					onchange={setType}
				/>
			</div>
			<button class="link danger" onclick={() => session.doc.remove(base, 'Remove curve')}>Remove</button>
		</div>
		<div class="settings">
			<label class="row"><span>Input</span><MolangInput {session} path={joinPath(base, 'input')} label="Curve input" placeholder="0" context={molangContextFor(session, joinPath(base, 'input'))} /></label>
			{#if type !== 'bezier_chain'}
				<label class="row"><span>Range</span><MolangInput {session} path={joinPath(base, 'horizontal_range')} label="Curve horizontal range" placeholder="1" context={molangContextFor(session, joinPath(base, 'horizontal_range'))} /></label>
			{:else}
				<p class="note">No range: a Bezier chain’s keys are input values.</p>
			{/if}
		</div>
		<canvas
			bind:this={canvas}
			style:width="{width}px"
			style:height="{height}px"
			tabindex="0"
			aria-label="Curve graph for {current}. Drag points to change them; Delete removes the selected one."
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			onpointerleave={() => (hover = null)}
			ondblclick={dbl}
			onkeydown={key}
		></canvas>
		<p class="legend">
			<span><span class="dot"></span> on the curve</span>
			{#if type === 'bezier' || type === 'catmull_rom'}<span><span class="sq"></span> {type === 'bezier' ? 'control point' : 'end node (slope)'}</span>{/if}
			{#if type === 'bezier_chain'}<span><span class="ring"></span> slope handle</span>{/if}
			<span><span class="dia"></span> Molang, edited below</span>
			<span class="dim">Shift: no snap{type === 'bezier_chain' ? '; double-click adds a key' : ''}</span>
		</p>
		<div class="nodes">
			{#if type === 'bezier_chain'}
				{#each chainView as n (n.rawKey)}
					{@const np = joinPath(base, 'nodes', n.rawKey)}
					{@const splitV = n.raw.left_value !== undefined || n.raw.right_value !== undefined}
					{@const splitS = n.raw.left_slope !== undefined || n.raw.right_slope !== undefined}
					<div class="chain" class:sel={selectedKey === n.rawKey}>
						<input class="key ox-num" aria-label="Key" title="The input value this key sits at" value={n.rawKey} onchange={(e) => moveKey(n.rawKey, e.currentTarget.value)} />
						<div class="fields">
							<div class="line">
								{#if splitV}
									<span class="sub">before</span>
									<MolangInput {session} path={joinPath(np, 'left_value')} label="Value arriving at {n.rawKey}" placeholder="0" context={molangContextFor(session, joinPath(np, 'left_value'))} />
									<span class="sub">after</span>
									<MolangInput {session} path={joinPath(np, 'right_value')} label="Value leaving {n.rawKey}" placeholder="0" context={molangContextFor(session, joinPath(np, 'right_value'))} />
								{:else}
									<span class="sub">value</span>
									<MolangInput {session} path={joinPath(np, 'value')} label="Value at {n.rawKey}" placeholder="0" context={molangContextFor(session, joinPath(np, 'value'))} />
								{/if}
								<button class="tog" aria-pressed={splitV} title="Step: the curve arrives at one value and leaves from another (left_value / right_value)" onclick={() => toggleStep(n.rawKey, splitV)}>Step</button>
							</div>
							<div class="line">
								{#if splitS}
									<span class="sub">slope in</span>
									<MolangInput {session} path={joinPath(np, 'left_slope')} label="Slope arriving at {n.rawKey}" placeholder="0" context={molangContextFor(session, joinPath(np, 'left_slope'))} />
									<span class="sub">out</span>
									<MolangInput {session} path={joinPath(np, 'right_slope')} label="Slope leaving {n.rawKey}" placeholder="0" context={molangContextFor(session, joinPath(np, 'right_slope'))} />
								{:else}
									<span class="sub">slope</span>
									<MolangInput {session} path={joinPath(np, 'slope')} label="Slope at {n.rawKey}" placeholder="0" context={molangContextFor(session, joinPath(np, 'slope'))} />
								{/if}
								<button class="tog" aria-pressed={splitS} title="Corner: a different slope arriving than leaving (left_slope / right_slope)" onclick={() => toggleBreak(n.rawKey, splitS)}>Corner</button>
							</div>
						</div>
						<button class="x" aria-label="Remove key {n.rawKey}" onclick={() => session.doc.remove(np, 'Remove curve key')}>×</button>
					</div>
				{/each}
				<button class="link" onclick={() => addKey()}>Add key</button>
			{:else}
				{#each nodeList as _, i (i)}
					{@const np = joinPath(base, 'nodes', i)}
					{@const role = nodeRole(i)}
					<div class="node" class:sel={selectedNode === i}>
						<span class="sub ox-num">{i}</span>
						<MolangInput {session} path={np} label="Node {i}" placeholder="0" context={molangContextFor(session, np)} />
						{#if role}<span class="role">{role}</span>{/if}
						<button class="x" aria-label="Remove node {i}" disabled={type === 'bezier'} onclick={() => session.doc.remove(np, 'Remove curve node')}>×</button>
					</div>
				{/each}
				{#if type !== 'bezier'}<button class="link" onclick={() => session.doc.insert(joinPath(base, 'nodes'), round(evalAt(rangeValue)), undefined, 'Add curve node')}>Add node</button>{/if}
			{/if}
		</div>
	{:else if session}
		<div class="empty">
			<p>No curves yet.</p>
			<button
				class="primary"
				onclick={() =>
					session.doc.set(
						joinPath('particle_effect/curves', 'variable.curve_1'),
						{ type: 'linear', input: 'v.particle_age', horizontal_range: 'v.particle_lifetime', nodes: [0, 1, 0] },
						'Add curve',
						(keys) => (keys.indexOf('components') >= 0 ? keys.indexOf('components') : keys.length),
					)}>Add curve</button
			>
		</div>
	{/if}
</div>

<style>
	.curves {
		height: 100%;
		overflow: auto;
		padding-bottom: 20px;
	}
	.head {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 6px 8px;
		border-bottom: 1px solid var(--ox-rule);
	}
	select,
	.name,
	.key {
		height: 22px;
		background: var(--ox-input);
		border: 1px solid transparent;
		border-radius: var(--ox-radius);
		padding: 0 6px;
		outline: none;
	}
	select option {
		background: var(--ox-float);
	}
	.name {
		width: 150px;
	}
	.name:focus,
	.key:focus {
		border-color: var(--ox-lox);
	}
	.type {
		width: 180px;
		display: flex;
	}
	.settings {
		padding: 6px 8px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.row {
		display: grid;
		grid-template-columns: 60px 1fr;
		gap: 6px;
		align-items: start;
		color: var(--ox-haze);
	}
	.row > span {
		line-height: 22px;
	}
	canvas {
		display: block;
		cursor: crosshair;
		touch-action: none;
		outline: none;
	}
	.legend {
		margin: 2px 10px 8px;
		color: var(--ox-text-dim);
		font-size: 11px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
	}
	.legend > span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ox-frost);
		display: inline-block;
	}
	.sq {
		width: 7px;
		height: 7px;
		border: 1.5px solid var(--ox-frost);
		display: inline-block;
	}
	.ring {
		width: 7px;
		height: 7px;
		border: 1.3px solid var(--ox-haze);
		border-radius: 50%;
		display: inline-block;
	}
	.dia {
		width: 7px;
		height: 7px;
		border: 1.5px solid var(--ox-lox);
		transform: rotate(45deg);
		display: inline-block;
	}
	.nodes {
		padding: 0 8px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.node,
	.chain {
		display: flex;
		gap: 4px;
		align-items: flex-start;
		border-radius: var(--ox-radius);
		padding: 2px;
	}
	.chain {
		padding: 4px 2px;
		border-bottom: 1px solid var(--ox-rule);
	}
	.node.sel,
	.chain.sel {
		background: var(--ox-selection);
	}
	.fields {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.line {
		display: flex;
		gap: 4px;
		align-items: flex-start;
	}
	.sub {
		color: var(--ox-text-dim);
		line-height: 22px;
		min-width: 14px;
		text-align: right;
		white-space: nowrap;
	}
	.role {
		color: var(--ox-text-dim);
		font-size: 11px;
		line-height: 22px;
		white-space: nowrap;
	}
	.key {
		width: 56px;
	}
	.tog {
		height: 22px;
		padding: 0 7px;
		border: 1px solid var(--ox-rule-strong);
		border-radius: var(--ox-radius);
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		font-size: 11px;
		flex: none;
	}
	.tog[aria-pressed='true'] {
		color: var(--ox-frost);
		background: var(--ox-selection);
		border-color: var(--ox-lox);
	}
	.x {
		border: none;
		background: none;
		color: var(--ox-haze);
		cursor: pointer;
		width: 20px;
		height: 22px;
	}
	.x:hover:not(:disabled) {
		color: var(--ox-frost);
	}
	.x:disabled {
		opacity: 0.3;
	}
	.link {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--ox-lox);
		cursor: pointer;
		padding: 2px 0;
	}
	.link.danger {
		margin-left: auto;
		color: var(--ox-haze);
	}
	.link:hover {
		text-decoration: underline;
	}
	.note {
		margin: 0;
		color: var(--ox-text-dim);
		font-size: 11.5px;
	}
	.dim {
		color: var(--ox-text-dim);
	}
	.empty {
		padding: 20px 16px;
		color: var(--ox-haze);
		max-width: 52ch;
	}
	.primary {
		background: var(--ox-lox);
		color: #10131c;
		border: none;
		border-radius: var(--ox-radius);
		height: 26px;
		padding: 0 12px;
		font-weight: 600;
		cursor: pointer;
	}
</style>
