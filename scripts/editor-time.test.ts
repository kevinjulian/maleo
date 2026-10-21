/* Reference values for the Rust engine's time and evaluation port
 * (`migrate-editor-to-shared-rust-core`, task 4.3).
 *
 * The evaluation cases below are computed by the TS implementations the engine
 * replaces — the shared package's keyframe evaluation, animation retime/retain
 * and source timing — and written to
 * `packages/shared/src/editor/reference/`. `crates/editor-core/tests/
 * time_reference.rs` recomputes every case in Rust from that file, so the two
 * are held to one set of values without either importing the other.
 *
 * The time cases came from the VUI kernel's `time/` and are frozen since it was
 * retired (task 4.10). This test fails when the evaluation section no longer
 * matches the TS; rerun with UPDATE_EDITOR_REFERENCE=1 to rewrite it, then
 * rerun `cargo test`. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	evaluateColorTrack,
	evaluateValueTrack,
} from "../packages/shared/src/keyframe-evaluation.ts";
import {
	retainClipAnimation,
	retimeClipAnimation,
	sampleClipTransform,
	type Animation,
} from "../packages/shared/src/clip-animation.ts";
import {
	assertSourceInterval,
	retimeSourceDuration,
	sliceSourceInterval,
	sourceTime,
} from "../packages/shared/src/source-interval.ts";
import type { ColorKeyframe, ValueKeyframe } from "../packages/shared/src/timeline-model.ts";

const REFERENCE = join(
	import.meta.dirname,
	"../packages/shared/src/editor/reference/time-and-evaluation.json",
);

interface Case {
	op: string;
	args: unknown[];
	result: unknown;
}

/* JSON writes NaN and both infinities as null; arguments keep them apart as
 * strings, which the Rust reader turns back into numbers. */
const encodeArgs = (args: unknown[]): unknown =>
	JSON.parse(
		JSON.stringify(args, (_key, value: unknown) =>
			typeof value === "number" && !Number.isFinite(value) ? String(value) : value,
		),
	);

/** `{ result }` or `{ error }`: what a call returned, or the message it threw. */
function call(op: string, args: unknown[], run: () => unknown): Case {
	const encoded = encodeArgs(args) as unknown[];
	try {
		return {
			op,
			args: encoded,
			result: { ok: JSON.parse(JSON.stringify(run() ?? null)) as unknown },
		};
	} catch (error) {
		return {
			op,
			args: encoded,
			result: { error: error instanceof Error ? error.message : String(error) },
		};
	}
}

function evaluationCases(): Case[] {
	const cases: Case[] = [];
	const value: ValueKeyframe[] = [
		{ t: 0, v: 0 },
		{ t: 1, v: 10, easing: "in" },
		{ t: 2, v: 5, easing: "out" },
		{ t: 3, v: 20, easing: "in-out" },
		{ t: 4, v: 0, easing: "bezier" },
		{ t: 5, v: 7, easing: "hold" },
		{ t: 6, v: 1, easing: "linear", easingRange: [0.25, 0.75] },
	];
	const colors: ColorKeyframe[] = [
		{ t: 0, v: "#000" },
		{ t: 1, v: "#ffffff", easing: "out" },
		{ t: 2, v: "rgb(10, 20, 30)" },
		{ t: 3, v: "red" },
		{ t: 4, v: "#123456", easing: "hold" },
	];
	for (let i = -2; i <= 66; i++) {
		const time = i / 10 + (i % 7 === 0 ? 0.0001 : 0);
		cases.push(
			call("evaluateValueTrack", [value, time, 99], () => evaluateValueTrack(value, time, 99)),
		);
		cases.push(
			call("evaluateColorTrack", [colors, time / 1.5], () =>
				evaluateColorTrack(colors, time / 1.5, "#fff"),
			),
		);
	}
	const animation: Animation = {
		tracks: {
			opacity: value.slice(0, 4),
			scale: [
				{ t: 0.5, v: 1 },
				{ t: 3.5, v: 2, easing: "in", easingRange: [0.2, 0.9] },
			],
			xPct: [],
		},
		colorTracks: { fill: colors.slice(0, 3) },
	};
	for (const [from, to] of [
		[0, 4],
		[0.5, 2.5],
		[1, 1.5],
		[2.25, 6],
		[-1, 1],
		[3, 2],
	] as const)
		cases.push(
			call("retainClipAnimation", [animation, from, to], () =>
				retainClipAnimation(animation, from, to),
			),
		);
	for (const factor of [0.5, 2, 1 / 3, 0, -1])
		cases.push(
			call("retimeClipAnimation", [animation, factor], () =>
				retimeClipAnimation(animation, factor),
			),
		);
	for (const seconds of [0, 0.7, 1.3, 2.9, 10]) {
		cases.push(
			call("sampleClipTransform", [{ xPct: 12, opacity: 0.5, animation }, seconds], () =>
				sampleClipTransform({ xPct: 12, opacity: 0.5, animation }, seconds),
			),
		);
		cases.push(
			call("sampleClipTransform", [null, seconds], () => sampleClipTransform(undefined, seconds)),
		);
	}
	for (const [start, duration, rate, reverse] of [
		[3, 4, 1, false],
		[3, 4, 2, true],
		[0, 1, 0.25, false],
		[1.5, 2.2, 1.7, true],
		[-1, 1, 1, false],
		[0, 1, 5, false],
	] as const) {
		for (const elapsed of [-1, 0, 0.5, 1.9, 2.2, 10])
			cases.push(
				call("sourceTime", [start, duration, rate, reverse, elapsed], () =>
					sourceTime(start, duration, rate, reverse, elapsed),
				),
			);
		for (const next of [0.5, 1, 1.5, 4, 8])
			cases.push(
				call("retimeSourceDuration", [start, duration, rate, next], () =>
					retimeSourceDuration(start, duration, rate, next),
				),
			);
		for (const source of [5, 11, 0, Number.NaN])
			cases.push(
				call("assertSourceInterval", [start, duration, rate, source], () =>
					assertSourceInterval(start, duration, rate, source),
				),
			);
		for (const [from, to] of [
			[0, 1],
			[0.5, 1.9],
			[1, 1],
			[-0.5, 1],
		] as const)
			cases.push(
				call("sliceSourceInterval", [start, duration, rate, reverse, from, to], () =>
					sliceSourceInterval(start, duration, rate, reverse, from, to),
				),
			);
	}
	return cases;
}

describe("time and evaluation reference values", () => {
	test("the committed reference file is what the TS computes", () => {
		const section = (cases: Case[]): string =>
			cases.map((entry) => `\t\t${JSON.stringify(entry)}`).join(",\n");
		const committed = readFileSync(REFERENCE, "utf8");
		/* The time section is frozen: the kernel `time/` that computed it was
		 * retired (task 4.10), and the Rust port is held to it by
		 * `crates/editor-core/tests/time_reference.rs`. */
		const time = committed.slice(0, committed.indexOf(`,\n\t"evaluation": [`));
		const current = `${time},\n\t"evaluation": [\n${section(evaluationCases())}\n\t]\n}\n`;
		if (process.env.UPDATE_EDITOR_REFERENCE) writeFileSync(REFERENCE, current);
		expect(
			committed,
			"stale: run UPDATE_EDITOR_REFERENCE=1 bun test scripts/editor-time.test.ts",
		).toBe(current);
		/* Fractional rates, drop-frame and every error path are in the file, not only easy values. */
		expect(current).toContain("01;00;00;00");
		expect(current).toContain('"error"');
	});
});
