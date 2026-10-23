/* The project chat workspace, driven in a real browser.
 *
 * Component tests prove the chat's contracts; they cannot prove the pane sizes
 * against a real layout, that the keyboard reaches the resize boundary, or that
 * a run streamed from the API actually reaches a queued instruction, a pinned
 * reply, a targeted retry, `Show changes`, `Undo` and a fenced conflict. So this
 * replays the fixtures and authors the chat routes, the way the clarification
 * spec does: a recording would need a live model, and would then freeze one
 * model's output into the suite.
 *
 * Every flow writes a screenshot to `.output/chat-workspace/` as evidence; the
 * three chat states that are baselines are compared with `toHaveScreenshot`. */
import { fixtureArtifact } from "./fixtures/artifacts.ts";
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { acknowledgeSaves, job, serveChat, type ChatServer, type Json } from "./chat-server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO_HAR = resolve(HERE, "fixtures/api-editor-chat.har");
const OUT = resolve(HERE, ".output/chat-workspace");
const VIDEO = EDITOR_CHAT_FIXTURE_PROJECT_ID;
const FROZEN_NOW = new Date("2026-08-04T09:00:00Z").getTime();
/* Height budgets for the composer area at 1440x900, in CSS pixels: idle is the
 * two-row input with padding and a context line; pending adds a compact
 * decision (question, one row of choices and Stop). */
const COMPOSER_IDLE_MAX_PX = 110;
const COMPOSER_PENDING_MAX_PX = 210;

async function freeze(page: Page): Promise<void> {
	await page.addInitScript(`{
		const FROZEN = ${FROZEN_NOW};
		const RealDate = Date;
		class FrozenDate extends RealDate {
			constructor(...args) { super(...(args.length ? args : [FROZEN])); }
			static now() { return FROZEN; }
		}
		globalThis.Date = FrozenDate;
	}`);
}

async function openVideoChat(page: Page): Promise<void> {
	await page.goto(`/content/${VIDEO}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	// Alt+2 is the Chat rail; a click would toggle whichever rail is open.
	await page.keyboard.press("Alt+Digit2");
	await page.locator("[data-prompt='input']").waitFor({ state: "visible" });
}

/** The video project with the chat routes authored, for flows that settle a run. */
async function openVideoRun(page: Page): Promise<ChatServer> {
	await replayApi(page.context(), VIDEO_HAR);
	await acknowledgeSaves(page, VIDEO);
	/* A settled run writes a storyboard version; the replay has no entry for it. */
	await page.route(
		new RegExp(`/api/operations/projects/${VIDEO}/storyboards(\\?|$)`),
		async (route) => {
			if (route.request().method() !== "POST") {
				await route.fallback();
				return;
			}
			await route.fulfill({ json: { storyboard: { id: "sb-run", version: 2 } } });
		},
	);
	const server = await serveChat(page, VIDEO);
	await openVideoChat(page);
	return server;
}

/** The rendered width of a timeline clip, which a duration change moves. */
const clipWidth = (page: Page, id: string) =>
	page
		.locator(`[data-clipid="${id}"]`)
		.evaluate((el) => Math.round(el.getBoundingClientRect().width));
/** A settled run that held scene two for longer. */
const longerSceneTwo = [{ type: "clip.update", id: "scene:2", patch: { durationSec: 9 } }];

async function send(page: Page, text: string): Promise<void> {
	const box = page.locator("[data-prompt='input']");
	await box.fill(text);
	await box.press("Enter");
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await freeze(page);
});

/* ── 4.1 Desktop geometry ── */
test.describe("chat pane geometry", () => {
	test.beforeEach(async ({ page }) => {
		await replayApi(page.context(), VIDEO_HAR);
		await acknowledgeSaves(page, VIDEO);
		await serveChat(page, VIDEO);
	});

	test("Chat shares tools sizing, remains scrollable, and remembers resizing", async ({ page }) => {
		await openVideoChat(page);
		const pane = page.locator('.tl2-content-vui-shell [data-vui-slot="tools"]');
		const handle = page.getByRole("separator", { name: "Resize tools and preview" });
		const width = async () => Math.round((await pane.boundingBox())!.width);
		const original = await width();
		await handle.focus();
		await handle.press("ArrowRight");
		await expect.poll(width).toBe(original + 10);
		const resized = await width();
		await page.reload();
		await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
		await page.keyboard.press("Alt+Digit2");
		await expect.poll(width).toBe(resized);
		await page.keyboard.press("Alt+Digit1");
		await expect.poll(width).toBe(resized);
		await page.keyboard.press("Alt+Digit2");
		await expect(page.locator("[data-prompt='input']")).toBeInViewport();
		await expect(page.locator(".fc-chat-log")).toHaveCSS("min-height", "0px");
		await expect(page.locator(".fc-chat-log")).toHaveCSS("scrollbar-width", "none");
	});

	test("constrained desktop retains inspector and Chat under shared panel bounds", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1180, height: 820 });
		await openVideoChat(page);
		await expect(page.locator('.tl2-content-vui-shell [data-vui-slot="inspector"]')).toHaveCount(1);
		await expect(page.locator("[data-prompt='input']")).toBeInViewport();
		await expect(page.locator(".tl2-timeline")).toBeInViewport();
		await expect(page.locator(".tl2-canvas")).toBeVisible();
	});
});

/* ── 4.2 Keyboard, names, reduced motion ── */
test.describe("chat keyboard and assistive semantics", () => {
	test.beforeEach(async ({ page }) => {
		await replayApi(page.context(), VIDEO_HAR);
		await acknowledgeSaves(page, VIDEO);
	});

	test("Shift+Enter is a newline, Enter sends, Escape closes a menu without inserting", async ({
		page,
	}) => {
		const server = await serveChat(page, VIDEO);
		await openVideoChat(page);
		const box = page.getByRole("textbox", { name: "Instruction" });
		await box.fill("first line");
		await box.press("Shift+Enter");
		await box.pressSequentially("second line");
		await expect(box).toHaveValue("first line\nsecond line");
		await box.fill("fix @");
		await expect(page.getByRole("listbox", { name: "Project items" })).toBeVisible();
		await box.press("Escape");
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await expect(box).toHaveValue("fix @");
		expect(server.starts).toHaveLength(0);
		await box.fill("tighten the hook");
		await box.press("Enter");
		await expect.poll(() => server.starts.length).toBe(1);
		await expect(page.locator('[role="status"][aria-live="polite"]').first()).not.toBeEmpty();
		await expect(page.getByRole("log", { name: "Chat history" })).toBeVisible();
	});

	test("reduced motion removes nonessential transitions", async ({ page }) => {
		await serveChat(page, VIDEO);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await openVideoChat(page);
		const duration = await page
			.getByRole("separator", { name: "Resize tools and preview" })
			.evaluate((el) => getComputedStyle(el, "::after").transitionDuration);
		// VUI's reduced-motion rule caps transitions at one microsecond.
		expect(parseFloat(duration)).toBeLessThanOrEqual(0.000001);
	});
});

/* ── 5.3 Flows, and the 5.2 chat-state baselines ── */
test.describe("chat flows", () => {
	test("queued instruction waits for the run, then launches with context rebuilt", async ({
		page,
	}) => {
		await replayApi(page.context(), VIDEO_HAR);
		await acknowledgeSaves(page, VIDEO);
		const server = await serveChat(page, VIDEO);
		server.nextJobIds.push("agent-q1", "agent-q2");
		server.jobs.set(
			"agent-q1",
			job("running", [
				{
					kind: "workflow_progress",
					plan: {
						id: "wf",
						title: "Edit scene",
						route: "edit_scene",
						readonly: true,
						items: [
							{ id: "read", label: "Read scene", status: "done" },
							{ id: "rewrite", label: "Rewrite narration", status: "running" },
							{ id: "apply", label: "Apply", status: "pending" },
						],
					},
				},
			]),
		);
		await openVideoChat(page);
		await send(page, "tighten the hook");
		await expect(page.locator("[data-gen='stage']").last()).toHaveText("Rewrite narration");
		await expect(page.locator("[data-gen='count']").last()).toHaveText("1/3 steps");

		await page.locator("[data-prompt='input']").fill("then shorten the ending");
		await expect(page.getByRole("button", { name: "Send after current" })).toBeVisible();
		await page.locator("[data-prompt='input']").press("Enter");
		await expect(page.locator(".fc-queued")).toContainText("then shorten the ending");
		await page.waitForTimeout(1600);
		expect(server.starts).toHaveLength(1);
		await expect(page.locator(".tl2-panel")).toHaveScreenshot("chat-running-queued-1440.png");
		await page.screenshot({ path: `${OUT}/queued.png` });

		server.jobs.set("agent-q1", job("done", [{ kind: "final", text: "Tightened the hook." }]));
		await expect.poll(() => server.starts.length, { timeout: 10_000 }).toBe(2);
		expect(server.starts[1]!.instruction).toBe("then shorten the ending");
		expect((server.starts[1]!.envelope as Json | undefined)?.focus).toBeDefined();
		await expect(page.locator(".fc-queued")).toHaveCount(0);
	});

	test("pinned clarification answers only through Replying to", async ({ page }) => {
		await replayApi(page.context(), VIDEO_HAR);
		await acknowledgeSaves(page, VIDEO);
		const server = await serveChat(page, VIDEO);
		server.nextJobIds.push("agent-c1");
		server.jobs.set(
			"agent-c1",
			job("awaiting_input", [
				{
					kind: "question",
					question: "What should change in the plan?",
					options: [{ label: "Approve", value: "approve" }],
					actionId: "act-1",
					freeText: true,
				},
			]),
		);
		await openVideoChat(page);
		await send(page, "plan a tides explainer");
		const pinned = page.getByRole("region", { name: "Decision needed" });
		await expect(pinned).toContainText("What should change in the plan?");
		await expect(page.locator(".tl2-panel")).toHaveScreenshot("chat-pinned-decision-1440.png");

		await pinned.getByRole("button", { name: "Reply" }).click();
		await expect(page.locator(".fc-replying")).toContainText("Replying to");
		await expect(page.getByRole("textbox", { name: "Reply" })).toBeFocused();
		await page.keyboard.type("swap the second section for the harbour example");
		await page.keyboard.press("Enter");
		await expect.poll(() => server.answers.length).toBe(1);
		expect(server.answers[0]).toMatchObject({
			answer: "swap the second section for the harbour example",
			action_id: "act-1",
		});
		expect(server.starts).toHaveLength(1);
		await expect(page.getByRole("textbox", { name: "Instruction" })).toBeFocused();
		await page.screenshot({ path: `${OUT}/pinned-reply.png` });
	});

	test("a newer instruction waits for a parked decision, then owns Stop", async ({ page }) => {
		await replayApi(page.context(), VIDEO_HAR);
		await acknowledgeSaves(page, VIDEO);
		const server = await serveChat(page, VIDEO);
		server.nextJobIds.push("agent-d1", "agent-d2");
		server.jobs.set(
			"agent-d1",
			job("awaiting_input", [
				{
					kind: "artifact",
					artifact: fixtureArtifact("story_plan", {
						targetSec: 12,
						sections: [
							{
								id: "s0",
								title: "Only",
								narration: "n",
								visualPrompt: "v",
								estimatedDurationSec: 6,
								status: "draft",
							},
						],
					}),
				},
				{
					kind: "question",
					question: "Approve the plan?",
					options: [{ label: "Approve", value: "approve" }],
					actionId: "act-d",
				},
			]),
		);
		await openVideoChat(page);
		await send(page, "plan it");
		const pinned = page.getByRole("region", { name: "Decision needed" });
		// Editing the plan before approving it is part of the decision.
		await expect(pinned.getByRole("button")).toHaveText([
			"Approve & generate",
			"Open in Storyboard",
			"Stop",
		]);
		await expect(page.locator(".fc-plan-summary button:not([aria-expanded])")).toHaveCount(0);

		await send(page, "actually, make it about harbours");
		await expect(page.locator(".fc-queued")).toContainText("actually, make it about harbours");
		expect(server.starts).toHaveLength(1);
		await pinned.getByRole("button", { name: "Approve & generate" }).click();
		await expect.poll(() => server.answers.length).toBe(1);
		server.jobs.set("agent-d1", job("done", [{ kind: "final", text: "Plan approved." }]));
		await expect.poll(() => server.starts.length).toBe(2);
		await expect(pinned).toHaveCount(0);
		// The only Stop is the newer run's own.
		const stops = page.getByRole("button", { name: "Stop", exact: true });
		await expect(stops).toHaveCount(1);
		await expect(
			page.locator(".fc-run[data-frontier]").getByRole("button", { name: "Stop", exact: true }),
		).toHaveCount(1);
		await page.screenshot({ path: `${OUT}/superseded-decision.png` });
	});

	test("partial failure keeps completed sections and retries only failed scope", async ({
		page,
	}) => {
		await replayApi(page.context(), VIDEO_HAR);
		await acknowledgeSaves(page, VIDEO);
		const server = await serveChat(page, VIDEO);
		server.nextJobIds.push("agent-p1");
		const section = (i: number, status: string) => ({
			id: `s${i}`,
			title: `Section ${i + 1}`,
			narration: "n",
			visualPrompt: "v",
			estimatedDurationSec: 6,
			status,
		});
		server.jobs.set(
			"agent-p1",
			job("done", [
				{
					kind: "artifact",
					artifact: fixtureArtifact("story_plan", {
						targetSec: 30,
						sections: [section(0, "ready"), section(1, "failed"), section(2, "ready")],
					}),
				},
				{ kind: "final", text: "Two sections are ready; one failed." },
			]),
		);
		await openVideoChat(page);
		await send(page, "generate the sections");
		const card = page.locator('.fc-run[data-phase="partial"]');
		await expect(card).toBeVisible({ timeout: 10_000 });
		await expect(
			card.locator(".fc-run-note").filter({ hasText: "completed and kept" }),
		).toContainText("2 sections completed and kept. 1 failed");
		// The plan is a summary, and a partial run offers its one action — the
		// targeted retry — and nothing from its outputs.
		await expect(
			card.locator(".fc-plan-summary textarea, .fc-plan-summary [role=combobox]"),
		).toHaveCount(0);
		await expect(card.getByRole("button")).toHaveText(["Retry failed sections"]);
		await page.screenshot({ path: `${OUT}/partial.png` });
		await card.getByRole("button", { name: "Retry failed sections" }).click();
		await expect.poll(() => server.starts.length).toBe(2);
		expect(server.starts[1]!.instruction).toBe("Generate any remaining/failed sections.");
		// The retry is the newer instruction: the partial run and its plan are history.
		await expect(
			page.locator(".fc-chat-log .fc-run:not([data-frontier]) button:not([aria-expanded])"),
		).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Open in Storyboard" })).toHaveCount(0);
	});

	test("Open in Storyboard switches the editor to the Storyboard view", async ({ page }) => {
		await replayApi(page.context(), VIDEO_HAR);
		await acknowledgeSaves(page, VIDEO);
		const server = await serveChat(page, VIDEO);
		server.nextJobIds.push("agent-o1");
		server.jobs.set(
			"agent-o1",
			job("done", [
				{
					kind: "artifact",
					artifact: fixtureArtifact("story_plan", {
						targetSec: 12,
						sections: [
							{
								id: "s0",
								title: "Only",
								narration: "n",
								visualPrompt: "v",
								estimatedDurationSec: 6,
								status: "draft",
							},
						],
					}),
				},
				{ kind: "final", text: "Drafted a plan." },
			]),
		);
		await openVideoChat(page);
		await send(page, "draft a plan");
		await page.getByRole("button", { name: "Open in Storyboard" }).click();
		await expect(page.locator(".tl2-timeline")).toHaveCount(0);
		await expect(page.locator('[class^="sb-author"]').first()).toBeVisible();
		// Beside the Storyboard view there is nothing to open.
		await expect(page.getByRole("button", { name: "Open in Storyboard" })).toHaveCount(0);
		await page.screenshot({ path: `${OUT}/open-in-storyboard.png` });
	});

	test("Show changes selects the changed clip and Undo reverses the run in one step", async ({
		page,
	}) => {
		const server = await openVideoRun(page);
		const before = await clipWidth(page, "scene:2");
		server.nextJobIds.push("agent-u1");
		server.jobs.set("agent-u1", job("running", []));
		await send(page, "hold scene two longer");
		await expect(page.locator('.fc-run[data-phase="running"]')).toBeVisible();
		server.jobs.set(
			"agent-u1",
			job("done", [{ kind: "final", text: "Held scene two longer." }], {
				commands: longerSceneTwo,
			}),
		);

		const result = page.locator(".fc-result").last();
		await expect(result).toContainText("Changed 1 item", { timeout: 10_000 });
		await expect.poll(() => clipWidth(page, "scene:2")).toBeGreaterThan(before);
		await result.getByRole("button", { name: "Show changes" }).click();
		await expect(page.locator('[data-clipid="scene:2"]')).toHaveAttribute("aria-selected", "true");
		await page.screenshot({ path: `${OUT}/show-changes.png` });

		await result.getByRole("button", { name: "Undo" }).click();
		await expect.poll(() => clipWidth(page, "scene:2")).toBe(before);
		await expect(result.getByRole("button", { name: "Undo" })).toHaveCount(0);
		await page.screenshot({ path: `${OUT}/undo.png` });
	});

	test("a result fenced by a newer edit is held, with review and re-plan and no success", async ({
		page,
	}) => {
		const server = await openVideoRun(page);
		server.nextJobIds.push("agent-h1");
		server.jobs.set("agent-h1", job("running", []));
		await send(page, "lengthen the text overlay");
		await expect(page.locator('.fc-run[data-phase="running"]')).toBeVisible();

		// The user removes the clip the run is about to change.
		await page.locator('[data-clipid="text:1"]').click();
		await page.keyboard.press("Delete");
		await expect(page.locator('[data-clipid="text:1"]')).toHaveCount(0);
		server.jobs.set(
			"agent-h1",
			job("done", [{ kind: "final", text: "Lengthened the text overlay." }], {
				commands: [{ type: "clip.update", id: "text:1", patch: { durationSec: 6 } }],
			}),
		);

		const held = page.locator(".fc-result.held");
		await expect(held).toBeVisible({ timeout: 10_000 });
		await expect(held).toContainText("Nothing was changed");
		await expect(
			page.locator(".fc-run").last().getByRole("button", { name: "Show changes" }),
		).toHaveCount(0);
		await expect(page.locator(".fc-run").last().getByRole("button", { name: "Undo" })).toHaveCount(
			0,
		);
		await expect(page.locator('[data-clipid="text:1"]')).toHaveCount(0);
		await expect(page.locator(".tl2-panel")).toHaveScreenshot("chat-held-result-1440.png");
		await page.screenshot({ path: `${OUT}/held.png` });

		await held.getByRole("button", { name: "Re-plan with my edits" }).click();
		await expect.poll(() => server.starts.length).toBe(2);
		expect(server.starts[1]!.instruction).toBe("lengthen the text overlay");
		// The re-plan is the newer instruction: the held run is history now, and
		// every control it offered is gone.
		await expect(held.getByRole("button")).toHaveCount(0);
		const stale = await page
			.locator(".fc-chat-log .fc-run:not([data-frontier])")
			.evaluateAll((runs) =>
				runs.flatMap((run) =>
					[...run.querySelectorAll("button, textarea, select, input")]
						.filter((el) => !el.matches(".fc-run-think-h, .fc-output-disclose, summary"))
						.map((el) => el.textContent),
				),
			);
		expect(stale).toEqual([]);
		await page.screenshot({ path: `${OUT}/after-supersede.png` });
	});
});

/* ── Hierarchy, colour and composer budget, on the real stylesheet ── */
test.describe("chat hierarchy", () => {
	test.beforeEach(async ({ page }) => {
		await replayApi(page.context(), VIDEO_HAR);
		await acknowledgeSaves(page, VIDEO);
	});

	test("a completed transcript is neutral and nests no bordered surface", async ({ page }) => {
		await serveChat(page, VIDEO);
		await openVideoChat(page);
		await page.locator(".fc-turn").first().waitFor();
		// Saved chat appears before the resumed-job check settles its running state.
		await expect(page.locator('.fc-chat-log .fc-run[data-phase="running"]')).toHaveCount(0);
		const report = await page.evaluate(() => {
			// Resolve the state tokens to the colours the browser actually paints.
			const probe = document.createElement("span");
			document.body.append(probe);
			const paint = (token: string) => {
				probe.style.color = `var(${token})`;
				return getComputedStyle(probe).color;
			};
			const state = new Map(["--ai", "--warn", "--err", "--ok"].map((t) => [paint(t), t]));
			probe.remove();
			const log = document.querySelector(".fc-chat-log")!;
			const coloured: string[] = [];
			for (const el of log.querySelectorAll<HTMLElement>("*")) {
				const cs = getComputedStyle(el);
				for (const value of [cs.color, cs.backgroundColor, cs.borderLeftColor, cs.borderTopColor]) {
					const token = state.get(value);
					if (token) coloured.push(`${el.className || el.tagName} ${token}`);
				}
			}
			const bordered = (el: Element) => {
				const cs = getComputedStyle(el);
				return (
					!el.matches("button, input, textarea, select, summary") &&
					["Top", "Right", "Bottom", "Left"].every(
						(side) => parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0,
					)
				);
			};
			const nested: string[] = [];
			for (const turn of log.querySelectorAll(".fc-turn")) {
				for (const el of turn.querySelectorAll("*")) {
					if (!bordered(el)) continue;
					let up = el.parentElement;
					while (up && up !== turn) {
						if (bordered(up)) {
							nested.push(String(el.className));
							break;
						}
						up = up.parentElement;
					}
				}
			}
			return { coloured: [...new Set(coloured)], nested: [...new Set(nested)] };
		});
		expect(report.coloured).toEqual([]);
		expect(report.nested).toEqual([]);
		await page.screenshot({ path: `${OUT}/completed-transcript.png` });
	});

	test("the composer area holds only live content", async ({ page }) => {
		const server = await serveChat(page, VIDEO);
		await openVideoChat(page);
		// Budget: the input and, at most, one context line. No healthy credit meter.
		const foot = page.locator(".fc-chat-foot");
		await expect(page.locator(".fc-creditmeter")).toHaveCount(0);
		expect((await foot.boundingBox())!.height).toBeLessThanOrEqual(COMPOSER_IDLE_MAX_PX);

		server.nextJobIds.push("agent-b1");
		server.jobs.set(
			"agent-b1",
			job("awaiting_input", [
				{
					kind: "question",
					question: "Approve the plan?",
					options: [
						{ label: "Approve", value: "approve" },
						{ label: "Reject", value: "reject" },
					],
					actionId: "act-b",
				},
			]),
		);
		await send(page, "plan it");
		await expect(page.getByRole("region", { name: "Decision needed" })).toBeVisible();
		expect((await foot.boundingBox())!.height).toBeLessThanOrEqual(COMPOSER_PENDING_MAX_PX);
		await page.screenshot({ path: `${OUT}/composer-pending.png` });
	});
});
