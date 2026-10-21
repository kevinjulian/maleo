/* Which selected references will not render.
 *
 * The document's selection and the project's roster are two stores. An id in
 * the first with no row in the second contributes nothing at generation time,
 * and until now the library gave no sign of it — the selection looked applied
 * and the operator found out from the finished images. */
import { describe, expect, test } from "vite-plus/test";
import { unresolvedSelections } from "./pool.ts";
import type { RefImage } from "@maleo/shared";

function ref(id: string, label: string, inRoster: boolean): RefImage {
	return { id, label, inRoster } as RefImage;
}

describe("unresolvedSelections", () => {
	test("an attached selection is not flagged", () => {
		const pool = [ref("r-stickman", "Sketch Stickman", true)];
		expect(unresolvedSelections(pool, ["r-stickman"])).toEqual([]);
	});

	test("a selection in the library but off the roster is attachable", () => {
		const pool = [ref("r-stickman", "Sketch Stickman", false)];

		expect(unresolvedSelections(pool, ["r-stickman"])).toEqual([
			{ id: "r-stickman", label: "Sketch Stickman", reason: "unattached" },
		]);
	});

	test("a selection the workspace no longer has is named by id and not attachable", () => {
		expect(unresolvedSelections([], ["r-deleted"])).toEqual([
			{ id: "r-deleted", label: "r-deleted", reason: "missing" },
		]);
	});

	test("the Lidiman shape: two attached, one selected but never attached", () => {
		const pool = [
			ref("pria", "Pria", true),
			ref("sketch-env-1", "Sketch Env #1", true),
			ref("r1783177064445p83", "Sketch Stickman", false),
		];

		const unresolved = unresolvedSelections(pool, ["pria", "sketch-env-1", "r1783177064445p83"]);

		expect(unresolved).toEqual([
			{ id: "r1783177064445p83", label: "Sketch Stickman", reason: "unattached" },
		]);
	});

	test("a repeated id is reported once", () => {
		expect(unresolvedSelections([], ["dup", "dup"])).toHaveLength(1);
	});

	test("an entity on the roster but not selected is not reported", () => {
		const pool = [ref("attached-unselected", "Spare", true)];
		expect(unresolvedSelections(pool, [])).toEqual([]);
	});

	test("a blank id is ignored", () => {
		expect(unresolvedSelections([], ["", "real"])).toEqual([
			{ id: "real", label: "real", reason: "missing" },
		]);
	});
});
