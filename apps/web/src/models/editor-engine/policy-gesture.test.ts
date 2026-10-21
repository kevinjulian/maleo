/* The web's gesture handle on the Rust edit policies (`migrate-editor-to-shared-rust-core`,
 * tasks 4.5 and 4.10).
 *
 * `scripts/editor-policy.test.ts` holds the policies to the retired VUI kernel
 * on timelines described as data. This holds the web's own conversion — a
 * timeline-view state and a live cross-axis adapter turned into that data — to
 * the same kernel: the kernel's projections and commits for these gestures were
 * frozen in `policy-gesture.reference.json` the day it was retired. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCrossAxis } from "@models/timeline-view/cross-axis.ts";
import { multiRowFree } from "@models/timeline-view/fixtures.ts";
import { testEngine } from "./engine-fixture.ts";
import { openPolicyGesture, type MoveUpdate, type TrimKind } from "./policy-gesture.ts";

interface Reference {
	samples: MoveUpdate[];
	moves: { id: string; projections: unknown[]; terminal: unknown }[];
	trims: { id: string; kind: TrimKind; projection: unknown; terminal: unknown }[];
}

// SAFETY: the committed reference file, written once by the kernel comparison it replaces.
const reference = JSON.parse(
	readFileSync(join(import.meta.dirname, "policy-gesture.reference.json"), "utf8"),
) as Reference;
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("policy gesture", () => {
	const state = multiRowFree();
	const [refusing] = state.rows.slice(1);
	/* One row refuses every kind but one, and refusals reroute: the axis crosses as data. */
	const axis = createCrossAxis(
		state.rows.map((row) => ({ id: row.id, heightPx: 40 })),
		{
			accepts: (rowId, item) => rowId !== refusing?.id || item.kind === "audio",
			refusal: "reroute",
		},
	);

	test("every item's move projects and commits as the kernel's did, across rows", () => {
		expect(reference.moves.map((move) => move.id)).toEqual([...state.order]);
		for (const move of reference.moves) {
			const gesture = openPolicyGesture(
				testEngine,
				"g",
				state,
				{ policy: "move", id: move.id, candidates: [] },
				axis,
			);
			reference.samples.forEach((sample, index) =>
				expect(plain(gesture.update(sample)), `${move.id} sample ${index}`).toEqual(
					move.projections[index],
				),
			);
			expect(plain(gesture.commit()), move.id).toEqual(move.terminal);
		}
		expect(testEngine.gestureOpenCount()).toBe(0);
	});

	test("trims and ripples agree with the kernel and release their handle", () => {
		for (const trim of reference.trims) {
			const gesture = openPolicyGesture(
				testEngine,
				"t",
				state,
				{ policy: "trim", id: trim.id, edge: "end", kind: trim.kind },
				undefined,
			);
			expect(plain(gesture.update({ deltaTicks: -4000 })), `${trim.id} ${trim.kind}`).toEqual(
				trim.projection,
			);
			expect(plain(gesture.commit()), `${trim.id} ${trim.kind}`).toEqual(trim.terminal);
		}
		expect(testEngine.gestureOpenCount()).toBe(0);
	});
});
