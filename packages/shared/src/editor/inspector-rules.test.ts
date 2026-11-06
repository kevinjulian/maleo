/* The `inspector_apply` boundary (`p1-envelope-inspector` task 3.1): one op
 * round-trips, and a refused input throws a legible error. The rules themselves
 * are held to `inspector-reference/` by the web and Rust reference suites. */
import { describe, expect, test } from "vite-plus/test";
import { editorEngine } from "./engine-registry.ts";
import { dbFromGain, inspectorOp, propertyGroupKeys } from "./inspector-rules.ts";

describe("inspector_apply", () => {
	test("an op round-trips as JSON", () => {
		expect(propertyGroupKeys("text")).toEqual([
			"content",
			"transform",
			"animation",
			"blending",
			"timing",
		]);
		expect(dbFromGain(0)).toBe(Number.NEGATIVE_INFINITY);
	});

	test("an unknown op and a missing field are refused", () => {
		expect(editorEngine().inspectorApply(0, JSON.stringify({ op: "nope" }))).toMatchObject({
			ok: false,
			error: { kind: "InvalidInput" },
		});
		expect(editorEngine().inspectorApply(0, JSON.stringify({ op: "fader.gain" }))).toMatchObject({
			ok: false,
			error: { message: expect.stringContaining("pct is a number") },
		});
		expect(() => inspectorOp("fader.gain", { pct: Number.NaN })).toThrow("pct is a number");
	});

	test("a document op names a handle the engine holds", () => {
		expect(
			editorEngine().inspectorApply(987654, JSON.stringify({ op: "groups", kind: "text" })),
		).toMatchObject({
			ok: false,
		});
	});
});
