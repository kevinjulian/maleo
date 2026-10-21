import { describe, expect, test } from "vite-plus/test";
import type { ElementSource } from "@maleo/shared";
import { actionLabel, actionTarget, rowActions, summariseGroupSource } from "./panel-rows.ts";

const sources =
	(map: Record<string, ElementSource>) =>
	(path: string): ElementSource | undefined =>
		map[path];
const names =
	(map: Record<string, string>) =>
	(id: string | null): string | undefined =>
		id ? map[id] : undefined;

const PRESET: ElementSource = { layer: "project-preset", defaulterId: "cp_1" };
const OTHER: ElementSource = { layer: "project-preset", defaulterId: "cp_2" };
const MINE: ElementSource = { layer: "operator", defaulterId: null };

describe("a group header names its default once, or says it cannot", () => {
	test("one default for the whole group reads as its name and stays openable", () => {
		const group = summariseGroupSource(
			["a", "b"],
			sources({ a: PRESET, b: PRESET }),
			names({ cp_1: "Dark Documentary" }),
		);
		expect(group).toEqual({
			kind: "inherited",
			label: "Dark Documentary",
			defaulterId: "cp_1",
			changed: 0,
			total: 2,
		});
	});

	/* The header gave up on naming one supplier, so it says so plainly instead of the old
	 * vague "inherited" — the rows carry the detail it dropped. */
	test("inherited elements from two defaults read as Multiple defaults", () => {
		const group = summariseGroupSource(
			["a", "b"],
			sources({ a: PRESET, b: OTHER }),
			names({ cp_1: "One", cp_2: "Two" }),
		);
		expect(group).toEqual({ kind: "multiple", label: "Multiple defaults", changed: 0, total: 2 });
	});

	test("a fully changed group names no default at all", () => {
		const group = summariseGroupSource(["a", "b"], sources({ a: MINE, b: MINE }), names({}));
		expect(group).toEqual({ kind: "none", label: "", changed: 2, total: 2 });
	});

	/* A mix still has a supplier for the part that is inherited, so the header keeps
	 * naming it; the count is what tells the operator the group is not wholly its. */
	test("a mix names the supplier and counts what the project owns", () => {
		const group = summariseGroupSource(
			["a", "b", "c"],
			sources({ a: MINE, b: PRESET, c: PRESET }),
			names({ cp_1: "Dark Documentary" }),
		);
		expect(group).toEqual({
			kind: "inherited",
			label: "Dark Documentary",
			defaulterId: "cp_1",
			changed: 1,
			total: 3,
		});
	});

	/* An unrecorded element reads as the project's everywhere else in the system, and has
	 * to here too — otherwise a project predating provenance shows as inherited while
	 * behaving as owned, and the header contradicts the apply dialog. */
	test("an unrecorded element counts as the project's", () => {
		expect(summariseGroupSource(["a"], sources({}), names({}))).toEqual({
			kind: "none",
			label: "",
			changed: 1,
			total: 1,
		});
	});

	/* A default can be deleted after it supplied a value. Inventing a name would be worse
	 * than admitting we cannot resolve it, and the chip must not link to nothing. */
	test("an unresolvable id falls back to the generic word and is not openable", () => {
		const group = summariseGroupSource(["a"], sources({ a: PRESET }), names({}));
		expect(group).toEqual({ kind: "inherited", label: "Inherited", changed: 0, total: 1 });
		expect(group?.defaulterId).toBeUndefined();
	});

	test("a group covering nothing addressable gets no header source", () => {
		expect(summariseGroupSource([], sources({}), names({}))).toBeNull();
	});
});

describe("what a row lets the operator do", () => {
	test("an inherited row can only be changed", () => {
		expect(
			rowActions({
				changed: false,
				sourceName: "Dark Documentary",
				canHandBack: true,
				canWriteBack: true,
			}),
		).toEqual(["change"]);
	});

	test("a changed row with a known default uses it", () => {
		expect(
			rowActions({ changed: true, sourceName: "Dark Documentary", canHandBack: true }),
		).toEqual(["change", "use-default"]);
	});

	/* No named default means no promise can be made about where the value goes back to,
	 * so the word changes with the promise. */
	test("a changed row with no known default resets to the shipped one", () => {
		expect(rowActions({ changed: true, canHandBack: true })).toEqual([
			"change",
			"reset-to-shipped",
		]);
	});

	test("a writable default can be updated in place", () => {
		expect(rowActions({ changed: true, sourceName: "Mine", canWriteBack: true })).toEqual([
			"change",
			"update-default",
		]);
	});

	test("a built-in default is copied rather than updated", () => {
		expect(
			rowActions({
				changed: true,
				sourceName: "Dark Documentary",
				builtinSource: true,
				canWriteBack: true,
			}),
		).toEqual(["change", "save-as-custom-default"]);
	});

	test("actions the host did not wire are not offered", () => {
		expect(rowActions({ changed: true, sourceName: "Dark Documentary" })).toEqual(["change"]);
	});

	/* Four labels, two writes. Both hand-back labels give the element back to the cascade
	 * and both write-back labels promote it — the fork that turns one into a copy happens
	 * inside the push planner, not in the panel's choice of button. */
	test("the four labels collapse to the two writes the host exposes", () => {
		expect(actionTarget("use-default")).toBe("hand-back");
		expect(actionTarget("reset-to-shipped")).toBe("hand-back");
		expect(actionTarget("update-default")).toBe("write-back");
		expect(actionTarget("save-as-custom-default")).toBe("write-back");
		expect(actionTarget("change")).toBe("none");
	});

	test("every action has product wording", () => {
		expect(actionLabel("change")).toBe("Change");
		expect(actionLabel("use-default")).toBe("Use default");
		expect(actionLabel("reset-to-shipped")).toBe("Reset to shipped default");
		expect(actionLabel("update-default")).toBe("Update default");
		expect(actionLabel("save-as-custom-default")).toBe("Save as custom default");
	});
});
