/* The Rust engine as the editor's executor (`migrate-editor-to-shared-rust-core`,
 * tasks 4.4 and 4.5).
 *
 * The engine is not part of the page's bundle: it arrives as its own
 * `/editor-engine.wasm` request, once, and the editor mounts after it. Without
 * it the editor says it could not start and offers a retry, rather than
 * opening with nothing to edit through. */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test("the editor fetches the engine once, as its own file, and edits through it", async ({
	page,
	context,
}) => {
	await replayApi(context, HAR);
	const wasm: string[] = [];
	page.on("response", (response) => {
		if (new URL(response.url()).pathname === "/editor-engine.wasm")
			wasm.push(response.headers()["content-type"] ?? "");
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	expect(wasm).toEqual(["application/wasm"]);

	const clip = page
		.locator("[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']")
		.first();
	await clip.click();
	const left = (): Promise<number> =>
		clip.evaluate((element) => Number.parseFloat((element as HTMLElement).style.left));
	const before = await left();
	const box = (await clip.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
	await page.mouse.up();
	await expect.poll(left).toBeGreaterThan(before + 20);
	const moved = await left();

	await page.getByTitle("Undo (⌘Z)").click();
	await expect.poll(left).toBeCloseTo(before, 0);
	await page.getByTitle(/^Redo/).click();
	await expect.poll(left).toBeCloseTo(moved, 0);
	expect(wasm, "no second fetch").toHaveLength(1);
});

test("without the engine the editor says it could not start and retries", async ({
	page,
	context,
}) => {
	await replayApi(context, HAR);
	let refuse = true;
	await page.route("**/editor-engine.wasm", (route) =>
		refuse ? route.fulfill({ status: 503 }) : route.continue(),
	);
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await expect(page.getByRole("alert")).toContainText("The editor could not start.");
	await expect(page.locator(".tl2-timeline")).toHaveCount(0);
	refuse = false;
	await page.getByRole("button", { name: "Retry" }).click();
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
});
