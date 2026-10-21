/* The scene drawer's keyframe motion editor.
 *
 * Pressing Customize motion used to crash the editor: a hook sat below the
 * empty-state early return, so the first render with motion ran one hook more
 * than the render before it. This opens it and edits a keyframe. */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test("customize motion opens the keyframe editor and edits a keyframe", async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await replayApi(context, resolve(HERE, "fixtures/api-editor-chat.har"));
	await page.setViewportSize({ width: 1440, height: 1400 });
	await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
	await page.locator("[data-vui-slot='item']").first().click();
	const frames = page.locator(".tl2-clippanel [data-vui-slot='accordion-header']", {
		hasText: "Frames",
	});
	if ((await frames.getAttribute("aria-expanded")) === "false") await frames.click();
	await page.getByRole("button", { name: /Open frames/ }).click();

	await page.getByRole("button", { name: "Customize motion" }).click();
	const keyframe = page.locator(".tl2-motion-insp");
	await expect(keyframe).toBeVisible();
	await expect(keyframe.getByRole("group", { name: "Position", exact: true })).toBeVisible();
	const x = keyframe.getByRole("spinbutton", { name: "X", exact: true });
	await x.fill("25");
	await expect(x).toHaveValue("25");
	await expect(keyframe.getByRole("combobox", { name: "Easing" })).toBeDisabled();
	expect(errors).toEqual([]);
});
