/* The main timeline's viewport furniture: the gutter column and its scroll
 * sync, time indicators that span the panel, the ruler, the playhead as a
 * slider, selected-row marking, and the snapping / ripple modes.
 *
 * Geometry is asserted from the rendered page rather than from screenshots
 * wherever the claim is a relation ("the playhead reaches the bottom", "row N
 * sits beside lane N"): a relation survives a restyle, a baseline does not. */
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { typedLanesFixture, TYPED_LANES_PROJECT_ID } from "./typed-lanes-fixture.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const SCROLLER = ".tl2-timeline [data-vui-slot='timeline-scroller']";

test.beforeEach(async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.addInitScript(`{
		const mq = globalThis.matchMedia;
		globalThis.matchMedia = (q) => q.includes("prefers-reduced-motion")
			? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
			: mq(q);
	}`);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	await page.evaluate(() => document.fonts.ready);
});

/** Make the timeline panel shorter than its lanes, so it scrolls vertically. */
async function squeezeTimeline(page: Page, heightPx: number): Promise<void> {
	await page.locator(".tl2-timeline").evaluate((el, h) => {
		(el as HTMLElement).style.setProperty("--tl2-tl-h", `${h}px`);
		(el as HTMLElement).style.height = `${h}px`;
	}, heightPx);
}

/** Top of every gutter row and of every lane, in viewport px, by row index. */
async function rowTops(page: Page): Promise<{ gutter: number[]; lanes: number[] }> {
	return await page.evaluate(() => ({
		gutter: [...document.querySelectorAll<HTMLElement>(".tl2-gutter [data-gutter-row]")].map(
			(el) => el.getBoundingClientRect().top,
		),
		lanes: [
			...document.querySelectorAll<HTMLElement>(".tl2-lanes .tl2-lane-free:not([data-lane-base])"),
		].map((el) => el.getBoundingClientRect().top),
	}));
}

function expectAligned(tops: { gutter: number[]; lanes: number[] }): void {
	expect(tops.gutter.length).toBeGreaterThan(0);
	expect(tops.gutter.length).toBe(tops.lanes.length);
	tops.gutter.forEach((top, i) =>
		expect(Math.abs(top - tops.lanes[i]!), `row ${i}`).toBeLessThanOrEqual(1),
	);
}

test("the gutter sits outside the horizontal scroll", async ({ page }) => {
	const gutter = (await page.locator(".tl2-gutter").boundingBox())!;
	const scroller = (await page.locator(SCROLLER).boundingBox())!;
	// The scroller, and so its horizontal scrollbar, begins where the gutter ends.
	expect(Math.abs(scroller.x - (gutter.x + gutter.width))).toBeLessThanOrEqual(1);
	expect(await page.locator(".tl2-gutter").evaluate((el) => getComputedStyle(el).overflowX)).toBe(
		"hidden",
	);
});

test("vertical scroll keeps gutter rows beside their lanes, from either column", async ({
	page,
}) => {
	await squeezeTimeline(page, 170);
	const scroller = page.locator(SCROLLER);
	await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

	await scroller.hover();
	await page.mouse.wheel(0, 60);
	await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await expect
		.poll(async () => {
			const t = await rowTops(page);
			return t.gutter.every((top, i) => Math.abs(top - t.lanes[i]!) <= 1);
		})
		.toBe(true);
	expectAligned(await rowTops(page));

	await scroller.evaluate((el) => {
		el.scrollTop = 0;
	});
	await page.locator(".tl2-gutter").hover();
	await page.mouse.wheel(0, 60);
	await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await expect
		.poll(async () => {
			const t = await rowTops(page);
			return t.gutter.every((top, i) => Math.abs(top - t.lanes[i]!) <= 1);
		})
		.toBe(true);

	// Bottomed out, the two still agree: the tail spacer evened the ranges.
	await scroller.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect
		.poll(async () => {
			const t = await rowTops(page);
			return t.gutter.every((top, i) => Math.abs(top - t.lanes[i]!) <= 1);
		})
		.toBe(true);
});

test("time indicators reach the bottom of the panel when the lanes do not", async ({ page }) => {
	const scroller = page.locator(SCROLLER);
	const clientBottom = await scroller.evaluate(
		(el) => el.getBoundingClientRect().top + el.clientTop + el.clientHeight,
	);
	const lastLaneBottom = await page
		.locator(".tl2-lanes .tl2-lane")
		.last()
		.evaluate((el) => el.getBoundingClientRect().bottom);
	// The fixture leaves room below the lanes, which is the case being tested.
	expect(lastLaneBottom).toBeLessThan(clientBottom - 20);

	const playheadBottom = await page
		.locator(".tl2-playhead")
		.evaluate((el) => el.getBoundingClientRect().bottom);
	expect(Math.abs(playheadBottom - clientBottom)).toBeLessThanOrEqual(1);

	await page.mouse.move((await scroller.boundingBox())!.x + 300, lastLaneBottom + 10);
	const hoverBottom = await page
		.locator(".tl2-hoverhead")
		.evaluate((el) => el.getBoundingClientRect().bottom);
	expect(Math.abs(hoverBottom - clientBottom)).toBeLessThanOrEqual(1);
});

test("pressing below the last lane seeks and clears the selection", async ({ page }) => {
	const clip = page.locator(".tl2-lane-free > .tl2-clip[data-clipid]").first();
	await clip.click();
	await expect(clip).toHaveClass(/\bon\b/);
	const fill = (await page.locator(".tl2-lanes-fill").boundingBox())!;
	expect(fill.height).toBeGreaterThan(10);
	const before = await page
		.locator(".tl2-playhead")
		.evaluate((el) => el.getBoundingClientRect().left);
	/* Before the selected clip: a seek inside its span keeps the selection by
	 * design, and a press past the project's end clamps to the end, which the
	 * fixture's last clip covers. */
	const span = (await clip.boundingBox())!;
	expect(span.x - fill.x).toBeGreaterThan(8);
	const x = fill.x + (span.x - fill.x) / 2;
	await page.mouse.click(x, fill.y + fill.height / 2);
	await expect
		.poll(() => page.locator(".tl2-playhead").evaluate((el) => el.getBoundingClientRect().left))
		.not.toBe(before);
	await expect(page.locator(".tl2-lane-free > .tl2-clip.on")).toHaveCount(0);
});

async function setZoom(page: Page, key: "Home" | "End" | null, percent?: number): Promise<void> {
	const slider = page.getByRole("slider", { name: "Timeline zoom", exact: true });
	if (key) {
		await slider.focus();
		await page.keyboard.press(key);
		return;
	}
	await slider.evaluate((el, value) => {
		const input = el as HTMLInputElement;
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
			input,
			String(value),
		);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	}, percent);
}

for (const [name, key, percent] of [
	["low", "Home", undefined],
	["mid", null, 50],
	["max", "End", undefined],
] as const) {
	test(`ruler marks at ${name} zoom`, async ({ page }) => {
		await setZoom(page, key, percent);
		const ruler = page.locator(".tl2-timeline [data-vui-slot='ruler']");
		await expect(ruler.locator(".tl2-tick em").first()).toHaveText("0:00");
		const labels = await ruler.locator(".tl2-tick em").allTextContents();
		expect(
			labels.every((label) => /^\d+:\d\d$|^\d+f$/.test(label)),
			labels.join(" "),
		).toBe(true);
		// A labelled time is text alone: no line under it.
		expect(
			await ruler
				.locator(".tl2-tick.major")
				.first()
				.evaluate((el) => getComputedStyle(el, "::after").content),
		).toBe("none");
		if (name === "max")
			expect(
				labels.some((label) => label.endsWith("f")),
				labels.join(" "),
			).toBe(true);
		await expect(ruler).toHaveScreenshot(`timeline-ruler-${name}.png`);
	});
}

const PLAYHEAD = ".tl2-timeline [data-vui-slot='playhead']";

test("the playhead is a slider that steps one frame per arrow key", async ({ page }) => {
	const playhead = page.getByRole("slider", { name: "Playhead", exact: true });
	await expect(playhead).toHaveAttribute("aria-valuemin", "0");
	expect(Number(await playhead.getAttribute("aria-valuemax"))).toBeGreaterThan(0);
	await playhead.focus();
	await page.keyboard.press("ArrowRight");
	await expect(playhead).toHaveAttribute("aria-valuenow", String(Math.round(100 / 30) / 100));
	await expect(playhead).toHaveAttribute("aria-valuetext", "0:00 frame 1");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowLeft");
	await expect(playhead).toHaveAttribute("aria-valuetext", "0:00 frame 1");
	// Clamped at the start.
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await expect(playhead).toHaveAttribute("aria-valuenow", "0");
});

test("with a clip selected, the focused playhead moves and the clip does not", async ({ page }) => {
	const clip = page.locator(".tl2-lane-free > .tl2-clip[data-clipid]").first();
	await clip.click();
	await expect(clip).toHaveClass(/\bon\b/);
	const left = await clip.evaluate((el) => (el as HTMLElement).style.left);
	await page.locator(PLAYHEAD).focus();
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	await expect(page.locator(PLAYHEAD)).toHaveAttribute("aria-valuetext", /frame 2$/);
	expect(await clip.evaluate((el) => (el as HTMLElement).style.left)).toBe(left);
});

test("the playhead announces the time playback stopped at", async ({ page }) => {
	const play = page.locator(".tl2-timeline [data-transport='play']");
	await play.click();
	await page.waitForTimeout(600);
	await play.click();
	await page.waitForTimeout(200);
	const now = Number(await page.locator(PLAYHEAD).getAttribute("aria-valuenow"));
	expect(now).toBeGreaterThan(0);
	// The announced time, at the ruler's scale, is where the playhead is drawn.
	const drawnPx = await page
		.locator(PLAYHEAD)
		.evaluate((el) =>
			Number(/translateX\(([-\d.]+)px\)/.exec((el as HTMLElement).style.transform)?.[1]),
		);
	const pxPerSec = await page.evaluate(() => {
		const seconds = [...document.querySelectorAll<HTMLElement>(".tl2-timeline .tl2-tick.major")]
			.map((tick) => ({
				m: /^(\d+):(\d\d)$/.exec(tick.textContent ?? ""),
				left: tick.getBoundingClientRect().left,
			}))
			.filter((entry) => entry.m)
			.map((entry) => ({ sec: Number(entry.m![1]) * 60 + Number(entry.m![2]), left: entry.left }));
		const [a, b] = seconds;
		return a && b ? (b.left - a.left) / (b.sec - a.sec) : NaN;
	});
	expect(Math.abs(now * pxPerSec - drawnPx)).toBeLessThanOrEqual(1);
});

test("selecting a clip tints its lane and gutter row, and no other", async ({ page }) => {
	const clips = page.locator(".tl2-lane-free:not([data-lane-base]) > .tl2-clip[data-clipid]");
	expect(await clips.count()).toBeGreaterThan(1);
	for (const index of [0, 1]) {
		const clip = clips.nth(index);
		await clip.click();
		const row = await clip.evaluate((el) =>
			Number(el.closest<HTMLElement>("[data-vui-row]")!.dataset.vuiRow!.replace("lane-", "")),
		);
		await expect(page.locator(".tl2-lanes .tl2-lane.holds")).toHaveCount(1);
		await expect(page.locator(`.tl2-lanes [data-vui-row="lane-${row}"]`)).toHaveClass(/\bholds\b/);
		await expect(page.locator(".tl2-gutter-row.holds")).toHaveCount(1);
		await expect(page.locator(`.tl2-gutter-row[data-gutter-row="${row}"]`)).toHaveClass(
			/\bholds\b/,
		);
		const tint = await page
			.locator(`.tl2-lanes [data-vui-row="lane-${row}"]`)
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		const plain = await page
			.locator(".tl2-lanes .tl2-lane-free:not(.holds):not([data-lane-base])")
			.first()
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(tint).not.toBe(plain);
	}
});

test.describe("lane heights follow lane groups", () => {
	test.beforeEach(async ({ page, context }) => {
		await typedLanesFixture(context);
		await page.goto(`/content/${TYPED_LANES_PROJECT_ID}`);
		await page
			.locator(".tl2-timeline .tl2-lane[data-lane-group='audio']")
			.waitFor({ timeout: 60_000 });
	});

	const heights = async (
		page: Page,
	): Promise<{ lanes: Record<string, number>; aligned: boolean }> =>
		page.evaluate(() => {
			const lanes = [...document.querySelectorAll<HTMLElement>(".tl2-lanes > .tl2-lane")];
			const rows = [...document.querySelectorAll<HTMLElement>(".tl2-gutter .tl2-gutter-row")];
			const byKey: Record<string, number> = {};
			for (const lane of lanes)
				byKey[lane.dataset.laneBase !== undefined ? "scene" : (lane.dataset.laneGroup ?? "none")] =
					lane.getBoundingClientRect().height;
			const aligned =
				lanes.length === rows.length &&
				lanes.every((lane, i) => {
					const a = lane.getBoundingClientRect(),
						b = rows[i]!.getBoundingClientRect();
					return Math.abs(a.top - b.top) <= 1 && Math.abs(a.height - b.height) <= 1;
				});
			return { lanes: byKey, aligned };
		});

	test("scene > visual > audio > text, with every gutter row beside its lane, in both densities", async ({
		page,
	}) => {
		for (const pass of ["comfortable", "compact"]) {
			const { lanes, aligned } = await heights(page);
			expect(lanes.scene, pass).toBeGreaterThan(lanes.visual!);
			expect(lanes.visual, pass).toBeGreaterThan(lanes.audio!);
			expect(lanes.audio, pass).toBeGreaterThan(lanes.text!);
			expect(lanes.audio! / lanes.visual!, pass).toBeGreaterThan(0.6);
			expect(aligned, pass).toBe(true);
			if (pass === "comfortable")
				await page.getByRole("button", { name: "Comfortable density", exact: true }).click();
		}
		await expect(page.locator(".tl2-timeline")).toHaveClass(/tl2-density-compact/);
	});

	test("a clip dragged across lanes of different heights lands on the lane under the pointer", async ({
		page,
	}) => {
		// The preview readiness notice sits above the lanes until media settles; measure after it.
		await expect(
			page.getByText(/^(Loading preview media|Preparing preview|Preview unavailable)/),
		).toHaveCount(0);
		const clip = page.locator(".tl2-lanes [data-clipid='text:1']");
		const from = (await clip.boundingBox())!;
		const target = (await page.locator(".tl2-lanes [data-vui-row='lane-3']").boundingBox())!;
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		const steps = 12;
		for (let step = 1; step <= steps; step += 1) {
			await page.mouse.move(
				from.x + from.width / 2,
				from.y +
					from.height / 2 +
					(target.y + target.height / 2 - (from.y + from.height / 2)) * (step / steps),
			);
		}
		await page.mouse.up();
		await expect(
			page.locator(".tl2-lanes [data-vui-row='lane-3'] [data-clipid='text:1']"),
		).toHaveCount(1);
	});
});

for (const snapping of [true, false]) {
	test(`a clip dropped beside the playhead ${snapping ? "snaps to it" : "lands at the pointer"} with snapping ${snapping ? "on" : "off"}`, async ({
		page,
	}) => {
		if (!snapping) {
			await page.evaluate(() => window.localStorage.setItem("maleo.timeline.snapping", "false"));
			await page.reload();
			await page.locator(".tl2-timeline").waitFor({ state: "visible" });
		}
		// Max zoom, so the short fixture is wide enough to have room either side.
		await setZoom(page, "End");
		const lanes = (await page.locator(".tl2-lanes").boundingBox())!;
		const fill = (await page.locator(".tl2-lanes-fill").boundingBox())!;
		const PLAYHEAD_PX = 200;
		await page.mouse.click(lanes.x + PLAYHEAD_PX, fill.y + 10);
		const clip = page.locator(".tl2-lanes [data-clipid='text:1']");
		const box = (await clip.boundingBox())!;
		const startPx = box.x - lanes.x;
		// Drop the clip's start 4px past the playhead: inside the snap threshold.
		const dx = PLAYHEAD_PX + 4 - startPx;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		for (let step = 1; step <= 10; step += 1)
			await page.mouse.move(box.x + box.width / 2 + dx * (step / 10), box.y + box.height / 2);
		await expect(page.locator(".tl2-snapline")).toHaveCount(snapping ? 1 : 0);
		await page.mouse.up();
		await expect
			.poll(async () => (await clip.boundingBox())!.x - lanes.x)
			.not.toBeCloseTo(startPx, 0);
		const landed = (await clip.boundingBox())!.x - lanes.x;
		if (snapping) expect(Math.abs(landed - PLAYHEAD_PX)).toBeLessThanOrEqual(1);
		else {
			// At the pointer, rounded to a frame (8px at max zoom), and not at the playhead.
			expect(Math.abs(landed - (PLAYHEAD_PX + 4))).toBeLessThanOrEqual(4);
			expect(Math.abs(landed - PLAYHEAD_PX)).toBeGreaterThan(1);
		}
	});
}

test.describe("toolbar", () => {
	const bar = (page: Page) => page.locator(".tl2-timeline [data-vui-slot='timeline-toolbar']");

	test("duplicate and delete are disabled with nothing selected, and every icon control is named", async ({
		page,
	}) => {
		await expect(bar(page).getByRole("button", { name: "Duplicate", exact: true })).toBeDisabled();
		await expect(bar(page).getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
		await page.locator(".tl2-lane-free > .tl2-clip[data-clipid]").first().click();
		await expect(bar(page).getByRole("button", { name: "Duplicate", exact: true })).toBeEnabled();
		await expect(bar(page).getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
		const unnamed = await bar(page)
			.locator("button")
			.evaluateAll(
				(buttons) =>
					buttons.filter((b) => !(b.getAttribute("aria-label") || b.textContent?.trim())).length,
			);
		expect(unnamed).toBe(0);
	});

	test("snapping and ripple show their state and persist", async ({ page }) => {
		const snap = bar(page).getByRole("button", { name: "Snapping", exact: true });
		const ripple = bar(page).getByRole("button", { name: "Ripple editing", exact: true });
		await expect(snap).toHaveAttribute("aria-pressed", "true");
		await expect(ripple).toHaveAttribute("aria-pressed", "false");
		await expect(bar(page)).toHaveScreenshot("timeline-toolbar-desktop.png");
		await ripple.click();
		await snap.click();
		await page.reload();
		await page.locator(".tl2-timeline").waitFor({ state: "visible" });
		await expect(
			bar(page).getByRole("button", { name: "Ripple editing", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(bar(page).getByRole("button", { name: "Snapping", exact: true })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	test("with ripple editing on, the toolbar delete closes the gap as one undo step", async ({
		page,
	}) => {
		const original = page.locator(".tl2-lanes [data-clipid='text:1']");
		const fill = (await page.locator(".tl2-lanes-fill").boundingBox())!;
		const before = (await original.boundingBox())!;
		// Shorten the original to its first few frames: a duplicate lands half a
		// second after the original's start, so this leaves it clear of the original.
		await page.mouse.click(before.x + 10, fill.y + 10);
		await original.click({ position: { x: 4, y: before.height / 2 } });
		await page.keyboard.press("w");
		await expect
			.poll(async () => (await original.boundingBox())!.width)
			.toBeLessThan(before.width - 4);
		await original.click({ position: { x: 4, y: before.height / 2 } });
		await page.keyboard.press("Meta+d");
		// The lane by its row id: the original, its other handle, is about to be deleted.
		const row = await original.evaluate(
			(el) => el.closest<HTMLElement>("[data-vui-row]")!.dataset.vuiRow!,
		);
		const copy = page.locator(
			`.tl2-lanes [data-vui-row="${row}"] .tl2-clip[data-clipid]:not([data-clipid='text:1'])`,
		);
		await expect(copy).toHaveCount(1);
		/* Times from the accessible name: a short clip is drawn at a minimum hit
		 * width, so its box says nothing exact about where it ends. */
		const startOf = async (): Promise<number> =>
			Number(/starts at ([\d.]+) seconds/.exec((await copy.getAttribute("aria-label")) ?? "")?.[1]);
		const copyBefore = await startOf();
		expect(copyBefore).toBeGreaterThan(0);

		await bar(page).getByRole("button", { name: "Ripple editing", exact: true }).click();
		await original.click({ position: { x: 4, y: before.height / 2 } });
		await expect(original).toHaveClass(/\bon\b/);
		await bar(page).getByRole("button", { name: "Delete", exact: true }).click();

		await expect(page.locator(".tl2-lanes [data-clipid='text:1']")).toHaveCount(0);
		// Rippled: the later clip moved earlier. A plain delete would leave it.
		await expect.poll(startOf).toBeLessThan(copyBefore - 0.05);

		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect(page.locator(".tl2-lanes [data-clipid='text:1']")).toHaveCount(1);
		await expect.poll(startOf).toBeCloseTo(copyBefore, 2);
	});
});
