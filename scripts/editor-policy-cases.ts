/* Generated timelines and gestures for the edit-policy reference
 * (`migrate-editor-to-shared-rust-core`, tasks 4.2 and 4.10).
 *
 * Self-contained on purpose: the VUI kernel these traces were first compared
 * against is gone, so nothing here imports it. `scripts/editor-policy.test.ts`
 * runs every case through the WASM policies and holds each trace to the digest
 * the kernel produced, frozen in `packages/shared/src/editor/reference/`. */
import { createHash } from "node:crypto";
import type { Engine } from "../packages/shared/src/editor/engine.ts";

export type PlacementPolicy = "magnetic" | "free";
export type OverlapStrategy = "permit" | "reject" | "overwrite" | "insert";
export type TrimKind = "trim" | "ripple" | "slip" | "slide" | "roll";
export interface SnapCandidate {
	ticks: number;
	kind: string;
	itemId?: string;
}
interface SnapSettings {
	thresholdPx: number;
	scale: number;
	bypass?: boolean;
}
export interface MoveUpdate {
	deltaTicks: number;
	yPx?: number;
	snap?: SnapSettings;
	deliberate?: boolean;
}
export interface TrimUpdate {
	deltaTicks: number;
	snap?: SnapSettings;
}
interface MoveIntent {
	id: string;
	candidates: SnapCandidate[];
}
interface TrimIntent {
	id: string;
	edge: "start" | "end";
	kind: TrimKind;
	neighbourId?: string;
	candidates?: SnapCandidate[];
}

export interface ItemSpec {
	id: string;
	rowId?: string;
	startTicks: number;
	durationTicks: number;
	kind: string;
	source?: { inPointTicks: number; availableStartTicks: number; availableEndTicks: number };
	groupId?: string;
	linkedTo?: string[];
}
export interface RowSpec {
	id: string;
	placement: PlacementPolicy;
	overlap: OverlapStrategy;
}
export interface AxisSpec {
	rows: { id: string; heightPx: number; accepts?: string[] }[];
	refusal: "decline" | "reroute";
	reroutes?: Record<string, Record<string, string | null>>;
}
export interface Spec {
	rows: RowSpec[];
	items: ItemSpec[];
	crossAxis?: AxisSpec;
}

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const FRAME = 1000;
const KINDS = ["scene", "video", "text", "audio"];

export function generate(seed: number): Spec {
	const next = random(seed);
	const pick = <T>(choices: readonly T[]): T => choices[Math.floor(next() * choices.length)]!;
	const rows: RowSpec[] = [
		{ id: "base", placement: "magnetic", overlap: "insert" },
		{
			id: "free",
			placement: "free",
			overlap: pick(["permit", "reject", "overwrite", "insert"] as const),
		},
		{ id: "strict", placement: "free", overlap: "reject" },
	];
	const items: ItemSpec[] = [];
	let cursor = 0;
	for (let index = 0; index < 4; index++) {
		const duration = (20 + Math.floor(next() * 40)) * FRAME;
		const media = next() < 0.7;
		items.push({
			id: `b${index}`,
			rowId: "base",
			kind: "scene",
			startTicks: cursor,
			durationTicks: duration,
			...(media
				? {
						source: {
							inPointTicks: Math.floor(next() * 30) * FRAME,
							availableStartTicks: 0,
							availableEndTicks: (40 + Math.floor(next() * 100)) * FRAME,
						},
					}
				: {}),
		});
		cursor += duration;
	}
	for (let index = 0; index < 5; index++) {
		const row = pick(["free", "strict"]);
		items.push({
			id: `f${index}`,
			rowId: row,
			kind: pick(KINDS.slice(1)),
			startTicks: Math.floor(next() * 200) * FRAME,
			durationTicks: (10 + Math.floor(next() * 50)) * FRAME,
			...(next() < 0.5
				? {
						source: {
							inPointTicks: Math.floor(next() * 20) * FRAME,
							availableStartTicks: 0,
							availableEndTicks: (30 + Math.floor(next() * 60)) * FRAME,
						},
					}
				: {}),
			...(next() < 0.25 ? { groupId: "g" } : {}),
		});
	}
	/* A linked pair: audio that must take the same trim as its picture. */
	if (next() < 0.5) {
		items.push({
			id: "pic",
			rowId: "free",
			kind: "video",
			startTicks: 300 * FRAME,
			durationTicks: 40 * FRAME,
			source: { inPointTicks: 10 * FRAME, availableStartTicks: 0, availableEndTicks: 60 * FRAME },
			linkedTo: ["snd"],
		});
		items.push({
			id: "snd",
			rowId: "strict",
			kind: "audio",
			startTicks: 300 * FRAME,
			durationTicks: 40 * FRAME,
			source: { inPointTicks: 5 * FRAME, availableStartTicks: 0, availableEndTicks: 90 * FRAME },
			linkedTo: ["pic"],
		});
	}
	const crossAxis: AxisSpec = {
		rows: [
			{ id: "base", heightPx: 64, accepts: ["scene", "video"] },
			{ id: "free", heightPx: 40 },
			{ id: "strict", heightPx: 24, accepts: ["text", "audio"] },
		],
		refusal: pick(["decline", "reroute"] as const),
		...(next() < 0.5
			? {
					reroutes: {
						video: { strict: "free" },
						scene: { free: null, strict: "base" },
						text: { base: "strict" },
						audio: { base: "strict" },
					},
				}
			: {}),
	};
	return { rows, items, crossAxis };
}

/* Every item edge on a row, start-sorted — what `rowEdgeCandidates` offered. */
function edgeCandidates(spec: Spec, rowId: string | undefined): SnapCandidate[] {
	return spec.items
		.filter((item) => item.rowId === rowId)
		.sort((a, b) => a.startTicks - b.startTicks)
		.flatMap((item) => [
			{ ticks: item.startTicks, kind: "item-start", itemId: item.id },
			{ ticks: item.startTicks + item.durationTicks, kind: "item-end", itemId: item.id },
		]);
}

export type Gesture =
	| {
			policy: "move";
			intent: Omit<MoveIntent, "crossAxis"> & { crossAxis: boolean };
			updates: MoveUpdate[];
	  }
	| { policy: "trim"; intent: TrimIntent; updates: TrimUpdate[] };

export function gestures(spec: Spec, seed: number): Gesture[] {
	const next = random(seed * 7 + 1);
	const out: Gesture[] = [];
	const snapOf = (bypass: boolean) => ({ thresholdPx: 8, scale: 0.08 / FRAME, bypass });
	for (const item of spec.items) {
		const candidates: SnapCandidate[] = [
			...edgeCandidates(spec, item.rowId),
			{ ticks: 120 * FRAME, kind: "playhead" },
		];
		const deltas = [
			-500 * FRAME,
			-7 * FRAME - 300,
			-FRAME,
			3 * FRAME,
			11 * FRAME + 40,
			400 * FRAME,
		].map((delta) => delta + Math.floor(next() * 3) * 37);
		out.push({
			policy: "move",
			intent: { id: item.id, candidates, crossAxis: true },
			updates: deltas.map((deltaTicks, index) => ({
				deltaTicks,
				...(index % 3 === 0 ? {} : { yPx: [10, 70, 100, 130, -5, 500][index]! }),
				...(index % 2 === 0 ? { snap: snapOf(index === 4) } : {}),
				...(index === 3 ? { deliberate: true } : {}),
			})),
		});
		out.push({
			policy: "move",
			intent: { id: item.id, candidates: [], crossAxis: false },
			updates: [{ deltaTicks: -3 * FRAME }, { deltaTicks: 9 * FRAME }],
		});
		const kinds: TrimKind[] = ["trim", "ripple", "slip", "slide", "roll"];
		for (const kind of kinds) {
			for (const edge of ["start", "end"] as const) {
				if ((kind === "slip" || kind === "slide") && edge === "end") continue;
				const neighbour = spec.items.find(
					(other) =>
						other.rowId === item.rowId && other.startTicks === item.startTicks + item.durationTicks,
				)?.id;
				out.push({
					policy: "trim",
					intent: {
						id: item.id,
						edge,
						kind,
						...(kind === "roll" && neighbour ? { neighbourId: neighbour } : {}),
						candidates,
					},
					updates: deltas.map((deltaTicks, index) => ({
						deltaTicks,
						...(index % 2 === 1 ? { snap: snapOf(index === 5) } : {}),
					})),
				});
			}
		}
	}
	out.push({
		policy: "move",
		intent: { id: "missing", candidates: [], crossAxis: true },
		updates: [{ deltaTicks: FRAME }],
	});
	return out;
}

/* ---- Running a gesture through each ----------------------------------------- */

export interface Trace {
	projections: object[];
	commit: object;
	again: object;
}

function unwrap(
	result: { ok: true; value: string } | { ok: false; error: { message: string } },
): object {
	if (!result.ok) throw new Error(result.error.message);
	// SAFETY: every engine gesture call returns a JSON object on success.
	return JSON.parse(result.value) as object;
}

export function runRust(
	engine: Engine,
	spec: Spec,
	gesture: Gesture,
	endWith: "commit" | "rollback",
): Trace {
	const intent =
		gesture.policy === "move"
			? { policy: "move", ...gesture.intent }
			: { policy: "trim", ...gesture.intent };
	const opened = engine.gestureOpen(JSON.stringify(spec), JSON.stringify({ id: "g", intent }));
	if (!opened.ok) throw new Error(opened.error.message);
	const handle = opened.value;
	const projections = gesture.updates.map((sample) =>
		unwrap(engine.gestureUpdate(handle, JSON.stringify(sample))),
	);
	const ended = unwrap(
		endWith === "commit" ? engine.gestureCommit(handle) : engine.gestureRollback(handle),
	);
	const again = unwrap(engine.gestureCommit(handle));
	engine.gestureClose(handle);
	return { projections, commit: ended, again };
}

/* Key order is not part of a trace: both sides are hashed with sorted keys. */
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, inner]) => [key, canonical(inner)]),
		);
	return value;
}

export function traceDigest(trace: Trace): string {
	return createHash("sha256")
		.update(JSON.stringify(canonical(trace)))
		.digest("hex")
		.slice(0, 16);
}

/** Every case, in the order the frozen digests are listed. */
export function policyCases(): {
	seed: number;
	spec: Spec;
	gesture: Gesture;
	endWith: "commit" | "rollback";
}[] {
	const cases: { seed: number; spec: Spec; gesture: Gesture; endWith: "commit" | "rollback" }[] =
		[];
	for (let seed = 1; seed <= 40; seed++) {
		const spec = generate(seed);
		for (const gesture of gestures(spec, seed))
			for (const endWith of ["commit", "rollback"] as const)
				cases.push({ seed, spec, gesture, endWith });
	}
	return cases;
}
