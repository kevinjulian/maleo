/* A multi-selection on the preview canvas (`p2-preview-editing` task 4.3): a
 * shift-click adds an element, the engine draws one group box around both, and
 * moving, resizing and rotating the group each commit one undo step. */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");

/* A second text clip beside the fixture's, live over the same seconds. */
const SECOND_TEXT = {
	id: "text:2",
	type: "text",
	startSec: 4,
	durationSec: 4,
	track: 2,
	text: {
		id: 2,
		content: "Second",
		start: 4,
		dur: 4,
		track: 2,
		preset: "title",
		layout: { xPct: 50, yPct: 60, widthPct: 30, heightPct: 20, fit: "contain" },
	},
};

const center = async (locator: Locator) => {
	const r = (await locator.boundingBox())!;
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
	await page.keyboard.down("Alt");
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
	await page.mouse.up();
	await page.keyboard.up("Alt");
}

test("a shift-click group moves, resizes and rotates in one undo step each", async ({
	page,
	context,
}) => {
	await replayApi(context, HAR);
	await context.route(
		new RegExp(`/api/operations/projects/${EDITOR_CHAT_FIXTURE_PROJECT_ID}(\\?|$)`),
		(route) =>
			route.fulfill({
				json: {
					...editorChatProjectDetail,
					storyboards: editorChatProjectDetail.storyboards.map((storyboard) => ({
						...storyboard,
						storyboard_json: {
							...storyboard.storyboard_json,
							clips: [...storyboard.storyboard_json.clips, SECOND_TEXT],
						},
					})),
				},
			}),
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await page.locator('[data-clipid="text:1"]').click();
	await expect(
		page.getByRole("group", { name: "Selected clip transform", exact: true }),
	).toBeVisible();

	const canvas = (await page.locator(".tl2-canvas").boundingBox())!;
	await page.keyboard.down("Shift");
	await page.mouse.click(canvas.x + canvas.width * 0.65, canvas.y + canvas.height * 0.7);
	await page.keyboard.up("Shift");
	const group = page.getByRole("group", { name: "selection transform", exact: true });
	await expect(group).toBeVisible();
	const members = page.locator(".tl2-clipbox.member");
	await expect(members).toHaveCount(2);
	// The Player's frame is not what this baseline pins; the boxes over it are.
	const hidden = await page.addStyleTag({
		content: ".tl2-remotion-stage { visibility: hidden !important; }",
	});
	await expect(page.locator(".tl2-canvas")).toHaveScreenshot("canvas-group-1440.png");
	await hidden.evaluate((el) => el.parentNode?.removeChild(el));

	const placement = () =>
		members.evaluateAll((els) =>
			els.map((el) => [
				(el as HTMLElement).style.left,
				(el as HTMLElement).style.top,
				(el as HTMLElement).style.width,
				(el as HTMLElement).style.rotate,
			]),
		);
	const undo = page.getByRole("button", { name: "Undo", exact: true });
	const before = await placement();

	await drag(
		page,
		await center(page.getByRole("button", { name: "Move selection", exact: true })),
		canvas.width * 0.1,
		0,
	);
	await expect.poll(placement).not.toEqual(before);
	const moved = await placement();
	expect(moved.map((m) => parseFloat(m[0]!) - 0)).toEqual(
		before.map((m) => expect.closeTo(parseFloat(m[0]!) + 10, 1)),
	);
	await undo.click();
	await expect.poll(placement).toEqual(before);

	await drag(
		page,
		await center(page.getByRole("button", { name: "Resize selection se", exact: true })),
		30,
		30,
	);
	await expect.poll(placement).not.toEqual(before);
	await undo.click();
	await expect.poll(placement).toEqual(before);

	const rotate = await center(page.getByRole("button", { name: "Rotate selection", exact: true }));
	const box = (await group.boundingBox())!;
	await drag(page, rotate, box.width / 2, box.height / 2);
	await expect
		.poll(async () => (await placement()).map((m) => m[3]))
		.not.toEqual(before.map((m) => m[3]));
	await undo.click();
	await expect.poll(placement).toEqual(before);
});
