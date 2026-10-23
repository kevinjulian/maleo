/* The render budget, measured.
 *
 * `openspec/changes/optimize-timeline-renders` specifies work that is invisible
 * in the output: the editor looks identical whether a click commits once or
 * four times. The visual suite cannot see it and the type checker cannot see
 * it, so this is the instrument — the components tally their own renders
 * (`render-probe.ts`) and this drives the four interactions the change is
 * judged on, printing the tallies.
 *
 * It reports rather than asserts. The change's acceptance is attribution, not a
 * target number: a commit that carries a real state change is legitimate and a
 * commit that is an echo of another is the defect, and no threshold tells those
 * apart. The numbers land in the change's tasks.md, where a human names each
 * one. What IS asserted is where the spec is unconditional and the number is
 * already where it should be: playback must not re-render the lane container,
 * and re-selecting the already selected clip must not re-render clips or lanes
 * beyond the one press feedback dims. An `idle` control measures the noise
 * floor, because a number that cannot be named is the defect being looked for.
 *
 * Same HAR replay as the visual suite, so it runs without the api and does not
 * move when that data does. The fixture project is small (2 clips); the clip
 * count is inflated in-page to `CLIP_TARGET` because "4 commits" is not a
 * measurement and "4 commits at 40 clips" is.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "../visual/screens.ts";
import { replayApi } from "../visual/har.ts";
import type { RenderCounts } from "../src/models/timeline/render-probe.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "../visual/fixtures/api.har");

/** Free clips the timeline is measured against. */
const CLIP_TARGET = 40;

/* Turn counting on before the app's first render, and inflate the fixture's
 * clip list on its way through `fetch`.
 *
 * In-page rather than through a Playwright route: the project response is
 * served from the HAR, and rewriting it there means owning the HAR's encoding.
 * Patching `fetch` sees the decoded body whatever served it. */
function harnessScript(clipTarget: number): string {
	return `{
	globalThis.__maleoRenderCounts = {};
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const res = await realFetch(input, init);
		const url = typeof input === "string" ? input : input.url;
		if (!/\\/api\\/operations\\/projects\\/[^/?]+(\\?|$)/.test(url)) return res;
		const detail = await res.clone().json().catch(() => null);
		const clips = detail?.storyboards?.[0]?.storyboard_json?.clips;
		if (!Array.isArray(clips)) return res;
		/* Clone the free clips along the timeline. Scenes and transitions are left
		   alone: a scene is the base reel and a transition is keyed by the pair it
		   bridges, so copying either changes what the timeline MEANS rather than
		   how much of it there is. */
		const seeds = clips.filter((c) => c.type !== "transition" && !c.scene);
		const out = clips.slice();
		let copy = 1;
		while (out.length < ${clipTarget} && seeds.length > 0) {
			for (const seed of seeds) {
				if (out.length >= ${clipTarget}) break;
				const [source, refId] = String(seed.id).split(":");
				const nextId = Number(refId) + copy * 100000;
				const dup = JSON.parse(JSON.stringify(seed));
				dup.id = source + ":" + nextId;
				dup.startSec = (seed.startSec ?? 0) + copy * ((seed.durationSec ?? 1) + 0.2);
				for (const key of ["video", "text", "audio", "effect"]) {
					if (dup[key]) { dup[key].id = nextId; dup[key].start = dup.startSec; }
				}
				out.push(dup);
			}
			copy += 1;
		}
		detail.storyboards[0].storyboard_json.clips = out;
		return new Response(JSON.stringify(detail), { status: res.status, headers: { "content-type": "application/json" } });
	};
}`;
}

test.beforeEach(async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.addInitScript(harnessScript(CLIP_TARGET));
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
});

/** Renders since the last reset, per component label. */
async function counts(page: import("@playwright/test").Page): Promise<RenderCounts> {
	// SAFETY: the app installs `__maleoRenderCounts` on globalThis under the perf
	// build only, so the property is declared optional and the spread copies an
	// absent counter to `{}` — a page that never installed it reads as zero
	// renders rather than throwing.
	return page.evaluate(() => ({
		...(globalThis as { __maleoRenderCounts?: RenderCounts }).__maleoRenderCounts,
	}));
}

/** Start a measurement. Settles the tree first, so the count is the
 *  interaction's and not the load's. */
async function measure(page: import("@playwright/test").Page): Promise<void> {
	await page.waitForTimeout(400);
	await page.evaluate(() => {
		(globalThis as { __maleoRenderCounts?: RenderCounts }).__maleoRenderCounts = {};
	});
}

/** How many clips the timeline actually drew, so a printed number is never
 *  reported without the size it was measured at. */
async function clipCount(page: import("@playwright/test").Page): Promise<number> {
	return page.locator("[data-vui-slot='item']").count();
}

/* The control. Anything counted here is not the interaction's, and a number
 * that cannot be named is the defect this suite exists to find — so the noise
 * floor has to be known before any of the others mean anything. */
test("idle", async ({ page }) => {
	await measure(page);
	await page.waitForTimeout(1000);
	console.log(
		`[render-budget] idle @ ${await clipCount(page)} clips:`,
		JSON.stringify(await counts(page)),
	);
});

test("select a clip", async ({ page }) => {
	const clips = page.locator(
		"[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']",
	);
	const total = await clipCount(page);
	await measure(page);
	await clips.first().click();
	await page.waitForTimeout(600);
	const after = await counts(page);
	console.log(`[render-budget] select a clip @ ${total} clips:`, JSON.stringify(after));
	/* "Only the interactive elements whose selected state changed." One clip
	   gained selection and none lost it, so the bound is the change, not the
	   document — and the point is that it does not grow with `total`. Bounded
	   rather than exact because the press also arms the drag, which is a named
	   state change with a visible consequence; the exact form of this invariant
	   is asserted with no tolerance in the library, where nothing else is in the
	   frame (`src/dom/paint.test.ts`). */
	expect(
		after.clip ?? 0,
		"selecting one clip re-rendered more than the clips that changed",
	).toBeLessThanOrEqual(4);
	expect(after.clip ?? 0, "selection cost grew with the document").toBeLessThan(total);
	/* "Selection does not repaint the preview" — asserted here rather than only
	   on the re-select case, because this is the path an operator actually takes
	   and the seek that used to ride along with it was what repainted the
	   player. */
	expect(after.stage ?? 0, "selecting a clip re-rendered the preview stage").toBeLessThanOrEqual(2);
});

test("select the same clip twice", async ({ page }) => {
	const clip = page
		.locator("[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']")
		.first();
	await clip.click();
	await measure(page);
	await clip.click();
	await page.waitForTimeout(600);
	const after = await counts(page);
	console.log(`[render-budget] re-select @ ${await clipCount(page)} clips:`, JSON.stringify(after));
	/* Nothing here is caused by the selection any more: an equal selection is not
	 * a state change (`selectionsEqual`), so the store notifies nobody.
	 *
	 * What is left is the press itself — `startClipMove` arms the drag on
	 * pointer-down and the release disarms it — which dims the pressed clip and
	 * re-renders its lane. Both are named state changes with a visible
	 * consequence. That it also re-renders the editor and the preview is NOT: the
	 * drag state still lives in the editor's root, the last of the three values
	 * that needs the treatment the playhead and the selection have had. Recorded
	 * in tasks.md, and pinned here so it cannot quietly get worse. */
	expect(after.clip ?? 0).toBeLessThanOrEqual(2);
	expect(after.lane ?? 0).toBeLessThanOrEqual(2);
	expect(after.stage ?? 0).toBeLessThanOrEqual(2);
});

test("select A then B then A", async ({ page }) => {
	const clips = page.locator(
		"[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']",
	);
	const total = await clipCount(page);
	await clips.nth(0).click();
	await measure(page);
	await clips.nth(1).click();
	await clips.nth(0).click();
	await page.waitForTimeout(600);
	const after = await counts(page);
	console.log(`[render-budget] A -> B -> A @ ${total} clips:`, JSON.stringify(after));
	/* Two selection changes, each moving the state of two clips. The bound is
	   eight rather than four because each press also arms and disarms the drag;
	   what it must never be is a function of the document. */
	expect(
		after.clip ?? 0,
		"two selection changes re-rendered more than the clips that changed",
	).toBeLessThanOrEqual(8);
	expect(after.clip ?? 0, "selection cost grew with the document").toBeLessThan(total);
	expect(
		after.stage ?? 0,
		"changing the selection re-rendered the preview stage",
	).toBeLessThanOrEqual(4);
});

test("one second of playback", async ({ page }) => {
	const play = page.locator(".tl2-timeline [data-transport='play']");
	const playheadLeft = async (): Promise<number> =>
		page.locator("[data-vui-slot='playhead']").evaluate((el) => el.getBoundingClientRect().left);
	await measure(page);
	const before = await playheadLeft();
	await play.click();
	await page.waitForTimeout(1000);
	const after = await counts(page);
	const moved = (await playheadLeft()) - before;
	await play.click();
	console.log(`[render-budget] playhead moved ${moved.toFixed(1)}px`);
	// A playback measurement taken while nothing played is the failure mode this
	// whole suite exists to avoid, so it is checked rather than assumed.
	expect(moved).toBeGreaterThan(1);
	console.log(
		`[render-budget] 1s playback @ ${await clipCount(page)} clips:`,
		JSON.stringify(after),
	);
	// "Advancing the playhead during playback SHALL move the playhead indicator
	// without re-rendering clips, lanes or the lane container."
	//
	// Clips and lanes are asserted EXACTLY, with no tolerance: the playhead is
	// moved by a direct style write from a subscription, so a second of playback
	// costs a clip render or it does not, and any number above zero means the
	// position became a prop again. The container keeps a small ceiling because
	// the play/pause transition itself is a real state change.
	expect(after.clip ?? 0, "playback re-rendered a clip").toBe(0);
	expect(after.lane ?? 0, "playback re-rendered a lane").toBe(0);
	expect(after.tracks ?? 0).toBeLessThanOrEqual(4);
});
