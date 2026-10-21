/* The post-research clarification card, driven in a real browser.
 *
 * Same card and same answer contract as the pre-research checkpoint, so what
 * this spec exists to prove is the part that differs and that only a browser can
 * show: a parked run mid-`plan_story` actually renders the question, each option
 * shows the retrieved sources it rests on, answering leaves as one structured
 * submission against the post-research batch, and NOTHING downstream of the
 * checkpoint — no plan, no approval, no assets — appears before the answer.
 *
 * The chat routes are authored rather than recorded, for the same reason the
 * pre-research fixture is: a recording would need a live model and a live
 * research pass to produce a batch, and would freeze one model's questions into
 * the suite.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const HAR = resolve(HERE, "fixtures/api-editor-chat.har");
const OUT = resolve(HERE, ".output/post-research-clarification");
const PROJECT = EDITOR_CHAT_FIXTURE_PROJECT_ID;
const JOB = "agent-post-research-1";
const ACTION = "action-post-research-1";

const CHAT_URL = new RegExp(`/api/operations/projects/${PROJECT}/chat(\\?|$)`);
const JOB_URL = new RegExp(`/api/operations/projects/${PROJECT}/chat/${JOB}(\\?|$)`);
const ANSWER_URL = new RegExp(`/api/operations/projects/${PROJECT}/chat/${JOB}/answer(\\?|$)`);

const OHIO = "https://example.test/ohio";
const VERMONT = "https://example.test/vermont";

const BATCH = {
	id: "batch-funds",
	stage: "post_research",
	purpose: "story_brief",
	intro: "The sources disagree on one thing.",
	questions: [
		{
			id: "case",
			header: "Case study",
			question: "Which fund should the video follow?",
			options: [
				{
					id: "ohio",
					label: "The Ohio fund",
					value: "the Ohio fund",
					description: "Frames the story around a fund that compounded at 7.1%.",
					recommended: true,
					sources: [{ title: "Ohio pension study", url: OHIO }],
				},
				{
					id: "vermont",
					label: "The Vermont fund",
					value: "the Vermont fund",
					description: "Uses the low-return fund as a counterexample.",
					sources: [{ title: "Vermont pension study", url: VERMONT }],
				},
			],
		},
	],
} as const;

/* A run parked MID-plan: research is behind it, the script is not written, and
 * the workflow board says the run is waiting on the user rather than on a model. */
function parkedJob() {
	return {
		jobId: JOB,
		status: "awaiting_input",
		events: [
			{ kind: "thinking_started", title: "Video plan" },
			{
				kind: "workflow_progress",
				plan: {
					id: "active",
					route: "plan_story",
					title: "Build story",
					items: [
						{ id: "inspect", label: "Read current timeline", status: "done" },
						{ id: "route", label: "Route to story plan", status: "done" },
						{
							id: "research",
							label: "Research sources",
							status: "done",
							tool: "research_topic",
							reason: "2 source(s) retrieved",
						},
						{ id: "clarify", label: "Answer questions about the sources", status: "running" },
						{ id: "plan", label: "Draft story plan", tool: "plan_story" },
						{ id: "approval", label: "Wait for your approval" },
						{
							id: "generate",
							label: "Generate sections and assets",
							tool: "generate_story_assets",
						},
						{ id: "finalize", label: "Finalize timeline" },
					],
				},
			},
			{
				kind: "question",
				question: "The sources disagree on one thing. (1 questions)",
				options: [{ label: "The Ohio fund", value: "the Ohio fund" }],
				actionId: ACTION,
				batch: BATCH,
			},
		],
		scenes: [],
		slides: [],
		posts: [],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		error: null,
	};
}

/** The same run after its wait timed out: terminal, with no answer chosen. */
function abandonedJob() {
	const parked = parkedJob();
	return {
		...parked,
		status: "error",
		error: "Run abandoned — timed out awaiting input. Retry to continue.",
		events: [
			...parked.events,
			{ kind: "error", message: "Run abandoned — timed out awaiting input. Retry to continue." },
		],
	};
}

interface Submission {
	batchId: string;
	bestJudgment?: boolean;
	answers?: Array<{ questionId: string; optionId?: string; otherText?: string }>;
}
interface AnswerBody {
	answer?: string;
	action_id?: string;
	batch_answer?: Submission;
}

async function parkOnBatch(
	page: Page,
	job: () => unknown = parkedJob,
): Promise<{ submitted: AnswerBody[] }> {
	const submitted: AnswerBody[] = [];
	await replayApi(page.context(), HAR);
	await page.route(CHAT_URL, (route: Route) => route.fulfill({ json: job() }));
	await page.route(JOB_URL, (route: Route) => route.fulfill({ json: job() }));
	await page.route(ANSWER_URL, async (route: Route) => {
		submitted.push(JSON.parse(route.request().postData() ?? "{}") as AnswerBody);
		await route.fulfill({ status: 202, json: { jobId: JOB, status: "running" } });
	});
	return { submitted };
}

async function openChat(page: Page): Promise<void> {
	await page.goto(`/content/${PROJECT}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	// Alt+2 is the Chat rail. A click would toggle whichever rail is already open.
	await page.keyboard.press("Alt+Digit2");
}

async function openParkedChat(page: Page): Promise<void> {
	await openChat(page);
	await page.locator(".fc-clarify-group").first().waitFor({ state: "visible", timeout: 60_000 });
}

/* Console errors the CARD caused. The replay aborts every route the recording
 * has no entry for, so those are filtered. */
function consoleErrors(page: Page): string[] {
	const errors: string[] = [];
	const fromReplay = (text: string): boolean =>
		text.includes("net::ERR_FAILED") || text.includes("Failed to fetch");
	page.on("console", (message) => {
		if (message.type() === "error" && !fromReplay(message.text())) errors.push(message.text());
	});
	page.on("pageerror", (error) => {
		if (!fromReplay(error.message)) errors.push(error.message);
	});
	return errors;
}

test.describe("post-research story clarification", () => {
	test("a material research choice renders with the sources behind each option", async ({
		page,
	}, testInfo) => {
		const errors = consoleErrors(page);
		await parkOnBatch(page);
		await openParkedChat(page);

		await expect(page.locator(".fc-clarify-group")).toHaveCount(1);
		await expect(page.locator(".fc-clarify-group").first()).toContainText(
			"Which fund should the video follow?",
		);
		await expect(page.locator(".fc-clarify-group").first()).toContainText("compounded at 7.1%");

		// Each option names the page the run actually read, and links to it.
		const sources = page.locator("a.fc-clarify-opt-source");
		await expect(sources).toHaveCount(2);
		await expect(sources.nth(0)).toHaveText("Ohio pension study");
		await expect(sources.nth(0)).toHaveAttribute("href", OHIO);
		await expect(sources.nth(1)).toHaveAttribute("href", VERMONT);

		await page.screenshot({ path: `${OUT}/${testInfo.project.name}-batch.png`, fullPage: false });
		expect(errors).toEqual([]);
	});

	test("nothing downstream of the checkpoint is shown before the answer", async ({ page }) => {
		const errors = consoleErrors(page);
		await parkOnBatch(page);
		await openParkedChat(page);

		/* No plan from THIS run and no approval gate: it is parked before the script
		 * exists. The timeline's own clips are the fixture project's existing content
		 * and say nothing about this run, so they are not asserted on — what matters
		 * is that the parked run produced no plan to approve and offers no approval. */
		await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
		await expect(page.locator(".fc-plan-section")).toHaveCount(0);
		// The only way forward is the question.
		await expect(page.getByRole("button", { name: "Use these answers" })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test("the workflow board shows research done and the run waiting on the user", async ({
		page,
	}, testInfo) => {
		await parkOnBatch(page);
		await openParkedChat(page);

		const chat = page.locator(".fc-chat, .fc-rail").first();
		// The run card names the step it is parked on; the board behind it is the
		// run's activity, collapsed once output exists and reopened on request.
		const run = chat.locator(".fc-run").last();
		await expect(run.locator("[data-gen='stage']")).toContainText(
			"Answer questions about the sources",
		);
		const activity = run.getByRole("button", { name: /activity/ });
		if ((await activity.getAttribute("aria-expanded")) === "false") await activity.click();
		await expect(chat).toContainText("Research sources");
		await page.screenshot({
			path: `${OUT}/${testInfo.project.name}-progress.png`,
			fullPage: false,
		});
	});

	test("answering leaves as one structured submission for the post-research batch", async ({
		page,
	}) => {
		const errors = consoleErrors(page);
		const recorded = await parkOnBatch(page);
		await openParkedChat(page);

		await page.getByLabel("The Vermont fund").check();
		await page.getByRole("button", { name: "Use these answers" }).click();

		await expect.poll(() => recorded.submitted.length).toBe(1);
		expect(recorded.submitted[0]?.batch_answer).toEqual({
			batchId: "batch-funds",
			answers: [{ questionId: "case", optionId: "vermont" }],
		});
		expect(recorded.submitted[0]?.action_id).toBe(ACTION);
		expect(errors).toEqual([]);
	});

	test("best judgment delegates the evidence decision without inventing one", async ({ page }) => {
		const recorded = await parkOnBatch(page);
		await openParkedChat(page);

		await page.getByRole("button", { name: "Use your best judgment" }).click();

		await expect.poll(() => recorded.submitted.length).toBe(1);
		expect(recorded.submitted[0]?.batch_answer).toEqual({
			batchId: "batch-funds",
			bestJudgment: true,
		});
	});

	test("a reload during the suspension comes back to the same unanswered question", async ({
		page,
	}) => {
		const errors = consoleErrors(page);
		await parkOnBatch(page);
		await openParkedChat(page);
		await page.getByLabel("The Vermont fund").check();

		// A reload closes the rail (a sheet on a phone), so it is reopened the same
		// way it was opened the first time.
		await openParkedChat(page);

		await expect(page.locator(".fc-clarify-group")).toHaveCount(1);
		await expect(page.getByLabel("The Vermont fund")).toBeChecked();
		await expect(page.getByRole("button", { name: "Use these answers" })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test("an abandoned wait is presented as terminal, with no answer chosen for the user", async ({
		page,
	}, testInfo) => {
		await parkOnBatch(page, abandonedJob);
		await openChat(page);

		/* The requirement is that the timeout is TERMINAL: no answer was chosen for
		 * the user and the held completion never ran, so the run offers nothing to
		 * answer and produced no plan. (How the run's terminal error is surfaced is
		 * the existing error presentation, which this change does not touch.) */
		await expect(page.getByRole("button", { name: "Use these answers" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Use your best judgment" })).toHaveCount(0);
		await expect(page.locator(".fc-plan-section")).toHaveCount(0);
		await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
		await page.screenshot({
			path: `${OUT}/${testInfo.project.name}-abandoned.png`,
			fullPage: false,
		});
	});

	test("a keyboard user can answer the evidence question with no pointer", async ({ page }) => {
		const recorded = await parkOnBatch(page);
		await openParkedChat(page);

		await page.getByLabel("The Vermont fund").focus();
		// Space owns editor playback; radio choices retain native arrow navigation.
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowLeft");
		await expect(page.getByLabel("The Vermont fund")).toBeChecked();
		await page.getByRole("button", { name: "Use these answers" }).focus();
		await page.keyboard.press("Enter");

		await expect.poll(() => recorded.submitted.length).toBe(1);
		expect(recorded.submitted[0]?.batch_answer?.answers).toEqual([
			{ questionId: "case", optionId: "vermont" },
		]);
	});
});
