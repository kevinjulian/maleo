/* Whole-project coverage for Rust export (OpenSpec p2-export task 1.2).
 *
 * The renderer module's GPU-free `project_coverage` runs in a real browser and
 * must give the native answer: empty for every golden corpus case
 * (`crates/renderer/tests/golden` asserts the same natively) and the exact
 * native entry for a storyboard with one short unsupported element
 * (`coverage::tests::project_coverage_finds_a_short_problem_between_whole_seconds_once`).
 * The editor loads that module when the export menu opens, never on a normal load. */
import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const CORPUS = resolve(import.meta.dirname, "../../../crates/renderer/corpus");

function corpusCases(): { name: string; storyboard: string; frames: number }[] {
	return readdirSync(CORPUS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(CORPUS, entry.name, "case.json")))
		.map((entry) => {
			const spec = JSON.parse(readFileSync(join(CORPUS, entry.name, "case.json"), "utf8")) as {
				frames: number[];
			};
			return {
				name: entry.name,
				storyboard: readFileSync(join(CORPUS, entry.name, "storyboard.json"), "utf8"),
				frames: Math.max(0, ...spec.frames) + 1,
			};
		});
}

test("project coverage in the browser matches native Rust", async ({ page }) => {
	test.setTimeout(120_000);
	const cases = corpusCases();
	expect(cases.length).toBeGreaterThan(100);
	await page.goto("/");
	const results = await page.evaluate(async (cases) => {
		const url = "/renderer/maleo_renderer_wasm.js";
		const native = await import(/* @vite-ignore */ url);
		await native.default();
		const corpus = cases.map((c) => ({
			name: c.name,
			entries: JSON.parse(native.project_coverage(c.storyboard, 30, c.frames)),
		}));
		const short = JSON.parse(
			native.project_coverage(
				JSON.stringify({
					scenes: [{ image: "a.png", durationSec: 3, transition: "cut" }],
					textOverlays: [{ content: "t", preset: "lower-third", startSec: 1.5, durationSec: 0.1 }],
				}),
				30,
				90,
			),
		);
		let refused = "";
		try {
			native.project_coverage("{}", 30, 0);
		} catch (error) {
			refused = String(error);
		}
		return { corpus, short, refused };
	}, cases);
	expect(results.corpus.filter((c) => c.entries.length > 0)).toEqual([]);
	expect(results.short).toEqual([
		{ kind: "text", path: "textOverlays[0]", reason: "`lower-third` preset", frame: 45, time: 1.5 },
	]);
	expect(results.refused).toContain("Invalid coverage storyboard duration");
});

test("the editor loads the renderer module only when the export menu opens", async ({
	page,
	context,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => requests.push(new URL(request.url()).pathname));
	await replayApi(context, join(import.meta.dirname, "fixtures/api.har"));
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await expect(page.locator(".tl2-timeline")).toBeVisible({ timeout: 60_000 });
	expect(requests.filter((path) => path.startsWith("/renderer/"))).toEqual([]);

	await page.getByTitle("Export video").click();
	const line = page.locator("[data-export-coverage]");
	await expect(line).toHaveText(
		/Rust renderer (covers every frame|does not cover: .+ at \d+\.\d\d s)/,
		{
			timeout: 30_000,
		},
	);
	expect(requests).toContain("/renderer/maleo_renderer_wasm.js");
	expect(requests.filter((path) => path === "/renderer/preview-worker.js")).toEqual([]);
});
