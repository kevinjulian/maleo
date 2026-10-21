import { chooseOption } from "./options.ts";
import { expect, test, type BrowserContext } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
	applyStoryboardCommand,
	approveStoryDraft,
	storyboardCommandSchema,
	storyboardGenerationStateSchema,
	toTimelineDoc,
	type StoryboardGenerationState,
} from "@maleo/shared";
import { z } from "zod";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { storyboardAuthoringState } from "./fixtures/fixture-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const commandBodySchema = z.object({
	expectedRevisionId: z.string(),
	command: storyboardCommandSchema,
});
const approvalBodySchema = z.object({
	expectedRevisionId: z.string(),
	extensionPolicy: z.enum(["review_additions", "auto_approve_additions"]),
});
const harSchema = z.object({
	log: z.object({
		entries: z.array(
			z.object({
				request: z.object({ url: z.string() }),
				response: z.object({ content: z.object({ text: z.string() }) }),
			}),
		),
	}),
});

interface StoryboardServer {
	state: StoryboardGenerationState | null;
	generatedByBeatId: Record<string, Array<Record<string, unknown>>>;
	revision: number;
	conflictNext: boolean;
	lastChatInstruction: string;
}

async function storyboardServer(
	context: BrowserContext,
	initial: StoryboardGenerationState | null,
): Promise<StoryboardServer> {
	const server: StoryboardServer = {
		state: initial,
		generatedByBeatId: {},
		revision: 0,
		conflictNext: false,
		lastChatInstruction: "",
	};
	await context.route("**/api/operations/projects/*/storyboard-authoring**", async (route) => {
		const request = route.request();
		if (request.method() === "GET") {
			await route.fulfill({
				json: { state: server.state, legacy: false, generatedByBeatId: server.generatedByBeatId },
			});
			return;
		}
		if (new URL(request.url()).pathname.endsWith("/approve")) {
			const body = approvalBodySchema.parse(request.postDataJSON());
			if (!server.state || body.expectedRevisionId !== server.state.draft.revisionId)
				throw new Error("invalid approval fixture state");
			server.state = approveStoryDraft(
				server.state,
				"explicit",
				body.extensionPolicy,
				"2026-01-02T00:00:00.000Z",
			);
			await route.fulfill({
				json: {
					ok: true,
					state: server.state,
					legacy: false,
					generatedByBeatId: server.generatedByBeatId,
				},
			});
			return;
		}
		const body = commandBodySchema.parse(request.postDataJSON());
		if (server.conflictNext && server.state) {
			server.conflictNext = false;
			const remote = structuredClone(server.state);
			remote.draft.sections[0]!.beats[0]!.narration = "Remote canonical narration.";
			remote.draft.revisionId = `server-conflict-${++server.revision}`;
			server.state = storyboardGenerationStateSchema.parse(remote);
			await route.fulfill({
				status: 409,
				json: {
					ok: false,
					reason: "conflict",
					message: "Story draft changed; reload and retry.",
					state: server.state,
					legacy: false,
					generatedByBeatId: server.generatedByBeatId,
				},
			});
			return;
		}
		if (!server.state) {
			if (body.expectedRevisionId !== "missing" || body.command.type !== "add_section")
				throw new Error("first command must create section");
			server.state = storyboardGenerationStateSchema.parse({
				planId: "browser-plan",
				draft: {
					revisionId: `browser-revision-${++server.revision}`,
					sections: [body.command.section],
				},
			});
		} else {
			const result = applyStoryboardCommand(
				server.state,
				body.expectedRevisionId,
				body.command,
				`browser-revision-${++server.revision}`,
			);
			if (!result.ok) throw new Error(result.message);
			server.state = result.state;
		}
		await route.fulfill({
			json: {
				ok: true,
				state: server.state,
				legacy: false,
				generatedByBeatId: server.generatedByBeatId,
			},
		});
	});
	await context.route("**/api/operations/projects/*/chat/fixture-storyboard-job**", (route) =>
		route.fulfill({
			json: {
				status: "done",
				events: [{ kind: "final", text: "Selected beat regenerated." }],
				scenes: [],
				slides: [],
				posts: [],
				textOverlays: [],
				videoOverlays: [],
				audioOverlays: [],
				characters: [],
				artifacts: [],
				error: null,
			},
		}),
	);
	await context.route("**/api/operations/projects/*/chat**", async (route) => {
		if (
			route.request().method() !== "POST" ||
			!new URL(route.request().url()).pathname.endsWith("/chat")
		) {
			await route.fallback();
			return;
		}
		const body = z
			.object({ instruction: z.string() })
			.passthrough()
			.parse(route.request().postDataJSON());
		server.lastChatInstruction = body.instruction;
		if (!server.state?.approvedSnapshot) throw new Error("generation requires approval");
		const beat = server.state.draft.sections
			.flatMap((section) => section.beats)
			.find((item) => body.instruction.includes(JSON.stringify(item.id)));
		if (!beat) throw new Error("selected beat id missing from chat instruction");
		server.generatedByBeatId[beat.id] = [
			{
				semanticBeatId: beat.id,
				status: "ready",
				imageUrls: [
					"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'/%3E",
				],
				imageSourceRevisionIds: [server.state.approvedSnapshot.revisionId],
			},
		];
		await route.fulfill({ json: { jobId: "fixture-storyboard-job" } });
	});
	return server;
}

async function projectWithScene(context: BrowserContext): Promise<void> {
	const har = harSchema.parse(JSON.parse(readFileSync(HAR, "utf8")));
	const entry = har.log.entries.find(
		(item) =>
			new URL(item.request.url).pathname === `/api/operations/projects/${FIXTURE_PROJECT_ID}`,
	);
	if (!entry) throw new Error("fixture project response missing");
	const body = z
		.object({ storyboards: z.array(z.record(z.unknown())).min(1) })
		.passthrough()
		.parse(JSON.parse(entry.response.content.text));
	const doc = z.record(z.unknown()).parse(body.storyboards[0]!.storyboard_json);
	const timeline = toTimelineDoc(
		[
			{
				id: 1,
				name: "Fixture scene",
				shot: "Medium Shot",
				move: "Static",
				img: false,
				vo: "Fixture narration.",
				vis: "Fixture visual.",
				dur: 5,
				src: "",
			},
		],
		[],
		[],
		[],
		[],
		[],
	);
	doc.clips = [...z.array(z.unknown()).parse(doc.clips ?? []), ...timeline.clips];
	doc.markers = timeline.markers;
	body.storyboards[0] = { ...body.storyboards[0], storyboard_json: doc };
	await context.route(`**/api/operations/projects/${FIXTURE_PROJECT_ID}**`, async (route) => {
		if (
			route.request().method() === "GET" &&
			new URL(route.request().url()).pathname === `/api/operations/projects/${FIXTURE_PROJECT_ID}`
		) {
			await route.fulfill({ json: body });
			return;
		}
		await route.fallback();
	});
}

async function openStoryboard(
	context: BrowserContext,
	serverState: StoryboardGenerationState | null,
	withScene = false,
) {
	await replayApi(context, HAR);
	if (withScene) await projectWithScene(context);
	return storyboardServer(context, serverState);
}

test.describe("storyboard authoring", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test("authors from empty without chat and reloads every manual mutation", async ({
		page,
		context,
	}) => {
		const server = await openStoryboard(context, null);
		await page.goto(`/content/${FIXTURE_PROJECT_ID}/storyboard`);
		await page.getByRole("button", { name: "Create storyboard" }).click();
		await expect(page.locator(".sb-author-beat")).toHaveCount(1);

		const opening = page.locator(".sb-author-beat").first();
		await opening.getByLabel(/Narration for/).fill("First clause. Second clause.");
		await opening.getByLabel(/Narration for/).blur();
		await opening.getByRole("button", { name: "Add after" }).click();
		await expect(page.locator(".sb-author-beat")).toHaveCount(2);
		const added = page.locator(".sb-author-beat").nth(1);
		await added.getByRole("button", { name: "Move up" }).click();
		await expect(page.locator(".sb-author-beat").first()).toContainText("New beat");
		await expect(page.locator(".sb-author-beat").first()).toBeFocused();
		await page.locator(".sb-author-beat").first().getByRole("button", { name: "Lock" }).click();
		await page.locator(".sb-author-beat").first().getByRole("button", { name: "Unlock" }).click();
		await page.locator(".sb-author-beat").first().locator("summary").click();
		await page
			.locator(".sb-author-beat")
			.first()
			.getByLabel(/Reference id/)
			.fill("fixture-reference");
		await page.locator(".sb-author-beat").first().getByRole("button", { name: "Attach" }).click();
		await expect(page.locator(".sb-author-beat").first()).toContainText("fixture-reference");

		await page.locator(".sb-author-beat").nth(1).getByRole("button", { name: "Split" }).click();
		await expect(page.locator(".sb-author-beat")).toHaveCount(3);
		await page
			.locator(".sb-author-beat")
			.nth(2)
			.getByRole("button", { name: "Merge previous" })
			.click();
		await expect(page.locator(".sb-author-beat")).toHaveCount(2);
		await page.locator(".sb-author-beat").first().getByRole("button", { name: "Remove" }).click();
		await expect(page.locator(".sb-author-beat")).toHaveCount(1);
		await page.getByRole("button", { name: "Add section" }).click();
		await expect(page.locator(".sb-author-section")).toHaveCount(2);
		await page
			.locator(".sb-author-section")
			.nth(1)
			.getByRole("button", { name: "Remove section" })
			.click();
		await expect(page.locator(".sb-author-section")).toHaveCount(1);

		await page.reload();
		await expect(page.getByLabel(/Narration for/)).toHaveValue("First clause. Second clause.");
		expect(server.lastChatInstruction).toBe("");
	});

	test("approves, regenerates selected beat, marks stale output, resolves conflict, and keeps four views", async ({
		page,
		context,
	}) => {
		const initial = storyboardGenerationStateSchema.parse(storyboardAuthoringState);
		const server = await openStoryboard(context, initial, true);
		await page.goto(`/content/${FIXTURE_PROJECT_ID}/storyboard`);
		await expect(page.locator(".sb-author-view")).toBeVisible();
		await expect(page.getByLabel(/Editorial direction for Synthetic hook/)).toContainText(
			"Editorial direction",
		);
		const concept = page
			.getByLabel(/Editorial direction for Synthetic hook/)
			.getByLabel("Visual concept");
		await concept.fill("A tighter threshold reveal");
		await concept.blur();
		await expect
			.poll(() => server.state?.draft.sections[0]?.beats[0]?.editorial?.visualConcept)
			.toBe("A tighter threshold reveal");

		const secondId = initial.draft.sections[0]!.beats[1]!.id;
		await page.locator(".sb-author-beat").nth(1).getByRole("button", { name: "Move up" }).click();
		await chooseOption(page.getByLabel("Duration extension policy"), "auto_approve_additions");
		await page.getByRole("button", { name: "Approve draft" }).click();
		await expect(page.locator(".sb-author-banner").first()).toContainText("auto approve additions");

		await page
			.locator(`[data-story-beat-id="${secondId}"]`)
			.getByRole("button", { name: "Regenerate" })
			.click();
		await expect.poll(() => server.lastChatInstruction).toContain(JSON.stringify(secondId));
		await page.locator(`[data-story-beat-id="${secondId}"] summary`).click();
		await expect(page.locator(`[data-story-beat-id="${secondId}"]`)).toContainText(
			"Current visual",
			{ timeout: 10_000 },
		);

		const narration = page
			.locator(`[data-story-beat-id="${secondId}"]`)
			.getByLabel(/Narration for/);
		await narration.fill("Locally revised selected beat.");
		await narration.blur();
		await page.getByRole("button", { name: "Approve draft" }).click();
		await expect(page.locator(`[data-story-beat-id="${secondId}"]`)).toContainText("Stale visual");
		await page
			.locator(`[data-story-beat-id="${secondId}"]`)
			.getByRole("button", { name: "Regenerate" })
			.click();
		await expect(page.locator(`[data-story-beat-id="${secondId}"]`)).toContainText(
			"Current visual",
			{ timeout: 10_000 },
		);

		server.conflictNext = true;
		await narration.fill("Uncommitted local retry text.");
		await narration.blur();
		await expect(page.locator(".sb-author-banner[role='alert']")).toContainText(
			"Revision conflict",
		);
		await expect(narration).toHaveValue("Uncommitted local retry text.");
		await page.reload();
		await expect(page.getByLabel(/Narration for/).first()).toHaveValue(
			"Remote canonical narration.",
		);
		const planBeforeExecutionEdits = JSON.stringify(server.state);
		await page.getByRole("tab", { name: "Script", exact: true }).click();
		const scriptNarration = page.getByLabel(/Narration for/).first();
		await scriptNarration.fill("Script-owned scene narration.");
		await scriptNarration.blur();
		await expect(scriptNarration).toHaveValue("Script-owned scene narration.");
		await page.getByRole("tab", { name: "Timeline", exact: true }).click();
		await expect(page.locator(".tl2-timeline")).toBeVisible();
		const timelineClip = page
			.locator("[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']")
			.first();
		await expect(timelineClip).toBeVisible();
		const clipBox = (await timelineClip.boundingBox())!;
		const leftBefore = Number.parseFloat(
			await timelineClip.evaluate((element) => element.style.left),
		);
		await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(clipBox.x + clipBox.width / 2 + 60, clipBox.y + clipBox.height / 2, {
			steps: 6,
		});
		await page.mouse.up();
		await expect
			.poll(() => timelineClip.evaluate((element) => Number.parseFloat(element.style.left)))
			.not.toBe(leftBefore);
		expect(JSON.stringify(server.state)).toBe(planBeforeExecutionEdits);
		await page.getByRole("tab", { name: "Storyboard", exact: true }).click();
		await expect(page.getByLabel(/Narration for/).first()).toHaveValue(
			"Remote canonical narration.",
		);
		await expect(page.getByRole("button", { name: /copy|sync/i })).toHaveCount(0);

		for (const name of ["Storyboard", "Script", "Timeline", "Studio"]) {
			await page.getByRole("tab", { name, exact: true }).click();
			await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
				"aria-selected",
				"true",
			);
		}
	});
});
