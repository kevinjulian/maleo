/* Enter in a composer: submit, new line, or an input method's confirm.
 *
 * Audit M14. A real input-method composition is started through the browser's
 * own IME interface, so the Enter that confirms it is the event the app would
 * see from someone typing Japanese, Chinese or Korean. It must not send; plain
 * Enter afterwards must; Shift+Enter must add a line.
 */
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

const CHAT_HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");

const COMPOSERS = [
	{
		name: "image",
		path: "/imagelab",
		har: HAR,
		field: "Image prompt",
		submits: /\/api\/image-gen\/generate/,
	},
	{
		name: "speech",
		path: "/speech/lab",
		har: HAR,
		field: "Text to synthesize",
		submits: /\/api\/tts\/generate/,
	},
	{
		name: "chat",
		path: `/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`,
		har: CHAT_HAR,
		field: "Instruction",
		submits: new RegExp(`/api/operations/projects/${EDITOR_CHAT_FIXTURE_PROJECT_ID}/chat(\\?|$)`),
	},
] as const;

/** Count POSTs to `pattern`, answering each so nothing reaches a real service. */
async function countSubmits(page: Page, pattern: RegExp): Promise<() => number> {
	let count = 0;
	await page.route(pattern, async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		count += 1;
		await route.fulfill({ status: 503, json: { error: "fixture: not generating" } });
	});
	return () => count;
}

for (const composer of COMPOSERS) {
	test(`${composer.name} composer: a composing Enter does not send, Shift+Enter adds a line, Enter sends`, async ({
		page,
		context,
	}) => {
		await replayApi(context, composer.har);
		const submits = await countSubmits(page, composer.submits);
		// The speech composer sends only with a ready provider; the fixture has none.
		await page.route("**/api/tts/status", (route) =>
			route.fulfill({
				json: {
					providers: [
						{
							id: "fixture-tts",
							label: "Fixture TTS",
							health: "ready",
							voices: [{ id: "fixture-voice", name: "Fixture Voice" }],
						},
					],
					effective_provider: "fixture-tts",
					ready: true,
					voices: [{ id: "fixture-voice", name: "Fixture Voice" }],
				},
			}),
		);
		await page.goto(composer.path);
		const field = page.getByRole("textbox", { name: composer.field });
		await expect(field).toBeEnabled();
		await field.click();

		// A real composition, through the browser's IME interface.
		const ime = await context.newCDPSession(page);
		await ime.send("Input.imeSetComposition", {
			text: "にほんご",
			selectionStart: 4,
			selectionEnd: 4,
		});
		await page.keyboard.press("Enter");
		await page.waitForTimeout(300);
		expect(submits(), "the confirming Enter did not send").toBe(0);

		// Commit the composition, then a new line, then send.
		await ime.send("Input.insertText", { text: "日本語" });
		await page.keyboard.press("Shift+Enter");
		await page.waitForTimeout(200);
		expect(submits(), "Shift+Enter did not send").toBe(0);
		await expect(field).toHaveValue(/日本語\n/);

		await page.keyboard.type("done");
		await page.keyboard.press("Enter");
		await expect.poll(submits, { message: "plain Enter sends" }).toBe(1);
	});
}
