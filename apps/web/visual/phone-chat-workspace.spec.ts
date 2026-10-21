/* The phone's `Editor | Chat` workspace, driven in a real browser.
 *
 * Chat stopped being a sheet over the editor and became the workspace's other
 * view. What that has to keep is invisible to a screenshot: that switching
 * leaves the editor's geometry, selection and playhead where they were, that a
 * draft survives, that a run keeps reporting from the Editor view, and that
 * `Show changes` crosses back. So these are assertions; the two baselines at
 * the end are the Editor and Chat states themselves.
 *
 * Run: bun run visual -- --project=mobile phone-chat-workspace
 */
import { fixtureArtifact } from "./fixtures/artifacts.ts";
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { acknowledgeSaves, job, serveChat, type ChatServer } from "./chat-server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO_HAR = resolve(HERE, "fixtures/api-editor-chat.har");
const OUT = resolve(HERE, ".output/phone-chat-workspace");
const VIDEO = EDITOR_CHAT_FIXTURE_PROJECT_ID;
const FROZEN_NOW = new Date("2026-08-04T09:00:00Z").getTime();

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

async function openVideo(page: Page): Promise<ChatServer> {
	await replayApi(page.context(), VIDEO_HAR);
	await acknowledgeSaves(page, VIDEO);
	/* A selection or a run can write a storyboard version; the replay has no
	 * entry for it, and the failure banner it raises would shift the layout. */
	await page.route(
		new RegExp(`/api/operations/projects/${VIDEO}/storyboards(\\?|$)`),
		async (route) => {
			if (route.request().method() !== "POST") {
				await route.fallback();
				return;
			}
			await route.fulfill({ json: { storyboard: { id: "sb-phone", version: 2 } } });
		},
	);
	const server = await serveChat(page, VIDEO);
	await page.goto(`/content/${VIDEO}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	await page.evaluate(() => document.fonts.ready);
	return server;
}

const tab = (page: Page, name: "Editor" | "Chat") => page.getByRole("tab", { name, exact: true });
const composer = (page: Page) => page.locator(".cv-phonews-chat [data-prompt='input']");
const indicator = (page: Page) => page.locator(".cv-phonews-run");

async function send(page: Page, text: string): Promise<void> {
	await composer(page).fill(text);
	await composer(page).press("Enter");
}

/** The editor's geometry, read from the boxes that would move if the editor
 *  were remounted or resized: the stage, the timeline and the lanes' scroll. */
async function editorGeometry(page: Page) {
	return page.evaluate(() => {
		const box = (sel: string) => {
			const r = document.querySelector(sel)!.getBoundingClientRect();
			return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
		};
		const lanes = document.querySelector<HTMLElement>(".tl2-timeline [data-vui-slot='viewport']");
		return {
			stage: box(".tl2-stage"),
			timeline: box(".tl2-timeline"),
			scrollLeft: lanes?.scrollLeft ?? 0,
		};
	});
}

test.beforeEach(async ({ page }) => {
	await freeze(page);
});

test.describe("video workspace", () => {
	test("lands on Editor, with stage and timeline together and no chat in the bar", async ({
		page,
	}) => {
		await openVideo(page);
		await expect(page.getByRole("tablist", { name: "Workspace view" })).toBeVisible();
		await expect(tab(page, "Editor")).toHaveAttribute("aria-selected", "true");
		await expect(page.locator(".tl2-stage")).toBeVisible();
		await expect(page.locator(".tl2-timeline")).toBeVisible();
		// The bar no longer offers Chat a second time, and there is no chat sheet.
		await expect(page.locator(".tl2-rail").getByTitle(/^Chat /)).toHaveCount(0);
		await expect(page.locator(".tl2-panel-sheet")).toHaveCount(0);
		await expect(page.locator(".cv-phonews-chat")).toHaveCSS("visibility", "hidden");
	});

	test("switching both ways keeps geometry, selection, playhead, draft and the page", async ({
		page,
	}) => {
		await openVideo(page);
		await page.evaluate(() => {
			(window as unknown as { __noReload: boolean }).__noReload = true;
		});
		const url = page.url();

		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		const playhead = await page.locator("[data-transport='timecode']").innerText();
		const before = await editorGeometry(page);

		await tab(page, "Chat").click();
		await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
		await expect(composer(page)).toBeVisible();
		await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveAttribute(
			"data-slot",
			"icon-button",
		);
		// The selected clip is the composer's context.
		await expect(page.locator(".cv-phonews-chat .fc-context-item").first()).toBeVisible();
		await composer(page).fill("make this clip calmer");
		await page.screenshot({ path: `${OUT}/video-chat.png` });

		await tab(page, "Editor").click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		expect(await page.locator("[data-transport='timecode']").innerText()).toBe(playhead);
		expect(await editorGeometry(page)).toEqual(before);

		await tab(page, "Chat").click();
		await expect(composer(page)).toHaveValue("make this clip calmer");
		expect(page.url()).toBe(url);
		expect(
			await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
		).toBe(true);
	});

	test("a clip sheet does not follow the user into Chat", async ({ page }) => {
		await openVideo(page);
		await page.locator("[data-vui-slot='item']").first().click();
		await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
		await expect(page.locator(".ui-sheet.ui-sheet-open")).toHaveCount(1);
		await tab(page, "Chat").click();
		await expect(page.locator(".ui-sheet.ui-sheet-open")).toHaveCount(0);
	});

	test("the run indicator reports running, input and failure, and reaches Chat", async ({
		page,
	}) => {
		const server = await openVideo(page);
		server.nextJobIds.push("agent-r1", "agent-r2");
		server.jobs.set(
			"agent-r1",
			job("running", [
				{
					kind: "workflow_progress",
					plan: {
						id: "wf",
						title: "Edit scene",
						route: "edit_scene",
						readonly: true,
						items: [{ id: "read", label: "Read scene", status: "running" }],
					},
				},
			]),
		);
		await tab(page, "Chat").click();
		await send(page, "plan a tides explainer");
		await expect(page.locator(".cv-phonews-chat .fc-run[data-phase='running']")).toBeVisible();

		// Running, seen from Editor.
		await tab(page, "Editor").click();
		await expect(indicator(page)).toHaveAttribute("data-state", "running");
		await expect(indicator(page)).toHaveText("Chat working");
		await expect(page.locator(".cv-phonews-bar [role='status']")).toHaveText("Chat working");
		await page.screenshot({ path: `${OUT}/indicator-running.png` });
		await indicator(page).click();
		await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
		// The same run card, not a new one.
		await expect(page.locator(".cv-phonews-chat .fc-run[data-phase='running']")).toHaveCount(1);

		// Parked for input while Editor is visible.
		await tab(page, "Editor").click();
		server.jobs.set(
			"agent-r1",
			job("awaiting_input", [
				{
					kind: "question",
					question: "Approve the plan?",
					options: [{ label: "Approve", value: "approve" }],
					actionId: "act-r",
				},
			]),
		);
		await expect(indicator(page)).toHaveAttribute("data-state", "input", { timeout: 10_000 });
		await expect(page.locator(".cv-phonews-bar [role='status']")).toHaveText(
			"Chat needs your input",
		);
		await page.screenshot({ path: `${OUT}/indicator-input.png` });
		await indicator(page).click();
		const pinned = page.getByRole("region", { name: "Decision needed" });
		await expect(pinned).toBeVisible();
		await expect(pinned).toBeFocused();
		await expect(pinned.getByRole("button", { name: "Approve & generate" })).toHaveAttribute(
			"data-slot",
			"button",
		);

		// Failed, after a newer instruction.
		server.jobs.set(
			"agent-r2",
			job("done", [
				{
					kind: "artifact",
					artifact: fixtureArtifact("story_plan", {
						targetSec: 12,
						sections: [
							{
								id: "s0",
								title: "One",
								narration: "n",
								visualPrompt: "v",
								estimatedDurationSec: 6,
								status: "ready",
							},
							{
								id: "s1",
								title: "Two",
								narration: "n",
								visualPrompt: "v",
								estimatedDurationSec: 6,
								status: "failed",
							},
						],
					}),
				},
			]),
		);
		await send(page, "generate the sections");
		await expect(page.locator(".fc-queued")).toContainText("generate the sections");
		server.jobs.set("agent-r1", job("done", []));
		await pinned.getByRole("button", { name: "Approve & generate" }).click();
		await expect(page.locator(".cv-phonews-chat .fc-run[data-phase='partial']")).toBeVisible({
			timeout: 10_000,
		});
		await tab(page, "Editor").click();
		await expect(indicator(page)).toHaveAttribute("data-state", "failed");
		await expect(indicator(page)).toHaveText("Chat run failed");
		await indicator(page).click();
		await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
	});
});

/* Chat defaults to open for the desktop column. On a phone, Chat must never be
 * the committed view before the user asks for it: a value corrected by an
 * effect after the first render can reach the screen as a flash of Chat over
 * the work. Every value `data-view` ever holds is recorded from the moment the
 * workspace is inserted, so a transient one is caught however briefly it
 * lived. */
async function recordViews(page: Page): Promise<void> {
	await page.addInitScript(`{
		window.__views = [];
		new MutationObserver((records) => {
			for (const r of records) {
				if (r.type === "attributes" && r.attributeName === "data-view") window.__views.push(r.oldValue);
				for (const n of r.addedNodes ?? []) {
					if (!(n instanceof Element)) continue;
					const el = n.matches(".cv-phonews") ? n : n.querySelector(".cv-phonews");
					if (el) window.__views.push("inserted:" + el.getAttribute("data-view"));
				}
			}
		}).observe(document, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["data-view"] });
	}`);
}
const viewsSeen = (page: Page) =>
	page.evaluate(() => (window as unknown as { __views: (string | null)[] }).__views);

test.describe("first paint", () => {
	test("the video editor never commits Chat before it is asked for", async ({ page }) => {
		await recordViews(page);
		await openVideo(page);
		await expect(tab(page, "Editor")).toHaveAttribute("aria-selected", "true");
		expect((await viewsSeen(page)).filter((v) => v?.includes("chat"))).toEqual([]);
	});
});

test.describe("a settled run", () => {
	test("Show changes switches to Editor, selects the change, and Chat is one tap back", async ({
		page,
	}) => {
		const server = await openVideo(page);
		server.nextJobIds.push("agent-u1");
		server.jobs.set("agent-u1", job("running", []));
		await tab(page, "Chat").click();
		await send(page, "hold scene two longer");
		await expect(page.locator(".cv-phonews-chat .fc-run[data-phase='running']")).toBeVisible();
		server.jobs.set(
			"agent-u1",
			job("done", [{ kind: "final", text: "Held scene two longer." }], {
				commands: [{ type: "clip.update", id: "scene:2", patch: { durationSec: 9 } }],
			}),
		);

		const result = page.locator(".cv-phonews-chat .fc-result").last();
		await expect(result).toContainText("Changed 1 item", { timeout: 10_000 });
		await result.getByRole("button", { name: "Show changes" }).click();

		await expect(tab(page, "Editor")).toHaveAttribute("aria-selected", "true");
		await expect(page.locator('[data-clipid="scene:2"]')).toHaveAttribute("aria-selected", "true");
		// Focus did not stay behind in the view that just became hidden.
		expect(
			await page.evaluate(() => document.activeElement?.closest(".cv-phonews-chat") == null),
		).toBe(true);
		await page.screenshot({ path: `${OUT}/show-changes.png` });

		await tab(page, "Chat").click();
		await expect(result.getByRole("button", { name: "Show changes" })).toBeVisible();
	});
});

test.describe("accessibility", () => {
	test("the switch is a keyboard tablist, and focus returns to where the user was", async ({
		page,
	}) => {
		await openVideo(page);
		const editorTab = tab(page, "Editor");
		await editorTab.focus();
		await page.keyboard.press("ArrowRight");
		await expect(tab(page, "Chat")).toBeFocused();
		await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
		await expect(page.locator("#cv-phonews-chat")).toHaveAttribute(
			"aria-labelledby",
			"cv-phonews-tab-chat",
		);
		await expect(page.locator("#cv-phonews-editor")).toBeHidden();

		await composer(page).focus();
		// The chat's own close leaves focus in a view becoming hidden; it must land in Editor.
		await page.locator(".cv-phonews-chat").getByTitle("Hide panel").click();
		await expect(editorTab).toHaveAttribute("aria-selected", "true");
		expect(
			await page.evaluate(() => document.activeElement?.closest("#cv-phonews-editor") != null),
		).toBe(true);

		// Back to Chat by keyboard, and the composer is where focus was last.
		await editorTab.focus();
		await page.keyboard.press("End");
		await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("Home");
		await expect(editorTab).toHaveAttribute("aria-selected", "true");
	});

	test("reduced motion: the run indicator's spinner does not spin", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		const server = await openVideo(page);
		server.nextJobIds.push("agent-m1");
		server.jobs.set("agent-m1", job("running", []));
		await tab(page, "Chat").click();
		await send(page, "tighten the hook");
		await tab(page, "Editor").click();
		const spin = page.locator(".cv-phonews-run .cv-spin");
		await expect(spin).toBeVisible();
		expect(await spin.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
	});

	test("reduced motion: the switch has no transition", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await openVideo(page);
		for (const sel of ["#cv-phonews-editor", "#cv-phonews-chat"]) {
			expect(
				await page.locator(sel).evaluate((el) => getComputedStyle(el).transitionDuration),
			).toBe("0s");
		}
		await tab(page, "Chat").click();
		// Settled on the very next frame: nothing is animating in between.
		await expect(page.locator(".cv-phonews-chat")).toHaveCSS("visibility", "visible");
		await expect(page.locator(".cv-phonews-editor")).toHaveCSS("visibility", "hidden");
	});

	test("with the keyboard up, the composer and the pinned decision stay on screen", async ({
		page,
	}) => {
		/* The emulator cannot summon a soft keyboard; it can reproduce its
		 * consequence, the viewport losing about half its height while the
		 * composer holds focus. `interactive-widget=resizes-content` is what makes
		 * a real Android keyboard do the same to the layout. */
		const server = await openVideo(page);
		server.nextJobIds.push("agent-k1");
		server.jobs.set(
			"agent-k1",
			job("awaiting_input", [
				{
					kind: "question",
					question: "What should change in the plan?",
					options: [{ label: "Approve", value: "approve" }],
					actionId: "act-k",
					freeText: true,
				},
			]),
		);
		await tab(page, "Chat").click();
		await send(page, "plan a tides explainer");
		const pinned = page.getByRole("region", { name: "Decision needed" });
		await expect(pinned).toBeVisible();
		await composer(page).focus();

		const full = page.viewportSize()!;
		const shrunk = Math.round(full.height * 0.55);
		await page.setViewportSize({ width: full.width, height: shrunk });
		await expect(composer(page)).toBeFocused();
		await page.screenshot({ path: `${OUT}/keyboard-open.png` });
		for (const [name, loc] of [
			["composer", composer(page)],
			["pinned decision", pinned.getByRole("button", { name: "Approve" })],
		] as const) {
			const box = (await loc.boundingBox())!;
			expect(box.y, `${name} is above the top of the view`).toBeGreaterThanOrEqual(0);
			expect(box.y + box.height, `${name} is behind the keyboard`).toBeLessThanOrEqual(shrunk + 1);
		}
		expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
		await page.setViewportSize(full);
	});
});

test.describe("baselines", () => {
	test("Editor and Chat views", async ({ page }) => {
		await openVideo(page);
		await expect(page).toHaveScreenshot("phone-workspace-editor.png");
		await tab(page, "Chat").click();
		await expect(composer(page)).toBeVisible();
		await expect(page).toHaveScreenshot("phone-workspace-chat.png");
	});
});
