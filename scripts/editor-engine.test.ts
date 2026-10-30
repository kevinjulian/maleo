/* Budgets for the Rust editor engine's WASM build (`migrate-editor-to-shared-rust-core`,
 * task 2.5). Measured 2026-10-08 on an M-series Mac; numbers and reasoning are in
 * the change's design.md "Measured budgets".
 *
 * - Size: the module the editor route will lazy-load.
 * - Per edit through a handle: what crosses the boundary must not grow with the
 *   document, and neither may the time, because the engine shares every part of
 *   the scope an edit does not change. A deep copy per edit measured 4.9 ms at
 *   2000 clips; shared parts measure ~0.04 ms. */
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
	instantiateEngine,
	type Engine,
	type EditScope,
} from "../packages/shared/src/editor/index.ts";
import { buildEditorWasm, loadParityInputs } from "./editor-engine.mts";

/* 128 KB gzip / 450 KB raw until the edit policies joined the module (task 4.2,
 * 2026-10-09): one module for commands and gestures measured 158,799 B gzip /
 * 470,075 B raw, and the budget was raised rather than split into two modules
 * that would each ship serde_json. */
/* 176 KB gzip since task 4.10 (2026-10-09): the execution delta, timecode
 * formatting and media-drop snapping joined the module (171,054 B gzip). */
/* 188 KB gzip since `p1-app-core` task 3.2 (2026-10-23): the undo ledger,
 * pending queue and selection rules joined the module, 175,917 B -> 191,023 B
 * gzip and 470,213 B -> 513,616 B raw (+8.6% / +9.2%, under that change's 10%
 * stop line). */
/* 240 KB gzip / 620 KB raw since `p2-preview-editing` task 3.1 (2026-10-24): the
 * canvas editing rules (screen mapping, hit testing, gestures, group and mask
 * boxes, the edit command) joined the module, 515,419 B -> 627,108 B raw and
 * 191,441 B -> 241,311 B gzip (+21.7% / +26.1%, over that change's 10% stop
 * line). A size pass (one object builder, one sort) recovered 9 KB raw; the
 * rest is the rules and libm's trigonometry. The user chose one module with a
 * raised budget over a second module that would ship serde_json again. */
/* `p2-media-playback` (2026-10-27): shared readiness measured 709,094 B raw /
 * 267,126 B gzip. User accepted increased limits to retain one editor module. */
const MAX_GZIP_BYTES = 270 * 1024;
const MAX_RAW_BYTES = 700 * 1024;
const MAX_EDIT_TRANSFER_BYTES = 4 * 1024;
const MAX_EDIT_MEDIAN_MS_AT_2000_CLIPS = 0.5;
/* Task 4.2: a pointer sample shares a ~16 ms frame with paint, so one policy
 * call (update in, projection out) is held to 0.1 ms median, and its bytes to
 * 1 KB plus a fixed share per item the edit changes. A ripple's projection
 * lists every item it shifts, exactly as the TS kernel's does, so its size
 * follows the edit; what must not happen is growth with the timeline. */
const MAX_POLICY_CALL_BYTES = 1024;
/* A projected item (`{"id","rowId","startTicks","durationTicks","sourceInTicks"}`)
 * measured ~90 B: 11,291 B for a ripple shifting 125 items. */
const MAX_POLICY_BYTES_PER_CHANGED_ITEM = 96;
const MAX_POLICY_MEDIAN_MS_AT_2000_CLIPS = 0.1;

let wasm: Uint8Array<ArrayBuffer>;
let engine: Engine;
let source: EditScope["doc"]["clips"];
let base: EditScope;

beforeAll(async () => {
	wasm = new Uint8Array(readFileSync(buildEditorWasm()));
	engine = await instantiateEngine(wasm);
	const { corpus } = loadParityInputs();
	source = corpus.flatMap((scope) => scope.doc.clips);
	base = corpus[0]!;
});

/* A timeline of `count` real clips (corpus shapes, fresh ids). */
function timeline(count: number): EditScope {
	const clips = Array.from({ length: count }, (_, i) => ({
		...source[i % source.length]!,
		id: `${source[i % source.length]!.type}:${i + 1}`,
		startSec: i,
	}));
	return { ...base, doc: { ...base.doc, clips } };
}

interface EditCost {
	maxTransfer: number;
	medianMs: number;
	/** The most items one projection changed (policy calls only). */
	maxChanged?: number;
}

/* `executeDelta` is the web editor's path (task 4.5): the inverse plus the
 * parts of the scope the edit replaced, so the host can rebuild its copy. */
function measureEdits(count: number, call: "execute" | "executeDelta" = "execute"): EditCost {
	const scope = timeline(count);
	const opened = engine.open(JSON.stringify(scope));
	if (!opened.ok) throw new Error(opened.error.message);
	const times: number[] = [];
	let maxTransfer = 0;
	for (let i = 0; i < 300; i++) {
		const command = JSON.stringify({
			type: "clip.move",
			id: scope.doc.clips[(i * 7) % count]!.id,
			patch: { startSec: i * 0.5 },
		});
		const started = performance.now();
		const result = engine[call](opened.value, command);
		times.push(performance.now() - started);
		if (!result.ok) throw new Error(result.error.message);
		maxTransfer = Math.max(maxTransfer, command.length + result.value.length);
	}
	engine.close(opened.value);
	times.sort((a, b) => a - b);
	return { maxTransfer, medianMs: times[times.length >> 1]! };
}

/* A 2000-item timeline as the edit policies read it: a magnetic base row and
 * free lanes, media behind half the items, and a cross axis with rules. */
interface PolicyFixture {
	/** The state JSON a gesture opens over. */
	state: string;
	ids: string[];
	/** Every item edge, as the content editor supplies them. */
	candidates: { ticks: number; kind: string; itemId: string }[];
}

function policyState(count: number): PolicyFixture {
	const rows = [
		{ id: "base", placement: "magnetic", overlap: "insert" },
		...Array.from({ length: 7 }, (_, i) => ({
			id: `lane${i}`,
			placement: "free",
			overlap: i % 2 ? "permit" : "reject",
		})),
	];
	const items = Array.from({ length: count }, (_, i) => {
		const lane = i % 8 === 0 ? "base" : `lane${i % 7}`;
		return {
			id: `item${i}`,
			rowId: lane,
			kind: lane === "base" ? "scene" : "video",
			startTicks: Math.floor(i / 8) * 31_000,
			durationTicks: 30_000,
			...(i % 2
				? { source: { inPointTicks: 5_000, availableStartTicks: 0, availableEndTicks: 90_000 } }
				: {}),
		};
	});
	const crossAxis = {
		rows: rows.map((row, i) => ({
			id: row.id,
			heightPx: i ? 32 : 56,
			...(i ? {} : { accepts: ["scene"] }),
		})),
		refusal: "reroute",
	};
	const candidates = items.flatMap((item) => [
		{ ticks: item.startTicks, kind: "item-start", itemId: item.id },
		{ ticks: item.startTicks + item.durationTicks, kind: "item-end", itemId: item.id },
	]);
	return {
		state: JSON.stringify({ rows, items, crossAxis }),
		ids: items.map((item) => item.id),
		candidates,
	};
}

function measurePolicy(
	count: number,
	intent: (id: string, candidates: unknown[]) => object,
	sample: (i: number) => object,
): EditCost {
	const { state, ids, candidates } = policyState(count);
	const opened = engine.gestureOpen(
		state,
		JSON.stringify({ id: "budget", intent: intent(ids[Math.floor(count / 2) + 1]!, candidates) }),
	);
	if (!opened.ok) throw new Error(opened.error.message);
	const times: number[] = [];
	let maxTransfer = 0;
	let maxChanged = 0;
	for (let i = 0; i < 300; i++) {
		const update = JSON.stringify(sample(i));
		const started = performance.now();
		const result = engine.gestureUpdate(opened.value, update);
		times.push(performance.now() - started);
		if (!result.ok) throw new Error(result.error.message);
		const changed = (JSON.parse(result.value) as { items: unknown[] }).items.length;
		maxChanged = Math.max(maxChanged, changed);
		/* Bytes beyond the per-item share are what is checked against the fixed budget. */
		maxTransfer = Math.max(
			maxTransfer,
			update.length + result.value.length - changed * MAX_POLICY_BYTES_PER_CHANGED_ITEM,
		);
	}
	engine.gestureClose(opened.value);
	times.sort((a, b) => a - b);
	return { maxTransfer, medianMs: times[times.length >> 1]!, maxChanged };
}

describe("editor engine budgets", () => {
	test("the WASM module stays within its size budget", () => {
		expect(wasm.length).toBeLessThanOrEqual(MAX_RAW_BYTES);
		expect(gzipSync(wasm, { level: 9 }).length).toBeLessThanOrEqual(MAX_GZIP_BYTES);
	});

	for (const call of ["execute", "executeDelta"] as const) {
		test(`an edit through a handle (${call}) costs the same bytes at any document size`, () => {
			const small = measureEdits(60, call);
			const large = measureEdits(2000, call);
			expect(large.maxTransfer).toBeLessThanOrEqual(MAX_EDIT_TRANSFER_BYTES);
			expect(large.maxTransfer / small.maxTransfer).toBeLessThan(1.1);
			expect(large.medianMs).toBeLessThanOrEqual(MAX_EDIT_MEDIAN_MS_AT_2000_CLIPS);
		}, 120_000);
	}

	test("a policy call per pointer sample stays inside a frame's share at 2000 items", () => {
		const drag = measurePolicy(
			2000,
			(id, candidates) => ({ policy: "move", id, candidates, crossAxis: true }),
			(i) => ({
				deltaTicks: (i % 40) * 977 - 19_000,
				yPx: (i * 13) % 300,
				snap: { thresholdPx: 8, scale: 0.00008 },
			}),
		);
		const ripple = measurePolicy(
			2000,
			(id, candidates) => ({ policy: "trim", id, edge: "end", kind: "ripple", candidates }),
			(i) => ({ deltaTicks: (i % 30) * 613 - 9_000, snap: { thresholdPx: 8, scale: 0.00008 } }),
		);
		for (const [name, cost] of [
			["drag", drag],
			["ripple", ripple],
		] as const) {
			expect(
				cost.maxTransfer,
				`${name} bytes per call beyond ${MAX_POLICY_BYTES_PER_CHANGED_ITEM} B per changed item`,
			).toBeLessThanOrEqual(MAX_POLICY_CALL_BYTES);
			/* V8 coverage instrumentation slows every call, so a coverage run
			 * (`MALEO_COVERAGE=1`, set by root `bun run test`) checks bytes only;
			 * `vp test` and the workspace scripts still enforce the time. */
			if (process.env.MALEO_COVERAGE !== "1") {
				expect(cost.medianMs, `${name} median ms at 2000 items`).toBeLessThanOrEqual(
					MAX_POLICY_MEDIAN_MS_AT_2000_CLIPS,
				);
			}
		}
		/* The ripple really shifted a long row, so the per-item share was exercised. */
		expect(ripple.maxChanged ?? 0).toBeGreaterThan(100);
	}, 120_000);
});
