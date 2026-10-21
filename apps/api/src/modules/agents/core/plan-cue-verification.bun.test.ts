/* Planned shot cues are the narration beat a shot illustrates, and narration
 * grouping matches on them verbatim. A cue the narrator never speaks is text
 * nothing can match, so materialization records it as unverified rather than
 * retaining it — grouping then falls back to its balanced contiguous split. */
import { describe, expect, test } from "bun:test";
import { materializePlannedSections } from "./evidence.ts";
import { narrationSegmentsForShots } from "../../../lib/story.ts";
import type { StoryPlanSection } from "../../../lib/content-generator.ts";

const NARRATION =
	"The hive wakes before dawn. Workers cross the wax corridors in the dark. By noon the entrance is a river of returning foragers.";

function planned(cues: string[]): StoryPlanSection[] {
	return [
		{
			title: "One day inside",
			narration: NARRATION,
			visualPrompt: "wax corridor at dawn",
			shots: cues.map((cue, index) => ({ visualPrompt: `shot ${index + 1}`, cue })),
		} as StoryPlanSection,
	];
}

describe("planned shot cue verification", () => {
	test("a cue that occurs in the narration is retained", () => {
		const [section] = materializePlannedSections(
			planned([
				"The hive wakes before dawn.",
				"By noon the entrance is a river of returning foragers.",
			]),
			0,
			undefined,
			false,
		);
		expect(section?.shotCues).toEqual([
			"The hive wakes before dawn.",
			"By noon the entrance is a river of returning foragers.",
		]);
	});

	test("a hallucinated cue is recorded as unverified and grouping falls back", () => {
		const [section] = materializePlannedSections(
			planned([
				"The hive wakes before dawn.",
				"The queen delivers a speech to the assembled colony.",
			]),
			0,
			undefined,
			false,
		);
		expect(section?.shotCues).toEqual(["The hive wakes before dawn.", ""]);

		// With one cue missing, grouping cannot match on cues at all, so it splits the
		// narration into balanced contiguous groups instead of matching absent text.
		const grouped = narrationSegmentsForShots(NARRATION, 2, section?.shotCues);
		expect(grouped).toEqual([
			"The hive wakes before dawn. Workers cross the wax corridors in the dark.",
			"By noon the entrance is a river of returning foragers.",
		]);
	});

	test("cue matching ignores punctuation and case differences", () => {
		const [section] = materializePlannedSections(
			planned(["the HIVE wakes, before dawn"]),
			0,
			undefined,
			false,
		);
		expect(section?.shotCues?.[0]).toBe("the HIVE wakes, before dawn");
	});
});
