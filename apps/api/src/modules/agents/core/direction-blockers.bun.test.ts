import { describe, expect, test } from "bun:test";
import { directStorySequence } from "../../../lib/story/creative-director.ts";
import type { StoryPlanSection } from "../../../lib/content-generator.ts";

function section(over: Partial<StoryPlanSection>): StoryPlanSection {
	return {
		id: "s",
		title: "T",
		narration: "n",
		visualPrompt: "v",
		semanticBeatId: "b1",
		...over,
	} as StoryPlanSection;
}

/* Observed live on project 20049b6a: a ten-section plan where section 4 was never
 * drafted reported "Every drafted section needs a stable semantic beat id before
 * direction" — while all ten sections had beat ids. One message covered two
 * different faults and described only the one that had not occurred, sending the
 * operator looking for a missing id that did not exist. */
describe("direction blockers say which fault occurred", () => {
	test("an undrafted section is reported as undrafted, not as a missing beat id", async () => {
		const result = await directStorySequence([
			section({ id: "a", title: "Before Choice", semanticBeatId: "b1" }),
			section({
				id: "b",
				title: "Section 4",
				semanticBeatId: "b2",
				needsDrafting: true,
				narration: "",
			}),
		]);

		expect(result.needsDirection).toBe(true);
		const joined = (result.directionErrors ?? []).join(" ");
		expect(joined).toContain("never drafted");
		expect(joined).toContain("Section 4");
		expect(joined).not.toContain("no stable beat id");
	});

	test("a missing beat id is reported as such", async () => {
		const result = await directStorySequence([
			section({ id: "a", title: "Kept", semanticBeatId: "b1" }),
			section({ id: "b", title: "Unnamed", semanticBeatId: undefined }),
		]);

		const joined = (result.directionErrors ?? []).join(" ");
		expect(joined).toContain("no stable beat id");
		expect(joined).toContain("Unnamed");
		expect(joined).not.toContain("never drafted");
	});

	test("both faults are reported together when both are present", async () => {
		const result = await directStorySequence([
			section({ id: "a", title: "Empty one", semanticBeatId: "b1", needsDrafting: true }),
			section({ id: "b", title: "Idless one", semanticBeatId: undefined }),
		]);

		const joined = (result.directionErrors ?? []).join(" ");
		expect(joined).toContain("never drafted");
		expect(joined).toContain("no stable beat id");
	});

	test("the undrafted message tells the operator what to do", async () => {
		const result = await directStorySequence([section({ needsDrafting: true })]);
		expect((result.directionErrors ?? []).join(" ")).toContain(
			"Re-run planning, or write them by hand",
		);
	});
});
