import { describe, expect, test } from "vite-plus/test";
import {
	MATERIAL_CONTEXT_KEYS,
	PIPELINE_CONTEXT_KEYS,
	isPipelineContextKey,
	type PipelineContextKey,
	snapshotDeclaredContext,
	supersededContext,
} from "./pipeline-context.ts";

describe("pipeline context keys", () => {
	test("every material channel is a context key", () => {
		for (const key of MATERIAL_CONTEXT_KEYS) expect(PIPELINE_CONTEXT_KEYS).toContain(key);
	});

	test("keys are unique", () => {
		expect(new Set(PIPELINE_CONTEXT_KEYS).size).toBe(PIPELINE_CONTEXT_KEYS.length);
	});

	test("runtime guard accepts declared keys and rejects others", () => {
		for (const key of PIPELINE_CONTEXT_KEYS) expect(isPipelineContextKey(key)).toBe(true);
		expect(isPipelineContextKey("materials")).toBe(false);
		expect(isPipelineContextKey("materials.tone")).toBe(false);
		expect(isPipelineContextKey("")).toBe(false);
	});

	/* The bible is folded into the visual channel by `directionFromMaterials`, so no
	 * stage can receive it on its own. A key for it would be declarable but never
	 * satisfiable — see the note in `pipeline-context.ts`. */
	test("the style bible is not a context key of its own", () => {
		expect(isPipelineContextKey("materials.styleBible")).toBe(false);
		expect(PIPELINE_CONTEXT_KEYS).toContain("materials.visual");
		expect(PIPELINE_CONTEXT_KEYS).toContain("styleLock");
	});

	/* The real proof for "an unknown key fails to compile" is the `@ts-expect-error`
	 * below, checked by `bun run typecheck`: if the bad key ever becomes assignable,
	 * the unused directive is itself an error. The runtime assertions above only
	 * cover the trace surface, which receives plain strings. */
	test("a declared key outside the set does not type-check", () => {
		const good: PipelineContextKey[] = ["brief", "materials.rules", "approvedPlan"];
		// @ts-expect-error "materials.tone" is not a pipeline context key
		const bad: PipelineContextKey[] = ["materials.tone"];
		expect(good).toHaveLength(3);
		expect(bad).toHaveLength(1);
	});
});

/* 7.1: a stage's declared external context is fingerprinted as it begins; its
 * artifacts carry the snapshot, so superseded context is visible after the fact. */
describe("snapshotting declared context", () => {
	const source = {
		brief: "bees",
		direction: { story: "warm", visual: "macro lens", voice: "calm", rules: "no logos" },
		projectRefIds: ["ref-b", "ref-a"],
		styleImageUrl: "/style.png",
		visualStyle: "ink",
		timelineTemplate: { id: "t1", introTextPreset: "card" },
	};

	test("records the materials, direction, style lock and template it began against", () => {
		const keys = [
			"brief",
			"materials.visual",
			"materials.voice",
			"materials.references",
			"materials.rules",
			"styleLock",
			"timelineTemplate",
		] as const;
		expect(snapshotDeclaredContext(source, keys).map((entry) => entry.key)).toEqual([...keys]);
	});

	test("artifact-backed keys are lineage, not context, and are not fingerprinted", () => {
		expect(
			snapshotDeclaredContext(source, ["approvedPlan", "generatedAssets", "brief"]).map(
				(entry) => entry.key,
			),
		).toEqual(["brief"]);
	});

	test("reference order does not change the fingerprint", () => {
		const reordered = { ...source, projectRefIds: ["ref-a", "ref-b"] };
		expect(snapshotDeclaredContext(reordered, ["materials.references"])).toEqual(
			snapshotDeclaredContext(source, ["materials.references"]),
		);
	});

	test("a changed input is reported as superseded, key by key", () => {
		const snapshot = snapshotDeclaredContext(source, [
			"brief",
			"materials.visual",
			"timelineTemplate",
		]);
		expect(supersededContext(snapshot, source)).toEqual([]);
		expect(
			supersededContext(snapshot, {
				...source,
				direction: { ...source.direction, visual: "wide lens" },
				timelineTemplate: { id: "t1", introTextPreset: "title" },
			}),
		).toEqual(["materials.visual", "timelineTemplate"]);
	});
});
