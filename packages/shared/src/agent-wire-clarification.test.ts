/* The story plan carries clarification provenance BESIDE the original brief, and
 * both survive the JSON round-trip the snapshot and the storyboard blob make. */
import { describe, expect, test } from "vite-plus/test";
import type { AgentEvent, StoryPlanPayload } from "./agent-wire.ts";
import { parseArtifact, writeArtifact } from "./pipeline-artifact.ts";
import { pipelineArtifactKinds } from "./pipeline-artifact-kinds.ts";
import {
	resolveStoryClarification,
	storyClarificationBatchSchema,
	verifyStoryClarification,
} from "./story-clarification.ts";

const batch = storyClarificationBatchSchema.parse({
	id: "batch-9",
	stage: "pre_research",
	purpose: "story_brief",
	questions: [
		{
			id: "audience",
			header: "Audience",
			question: "Who is this for?",
			options: [
				{
					id: "leaders",
					label: "Team leaders",
					value: "team leaders",
					description: "Frames decisions and tradeoffs.",
					recommended: true,
				},
				{
					id: "newcomers",
					label: "Newcomers",
					value: "newcomers",
					description: "Defines every term first.",
				},
			],
		},
	],
});

describe("story plan clarification provenance", () => {
	test("round-trips through JSON with the original brief untouched", () => {
		const provenance = verifyStoryClarification(
			resolveStoryClarification(batch, {
				batchId: "batch-9",
				answers: [{ questionId: "audience", optionId: "leaders" }],
			}),
			{ language: "en" },
		);
		const payload: StoryPlanPayload = {
			targetSec: 240,
			sections: [],
			planningBrief: "a four minute story about tides",
			clarification: provenance,
		};
		const { artifact } = writeArtifact(pipelineArtifactKinds, [], {
			kind: "story_plan",
			payload,
			producer: { type: "stage", stage: "plan", runId: "run-9" },
			projectId: "p",
		});
		const parsed = parseArtifact(pipelineArtifactKinds, JSON.parse(JSON.stringify(artifact)));
		if (!parsed.ok) throw new Error(parsed.message);
		const restored = parsed.artifact.payload as StoryPlanPayload;
		expect(restored.planningBrief).toBe("a four minute story about tides");
		expect(restored.clarification).toEqual(provenance);
		expect(restored.clarification?.decisions[0]!.answer).toBe("team leaders");
		expect(restored.clarification?.decisions[0]!.status).toBe("supplied");
	});

	test("a question event carries the batch and a legacy-readable first question", () => {
		const event: AgentEvent = {
			kind: "question",
			question: batch.questions[0]!.question,
			options: batch.questions[0]!.options.map((option) => ({
				label: option.label,
				value: option.value,
			})),
			actionId: "action-1",
			batch,
		};
		const restored = JSON.parse(JSON.stringify(event)) as Extract<AgentEvent, { kind: "question" }>;
		expect(restored.batch).toEqual(batch);
		expect(restored.options).toHaveLength(2);
	});
});
