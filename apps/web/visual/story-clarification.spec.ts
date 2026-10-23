/* The pre-research clarification card, driven in a real browser.
 *
 * Static tests prove the component's contract; they cannot prove the card is
 * REACHABLE — that a parked run's question event actually renders it, that the
 * answer leaves as a structured submission, and that nothing downstream of the
 * checkpoint appears before the user answers. So this drives the editor's chat
 * with the chat routes replayed: the job is parked on a batch, and the spec
 * answers it the way a person would.
 *
 * The chat routes are authored here rather than recorded, for the reason the
 * other authored fixture exists: a recording would need a live model to produce
 * a batch, and would then freeze one model's questions into the suite.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const HAR = resolve(HERE, "fixtures/api-editor-chat.har");
const OUT = resolve(HERE, ".output/story-clarification");
const PROJECT = EDITOR_CHAT_FIXTURE_PROJECT_ID;
const JOB = "agent-clarify-1";
const ACTION = "action-clarify-1";

const CHAT_URL = new RegExp(`/api/operations/projects/${PROJECT}/chat(\\?|$)`);
const JOB_URL = new RegExp(`/api/operations/projects/${PROJECT}/chat/${JOB}(\\?|$)`);
const ANSWER_URL = new RegExp(`/api/operations/projects/${PROJECT}/chat/${JOB}/answer(\\?|$)`);

const BATCH = {
	id: "batch-tides",
	stage: "pre_research",
	purpose: "story_brief",
	intro: "A few decisions before I plan this story.",
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
					description: "Frames the tradeoffs a decision-maker weighs.",
					recommended: true,
				},
				{
					id: "newcomers",
					label: "Newcomers",
					value: "newcomers",
					description: "Defines every term before using it.",
				},
			],
		},
		{
			id: "context",
			header: "Example context",
			question: "Which concrete example should it build on?",
			options: [
				{
					id: "harbour",
					label: "A working harbour",
					value: "a working harbour",
					description: "Grounds the story in one place the viewer can picture.",
					recommended: true,
				},
				{
					id: "lab",
					label: "A lab tide model",
					value: "a lab tide model",
					description: "Keeps the explanation abstract and diagrammatic.",
				},
			],
		},
	],
} as const;

/** The parked job: one question event carrying the batch, nothing after it. */
function parkedJob() {
	return {
		jobId: JOB,
		status: "awaiting_input",
		events: [
			{ kind: "thinking_started", title: "Clarify the story" },
			{
				kind: "thinking_note",
				title: "Clarify the story",
				body: "Asking 2 question(s) before framing so the plan is not guessing.",
				elapsedSec: 0,
			},
			{
				kind: "question",
				question: "A few decisions before I plan this story. (2 questions)",
				options: [{ label: "Team leaders", value: "team leaders" }],
				actionId: ACTION,
				batch: BATCH,
			},
		],
		scenes: [],
		slides: [],
		posts: [],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		error: null,
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

/** Replay the API, then park the project's chat on the batch and record what
 *  the card submits. */
async function parkOnBatch(page: Page): Promise<{ submitted: AnswerBody[]; rejected: number[] }> {
	const submitted: AnswerBody[] = [];
	const rejected: number[] = [];
	await replayApi(page.context(), HAR);
	/* Regexes, not globs: every operations request carries the active workspace as
	   a query parameter, and a glob ending at the path would miss it. */
	await page.route(CHAT_URL, (route: Route) => route.fulfill({ json: parkedJob() }));
	await page.route(JOB_URL, (route: Route) => route.fulfill({ json: parkedJob() }));
	await page.route(ANSWER_URL, async (route: Route) => {
		const body = JSON.parse(route.request().postData() ?? "{}") as AnswerBody;
		submitted.push(body);
		// The server's own rule, mirrored: a superseded action never resolves.
		if (body.action_id && body.action_id !== ACTION) {
			rejected.push(409);
			await route.fulfill({ status: 409, json: { error: "stale_action" } });
			return;
		}
		await route.fulfill({ status: 202, json: { jobId: JOB, status: "running" } });
	});
	return { submitted, rejected };
}

async function openChat(page: Page): Promise<void> {
	await page.goto(`/content/${PROJECT}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	// Alt+2 is the Chat rail. A click would toggle whichever rail is already open.
	await page.keyboard.press("Alt+Digit2");
	await page.locator(".fc-clarify-group").first().waitFor({ state: "visible", timeout: 60_000 });
}

/* Console errors the CARD caused.
 *
 * The replay aborts every route the recording has no entry for — the editor's
 * autosave among them — so a raw console listener reports the fixture's own
 * gaps as defects of the thing under test. Aborted fetches are filtered; a real
 * page error is not.
 */
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

test.describe("pre-research story clarification", () => {
	test("renders every question with its options, impact notes and recommendation", async ({
		page,
	}, testInfo) => {
		const errors = consoleErrors(page);
		await parkOnBatch(page);
		await openChat(page);

		const groups = page.locator(".fc-clarify-group");
		await expect(groups).toHaveCount(2);
		await expect(groups.first()).toContainText("Who is this for?");
		await expect(groups.first()).toContainText("Frames the tradeoffs a decision-maker weighs.");
		await expect(page.locator(".fc-clarify-rec")).toHaveCount(2);
		// The run is parked ON the batch: its actions are the only way forward.
		await expect(page.getByRole("button", { name: "Use these answers" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Use your best judgment" })).toBeVisible();
		await page.screenshot({ path: `${OUT}/${testInfo.project.name}-batch.png`, fullPage: false });
		expect(errors).toEqual([]);
	});

	test("an option answer leaves as one structured submission", async ({ page }) => {
		const errors = consoleErrors(page);
		const recorded = await parkOnBatch(page);
		await openChat(page);

		await page.getByLabel("Newcomers").check();
		await page.getByLabel("A lab tide model").check();
		await page.getByRole("button", { name: "Use these answers" }).click();

		await expect.poll(() => recorded.submitted.length).toBe(1);
		expect(recorded.submitted[0]?.batch_answer).toEqual({
			batchId: "batch-tides",
			answers: [
				{ questionId: "audience", optionId: "newcomers" },
				{ questionId: "context", optionId: "lab" },
			],
		});
		expect(recorded.submitted[0]?.action_id).toBe(ACTION);
		expect(errors).toEqual([]);
	});

	test("an Other answer carries its own text", async ({ page }) => {
		const recorded = await parkOnBatch(page);
		await openChat(page);

		await page.getByLabel("Team leaders").check();
		await page.getByLabel("Your own answer for Example context").fill("a tidal power station");
		await page.getByRole("button", { name: "Use these answers" }).click();

		await expect.poll(() => recorded.submitted.length).toBe(1);
		expect(recorded.submitted[0]?.batch_answer?.answers).toEqual([
			{ questionId: "audience", optionId: "leaders" },
			{ questionId: "context", otherText: "a tidal power station" },
		]);
	});

	test("best judgment delegates without inventing answers", async ({ page }) => {
		const recorded = await parkOnBatch(page);
		await openChat(page);

		await page.getByRole("button", { name: "Use your best judgment" }).click();

		await expect.poll(() => recorded.submitted.length).toBe(1);
		expect(recorded.submitted[0]?.batch_answer).toEqual({
			batchId: "batch-tides",
			bestJudgment: true,
		});
	});

	test("an incomplete answer is refused in the card and never reaches the server", async ({
		page,
	}, testInfo) => {
		const recorded = await parkOnBatch(page);
		await openChat(page);

		await page.getByLabel("Team leaders").check();
		await page.getByRole("button", { name: "Use these answers" }).click();

		await expect(page.locator(".fc-clarify-error")).toContainText("Choose an option");
		// Focus moved to the group that still needs an answer.
		await expect(page.getByLabel("A working harbour")).toBeFocused();
		await page.screenshot({
			path: `${OUT}/${testInfo.project.name}-incomplete.png`,
			fullPage: false,
		});
		expect(recorded.submitted).toEqual([]);
	});

	test("a keyboard user can traverse, answer and submit with no pointer", async ({ page }) => {
		const recorded = await parkOnBatch(page);
		await openChat(page);

		// Focus enters the batch when it appears.
		await expect(page.getByLabel("Team leaders")).toBeFocused();

		/* Tab from there and record where focus lands. The exact stop list is a
		 * platform decision (a phone and a desktop disagree about which controls a
		 * Tab visits), so what is asserted is the requirement: every question's
		 * group and both actions are reachable from the keyboard. */
		const stops: string[] = [];
		for (let step = 0; step < 24; step++) {
			stops.push(
				await page.evaluate(() => {
					const active = document.activeElement;
					return (
						active?.id || active?.getAttribute("aria-label") || active?.textContent?.trim() || ""
					);
				}),
			);
			if (stops.at(-1)?.includes("Use your best judgment")) break;
			await page.keyboard.press("Tab");
		}
		expect(stops.some((stop) => stop.startsWith("batch-tides-audience"))).toBe(true);
		expect(stops.some((stop) => stop.startsWith("batch-tides-context"))).toBe(true);
		expect(stops.some((stop) => stop.includes("Use these answers"))).toBe(true);
		expect(stops.some((stop) => stop.includes("Use your best judgment"))).toBe(true);

		// Native arrows choose radios; Space owns editor playback.
		for (const label of ["Team leaders", "A working harbour"]) {
			await page.getByLabel(label).focus();
			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("ArrowLeft");
			await expect(page.getByLabel(label)).toBeChecked();
		}
		await page.getByRole("button", { name: "Use these answers" }).focus();
		await page.keyboard.press("Enter");

		await expect.poll(() => recorded.submitted.length).toBe(1);
		expect(recorded.submitted[0]?.batch_answer?.answers).toEqual([
			{ questionId: "audience", optionId: "leaders" },
			{ questionId: "context", optionId: "harbour" },
		]);
	});

	test("pending selections survive a reload", async ({ page }) => {
		await parkOnBatch(page);
		await openChat(page);
		await page.getByLabel("Newcomers").check();

		// A reload closes the rail (a sheet on a phone), so the panel is reopened the
		// same way it was opened the first time.
		await openChat(page);
		await expect(page.getByLabel("Newcomers")).toBeChecked();
	});

	test("a superseded action id is refused by the server and nothing is applied", async ({
		page,
	}) => {
		const recorded = await parkOnBatch(page);
		await page.unroute(ANSWER_URL);
		await page.route(ANSWER_URL, async (route: Route) => {
			recorded.submitted.push(JSON.parse(route.request().postData() ?? "{}") as AnswerBody);
			await route.fulfill({ status: 409, json: { error: "stale_action" } });
		});
		await openChat(page);

		await page.getByRole("button", { name: "Use your best judgment" }).click();
		await expect.poll(() => recorded.submitted.length).toBe(1);
		// The refusal stands: the card is the only thing the run moved on.
		await expect(page.locator(".fc-clarify-group")).toHaveCount(2);
	});
});
