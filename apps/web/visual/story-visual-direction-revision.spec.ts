import { expect, test, type BrowserContext } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { storyboardAuthoringState } from "./fixtures/fixture-data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const JOB_ID = "fixture-visual-review-job";

type ReviewStep = "initial" | "rejected" | "revised" | "generating";

function reviewEvents(step: ReviewStep) {
	const events: object[] = [
		{
			kind: "question",
			question: "Review the story plan, then approve to generate assets.",
			options: [
				{ label: "Approve", value: "approve" },
				{ label: "Reject", value: "reject" },
			],
			actionId: "fixture-gate-initial",
		},
	];
	if (step === "initial") return events;
	events.push({
		kind: "question",
		question:
			"Rejected. Tell me what to change and I will redraft the story plan against the same arc and sources — no assets are generated until you approve.",
		options: [{ label: "Approve anyway", value: "approve" }],
		actionId: "fixture-gate-revision",
		freeText: true,
	});
	if (step === "rejected") return events;
	events.push(
		{ kind: "storyboard_patch" },
		{
			kind: "question",
			question: "Review the revised story plan, then approve to generate assets.",
			options: [
				{ label: "Approve", value: "approve" },
				{ label: "Reject", value: "reject" },
			],
			actionId: "fixture-gate-revised",
		},
	);
	if (step === "generating")
		events.push({ kind: "tool_call_started", tool: "generate_story_assets" });
	return events;
}

function reviewJob(step: ReviewStep) {
	return {
		jobId: JOB_ID,
		id: JOB_ID,
		projectId: FIXTURE_PROJECT_ID,
		contentType: "video",
		status: step === "generating" ? "running" : "awaiting_input",
		events: reviewEvents(step),
		scenes: [],
		slides: [],
		posts: [],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "16:9",
		brief: "Fixture story",
		startedAt: 1,
		targetDurationSec: 60,
	};
}

async function mockReviewFlow(context: BrowserContext): Promise<{ answers: string[] }> {
	const state = { step: "initial" as ReviewStep, answers: [] as string[] };
	await context.route("**/api/operations/projects/*/chat**", async (route) => {
		if (
			route.request().method() === "POST" &&
			new URL(route.request().url()).pathname.endsWith("/answer")
		) {
			const posted = (route.request().postDataJSON() as { answer?: unknown }).answer;
			const answer = typeof posted === "string" ? posted : "";
			state.answers.push(answer);
			state.step =
				answer === "reject" ? "rejected" : answer === "approve" ? "generating" : "revised";
			await route.fulfill({ json: { jobId: JOB_ID } });
			return;
		}
		await route.fulfill({ json: reviewJob(state.step) });
	});
	await context.route("**/api/operations/projects/*/storyboard-authoring**", (route) => {
		const revised = state.step === "revised" || state.step === "generating";
		const draft = revised
			? {
					...storyboardAuthoringState.draft,
					sections: storyboardAuthoringState.draft.sections.map((section, sectionIndex) =>
						sectionIndex
							? section
							: {
									...section,
									beats: section.beats.map((beat, beatIndex) =>
										beatIndex
											? beat
											: {
													...beat,
													editorial: {
														...beat.editorial,
														shots: beat.editorial.shots?.map((shot) => ({
															...shot,
															bindings: [{ plannedKey: "fixture-library-lamp" }],
															rationale: "Uses the operator-requested library lamp.",
														})),
													},
												},
									),
								},
					),
				}
			: storyboardAuthoringState.draft;
		return route.fulfill({
			json: {
				state: { ...storyboardAuthoringState, draft, approvedSnapshot: undefined },
				legacy: false,
				generatedByBeatId: {},
				references: {
					"entity:fixture-ref-character": {
						label: "Fixture Character",
						role: "character",
						source: "existing",
					},
					"planned:fixture-archive-door": {
						label: "Archive Door",
						role: "prop",
						source: "planned",
					},
					"planned:fixture-library-lamp": {
						label: "Library Lamp",
						role: "prop",
						source: "planned",
					},
				},
			},
		});
	});
	return state;
}

test("rejects, revises reference direction, and starts generation from revised gate", async ({
	page,
	context,
}) => {
	await replayApi(context, resolve(HERE, "fixtures/api.har"));
	const flow = await mockReviewFlow(context);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}/storyboard`);

	await page.getByRole("button", { name: "Revise plan" }).click();
	await page.getByRole("button", { name: "Reply" }).click();
	await page
		.getByRole("textbox", { name: "Reply" })
		.fill("Replace the archive door with the library lamp reference.");
	await page.getByRole("button", { name: "Send reply" }).click();
	await expect
		.poll(() => flow.answers)
		.toEqual(["reject", "Replace the archive door with the library lamp reference."]);

	await page.reload();
	await expect(page.locator(".sb-author-shots").first()).toContainText("Library Lamp");
	await page.getByRole("button", { name: "Approve & generate" }).click();
	await expect.poll(() => flow.answers.at(-1)).toBe("approve");
	await expect(
		page.getByLabel("Run").getByText("generate story assets", { exact: true }),
	).toBeVisible();
});
