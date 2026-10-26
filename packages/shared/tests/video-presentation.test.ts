import { describe, expect, test } from "vite-plus/test";
import {
	PRESENTATION_TEMPLATE_MAP,
	presentationFor,
	templateCompatibleWithPresentation,
} from "../src/video-presentation.ts";

describe("presentation grammar", () => {
	test("selects one primary family by editorial priority", () => {
		expect(
			presentationFor({
				claim: "Five habits",
				onScreenText: "5 habits",
				sectionTransition: { text: "Summary" },
			}).category,
		).toBe("explainer");
		expect(
			presentationFor({ onScreenText: "5 habits", sectionTransition: { text: "Summary" } })
				.category,
		).toBe("headline");
		expect(presentationFor({ sectionTransition: { text: "Summary" } }).category).toBe("transition");
		expect(presentationFor({}).category).toBe("narrative");
	});

	test("maps categories to reusable compatible templates", () => {
		expect(PRESENTATION_TEMPLATE_MAP.explainer.clipFamily).toBe("text");
		expect(PRESENTATION_TEMPLATE_MAP.narrative.clipFamily).toBe("none");
		expect(templateCompatibleWithPresentation("explainer", "plain")).toBe(true);
		expect(templateCompatibleWithPresentation("explainer", "rve-quote-card")).toBe(false);
		expect(templateCompatibleWithPresentation("explainer", "table_build")).toBe(false);
	});
});
