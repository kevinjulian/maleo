import { describe, expect, test } from "vite-plus/test";
import { storyboardSchema } from "../src/schema";

describe("explainer scene schema", () => {
	test("accepts structured explainer metadata on scenes", () => {
		const parsed = storyboardSchema.parse({
			scenes: [
				{
					image: "/uploads/frame.png",
					durationSec: 4,
					explainer: {
						question: "Why are we bored?",
						claim: "Boredom is old.",
						evidence: "Archaeologists found decorated artifacts.",
						sourceEvidence: [
							{
								url: "https://example.test/source",
								quote: "Archaeologists found decorated artifacts.",
							},
						],
						analogy: "Like doodling in a notebook.",
						visualType: "evidence",
						onScreenText: "Boredom is ancient",
					},
					sectionTransition: {
						type: "question_card",
						plateId: "thread",
						text: "Where did free time come from?",
						motion: "line_draw",
						durationSec: 0.9,
						plateImageUrl: "/uploads/thread.png",
					},
				},
			],
		});
		expect(parsed.scenes[0]!.explainer?.visualType).toBe("evidence");
		expect(parsed.scenes[0]!.explainer?.claim).toBe("Boredom is old.");
		expect(parsed.scenes[0]!.explainer?.sourceEvidence?.[0]?.url).toBe(
			"https://example.test/source",
		);
		expect(parsed.scenes[0]!.sectionTransition?.plateId).toBe("thread");
		expect(parsed.scenes[0]!.sectionTransition?.plateImageUrl).toBe("/uploads/thread.png");
	});
});
