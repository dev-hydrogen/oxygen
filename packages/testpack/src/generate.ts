import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITY_TESTS, placeE32, RIG_EFFECTS, RIG_KINDS, rigBehaviors, rigClients, rigGeometry, rigProbes, rigTexture } from './entity';
import { MARKERS, TESTS, probeCurves, probeEvents, type Json, type TestCase } from './tests';
import { SCOPE_TESTS, SLOT_COLOURS, scopeBehaviors, scopeClient, scopeCommands, scopeEffects, scopeGeometry, scopeTexture } from './scope';
import { testTextureSets, testTextures } from './textures';

export const PACK = {
	name: 'Oxygen Test Pack',
	version: [0, 1, 0] as [number, number, number],
	rpUuid: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c01',
	rpModule: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c02',
	bpUuid: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c03',
	bpData: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c04',
	bpScript: '6f0a3b0e-1d1f-4c62-9a35-0b7e8f1a2c05',
	minEngine: [1, 26, 0] as [number, number, number],
	serverModule: '2.10.0',
};

/** Station layout in the flat test world */
export const LAYOUT = {
	floorY: -61,
	probeY: -58,
	rowSpacing: 40,
	probeSpacing: 2,
};

export function rowZ(index: number) {
	return (index + 1) * LAYOUT.rowSpacing;
}

export function cameraFor(test: { probes: unknown[]; spacing?: number }, index: number, view: 'front' | 'behind' | 'above' | 'frontleft' | 'frontright' | 'away') {
	const n = test.probes.length;
	const spacing = test.spacing ?? LAYOUT.probeSpacing;
	const cx = ((n - 1) * spacing) / 2;
	const z = rowZ(index);
	const dist = Math.max(6, (n - 1) * spacing * 0.8 + 3);
	const eye = 1.62;
	const y = LAYOUT.probeY;
	const r = (v: number) => Math.round(v * 100) / 100;
	switch (view) {
		case 'behind':
			return `tp @s ${r(cx)} ${r(y - eye)} ${r(z + dist)} facing ${r(cx)} ${y} ${z}`;
		case 'above':
			return `tp @s ${r(cx)} ${r(y + dist - eye)} ${r(z - 0.01)} facing ${r(cx)} ${y} ${z}`;
		case 'frontleft': // camera on the +X side (screen-left when looking south)
			return `tp @s ${r(cx + dist * 0.6)} ${r(y - eye)} ${r(z - dist * 0.8)} facing ${r(cx)} ${y} ${z}`;
		case 'frontright':
			return `tp @s ${r(cx - dist * 0.6)} ${r(y - eye)} ${r(z - dist * 0.8)} facing ${r(cx)} ${y} ${z}`;
		case 'away': // where the front view stands, facing the other way
			return `tp @s ${r(cx)} ${r(y - eye)} ${r(z - dist)} facing ${r(cx)} ${y} ${r(z - dist - 10)}`;
		default:
			return `tp @s ${r(cx)} ${r(y - eye)} ${r(z - dist)} facing ${r(cx)} ${y} ${z}`;
	}
}

function writeJson(path: string, data: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(data, null, '\t'));
}

export function generate(outDir: string) {
	rmSync(outDir, { recursive: true, force: true });
	const rp = join(outDir, 'oxygen_testpack_rp');
	const bp = join(outDir, 'oxygen_testpack_bp');

	writeJson(join(rp, 'manifest.json'), {
		format_version: 2,
		header: { name: `${PACK.name} RP`, description: 'Oxygen in-game verification tests', uuid: PACK.rpUuid, version: PACK.version, min_engine_version: PACK.minEngine },
		modules: [{ type: 'resources', uuid: PACK.rpModule, version: PACK.version }],
		// lets Vibrant Visuals run with the pack active (and read its texture sets): t65
		capabilities: ['pbr'],
	});
	writeJson(join(bp, 'manifest.json'), {
		format_version: 2,
		header: { name: `${PACK.name} BP`, description: 'Oxygen in-game verification tests', uuid: PACK.bpUuid, version: PACK.version, min_engine_version: PACK.minEngine },
		modules: [
			{ type: 'data', uuid: PACK.bpData, version: PACK.version },
			{ type: 'script', language: 'javascript', uuid: PACK.bpScript, version: PACK.version, entry: 'scripts/main.js' },
		],
		dependencies: [
			{ uuid: PACK.rpUuid, version: PACK.version },
			{ module_name: '@minecraft/server', version: PACK.serverModule },
		],
	});

	for (const [path, png] of Object.entries(testTextures())) {
		const file = join(rp, path + '.png');
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, png);
	}
	for (const [path, set] of Object.entries(testTextureSets())) writeJson(join(rp, path + '.texture_set.json'), set);

	const setup: string[] = [
		'# Oxygen test lab setup',
		'gamerule dodaylightcycle false',
		'gamerule doweathercycle false',
		'gamerule domobspawning false',
		'gamerule showcoordinates true',
		'gamerule sendcommandfeedback false',
		'time set noon',
		'weather clear',
		'gamemode spectator @s',
		'hud @s hide all',
		'tickingarea remove oxygen_lab',
	];
	const all: string[] = [];
	const checklist: string[] = [
		'# Oxygen in-game test checklist',
		'',
		`Pack: ${PACK.name} ${PACK.version.join('.')} — RP + BP (scripts need @minecraft/server ${PACK.serverModule}).`,
		'Run `/function oxygen/setup` once, then `/function oxygen/<test>` and look at the probes left → right.',
		`Probe markers (wool under each probe, left → right): ${MARKERS.slice(0, 10).join(', ')}.`,
		'',
	];

	TESTS.forEach((test, index) => {
		const z = rowZ(index);
		// <id>_cam moves the camera first (so chunks load); <id> then places blocks and spawns
		const fn: string[] = [`# ${test.id}: ${test.title}`, cameraFor(test, index, 'front')];
		const cam = [cameraFor(test, index, 'front')];
		checklist.push(`## ${test.id} — ${test.title}`, '', `**Question:** ${test.question}`, '', `**Engine assumption:** ${test.assumption}`, '', ...(test.lookAway ? [`The function turns the camera away after ${test.lookAway.after}s for ${test.lookAway.seconds}s, then back (don't move).`, ''] : []), `Wait ${test.wait}s, then screenshot.`, '');
		test.probes.forEach((p, j) => {
			const x = j * (test.spacing ?? LAYOUT.probeSpacing);
			const id = `oxygen:${test.id}_${p.id}`;
			const json = structuredClone(p.effect) as Json;
			if (test.formatVersion) json.format_version = test.formatVersion;
			json.particle_effect.description.identifier = id;
			const events = p.events ?? probeEvents(test.id, p.id);
			if (events) json.particle_effect.events = events;
			const curves = p.curves ?? probeCurves(test.id, p.id);
			if (curves) json.particle_effect.curves = curves;
			writeJson(join(rp, 'particles', `${test.id}_${p.id}.json`), json);
			for (const [cid, child] of Object.entries(p.children ?? {})) {
				const c = structuredClone(child) as Json;
				c.particle_effect.description.identifier = `${id}_${cid}`;
				writeJson(join(rp, 'particles', `${test.id}_${p.id}_${cid}.json`), c);
			}
			fn.push(`setblock ${x} ${LAYOUT.floorY} ${z} ${MARKERS[j % MARKERS.length]}_wool`);
			for (const b of p.blocks ?? []) {
				fn.push(`setblock ${x + b.dx} ${LAYOUT.floorY + 1 + b.dy} ${z + b.dz} ${b.block}`);
			}
			const y = LAYOUT.probeY + (p.spawnDy ?? 0);
			if (p.script) {
				const msg = JSON.stringify({ effect: id, pos: [x, y, z], vars: p.script.vars });
				fn.push(`scriptevent oxygen:spawn ${msg}`);
			} else {
				fn.push(`particle ${id} ${x} ${y} ${z}`);
			}
			checklist.push(`- **${p.id}** (${MARKERS[j % MARKERS.length]}): ${p.reads}`);
		});
		if (test.lookAway) {
			const turn = { after: test.lookAway.after, seconds: test.lookAway.seconds, away: cameraFor(test, index, 'away'), back: cameraFor(test, index, 'front') };
			fn.push(`scriptevent oxygen:look_away ${JSON.stringify(turn)}`);
		}
		checklist.push('');
		mkdirSync(join(bp, 'functions', 'oxygen'), { recursive: true });
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}.mcfunction`), fn.join('\n') + '\n');
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_cam.mcfunction`), cam.join('\n') + '\n');
		if (test.lookAway) writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_away.mcfunction`), cameraFor(test, index, 'away') + '\n');
		for (const view of test.views ?? []) {
			if (view === 'front') continue;
			writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_${view}.mcfunction`), cameraFor(test, index, view) + '\n');
		}
		all.push(`function oxygen/${test.id}`);
	});
	// entity tests: the rig and its effects, one row each after the particle tests
	{
		// e32's red flags are coded with each rig's own world position
		const k = ENTITY_TESTS.findIndex((t) => t.id === 'e32');
		const test = ENTITY_TESTS[k];
		const z = rowZ(TESTS.length + k);
		placeE32(test.probes.map((_, j) => [j * (test.spacing ?? LAYOUT.probeSpacing), LAYOUT.floorY + 1, z]));
	}
	for (const [name, fx] of Object.entries(RIG_EFFECTS)) {
		const json = structuredClone(fx) as Json;
		json.particle_effect.description.identifier = `oxygen:rig_${name}`;
		writeJson(join(rp, 'particles', `rig_${name}.json`), json);
	}
	writeJson(join(rp, 'models', 'entity', 'oxygen_rig.geo.json'), rigGeometry());
	const client = rigClients();
	for (const [kind, e] of Object.entries(client.entities)) writeJson(join(rp, 'entity', `oxygen_${kind}.entity.json`), e);
	writeJson(join(rp, 'animations', 'oxygen_rig.animation.json'), client.animations);
	writeJson(join(rp, 'animation_controllers', 'oxygen_rig.animation_controllers.json'), client.controllers);
	writeJson(join(rp, 'render_controllers', 'oxygen_rig.render_controllers.json'), client.renderController);
	mkdirSync(join(rp, 'textures', 'entity'), { recursive: true });
	writeFileSync(join(rp, 'textures', 'entity', 'oxygen_rig.png'), rigTexture());
	for (const [kind, e] of Object.entries(rigBehaviors())) writeJson(join(bp, 'entities', `oxygen_${kind}.json`), e);
	const variants = new Map(rigProbes().map((r) => [r.probe, r.variant]));
	ENTITY_TESTS.forEach((test, k) => {
		const index = TESTS.length + k;
		const z = rowZ(index);
		const spacing = test.spacing ?? LAYOUT.probeSpacing;
		const fn: string[] = [`# ${test.id}: ${test.title}`, cameraFor(test, index, 'front'), ...Object.keys(RIG_KINDS).map((k) => `event entity @e[type=oxygen:${k}] oxygen:despawn`)];
		checklist.push(`## ${test.id} — ${test.title}`, '', `**Question:** ${test.question}`, '', `**Engine assumption:** ${test.assumption}`, '', `Wait ${test.wait}s, then screenshot.`, '');
		test.probes.forEach((p, j) => {
			const x = j * spacing;
			const v = variants.get(p)!;
			fn.push(`setblock ${x} ${LAYOUT.floorY} ${z} ${MARKERS[j % MARKERS.length]}_wool`);
			for (const b of p.blocks ?? []) fn.push(`setblock ${x + b.dx} ${LAYOUT.floorY + 1 + b.dy} ${z + b.dz} ${b.block}`);
			fn.push(`summon oxygen:${p.rig ?? 'rig'} ${x} ${LAYOUT.floorY + 1} ${z} ${p.yaw ?? 0} 0 oxygen:v${v}`);
			if (p.move) fn.push(`scriptevent oxygen:move ${JSON.stringify({ variant: v, ...p.move })}`);
			for (const l of p.later ?? []) fn.push(`scriptevent oxygen:later ${JSON.stringify({ variant: v, after: l.after, command: l.command })}`);
			checklist.push(`- **${p.id}** (${MARKERS[j % MARKERS.length]}): ${p.reads}`);
		});
		checklist.push('');
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}.mcfunction`), fn.join('\n') + '\n');
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_cam.mcfunction`), cameraFor(test, index, 'front') + '\n');
		for (const view of test.views ?? []) writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_${view}.mcfunction`), cameraFor(test, index, view) + '\n');
	});
	// temp and context scope tests (s01…): their own entities, one row each after the entity tests
	for (const [name, fx] of Object.entries(scopeEffects())) {
		const json = structuredClone(fx) as Json;
		json.particle_effect.description.identifier = `oxygen:scope_${name}`;
		writeJson(join(rp, 'particles', `scope_${name}.json`), json);
	}
	const scope = scopeClient();
	writeJson(join(rp, 'models', 'entity', 'oxygen_scope.geo.json'), scopeGeometry());
	writeJson(join(rp, 'models', 'entity', 'oxygen_scope_item.geo.json'), scope.attachableGeometry);
	for (const [kind, e] of Object.entries(scope.entities)) writeJson(join(rp, 'entity', `oxygen_${kind}.entity.json`), e);
	for (const [k, a] of Object.entries(scope.attachables)) writeJson(join(rp, 'attachables', `oxygen_scope_item_${k}.attachable.json`), a);
	// animations that try to write c.* (probably a load error) get a file of their own, away from the rest
	const writesContext = (a: Json) => /\bc\.\w+\s*=[^=]/.test(JSON.stringify(a));
	const anims = Object.entries(scope.animations.animations as Json);
	writeJson(join(rp, 'animations', 'oxygen_scope.animation.json'), { ...scope.animations, animations: Object.fromEntries(anims.filter(([, a]) => !writesContext(a))) });
	writeJson(join(rp, 'animations', 'oxygen_scope_context.animation.json'), { ...scope.animations, animations: Object.fromEntries(anims.filter(([, a]) => writesContext(a))) });
	writeJson(join(rp, 'animation_controllers', 'oxygen_scope.animation_controllers.json'), scope.controllers);
	writeJson(join(rp, 'render_controllers', 'oxygen_scope.render_controllers.json'), scope.renderControllers);
	writeFileSync(join(rp, 'textures', 'entity', 'oxygen_scope.png'), scopeTexture([150, 150, 160]));
	writeFileSync(join(rp, 'textures', 'entity', 'oxygen_scope_b.png'), scopeTexture([200, 170, 120]));
	const scopeBp = scopeBehaviors();
	for (const [kind, e] of Object.entries(scopeBp.entities)) writeJson(join(bp, 'entities', `oxygen_${kind}.json`), e);
	for (const [k, item] of Object.entries(scopeBp.items)) writeJson(join(bp, 'items', `oxygen_scope_item_${k}.json`), item);
	writeJson(join(bp, 'animations', 'oxygen_scope_srv.animation.json'), scopeBp.animations);
	writeJson(join(bp, 'animation_controllers', 'oxygen_scope_srv.animation_controllers.json'), scopeBp.controllers);
	SCOPE_TESTS.forEach((test, k) => {
		const index = TESTS.length + ENTITY_TESTS.length + k;
		const z = rowZ(index);
		const view = { probes: test.stations, spacing: test.spacing ?? 5 };
		const fn = [`# ${test.id}: ${test.title}`, cameraFor(view, index, 'front'), ...scopeCommands(test, z, LAYOUT.floorY, MARKERS)];
		checklist.push(`## ${test.id} — ${test.title}`, '', `**Question:** ${test.question}`, '', `**Engine assumption:** ${test.assumption}`, '', `Wait ${test.wait}s, then screenshot.`, '');
		test.stations.forEach((st, j) => checklist.push(`- **${st.id}** (${MARKERS[j % MARKERS.length]}): ${st.reads}`));
		checklist.push('');
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}.mcfunction`), fn.join('\n') + '\n');
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_cam.mcfunction`), cameraFor(view, index, 'front') + '\n');
		writeFileSync(join(bp, 'functions', 'oxygen', `${test.id}_frontleft.mcfunction`), cameraFor(view, index, 'frontleft') + '\n');
	});
	checklist.push(
		'Scope tests (s01…): temps are never cleared, so run each one first after loading the world; on a second run a reader may see what the first run wrote.',
		`Scope reader cube colours by slot: ${SLOT_COLOURS.map((c, i) => `${i + 1} ${c}`).join(', ')}.`,
		'',
	);
	mkdirSync(join(bp, 'functions', 'oxygen'), { recursive: true });
	writeFileSync(join(bp, 'functions', 'oxygen', 'setup.mcfunction'), setup.join('\n') + '\n');
	writeFileSync(join(bp, 'functions', 'oxygen', 'all.mcfunction'), all.join('\n') + '\n');

	mkdirSync(join(bp, 'scripts'), { recursive: true });
	writeFileSync(
		join(bp, 'scripts', 'main.js'),
		`import { system, world, MolangVariableMap } from '@minecraft/server';

// /scriptevent oxygen:spawn {"effect":"ns:id","pos":[x,y,z],"vars":{"variable.size":0.3},"dimension":"overworld"}
system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id !== 'oxygen:spawn') return;
	try {
		const data = JSON.parse(event.message);
		const vars = new MolangVariableMap();
		for (const [name, value] of Object.entries(data.vars ?? {})) vars.setFloat(name, value);
		const [x, y, z] = data.pos;
		world.getDimension(data.dimension ?? 'overworld').spawnParticle(data.effect, { x, y, z }, vars);
	} catch (error) {
		console.warn('oxygen:spawn failed: ' + error);
	}
});

// /scriptevent oxygen:at {"after":1,"command":"summon …"}: run a command in the overworld after a delay (scope tests)
system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id !== 'oxygen:at') return;
	try {
		const m = JSON.parse(event.message);
		system.runTimeout(() => {
			try {
				world.getDimension('overworld').runCommand(m.command);
			} catch (error) {
				console.warn('oxygen:at ' + m.command + ' failed: ' + error);
			}
		}, Math.round(m.after * 20));
	} catch (error) {
		console.warn('oxygen:at failed: ' + error);
	}
});

// /scriptevent oxygen:look_away {"after":1,"seconds":3,"away":"tp @s …","back":"tp @s …"}: turn the player who ran
// it away from the probes and back again on game ticks (emitter culling tests)
// the rig with a given variant (entity tests)
function rig(variant) {
	return world.getDimension('overworld').getEntities({ type: 'oxygen:rig' }).find((e) => e.getComponent('minecraft:variant')?.value === variant);
}

// /scriptevent oxygen:move {"variant":3,"kind":"circle","radius":2,"speed":2,"after":0,"seconds":20}: move a rig on
// game ticks (circle and line teleport it, facing the way it goes; push gives it one impulse along +X)
system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id !== 'oxygen:move') return;
	try {
		const m = JSON.parse(event.message);
		const start = system.currentTick + Math.round((m.after ?? 0) * 20);
		const end = start + Math.round((m.seconds ?? 20) * 20);
		let origin = null;
		const id = system.runInterval(() => {
			const e = rig(m.variant);
			const tick = system.currentTick;
			if (!e || tick > end) return system.clearRun(id);
			if (tick < start) return;
			if (!origin) origin = { ...e.location };
			const t = (tick - start) / 20;
			const speed = m.speed ?? 2;
			if (m.kind === 'drive') {
				// a real velocity (blocks per tick) the game moves it by
				e.clearVelocity();
				e.applyImpulse({ x: speed / 20, y: 0, z: 0 });
				return;
			}
			if (m.kind === 'push') {
				if (tick === start) e.applyImpulse({ x: speed, y: 0, z: 0 });
				return;
			}
			if (m.kind === 'circle') {
				const r = m.radius ?? 2;
				const a = (t * speed) / r;
				// starts at the origin, heading +X... round a centre at origin + (0, 0, r)
				const pos = { x: origin.x + Math.sin(a) * r, y: origin.y, z: origin.z + r - Math.cos(a) * r };
				const yaw = -((a * 180) / Math.PI) - 90;
				e.teleport(pos, { rotation: { x: 0, y: yaw } });
			} else {
				const len = m.radius ?? 4;
				const period = (2 * len) / speed;
				const p = (t % period) / period;
				const s = p < 0.5 ? p * 2 : 2 - p * 2;
				e.teleport({ x: origin.x + s * len, y: origin.y, z: origin.z }, { rotation: { x: 0, y: p < 0.5 ? -90 : 90 } });
			}
		}, 1);
	} catch (error) {
		console.warn('oxygen:move failed: ' + error);
	}
});

// /scriptevent oxygen:later {"variant":3,"after":2,"command":"..."}: run a command as the rig after a delay
system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id !== 'oxygen:later') return;
	try {
		const m = JSON.parse(event.message);
		system.runTimeout(() => rig(m.variant)?.runCommand(m.command), Math.round(m.after * 20));
	} catch (error) {
		console.warn('oxygen:later failed: ' + error);
	}
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id !== 'oxygen:look_away' || !event.sourceEntity) return;
	try {
		const data = JSON.parse(event.message);
		const who = event.sourceEntity;
		system.runTimeout(() => who.runCommand(data.away), Math.round(data.after * 20));
		system.runTimeout(() => who.runCommand(data.back), Math.round((data.after + data.seconds) * 20));
	} catch (error) {
		console.warn('oxygen:look_away failed: ' + error);
	}
});
`,
	);
	writeFileSync(join(outDir, 'CHECKLIST.md'), checklist.join('\n'));
	return { rp, bp, tests: TESTS.length, probes: TESTS.reduce((s, t) => s + t.probes.length, 0) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
	const r = generate(out);
	console.log(`Generated ${r.tests} tests / ${r.probes} probes → ${out}`);
}
