/* Browser export in the running editor (OpenSpec p2-export task 2.4).
 *
 * The fixture project (`fixtures/api.har`) is 3 s: a plain text clip from 1 s to
 * 3 s and a fade effect, no media. The asset manifest is answered here; the
 * HAR replay already accepts storyboard saves. Chromium runs with WebGPU. */
import {
	expect,
	test,
	type Browser,
	type BrowserContext,
	type Page,
	type PlaywrightWorkerArgs,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = join(import.meta.dirname, "fixtures/api.har");
const MANIFEST = `**/api/operations/projects/${FIXTURE_PROJECT_ID}/asset-manifest*`;
const EMPTY_MANIFEST = { projectId: FIXTURE_PROJECT_ID, storyboardVersion: 1, assets: [] };

async function openEditor(
	playwright: PlaywrightWorkerArgs["playwright"],
	width: number,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
	const browser = await playwright.chromium.launch({
		args: [
			"--enable-unsafe-webgpu",
			...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
		],
	});
	const context = await browser.newContext({
		baseURL: "http://127.0.0.1:3031",
		viewport: { width, height: 900 },
		acceptDownloads: true,
	});
	await replayApi(context, HAR);
	const page = await context.newPage();
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await expect(page.locator(".tl2-timeline")).toBeVisible({ timeout: 60_000 });
	return { browser, context, page };
}

async function openMenu(page: Page): Promise<void> {
	await page.getByTitle("Export video").click();
	await expect(page.locator("[data-export-coverage]")).toHaveText(
		"Rust renderer covers every frame.",
		{ timeout: 30_000 },
	);
}

/** Frame count, duration and size of a saved MP4, from ffprobe. */
interface ProbedFile {
	frames: number;
	duration: number;
	width: number;
	height: number;
}

function probe(path: string): ProbedFile {
	const out = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=nb_read_frames,width,height:format=duration",
				"-of",
				"json",
				path,
			],
			{ encoding: "utf8" },
		),
	) as {
		streams: { nb_read_frames: string; width: number; height: number }[];
		format: { duration: string };
	};
	const stream = out.streams[0]!;
	return {
		frames: Number(stream.nb_read_frames),
		duration: Number(out.format.duration),
		width: stream.width,
		height: stream.height,
	};
}

for (const width of [1440, 320]) {
	test(`exports the fixture project in the browser at ${width}px`, async ({ playwright }, info) => {
		test.setTimeout(120_000);
		const { browser, context, page } = await openEditor(playwright, width);
		try {
			await context.route(MANIFEST, (route) => route.fulfill({ json: EMPTY_MANIFEST }));
			const renderRequests: string[] = [];
			page.on("request", (request) => {
				if (/\/render(\?|$)/.test(request.url())) renderRequests.push(request.url());
			});
			await openMenu(page);
			const saved = page.waitForEvent("download", { timeout: 60_000 });
			await page.getByRole("menuitem", { name: /Browser export/ }).click();
			const download = await saved;
			const path = info.outputPath(download.suggestedFilename());
			await download.saveAs(path);
			const file = probe(path);
			expect(file.frames).toBe(90);
			expect(file.duration).toBeGreaterThanOrEqual(3);
			expect(file.duration).toBeLessThan(3 + 1024 / 48_000 + 1 / 30);
			expect(renderRequests, "no server render job").toEqual([]);
			await page.getByTitle("Export video").click();
			await page.getByRole("menuitem", { name: "View last export" }).click();
			await expect(page.getByRole("dialog")).toContainText("saved to this device");
		} finally {
			await browser.close();
		}
	});
}

test("cancel stops a browser export and saves nothing", async ({ playwright }) => {
	test.setTimeout(120_000);
	const { browser, context, page } = await openEditor(playwright, 1440);
	try {
		await context.route(MANIFEST, (route) => route.fulfill({ json: EMPTY_MANIFEST }));
		// Hold the worker script so the export is still loading when Cancel is pressed.
		await context.route("**/renderer/export-worker.js", async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 3_000));
			await route.continue();
		});
		let downloads = 0;
		page.on("download", () => downloads++);
		const workers: string[] = [];
		page.on("worker", (worker) => workers.push(worker.url()));
		await openMenu(page);
		await page.getByRole("menuitem", { name: /Browser export/ }).click();
		await page.getByTitle("Export in progress — click for status").click();
		await page.getByRole("button", { name: "Cancel export" }).click();
		await expect(page.getByRole("dialog")).toContainText("cancelled", { timeout: 15_000 });
		await expect(page.getByRole("button", { name: "Cancel export" })).toHaveCount(0);
		await page.waitForTimeout(4_000);
		expect(downloads).toBe(0);
		// The export button is idle again: it opens the menu, not the status.
		await page.keyboard.press("Escape");
		await expect(page.getByTitle("Export video")).toBeVisible();
	} finally {
		await browser.close();
	}
});

test("an edit during export stays in the document and out of the file", async ({
	playwright,
}, info) => {
	test.setTimeout(120_000);
	const { browser, context, page } = await openEditor(playwright, 1440);
	try {
		// The manifest is read right after the storyboard is captured; hold it while editing.
		let captured!: () => void;
		const capture = new Promise<void>((resolve) => (captured = resolve));
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		await context.route(MANIFEST, async (route) => {
			captured();
			await held;
			await route.fulfill({ json: EMPTY_MANIFEST });
		});
		const clip = page
			.locator("[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']")
			.first();
		const left = (): Promise<number> =>
			clip.evaluate((element) => Number.parseFloat((element as HTMLElement).style.left));
		const before = await left();
		await openMenu(page);
		const saved = page.waitForEvent("download", { timeout: 60_000 });
		await page.getByRole("menuitem", { name: /Browser export/ }).click();
		await capture;
		// Move the text clip later: the timeline grows past 3 s.
		const box = (await clip.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		await expect.poll(left).toBeGreaterThan(before + 20);
		release();
		const download = await saved;
		const path = info.outputPath("edited.mp4");
		await download.saveAs(path);
		expect(probe(path).frames, "the captured 3 s storyboard").toBe(90);
		expect(await left(), "the edit is kept").toBeGreaterThan(before + 20);
	} finally {
		await browser.close();
	}
});

test("a file the browser cannot read refuses browser export and offers server export", async ({
	playwright,
}) => {
	test.setTimeout(120_000);
	const { browser, context, page } = await openEditor(playwright, 1440);
	try {
		await context.route(MANIFEST, (route) =>
			route.fulfill({
				json: {
					...EMPTY_MANIFEST,
					assets: [
						{
							id: "0190c0de-0000-7000-8000-0000000000aa",
							url: "/api/media/0190c0de-0000-7000-8000-0000000000aa",
							origin: "import",
							state: "ready",
							size: 10,
							sha256: "a".repeat(64),
							label: "interview.mp4",
							used: true,
						},
					],
				},
			}),
		);
		let downloads = 0;
		page.on("download", () => downloads++);
		await openMenu(page);
		await page.getByRole("menuitem", { name: /Browser export/ }).click();
		await expect(
			page.getByText(/interview\.mp4 could not be downloaded in this browser/).first(),
		).toBeVisible({
			timeout: 30_000,
		});
		// The menu opens again with Server render available.
		await expect(page.getByRole("menuitem", { name: /Server render/ })).toBeEnabled();
		expect(downloads).toBe(0);
	} finally {
		await browser.close();
	}
});
