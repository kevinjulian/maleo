import { describe, expect, it } from "vite-plus/test";
import {
	addSelected,
	computeRefUsage,
	isSelected,
	removeRefFromItems,
	removeRefFromScenes,
	removeSelected,
	selectionCount,
	toggleRefId,
	toggleSelected,
} from "./reference-ops.ts";
import type { Scene, ProjectSelection } from "@maleo/shared";

const scene = (over: Partial<Scene>): Scene => ({
	id: 1,
	dur: 3,
	name: "s",
	shot: "",
	move: "",
	vis: "",
	vo: "",
	img: false,
	...over,
});

describe("computeRefUsage", () => {
	it("counts refIds and noteIds across clips plus project refs", () => {
		const scenes = [
			scene({ id: 1, refIds: ["a", "b"], noteIds: ["n1"] }),
			scene({ id: 2, refIds: ["a"], noteIds: ["n1", "n2"] }),
		];
		const usage = computeRefUsage(scenes, ["a", "c"]);
		expect(usage.get("a")).toBe(3); // 2 clips + 1 project ref
		expect(usage.get("b")).toBe(1);
		expect(usage.get("n1")).toBe(2);
		expect(usage.get("n2")).toBe(1);
		expect(usage.get("c")).toBe(1);
		expect(usage.get("missing")).toBeUndefined();
	});

	it("handles clips with no references and empty project refs", () => {
		const usage = computeRefUsage([scene({ id: 1 })], []);
		expect(usage.size).toBe(0);
	});
});

describe("removeRefFromItems / removeRefFromScenes", () => {
	it("strips the id from refIds and noteIds, keeps the rest", () => {
		const scenes = [
			scene({ id: 1, refIds: ["a", "b"], noteIds: ["a", "n1"] }),
			scene({ id: 2, refIds: ["c"], noteIds: [] }),
		];
		const next = removeRefFromScenes(scenes, "a");
		expect(next[0].refIds).toEqual(["b"]);
		expect(next[0].noteIds).toEqual(["n1"]);
		expect(next[1].refIds).toEqual(["c"]);
	});

	it("does not mutate the input", () => {
		const items: Array<{ refIds?: string[]; noteIds?: string[] }> = [{ refIds: ["a", "b"] }];
		const next = removeRefFromItems(items, "a");
		expect(items[0].refIds).toEqual(["a", "b"]);
		expect(next[0].refIds).toEqual(["b"]);
	});

	it("normalizes missing arrays to empty", () => {
		const items: Array<{ refIds?: string[]; noteIds?: string[] }> = [{}];
		const next = removeRefFromItems(items, "a");
		expect(next[0].refIds).toEqual([]);
		expect(next[0].noteIds).toEqual([]);
	});
});

describe("toggleRefId (flat id list)", () => {
	it("adds an id that is not present", () => {
		expect(toggleRefId(["a"], "b")).toEqual(["a", "b"]);
	});
	it("removes an id that is present", () => {
		expect(toggleRefId(["a", "b"], "a")).toEqual(["b"]);
	});
	it("does not mutate the input", () => {
		const ids = ["a"];
		toggleRefId(ids, "b");
		expect(ids).toEqual(["a"]);
	});
});

describe("project selection (one flat list)", () => {
	const base: ProjectSelection = { prompt: "", entityIds: ["e1", "prod_c03"] };

	it("toggles an entity in and out regardless of its role", () => {
		expect(toggleSelected(base, "e2").entityIds).toEqual(["e1", "prod_c03", "e2"]);
		expect(toggleSelected(base, "prod_c03").entityIds).toEqual(["e1"]);
	});
	it("does not mutate the input", () => {
		toggleSelected(base, "e9");
		expect(base.entityIds).toEqual(["e1", "prod_c03"]);
	});
	it("isSelected needs no bucket search", () => {
		expect(isSelected(base, "prod_c03")).toBe(true);
		expect(isSelected(base, "nope")).toBe(false);
	});
	it("counts from the one list — no dual-era branch", () => {
		expect(selectionCount(base)).toBe(2);
		expect(selectionCount({ prompt: "", entityIds: [] })).toBe(0);
	});
	it("addSelected dedupes and keeps order", () => {
		expect(addSelected(base, ["e1", "e2"]).entityIds).toEqual(["e1", "prod_c03", "e2"]);
		expect(addSelected(base, ["e1"])).toBe(base);
	});
	it("removeSelected strips the id", () => {
		expect(removeSelected(base, "e1").entityIds).toEqual(["prod_c03"]);
		expect(removeSelected(base, "missing").entityIds).toEqual(["e1", "prod_c03"]);
	});
});
