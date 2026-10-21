import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/* The editor workspace's structural stylesheet: @maleo/vui/styles.css until
 * migrate-editor-to-shared-rust-core task 3.5 moved it into the web app. */
const VUI_CSS = fileURLToPath(
	new URL("../src/components/editor-workspace/editor-workspace.css", import.meta.url),
);
const PROPERTIES = [
	"color",
	"font-family",
	"font-size",
	"margin",
	"padding",
	"border",
	"position",
	"display",
] as const;

test("VUI stylesheet leaves unrelated controls unchanged", async ({ page }) => {
	await page.setContent(`
		<button id="outside-button">Outside</button>
		<input id="outside-input" value="Outside" />
		<div data-vui-root><button>Inside VUI</button></div>
	`);
	const readStyles = async () =>
		page.evaluate((properties) => {
			const snapshot = (selector: string) => {
				const style = getComputedStyle(document.querySelector(selector)!);
				return Object.fromEntries(
					properties.map((property) => [property, style.getPropertyValue(property)]),
				);
			};
			return { button: snapshot("#outside-button"), input: snapshot("#outside-input") };
		}, PROPERTIES);
	const before = await readStyles();
	const css = await readFile(VUI_CSS, "utf8");
	await page.evaluate((stylesheet) => {
		const style = document.createElement("style");
		style.textContent = stylesheet;
		document.head.appendChild(style);
	}, css);
	await expect.poll(readStyles).toEqual(before);
});

/* "The package's default workspace styling" (a screenshot of this stylesheet on
 * a bare page, as an outside consumer of @maleo/vui would see it) retired with
 * migrate-editor-to-shared-rust-core task 3.5. The sheet is the app's now and
 * its colours resolve to the app's tokens, which a bare page does not have; the
 * workspace as the app renders it is covered by the editor and studio baselines. */
