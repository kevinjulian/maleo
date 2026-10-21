/* One normalized Visual material body, read by every stage.
 *
 * The failing prompt carried the same preset guidance twice — once through
 * `direction.visual`, once through `projectReferences.prompt` — and a
 * `@Sketch Stickman` mention that reached the image provider with its `@`
 * intact. Both are properties of the normalization, not of any one stage, so
 * they are asserted here on the pure helpers. */
import { describe, expect, test } from "vite-plus/test";
import {
	materialsFromLegacy,
	directionFromMaterials,
	resolveMaterialMentions,
} from "./project-materials.ts";

describe("Visual material dedupe across compatibility fields", () => {
	const GUIDANCE = "Only sketch stickman figures. No human presence.";

	test("the same guidance in legacy direction and projectReferences renders once", () => {
		const materials = materialsFromLegacy({
			direction: { raw: "", story: "", visual: GUIDANCE, voice: "", rules: "" },
			projectReferences: { prompt: GUIDANCE, entityIds: ["r-stickman"] },
		});

		expect(materials.visual.body).toBe(GUIDANCE);
		expect(materials.visual.body.split("sketch stickman")).toHaveLength(2);
	});

	test("genuinely different guidance from both fields is kept, in order", () => {
		const materials = materialsFromLegacy({
			direction: { raw: "", story: "", visual: "Muted film grain.", voice: "", rules: "" },
			projectReferences: { prompt: GUIDANCE, entityIds: [] },
		});

		expect(materials.visual.body).toBe(`Muted film grain.\n\n${GUIDANCE}`);
	});

	test("dedupe ignores case and surrounding whitespace", () => {
		const materials = materialsFromLegacy({
			direction: { raw: "", story: "", visual: `  ${GUIDANCE}  `, voice: "", rules: "" },
			projectReferences: { prompt: GUIDANCE.toUpperCase(), entityIds: [] },
		});

		expect(materials.visual.body).toBe(GUIDANCE);
	});

	test("a style bible repeating the Visual body does not double it", () => {
		const materials = materialsFromLegacy({
			direction: { raw: "", story: "", visual: GUIDANCE, voice: "", rules: "" },
			styleBible: GUIDANCE,
		});

		expect(directionFromMaterials(materials).visual).toBe(GUIDANCE);
	});
});

describe("resolving @mentions before a provider sees them", () => {
	const refs = [
		{ id: "r-stickman", label: "Sketch Stickman", description: "a hand-drawn stick figure" },
		{ id: "r-env", label: "Sketch Env", description: "a line-art backdrop" },
	];

	test("a mention becomes the plain label and reports the entity", () => {
		const result = resolveMaterialMentions("Draw @Sketch Stickman in the foreground.", refs);

		expect(result.text).toBe("Draw Sketch Stickman in the foreground.");
		expect(result.text).not.toContain("@");
		expect(result.entityIds).toEqual(["r-stickman"]);
		expect(result.unresolved).toEqual([]);
	});

	test("a longer label wins over a shorter one that prefixes it", () => {
		// `@Sketch Stickman` must not be consumed as `@Sketch` + " Stickman".
		const result = resolveMaterialMentions("@Sketch Stickman walks past @Sketch Env.", refs);

		expect(result.text).toBe("Sketch Stickman walks past Sketch Env.");
		expect(result.entityIds.sort()).toEqual(["r-env", "r-stickman"]);
	});

	test("a mention naming nothing resolvable is reported, not deleted", () => {
		const result = resolveMaterialMentions("Draw @Sketch Stickman beside @Ghost Rider.", refs);

		expect(result.unresolved).toEqual(["Ghost Rider"]);
		// The operator's instruction survives; the run reports it rather than
		// quietly generating an image that ignores half the sentence.
		expect(result.text).toContain("Ghost Rider");
	});

	test("an email address is not a mention", () => {
		const result = resolveMaterialMentions("Contact hello@example.com for the brief.", refs);

		expect(result.text).toBe("Contact hello@example.com for the brief.");
		expect(result.unresolved).toEqual([]);
	});

	test("matching is case-insensitive but the label's own casing is written", () => {
		const result = resolveMaterialMentions("draw @sketch stickman here", refs);

		expect(result.text).toBe("draw Sketch Stickman here");
		expect(result.entityIds).toEqual(["r-stickman"]);
	});

	test("a mention at the very start of the body resolves", () => {
		expect(resolveMaterialMentions("@Sketch Stickman only.", refs).text).toBe(
			"Sketch Stickman only.",
		);
	});

	test("empty text is returned untouched", () => {
		expect(resolveMaterialMentions("", refs)).toEqual({ text: "", entityIds: [], unresolved: [] });
	});
});
